# Text to checklist - Webapp

![Claude](https://img.shields.io/badge/Built_With-Claude-D97757?style=flat&logo=claude&logoColor=D97757) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Turn text into an interactive checklist. Copy checklist to another device via QR code.

Open [Text to checklist](https://danieldreke.github.io/text-to-checklist-webapp/)

## Features

- Turn any text into a checklist with one click
- Check/Uncheck items and reorder via drag & drop
- Copy checklist to another device via QR code
- Add, edit and remove items
- Undo / Redo buttons and support for `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y`
- Copy the list as plain text
- Hide/show checked items
- Sort items A–Z
- Installable as a PWA — works offline

## Text format

By default, serialized text uses plain lines for unchecked items and `[x]` for checked:

```
unchecked item
[x] checked item
```

Use **Toggle [ ]** (in the ⋯ menu, text view) to add `[ ]` prefixes to all unchecked items:

```
[ ] unchecked item
[x] checked item
```

Both formats are recognized when pasting back, so checked state is preserved on round-trip.

## Persisted state

The following keys are stored in `localStorage`:

- `theme` — `"light"` or `"dark"`
- `currentView` — `"text"` or `"checklist"`
- `checkedHidden` — `"0"` or `"1"`
- `checklist-items` — JSON array of the current list items
