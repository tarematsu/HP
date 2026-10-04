import { mountStationheadChannelShell } from './stationhead-channel-shell.js?v=20261004.2';

const view = mountStationheadChannelShell({
  id: 'currentView',
  hidden: false,
});

if (view) view.dataset.stationheadModel = 'buddies';
