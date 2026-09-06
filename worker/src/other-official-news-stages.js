export const OFFICIAL_NEWS_STAGE_MESSAGE = 'other-official-news-stage';
const JSON_QUEUE_SEND_OPTIONS = Object.freeze({ contentType: 'json' });
let authModulePromise;
let checkModulePromise;
let splitModulePromise;
let reconcileModulePromise;
let rawMaterializerModulePromise;
let utilsModulePromise;

function loadAuthModule() {
  authModulePromise ||= import('./sakurazaka-auth.js');
  return authModulePromise;
}

function loadCheckModule() {
  checkModulePromise ||= import('./official-news-check-stages.js');
  return checkModulePromise;
}

function loadSplitModule() {
  splitModulePromise ||= import('./official-news-split-stages.js');
  return splitModulePromise;
}

function loadReconcileModule() {
  reconcileModulePromise ||= import('./official-news-reconcile.js');
  return reconcileModulePromise;
}

function loadRawMaterializerModule() {
  rawMaterializerModulePromise ||= import('./sakurazaka-raw-materializer.js');
  return rawMaterializerModulePromise;
}

function loadUtilsModule() {
  utilsModulePromise ||= import('./official-news-utils.js');
  return utilsModulePromise;
}

function continuationExtra(task, extra = null) {
  const value = { ...(extra || {}) };
  if (task.afterNewsCheck) value.after_news_check = true;
  return Object.keys(value).length ? value : null;
}

async function sendStage(env, stage, scheduledAt, dependencies, extra = null) {
  const body = {
    message_type: OFFICIAL_NEWS_STAGE_MESSAGE,
    message_version: 1,
    stage,
    scheduled_at: scheduledAt,
    ...(extra || {}),
  };
  if (dependencies.send) return dependencies.send(body);
  if (!env?.HOST_MONITOR_QUEUE?.send) throw new Error('HOST_MONITOR_QUEUE binding is missing');
  return env.HOST_MONITOR_QUEUE.send(body, JSON_QUEUE_SEND_OPTIONS);
}

async function stageConfig(env, dependencies) {
  const config = dependencies.config || (await loadUtilsModule()).officialNewsConfig;
  return config(env);
}

async function runList(env, task, dependencies) {
  const list = dependencies.list || (await loadCheckModule()).runOfficialNewsListStage;
  const result = await list(env, await stageConfig(env, dependencies), task.scheduledAt);
  let nextStage;
  let extra = null;
  if (result?.failed || result?.reason === 'not-due') {
    nextStage = 'reconcile';
  } else if (result?.candidates?.length) {
    nextStage = 'news-detail';
    extra = { candidates: result.candidates, candidate_index: 0 };
  } else {
    nextStage = 'news-complete';
  }
  await sendStage(env, nextStage, task.scheduledAt, dependencies, continuationExtra(task, extra));
  return {
    stage: 'probe',
    pending: true,
    next_stage: nextStage,
    candidates: result?.candidates?.length || 0,
    skipped: result?.skipped === true,
    reason: result?.reason ?? null,
  };
}

async function runDetail(env, task, dependencies) {
  const detail = dependencies.detail || (await loadCheckModule()).runOfficialNewsDetailStage;
  const candidate = task.candidates[task.candidateIndex];
  if (!candidate) throw new Error('official news detail candidate is missing');
  const result = await detail(
    env,
    await stageConfig(env, dependencies),
    task.scheduledAt,
    candidate,
  );
  let nextStage;
  let extra = null;
  if (result?.failed) {
    nextStage = 'reconcile';
  } else if (task.candidateIndex + 1 < task.candidates.length) {
    nextStage = 'news-detail';
    extra = { candidates: task.candidates, candidate_index: task.candidateIndex + 1 };
  } else {
    nextStage = 'news-complete';
  }
  await sendStage(env, nextStage, task.scheduledAt, dependencies, continuationExtra(task, extra));
  return {
    stage: 'news-detail',
    pending: true,
    next_stage: nextStage,
    candidate_index: task.candidateIndex,
    candidates: task.candidates.length,
    skipped: result?.skipped === true,
    reason: result?.reason ?? null,
    saved: Number(result?.saved || 0),
  };
}

async function runComplete(env, task, dependencies) {
  const complete = dependencies.complete || (await loadCheckModule()).completeOfficialNewsCheck;
  const result = await complete(env, task.scheduledAt);
  await sendStage(env, 'reconcile', task.scheduledAt, dependencies, continuationExtra(task));
  return {
    stage: 'news-complete',
    pending: true,
    next_stage: 'reconcile',
    skipped: result?.skipped === true,
    reason: result?.reason ?? null,
  };
}

async function runStationAuth(env, task, dependencies) {
  const auth = dependencies.auth || (await loadAuthModule()).ensureSakurazakaSession;
  await auth(env);
  await sendStage(env, 'station-main', task.scheduledAt, dependencies, continuationExtra(task));
  return {
    stage: 'station-auth',
    pending: true,
    next_stage: 'station-main',
  };
}

async function runStationMain(env, task, dependencies) {
  const main = dependencies.main || (await loadSplitModule()).runOfficialNewsMainOnly;
  const result = await main(env, await stageConfig(env, dependencies), task.scheduledAt);
  if (result?.skipped) {
    await sendStage(env, 'reconcile', task.scheduledAt, dependencies, continuationExtra(task));
    return {
      stage: 'station-main',
      pending: true,
      next_stage: 'reconcile',
      skipped: true,
      reason: result.reason ?? null,
    };
  }
  await sendStage(env, 'station-decode', task.scheduledAt, dependencies, continuationExtra(task));
  return {
    stage: 'station-main',
    pending: true,
    next_stage: 'station-decode',
    skipped: false,
  };
}

