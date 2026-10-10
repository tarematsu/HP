const started = Date.now();
const minimum = started - 90 * 60_000;
let diagnostic;
for (let attempt = 0; attempt < 10; attempt++) {
  const response = await fetch('https://skrzk.pages.dev/api/youtube-music', { signal: AbortSignal.timeout(30_000), headers: { 'cache-control': 'no-cache' } });
  const payload = await response.json();
  const state = payload.services?.find(row => row.service === 'youtube_music');
  diagnostic = { http_status: response.status, status: state?.status, last_attempt_at: state?.last_attempt_at, last_success_at: state?.last_success_at, error_class: state?.last_error_class, error_message: state?.last_error_message, entity_counts: state?.entity_counts, artists: payload.artists?.length, tracks: payload.tracks?.length };
  console.log(JSON.stringify(diagnostic));
  if (response.ok && payload.ok !== false && state?.status === 'ok' && Number(state.last_success_at) >= minimum && Number(state.entity_counts?.artists) >= 3 && Number(state.entity_counts?.tracks) > 0 && payload.artists?.length >= 3 && payload.tracks?.length) process.exit(0);
  if (attempt < 9) await new Promise(resolve => setTimeout(resolve, 15_000));
}
throw new Error('YouTube Music repair did not publish complete current source observations');
