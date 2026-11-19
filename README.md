# FCCTV by Get Down Foundation

Turns HeyCyan HQ508C smart glasses (hardware A02HQ_V1.2) into a wearable CCTV camera.
A worker wears the glasses; a phone in their pocket relays the live view to the owner.

```
Glasses ──Bluetooth (control) + Wi-Fi Direct (RTSP video)──▶ Worker phone (FCCTV app) ──mobile data──▶ Backend ──▶ Admin dashboard / owner's phone
```

| Folder | What |
|---|---|
| `android/` | FCCTV Worker app (Kotlin, Jetpack Compose), package `com.getdown.fcctv` |
| `dashboard/` | Admin dashboard (Next.js on Vercel) — Phase 2 |
| `.github/workflows/` | Builds a signed release APK on every push to `main` and attaches it to a GitHub Release |

## Status

- **Phase 1 (this build):** pick glasses → Start → Bluetooth live-preview command → Wi-Fi Direct (phone is group owner) →
  RTSP H.264 decoded to JPEG at ~2 fps → live preview in the app, glasses battery, "LIVE" indicator,
  foreground service with a persistent notification, auto-retry, worker consent screen, local MJPEG at
  `http://127.0.0.1:8080/mjpeg`.
- Phase 2: upload frames to the backend + live dashboard. Phase 3: working hours, snapshot history, clip fallback.
  Phase 3.5: Gemini rules/alerts/summaries. Phase 4: polish, many workers.

## Brand palette (only these four colours)

| Colour | Hex | Use |
|---|---|---|
| Leafy green | `#A5E420` (dark tone `#4E7A0E`) | Primary buttons, LIVE indicator |
| Muddy brown | `#8A4B22` (dark tone `#5C3216`) | Headers, accents, warnings |
| White | `#FFFFFF` | Light backgrounds |
| Black | `#111111` | Text, dark mode background |

Android: `android/app/src/main/res/values/colors.xml` + `ui/Theme.kt`.

## Credits and licence

- Live-preview pipeline (BLE command `02 01 14 01`, phone-as-group-owner Wi-Fi Direct, RTSP/RTCP keep-alives,
  H.264 depacketising, MJPEG server) is adapted from
  [jacob-kruger-work/heycyan_live_stream](https://github.com/jacob-kruger-work/heycyan_live_stream) — **GPL-3.0**.
  Because of that, this repository is licensed **GPL-3.0** (see `LICENSE`).
- Glasses SDK `glasses_sdk_20250723_v01.aar` from [ebowwa/HeyCyanSmartGlassesSDK](https://github.com/ebowwa/HeyCyanSmartGlassesSDK).
- Bluetooth event codes from the CyanBridge project (Apache-2.0), via Getdown Glass.
