import { mountStationheadChannelShell } from './stationhead-channel-shell.js?v=20261004.2';
import { bindStationheadHistoryGranularity } from './stationhead-history-granularity.js?v=20261005.1';

const view = mountStationheadChannelShell({
  id: 'hinataView',
  anchorIds: ['historyView', 'currentView'],
});

if (view) {
  view.dataset.stationheadModel = 'ohisama';
  bindStationheadHistoryGranularity(view);
}
