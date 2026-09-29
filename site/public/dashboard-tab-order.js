const tabs = document.getElementById('modeTabs');
const firstWeek = tabs?.querySelector('[data-view="first-week"]');
const spotify = tabs?.querySelector('[data-view="spotify"]');

if (tabs && firstWeek) tabs.append(firstWeek);
if (tabs && spotify) tabs.append(spotify);
