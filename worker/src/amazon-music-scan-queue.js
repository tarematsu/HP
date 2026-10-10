export const AMAZON_SCAN_MESSAGE_TYPE = 'amazon-daily-50k';

export async function enqueueAmazonMusicScan(env, scheduledTime, start = false) {
  if (!env?.MUSIC_PLAYLIST_QUEUE?.send) throw new Error('Amazon scan Queue binding is missing');
  await env.MUSIC_PLAYLIST_QUEUE.send({ message_type: AMAZON_SCAN_MESSAGE_TYPE, message_version: 1, scheduled_time: scheduledTime, start }, { contentType: 'json' });
  return { queued: true };
}

export async function consumeAmazonMusicScans(batch, env, runScan) {
  const remaining = [];
  for (const entry of batch.messages || []) {
    const message = entry.body;
    if (message?.message_type !== AMAZON_SCAN_MESSAGE_TYPE) { remaining.push(entry); continue; }
    if (message.message_version !== 1 || !Number.isSafeInteger(message.scheduled_time) || message.scheduled_time <= 0 || typeof message.start !== 'boolean') {
      entry.ack?.();
      continue;
    }
    try {
      await runScan(env, message.scheduled_time, { start: message.start });
      entry.ack?.();
    } catch (error) {
      console.error(JSON.stringify({ event: 'amazon_scan_queue_failed', scheduled_time: message.scheduled_time, error: String(error.message || error).slice(0, 500) }));
      entry.retry?.();
    }
  }
  return remaining;
}
