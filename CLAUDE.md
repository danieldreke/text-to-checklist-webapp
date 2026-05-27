# CLAUDE.md

## Project

Turn text into an interactive checklist. Supports multiple named lists, drag & drop reordering, QR code sharing, undo/redo, and offline use as a PWA.

Vanilla JS/HTML/CSS — no framework, no server. Everything runs client-side. `build.js` inlines all source files into a single `index.html` for deployment. Separate source files are fine.

## Build

`node build.js` — inlines CSS, JS, and QR lib into `index.html` → `dist/`. GitHub Actions deploys `dist/` to GitHub Pages on push to main.

Dev server: open `index.html` directly or use VS Code Live Server (port 5500).

## Service worker

Cache version is in `serviceworker.js` line 1 (`text-to-checklist-vN`). It must be bumped manually whenever tracked assets change — do **not** bump it unless asked.

## Style rules

- No framework — keep it that way. Ask before adding npm packages or third-party libraries.
- No comments unless the *why* is non-obvious.
- Do not rename labels or reword UI text beyond what was explicitly asked.
- UI text and labels are deliberately terse — do not suggest verbose alternatives unprompted.
