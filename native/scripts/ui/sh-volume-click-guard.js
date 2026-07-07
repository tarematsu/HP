(() => {
  'use strict';

  document.addEventListener('click', event => {
    const slider = event.target.closest?.('.stationhead-volume-slider[data-action]');
    if (!slider) return;
    // The dedicated spotify-panel-runtime input/change handlers send the slider value.
    // Stop the generic [data-action] click handler from sending a value-less volume action,
    // which native interprets as the default 100% volume.
    event.stopPropagation();
  }, true);
})();
