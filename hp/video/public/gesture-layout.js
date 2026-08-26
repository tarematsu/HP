const MAX_FULL_SPAN_SEEK_SECONDS = 120;

export function landscapeFromRotationAngle(value) {
  const angle = Number(value);
  if (!Number.isFinite(angle)) return null;
  const normalized = ((angle % 360) + 360) % 360;
  if (normalized === 90 || normalized === 270) return true;
  if (normalized === 0 || normalized === 180) return false;
  return null;
}

function nativeLandscapeLayout() {
  try {
    const bridge = globalThis.VideoPlayerNative;
    if (!bridge) return null;
    const value = bridge.isLandscape();
    if (value === true || value === 'true' || value === 1 || value === '1') return true;
    if (value === false || value === 'false' || value === 0 || value === '0') return false;
  } catch {}
  return null;
}

function currentRotationLandscape() {
  // Android WebView can keep viewport/screen.orientation.type stale across a
  // configuration change. The legacy window.orientation angle tracks the
  // physical display rotation more reliably on those WebView versions.
  const legacy = landscapeFromRotationAngle(globalThis.orientation);
  if (legacy !== null) return legacy;
  return landscapeFromRotationAngle(globalThis.screen?.orientation?.angle);
}

export function isLandscapeLayout(
  width,
  height,
  orientationType = '',
  nativeLandscape = null,
  rotationLandscape = null
) {
  // Rotation angle is the closest signal to the phone's actual rotation and
  // must win over stale WebView/native layout metadata.
  if (rotationLandscape === true || rotationLandscape === false) return rotationLandscape;

  if (nativeLandscape === true || nativeLandscape === false) return nativeLandscape;

  const type = String(orientationType || '').toLowerCase();
  if (type.startsWith('landscape')) return true;
  if (type.startsWith('portrait')) return false;

  const viewportWidth = Number(width);
  const viewportHeight = Number(height);
  const hasUsableViewport = Number.isFinite(viewportWidth)
    && Number.isFinite(viewportHeight)
    && viewportWidth > 0
    && viewportHeight > 0;
  return hasUsableViewport ? viewportWidth > viewportHeight : false;
}

export function currentLandscapeLayout() {
  if (typeof window === 'undefined') return false;
  const viewport = globalThis.visualViewport;
  const layoutWidth = Number(window.innerWidth) > 0
    ? window.innerWidth
    : viewport?.width;
  const layoutHeight = Number(window.innerHeight) > 0
    ? window.innerHeight
    : viewport?.height;
  return isLandscapeLayout(
    layoutWidth,
    layoutHeight,
    globalThis.screen?.orientation?.type || '',
    nativeLandscapeLayout(),
    currentRotationLandscape()
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
