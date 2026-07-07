# HomePanel UI assets

Dashboard browser UI files live under `native/scripts/ui/` and should be edited directly. The native app embeds those files as one-to-one resources and installs them into the runtime `ui/` folder without JavaScript bundling, HTML patching, or runtime string replacement.

## Edit flow

When adding a browser-loaded UI file:

1. Add the source file under `native/scripts/ui/`.
2. Add an `RCDATA` entry in `native/resources/HomePanel.rc.in`.
3. Add the same resource ID and output filename to `kUiAssets` in `native/src/embedded_ui.cpp`.
4. Reference the file from `index.html` if the browser needs to load it.

## Generated exceptions

Only keep generation for data that cannot be represented as checked-in source:

- `wallpaper.css`: written at runtime because it depends on the current Windows wallpaper and screen size.
- Radar base PNG files: produced during native configure from `scripts/build_radar_base.ps1`.
- Stationhead native compatibility sources: still produced during native configure; consolidate these separately before removing that generator chain.
