# Markdown Pattern Studio Preview Extension

This extension runs the repository CLI (`scripts/md-to-html.mjs`) and opens the rendered HTML in a VS Code webview.

## Features

- `Markdown Studio: Open Preview` command
- `Markdown Studio: Refresh Preview` command
- Auto refresh on markdown save (`mdStudioPreview.autoOnSave`)
- File URI rewrite (`file://...`) to webview-safe resource URIs

## Settings

- `mdStudioPreview.autoOnSave` (default: `true`)
- `mdStudioPreview.cursorSyncOnSave` (default: `true`)
- `mdStudioPreview.nodePath` (default: `"node"`)
- `mdStudioPreview.cliScriptPath` (default: `"scripts/md-to-html.mjs"`)
- `mdStudioPreview.preferredViewMode` (default: `"auto"`, values: `"auto" | "slides" | "stack"`)
- `mdStudioPreview.extraArgs` (default: `["--standalone"]`)

Default behavior:

1. Try `mdStudioPreview.cliScriptPath` in current workspace context.
2. If the setting is default (`scripts/md-to-html.mjs`) and missing, automatically fallback to bundled CLI inside the extension.
3. If still missing, show `Select Script` picker and save selected path to user settings.
4. If `mdStudioPreview.cliScriptPath` is explicitly customized, that path is prioritized (no automatic bundled fallback override).
5. View mode: `preferredViewMode=auto` switches to Stack on narrow webview panels to avoid tiny slide scaling.

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
code --install-extension .\markdown-pattern-studio-preview-0.1.2.vsix
```
