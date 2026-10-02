const REGIONAL_MUSIC_SERVICES = new Set([
  'youtube_music',
  'genie',
  'bugs',
  'joox',
  'nhaccuatui',
  'anghami',
  'melon',
  'kkbox',
  'qq_music',
  'netease_cloud_music',
  'kugou_music',
  'naver_vibe',
  'flo',
  'yandex_music',
  'boomplay',
  'plern',
  'fungjai',
  'zing_mp3',
  'jiosaavn',
  'gaana',
  'langit_musik',
]);

function invalidService(service) {
  return new Response(JSON.stringify({
    ok:false,
    error:service ? `unknown regional music service: ${service}` : 'service is required',
  }), {
    status:400,
    headers:{
      'content-type':'application/json; charset=utf-8',
      'cache-control':'no-store',
    },
  });
}

function unavailable(service) {
  return new Response(JSON.stringify({
    ok:false,
    error:'regional music materialized response unavailable',
    service,
  }), {
    status:503,
    headers:{
      'content-type':'application/json; charset=utf-8',
      'cache-control':'no-store',
    },
  });
}

export async function onRequestGet({ env, request }) {
  const serviceId = String(new URL(request.url).searchParams.get('service') || '').trim();
  if (!REGIONAL_MUSIC_SERVICES.has(serviceId)) return invalidService(serviceId);

  const readModelService = env?.PAGES_READ_MODEL_SERVICE;
  if (typeof readModelService?.fetch !== 'function') return unavailable(serviceId);

  const url = new URL('https://pages-read-model.internal/_internal/pages-response');
  url.searchParams.set('key', `regional-music:${serviceId}`);
  let response;
  try {
    response = await readModelService.fetch(new Request(url, {
      method:'GET',
      headers:{ accept:'application/json' },
    }));
  } catch {
    return unavailable(serviceId);
  }
  if (!response?.ok) return unavailable(serviceId);

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('cache-control', 'public, max-age=30, s-maxage=300, stale-while-revalidate=600');
  return new Response(response.body, {
    status:response.status,
    statusText:response.statusText,
    headers,
  });
}
