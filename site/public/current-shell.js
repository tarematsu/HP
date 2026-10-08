import { mountStationheadChannelShell } from './stationhead-channel-shell.js?v=20261005.4';
import { bindStationheadHistoryGranularity } from './stationhead-history-granularity.js?v=20261005.1';

const view = mountStationheadChannelShell({
  id: 'currentView',
  hidden: false,
  showTabs: false,
});

if (view) {
  view.dataset.stationheadModel = 'buddies';
  bindStationheadHistoryGranularity(view);
}
