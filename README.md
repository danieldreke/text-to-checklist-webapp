# Text to checklist - Webapp

![Claude](https://img.shields.io/badge/Built_With-Claude-D97757?style=flat&logo=claude&logoColor=D97757)

Turn text into an interactive checklist. Copy  checklist to another device via QR code.

## Features

- Turn any text into a checklist with one click
- Check/Uncheck items and reorder via drag & drop
- Copy checklist to another device via QR code
- Add, edit and remove items
- Undo / Redo buttons and support for `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y`
- Copy the list as plain text (`[ ] unchecked` / `[x] checked` format)
- Hide/show checked items and hide/show text input panel

## Persisted state

The following keys are stored in `localStorage`:

- `theme` — `"light"` or `"dark"`
- `editorHidden` — `"0"` or `"1"`
- `checkedHidden` — `"0"` or `"1"`

## Data format

Lists serialize to one item per line in the form:

```
[ ] open item
[x] checked item
```

Creating a checklist from pasted text recognizes this prefix so a copied list can be pasted back and re-created with the same checked state.
