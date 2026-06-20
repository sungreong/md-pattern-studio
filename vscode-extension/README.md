# Markdown Pattern Studio Preview Extension

This extension runs the repository CLI (`scripts/md-to-html.mjs`) and opens the rendered HTML in a VS Code webview.

## Features

- `Markdown Studio: Open Preview` command
- `Markdown Studio: Refresh Preview` command
- `MD Studio: Open in Viewer` command safely opens the selected tree item or the active markdown document
- `MD Studio: Transform Markdown to Styled HTML` command (export the currently open `.md` to styled `.html`)
- `MD Studio: Download Skill Folder` command exports bundled or workspace skills as ready-to-share `.zip` files
- `FOCUS` command on a folder narrows only the MD Studio File Browser to that folder
- `MD Studio: Clear Folder Focus` restores the MD Studio File Browser view and cleans up legacy Explorer exclude rules if an older build added them
- `MD Studio: File Extensions` adds non-markdown file types such as `.txt`, `.html`, or `.json` to the browser
- `Open in Editor` opens any MD Studio File Browser item directly in the normal VS Code editor
- Viewer `Style` controls switch between Default, Clean, Flat, Reader, and Print appearances in preview and exported HTML
- CLI/frontmatter appearance options adjust background, corner radius, frame density, and viewer chrome
- Auto refresh on markdown save (`mdStudioPreview.autoOnSave`)
- Outline collapsed/expanded state is remembered per document
- File URI rewrite (`file://...`) to webview-safe resource URIs
- **Preview works outside the current workspace** — any `.md` file can be previewed using the bundled CLI
- **Responsive viewer** — Slide/Stack layout, outline, and zoom controls adapt to the webview panel size
- **5% zoom controls** — Slide and Stack previews use 5% zoom steps, and Fit can grow beyond 100% when there is room
- Standalone CLI exports embed local images by default, so generated HTML can be moved without losing relative-path images. Add `--no-embed-local-images` to `mdStudioPreview.extraArgs` to keep file-based image links.

## Recent Changes

Compared from the pre-browser-upgrade point (`db030df`) to the current extension:

- Added file browser sorting by name, modified time, created time, file size, and document line count
- Added filter modes for all files, Pinned, Recent, stale documents, long documents, and large files
- Added compact Korean metadata in the tree, with detailed title/date/size/line-count tooltips
- Added Pinned and Recent virtual sections at the top of the browser
- Added workspace-scoped hidden files/folders with `Hide from Browser` and `Manage Hidden Items`
- Added MD Studio File Browser folder focus: right-click a browser folder and run `FOCUS` to hide everything outside that folder inside the extension view only
- Added configurable extra file extensions so the browser can include `.txt`, `.html`, `.json`, or other project-local companion files
- Added `Open in Editor` for markdown and non-markdown browser items
- Added viewer appearance options for cleaner, flatter, reader-friendly, and print-oriented HTML
- Added file/folder path, relative path, and name copy commands in the browser context menu
- Added folder summaries and best-effort Git status badges
- Improved responsive preview behavior for narrow webview panels
- Improved Slide and Stack zoom: 5% step controls and Fit values above 100% when space allows
- Split browser, TreeItem, Git status, runtime, and webview helper code into smaller modules so the main source files stay under 1000 lines

### Markdown File Browser (Activity Bar)

A dedicated sidebar for navigating markdown files as a reader:

- **Book icon** in the Activity Bar lists all `*.md` files in the workspace as a folder tree
- **Click** a file → opens it in the preview panel (single reader panel, previous panel closes)
- **Right-click → Open in New Panel** → opens in a new panel while keeping existing ones open
- **Command Palette → MD Studio: Open in Viewer** → opens the active markdown file, or shows a clear message when no markdown target is available
- **Search icon** (🔍) in the sidebar title bar → QuickPick search by filename and path
- **Filter icon** → show all files, Pinned, Recent, stale documents, long documents, or large files
- **Sort icon** → sort by name, modified time, created time, file size, or line count
- **Eye icon** → manage hidden files and folders
- **Download icon** in the sidebar title bar → choose a bundled/workspace skill and save it as a ZIP folder
- **Right-click → Pin to Top / Unpin** → keep important documents in the Pinned section
- **Right-click → Hide from Browser** → hide low-signal files or folders without changing the filesystem
- **File Extensions icon** in the sidebar title bar → add non-markdown file types to the browser
- **Right-click a folder → FOCUS** → narrow only the MD Studio File Browser to that folder
- **Right-click → Open in Editor** → open the selected browser item in the normal VS Code editor
- **Right-click → Copy Path / Copy Relative Path / Copy Name** → copy file or folder references
- **Pinned** and **Recent** sections stay above the normal folder tree
- Folder descriptions summarize document count, recent documents, and stale documents
- **Collapse All** button to reset the folder tree
- Tree auto-refreshes when `.md` files are added, changed, or deleted (300 ms debounce)
- Sidebar selection syncs automatically when the preview changes via `Ctrl+S`

### Skill Folder Download

Use `MD Studio: Download Skill Folder` from the Command Palette or MD Studio File Browser sidebar title bar.

1. Choose one source: bundled Claude, Agents, Codex, or the configured workspace `mdStudioPreview.skillsDir`.
2. Choose a skill folder that contains `SKILL.md`.
3. Save the generated ZIP. The archive keeps the skill folder as the root, so it extracts as `md-presentation-composer/SKILL.md` plus its references.

### Folder Focus

Use `FOCUS` from a folder in the MD Studio File Browser sidebar.

1. Right-click a folder.
2. Choose `FOCUS`.
3. The MD Studio File Browser shows only configured files under that folder.
4. Run `MD Studio: Clear Folder Focus` to return to the normal browser tree.

FOCUS does not modify VS Code Explorer or workspace `files.exclude`. `Clear Folder Focus` also removes legacy exclude rules that were recorded by older experimental builds.

### Viewer Appearance

Use the `Style` menu in the VS Code preview or exported standalone HTML to change document density without changing markdown content.

- Presets: `Default`, `Clean`, `Flat`, `Reader`, `Print`
- Detail controls: background, corners, frame, and viewer chrome
- VS Code preview remembers the last selected appearance and applies it to future previews and `MD Studio: Transform Markdown to Styled HTML`
- CLI options: `--appearance`, `--appearance-background`, `--appearance-radius`, `--appearance-frame`, `--viewer-chrome`
- Frontmatter keys: `appearance`, `appearanceBackground`, `appearanceRadius`, `appearanceFrame`, `viewerChrome`

### In-Reader Text Search

- Press `Ctrl+F` inside the preview webview to open a floating search bar
- Matches are highlighted in real time as you type
- `↑` / `↓` buttons (or `Shift+Enter` / `Enter`) to cycle through results with match count
- `Escape` closes the bar and clears highlights

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
7. Slide and Stack Fit calculate against the current webview size and can exceed 100% when there is room.
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
code --install-extension .\markdown-pattern-studio-preview-0.1.30.vsix
```
