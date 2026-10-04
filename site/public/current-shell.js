import { mountStationheadChannelShell } from './stationhead-channel-shell.js?v=20261004.2';
import { bindStationheadHistoryGranularity } from './stationhead-history-granularity.js?v=20261005.1';

const view = mountStationheadChannelShell({
  id: 'currentView',
  hidden: false,
});

if (view) {
  view.dataset.stationheadModel = 'buddies';
  bindStationheadHistoryGranularity(view);
}
