const stylePromises = new Map();

function assetVersionQuery() {
  const href = document.querySelector('link[href*="/assets/dashboard.min.css"]')?.href;
  if (!href) return '';
  try {
    const version = new URL(href, location.href).searchParams.get('v');
    return version ? `?v=${encodeURIComponent(version)}` : '';
  } catch {
    return '';
  }
}

export function ensureDashboardSectionStyles(section) {
  if (!['stationhead', 'subscriptions'].includes(section)) return Promise.resolve();
  if (stylePromises.has(section)) return stylePromises.get(section);
  const promise = new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `/assets/${section}.min.css${assetVersionQuery()}`;
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
