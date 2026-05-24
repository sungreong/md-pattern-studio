import * as vscode from 'vscode';
import * as path from 'node:path';
import {
  MarkdownFileBrowserProvider,
  type FileBrowserFilterMode,
  type FileBrowserHiddenItem,
  type FileBrowserSortOrder,
} from '../providers/markdownFileTreeProvider.js';
import { MarkdownFileItem } from '../providers/markdownFileItem.js';
import { registerFolderFocusCommands } from '../commands/focusFolder.js';
import { isMarkdownFileUri, normalizeFileExtension } from '../utils/markdownFiles.js';

interface FileBrowserSortQuickPickItem extends vscode.QuickPickItem {
  order: FileBrowserSortOrder;
}

interface FileBrowserFilterQuickPickItem extends vscode.QuickPickItem {
  mode: FileBrowserFilterMode;
}

interface HiddenQuickPickItem extends vscode.QuickPickItem {
  action: 'clear' | 'unhide';
  fsPath?: string;
}

interface ExtraExtensionQuickPickItem extends vscode.QuickPickItem {
  action?: 'add' | 'clear';
  extension?: string;
}

export interface MarkdownFileBrowserController {
  recordRecent(resourceUri: vscode.Uri): void;
  reveal(resourceUri: vscode.Uri): void;
}

interface RegisterMarkdownFileBrowserOptions {
  openInViewer(uri: vscode.Uri): Promise<void>;
  openInNewPanel(uri: vscode.Uri): Promise<void>;
  resolveMarkdownUri(commandArg?: unknown): Promise<vscode.Uri | null>;
}

const fileBrowserSortItems: readonly FileBrowserSortQuickPickItem[] = [
  { label: '이름 A-Z', description: '폴더/파일 이름순', order: 'nameAsc' },
  { label: '이름 Z-A', description: '폴더/파일 이름 역순', order: 'nameDesc' },
  { label: '최근 수정', description: '방금 고친 문서 먼저', order: 'modifiedDesc' },
  { label: '오래 안 고침', description: '오래된 수정 문서 먼저', order: 'modifiedAsc' },
  { label: '최근 생성', description: '새로 만든 문서 먼저', order: 'createdDesc' },
  { label: '오래된 생성', description: '오래전에 만든 문서 먼저', order: 'createdAsc' },
  { label: '큰 파일', description: '용량 큰 문서 먼저', order: 'sizeDesc' },
  { label: '작은 파일', description: '용량 작은 문서 먼저', order: 'sizeAsc' },
  { label: '긴 문서', description: '줄 수 많은 문서 먼저', order: 'lengthDesc' },
  { label: '짧은 문서', description: '줄 수 적은 문서 먼저', order: 'lengthAsc' },
];

const fileBrowserFilterItems: readonly FileBrowserFilterQuickPickItem[] = [
  { label: '전체', description: '전체 폴더 트리', mode: 'all' },
  { label: 'Pinned', description: '고정 문서만', mode: 'pinned' },
  { label: 'Recent', description: '최근 열어본 문서', mode: 'recent' },
  { label: '오래 안 고침', description: '30일 이상 미수정', mode: 'stale' },
  { label: '긴 문서', description: '줄 수 상위 20개', mode: 'long' },
  { label: '큰 파일', description: '용량 상위 20개', mode: 'large' },
];

const suggestedExtraExtensions = [
  '.txt',
  '.json',
  '.html',
  '.css',
  '.js',
  '.ts',
  '.tsx',
  '.jsx',
  '.yaml',
  '.yml',
  '.csv',
  '.py',
  '.toml',
  '.xml',
];

