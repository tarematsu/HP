# HomePanel UI assets

Dashboard browser UI files live under `native/scripts/ui/` and should be edited directly. The native app embeds those files as one-to-one resources and installs them into the runtime `ui/` folder without JavaScript bundling, HTML patching, or runtime string replacement.

## Edit flow

When adding a browser-loaded UI file:

1. Add the source file under `native/scripts/ui/`.
2. Add an `RCDATA` entry in `native/resources/HomePanel.rc.in`.
3. Add the same resource ID and output filename to `kUiAssets` in `native/src/embedded_ui.cpp`.
4. Reference the file from `index.html` if the browser needs to load it.

## Runtime exception

Only keep runtime output for data that cannot exist as a checked-in static asset:

- `wallpaper.css`: written at runtime because it depends on the current Windows wallpaper and screen size.
- Wallpaper image derivatives: written at runtime next to `wallpaper.css` for the same reason.
