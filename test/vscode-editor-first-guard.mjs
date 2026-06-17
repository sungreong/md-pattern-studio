import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const packageJson = JSON.parse(await readFile(new URL('../vscode-extension/package.json', import.meta.url), 'utf8'));
const commands = packageJson.contributes?.commands ?? [];
const editorTitleMenus = packageJson.contributes?.menus?.['editor/title'] ?? [];
const fileBrowserItemMenus = packageJson.contributes?.menus?.['view/item/context'] ?? [];
assert(
  commands.some((item) => item.command === 'mdStudioPreview.openSourceEditor'),
  'Open Source Editor command should be contributed',
);
assert(
  packageJson.activationEvents?.includes('onCommand:mdStudioPreview.openSourceEditor'),
  'Open Source Editor command should activate the extension',
);
assert(
  packageJson.activationEvents?.includes('onCommand:mdStudioPreview.enableAutoOnSave') &&
    packageJson.activationEvents?.includes('onCommand:mdStudioPreview.disableAutoOnSave'),
  'Auto refresh on/off commands should activate the extension',
);
assert(
  editorTitleMenus.some(
    (item) =>
      item.command === 'mdStudioPreview.openSourceEditor' &&
      item.when === "activeWebviewPanelId == 'mdStudioPreview' || activeWebviewPanelId == 'markdown.preview'",
  ),
  'Open Source Editor should appear in MD Studio and built-in markdown preview tab title actions',
);
assert(
  editorTitleMenus.some(
    (item) =>
      item.command === 'mdStudioPreview.disableAutoOnSave' &&
      item.when ===
        "(activeWebviewPanelId == 'mdStudioPreview' || activeWebviewPanelId == 'markdown.preview') && mdStudioPreview.autoOnSaveEnabled",
  ),
  'Auto Refresh On should appear in MD Studio and built-in markdown preview tab title actions',
);
assert(
  editorTitleMenus.some(
    (item) =>
      item.command === 'mdStudioPreview.enableAutoOnSave' &&
      item.when ===
        "(activeWebviewPanelId == 'mdStudioPreview' || activeWebviewPanelId == 'markdown.preview') && !mdStudioPreview.autoOnSaveEnabled",
  ),
  'Auto Refresh Off should appear in MD Studio and built-in markdown preview tab title actions',
);

const itemSource = await readFile(
  new URL('../vscode-extension/src/providers/markdownFileItem.ts', import.meta.url),
  'utf8',
);
assert.match(
  itemSource,
  /command:\s*'mdStudioPreview\.openFileInViewer'/,
  'MD Studio File Browser markdown items should open in the viewer by default',
);
assert.doesNotMatch(
  itemSource,
  /command:\s*'mdStudioFileBrowser\.openInEditor'/,
  'Markdown row clicks should not open the editor unless edit is explicitly requested',
);

const browserSource = await readFile(
  new URL('../vscode-extension/src/fileBrowser/registerMarkdownFileBrowser.ts', import.meta.url),
  'utf8',
);
const searchCommandStart = browserSource.indexOf("vscode.commands.registerCommand('mdStudioFileBrowser.search'");
assert.notEqual(searchCommandStart, -1, 'Search command should remain registered');
const searchCommandEnd = browserSource.indexOf('  return {', searchCommandStart);
const searchCommandBlock = browserSource.slice(searchCommandStart, searchCommandEnd);
assert.match(
  searchCommandBlock,
  /isMarkdownFileUri\(picked\)/,
  'Search-picked markdown files should follow browser viewer behavior',
);
assert.match(
  searchCommandBlock,
  /options\.openInViewer\(picked\)/,
  'Search-picked markdown files should open in the viewer by default',
);
assert.match(
  searchCommandBlock,
  /options\.openInEditor\(picked\)/,
  'Search-picked non-markdown files should still open in the editor',
);
assert(
  !fileBrowserItemMenus.some(
    (item) => item.command === 'mdStudioPreview.openFileInNewPanel' && item.group === 'inline',
  ),
  'Markdown rows should not show an inline preview button that can accidentally open a slow new viewer tab',
);
assert(
  fileBrowserItemMenus.some(
    (item) =>
      item.command === 'mdStudioFileBrowser.openInEditor' &&
      item.group === 'inline' &&
      /viewItem == mdFile/.test(item.when ?? ''),
  ),
  'Markdown rows should show an inline edit action for explicit editing',
);

const extensionSource = await readFile(new URL('../vscode-extension/src/extension.ts', import.meta.url), 'utf8');
const treeProviderSource = await readFile(
  new URL('../vscode-extension/src/providers/markdownFileTreeProvider.ts', import.meta.url),
  'utf8',
);
const previewFunctionStart = extensionSource.indexOf('async function previewDocument');
assert.notEqual(previewFunctionStart, -1, 'previewDocument should exist');
const previewFunctionEnd = extensionSource.indexOf('function ensureSession', previewFunctionStart);
const previewFunctionBlock = extensionSource.slice(previewFunctionStart, previewFunctionEnd);
const saveGuardIndex = previewFunctionBlock.indexOf("if (reason === 'save' && !sessions.has(key)) return;");
const ensureSessionIndex = previewFunctionBlock.indexOf('ensureSession(document');
assert(saveGuardIndex >= 0, 'Save refresh should skip files that do not already have a preview session');
assert(
  saveGuardIndex < ensureSessionIndex,
  'Save refresh guard must run before ensureSession so Ctrl+S cannot create a new viewer',
);
assert.match(
  extensionSource,
  /executeCommand\('markdown\.showSource'\)/,
  'Open Source Editor should try VS Code markdown preview source switching',
);
assert.match(
  extensionSource,
  /setContext',\s*autoOnSaveContextKey,\s*readConfig\(\)\.autoOnSave/,
  'Auto refresh setting should be mirrored into a VS Code context key for title buttons',
);
assert.match(
  extensionSource,
  /openPreferredViewForCurrentMarkdown\(enabled\)/,
  'Auto refresh on/off should immediately switch the active markdown view priority',
);
assert.match(
  extensionSource,
  /showTextDocument\(document,\s*\{\s*preview:\s*false,\s*preserveFocus:\s*false\s*\}\)/,
  'Editor-priority opening should force a text editor instead of VS Code default preview associations',
);
const constructorStart = treeProviderSource.indexOf('constructor(private readonly context');
const constructorEnd = treeProviderSource.indexOf('private resetFileWatcher', constructorStart);
const constructorBlock = treeProviderSource.slice(constructorStart, constructorEnd);
assert.doesNotMatch(
  constructorBlock,
  /void this\.refresh\(\)/,
  'File browser provider should not scan the workspace immediately on extension activation',
);
assert.doesNotMatch(
  constructorBlock,
  /this\.resetFileWatcher\(\);\s*context\.subscriptions/s,
  'File browser provider should not create its watcher before the tree is loaded',
);
assert.match(
  treeProviderSource,
  /if \(!this\.initialized\) \{\s*return this\.refresh\(\)\.then\(\(\) => this\.roots\);/s,
  'File browser provider should lazy-load only when the tree asks for root children',
);
assert.match(
  treeProviderSource,
  /this\.shouldLoadMetadata\(\) \? await this\.loadMetadata\(uris\) : new Map\(\)/,
  'Default file browser refresh should skip expensive metadata loading unless needed',
);
assert.match(
  treeProviderSource,
  /const readContent = this\.shouldReadMarkdownContentForMetadata\(\)/,
  'Markdown content should only be read for metadata modes that need line counts',
);

console.log('vscode editor-first guard passed');
