# Markdown Pattern Studio Preview Extension

This extension runs the repository CLI (`scripts/md-to-html.mjs`) and opens the rendered HTML in a VS Code webview.

## Features

- `Markdown Studio: Open Preview` command
- `Markdown Studio: Refresh Preview` command
- `MD Studio: Transform Markdown to Styled HTML` command (export the currently open `.md` to styled `.html`)
- Auto refresh on markdown save (`mdStudioPreview.autoOnSave`)
- Outline collapsed/expanded state is remembered per document
- File URI rewrite (`file://...`) to webview-safe resource URIs
- **Preview works outside the current workspace** — any `.md` file can be previewed using the bundled CLI
- **Responsive layout** — slide scale and outline panel adapt to the webview panel width

## Settings

- `mdStudioPreview.autoOnSave` (default: `true`)
- `mdStudioPreview.cursorSyncOnSave` (default: `true`)
- `mdStudioPreview.nodePath` (default: `"node"`)
- `mdStudioPreview.cliScriptPath` (default: `"scripts/md-to-html.mjs"`)
- `mdStudioPreview.preferredViewMode` (default: `"stack"`, values: `"auto" | "slides" | "stack"`)
- `mdStudioPreview.extraArgs` (default: `["--standalone"]`)

Default behavior:

1. Try `mdStudioPreview.cliScriptPath` in current workspace context.
2. If the setting is default (`scripts/md-to-html.mjs`) and missing, automatically fallback to bundled CLI inside the extension.
3. If still missing, show `Select Script` picker and save selected path to user settings.
4. If `mdStudioPreview.cliScriptPath` is explicitly customized, that path is prioritized (no automatic bundled fallback override).
5. **Outside workspace**: bundled CLI is used automatically. Set `mdStudioPreview.cliScriptPath` to an absolute path to override.
6. View mode: default `preferredViewMode=stack` matches the web editor, and `auto` switches to Stack on narrow webview panels.
7. Slide scale is calculated from the actual outline panel width, so it no longer clips on narrow panels.
8. Outline panel remembers the last collapsed/expanded state for each markdown document.
9. Cursor-sync parser also falls back to bundled `public/core/engine.js` when workspace parser is missing.

## Cursor Sync on Save

When `mdStudioPreview.cursorSyncOnSave` is enabled, pressing `Ctrl+S` will:

1. Render markdown via CLI
2. Resolve current cursor section
3. Move preview to that section (outline-first navigation)

For full operations and troubleshooting, see `EXTENSION_GUIDE.md` in this folder.

## Development

```bash
npm install
npm run build
```

## Package VSIX

```bash
npm run package:vsix
```

Then install:

```bash
code --install-extension .\markdown-pattern-studio-preview-0.1.6.vsix
```
