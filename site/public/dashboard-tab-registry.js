const tabs = document.getElementById('modeTabs');
if (tabs) {
  // Stationhead channel subtabs are owned exclusively by stationhead-channel-shell.js.
  // Keep this legacy host empty so Buddies, Ohisama and Nogizaka all render the
  // exact same subtree below the source selector.
  tabs.replaceChildren();
  tabs.hidden = true;
  tabs.setAttribute('aria-hidden', 'true');
}
