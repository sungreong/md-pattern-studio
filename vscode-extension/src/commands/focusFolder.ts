import * as vscode from 'vscode';
import { MarkdownFileBrowserProvider } from '../providers/markdownFileTreeProvider.js';

interface StoredExplorerFocusEntry {
  workspaceFolderUri: string;
  addedPatterns: string[];
}

interface StoredExplorerFocusState {
  targetLabel: string;
  entries: StoredExplorerFocusEntry[];
}

interface RegisterFolderFocusOptions {
  onDidChangeFocus(): void;
}

const LEGACY_EXPLORER_FOCUS_STATE_KEY = 'mdStudioPreview:folderFocus';
const FOLDER_FOCUS_CONTEXT_KEY = 'mdStudioPreview.folderFocusActive';

export function registerFolderFocusCommands(
  context: vscode.ExtensionContext,
  provider: MarkdownFileBrowserProvider,
  options: RegisterFolderFocusOptions,
): void {
  void updateFolderFocusContext(provider);

  context.subscriptions.push(
    vscode.commands.registerCommand('mdStudioPreview.focusFolder', async (commandArg?: unknown) => {
      await focusFolder(context, provider, commandArg, options);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mdStudioPreview.clearFolderFocus', async () => {
      await clearFolderFocus(context, provider, options);
    }),
  );
}

async function focusFolder(
  context: vscode.ExtensionContext,
  provider: MarkdownFileBrowserProvider,
  commandArg: unknown,
  options: RegisterFolderFocusOptions,
): Promise<void> {
  const folderUri = await resolveFolderUri(commandArg);
  if (!folderUri) return;

  if (!vscode.workspace.getWorkspaceFolder(folderUri)) {
    void vscode.window.showErrorMessage('FOCUS는 현재 workspace 안의 폴더에서만 사용할 수 있습니다.');
    return;
  }

  try {
    await clearLegacyExplorerFocus(context);
    await provider.focusFolder(folderUri);
    await updateFolderFocusContext(provider);
    options.onDidChangeFocus();

    const choice = await vscode.window.showInformationMessage(
      `FOCUS 적용: MD Studio File Browser에서 "${formatRelativePath(folderUri)}"만 봅니다.`,
      'Clear Focus',
    );
    if (choice === 'Clear Focus') {
      await clearFolderFocus(context, provider, options);
    }
  } catch (error) {
    void vscode.window.showErrorMessage(`FOCUS 적용 실패: ${errorToMessage(error)}`);
  }
}

async function clearFolderFocus(
  context: vscode.ExtensionContext | null,
  provider: MarkdownFileBrowserProvider,
  options: RegisterFolderFocusOptions,
): Promise<void> {
  try {
    const legacyRemovedCount = context ? await clearLegacyExplorerFocus(context) : 0;
    const focusItem = provider.getFocusItem();
    const hadBrowserFocus = provider.isFocusActive();
    await provider.clearFocus();
    await updateFolderFocusContext(provider);
    options.onDidChangeFocus();

    if (!hadBrowserFocus && legacyRemovedCount === 0) {
      void vscode.window.showInformationMessage('적용된 Folder Focus가 없습니다.');
      return;
    }

    const target = focusItem ? `: ${focusItem.description ? `${focusItem.description}/` : ''}${focusItem.label}` : '';
    const legacyNote = legacyRemovedCount > 0 ? ` Explorer 숨김 설정 ${legacyRemovedCount.toLocaleString()}개도 정리했습니다.` : '';
    void vscode.window.showInformationMessage(`Folder Focus를 해제했습니다${target}.${legacyNote}`);
  } catch (error) {
    void vscode.window.showErrorMessage(`Folder Focus 해제 실패: ${errorToMessage(error)}`);
  }
}

async function resolveFolderUri(commandArg: unknown): Promise<vscode.Uri | null> {
  const resourceUri = getResourceUri(commandArg);
  const uri = resourceUri ?? (await pickFolderUri());
  if (!uri) return null;

  if (uri.scheme !== 'file') {
    void vscode.window.showErrorMessage('FOCUS는 로컬 폴더에서만 사용할 수 있습니다.');
    return null;
  }

  let stat: vscode.FileStat;
  try {
    stat = await vscode.workspace.fs.stat(uri);
  } catch {
    void vscode.window.showErrorMessage('선택한 폴더를 찾을 수 없습니다.');
    return null;
  }

  if ((stat.type & vscode.FileType.Directory) === 0) {
    void vscode.window.showErrorMessage('FOCUS는 폴더를 선택했을 때만 사용할 수 있습니다.');
    return null;
  }

  return uri;
}