async function runStationDecode(env, task, dependencies) {
  const decode = dependencies.decode || (await loadSplitModule()).runOfficialNewsDecodeOnly;
  const result = await decode(env, await stageConfig(env, dependencies), task.scheduledAt);
  const nextStage = result?.active ? 'station-chat' : 'station-finalize';
  await sendStage(env, nextStage, task.scheduledAt, dependencies, continuationExtra(task));
  return {
    stage: 'station-decode',
    pending: true,
    next_stage: nextStage,
    active: result?.active === true,
    station_id: result?.station_id ?? null,
  };
}

async function runStationChat(env, task, dependencies) {
  const chat = dependencies.chat || (await loadSplitModule()).runOfficialNewsChatOnly;
  const result = await chat(env, await stageConfig(env, dependencies), task.scheduledAt);
  await sendStage(env, 'station-finalize', task.scheduledAt, dependencies, continuationExtra(task));
  return {
    stage: 'station-chat',
    pending: true,
    next_stage: 'station-finalize',
    skipped: result?.skipped === true,
    reason: result?.reason ?? null,
  };
}

async function runStationFinalize(env, task, dependencies) {
  const finalize = dependencies.finalize || (await loadSplitModule()).runOfficialNewsFinalizeOnly;
  const result = await finalize(env, await stageConfig(env, dependencies), task.scheduledAt);
  await sendStage(env, 'raw-materialize', task.scheduledAt, dependencies, continuationExtra(task));
  return {
    stage: 'station-finalize',
    pending: true,
    next_stage: 'raw-materialize',
    skipped: result?.skipped === true,
    reason: result?.reason ?? null,
    active: result?.active === true,
  };
}

async function runRawMaterialize(env, task, dependencies) {
  const materialize = dependencies.rawMaterialize
    || (await loadRawMaterializerModule()).materializeSakurazakaRawMinute;
  const result = await materialize(env, task.scheduledAt);
  const nextStage = task.afterNewsCheck ? 'probe' : 'reconcile';
  await sendStage(env, nextStage, task.scheduledAt, dependencies);
  return {
    stage: 'raw-materialize',
    pending: true,
    next_stage: nextStage,
    skipped: result?.skipped === true,
    reason: result?.reason ?? null,
    active: result?.active === true,
    session_id: result?.session_id ?? null,
    station_id: result?.station_id ?? null,
  };
}

async function runReconcile(env, task, dependencies) {
  const reconcile = dependencies.reconcile
    || (await loadReconcileModule()).reconcileOfficialAnnouncements;
  const result = await reconcile(env, task.scheduledAt);
  return {
    stage: 'reconcile',
    pending: false,
    skipped: result?.skipped === true,
    reason: result?.reason ?? null,
  };
}

function compactCandidate(candidate) {
  return {
    newsId: String(candidate?.newsId || '').slice(0, 100),
    href: String(candidate?.href || '').slice(0, 1000),
    listTitle: String(candidate?.listTitle || '').slice(0, 500),
  };
}

export function officialNewsStageTask(body) {
  if (body?.message_type !== OFFICIAL_NEWS_STAGE_MESSAGE
      || Number(body?.message_version) !== 1) {
    throw new Error('unsupported official news stage task');
  }
  const scheduledAt = Number(body.scheduled_at);
  if (!Number.isFinite(scheduledAt)) throw new Error('official news stage timestamp is invalid');
  let stage = 'probe';
  if (body.stage === 'news-detail') stage = 'news-detail';
  else if (body.stage === 'news-complete') stage = 'news-complete';
  else if (body.stage === 'station-auth') stage = 'station-auth';
  else if (body.stage === 'station-main' || body.stage === 'station-probe') stage = 'station-main';
  else if (body.stage === 'station-decode') stage = 'station-decode';
  else if (body.stage === 'station-chat') stage = 'station-chat';
  else if (body.stage === 'station-finalize') stage = 'station-finalize';
  else if (body.stage === 'raw-materialize' || body.stage === 'solo-monitor') stage = 'raw-materialize';
  else if (body.stage === 'reconcile') stage = 'reconcile';
  const candidates = Array.isArray(body.candidates)
    ? body.candidates.slice(0, 40).map(compactCandidate).filter((item) => item.newsId && item.href)
    : [];
  const candidateIndex = Math.max(0, Math.trunc(Number(body.candidate_index) || 0));
  const afterNewsCheck = body.after_news_check === true;
  return { stage, scheduledAt, candidates, candidateIndex, afterNewsCheck };
}

export async function processOfficialNewsStage(env, task, dependencies = {}) {
  if (task.stage === 'raw-materialize') return runRawMaterialize(env, task, dependencies);
  if (task.stage === 'reconcile') return runReconcile(env, task, dependencies);
  if (task.stage === 'station-finalize') return runStationFinalize(env, task, dependencies);
  if (task.stage === 'station-chat') return runStationChat(env, task, dependencies);
  if (task.stage === 'station-decode') return runStationDecode(env, task, dependencies);
  if (task.stage === 'station-main') return runStationMain(env, task, dependencies);
  if (task.stage === 'station-auth') return runStationAuth(env, task, dependencies);
  if (task.stage === 'news-complete') return runComplete(env, task, dependencies);
  if (task.stage === 'news-detail') return runDetail(env, task, dependencies);
  return runList(env, task, dependencies);
}
