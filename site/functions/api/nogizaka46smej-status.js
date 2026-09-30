import {
  officialAnnouncementSql,
  officialCollectionActive,
  officialEmptyStatusPayload,
  officialLateWindowMs,
  officialMainLimit,
  officialMainSql,
  officialStatusJson,
  officialStatusPayload,
} from '../lib/official-account-status.js';

const HANDLE = 'nogizaka46smej';
const ANNOUNCEMENT_TABLE = 'sh_nogizaka_official_news_announcements';
const MAIN_TABLE = 'sh_nogizaka46smej_main';

export async function onRequestGet({ env }) {
  if (!env?.OTHER_DB?.prepare) return officialStatusJson({ ok: false, error: 'OTHER_DB unavailable' }, 503);
  const generatedAt = Date.now();
  try {
    const event = await env.OTHER_DB.prepare(officialAnnouncementSql(ANNOUNCEMENT_TABLE))
      .bind(generatedAt - officialLateWindowMs(env)).first();
    const active = officialCollectionActive(event);
    const mainLimit = officialMainLimit(active);
    const mainResult = await env.OTHER_DB.prepare(officialMainSql({
      tableName: MAIN_TABLE,
      handle: HANDLE,
      limit: mainLimit,
    })).all();
    return officialStatusJson(officialStatusPayload({
      handle: HANDLE,
      generatedAt,
      event,
      samples: mainResult.results || [],
    }));
  } catch (error) {
    const message = String(error?.message || error);
    if (/no such table: (sh_nogizaka_official_news_announcements|sh_nogizaka46smej_main|sh_sakurazaka46jp_collection_tests)/i.test(message)) {
      return officialStatusJson(officialEmptyStatusPayload(HANDLE, generatedAt));
    }
    return officialStatusJson({ ok: false, error: message.slice(0, 500) }, 500);
  }
}
