import * as vscode from 'vscode';
import * as path from 'node:path';
import { readGitStatusByPath } from './gitStatus.js';
import { MarkdownFileItem } from './markdownFileItem.js';
import {
  DEFAULT_FILE_BROWSER_EXCLUDE_GLOB,
  buildExtensionGlob,
  getBrowserFileExtensions,
  isMarkdownFileUri,
  normalizeExtraFileExtensions,
  readExtraFileExtensions,
} from '../utils/markdownFiles.js';

export type FileBrowserSortOrder = 'nameAsc' | 'nameDesc' | 'modifiedDesc' | 'modifiedAsc' | 'createdDesc' | 'createdAsc' | 'sizeDesc' | 'sizeAsc' | 'lengthDesc' | 'lengthAsc';

export type FileBrowserFilterMode = 'all' | 'pinned' | 'recent' | 'stale' | 'long' | 'large';

export interface FileBrowserHiddenItem {
  fsPath: string;
  label: string;
  description: string;
}

export const DEFAULT_FILE_BROWSER_SORT_ORDER: FileBrowserSortOrder = 'nameAsc';
export const DEFAULT_FILE_BROWSER_FILTER_MODE: FileBrowserFilterMode = 'all';

const SORT_STATE_KEY = 'mdStudioFileBrowser:sortOrder';
const PINNED_STATE_KEY = 'mdStudioFileBrowser:pinnedFiles';
const RECENT_STATE_KEY = 'mdStudioFileBrowser:recentFiles';
const FILTER_STATE_KEY = 'mdStudioFileBrowser:filterMode';
const HIDDEN_STATE_KEY = 'mdStudioFileBrowser:hiddenItems';
const FOCUS_STATE_KEY = 'mdStudioFileBrowser:focusRoot';
const PINNED_ROOT_KEY = 'mdStudioFileBrowser:pinnedRoot';
const RECENT_ROOT_KEY = 'mdStudioFileBrowser:recentRoot';
const FILTER_ROOT_KEY = 'mdStudioFileBrowser:filterRoot';
const MAX_METADATA_READ_CONCURRENCY = 16;
const MAX_RECENT_FILES = 10;
const FILTER_RESULT_LIMIT = 20;
const RECENT_FOLDER_THRESHOLD_MS = 24 * 60 * 60 * 1000;
const STALE_FILE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000;

const SORT_DESCRIPTIONS: Record<FileBrowserSortOrder, string> = {
  nameAsc: '이름 A-Z',
  nameDesc: '이름 Z-A',
  modifiedDesc: '최근 수정',
  modifiedAsc: '오래 안 고침',
  createdDesc: '최근 생성',
  createdAsc: '오래된 생성',
  sizeDesc: '큰 파일',
  sizeAsc: '작은 파일',
  lengthDesc: '긴 문서',
  lengthAsc: '짧은 문서',
};

const FILTER_DESCRIPTIONS: Record<FileBrowserFilterMode, string> = {
  all: '전체',
  pinned: 'Pinned',
  recent: 'Recent',
  stale: '오래 안 고침',
  long: '긴 문서',
  large: '큰 파일',
};

interface MarkdownFileMetadata {
  ctime?: number;
  mtime?: number;
  size?: number;
  lineCount?: number;
  title?: string;
  gitStatus?: string;
}

interface LineCountCacheEntry {
  key: string;
  lineCount: number;
  title?: string;
}

interface FolderSummary {
  total: number;
  recent: number;
  stale: number;
}

