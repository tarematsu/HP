import './fetch-guard.js';
import {
  OFFICIAL_NEWS_STAGE_MESSAGE,
  officialNewsStageTask,
  processOfficialNewsStage,
} from './other-official-news-stages.js';
import { queueAttributedEnv } from './queue-attribution.js';
import { ensureSakurazakaSession } from './sakurazaka-auth.js';
import {
  NOGIZAKA_HANDLE,
  NOGIZAKA_MONITOR_STATE_ID,
  completeNogizakaNewsCheck,
  nogizakaNewsCheckDue,
  nogizakaOfficialNewsConfig,
  nogizakaStationProbeDue,
  reconcileNogizakaOfficialAnnouncements,
  runNogizakaNewsDetailStage,
  runNogizakaNewsListStage,
} from './nogizaka-official-news.js';
import {
  collectNogizakaStationChat,
  collectNogizakaStationMain,
  decodeNogizakaStationMain,
  finalizeNogizakaStationProbe,
} from './nogizaka-official-news-probe.js';
import { materializeNogizakaRawMinute } from './nogizaka-raw-materializer.js';

export const NOGIZAKA_CRON = '* * * * *';
const JSON_QUEUE_SEND_OPTIONS = Object.freeze({ contentType: 'json' });
const RETRY_60_SECONDS = Object.freeze({ delaySeconds: 60 });

function scheduledTimestamp(controller) {
  const value = Number(controller?.scheduledTime);
  return Number.isFinite(value) && value >= 0 ? value : Date.now();
}

function stageBody(stage, scheduledAt, extra = null) {
  return {
    message_type: OFFICIAL_NEWS_STAGE_MESSAGE,
    message_version: 1,
    stage,
    scheduled_at: scheduledAt,
    ...(extra || {}),
  };
}

async function send(queue, body) {
  if (!queue?.send) throw new Error('HOST_MONITOR_QUEUE binding is missing for Nogizaka');
  await queue.send(body, JSON_QUEUE_SEND_OPTIONS);
}

export async function runNogizakaScheduled(controller, env, dependencies = {}) {
  const cron = String(controller?.cron || '');
  if (cron !== NOGIZAKA_CRON) return { skipped: true, reason: 'unsupported-cron', cron };
  const scheduledAt = scheduledTimestamp(controller);
  const activeEnv = queueAttributedEnv(env, 'sh-nogizaka46smej');
  const checkDue = dependencies.newsCheckDue || nogizakaNewsCheckDue;
  const probeDue = dependencies.stationProbeDue || nogizakaStationProbeDue;
  const [newsCheckDue, stationProbeDue] = await Promise.all([
    checkDue(activeEnv, scheduledAt),
    probeDue(activeEnv, scheduledAt),
  ]);

  if (stationProbeDue) {
    await send(activeEnv.HOST_MONITOR_QUEUE, stageBody('station-auth', scheduledAt, {
      after_news_check: newsCheckDue,
    }));
    return {
      dispatched: true,
      dispatched_stages: ['station-auth'],
      scheduled_at: scheduledAt,
      news_check_due: newsCheckDue,
      station_probe_due: true,
      news_check_after_collection: newsCheckDue,
    };
  }

  if (newsCheckDue) {
    await send(activeEnv.HOST_MONITOR_QUEUE, stageBody('probe', scheduledAt));
    return {
      dispatched: true,
      dispatched_stages: ['probe'],
      scheduled_at: scheduledAt,
      news_check_due: true,
      station_probe_due: false,
      news_check_after_collection: false,
    };
  }

  return { skipped: true, reason: 'no-due-work', scheduled_at: scheduledAt };
}

