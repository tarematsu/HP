export function publicLatest(latest, channel, station, owner, goal) {
  if (!latest) return null;
  return {
    observed_at: latest.observed_at,
    channel_id: latest.channel_id,
    channel_alias: latest.channel_alias,
    channel_name: latest.channel_name,
    station_id: latest.station_id,
    is_launched: latest.is_launched,
    is_broadcasting: latest.is_broadcasting,
    chat_status: latest.chat_status,
    listener_count: latest.listener_count,
    online_member_count: latest.online_member_count,
    total_member_count: latest.total_member_count,
    guest_count: latest.guest_count,
    total_listens: latest.total_listens,
    stream_goal: goal,
    current_stream_count: latest.current_stream_count ?? station?.streaming_party?.current_stream_count ?? null,
    host_account_id: latest.host_account_id,
    host_handle: latest.host_handle,
    broadcast_start_time: latest.broadcast_start_time,
    comment_velocity: latest.comment_velocity,
    description: channel.description || station.status || null,
    artist_name: channel.artist_name || null,
    accent_color: channel.accent_color || null,
    channel_image: channel.images?.medium?.url || null,
    logo_image: channel.images?.logo?.medium?.url || null,
    host_image: owner.thumbnail?.url || owner.medium?.url || null,
  };
}

export function compactQueueStatus(latestQueue, latest, playback, totalItems, loadedItems = totalItems) {
  if (!latestQueue) return null;
  const playing = latest?.is_broadcasting !== 0
    && latest?.is_broadcasting !== false
    && !latestQueue.is_paused
    && playback.currentIndex >= 0;
  return {
    is_paused: Boolean(latestQueue.is_paused),
    playing,
    current_index: playback.currentIndex,
    progress_ms: playback.progressMs,
    anchor_at: playback.anchorAt,
    queue_end_at: playback.queueEndAt,
    total_items: totalItems,
    returned_items: loadedItems,
    loaded_items: loadedItems,
    has_more: loadedItems < totalItems,
  };
}
