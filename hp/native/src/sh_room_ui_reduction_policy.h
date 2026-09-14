#pragma once

namespace hp {

// Static room-only UI reduction derived from the live Stationhead DOM audit.
// The audited room uses stable class/ARIA contracts for action rows, chat,
// listener controls and the mini-player. Injecting one stylesheet lets the
// browser match both existing and later SPA nodes without JS polling, text
// scans, geometry reads, MutationObserver, or recurring timers.
inline std::wstring StationheadRoomUiReductionScript() {
  static constexpr wchar_t kScript[] = LR"JS(
(() => {
  const host = String(location.hostname || '').toLowerCase();
  if (host !== 'stationhead.com' && !host.endsWith('.stationhead.com')) return;

  const path = String(location.pathname || '/').replace(/\/+$/, '') || '/';
  const parts = path.split('/').filter(Boolean);
  if (parts.length !== 1) return true;
  const reserved = new Set([
    'home', 'sign-in', 'sign-up', 'search', 'discover', 'settings',
    'profile', 'account', 'terms', 'privacy', 'api'
  ]);
  if (reserved.has(parts[0].toLowerCase())) return true;

  const styleId = '__homepanelStationheadRoomUiReduction';
  const install = () => {
    if (document.getElementById(styleId)) return true;
    const root = document.head || document.documentElement;
    if (!root) return false;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      /* Audited room action rows: Follow/Threads/Request/Ask/Share/App/Access. */
      :is(a,button)[class~='button--full-width'][class~='button--md'][class~='h-12'][class~='justify-between'],
      a[aria-label='Open threads'],
      a[href$='/threads'],

      /* Audited host/profile and listener-count presentation controls. */
      button[class~='w-full'][class~='cursor-pointer'][class~='flex-col'][class~='items-center'][class~='gap-1.5'],
      button[class~='h-6'][class~='shrink-0'][class~='rounded-xl'][class~='border-borderRoom'][class~='caption-2-semibold'],

      /* Audited streaming-party presentation card controls. */
      button[aria-label='View streaming party details'],
      button[aria-label='Copy link'],

      /* Audited chat message/composer contracts. */
      [aria-label^='View '],
      button[aria-label^='Reply to '],
      textarea[class~='min-w-0'][class~='flex-1'][class~='resize-none'][class~='bg-transparent'],
      button[aria-label='Add a GIF'],
      button[aria-label*='react' i],
      aside:has(textarea[class~='min-w-0'][class~='flex-1'][class~='resize-none'][class~='bg-transparent']),
      [role='complementary']:has(textarea[class~='min-w-0'][class~='flex-1'][class~='resize-none'][class~='bg-transparent']),

      /* Audited room mini-player controls; footer is room-only here. */
      footer,
      button[aria-label='Toggle Mute'],
      [aria-label='Volume'],
      input[type='range'] {
        display: none !important;
        visibility: hidden !important;
        pointer-events: none !important;
        content-visibility: hidden !important;
      }
    `;
    root.appendChild(style);
    return true;
  };

  if (!install()) {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  }
  return true;
})()
)JS";
  return kScript;
}

}  // namespace hp
