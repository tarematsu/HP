import { runOptimizedOhisamaCollectorScheduled } from './ohisama-collector-optimized.js';
import { registerOhisamaFollowerTarget } from './ohisama-collector-entry.js';
import { collectInitialStationheadFollowers } from './stationhead-initial-followers.js';
import { cachedOhisamaFollowerTargetRegistrar } from './ohisama-follower-target-cache.js';
import { withOhisamaFollowerMembership } from './ohisama-follower-membership.js';
import { captureOhisamaPlayback } from './ohisama-playback.js';
import { enrichOhisamaPlaybackMetadata } from './ohisama-runtime-metadata.js';
import {
  loadOhisamaPublicationSnapshot,
  mergeOhisamaPlaybackReadModelWithCadence,
} from './ohisama-publication-cadence.js';
import { refreshOptimizedOhisamaReadModel } from './ohisama-read-model-optimized.js';

export const OHISAMA_FOLLOWER_EXCLUDED_HANDLES = Object.freeze(['46fm', 'buddy46']);
const OHISAMA_FOLLOWER_EXCLUDED_HANDLE_SET = new Set(OHISAMA_FOLLOWER_EXCLUDED_HANDLES);

function normalizedFollowerHandle(value) {
  return String(value || '').trim().toLowerCase();
}

export function activeBroadcastFollowerRegistrar(registerFollowerTarget) {
  if (typeof registerFollowerTarget !== 'function') {
    throw new TypeError('registerFollowerTarget must be a function');
  }
  return async (env, snapshot, observedAt, session) => {
    if (snapshot?.is_broadcasting !== 1) return false;
    if (OHISAMA_FOLLOWER_EXCLUDED_HANDLE_SET.has(normalizedFollowerHandle(snapshot?.host_handle))) {
      return false;
    }
    return registerFollowerTarget(env, snapshot, observedAt, session);
  };
}

function capturingFetch(fetchImpl, onChannelPayload) {
  return async (input, init) => {
    const response = await fetchImpl(input, init);
    const url = typeof input === 'string' ? input : input?.url;
    if (response?.ok && String(url || '').includes('/channels/alias/')) {
      try {
        const payload = await response.clone().json();
        onChannelPayload(payload);
      } catch {}
    }
    return response;
  };
}

export async function runOhisamaPagesScheduled(controller, env, ctx, dependencies = {}) {
  const registerFollowerTarget = activeBroadcastFollowerRegistrar(
    cachedOhisamaFollowerTargetRegistrar(
      withOhisamaFollowerMembership(
        async (targetEnv, snapshot, observedAt, session) => {
          const added = await (dependencies.registerFollowerTarget || registerOhisamaFollowerTarget)(targetEnv, snapshot, observedAt);
          await (dependencies.collectInitialFollowers || collectInitialStationheadFollowers)(targetEnv, snapshot.host_handle, observedAt, {
            session: session ? { auth_token: session.authToken, device_uid: session.deviceUid } : undefined,
            fetchFn: dependencies.fetch,
          });
          return added;
        },
      ),
    ),
  );
  let channelPayload = null;
  const fetchImpl = dependencies.fetch || fetch;
  const result = await runOptimizedOhisamaCollectorScheduled(
    controller,
    env,
    ctx,
    {
      ...dependencies,
      fetch: capturingFetch(fetchImpl, (payload) => { channelPayload = payload; }),
      registerFollowerTarget,
    },
  );
  if (!result?.collected) return result;

  const previousReadModel = await loadOhisamaPublicationSnapshot(env?.PAGES_RESPONSE_R2)
    .catch(() => null);

  let playback = null;
  let metadataEnrichment = null;
  if (channelPayload) {
    try {
      const enrichPlaybackMetadata = dependencies.enrichPlaybackMetadata
        || enrichOhisamaPlaybackMetadata;
      metadataEnrichment = await enrichPlaybackMetadata(
        env,
        channelPayload,
        result,
        result.observed_at,
        {
          enrichTracks: dependencies.enrichTracks,
          ingest: dependencies.ingest,
          metadataLimit: dependencies.metadataLimit,
        },
      );
      if (!metadataEnrichment?.skipped) {
        console.log(JSON.stringify({
          event: 'ohisama_playback_metadata_enriched',
          observed_at: result.observed_at,
          candidates: metadataEnrichment?.candidates || 0,
          attempted: metadataEnrichment?.attempted || 0,
          saved: metadataEnrichment?.saved || 0,
        }));
      }
    } catch (error) {
      console.warn(JSON.stringify({
        event: 'ohisama_playback_metadata_enrichment_failed',
        observed_at: result.observed_at,
        error: String(error?.message || error).slice(0, 500),
      }));
    }

    try {
      playback = await captureOhisamaPlayback(env, channelPayload, result, result.observed_at);
      console.log(JSON.stringify({
        event: 'ohisama_playback_captured',
        observed_at: result.observed_at,
        queue_items: playback.queue?.length || 0,
        transitions_written: playback.transitions_written || 0,
      }));
    } catch (error) {
      console.error(JSON.stringify({
        event: 'ohisama_playback_capture_failed',
        observed_at: result.observed_at,
        error: String(error?.message || error).slice(0, 500),
      }));
    }
  }

  try {
    const generated = await refreshOptimizedOhisamaReadModel(env, result, result.observed_at);
    const { payload: currentReadModel, ...readModel } = generated;
    const publication = await mergeOhisamaPlaybackReadModelWithCadence(
      env,
      playback,
      result,
      result.observed_at,
      previousReadModel,
      currentReadModel,
    );
    const playbackPublished = Boolean(playback) && publication.published === true;
    console.log(JSON.stringify({
      event: 'ohisama_pages_read_model_published',
      ...readModel,
      playback_published: playbackPublished,
      section_refreshed: publication.refreshed || {},
    }));
    return {
      ...result,
      playback: playback ? {
        queue_items: playback.queue?.length || 0,
        transitions_written: playback.transitions_written || 0,
        daily_total_plays: playback.daily?.total_plays || 0,
        daily_unique_tracks: playback.daily?.unique_tracks || 0,
      } : null,
      metadata_enrichment: metadataEnrichment,
      read_model: {
        ...readModel,
        playback_published: playbackPublished,
        section_refreshed: publication.refreshed || {},
        section_updated_at: publication.section_updated_at || {},
      },
    };
  } catch (error) {
    const detail = String(error?.message || error).slice(0, 500);
    console.error(JSON.stringify({
      event: 'ohisama_pages_read_model_failed',
      observed_at: result.observed_at,
      error: detail,
    }));
    return {
      ...result,
      metadata_enrichment: metadataEnrichment,
      read_model: { published: false, error: detail },
    };
  }
}

export default {
  scheduled: runOhisamaPagesScheduled,
};
