---
name: verify
description: Build, launch and drive the All You Can Seal web app (web/) in headless Edge to verify UI/engine changes end-to-end.
---

# Verifying the web app

## Build & serve
```powershell
Set-Location web
npm test            # vitest (engine unit tests)
npm run build       # tsc --noEmit && vite build -> web/dist
npm run preview -- --port 4199 --strictPort   # serves dist (run in background)
```

## Drive with playwright-core + system Edge
No Playwright browsers are installed; use the system Edge binary:
`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`

playwright-core is NOT a project dep. Install it once in a temp dir and run
scripts from there (Node resolves modules from the script's directory):
```powershell
Set-Location $env:TEMP\pw-verify   # create if missing; npm i playwright-core
node your-script.mjs
```
Launch: `chromium.launch({ executablePath: '<edge path>', headless: true })`.

## Useful fixtures & flows
- `web/tests/fixtures/clean.gcode` — clean A1 mini file (bare .gcode path).
- `test1.gcode.3mf` (repo root) — real 3mf processed by the legacy Python
  script; deliberate NEGATIVE fixture (corrupt concatenated lines, no
  processing marker). Its checks intentionally fail on the Convert tab.
- Convert flow: upload into `.dropzone-wrap input[type=file]`, wait for
  `.columns`; "Download after.gcode" button yields the sealed output
  (capture with page.waitForEvent('download')).
- Validate tab: button name /Validate|校验/ (UI language auto-detects zh on
  this machine); upload into `.validator-wrap input[type=file]`, results in
  `.vtable`, marker status in `.marker-box`.
- Watch `page.on('pageerror')` — the app has no error overlay in preview.
