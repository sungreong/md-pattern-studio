# Markdown Pattern Studio Extension Guide

This guide explains how to install, use, and troubleshoot the `markdown-pattern-studio-preview` extension.

## 1) Quick Start

### Package

```bash
cd vscode-extension
npm install
npm run build
npm run package:vsix
```

### Install

```bash
code --install-extension .\markdown-pattern-studio-preview-0.1.2.vsix --force
```

### Basic Usage

1. Open a `.md` file inside the workspace.
2. Run `Markdown Studio: Open Preview` from Command Palette (`Ctrl+Shift+P`).
3. Save the file (`Ctrl+S`) to auto-refresh preview.
4. Use `Markdown Studio: Refresh Preview` for manual force refresh.

## 2) Cursor Sync on Save (Ctrl+S)

When `mdStudioPreview.cursorSyncOnSave=true`, save triggers this sequence:

1. Render markdown through the CLI.
2. Read the active editor cursor line.
3. Parse sections with `parseMarkdownDocument` from `public/core/engine.js`.
4. Pick the last section whose line is less than or equal to cursor line.
5. Send a sync message to webview.
6. Webview uses outline-first navigation (`data-outline-id`) to move preview.

Notes:

- Sync is section-based (heading), not paragraph-exact.
- If no heading exists, render still runs and sync is skipped.
- If the active editor is not the saved markdown document, sync is skipped.

## 3) Settings

- `mdStudioPreview.autoOnSave`
  - Controls auto render on save.
  - Default: `true`
- `mdStudioPreview.cursorSyncOnSave`
  - Controls section sync after save render.
  - Default: `true`
- `mdStudioPreview.nodePath`
  - Node executable path used to run CLI.
  - Default: `"node"`
- `mdStudioPreview.cliScriptPath`
  - CLI script path.
  - Relative path: resolved from workspace root.
  - Absolute path: used as-is.
  - Default: `"scripts/md-to-html.mjs"`
- `mdStudioPreview.extraArgs`
  - Extra CLI arguments.
  - Default: `["--standalone"]`
- `mdStudioPreview.preferredViewMode`
  - Preview presentation mode.
  - `auto`: narrow webview에서는 stack로 자동 전환.
  - `slides`: 항상 slides 우선.
  - `stack`: 항상 stack 우선.
  - Default: `"auto"`

Recommended defaults:

- Standard writing flow: `autoOnSave=true`, `cursorSyncOnSave=true`
- If auto jumping feels distracting: `cursorSyncOnSave=false`

## 4) Runtime Flow

1. Extension receives `onDidSaveTextDocument`.
2. Resolves CLI path in this order:
   - `mdStudioPreview.cliScriptPath`
   - bundled CLI (`<extension>/scripts/md-to-html.mjs`) only when the setting is default and missing
   - manual picker (`Select Script`) as final fallback
3. Rewrites `file://` asset URLs with `webview.asWebviewUri(...)`.
4. Injects rendered HTML into webview.
5. Optionally sends cursor-section sync message.

## 5) Troubleshooting

### Preview does not open

- Confirm the file is a markdown file in the current workspace.
- Confirm `mdStudioPreview.cliScriptPath` points to an existing script path.
- Confirm `mdStudioPreview.nodePath` points to a valid Node executable.
- If script is missing and `cliScriptPath` is default, extension tries bundled CLI automatically.
- If `cliScriptPath` is customized, that path is used as-is (no bundled auto override).
- If script is still missing, click `Select Script` in the popup and choose `md-to-html.mjs`.
  The extension stores this path in user settings automatically.

Example (absolute path):

```json
{
  "mdStudioPreview.cliScriptPath": "C:\\Users\\leesu\\Documents\\ProjectCode\\01_2026_EXP\\markdown-pattern-studio\\scripts\\md-to-html.mjs"
}
```

### Save refresh works but cursor sync does not

- Confirm `mdStudioPreview.cursorSyncOnSave=true`.
- Confirm the active editor tab is the same markdown file you saved.
- Confirm the document has headings (`#`, `##`, ...).

### Local images are missing

- Confirm relative paths are valid from the markdown file directory.
- If needed, adjust `mdStudioPreview.extraArgs` for your CLI behavior.

## 6) Development Notes

- Source: `vscode-extension/src/extension.ts`
- Build: `npm run build`
- Package: `npm run package:vsix`
- Install test: `code --install-extension .\markdown-pattern-studio-preview-0.1.2.vsix --force`

## 7) Uninstall / Cleanup Guide

### Uninstall extension

```bash
code --uninstall-extension local.markdown-pattern-studio-preview
```

### Check installed version

```bash
code --list-extensions --show-versions
```

Find `local.markdown-pattern-studio-preview@...` in the list.

### Remove packaged file (.vsix)

If you no longer need the package file, delete:

```text
vscode-extension/markdown-pattern-studio-preview-0.1.2.vsix
```

### Optional: remove local extension folder manually

If needed, remove this folder:

```text
%USERPROFILE%\.vscode\extensions\local.markdown-pattern-studio-preview-0.1.2
```
