const ASSET_VERSION = '20261005.2';
const stylePromises = new Map();
export function ensureDashboardSectionStyles(section) {
  if (!['stationhead', 'subscriptions'].includes(section)) return Promise.resolve();
  if (stylePromises.has(section)) return stylePromises.get(section);
  const promise = new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `/assets/${section}.min.css?v=${ASSET_VERSION}`;
    link.dataset.dashboardSectionStyle = section;
    link.addEventListener('load', resolve, { once: true });
    link.addEventListener('error', () => {
      link.remove();
      reject(new Error(`stylesheet failed: ${section}`));
    }, { once: true });
    document.head.append(link);
  }).catch((error) => { stylePromises.delete(section); throw error; });
  stylePromises.set(section, promise);
  return promise;
}
