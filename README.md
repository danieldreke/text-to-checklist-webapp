# Text to checklist - Webapp

![Claude](https://img.shields.io/badge/Built_With-Claude-D97757?style=flat&logo=claude&logoColor=D97757) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Turn text into an interactive checklist. Copy checklist to another device via QR code.

Open [Text to checklist](https://danieldreke.github.io/text-to-checklist-webapp/)

## Features

- Turn any text into a checklist with one click
- Check/Uncheck items and reorder via drag & drop
- Copy checklist to another device via QR code
- Add, edit and remove items
- Multiple named lists — create, rename, delete, reorder, and move items between lists
- Undo / Redo buttons and support for `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y`
- Copy the current list or all lists as plain text
- Import lists from clipboard
- Hide/show checked items
- Clear all checked items
- Sort items A–Z / Z–A
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
- `checklist-lists` — JSON array of all lists with their items and checked state
- `checklist-active` — ID of the currently active list
- `checklist-add-row` — insert position for new items (null = append)
- `addItemAbove` — `"0"` or `"1"` — whether new items are added above or below the add row
