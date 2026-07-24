(() => {
  const finish = () => document.body.classList.remove('is-auth-pending');
  let stored = false;
  try {
    stored = Boolean(
      localStorage.getItem('video-scraper-admin-token')
      || document.cookie.split(';').some((part) => part.trim().startsWith('video_scraper_admin_token='))
    );
  } catch {}

  if (!stored) {
    finish();
    return;
  }

  window.addEventListener('videoscraper:admin-token-change', finish, { once: true });
  window.setTimeout(finish, 5000);
})();
