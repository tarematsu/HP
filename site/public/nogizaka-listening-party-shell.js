import { mountStationheadChannelShell } from './stationhead-channel-shell.js?v=20261004.2';

const view = mountStationheadChannelShell({
  id: 'nogizakaListeningPartyView',
  anchorIds: ['likesView', 'hinataView', 'currentView'],
});

if (view) view.dataset.stationheadModel = 'nogizaka';
