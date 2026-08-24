# VideoPlayer Personal (Android)

Reconstructed source project for `VideoPlayer-personal-v1.6.0.apk` so future APK changes can be built from this repository.

## Preserved identity

- application ID: `com.tarematsu.videoscraper`
- version code: `7`
- version name: `1.6.0`
- min SDK: `28`
- target SDK: `34`
- launcher label: `VideoPlayer`
- orientation: `fullSensor`
- original 512x512 launcher icon

The original APK reports compile SDK 33 while targeting API 34. This normal Gradle reconstruction compiles against SDK 35 and keeps target SDK 34.

## Behavior

The Android layer is a single authenticated WebView shell. It keeps the observed biometric/device authentication gate, configurable HTTPS base URL (`videoscraper_app/base_url`), same-host navigation restriction, cookies, autoplay, fullscreen custom video view, immersive UI, renderer recovery, and restrictive file/mixed-content settings.

Video gestures and playback UI are provided by the remote HomePanel video runtime under `hp/video/`. Changes such as double-tap seek behavior normally belong there rather than in the APK shell.

## Build

Requirements: JDK 17, Android SDK 35, Gradle 8.9.

```sh
gradle :app:assembleDebug
```

Output: `app/build/outputs/apk/debug/app-debug.apk`.

Release signing is intentionally not committed. Updating an already-installed original APK requires the original private signing keystore; the private key cannot be recovered from the APK itself.
