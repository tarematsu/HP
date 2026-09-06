import './fetch-guard.js';
import {
  OFFICIAL_NEWS_STAGE_MESSAGE,
  officialNewsStageTask,
  processOfficialNewsStage,
} from './other-official-news-stages.js';
import { queueAttributedEnv } from './queue-attribution.js';
import {
  officialNewsCheckDue,
  officialNewsProbeDue,
  scheduledTimestamp,
} from './sakurazaka-support.js';

export const SAKURAZAKA_CRON = '* * * * *';
export const SAKURAZAKA_CYCLE_MESSAGE = 'sakurazaka-cycle';
const JSON_QUEUE_SEND_OPTIONS = Object.freeze({ contentType: 'json' });
const RETRY_60_SECONDS = Object.freeze({ delaySeconds: 60 });

function soloMonitorDue(now) {
  return new Date(now).getUTCMinutes() % 5 === 0;
}

function cycleBody(scheduledAt, newsCheckDue, stationProbeDue, soloDue) {
  return {
    message_type: SAKURAZAKA_CYCLE_MESSAGE,
    message_version: 1,
    scheduled_at: scheduledAt,
    news_check_due: newsCheckDue,
    station_probe_due: stationProbeDue,
    solo_monitor_due: soloDue,
  };
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

async function dueWork(env, scheduledAt, dependencies = {}) {
  const checkDue = dependencies.officialNewsCheckDue || officialNewsCheckDue;
  const probeDue = dependencies.officialNewsProbeDue || officialNewsProbeDue;
  const soloDueFn = dependencies.soloMonitorDue || soloMonitorDue;
  const [newsCheckDue, stationProbeDue] = await Promise.all([
    checkDue(env, scheduledAt),
    probeDue(env, scheduledAt),
  ]);
  return {
    newsCheckDue: Boolean(newsCheckDue),
    stationProbeDue: Boolean(stationProbeDue),
    soloDue: Boolean(soloDueFn(scheduledAt)),
  };
}

async function send(queue, body) {
  if (!queue?.send) throw new Error('SAKURAZAKA_QUEUE binding is missing');
  await queue.send(body, JSON_QUEUE_SEND_OPTIONS);
}

async function dispatchDueStages(env, scheduledAt, due) {
  if (due.stationProbeDue) {
    await send(env?.SAKURAZAKA_QUEUE, stageBody('station-auth', scheduledAt, {
      after_news_check: due.newsCheckDue,
      after_solo_monitor: due.soloDue,
    }));
    return ['station-auth'];
  }
  if (due.newsCheckDue) {
    await send(env?.SAKURAZAKA_QUEUE, stageBody('probe', scheduledAt, {
      after_solo_monitor: due.soloDue,
    }));
    return ['probe'];
  }
  if (due.soloDue) {
    await send(env?.SAKURAZAKA_QUEUE, stageBody('solo-monitor', scheduledAt));
    return ['solo-monitor'];
  }
  return [];
}

export async function runSakurazakaScheduled(controller, env, dependencies = {}) {
  const cron = String(controller?.cron || '');
  if (cron !== SAKURAZAKA_CRON) return { skipped: true, reason: 'unsupported-cron', cron };
  const scheduledAt = scheduledTimestamp(controller);
  const activeEnv = queueAttributedEnv(env, 'sh-sakurazaka46jp');
  const due = await dueWork(activeEnv, scheduledAt, dependencies);
  if (!due.newsCheckDue && !due.stationProbeDue && !due.soloDue) {
    return { skipped: true, reason: 'no-due-work', scheduled_at: scheduledAt };
  }
  const stages = await dispatchDueStages(activeEnv, scheduledAt, due);
  return {
    dispatched: true,
    dispatched_stages: stages,
    scheduled_at: scheduledAt,
    news_check_due: due.newsCheckDue,
    station_probe_due: due.stationProbeDue,
    solo_monitor_due: due.soloDue,
    news_check_after_collection: due.newsCheckDue && due.stationProbeDue,
  };
}

async function runCycle(env, body) {
  const scheduledAt = Number(body.scheduled_at);
  const explicitDue = typeof body.news_check_due === 'boolean'
    && typeof body.station_probe_due === 'boolean';
  const due = explicitDue
    ? {
      newsCheckDue: body.news_check_due,
      stationProbeDue: body.station_probe_due,
      soloDue: typeof body.solo_monitor_due === 'boolean'
        ? body.solo_monitor_due
        : soloMonitorDue(scheduledAt),
    }
    : await dueWork(env, scheduledAt);
  const stages = await dispatchDueStages(env, scheduledAt, due);
  return {
    task: 'dispatch',
    stages,
    legacy_cycle: cycleBody(scheduledAt, due.newsCheckDue, due.stationProbeDue, due.soloDue),
  };
}

async function processMessage(message, env) {
  const body = message?.body || {};
  if (Number(body.message_version) !== 1) throw new Error('unsupported Sakurazaka task version');
  if (body.message_type === SAKURAZAKA_CYCLE_MESSAGE) {
    const scheduledAt = Number(body.scheduled_at);
    if (!Number.isFinite(scheduledAt)) throw new Error('Sakurazaka cycle timestamp is invalid');
    return runCycle(env, body);
  }
  if (body.message_type === OFFICIAL_NEWS_STAGE_MESSAGE) {
    const task = officialNewsStageTask(body);
    return { task: 'official-news', ...(await processOfficialNewsStage(env, task)) };
  }
  throw new Error(`unsupported Sakurazaka task: ${String(body.message_type || 'unknown')}`);
}

export async function runSakurazakaQueue(batch, env) {
  const messages = batch?.messages || [];
  const activeEnv = queueAttributedEnv(env, 'sh-sakurazaka46jp');
  for (const message of messages) {
    try {
      const result = await processMessage(message, activeEnv);
      console.log(JSON.stringify({
        event: 'sakurazaka_task_completed',
        message_type: message?.body?.message_type || null,
        ...result,
      }));
      message.ack();
    } catch (error) {
      console.error(JSON.stringify({
        event: 'sakurazaka_task_failed',
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

function healthComponent(result, component, degraded) {
  if (result.status === 'fulfilled') return result.value || null;
  degraded.push(component);
  console.error(JSON.stringify({
    event: 'sakurazaka_health_component_failed',
    component,
    error: String(result.reason?.message || result.reason).slice(0, 500),
  }));
  return null;
}

export async function sakurazakaHealth(env) {
  const monitorId = `solo:${env?.SOLO_BROADCAST_HANDLE || 'sakurazaka46jp'}`;
  const [monitorResult, newsResult] = await Promise.allSettled([
    readHealthState(env?.OTHER_DB, `SELECT phase,last_success_at,last_error,updated_at
      FROM sh_cloud_host_monitor_state WHERE id=? LIMIT 1`, [monitorId]),
    readHealthState(env?.OTHER_DB, `SELECT last_check_at,last_success_at,last_error,updated_at
      FROM sh_official_news_monitor_state WHERE id='official-news' LIMIT 1`),
  ]);
  const degraded = [];
  const monitor = healthComponent(monitorResult, 'monitor', degraded);
  const news = healthComponent(newsResult, 'official_news', degraded);
  const ok = degraded.length === 0;
  return Response.json({
    ok,
    worker: 'sh-sakurazaka46jp',
    monitor,
    official_news: news,
    ...(degraded.length ? { degraded_components: degraded } : {}),
  }, {
    status: ok ? 200 : 503,
    headers: { 'cache-control': 'no-store' },
  });
}

export default {
  scheduled: runSakurazakaScheduled,
  queue: runSakurazakaQueue,
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      return sakurazakaHealth(env);
    }
    return Response.json({ ok: false, error: 'not found' }, { status: 404 });
  },
};
