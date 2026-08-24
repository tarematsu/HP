# Original APK reference

Reference APK supplied on 2026-08-24: `VideoPlayer-personal-v1.6.0.apk`.

- APK SHA-256: `c181dc7b3a3873f562c2a191bb34be75513b8c63d7ec735c104c0893d82473d1`
- package: `com.tarematsu.videoscraper`
- version code/name: `7` / `1.6.0`
- compile SDK reported by APK: `33`
- min SDK: `28`
- target SDK: `34`
- theme resource `0x0103022e`: `Theme.Material.NoActionBar`
- cleartext HTTP: disabled
- fingerprint feature: optional
- Activity orientation: `fullSensor`
- config changes: keyboardHidden, orientation, uiMode, screenSize, smallestScreenSize

DEX inspection shows the original Activity used `WebView`, `BiometricPrompt`, `CookieManager`, fullscreen custom views, safe browsing, HTTPS URL validation, `videoscraper_app` SharedPreferences with key `base_url`, and placeholder URL `https://example.workers.dev`.

Original signing certificate SHA-256: `08:5E:90:9E:3A:B0:76:A2:43:4F:CA:49:B0:13:62:7C:69:BF:EA:50:D0:5A:D9:3E:28:83:B5:8D:2C:BE:CF:EE`.

Only the public certificate is present in the APK. The private signing key/keystore cannot be reconstructed and must remain external to the repository.