function stageDependencies() {
  return {
    config: nogizakaOfficialNewsConfig,
    list: runNogizakaNewsListStage,
    detail: runNogizakaNewsDetailStage,
    complete: completeNogizakaNewsCheck,
    auth: ensureSakurazakaSession,
    main: collectNogizakaStationMain,
    decode: decodeNogizakaStationMain,
    chat: collectNogizakaStationChat,
    finalize: finalizeNogizakaStationProbe,
    rawMaterialize: materializeNogizakaRawMinute,
    reconcile: reconcileNogizakaOfficialAnnouncements,
  };
}

async function processMessage(message, env, dependencies = {}) {
  const body = message?.body || {};
  if (body.message_type !== OFFICIAL_NEWS_STAGE_MESSAGE || Number(body.message_version) !== 1) {
    throw new Error(`unsupported Nogizaka task: ${String(body.message_type || 'unknown')}`);
  }
  const task = officialNewsStageTask(body);
  return processOfficialNewsStage(env, task, { ...stageDependencies(), ...dependencies });
}

export async function runNogizakaQueue(batch, env, dependencies = {}) {
  const messages = batch?.messages || [];
  const activeEnv = queueAttributedEnv(env, 'sh-nogizaka46smej');
  for (const message of messages) {
    try {
      const result = await processMessage(message, activeEnv, dependencies);
      console.log(JSON.stringify({
        event: 'nogizaka_task_completed',
        message_type: message?.body?.message_type || null,
        ...result,
      }));
      message.ack();
    } catch (error) {
      console.error(JSON.stringify({
        event: 'nogizaka_task_failed',
        message_type: message?.body?.message_type || null,
        error: String(error?.message || error).slice(0, 800),
      }));
      message.retry(RETRY_60_SECONDS);
    }
  }
}

async function readHealthState(db, sql, bindings = []) {
  if (typeof db?.prepare !== 'function') throw new Error('OTHER_DB binding is unavailable');
  let statement = db.prepare(sql);
  if (bindings.length) statement = statement.bind(...bindings);
  return statement.first();
}

function component(result, name, degraded) {
  if (result.status === 'fulfilled') return result.value || null;
  degraded.push(name);
  console.error(JSON.stringify({
    event: 'nogizaka_health_component_failed',
    component: name,
    error: String(result.reason?.message || result.reason).slice(0, 500),
  }));
  return null;
}

export async function nogizakaHealth(env) {
  const handle = String(env?.SOLO_BROADCAST_HANDLE || NOGIZAKA_HANDLE).trim().toLowerCase();
  const [rawResult, derivedResult, newsResult] = await Promise.allSettled([
    readHealthState(env?.OTHER_DB, `SELECT observed_at,station_id,is_broadcasting
      FROM sh_nogizaka46smej_main ORDER BY observed_at DESC LIMIT 1`),
    readHealthState(env?.OTHER_DB, `SELECT id,status,station_id,last_observed_at
      FROM sh_host_broadcast_sessions
      WHERE source_scope='nogizaka46smej_solo' AND handle=?
      ORDER BY started_at DESC,id DESC LIMIT 1`, [handle]),
    readHealthState(env?.OTHER_DB, `SELECT last_check_at,last_success_at,last_error,updated_at
      FROM sh_official_news_monitor_state WHERE id=? LIMIT 1`, [NOGIZAKA_MONITOR_STATE_ID]),
  ]);
  const degraded = [];
  const raw = component(rawResult, 'raw_collection', degraded);
  const derived = component(derivedResult, 'raw_materializer', degraded);
  const news = component(newsResult, 'official_news', degraded);
  const ok = degraded.length === 0;
  return Response.json({
    ok,
    worker: 'sh-nogizaka46smej',
    handle,
    raw_collection: raw,
    raw_materializer: derived,
    official_news: news,
    ...(degraded.length ? { degraded_components: degraded } : {}),
  }, {
    status: ok ? 200 : 503,
    headers: { 'cache-control': 'no-store' },
  });
}

export default {
  scheduled: runNogizakaScheduled,
  queue: runNogizakaQueue,
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      return nogizakaHealth(env);
    }
    return Response.json({ ok: false, error: 'not found' }, { status: 404 });
  },
};
