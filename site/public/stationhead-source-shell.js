// Buddies is the canonical Stationhead layout. Source adapters only choose
// the model, the view id and where its identical panel subtree is mounted.
import { mountStationheadChannelShell } from './stationhead-channel-shell.js?v=20261005.4';
import { bindStationheadHistoryGranularity } from './stationhead-history-granularity.js?v=20261005.1';

export const STATIONHEAD_SOURCE_VIEWS = Object.freeze({
  buddies: Object.freeze({
    viewId: 'currentView',
    model: 'buddies',
    hidden: false,
    anchorIds: [],
    history: true,
  }),
  ohisama: Object.freeze({
    viewId: 'hinataView',
    model: 'ohisama',
    anchorIds: ['historyView', 'currentView'],
    history: true,
  }),
  nogizaka: Object.freeze({
    viewId: 'nogizakaListeningPartyView',
    model: 'nogizaka',
    anchorIds: ['likesView', 'hinataView', 'currentView'],
    history: false,
  }),
});

export function mountStationheadSourceShell(source) {
  const config = STATIONHEAD_SOURCE_VIEWS[source];
  if (!config) throw new Error(`Unknown Stationhead source: ${source}`);
  const view = mountStationheadChannelShell({
    id: config.viewId,
    hidden: config.hidden !== false,
    anchorIds: config.anchorIds,
    // Top-level source/function tabs own navigation, as on Buddies.
    showTabs: false,
  });
  if (!view) return null;
  view.dataset.stationheadModel = config.model;
  if (config.history) bindStationheadHistoryGranularity(view);
  return view;
}
