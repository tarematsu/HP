import { mountStationheadChannelShell } from './stationhead-channel-shell.js?v=20261004.2';

const view = mountStationheadChannelShell({
  id: 'hinataView',
  anchorIds: ['historyView', 'currentView'],
});

if (view) view.dataset.stationheadModel = 'ohisama';
