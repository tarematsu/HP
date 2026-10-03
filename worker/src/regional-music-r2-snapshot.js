import { regionalMusicSnapshotDate } from './regional-music-store.js';
import { regionalMusicService } from './regional-music-service-registry.js';
import { resolveRegionalMusicCanonicalTrack } from './regional-music-track-canonical.js';

export const regionalSnapshotKey = service => `regional-music/${service}/latest.json`;
export const regionalDayKey = (service,day) => `regional-music/${service}/days/${day}.json`;
const fields=['artists','tracks','releases','playlists','playlist_memberships','artist_track_orders'];
const keyOf=(field,row)=> field==='artists' ? row.canonical_artist : field==='releases' ? row.service_release_id : field==='playlists' ? row.service_playlist_id : field==='artist_track_orders' ? `${row.canonical_artist}/${row.service_track_id}` : field==='playlist_memberships' ? `${row.service_playlist_id}/${row.service_track_id}` : row.service_track_id;

function positiveTrackId(value) {
  const id=Number(value);
  return Number.isSafeInteger(id) && id>0 ? id : null;
}

function regionalTrackKey(row) {
  return `${row?.service || ''}/${row?.service_track_id || ''}`;
}

function canonicalizePayloadTrackIds(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const result={...payload};
  const trackIds=new Map();
  if (Array.isArray(payload.tracks)) {
    result.tracks=payload.tracks.map(row=>{
      const trackId=positiveTrackId(row?.track_id ?? row?.canonical_track_id);
      if (trackId!=null) trackIds.set(regionalTrackKey(row),trackId);
      return trackId==null ? row : {...row,track_id:trackId,canonical_track_id:trackId};
    });
  }
  const attachTrackId=rows=>rows.map(row=>{
    const trackId=positiveTrackId(row?.track_id ?? row?.canonical_track_id)
      ?? trackIds.get(regionalTrackKey(row));
    return trackId==null ? row : {...row,track_id:trackId};
  });
  if (Array.isArray(payload.playlist_memberships)) result.playlist_memberships=attachTrackId(payload.playlist_memberships);
  if (Array.isArray(payload.artist_track_orders)) result.artist_track_orders=attachTrackId(payload.artist_track_orders);
  return result;
}

async function canonicalizeSnapshotTracks(env,data) {
  if (!data?.tracks?.size) return;
  for (const [key,row] of data.tracks) {
    let resolved=row;
    if (positiveTrackId(row?.track_id ?? row?.canonical_track_id)==null && env?.MINUTE_DB?.prepare) {
      resolved=await resolveRegionalMusicCanonicalTrack(env,row);
    }
    const trackId=positiveTrackId(resolved?.track_id ?? resolved?.canonical_track_id);
    if (resolved!==row || trackId!=null) {
      data.tracks.set(key,trackId==null ? {...row,...resolved} : {...row,...resolved,track_id:trackId,canonical_track_id:trackId});
    }
  }

  // Provider IDs remain aliases for round-tripping to each service, but every
  // dependent fact carries sh_tracks.id whenever the parent track is resolved.
  const trackIds=new Map();
  for (const row of data.tracks.values()) {
    const trackId=positiveTrackId(row?.track_id ?? row?.canonical_track_id);
    if (trackId!=null) trackIds.set(regionalTrackKey(row),trackId);
  }
  for (const field of ['playlist_memberships','artist_track_orders']) {
    for (const [key,row] of data[field]) {
      const trackId=positiveTrackId(row?.track_id ?? row?.canonical_track_id)
        ?? trackIds.get(regionalTrackKey(row));
      if (trackId!=null) data[field].set(key,{...row,track_id:trackId});
    }
  }
}