export function registerMarkdownFileBrowser(
  context: vscode.ExtensionContext,
  options: RegisterMarkdownFileBrowserOptions,
): MarkdownFileBrowserController {
  const provider = new MarkdownFileBrowserProvider(context);
  const treeView = vscode.window.createTreeView('mdStudioFileBrowser', {
    treeDataProvider: provider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);
  updateDescription(treeView, provider);
  registerFolderFocusCommands(context, provider, {
    onDidChangeFocus: () => updateDescription(treeView, provider),
  });

  context.subscriptions.push(
    vscode.commands.registerCommand('mdStudioFileBrowser.refresh', async () => {
      await provider.refresh();
      updateDescription(treeView, provider);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mdStudioFileBrowser.sort', async () => {
      const currentOrder = provider.getSortOrder();
      const picked = await vscode.window.showQuickPick(
        fileBrowserSortItems.map((item) => ({
          ...item,
          description: item.order === currentOrder ? `현재 | ${item.description ?? ''}` : item.description,
        })),
        { placeHolder: 'Markdown file sort...', matchOnDescription: true },
      );
      if (!picked) return;
      await provider.setSortOrder(picked.order);
      updateDescription(treeView, provider);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mdStudioFileBrowser.filter', async () => {
      const currentMode = provider.getFilterMode();
      const picked = await vscode.window.showQuickPick(
        fileBrowserFilterItems.map((item) => ({
          ...item,
          description: item.mode === currentMode ? `현재 | ${item.description ?? ''}` : item.description,
        })),
        { placeHolder: 'Markdown file filter...', matchOnDescription: true },
      );
      if (!picked) return;
      await provider.setFilterMode(picked.mode);
      updateDescription(treeView, provider);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mdStudioFileBrowser.configureExtensions', async () => {
      await configureExtraExtensions(provider, treeView);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mdStudioFileBrowser.pinToTop', async (commandArg?: unknown) => {
      const uri = getResourceUri(commandArg) ?? (await options.resolveMarkdownUri(commandArg));
      if (!uri) return;
      await provider.pinFile(uri);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mdStudioFileBrowser.unpin', async (commandArg?: unknown) => {
      const uri = getResourceUri(commandArg) ?? (await options.resolveMarkdownUri(commandArg));
      if (!uri) return;
      await provider.unpinFile(uri);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mdStudioFileBrowser.openInEditor', async (commandArg?: unknown) => {
      const uri = getResourceUri(commandArg) ?? (await pickBrowserFile(provider));
      if (!uri) return;
      await vscode.commands.executeCommand('vscode.open', uri);
      await provider.recordRecentFile(uri);
      revealInTree(treeView, uri);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mdStudioPreview.openFileInViewer', async (commandArg?: unknown) => {
      const uri = await options.resolveMarkdownUri(commandArg);
      if (!uri) return;
      await options.openInViewer(uri);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mdStudioPreview.openFileInNewPanel', async (commandArg?: unknown) => {
      const uri = await options.resolveMarkdownUri(commandArg);
      if (!uri) return;
      await options.openInNewPanel(uri);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mdStudioFileBrowser.copyPath', async (commandArg?: unknown) => {
      const uri = getResourceUri(commandArg) ?? (await options.resolveMarkdownUri(commandArg));
      if (!uri) return;
      await copyToClipboard(uri.fsPath, 'Path copied.');
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mdStudioFileBrowser.copyRelativePath', async (commandArg?: unknown) => {
      const uri = getResourceUri(commandArg) ?? (await options.resolveMarkdownUri(commandArg));
      if (!uri) return;
      const includeWorkspaceName = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
      await copyToClipboard(vscode.workspace.asRelativePath(uri, includeWorkspaceName), 'Relative path copied.');
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mdStudioFileBrowser.copyFileName', async (commandArg?: unknown) => {
      const uri = getResourceUri(commandArg) ?? (await options.resolveMarkdownUri(commandArg));
      if (!uri) return;
      await copyToClipboard(path.basename(uri.fsPath), 'Name copied.');
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mdStudioFileBrowser.hideItem', async (commandArg?: unknown) => {
      const uri = getResourceUri(commandArg) ?? (await options.resolveMarkdownUri(commandArg));
      if (!uri) return;
      await provider.hideItem(uri);
      updateDescription(treeView, provider);
      void vscode.window.showInformationMessage(`숨김 처리했습니다: ${formatRelativePath(uri)}`);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mdStudioFileBrowser.manageHidden', async () => {
      await manageHiddenItems(provider, treeView);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mdStudioFileBrowser.search', async () => {
      const picked = await pickBrowserFile(provider);
      if (!picked) return;
      if (isMarkdownFileUri(picked)) {
        await options.openInViewer(picked);
      } else {
        await vscode.commands.executeCommand('vscode.open', picked);
        await provider.recordRecentFile(picked);
      }
      revealInTree(treeView, picked);
    }),
  );

  return {
    recordRecent(resourceUri) {
      void provider.recordRecentFile(resourceUri);
    },
    reveal(resourceUri) {
      revealInTree(treeView, resourceUri);
    },
  };
}

function updateDescription(
  treeView: vscode.TreeView<MarkdownFileItem>,
  provider: MarkdownFileBrowserProvider,
): void {
  treeView.description = provider.getSortDescription();
}

async function manageHiddenItems(
  provider: MarkdownFileBrowserProvider,
  treeView: vscode.TreeView<MarkdownFileItem>,
): Promise<void> {
  const hiddenItems = provider.getHiddenItems();
  if (!hiddenItems.length) {
    void vscode.window.showInformationMessage('숨긴 파일이나 폴더가 없습니다.');
    return;
  }

  const picked = await vscode.window.showQuickPick(buildHiddenQuickPickItems(hiddenItems), {
    placeHolder: '숨긴 파일/폴더 관리...',
    matchOnDescription: true,
  });
  if (!picked) return;

  if (picked.action === 'clear') {
    const confirmed = await vscode.window.showWarningMessage('숨김 목록을 모두 해제할까요?', { modal: true }, '해제');
    if (confirmed !== '해제') return;
    await provider.clearHiddenItems();
    updateDescription(treeView, provider);
    void vscode.window.showInformationMessage('숨김 목록을 모두 해제했습니다.');
    return;
  }

  if (!picked.fsPath) return;
  await provider.unhideItem(picked.fsPath);
  updateDescription(treeView, provider);
  void vscode.window.showInformationMessage(`다시 표시합니다: ${formatRelativePath(vscode.Uri.file(picked.fsPath))}`);
}

function buildHiddenQuickPickItems(hiddenItems: FileBrowserHiddenItem[]): HiddenQuickPickItem[] {
  return [
    {
      label: '$(clear-all) 숨김 모두 해제',
      description: `${hiddenItems.length.toLocaleString()}개`,
      action: 'clear',
      alwaysShow: true,
    },
    ...hiddenItems.map((item) => ({
      label: item.label,
      description: item.description,
      detail: item.fsPath,
      action: 'unhide' as const,
      fsPath: item.fsPath,
    })),
  ];
}

async function configureExtraExtensions(
  provider: MarkdownFileBrowserProvider,
  treeView: vscode.TreeView<MarkdownFileItem>,
): Promise<void> {
  const current = provider.getExtraExtensions();
  const candidateExtensions = [...current, ...suggestedExtraExtensions].filter(
    (extension, index, all) => all.indexOf(extension) === index,
  );
  const picked = await vscode.window.showQuickPick(
    [
      {
        label: '$(add) 직접 추가...',
        description: '예: txt, html, json',
        action: 'add' as const,
        alwaysShow: true,
      },
      {
        label: '$(clear-all) 추가 확장자 모두 해제',
        description: current.length ? current.join(', ') : '설정된 추가 확장자가 없습니다',
        action: 'clear' as const,
        alwaysShow: true,
      },
      ...candidateExtensions.map((extension) => ({
        label: extension,
        description: current.includes(extension) ? '현재 표시 중' : '클릭해서 표시',
        picked: current.includes(extension),
        extension,
      })),
    ] satisfies ExtraExtensionQuickPickItem[],
    {
      canPickMany: true,
      matchOnDescription: true,
      placeHolder: 'MD Studio File Browser에 추가로 보여줄 확장자를 선택하세요. Markdown은 항상 표시됩니다.',
    },
  );
  if (!picked) return;

  const selected = picked as ExtraExtensionQuickPickItem[];
  let nextExtensions = selected
    .map((item) => item.extension)
    .filter((extension): extension is string => Boolean(extension));

  if (selected.some((item) => item.action === 'clear')) {
    nextExtensions = [];
  }

  if (selected.some((item) => item.action === 'add')) {
    const input = await vscode.window.showInputBox({
      title: '추가 확장자 입력',
      prompt: '점은 있어도 없어도 됩니다. 예: txt, html, json',
      placeHolder: 'txt',
      validateInput(value) {
        return normalizeFileExtension(value) ? null : '영문/숫자/하이픈/언더스코어 확장자만 사용할 수 있습니다.';
      },
    });
    const customExtension = normalizeFileExtension(input);
    if (customExtension && !nextExtensions.includes(customExtension)) {
      nextExtensions.push(customExtension);
    }
  }

  await provider.setExtraExtensions(nextExtensions);
  updateDescription(treeView, provider);
  const enabled = provider.getExtraExtensions();
  void vscode.window.showInformationMessage(
    enabled.length
      ? `추가 확장자를 표시합니다: ${enabled.join(', ')}`
      : '추가 확장자 표시를 해제했습니다. Markdown 파일은 계속 표시됩니다.',
  );
}

async function pickBrowserFile(provider: MarkdownFileBrowserProvider): Promise<vscode.Uri | null> {
  const uris = await provider.findVisibleFiles();
  const folders = vscode.workspace.workspaceFolders;
  const items = uris
    .map((uri) => {
      const rel = folders?.length ? vscode.workspace.asRelativePath(uri, folders.length > 1) : uri.fsPath;
      return {
        label: path.basename(uri.fsPath),
        description: path.dirname(rel),
        detail: isMarkdownFileUri(uri) ? 'Open in Viewer' : 'Open in Editor',
        uri,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: `Search MD Studio files (${provider.getExtensionDescription()})...`,
    matchOnDescription: true,
    matchOnDetail: true,
  });
  return picked?.uri ?? null;
}

function revealInTree(treeView: vscode.TreeView<MarkdownFileItem>, uri: vscode.Uri): void {
  try {
    void treeView.reveal(new MarkdownFileItem(uri, false), { select: true, focus: false });
  } catch {
    // File may be outside the current tree view.
  }
}

async function copyToClipboard(value: string, message: string): Promise<void> {
  await vscode.env.clipboard.writeText(value);
  void vscode.window.showInformationMessage(message);
}

function getResourceUri(commandArg: unknown): vscode.Uri | null {
  if (commandArg instanceof vscode.Uri) return commandArg;
  if (!commandArg || typeof commandArg !== 'object') return null;
  const resourceUri = (commandArg as { resourceUri?: unknown }).resourceUri;
  return resourceUri instanceof vscode.Uri ? resourceUri : null;
}

function formatRelativePath(uri: vscode.Uri): string {
  const includeWorkspaceName = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
  return vscode.workspace.asRelativePath(uri, includeWorkspaceName);
}
