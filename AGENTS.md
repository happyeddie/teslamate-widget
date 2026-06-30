# AGENTS.md

## Project overview

This repository contains a single-file [Scriptable](https://scriptable.app/) JavaScript widget for iOS that displays Tesla vehicle status from a self-hosted TeslaMate/TeslaMateApi setup.

Primary files:

- `Telsa Car.js` — the Scriptable widget source. Keep the filename as-is unless the user explicitly asks to rename it; Scriptable users may already depend on this exact name.
- `README.md` — Chinese user-facing project documentation with screenshots and setup notes.
- `docs/` — screenshots used by the README.

## Runtime and dependencies

The widget is designed to run inside Scriptable, not Node.js or a browser. It depends on Scriptable globals and APIs such as `args`, `config`, `ListWidget`, `FileManager`, `Request`, `WebView`, `DrawContext`, `SFSymbol`, `Location`, `Script`, `Color`, `Font`, `Image`, `Data`, `Size`, `Rect`, `Point`, and `Path`.

External services used by the script:

- TeslaMateApi endpoint configured via `TESLA_MATE_API_URL`.
- TeslaMate web UI configured via `TESLA_MATE_URL`.
- AMap static map API configured via `AMAP_API_KEY`.
- Scriptable/iOS reverse geocoding via `Location.reverseGeocode`.

Do not add npm/package-manager assumptions unless the project is intentionally migrated to a different runtime.

## Development guidelines

- Preserve compatibility with Scriptable's JavaScript runtime. Avoid Node-only APIs, browser-only APIs, bundlers, imports, and module syntax unless the repo is intentionally restructured for that purpose.
- Do not wrap imports in `try`/`catch` blocks.
- Treat `Telsa Car.js` as user-editable Scriptable code. Keep configuration variables near the top of the file and avoid hiding required setup in generated files.
- Be careful with widget parameters: the current script uses comma-separated `args.widgetParameter` values and uses `params[0]` for both the dark-theme flag check and car ID fallback. If changing this behavior, document the migration clearly in `README.md`.
- Do not commit real API keys, TeslaMate URLs, VINs, coordinates, tokens, or other personal vehicle/location data. Use placeholders in examples.
- Keep README-facing text in Simplified Chinese unless the user asks for another language.
- Keep screenshots in `docs/` reasonably small and relevant to the README.

## Validation

There is currently no automated test suite or package manifest in this repository. For changes to `Telsa Car.js`, perform these checks when possible:

- Manual validation in the Scriptable app is the authoritative check for widget rendering, TeslaMateApi connectivity, map/geocoding behavior, and accessory-widget behavior.
- Plain `node --check "Telsa Car.js"` is expected to fail because this Scriptable script uses top-level `await` and `return` in ways Node's CommonJS syntax checker does not accept. If you add a dedicated lint/test harness later, document it here.

If you make a visible change to the widget UI, capture or update a screenshot when the environment makes that possible. In this headless repo environment, note when Scriptable-only manual validation cannot be performed.

## Git and PR notes for agents

- Check `git status --short --branch` before and after editing.
- Avoid broad repository scans with `ls -R` or `grep -R`; use `rg`, `find`, or targeted commands instead.
- Keep commits focused and include a concise commit message describing the user-visible change.