export class MarkdownFileBrowserProvider implements vscode.TreeDataProvider<MarkdownFileItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    MarkdownFileItem | undefined | null
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private tree = new Map<string, MarkdownFileItem[]>(); // folderFsPath -> children
  private itemByPath = new Map<string, MarkdownFileItem>(); // fsPath -> item (needed for getParent)
  private roots: MarkdownFileItem[] = [];
  private watcher: vscode.FileSystemWatcher | undefined;
  private watcherDisposables: vscode.Disposable[] = [];
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private sortOrder: FileBrowserSortOrder;
  private filterMode: FileBrowserFilterMode;
  private extraExtensions: string[];
  private pinnedPaths: string[];
  private recentPaths: string[];
  private hiddenPaths: string[];
  private focusRootPath: string | null;
  private pinnedRoot: MarkdownFileItem | null = null;
  private recentRoot: MarkdownFileItem | null = null;
  private filterRoot: MarkdownFileItem | null = null;
  private metadataByPath = new Map<string, MarkdownFileMetadata>();
  private folderSummaryByPath = new Map<string, FolderSummary>();
  private lineCountCache = new Map<string, LineCountCacheEntry>();
  private allUris: vscode.Uri[] = [];
  private visibleUris: vscode.Uri[] = [];
  private refreshRun = 0;
  private initialized = false;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.sortOrder = readSortOrder(context);
    this.filterMode = readFilterMode(context);
    this.extraExtensions = readExtraFileExtensions();
    this.pinnedPaths = readPinnedPaths(context);
    this.recentPaths = readRecentPaths(context);
    this.hiddenPaths = readHiddenPaths(context);
    this.focusRootPath = readFocusRootPath(context);
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration('mdStudioFileBrowser.extraExtensions')) return;
        const nextExtraExtensions = readExtraFileExtensions();
        if (sameExtensionArray(this.extraExtensions, nextExtraExtensions)) return;
        this.extraExtensions = nextExtraExtensions;
        if (this.initialized) {
          this.resetFileWatcher();
          this.scheduleRefresh();
        }
      }),
      {
        dispose: () => this.disposeWatcher(),
      },
    );
  }

  private resetFileWatcher(): void {
    this.disposeWatcher();
    this.watcher = vscode.workspace.createFileSystemWatcher(this.getFindFilesPattern());
    this.watcherDisposables = [
      this.watcher,
      this.watcher.onDidCreate(() => this.scheduleRefresh()),
      this.watcher.onDidChange(() => this.scheduleRefresh()),
      this.watcher.onDidDelete(() => this.scheduleRefresh()),
    ];
  }

  private disposeWatcher(): void {
    for (const disposable of this.watcherDisposables) {
      disposable.dispose();
    }
    this.watcherDisposables = [];
    this.watcher = undefined;
  }

  private scheduleRefresh(): void {
    if (!this.initialized) return;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.refresh(), 300);
  }

  getTreeItem(element: MarkdownFileItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: MarkdownFileItem): vscode.ProviderResult<MarkdownFileItem[]> {
    if (!element) {
      if (!this.initialized) {
        return this.refresh().then(() => this.roots);
      }
      return this.roots;
    }
    if (!element.isDirectory) return [];
    if (element.contextValue === 'mdPinnedRoot') return this.tree.get(PINNED_ROOT_KEY) ?? [];
    if (element.contextValue === 'mdRecentRoot') return this.tree.get(RECENT_ROOT_KEY) ?? [];
    if (element.contextValue === 'mdFilterRoot') return this.tree.get(FILTER_ROOT_KEY) ?? [];
    return this.getOrBuildFolderChildren(element.resourceUri.fsPath);
  }

  // Required for treeView.reveal() to work
  getParent(element: MarkdownFileItem): MarkdownFileItem | null {
    if (element.contextValue === 'mdPinnedFile' || element.contextValue === 'mdExtraPinnedFile') return this.pinnedRoot;
    if (element.contextValue === 'mdRecentFile' || element.contextValue === 'mdExtraRecentFile') return this.recentRoot;
    if (
      element.contextValue === 'mdFilterFile' ||
      element.contextValue === 'mdFilterFilePinned' ||
      element.contextValue === 'mdExtraFilterFile' ||
      element.contextValue === 'mdExtraFilterFilePinned'
    ) return this.filterRoot;
    if (this.filterMode !== 'all' && !element.isDirectory) {
      if (this.containsResource(FILTER_ROOT_KEY, element.resourceUri.fsPath)) return this.filterRoot;
      if (this.containsResource(RECENT_ROOT_KEY, element.resourceUri.fsPath)) return this.recentRoot;
      if (this.containsResource(PINNED_ROOT_KEY, element.resourceUri.fsPath)) return this.pinnedRoot;
    }
    if (this.roots.some((r) => r.resourceUri.fsPath === element.resourceUri.fsPath)) return null;
    const parentPath = path.dirname(element.resourceUri.fsPath);
    const workspaceFolder = findWorkspaceFolderForPath(element.resourceUri.fsPath);
    if (!workspaceFolder) return this.itemByPath.get(parentPath) ?? null;
    if (sameFsPath(parentPath, workspaceFolder.uri.fsPath)) {
      return (vscode.workspace.workspaceFolders?.length ?? 0) > 1
        ? this.itemByPath.get(workspaceFolder.uri.fsPath) ?? null
        : null;
    }
    return this.getOrCreateFolderItem(parentPath, workspaceFolder.uri.fsPath);
  }

  getSortOrder(): FileBrowserSortOrder {
    return this.sortOrder;
  }

  getSortDescription(): string {
    const parts = [SORT_DESCRIPTIONS[this.sortOrder], FILTER_DESCRIPTIONS[this.filterMode]];
    if (this.extraExtensions.length) parts.push(this.extraExtensions.join(', '));
    if (this.focusRootPath) parts.push('FOCUS');
    return parts.join(' · ');
  }

  async setSortOrder(sortOrder: FileBrowserSortOrder): Promise<void> {
    if (this.sortOrder === sortOrder) return;
    this.sortOrder = sortOrder;
    await this.context.workspaceState.update(SORT_STATE_KEY, sortOrder);
    await this.refresh();
  }

  getFilterMode(): FileBrowserFilterMode {
    return this.filterMode;
  }

  getExtraExtensions(): string[] {
    return [...this.extraExtensions];
  }

  getIncludedExtensions(): string[] {
    return getBrowserFileExtensions(this.extraExtensions);
  }

  getExtensionDescription(): string {
    const extra = this.extraExtensions.length ? this.extraExtensions.join(', ') : '추가 없음';
    return `Markdown + ${extra}`;
  }

  async setExtraExtensions(extraExtensions: readonly string[]): Promise<void> {
    const normalized = normalizeExtraFileExtensions([...extraExtensions]);
    if (sameExtensionArray(this.extraExtensions, normalized)) return;
    this.extraExtensions = normalized;
    await vscode.workspace
      .getConfiguration('mdStudioFileBrowser')
      .update('extraExtensions', normalized, vscode.ConfigurationTarget.Workspace);
    this.resetFileWatcher();
    await this.refresh();
  }

  async setFilterMode(filterMode: FileBrowserFilterMode): Promise<void> {
    if (this.filterMode === filterMode) return;
    this.filterMode = filterMode;
    await this.context.workspaceState.update(FILTER_STATE_KEY, filterMode);
    await this.refresh();
  }

  isPinned(resourceUri: vscode.Uri): boolean {
    return this.pinnedPaths.some((storedPath) => sameFsPath(storedPath, resourceUri.fsPath));
  }

  isHiddenByRule(resourceUri: vscode.Uri): boolean {
    return this.hiddenPaths.some((hiddenPath) => isSameOrDescendant(resourceUri.fsPath, hiddenPath));
  }

  isVisibleByRule(resourceUri: vscode.Uri): boolean {
    return !this.isHiddenByRule(resourceUri) && this.isInFocus(resourceUri);
  }

  isFocusActive(): boolean {
    return Boolean(this.focusRootPath);
  }

  async findVisibleFiles(): Promise<vscode.Uri[]> {
    const uris = this.initialized ? this.allUris : await this.findAllFiles();
    return uris.filter((uri) => this.isVisibleByRule(uri));
  }

  getFocusItem(): FileBrowserHiddenItem | null {
    if (!this.focusRootPath) return null;
    const relative = formatRelativeParentPath(this.focusRootPath);
    return {
      fsPath: this.focusRootPath,
      label: path.basename(this.focusRootPath),
      description: relative === 'workspace root' ? '' : relative,
    };
  }

  getHiddenItems(): FileBrowserHiddenItem[] {
    const includeWorkspaceName = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
    return this.hiddenPaths
      .map((fsPath) => {
        const relative = vscode.workspace.asRelativePath(vscode.Uri.file(fsPath), includeWorkspaceName);
        const parent = path.dirname(relative);
        return {
          fsPath,
          label: path.basename(fsPath),
          description: parent === '.' ? '' : parent,
        };
      })
      .sort((a, b) => a.description.localeCompare(b.description) || a.label.localeCompare(b.label));
  }

  async focusFolder(resourceUri: vscode.Uri): Promise<void> {
    if (this.focusRootPath && sameFsPath(this.focusRootPath, resourceUri.fsPath)) return;
    this.focusRootPath = resourceUri.fsPath;
    await this.persistFocusRootPath();
    await this.refresh();
  }

  async clearFocus(): Promise<void> {
    if (!this.focusRootPath) return;
    this.focusRootPath = null;
    await this.persistFocusRootPath();
    await this.refresh();
  }

  async hideItem(resourceUri: vscode.Uri): Promise<void> {
    if (this.isHiddenByRule(resourceUri)) return;
    this.hiddenPaths = [
      resourceUri.fsPath,
      ...this.hiddenPaths.filter((storedPath) => !isSameOrDescendant(storedPath, resourceUri.fsPath)),
    ];
    await this.persistHiddenPaths();
    await this.refresh();
  }

  async unhideItem(fsPath: string): Promise<void> {
    const nextHiddenPaths = this.hiddenPaths.filter((storedPath) => !sameFsPath(storedPath, fsPath));
    if (nextHiddenPaths.length === this.hiddenPaths.length) return;
    this.hiddenPaths = nextHiddenPaths;
    await this.persistHiddenPaths();
    await this.refresh();
  }

  async clearHiddenItems(): Promise<void> {
    if (!this.hiddenPaths.length) return;
    this.hiddenPaths = [];
    await this.persistHiddenPaths();
    await this.refresh();
  }

  async pinFile(resourceUri: vscode.Uri): Promise<void> {
    if (this.isPinned(resourceUri)) return;
    this.pinnedPaths = [resourceUri.fsPath, ...this.pinnedPaths];
    this.recentPaths = this.recentPaths.filter((storedPath) => !sameFsPath(storedPath, resourceUri.fsPath));
    await this.persistPinnedPaths();
    await this.persistRecentPaths();
    await this.refresh();
  }

  async unpinFile(resourceUri: vscode.Uri): Promise<void> {
    const nextPinnedPaths = this.pinnedPaths.filter((storedPath) => !sameFsPath(storedPath, resourceUri.fsPath));
    if (nextPinnedPaths.length === this.pinnedPaths.length) return;
    this.pinnedPaths = nextPinnedPaths;
    await this.persistPinnedPaths();
    await this.refresh();
  }

  async recordRecentFile(resourceUri: vscode.Uri): Promise<void> {
    if (this.isHiddenByRule(resourceUri)) return;
    if (this.isPinned(resourceUri)) {
      const nextRecentPaths = this.recentPaths.filter((storedPath) => !sameFsPath(storedPath, resourceUri.fsPath));
      if (nextRecentPaths.length !== this.recentPaths.length) {
        this.recentPaths = nextRecentPaths;
        await this.persistRecentPaths();
        this.scheduleRefresh();
      }
      return;
    }

    const nextRecentPaths = [
      resourceUri.fsPath,
      ...this.recentPaths.filter((storedPath) => !sameFsPath(storedPath, resourceUri.fsPath)),
    ].slice(0, MAX_RECENT_FILES);

    if (sameStringArray(nextRecentPaths, this.recentPaths)) return;
    this.recentPaths = nextRecentPaths;
    await this.persistRecentPaths();
    this.scheduleRefresh();
  }

  private getFindFilesPattern(): string {
    return buildExtensionGlob(this.getIncludedExtensions());
  }

  private async findAllFiles(): Promise<vscode.Uri[]> {
    return vscode.workspace.findFiles(this.getFindFilesPattern(), DEFAULT_FILE_BROWSER_EXCLUDE_GLOB);
  }

  async refresh(): Promise<void> {
    if (!this.initialized) {
      this.initialized = true;
      this.resetFileWatcher();
    }
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    const refreshRun = ++this.refreshRun;
    this.tree.clear();
    this.itemByPath.clear();
    this.roots = [];
    this.pinnedRoot = null;
    this.recentRoot = null;
    this.filterRoot = null;
    this.metadataByPath.clear();
    this.folderSummaryByPath.clear();
    this.allUris = [];
    this.visibleUris = [];

    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) {
      this._onDidChangeTreeData.fire(null);
      return;
    }

    const uris = await this.findAllFiles();
    if (refreshRun !== this.refreshRun) return;

    this.allUris = uris;
    this.pruneLineCountCache(uris);
    await this.prunePinnedPaths(uris);
    await this.pruneRecentPaths(uris);
    const metadataByPath = this.shouldLoadMetadata() ? await this.loadMetadata(uris) : new Map();
    if (refreshRun !== this.refreshRun) return;
    this.metadataByPath = metadataByPath;
    const visibleUris = uris.filter((uri) => this.isVisibleByRule(uri));
    this.visibleUris = visibleUris;
    this.folderSummaryByPath = buildFolderSummaries(visibleUris, this.metadataByPath, folders);

    for (const workspaceFolder of folders) {
      const rootFsPath = workspaceFolder.uri.fsPath;
      if (folders.length > 1) {
        const wsItem = new MarkdownFileItem(workspaceFolder.uri, true, workspaceFolder.name);
        wsItem.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
        this.itemByPath.set(rootFsPath, wsItem);
        this.roots.push(wsItem);
      } else {
        this.roots.push(...this.getOrBuildFolderChildren(rootFsPath));
      }
    }

    this.applyFilterAndVirtualRoots(visibleUris, uris);

    this._onDidChangeTreeData.fire(null);
  }

  private getOrBuildFolderChildren(folderPath: string): MarkdownFileItem[] {
    const cached = this.tree.get(folderPath);
    if (cached) return cached;

    const childDirs = new Set<string>();
    const children: MarkdownFileItem[] = [];
    for (const uri of this.visibleUris) {
      const parentPath = path.dirname(uri.fsPath);
      if (sameFsPath(parentPath, folderPath)) {
        const item = new MarkdownFileItem(uri, false);
        this.decorateFileItem(item);
        children.push(item);
        this.itemByPath.set(uri.fsPath, item);
        continue;
      }

      if (!isSameOrDescendant(parentPath, folderPath)) continue;
      const relative = path.relative(folderPath, parentPath);
      const firstSegment = relative.split(/[\\/]/).find(Boolean);
      if (firstSegment) childDirs.add(path.join(folderPath, firstSegment));
    }

    for (const childDir of childDirs) {
      const item = this.getOrCreateFolderItem(childDir, folderPath);
      if (item) children.push(item);
    }

    const sorted = sortChildren(children, this.sortOrder, this.metadataByPath);
    this.tree.set(folderPath, sorted);
    return sorted;
  }

  private getOrCreateFolderItem(dir: string, parentBoundary: string): MarkdownFileItem | null {
    const cached = this.itemByPath.get(dir);
    if (cached) return cached;
    if (!isSameOrDescendant(dir, parentBoundary)) return null;

    const item = new MarkdownFileItem(vscode.Uri.file(dir), true, path.basename(dir));
    this.decorateFolderItem(item, dir);
    this.itemByPath.set(dir, item);
    return item;
  }

  private shouldLoadMetadata(): boolean {
    if (this.sortOrder !== 'nameAsc' && this.sortOrder !== 'nameDesc') return true;
    return this.filterMode === 'stale' || this.filterMode === 'long' || this.filterMode === 'large';
  }

  private shouldReadMarkdownContentForMetadata(): boolean {
    return this.sortOrder === 'lengthAsc' || this.sortOrder === 'lengthDesc' || this.filterMode === 'long';
  }

  private async loadMetadata(uris: vscode.Uri[]): Promise<Map<string, MarkdownFileMetadata>> {
    const metadataByPath = new Map<string, MarkdownFileMetadata>();
    const gitStatusByPath = await readGitStatusByPath();
    const readContent = this.shouldReadMarkdownContentForMetadata();
    await forEachWithConcurrency(uris, MAX_METADATA_READ_CONCURRENCY, async (uri) => {
      try {
        const stat = await vscode.workspace.fs.stat(uri);
        const analysis: { lineCount?: number; title?: string } = readContent
          ? await this.getMarkdownAnalysis(uri, stat)
          : {};
        const metadata: MarkdownFileMetadata = {
          ctime: stat.ctime,
          mtime: stat.mtime,
          size: stat.size,
          lineCount: analysis.lineCount,
          title: analysis.title,
          gitStatus: gitStatusByPath.get(normalizeFsPath(uri.fsPath)),
        };
        metadataByPath.set(uri.fsPath, metadata);
      } catch {
        // Missing metadata falls back to name sorting.
      }
    });
    return metadataByPath;
  }

  private pruneLineCountCache(uris: vscode.Uri[]): void {
    const activePaths = new Set(uris.map((uri) => uri.fsPath));
    for (const fsPath of this.lineCountCache.keys()) {
      if (!activePaths.has(fsPath)) this.lineCountCache.delete(fsPath);
    }
  }

  private async getMarkdownAnalysis(
    uri: vscode.Uri,
    stat: vscode.FileStat,
  ): Promise<{ lineCount: number; title?: string }> {
    const cacheKey = `${uri.fsPath}:${stat.mtime}:${stat.size}`;
    const cached = this.lineCountCache.get(uri.fsPath);
    if (cached?.key === cacheKey) return { lineCount: cached.lineCount, title: cached.title };

    const bytes = await vscode.workspace.fs.readFile(uri);
    let lineCount = bytes.length === 0 ? 0 : 1;
    for (const byte of bytes) {
      if (byte === 10) lineCount += 1;
    }

    const title = extractFirstH1(Buffer.from(bytes).toString('utf8'));
    this.lineCountCache.set(uri.fsPath, { key: cacheKey, lineCount, title });
    return { lineCount, title };
  }

  private decorateFileItem(item: MarkdownFileItem): void {
    const metadata = this.metadataByPath.get(item.resourceUri.fsPath);
    const isMarkdown = isMarkdownFileUri(item.resourceUri);
    item.contextValue = this.isPinned(item.resourceUri)
      ? isMarkdown
        ? 'mdFilePinned'
        : 'mdExtraFilePinned'
      : isMarkdown
        ? 'mdFile'
        : 'mdExtraFile';
    item.description = formatMetadataDescription(metadata, this.sortOrder);
    item.tooltip = buildMetadataTooltip(item.resourceUri.fsPath, metadata);
  }

  private decoratePinnedFileItem(item: MarkdownFileItem): void {
    const metadata = this.metadataByPath.get(item.resourceUri.fsPath);
    item.contextValue = isMarkdownFileUri(item.resourceUri) ? 'mdPinnedFile' : 'mdExtraPinnedFile';
    item.description = formatMetadataDescription(metadata, this.sortOrder);
    item.tooltip = buildMetadataTooltip(item.resourceUri.fsPath, metadata, true);
  }

  private decorateVirtualFileItem(item: MarkdownFileItem, contextValue: string): void {
    const metadata = this.metadataByPath.get(item.resourceUri.fsPath);
    item.contextValue = contextValue;
    item.description = formatMetadataDescription(metadata, this.sortOrder);
    item.tooltip = buildMetadataTooltip(item.resourceUri.fsPath, metadata, true);
  }

  private decorateFolderItem(item: MarkdownFileItem, dir: string): void {
    const summary = this.folderSummaryByPath.get(normalizeFsPath(dir)) ?? { total: 0, recent: 0, stale: 0 };
    if (!summary.total) return;

    const parts = [`${summary.total.toLocaleString()}파일`];
    if (summary.recent > 0) parts.push(`${summary.recent.toLocaleString()}개 최근`);
    if (summary.stale > 0) parts.push(`${summary.stale.toLocaleString()}개 오래됨`);
    item.description = parts.join(' · ');
    item.tooltip = [
      dir,
      `파일: ${summary.total.toLocaleString()}개`,
      `최근 24시간: ${summary.recent.toLocaleString()}개`,
      `30일+ 미수정: ${summary.stale.toLocaleString()}개`,
    ].join('\n');
  }

  private prependPinnedRoot(uris: vscode.Uri[]): void {
    const uriByPath = new Map<string, vscode.Uri>();
    for (const uri of uris) {
      if (this.isVisibleByRule(uri)) {
        uriByPath.set(normalizeFsPath(uri.fsPath), uri);
      }
    }

    const pinnedUris = this.pinnedPaths
      .map((fsPath) => uriByPath.get(normalizeFsPath(fsPath)) ?? null)
      .filter((uri): uri is vscode.Uri => Boolean(uri));

    if (!pinnedUris.length) return;

    const pinnedRoot = new MarkdownFileItem(vscode.Uri.parse('md-studio-file-browser:/pinned'), true, 'Pinned');
    pinnedRoot.contextValue = 'mdPinnedRoot';
    pinnedRoot.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
    pinnedRoot.iconPath = new vscode.ThemeIcon('pinned');
    pinnedRoot.tooltip = 'Pinned MD Studio files';

    const pinnedItems = pinnedUris.map((uri) => {
      const item = new MarkdownFileItem(uri, false);
      item.iconPath = new vscode.ThemeIcon('pinned');
      this.decoratePinnedFileItem(item);
      return item;
    });

    this.pinnedRoot = pinnedRoot;
    this.tree.set(PINNED_ROOT_KEY, pinnedItems);
    this.roots.unshift(pinnedRoot);
  }

  private prependRecentRoot(uris: vscode.Uri[]): void {
    const uriByPath = new Map<string, vscode.Uri>();
    for (const uri of uris) {
      uriByPath.set(normalizeFsPath(uri.fsPath), uri);
    }

    const recentUris = this.recentPaths
      .filter((fsPath) => !this.pinnedPaths.some((pinnedPath) => sameFsPath(pinnedPath, fsPath)))
      .map((fsPath) => uriByPath.get(normalizeFsPath(fsPath)) ?? null)
      .filter((uri): uri is vscode.Uri => Boolean(uri));

    if (!recentUris.length) return;

    const recentRoot = new MarkdownFileItem(vscode.Uri.parse('md-studio-file-browser:/recent'), true, 'Recent');
    recentRoot.contextValue = 'mdRecentRoot';
    recentRoot.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
    recentRoot.iconPath = new vscode.ThemeIcon('history');
    recentRoot.tooltip = 'Recently opened MD Studio files';

    const recentItems = recentUris.map((uri) => {
      const item = new MarkdownFileItem(uri, false);
      item.iconPath = new vscode.ThemeIcon('history');
      this.decorateVirtualFileItem(item, isMarkdownFileUri(uri) ? 'mdRecentFile' : 'mdExtraRecentFile');
      return item;
    });

    this.recentRoot = recentRoot;
    this.tree.set(RECENT_ROOT_KEY, recentItems);
    this.roots.unshift(recentRoot);
  }

  private prependFilterRoot(uris: vscode.Uri[]): void {
    const candidates = this.getFilterCandidates(uris);
    if (!candidates.length) return;

    const filterRoot = new MarkdownFileItem(
      vscode.Uri.parse(`md-studio-file-browser:/filter/${this.filterMode}`),
      true,
      FILTER_DESCRIPTIONS[this.filterMode],
    );
    filterRoot.contextValue = 'mdFilterRoot';
    filterRoot.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
    filterRoot.iconPath = new vscode.ThemeIcon('filter');
    filterRoot.tooltip = `${FILTER_DESCRIPTIONS[this.filterMode]} MD Studio files`;

    const filterItems = candidates.map((uri) => {
      const item = new MarkdownFileItem(uri, false);
      const pinned = this.isPinned(uri);
      item.iconPath = pinned
        ? new vscode.ThemeIcon('pinned')
        : new vscode.ThemeIcon(isMarkdownFileUri(uri) ? 'markdown' : 'file');
      const contextValue = pinned
        ? isMarkdownFileUri(uri)
          ? 'mdFilterFilePinned'
          : 'mdExtraFilterFilePinned'
        : isMarkdownFileUri(uri)
          ? 'mdFilterFile'
          : 'mdExtraFilterFile';
      this.decorateVirtualFileItem(item, contextValue);
      return item;
    });

    this.filterRoot = filterRoot;
    this.tree.set(FILTER_ROOT_KEY, filterItems);
    this.roots.unshift(filterRoot);
  }

  private getFilterCandidates(uris: vscode.Uri[]): vscode.Uri[] {
    const now = Date.now();
    const withMetadata = uris
      .map((uri) => ({ uri, metadata: this.metadataByPath.get(uri.fsPath) }))
      .filter((entry): entry is { uri: vscode.Uri; metadata: MarkdownFileMetadata } => Boolean(entry.metadata));

    switch (this.filterMode) {
      case 'stale':
        return withMetadata
          .filter(({ metadata }) => metadata.mtime !== undefined && now - metadata.mtime >= STALE_FILE_THRESHOLD_MS)
          .sort((a, b) => (a.metadata.mtime ?? 0) - (b.metadata.mtime ?? 0) || compareUriName(a.uri, b.uri))
          .map(({ uri }) => uri);
      case 'long':
        return withMetadata
          .sort((a, b) => (b.metadata.lineCount ?? 0) - (a.metadata.lineCount ?? 0) || compareUriName(a.uri, b.uri))
          .slice(0, FILTER_RESULT_LIMIT)
          .map(({ uri }) => uri);
      case 'large':
        return withMetadata
          .sort((a, b) => (b.metadata.size ?? 0) - (a.metadata.size ?? 0) || compareUriName(a.uri, b.uri))
          .slice(0, FILTER_RESULT_LIMIT)
          .map(({ uri }) => uri);
      default:
        return [];
    }
  }

  private applyFilterAndVirtualRoots(visibleUris: vscode.Uri[], allUris: vscode.Uri[]): void {
    if (this.filterMode === 'all') {
      this.prependRecentRoot(visibleUris);
      this.prependPinnedRoot(allUris);
      return;
    }

    this.roots = [];
    if (this.filterMode === 'pinned') {
      this.prependPinnedRoot(allUris);
      return;
    }
    if (this.filterMode === 'recent') {
      this.prependRecentRoot(visibleUris);
      return;
    }
    this.prependFilterRoot(visibleUris);
  }

  private containsResource(treeKey: string, fsPath: string): boolean {
    const items = this.tree.get(treeKey) ?? [];
    return items.some((item) => sameFsPath(item.resourceUri.fsPath, fsPath));
  }

  private async prunePinnedPaths(uris: vscode.Uri[]): Promise<void> {
    if (!this.pinnedPaths.length) return;
    const activePaths = new Set(uris.map((uri) => normalizeFsPath(uri.fsPath)));
    const nextPinnedPaths = this.pinnedPaths.filter((fsPath) => activePaths.has(normalizeFsPath(fsPath)));
    if (nextPinnedPaths.length === this.pinnedPaths.length) return;
    this.pinnedPaths = nextPinnedPaths;
    await this.persistPinnedPaths();
  }

  private async persistPinnedPaths(): Promise<void> {
    await this.context.workspaceState.update(PINNED_STATE_KEY, this.pinnedPaths);
  }

  private async pruneRecentPaths(uris: vscode.Uri[]): Promise<void> {
    if (!this.recentPaths.length) return;
    const activePaths = new Set(uris.map((uri) => normalizeFsPath(uri.fsPath)));
    const nextRecentPaths = this.recentPaths.filter((fsPath) => activePaths.has(normalizeFsPath(fsPath)));
    if (nextRecentPaths.length === this.recentPaths.length) return;
    this.recentPaths = nextRecentPaths;
    await this.persistRecentPaths();
  }

  private async persistRecentPaths(): Promise<void> {
    await this.context.workspaceState.update(RECENT_STATE_KEY, this.recentPaths);
  }

  private async persistHiddenPaths(): Promise<void> {
    await this.context.workspaceState.update(HIDDEN_STATE_KEY, this.hiddenPaths);
  }

  private isInFocus(resourceUri: vscode.Uri): boolean {
    if (!this.focusRootPath) return true;
    return isSameOrDescendant(resourceUri.fsPath, this.focusRootPath);
  }

  private async persistFocusRootPath(): Promise<void> {
    await this.context.workspaceState.update(FOCUS_STATE_KEY, this.focusRootPath ?? undefined);
  }
}