export async function collectRegionalR2Snapshot({service,collect,previous,now,fetchImpl=fetch,bindings={}}) {
  const data=Object.fromEntries(fields.map(field=>[field,new Map((previous?.[field] || []).map(row=>[keyOf(field,row),row]))]));
  const authoritative=new Set(previous ? fields : []);
  let state;
  const resetOrders=new Set();
  const store=async (field,value)=>{
    if (value.service!==service) throw new Error('Snapshot service identity mismatch');
    if(field==='state') {state=value;return;}
    if(field==='playlist_snapshots') {
      authoritative.add('playlist_memberships');
      for(const [key,row] of data.playlist_memberships) if(row.service_playlist_id===value.service_playlist_id) data.playlist_memberships.delete(key);
      return;
    }
    const row={...value,snapshot_date:value.snapshot_date || regionalMusicSnapshotDate(value.observed_at || now)};
    authoritative.add(field);
    const key=keyOf(field,row);
    data[field].set(key,{...data[field].get(key),...row});
    if(field==='tracks' && Number.isInteger(value.popularity_rank) && value.popularity_rank>0) {
      if(!resetOrders.has(value.canonical_artist)) {
        for(const [orderKey,order] of data.artist_track_orders) if(order.canonical_artist===value.canonical_artist) data.artist_track_orders.delete(orderKey);
        resetOrders.add(value.canonical_artist);
      }
      const source=value.popularity_rank_source || 'provider_popularity_order';
      if(!['provider_rank','provider_popularity_order','artist_page_order'].includes(source)) throw new Error('Invalid rank provenance');
      const order={...row,position:value.popularity_rank,rank_source:source};
      authoritative.add('artist_track_orders');
      data.artist_track_orders.set(keyOf('artist_track_orders',order),order);
    }
  };
  const collectorEnv={...bindings,REGIONAL_MUSIC_SNAPSHOT_STORE:store};
  try {await collect(collectorEnv,now,fetchImpl);}
  catch(error) {state={service,status:'error',last_attempt_at:now,last_error_class:'collection_error',last_error_message:String(error.message).slice(0,250),entity_counts:{}};}
  try {await canonicalizeSnapshotTracks(collectorEnv,data);}
  catch(error) {
    if(state?.status==='ok') state={...state,status:'degraded',last_error_class:'canonical_track_resolution_error',last_error_message:String(error.message).slice(0,250)};
  }
  if(!state) state={service,status:'error',last_attempt_at:now,last_error_class:'collector_state_missing',last_error_message:'Collector did not report terminal state',entity_counts:{}};
  state={...state,updated_at:now,last_success_at:state.last_success_at ?? previous?.state?.last_success_at ?? null};
  return {version:1,service,day:regionalMusicSnapshotDate(now),updated_at:now,authoritative_fields:[...authoritative],...Object.fromEntries(fields.map(field=>[field,[...data[field].values()]])),state};
}

export function regionalSnapshotFromPayload(payload,service) {
  const state=(payload?.services || []).find(row=>row.service===service);
  if(!state || !Number.isFinite(payload.updated_at)) return null;
  const updatedAt=state.updated_at || state.last_attempt_at || payload.updated_at;
  return {version:1,service,updated_at:updatedAt,day:regionalMusicSnapshotDate(updatedAt),state,authoritative_fields:[...fields],...Object.fromEntries(fields.map(field=>[field,(payload[field] || []).filter(row=>row.service===service)]))};
}

export function mergeRegionalR2Snapshot(payload,snapshot) {
  const canonicalPayload=canonicalizePayloadTrackIds(payload);
  if(snapshot?.version!==1 || !regionalMusicService(snapshot.service) || !Array.isArray(snapshot.tracks) || snapshot.state?.service!==snapshot.service || !Number.isFinite(snapshot.updated_at)) return canonicalPayload;
  const service=snapshot.service;
  const replace=(rows,next)=>[...(rows || []).filter(row=>row.service!==service),...(next || [])];
  const existing=(canonicalPayload.services || []).find(row=>row.service===service);
  if(existing?.storage==='r2' && existing.updated_at>snapshot.updated_at) return canonicalPayload;
  const definition=regionalMusicService(service);
  const result={...canonicalPayload,updated_at:Math.max(canonicalPayload.updated_at || 0,snapshot.updated_at),services:replace(canonicalPayload.services,[{...snapshot.state,storage:'r2',region:definition.region,phase:definition.phase,metrics:[...definition.metrics]}])};
  for(const field of fields) {
    if(Array.isArray(snapshot.authoritative_fields) && !snapshot.authoritative_fields.includes(field)) continue;
    // An initial discovery outage reports health without erasing legacy observations.
    if(!snapshot.authoritative_fields && snapshot.state.status==='error' && !snapshot[field]?.length) continue;
    result[field]=replace(canonicalPayload[field],snapshot[field]);
  }
  return canonicalizePayloadTrackIds(result);
}
