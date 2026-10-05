const modulePromises = new Map();

export function loadDashboardModuleOnce(key, importer) {
  if (!modulePromises.has(key)) {
    const promise = Promise.resolve().then(importer).catch((error) => {
      modulePromises.delete(key);
      throw error;
    });
    modulePromises.set(key, promise);
  }
  return modulePromises.get(key);
}

export function showDashboardRuntimeError(config, error) {
  console.error(`${config.errorLabel || 'dashboard'} runtime failed to start`, error);
  const notice = config.noticeId ? document.getElementById(config.noticeId) : null;
  if (notice) {
    notice.textContent = config.errorMessage || '画面の初期化に失敗しました。再読み込みしてください。';
    notice.classList.add('error');
    notice.hidden = false;
    return;
  }
  document.getElementById('routeError')?.remove();
  const node = document.createElement('p');
  node.id = 'routeError';
  node.className = 'notice error';
  node.setAttribute('role', 'alert');
  node.textContent = config.errorMessage || '画面の初期化に失敗しました。再読み込みしてください。';
  document.querySelector('.dashboard-header')?.after(node);
}