function sortChildren(
  items: MarkdownFileItem[],
  sortOrder: FileBrowserSortOrder,
  metadataByPath: Map<string, MarkdownFileMetadata>,
): MarkdownFileItem[] {
  return [...items].sort((a, b) => {
    // Folders before files
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    if (a.isDirectory && b.isDirectory) {
      const direction = sortOrder === 'nameDesc' ? -1 : 1;
      return compareByName(a, b) * direction;
    }

    const nameDirection = sortOrder === 'nameDesc' ? -1 : 1;
    if (sortOrder === 'nameAsc' || sortOrder === 'nameDesc') {
      return compareByName(a, b) * nameDirection;
    }

    const metadataCompare = compareByMetadata(a, b, sortOrder, metadataByPath);
    return metadataCompare || compareByName(a, b);
  });
}

function compareByMetadata(
  a: MarkdownFileItem,
  b: MarkdownFileItem,
  sortOrder: FileBrowserSortOrder,
  metadataByPath: Map<string, MarkdownFileMetadata>,
): number {
  const aValue = getMetadataValue(a, sortOrder, metadataByPath);
  const bValue = getMetadataValue(b, sortOrder, metadataByPath);
  if (!Number.isFinite(aValue) || !Number.isFinite(bValue)) return 0;
  if (aValue === bValue) return 0;
  const ascending = sortOrder.endsWith('Asc');
  return ascending ? aValue - bValue : bValue - aValue;
}

