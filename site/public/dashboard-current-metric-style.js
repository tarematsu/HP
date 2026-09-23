(() => {
  const STYLE_ID = 'current-metric-value-consistency';
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #currentView .metrics #online,
    #currentView .metrics #members,
    #currentView .metrics #totalStreams {
      font-size: clamp(1.75rem, 5.8vw, 2.5rem) !important;
      line-height: .95 !important;
      letter-spacing: -.045em !important;
    }

    @media (max-width: 760px) {
      #currentView .metrics #online,
      #currentView .metrics #members,
      #currentView .metrics #totalStreams {
        font-size: clamp(1rem, 5vw, 1.4rem) !important;
        line-height: 1 !important;
        letter-spacing: -.055em !important;
      }
    }
  `;
  document.head.append(style);
})();
