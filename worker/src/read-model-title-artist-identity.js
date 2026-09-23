import {
  attachTitleArtistIdentity,
  loadTitleArtistIdentityRows,
} from './track-title-artist-identity.js';

export async function resolveReadModelTitleArtistIdentity(env, readModel, limit = 80) {
  const queue = readModel?.queue?.value;
  if (!queue?.tracks?.length) return readModel;
  const rows = await loadTitleArtistIdentityRows(
    [env?.MINUTE_DB, env?.BUDDIES_DB],
    queue.tracks,
    limit,
  );
  if (!rows.length) return readModel;
  const tracks = attachTitleArtistIdentity(queue.tracks, rows);
  if (tracks === queue.tracks) return readModel;
  return {
    ...readModel,
    queue: {
      ...readModel.queue,
      value: { ...queue, tracks },
    },
  };
}
