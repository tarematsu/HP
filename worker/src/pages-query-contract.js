export const PAGES_QUERY_ROUTES = Object.freeze([
  'dashboard-details',
  'spotify-monthly-listeners',
  'host-history',
  'history',
  'sakurazaka46jp',
  'spotify-playcounts',
  'first-week-comparison',
  'kkbox',
  'qq-music',
  'kugou-music',
]);
export const PAGES_QUERY_MODEL_KEYS = new Set(PAGES_QUERY_ROUTES.map(route => `query:${route}`));
