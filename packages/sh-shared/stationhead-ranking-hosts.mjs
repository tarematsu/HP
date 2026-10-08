export const STATIONHEAD_CHANNEL_BY_HOST = new Map([
  ['sakuramankai', 'Buddies'],
  ['sakurazaka46jp', '櫻坂46'],
  ['nogizaka46smej', '乃木坂46'],
  ['nogifan1ch', 'Nogizaka'],
  ['sbuddies1819', 'ATIN'],
  ['jo1andjam', 'JAM'],
  ['vote6tones', 'team SixTONES'],
  ['befirst', 'BESTY'],
  ['straykids', 'STAYS'],
  ['k_p_official', 'Tiara'],
  ['rosehq', 'numberoneHQ'],
]);

export function stationheadRankingHostKey(value) {
  return String(value || '').trim().toLowerCase();
}

export function stationheadChannelNameForHost(value) {
  return STATIONHEAD_CHANNEL_BY_HOST.get(stationheadRankingHostKey(value)) || null;
}
