# Direct native source build

The native build now compiles checked-in `app.cpp` and `secondary_spotify_api.cpp` directly.

The remaining Stationhead generation step is limited to producing MSVC-safe generated copies for Stationhead sources with oversized raw string literals and include rewrites for those generated copies.

Do not add build-time source patching back for application behavior changes. Edit the checked-in source files instead.
