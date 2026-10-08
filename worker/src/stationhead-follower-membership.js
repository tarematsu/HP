export const STATIONHEAD_FOLLOWER_SOURCE = Object.freeze({
  fixed: 1,
  buddies: 2,
  ohisama: 4,
  nogizaka: 8,
});

function normalizedHandle(value) {
  return String(value || '').trim().toLowerCase();
}

export function stationheadFollowerMembership(handleValue, sourceMaskValue = 0) {
  const handle = normalizedHandle(handleValue);
  const sourceMask = Number(sourceMaskValue || 0);
  if (handle === 'sakurazaka46jp') return { affiliation: '櫻坂46公式', group: 'sakurazaka46' };
  if (handle === 'nogizaka46smej') return { affiliation: '乃木坂46公式', group: 'nogizaka46' };
  if (handle === 'nogifan1ch') return { affiliation: 'Nogizaka', group: 'nogizaka46' };
  if (handle === 'sakuramankai' || handle === 'sakuramankai2') {
    return { affiliation: 'Buddies', group: 'sakurazaka46' };
  }
  if (sourceMask & STATIONHEAD_FOLLOWER_SOURCE.buddies) {
    return { affiliation: 'Buddies', group: 'sakurazaka46' };
  }
  if (sourceMask & STATIONHEAD_FOLLOWER_SOURCE.ohisama) {
    return { affiliation: 'Ohisama', group: 'hinatazaka46' };
  }
  if (sourceMask & STATIONHEAD_FOLLOWER_SOURCE.nogizaka) {
    return { affiliation: 'Nogizaka', group: 'nogizaka46' };
  }
  return null;
}