function getMetadataValue(
  item: MarkdownFileItem,
  sortOrder: FileBrowserSortOrder,
  metadataByPath: Map<string, MarkdownFileMetadata>,
): number {
  const metadata = metadataByPath.get(item.resourceUri.fsPath);
  if (!metadata) return Number.NaN;
  switch (sortOrder) {
    case 'modifiedAsc':
    case 'modifiedDesc':
      return metadata.mtime ?? Number.NaN;
    case 'createdAsc':
    case 'createdDesc':
      return metadata.ctime ?? Number.NaN;
    case 'sizeAsc':
    case 'sizeDesc':
      return metadata.size ?? Number.NaN;
    case 'lengthAsc':
    case 'lengthDesc':
      return metadata.lineCount ?? Number.NaN;
    default:
      return Number.NaN;
  }
}

function compareByName(a: MarkdownFileItem, b: MarkdownFileItem): number {
  const aName = a.label?.toString() ?? path.basename(a.resourceUri.fsPath);
  const bName = b.label?.toString() ?? path.basename(b.resourceUri.fsPath);
  const labelCompare = aName.localeCompare(bName, undefined, { sensitivity: 'base' });
  if (labelCompare !== 0) return labelCompare;
  return a.resourceUri.fsPath.localeCompare(b.resourceUri.fsPath, undefined, { sensitivity: 'base' });
}

