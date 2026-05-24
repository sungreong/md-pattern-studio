import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const packageJson = JSON.parse(await readFile(new URL('../vscode-extension/package.json', import.meta.url), 'utf8'));
const menus = packageJson.contributes?.menus ?? {};

const explorerCommands = (menus['explorer/context'] ?? []).map((item) => item.command);
assert(!explorerCommands.includes('mdStudioPreview.focusFolder'), 'FOCUS must not appear in the VS Code Explorer context menu');
assert(
  !explorerCommands.includes('mdStudioPreview.clearFolderFocus'),
  'Clear Folder Focus must not appear in the VS Code Explorer context menu',
);

const browserFocusItem = (menus['view/item/context'] ?? []).find(
  (item) => item.command === 'mdStudioPreview.focusFolder',
);
const browserClearFocusItem = (menus['view/item/context'] ?? []).find(
  (item) => item.command === 'mdStudioPreview.clearFolderFocus',
);
assert(browserFocusItem, 'FOCUS should remain available in the MD Studio File Browser context menu');
assert(browserClearFocusItem, 'Clear FOCUS should be available in the MD Studio File Browser context menu');
assert.match(
  browserFocusItem.when ?? '',
  /view == mdStudioFileBrowser/,
  'FOCUS should be scoped to the MD Studio File Browser view',
);
assert.match(browserFocusItem.when ?? '', /viewItem == mdFolder/, 'FOCUS should only appear on browser folders');
assert.match(
  browserClearFocusItem.when ?? '',
  /view == mdStudioFileBrowser/,
  'Clear FOCUS should be scoped to the MD Studio File Browser view',
);
assert.match(
  browserClearFocusItem.when ?? '',
  /mdStudioPreview\.folderFocusActive/,
  'Clear FOCUS should only appear while folder focus is active',
);
assert.match(browserClearFocusItem.when ?? '', /viewItem == mdFolder/, 'Clear FOCUS should only appear on browser folders');

console.log('vscode focus menu guard passed');
