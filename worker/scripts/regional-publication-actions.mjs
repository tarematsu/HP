export async function enqueueRegionalPublication(config, api, now = Date.now()) {
  const queueName = config.queues?.consumers?.[0]?.queue;
  if (!queueName) throw new Error('Regional publication queue missing');
  const queues = await api('/queues');
  const queue = queues.find((row) => row.queue_name === queueName);
  if (!queue?.queue_id) throw new Error('Regional publication queue not found');
  await api(`/queues/${queue.queue_id}/messages`, {
    body: { message_type: 'regional-music-publish', scheduled_at: now },
    content_type: 'json',
  });
}
