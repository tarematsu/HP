const SPOTIFY_MODE = 'spotify';
const spotifyView = document.getElementById('spotifyView');
const tabs = document.getElementById('modeTabs');
let runtimePromise = null;

function updateTabState(selected) {
  tabs?.querySelectorAll('button').forEach((button) => {
    const active = button.dataset.view === selected;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else if (selected === SPOTIFY_MODE || button.dataset.view === SPOTIFY_MODE) button.removeAttribute('aria-current');
  });
}

function hideSpotify() {
  if (spotifyView) spotifyView.hidden = true;
}

function showOnlySpotify() {
  document.querySelectorAll('.dashboard-view').forEach((view) => {
    view.hidden = view !== spotifyView;
  });
}

async function loadRuntime() {
  if (!runtimePromise) {
    runtimePromise = import('/spotify.js?v=20260927.2').catch((error) => {
      runtimePromise = null;
      throw error;
    });
  }
  return runtimePromise;
}

async function showSpotify({ updateUrl = true, replaceUrl = false } = {}) {
  if (!spotifyView) return;
  showOnlySpotify();
  updateTabState(SPOTIFY_MODE);
  if (updateUrl) {
    const target = '/#spotify';
    const current = `${location.pathname}${location.search}${location.hash}`;
    if (current !== target) history[replaceUrl ? 'replaceState' : 'pushState'](null, '', target);
  }
  try {
    const runtime = await loadRuntime();
    if (location.hash !== '#spotify' && updateUrl) return;
    await runtime.loadSpotifyView?.();
  } catch (error) {
    console.error('spotify runtime failed to start', error);
    const notice = document.getElementById('spotifyNotice');
    if (notice) {
      notice.textContent = 'Spotify再生数の初期化に失敗しました。再読み込みしてください。';
      notice.classList.add('error');
      notice.hidden = false;
    }
  }
}

function syncFromLocation() {
  if (location.hash === '#spotify') {
    void showSpotify({ updateUrl: false });
  } else {
    hideSpotify();
  }
}

tabs?.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button || !tabs.contains(button)) return;
  if (button.dataset.view === SPOTIFY_MODE) {
    event.preventDefault();
    void showSpotify();
    return;
  }
  hideSpotify();
}, { capture: true });

window.addEventListener('popstate', syncFromLocation);
window.addEventListener('hashchange', syncFromLocation);

if (location.hash === '#spotify') {
  void showSpotify({ updateUrl: false });
}