function compareUriName(a: vscode.Uri, b: vscode.Uri): number {
  const labelCompare = path
    .basename(a.fsPath)
    .localeCompare(path.basename(b.fsPath), undefined, { sensitivity: 'base' });
  if (labelCompare !== 0) return labelCompare;
  return a.fsPath.localeCompare(b.fsPath, undefined, { sensitivity: 'base' });
}

function formatMetadataDescription(
  metadata: MarkdownFileMetadata | undefined,
  sortOrder: FileBrowserSortOrder,
): string | undefined {
  if (!metadata) return undefined;
  const value = formatMetadataValue(metadata, sortOrder);
  const parts = [metadata.gitStatus, value].filter((part): part is string => Boolean(part));
  return parts.length ? parts.join(' ') : undefined;
}

function formatMetadataValue(
  metadata: MarkdownFileMetadata,
  sortOrder: FileBrowserSortOrder,
): string | undefined {
  switch (sortOrder) {
    case 'modifiedAsc':
    case 'modifiedDesc':
      return metadata.mtime === undefined ? undefined : formatRelativeAge(metadata.mtime);
    case 'createdAsc':
    case 'createdDesc':
      return metadata.ctime === undefined ? undefined : formatRelativeAge(metadata.ctime);
    case 'sizeAsc':
    case 'sizeDesc':
      return metadata.size === undefined ? undefined : formatFileSize(metadata.size);
    case 'lengthAsc':
    case 'lengthDesc':
      return metadata.lineCount === undefined ? undefined : `${metadata.lineCount.toLocaleString()}줄`;
    case 'nameAsc':
    case 'nameDesc':
      return metadata.size === undefined ? undefined : formatFileSize(metadata.size);
  }
}

