const MAX_FULL_SPAN_SEEK_SECONDS = 120;

export function isLandscapeLayout(width, height, orientationType = '') {
  const viewportWidth = Number(width);
  const viewportHeight = Number(height);
  const hasUsableViewport = Number.isFinite(viewportWidth)
    && Number.isFinite(viewportHeight)
    && viewportWidth > 0
    && viewportHeight > 0
    && viewportWidth !== viewportHeight;

  // Mobile browsers can briefly keep screen.orientation.type stale after a
  // rotation. The actual viewport is therefore the source of truth whenever
  // it has a clear aspect ratio.
  if (hasUsableViewport) return viewportWidth > viewportHeight;

  const type = String(orientationType || '').toLowerCase();
  if (type.startsWith('landscape')) return true;
  if (type.startsWith('portrait')) return false;
  return viewportWidth > viewportHeight;
}

export function currentLandscapeLayout() {
  if (typeof window === 'undefined') return false;
  const viewport = globalThis.visualViewport;
  return isLandscapeLayout(
    viewport?.width ?? window.innerWidth,
    viewport?.height ?? window.innerHeight,
    globalThis.screen?.orientation?.type || ''
  );
}

export function gestureAxes(landscape) {
  return landscape
    ? { nextAxis: 'x', seekAxis: 'y' }
    : { nextAxis: 'y', seekAxis: 'x' };
}

export function gestureAxisDelta(axis, startX, startY, currentX, currentY) {
  return axis === 'x'
    ? Number(currentX) - Number(startX)
    : Number(currentY) - Number(startY);
}

export function seekGestureDeltaSeconds(
  deltaX,
  deltaY,
  viewportWidth,
  viewportHeight,
  duration,
  landscape
) {
  const mediaDuration = Number(duration);
  if (!Number.isFinite(mediaDuration) || mediaDuration <= 0) return 0;

  const delta = landscape ? Number(deltaY) || 0 : Number(deltaX) || 0;
  const span = Math.max(1, landscape
    ? Number(viewportHeight) || 1
    : Number(viewportWidth) || 1);
  return delta / span * Math.min(mediaDuration, MAX_FULL_SPAN_SEEK_SECONDS);
}

export function transitionTransform(landscape, direction, incoming) {
  const axis = landscape ? 'X' : 'Y';
  const positive = Number(direction) < 0 ? incoming : !incoming;
  return `translate${axis}(${positive ? '110%' : '-110%'})`;
}

export function hiddenTransform(landscape) {
  return `translate${landscape ? 'X' : 'Y'}(110%)`;
}