async function pickFolderUri(): Promise<vscode.Uri | null> {
  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: 'FOCUS',
    title: 'MD Studio File Browser Focus',
  });
  return picked?.[0] ?? null;
}

async function clearLegacyExplorerFocus(context: vscode.ExtensionContext): Promise<number> {
  const state = readLegacyExplorerFocusState(context);
  if (!state) return 0;

  const folders = vscode.workspace.workspaceFolders ?? [];
  let removedCount = 0;

  for (const entry of state.entries) {
    const workspaceFolder = folders.find((folder) => folder.uri.toString() === entry.workspaceFolderUri);
    if (!workspaceFolder) continue;

    const configuration = vscode.workspace.getConfiguration('files', workspaceFolder.uri);
    const nextExclude = readConfiguredWorkspaceFolderExclude(configuration);
    let changed = false;

    for (const pattern of entry.addedPatterns) {
      if (!hasOwn(nextExclude, pattern)) continue;
      delete nextExclude[pattern];
      removedCount += 1;
      changed = true;
    }

    if (changed) {
      await updateWorkspaceFolderExclude(workspaceFolder, nextExclude);
    }
  }

  await context.workspaceState.update(LEGACY_EXPLORER_FOCUS_STATE_KEY, undefined);
  return removedCount;
}

function readLegacyExplorerFocusState(context: vscode.ExtensionContext): StoredExplorerFocusState | null {
  const stored = context.workspaceState.get<unknown>(LEGACY_EXPLORER_FOCUS_STATE_KEY);
  if (!stored || typeof stored !== 'object') return null;

  const candidate = stored as Partial<StoredExplorerFocusState>;
  if (!Array.isArray(candidate.entries)) return null;

  const entries = candidate.entries
    .map((entry) => normalizeStoredEntry(entry))
    .filter((entry): entry is StoredExplorerFocusEntry => Boolean(entry));

  if (!entries.length) return null;

  return {
    targetLabel: typeof candidate.targetLabel === 'string' ? candidate.targetLabel : '',
    entries,
  };
}

function normalizeStoredEntry(entry: unknown): StoredExplorerFocusEntry | null {
  if (!entry || typeof entry !== 'object') return null;
  const candidate = entry as Partial<StoredExplorerFocusEntry>;
  if (typeof candidate.workspaceFolderUri !== 'string') return null;
  if (!Array.isArray(candidate.addedPatterns)) return null;
  const addedPatterns = candidate.addedPatterns.filter(
    (pattern): pattern is string => typeof pattern === 'string' && pattern.length > 0,
  );
  return { workspaceFolderUri: candidate.workspaceFolderUri, addedPatterns };
}

function readConfiguredWorkspaceFolderExclude(
  configuration: vscode.WorkspaceConfiguration,
): Record<string, unknown> {
  const inspected = configuration.inspect<unknown>('exclude');
  return readExcludeObject(inspected?.workspaceFolderValue);
}

async function updateWorkspaceFolderExclude(
  workspaceFolder: vscode.WorkspaceFolder,
  exclude: Record<string, unknown>,
): Promise<void> {
  const nextValue = Object.keys(exclude).length ? exclude : undefined;
  await vscode.workspace
    .getConfiguration('files', workspaceFolder.uri)
    .update('exclude', nextValue, vscode.ConfigurationTarget.WorkspaceFolder);
}

function readExcludeObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return { ...(value as Record<string, unknown>) };
}

async function updateFolderFocusContext(provider: MarkdownFileBrowserProvider): Promise<void> {
  await vscode.commands.executeCommand('setContext', FOLDER_FOCUS_CONTEXT_KEY, provider.isFocusActive());
}

function getResourceUri(commandArg: unknown): vscode.Uri | null {
  if (commandArg instanceof vscode.Uri) return commandArg;
  if (!commandArg || typeof commandArg !== 'object') return null;
  const resourceUri = (commandArg as { resourceUri?: unknown }).resourceUri;
  return resourceUri instanceof vscode.Uri ? resourceUri : null;
}

function hasOwn(object: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function formatRelativePath(uri: vscode.Uri): string {
  const includeWorkspaceName = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
  return vscode.workspace.asRelativePath(uri, includeWorkspaceName);
}

function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