function buildMetadataTooltip(
  fsPath: string,
  metadata: MarkdownFileMetadata | undefined,
  includeLocation = false,
): string {
  const details = [fsPath];
  if (includeLocation) details.push(`위치: ${formatRelativeParentPath(fsPath)}`);
  if (!metadata) return details.join('\n');
  if (metadata.title) details.push(`제목: ${metadata.title}`);
  if (metadata.gitStatus) details.push(`Git: ${metadata.gitStatus}`);
  if (metadata.mtime !== undefined) {
    details.push(`수정: ${formatFullDate(metadata.mtime)}`);
    details.push(`업데이트 안 한 지: ${formatDaysSince(metadata.mtime)}`);
  }
  if (metadata.ctime !== undefined) details.push(`생성: ${formatFullDate(metadata.ctime)}`);
  if (metadata.size !== undefined) {
    details.push(`크기: ${formatFileSize(metadata.size)} (${metadata.size.toLocaleString()} bytes)`);
  }
  if (metadata.lineCount !== undefined) details.push(`길이: ${metadata.lineCount.toLocaleString()}줄`);
  return details.join('\n');
}

function formatRelativeAge(timestamp: number): string {
  const elapsedMs = Date.now() - timestamp;
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return '방금';
  const elapsedMinutes = Math.floor(elapsedMs / 60000);
  if (elapsedMinutes < 1) return '방금';
  if (elapsedMinutes < 60) return `${elapsedMinutes}분전`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}시간전`;
  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 2) return '어제';
  if (elapsedDays < 14) return `${elapsedDays}일전`;
  const elapsedWeeks = Math.floor(elapsedDays / 7);
  if (elapsedWeeks < 8) return `${elapsedWeeks}주전`;
  return formatShortDate(timestamp);
}

function formatFullDate(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hours = pad2(date.getHours());
  const minutes = pad2(date.getMinutes());
  const seconds = pad2(date.getSeconds());
  return `${year}.${month}.${day} ${hours}:${minutes}:${seconds}`;
}

function formatShortDate(timestamp: number): string {
  const date = new Date(timestamp);
  const year = String(date.getFullYear()).slice(-2);
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  return `${year}.${month}.${day}`;
}

function formatDaysSince(timestamp: number): string {
  const elapsedMs = Date.now() - timestamp;
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return '오늘';
  const elapsedDays = Math.floor(elapsedMs / 86400000);
  if (elapsedDays < 1) return '오늘';
  return `${elapsedDays.toLocaleString()}일`;
}

function formatRelativeParentPath(fsPath: string): string {
  const includeWorkspaceName = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
  const relative = vscode.workspace.asRelativePath(vscode.Uri.file(fsPath), includeWorkspaceName);
  const parent = path.dirname(relative);
  return parent === '.' ? 'workspace root' : parent;
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const maximumFractionDigits = unitIndex === 0 || value >= 10 ? 0 : 1;
  return `${value.toLocaleString(undefined, { maximumFractionDigits })}${units[unitIndex]}`;
}

function buildFolderSummaries(
  uris: vscode.Uri[],
  metadataByPath: Map<string, MarkdownFileMetadata>,
  workspaceFolders: readonly vscode.WorkspaceFolder[],
): Map<string, FolderSummary> {
  const summaries = new Map<string, FolderSummary>();
  const now = Date.now();
  for (const uri of uris) {
    const metadata = metadataByPath.get(uri.fsPath);
    const recent = metadata?.mtime !== undefined && now - metadata.mtime >= 0 && now - metadata.mtime <= RECENT_FOLDER_THRESHOLD_MS;
    const stale = metadata?.mtime !== undefined && now - metadata.mtime >= STALE_FILE_THRESHOLD_MS;
    const workspaceFolder = workspaceFolders.find((folder) => isSameOrDescendant(uri.fsPath, folder.uri.fsPath));
    if (!workspaceFolder) continue;

    let current = path.dirname(uri.fsPath);
    while (isSameOrDescendant(current, workspaceFolder.uri.fsPath)) {
      const key = normalizeFsPath(current);
      const summary = summaries.get(key) ?? { total: 0, recent: 0, stale: 0 };
      summary.total += 1;
      if (recent) summary.recent += 1;
      if (stale) summary.stale += 1;
      summaries.set(key, summary);
      if (sameFsPath(current, workspaceFolder.uri.fsPath)) break;
      current = path.dirname(current);
    }
  }

  return summaries;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

async function forEachWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex++];
      await worker(item);
    }
  });
  await Promise.all(workers);
}

function isSameOrDescendant(candidatePath: string, rootPath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function findWorkspaceFolderForPath(fsPath: string): vscode.WorkspaceFolder | null {
  const folders = vscode.workspace.workspaceFolders ?? [];
  return folders.find((folder) => isSameOrDescendant(fsPath, folder.uri.fsPath)) ?? null;
}

function readSortOrder(context: vscode.ExtensionContext): FileBrowserSortOrder {
  const stored = context.workspaceState.get<unknown>(SORT_STATE_KEY);
  return isFileBrowserSortOrder(stored) ? stored : DEFAULT_FILE_BROWSER_SORT_ORDER;
}

function readFilterMode(context: vscode.ExtensionContext): FileBrowserFilterMode {
  const stored = context.workspaceState.get<unknown>(FILTER_STATE_KEY);
  return isFileBrowserFilterMode(stored) ? stored : DEFAULT_FILE_BROWSER_FILTER_MODE;
}

function readPinnedPaths(context: vscode.ExtensionContext): string[] {
  const stored = context.workspaceState.get<unknown>(PINNED_STATE_KEY);
  return readStoredFsPaths(stored);
}

function readRecentPaths(context: vscode.ExtensionContext): string[] {
  const stored = context.workspaceState.get<unknown>(RECENT_STATE_KEY);
  return readStoredFsPaths(stored).slice(0, MAX_RECENT_FILES);
}

function readHiddenPaths(context: vscode.ExtensionContext): string[] {
  const stored = context.workspaceState.get<unknown>(HIDDEN_STATE_KEY);
  return readStoredFsPaths(stored);
}

function readFocusRootPath(context: vscode.ExtensionContext): string | null {
  const stored = context.workspaceState.get<unknown>(FOCUS_STATE_KEY);
  if (typeof stored !== 'string' || !stored.trim()) return null;
  return stored;
}

function readStoredFsPaths(stored: unknown): string[] {
  if (!Array.isArray(stored)) return [];
  const fsPaths: string[] = [];
  for (const item of stored) {
    if (typeof item !== 'string' || !item.trim()) continue;
    if (fsPaths.some((storedPath) => sameFsPath(storedPath, item))) continue;
    fsPaths.push(item);
  }
  return fsPaths;
}

function sameStringArray(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => sameFsPath(value, b[index]));
}

function sameExtensionArray(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function sameFsPath(a: string, b: string): boolean {
  return normalizeFsPath(a) === normalizeFsPath(b);
}

function normalizeFsPath(fsPath: string): string {
  const normalized = path.normalize(fsPath);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isFileBrowserSortOrder(value: unknown): value is FileBrowserSortOrder {
  return (
    value === 'nameAsc' ||
    value === 'nameDesc' ||
    value === 'modifiedDesc' ||
    value === 'modifiedAsc' ||
    value === 'createdDesc' ||
    value === 'createdAsc' ||
    value === 'sizeDesc' ||
    value === 'sizeAsc' ||
    value === 'lengthDesc' ||
    value === 'lengthAsc'
  );
}

function isFileBrowserFilterMode(value: unknown): value is FileBrowserFilterMode {
  return (
    value === 'all' ||
    value === 'pinned' ||
    value === 'recent' ||
    value === 'stale' ||
    value === 'long' ||
    value === 'large'
  );
}

function extractFirstH1(source: string): string | undefined {
  let inFence = false;
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const match = /^#(?!#)\s+(.+?)\s*$/.exec(line);
    if (!match) continue;

    const title = match[1].replace(/\s+#+\s*$/, '').trim();
    if (!title) continue;
    return title.length > 160 ? `${title.slice(0, 157)}...` : title;
  }
  return undefined;
}
