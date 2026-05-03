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
code --install-extension .\markdown-pattern-studio-preview-0.1.10.vsix --force
```

### Basic Usage

1. Open a `.md` file inside the workspace.
2. Run `Markdown Studio: Open Preview` from Command Palette (`Ctrl+Shift+P`).
3. Save the file (`Ctrl+S`) to auto-refresh preview.
4. Use `Markdown Studio: Refresh Preview` for manual force refresh.
5. Use `MD Studio: Transform Markdown to Styled HTML` to export the currently open markdown file as styled HTML.
6. Use `MD Studio: Open in Viewer` from the Markdown Files sidebar or Command Palette. From the palette it falls back to the active markdown document and shows a clear message if no markdown target is available.
7. Use `MD Studio: Download Skill Folder` to export bundled or workspace skills as ready-to-share ZIP folders.

## 2) Cursor Sync on Save (Ctrl+S)

When `mdStudioPreview.cursorSyncOnSave=true`, save triggers this sequence:

1. Render markdown through the CLI.
2. Resolve current cursor line.
3. Parse sections with `parseMarkdownDocument` from `public/core/engine.js`.
4. Pick the last section whose line is less than or equal to the cursor line.
5. Send a sync message to the webview.
6. Move preview using outline-first navigation (`data-outline-id`).

Notes:

- Sync is section-based (heading), not paragraph-exact.
- If no heading exists, render still runs and sync is skipped.

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
  - `auto`: switch to stack on narrow webview.
  - `slides`: always prefer slides.
  - `stack`: always prefer stack.
  - Default: `"stack"`

Outline state:

- Outline hide/show state is remembered per markdown document.
- Default for new documents is expanded (open).

## 4) Skill Folder Download

`MD Studio: Download Skill Folder` is available from the Command Palette and the Markdown Files sidebar title bar.

1. Choose a source:
   - `Bundled Claude`
   - `Bundled Agents`
   - `Bundled Codex`
   - `Workspace configured skillsDir`
2. Choose a skill folder. Only folders with a root `SKILL.md` are exportable.
3. Pick a save location. The output archive is named `{skill-id}.zip` by default.
4. Extract the ZIP where your AI tool expects skills. The ZIP keeps the skill folder at the archive root.

Bundled skills are copied into the VSIX during `npm run build`, so installed users can export them without cloning the repository.

## 5) Runtime Flow

1. Extension receives preview command or save event.
2. Resolves CLI path in this order:
   - `mdStudioPreview.cliScriptPath`
   - bundled CLI (`<extension>/scripts/md-to-html.mjs`) only when the setting is default and missing
   - manual picker (`Select Script`) as final fallback
3. Resolves parser path for cursor sync:
   - workspace `public/core/engine.js`
   - bundled parser (`<extension>/public/core/engine.js`) fallback
4. Runs CLI and loads rendered HTML.
5. Rewrites `file://` asset URLs with `webview.asWebviewUri(...)`.
6. Injects bridge script (cursor sync, preferred mode, outline state persistence).

## 6) Troubleshooting

### Preview does not open

- Confirm the file is a markdown file in the current workspace.
- If `MD Studio: Open in Viewer` is run from Command Palette, keep a markdown editor active or select a markdown file from the sidebar first.
- Confirm `mdStudioPreview.cliScriptPath` points to an existing script path.
- Confirm `mdStudioPreview.nodePath` points to a valid Node executable.
- If script is missing and `cliScriptPath` is default, extension tries bundled CLI automatically.
- If `cliScriptPath` is customized, that path is used as-is (no bundled auto override).
- If script is still missing, click `Select Script` in the popup and choose `md-to-html.mjs`.

Example (absolute path):

```json
{
  "mdStudioPreview.cliScriptPath": "C:\\Users\\leesu\\Documents\\ProjectCode\\01_2026_EXP\\markdown-pattern-studio\\scripts\\md-to-html.mjs"
}
```

### Outline keeps reopening

- Update to the latest extension (`0.1.10` or newer).
- Hide once; subsequent refresh/save should preserve collapsed state for that document.

### `Open in Viewer` command shows an error

- Update to `0.1.10` or newer.
- The command now validates command arguments before opening a file.
- If no file is passed by VS Code, it uses the active markdown document instead of failing on an undefined URI.

### Skill download has no sources

- Run `npm run build` before testing from source so bundled `ai_skills` are copied into `vscode-extension/ai_skills`.
- Confirm `mdStudioPreview.skillsDir` points to a directory whose children contain `SKILL.md`.

## 7) Development Notes

- Source: `vscode-extension/src/extension.ts`
- Build: `npm run build`
- Package: `npm run package:vsix`
- Install test: `code --install-extension .\markdown-pattern-studio-preview-0.1.10.vsix --force`

## 8) Uninstall / Cleanup Guide

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
vscode-extension/markdown-pattern-studio-preview-0.1.10.vsix
```

### Optional: remove local extension folder manually

If needed, remove this folder:

```text
%USERPROFILE%\.vscode\extensions\local.markdown-pattern-studio-preview-0.1.10
```
