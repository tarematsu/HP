if (location.hash === '#unofficial') {
  history.replaceState(null, '', `${location.pathname}${location.search}#broadcasts`);
}
