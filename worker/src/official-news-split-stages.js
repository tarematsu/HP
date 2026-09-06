import {
  checkOfficialNews,
  monitorState,
  saveMonitorState,
} from './official-news-announcements.js';
import {
  collectStationChat,
  collectStationMain,
  decodeStationMain,
  finalizeStationProbe,
  probeAnnouncements,
} from './official-news-probe.js';
import { finite } from './official-news-utils.js';

async function recordStageFailure(env, now, error, dependencies) {
  const readState = dependencies.monitorState || monitorState;
  const writeState = dependencies.saveMonitorState || saveMonitorState;
  const message = String(error?.message || error).slice(0, 1000);
  const state = await readState(env).catch(() => null);
  await writeState(env, {
    lastCheckAt: finite(state?.last_check_at) ?? now,
    lastSuccessAt: finite(state?.last_success_at),
    lastError: message,
  }).catch(() => {});
  console.error(JSON.stringify({
    event: 'official_news_stage_failed',
    stage: dependencies.stage,
    error: message,
  }));
  return { skipped: true, failed: true, reason: `${dependencies.stage}-failed` };
}

async function runStage(env, cfg, now, dependencies, fallback) {
  const action = dependencies.action || fallback;
  return action(env, cfg, now);
}

export async function runOfficialNewsCheckOnly(env, cfg, now, dependencies = {}) {
  const check = dependencies.checkOfficialNews || checkOfficialNews;
  try {
    await check(env, cfg, now);
    return { skipped: false, reason: null };
  } catch (error) {
    return recordStageFailure(env, now, error, { ...dependencies, stage: 'check' });
  }
}

export async function runOfficialNewsMainOnly(env, cfg, now, dependencies = {}) {
  return runStage(env, cfg, now, dependencies, collectStationMain);
}

export async function runOfficialNewsDecodeOnly(env, cfg, now, dependencies = {}) {
  return runStage(env, cfg, now, dependencies, decodeStationMain);
}

export async function runOfficialNewsChatOnly(env, cfg, now, dependencies = {}) {
  return runStage(env, cfg, now, dependencies, collectStationChat);
}

export async function runOfficialNewsFinalizeOnly(env, cfg, now, dependencies = {}) {
  return runStage(env, cfg, now, dependencies, finalizeStationProbe);
}

export async function runOfficialNewsProbeOnly(env, cfg, now, dependencies = {}) {
  const probe = dependencies.probeAnnouncements || probeAnnouncements;
  return probe(env, cfg, now);
}
