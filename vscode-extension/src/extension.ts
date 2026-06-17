import * as vscode from 'vscode';
import * as cp from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { downloadSkillFolderCommand } from './commands/exportSkillFolder.js';
import { openTemplateBuilderCommand } from './commands/templateBuilder.js';
import {
  type MarkdownFileBrowserController,
  registerMarkdownFileBrowser,
} from './fileBrowser/registerMarkdownFileBrowser.js';
import { getUriFromCommandArg, isMarkdownFile, isMarkdownFileUri, isMarkdownPath } from './utils/markdownFiles.js';
import { assertFileExists, delay, errorToMessage, fileExists } from './utils/runtime.js';
import { injectPreviewEnhancements } from './webview/previewEnhancements.js';
import { renderErrorHtml, setPanelStatus } from './webview/statusHtml.js';

type PreviewReason = 'open' | 'refresh' | 'save';

interface ExtensionConfig {
  autoOnSave: boolean;
  cursorSyncOnSave: boolean;
  nodePath: string;
  cliScriptPath: string;
  preferredViewMode: 'auto' | 'slides' | 'stack';
  extraArgs: string[];
  stripEmailDisclaimer: boolean;
}

interface AppearanceOptions {
  appearance: 'default' | 'clean' | 'flat' | 'reader' | 'print';
  appearanceBackground: 'default' | 'plain' | 'transparent';
  appearanceRadius: 'default' | 'soft' | 'none';
  appearanceFrame: 'default' | 'lines' | 'none';
  viewerChrome: 'full' | 'minimal' | 'hidden';
}

interface PreviewSession {
  panel: vscode.WebviewPanel;
  key: string;
  tempOutputPath: string | null;
  lastSyncedSectionId: string | null;
  isBridgeReady: boolean;
  pendingSyncSectionId: string | null;
  outlineCollapsed: boolean;
}

interface RenderOutput {
  html: string;
  workspaceFolder: vscode.WorkspaceFolder | null;
  outputPath: string;
  inputDir: string;
}

interface RunCliRendererOptions {
  outputPath?: string;
  forceStandalone?: boolean;
}

interface ParsedSection {
  id?: unknown;
  line?: unknown;
}

interface PreviewWebviewMessage {
  type?: unknown;
  collapsed?: unknown;
  appearance?: unknown;
  appearanceBackground?: unknown;
  appearanceRadius?: unknown;
  appearanceFrame?: unknown;
  viewerChrome?: unknown;
  href?: unknown;
  rawHref?: unknown;
  text?: unknown;
  title?: unknown;
}

type ParseMarkdownDocumentFn = (source: string) => { sections?: ParsedSection[] };

const sessions = new Map<string, PreviewSession>();
const renderQueue = new Map<string, Promise<void>>();
const parserCache = new Map<string, ParseMarkdownDocumentFn>();
const cursorLineCache = new Map<string, number>();
const cliPromptDismissedUntil = new Map<string, number>();
let lastPreviewKey: string | null = null;
let extensionInstallPath = '';
let extensionContextRef: vscode.ExtensionContext | null = null;
let fileBrowserController: MarkdownFileBrowserController | null = null;
let lastBrowserKey: string | null = null; // tracks the panel opened via file browser
let outputChannel: vscode.OutputChannel | null = null;
const outlineStateKeyPrefix = 'mdStudioPreview:outlineCollapsed:';
const appearanceStateKey = 'mdStudioPreview:appearance';
const autoOnSaveContextKey = 'mdStudioPreview.autoOnSaveEnabled';
const defaultAppearanceOptions: AppearanceOptions = {
  appearance: 'default',
  appearanceBackground: 'default',
  appearanceRadius: 'default',
  appearanceFrame: 'default',
  viewerChrome: 'full',
};
const dynamicImportModule = new Function('modulePath', 'return import(modulePath);') as (
  modulePath: string,
) => Promise<Record<string, unknown>>;
export function activate(context: vscode.ExtensionContext) {
  extensionInstallPath = context.extensionPath;
  extensionContextRef = context;
  outputChannel = vscode.window.createOutputChannel('Markdown Pattern Studio');
  context.subscriptions.push(outputChannel);
  void updateAutoOnSaveContext();
  context.subscriptions.push(
    vscode.commands.registerCommand('mdStudioPreview.open', async () => {
      const document = await resolveTargetDocument();
      if (!document) return;
      await queuePreview(document, 'open');
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mdStudioPreview.refresh', async () => {
      const document = await resolveTargetDocument();
      if (!document) return;
      await queuePreview(document, 'refresh');
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mdStudioPreview.openSourceEditor', async (commandArg?: unknown) => {
      await openMarkdownSourceEditor(commandArg);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mdStudioPreview.enableAutoOnSave', async () => {
      await setAutoOnSave(true);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mdStudioPreview.disableAutoOnSave', async () => {
      await setAutoOnSave(false);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mdStudioPreview.transformMarkdownToHtml', async (commandArg?: unknown) => {
      await transformMarkdownToHtml(commandArg);
    }),
  );

  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection((event) => {
      cacheCursorLineFromEditor(event.textEditor);
    }),
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      cacheCursorLineFromEditor(editor || null);
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((document) => {
      cursorLineCache.delete(document.uri.toString());
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('mdStudioPreview.autoOnSave')) {
        void updateAutoOnSaveContext();
      }
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onWillSaveTextDocument((event) => {
      const document = event.document;
      if (!isMarkdownFile(document)) return;
      captureCursorLineForDocument(document);
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (!isMarkdownFile(document)) return;
      captureCursorLineForDocument(document);
      const config = readConfig();
      if (!config.autoOnSave) return;
      void queuePreview(document, 'save');
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mdStudioPreview.openTemplateBuilder', async () => {
      await openTemplateBuilderCommand(context);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mdStudioPreview.downloadSkillFolder', async () => {
      await downloadSkillFolderCommand(context);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mdStudioPreview.diagnoseEnvironment', async () => {
      await diagnoseEnvironment();
    }),
  );

  fileBrowserController = registerMarkdownFileBrowser(context, {
    openInEditor: openUriInTextEditor,
    resolveMarkdownUri: resolveMarkdownUriFromCommandArg,
    openInViewer: openMarkdownInBrowserPanel,
    openInNewPanel: openMarkdownInNewPanel,
  });
}

export function deactivate() {
  for (const session of sessions.values()) {
    void cleanupTempFile(session.tempOutputPath);
    session.panel.dispose();
  }
  sessions.clear();
  extensionContextRef = null;
  fileBrowserController = null;
  lastBrowserKey = null;
  outputChannel = null;
}

function readConfig(): ExtensionConfig {
  const config = vscode.workspace.getConfiguration('mdStudioPreview');
  const autoOnSave = config.get<boolean>('autoOnSave', true);
  const cursorSyncOnSave = config.get<boolean>('cursorSyncOnSave', true);
  const nodePath = String(config.get<string>('nodePath', 'node') || 'node').trim() || 'node';
  const cliScriptPath =
    String(config.get<string>('cliScriptPath', 'scripts/md-to-html.mjs') || 'scripts/md-to-html.mjs').trim() ||
    'scripts/md-to-html.mjs';
  const rawExtraArgs = config.get<unknown>('extraArgs', ['--standalone']);
  const extraArgs = Array.isArray(rawExtraArgs)
    ? rawExtraArgs.filter((item): item is string => typeof item === 'string')
    : ['--standalone'];
  const rawPreferredViewMode = String(config.get<string>('preferredViewMode', 'stack') || 'stack').trim().toLowerCase();
  const preferredViewMode: 'auto' | 'slides' | 'stack' =
    rawPreferredViewMode === 'slides' || rawPreferredViewMode === 'stack' ? rawPreferredViewMode : 'auto';
  const stripEmailDisclaimer = config.get<boolean>('stripEmailDisclaimer', false);
  return { autoOnSave, cursorSyncOnSave, nodePath, cliScriptPath, preferredViewMode, extraArgs, stripEmailDisclaimer };
}

async function setAutoOnSave(enabled: boolean): Promise<void> {
  const config = vscode.workspace.getConfiguration('mdStudioPreview');
  const inspected = config.inspect<boolean>('autoOnSave');
  const target =
    inspected?.workspaceValue !== undefined ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
  await config.update('autoOnSave', enabled, target);
  await updateAutoOnSaveContext();
  await openPreferredViewForCurrentMarkdown(enabled);
  void vscode.window.showInformationMessage(`MD Studio auto refresh on save: ${enabled ? 'On' : 'Off'}`);
}

async function updateAutoOnSaveContext(): Promise<void> {
  await vscode.commands.executeCommand('setContext', autoOnSaveContextKey, readConfig().autoOnSave);
}

async function transformMarkdownToHtml(commandArg?: unknown): Promise<void> {
  let sourceUri: vscode.Uri;
  let skipSaveDialog = false;
  const explorerUri = getUriFromCommandArg(commandArg);

  if (explorerUri && isMarkdownFileUri(explorerUri)) {
    sourceUri = explorerUri;
    skipSaveDialog = true;
  } else {
    const sourceDocument = vscode.window.activeTextEditor?.document;
    if (!sourceDocument || !isMarkdownFile(sourceDocument)) {
      void vscode.window.showErrorMessage('Open the markdown file you want to transform, then run the command again.');
      return;
    }
    sourceUri = sourceDocument.uri;
    if (sourceUri.scheme !== 'file') {
      void vscode.window.showErrorMessage('Only local markdown files can be transformed.');
      return;
    }
    if (sourceDocument.isDirty) {
      const saved = await sourceDocument.save();
      if (!saved) {
        void vscode.window.showErrorMessage('Please save the markdown file before transforming.');
        return;
      }
    }
  }

  let outputUri: vscode.Uri;
  if (skipSaveDialog) {
    outputUri = vscode.Uri.file(buildDefaultStyledHtmlPath(sourceUri.fsPath));
  } else {
    const picked = await vscode.window.showSaveDialog({
      title: 'Save Styled HTML',
      saveLabel: 'Transform',
      defaultUri: vscode.Uri.file(buildDefaultStyledHtmlPath(sourceUri.fsPath)),
      filters: {
        HTML: ['html'],
      },
    });
    if (!picked) return;
    if (picked.scheme !== 'file') {
      void vscode.window.showErrorMessage('Output must be a local file path.');
      return;
    }
    outputUri = picked;
  }

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'MD Studio: Transforming markdown to styled HTML...',
      },
      async () => {
        await runCliRendererForPath(sourceUri.fsPath, {
          outputPath: outputUri.fsPath,
          forceStandalone: true,
        });
      },
    );
  } catch (error) {
    void vscode.window.showErrorMessage(`Markdown transform failed: ${errorToMessage(error)}`);
    return;
  }

  void vscode.window.showInformationMessage(`Styled HTML generated: ${outputUri.fsPath}`);
}

function buildDefaultStyledHtmlPath(inputPath: string): string {
  const inputDir = path.dirname(inputPath);
  const inputBaseName = path.basename(inputPath, path.extname(inputPath));
  return path.join(inputDir, `${inputBaseName}.styled.html`);
}

async function resolveMarkdownUriFromCommandArg(commandArg: unknown): Promise<vscode.Uri | null> {
  const commandUri = getUriFromCommandArg(commandArg);
  if (commandUri) {
    if (isMarkdownFileUri(commandUri)) return commandUri;
    void vscode.window.showErrorMessage('Select a local markdown file and try again.');
    return null;
  }

  const document = await resolveTargetDocument();
  return document?.uri ?? null;
}

async function openMarkdownInBrowserPanel(uri: vscode.Uri): Promise<void> {
  const newKey = uri.toString();
  if (lastBrowserKey && lastBrowserKey !== newKey) {
    const previous = sessions.get(lastBrowserKey);
    if (previous) previous.panel.dispose();
  }
  lastBrowserKey = newKey;
  const document = await vscode.workspace.openTextDocument(uri);
  await queuePreview(document, 'open');
}

async function openMarkdownInNewPanel(uri: vscode.Uri): Promise<void> {
  const document = await vscode.workspace.openTextDocument(uri);
  await queuePreview(document, 'open');
}

async function resolveTargetDocument(): Promise<vscode.TextDocument | null> {
  const sourceDocument = await openMarkdownSourceEditor(undefined, false);
  if (sourceDocument) return sourceDocument;

  void vscode.window.showErrorMessage('Open a markdown file and try again.');
  return null;
}

async function openMarkdownSourceEditor(commandArg?: unknown, showError = true): Promise<vscode.TextDocument | null> {
  const commandUri = getUriFromCommandArg(commandArg);
  if (commandUri && isMarkdownFileUri(commandUri)) {
    return openMarkdownUriInEditor(commandUri);
  }

  const active = vscode.window.activeTextEditor?.document;
  if (active && isMarkdownFile(active)) {
    cacheCursorLineFromEditor(vscode.window.activeTextEditor || null);
    await vscode.window.showTextDocument(active, { preview: false, preserveFocus: false });
    return active;
  }

  const activeTabUri = getActiveTabMarkdownUri();
  if (activeTabUri) {
    return openMarkdownUriInEditor(activeTabUri);
  }

  await revealBuiltinMarkdownSource();

  const revealed = vscode.window.activeTextEditor?.document;
  if (revealed && isMarkdownFile(revealed)) {
    cacheCursorLineFromEditor(vscode.window.activeTextEditor || null);
    return revealed;
  }

  if (lastPreviewKey) {
    try {
      const uri = vscode.Uri.parse(lastPreviewKey);
      if (isMarkdownFileUri(uri)) {
        return openMarkdownUriInEditor(uri);
      }
    } catch {
      // Ignore and fall through to message.
    }
  }

  if (showError) {
    void vscode.window.showErrorMessage('Open a markdown file and try again.');
  }
  return null;
}

async function openPreferredViewForCurrentMarkdown(viewerFirst: boolean): Promise<void> {
  const active = vscode.window.activeTextEditor?.document;
  if (active && isMarkdownFile(active)) {
    if (viewerFirst) {
      await queuePreview(active, 'open');
    } else {
      await openMarkdownUriInEditor(active.uri);
    }
    return;
  }

  if (!viewerFirst) {
    await openMarkdownSourceEditor(undefined, false);
    return;
  }

  const sourceDocument = await openMarkdownSourceEditor(undefined, false);
  if (sourceDocument) {
    await queuePreview(sourceDocument, 'open');
  }
}

async function openUriInTextEditor(uri: vscode.Uri): Promise<void> {
  const document = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(document, { preview: false, preserveFocus: false });
  if (isMarkdownFile(document)) {
    cacheCursorLineFromEditor(editor);
  }
}

async function openMarkdownUriInEditor(uri: vscode.Uri): Promise<vscode.TextDocument | null> {
  const document = await vscode.workspace.openTextDocument(uri);
  if (!isMarkdownFile(document)) return null;
  const editor = await vscode.window.showTextDocument(document, { preview: false, preserveFocus: false });
  cacheCursorLineFromEditor(editor);
  return document;
}

function getActiveTabMarkdownUri(): vscode.Uri | null {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  if (input instanceof vscode.TabInputText && isMarkdownFileUri(input.uri)) return input.uri;
  if (input instanceof vscode.TabInputTextDiff && isMarkdownFileUri(input.modified)) return input.modified;
  return null;
}

async function revealBuiltinMarkdownSource(): Promise<void> {
  try {
    await vscode.commands.executeCommand('markdown.showSource');
    await delay(50);
  } catch {
    // The command is only available when VS Code's built-in markdown preview is active.
  }
}

async function ensureSaved(document: vscode.TextDocument): Promise<boolean> {
  if (!document.isDirty) return true;
  const ok = await document.save();
  if (!ok) {
    void vscode.window.showErrorMessage('Please save the markdown file before opening preview.');
  }
  return ok;
}

function queuePreview(document: vscode.TextDocument, reason: PreviewReason): Promise<void> {
  const key = document.uri.toString();
  const previous = renderQueue.get(key) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      await previewDocument(document, reason);
    })
    .finally(() => {
      if (renderQueue.get(key) === next) {
        renderQueue.delete(key);
      }
    });
  renderQueue.set(key, next);
  return next;
}

async function previewDocument(document: vscode.TextDocument, reason: PreviewReason): Promise<void> {
  if (!isMarkdownFile(document)) return;
  const config = readConfig();
  const key = document.uri.toString();
  if (reason === 'save' && !sessions.has(key)) return;
  if (reason !== 'save') {
    const saved = await ensureSaved(document);
    if (!saved) return;
  }
  const syncTargetSectionId = reason === 'save' ? await resolveCursorSectionIdForSave(document) : null;

  const session = ensureSession(document, reason !== 'save');
  setPanelStatus(session.panel, `Rendering (${reason})...`);

  try {
    const renderOutput = await runCliRenderer(document);
    const roots = [
      ...(renderOutput.workspaceFolder ? [renderOutput.workspaceFolder.uri] : []),
      vscode.Uri.file(renderOutput.inputDir),
      vscode.Uri.file(path.dirname(renderOutput.outputPath)),
    ];
    session.panel.webview.options = {
      enableScripts: true,
      localResourceRoots: roots,
    };

    const html = injectPreviewEnhancements(
      rewriteLocalFileUris(renderOutput.html, session.panel.webview),
      {
        preferredViewMode: config.preferredViewMode,
        outlineCollapsed: session.outlineCollapsed,
        appearance: loadAppearanceState(),
      },
    );
    // Reset per-render sync marker because replacing webview HTML resets scroll/state.
    session.lastSyncedSectionId = null;
    session.isBridgeReady = false;
    session.pendingSyncSectionId = null;
    session.panel.webview.html = html;
    session.panel.title = `MPS Preview: ${path.basename(document.uri.fsPath)}`;

    if (session.tempOutputPath && session.tempOutputPath !== renderOutput.outputPath) {
      await cleanupTempFile(session.tempOutputPath);
    }
    session.tempOutputPath = renderOutput.outputPath;
    lastPreviewKey = key;
    if (reason !== 'save') {
      fileBrowserController?.recordRecent(document.uri);
    }

    fileBrowserController?.reveal(document.uri);

    if (reason === 'save') {
      await syncPreviewToSection(session, syncTargetSectionId);
    }
  } catch (error) {
    const details = errorToMessage(error);
    session.panel.webview.html = renderErrorHtml(details);
    void vscode.window.showErrorMessage(`Markdown Studio preview failed: ${details}`);
  }
}

function ensureSession(document: vscode.TextDocument, reveal: boolean): PreviewSession {
  const key = document.uri.toString();
  const existing = sessions.get(key);
  if (existing) {
    if (reveal) {
      existing.panel.reveal(vscode.ViewColumn.Beside, false);
    }
    return existing;
  }

  const panel = vscode.window.createWebviewPanel(
    'mdStudioPreview',
    `MPS Preview: ${path.basename(document.uri.fsPath)}`,
    {
      viewColumn: vscode.ViewColumn.Beside,
      preserveFocus: !reveal,
    },
    {
      enableScripts: true,
      localResourceRoots: [],
    },
  );

  const session: PreviewSession = {
    panel,
    key,
    tempOutputPath: null,
    lastSyncedSectionId: null,
    isBridgeReady: false,
    pendingSyncSectionId: null,
    outlineCollapsed: loadOutlineCollapsedState(key),
  };
  sessions.set(key, session);

  panel.webview.onDidReceiveMessage((message: unknown) => {
    if (!message || typeof message !== 'object') return;
    const payload = message as PreviewWebviewMessage;
    if (payload.type === 'mdStudioPreview.ready') {
      session.isBridgeReady = true;
      void flushPendingSync(session);
      return;
    }
    if (payload.type === 'mdStudioPreview.openLink') {
      void handlePreviewLinkClick(session, payload);
      return;
    }
    if (payload.type === 'mdStudioPreview.appearanceChanged') {
      void persistAppearanceState(normalizeAppearanceMessage(payload));
      return;
    }
    if (payload.type !== 'mdStudioPreview.outlineStateChanged') return;
    if (typeof payload.collapsed !== 'boolean') return;
    session.outlineCollapsed = payload.collapsed;
    void persistOutlineCollapsedState(session.key, payload.collapsed);
  });

  panel.onDidDispose(() => {
    sessions.delete(key);
    void cleanupTempFile(session.tempOutputPath);
  });

  return session;
}

async function runCliRenderer(document: vscode.TextDocument): Promise<RenderOutput> {
  return runCliRendererForPath(document.uri.fsPath);
}

async function runCliRendererForPath(inputPath: string, options: RunCliRendererOptions = {}): Promise<RenderOutput> {
  const sourceUri = vscode.Uri.file(inputPath);
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(sourceUri) ?? null;

  const config = readConfig();
  const inputDir = path.dirname(inputPath);

  let scriptPath: string;
  if (workspaceFolder) {
    const scriptCandidate = await resolveAvailableCliScriptPath(workspaceFolder, config.cliScriptPath);
    if (!scriptCandidate.exists) {
      const selectedScriptPath = await promptForCliScriptPath(workspaceFolder, scriptCandidate.path);
      if (!selectedScriptPath) {
        throw new Error(
          `CLI script was not found at "${scriptCandidate.path}". Set "mdStudioPreview.cliScriptPath" to a valid relative or absolute path.`,
        );
      }
      scriptPath = selectedScriptPath;
    } else {
      scriptPath = scriptCandidate.path;
    }
  } else {
    // Outside workspace: use bundled script or absolute path from config
    const rawScript = (config.cliScriptPath || '').trim();
    if (rawScript && path.isAbsolute(rawScript) && (await fileExists(rawScript))) {
      scriptPath = rawScript;
    } else {
      const bundled = resolveBundledCliScriptPath();
      if (!bundled || !(await fileExists(bundled))) {
        throw new Error(
          'No CLI script found. Set "mdStudioPreview.cliScriptPath" to an absolute path to use preview outside a workspace.',
        );
      }
      scriptPath = bundled;
    }
  }

  let outputPath: string;
  if (options.outputPath) {
    outputPath = path.resolve(options.outputPath);
  } else {
    const tempDir = path.join(os.tmpdir(), 'markdown-pattern-studio-preview');
    await fs.mkdir(tempDir, { recursive: true });
    const safeBaseName = path
      .basename(inputPath, path.extname(inputPath))
      .replace(/[^a-zA-Z0-9._-]+/g, '_');
    outputPath = path.join(tempDir, `${safeBaseName}-${Date.now()}.html`);
  }

  const cwd = workspaceFolder ? workspaceFolder.uri.fsPath : inputDir;
  const extraArgs = normalizeRendererExtraArgs(config.extraArgs, Boolean(options.forceStandalone));
  if (config.stripEmailDisclaimer && !extraArgs.includes('--strip-email-disclaimer')) {
    extraArgs.push('--strip-email-disclaimer');
  }
  extraArgs.push(...buildAppearanceCliArgs(loadAppearanceState()));
  const args = [scriptPath, inputPath, '--out', outputPath, '--base-dir', inputDir, ...extraArgs];
  await spawnProcess(config.nodePath, args, cwd);

  const html = await fs.readFile(outputPath, 'utf8');
  return { html, workspaceFolder, outputPath, inputDir };
}

function normalizeRendererExtraArgs(extraArgs: string[], forceStandalone: boolean): string[] {
  if (!forceStandalone) return [...extraArgs];

  const normalized = extraArgs.filter((arg) => arg !== '--no-standalone');
  if (!normalized.includes('--standalone')) {
    normalized.push('--standalone');
  }
  return normalized;
}

function resolveCliScriptPath(workspaceFolder: vscode.WorkspaceFolder, rawValue: string): string {
  const workspaceRoot = workspaceFolder.uri.fsPath;
  const value = (rawValue || '').trim() || 'scripts/md-to-html.mjs';
  const withWorkspaceVar = value.replace(/\$\{workspaceFolder\}/g, workspaceRoot);
  if (path.isAbsolute(withWorkspaceVar)) {
    return path.normalize(withWorkspaceVar);
  }
  return path.join(workspaceRoot, withWorkspaceVar);
}

function isDefaultCliScriptPath(rawValue: string): boolean {
  return ((rawValue || '').trim() || 'scripts/md-to-html.mjs') === 'scripts/md-to-html.mjs';
}

function resolveBundledCliScriptPath(): string | null {
  if (!extensionInstallPath) return null;
  return path.join(extensionInstallPath, 'scripts', 'md-to-html.mjs');
}

function resolveBundledParserEnginePath(): string | null {
  if (!extensionInstallPath) return null;
  return path.join(extensionInstallPath, 'public', 'core', 'engine.js');
}

async function handlePreviewLinkClick(session: PreviewSession, payload: PreviewWebviewMessage): Promise<void> {
  const rawHref = readRawMessageString(payload.rawHref) || readRawMessageString(payload.href);
  if (!rawHref || rawHref.startsWith('#')) return;

  const text = normalizeMessageString(payload.text) || normalizeMessageString(payload.title) || rawHref;
  const resolved = resolvePreviewLink(session, rawHref);
  if (!resolved) {
    void vscode.window.showWarningMessage(`Unable to resolve link: ${rawHref}`, 'Copy Link').then((choice) => {
      if (choice === 'Copy Link') void vscode.env.clipboard.writeText(rawHref);
    });
    return;
  }

  if (resolved.kind === 'external') {
    if (isHttpUri(resolved.uri)) {
      const choice = await vscode.window.showInformationMessage(
        `Open web link "${text}"? ${resolved.uri.toString()}`,
        'Open in VS Code',
        'Open External',
        'Copy Link',
        'Cancel',
      );
      if (choice === 'Open in VS Code') {
        await openWebLinkInsideVsCode(resolved.uri);
      } else if (choice === 'Open External') {
        await vscode.env.openExternal(resolved.uri);
      } else if (choice === 'Copy Link') {
        await vscode.env.clipboard.writeText(resolved.uri.toString());
      }
      return;
    }

    const choice = await vscode.window.showInformationMessage(
      `Open external link "${text}"? ${resolved.uri.toString()}`,
      'Open',
      'Copy Link',
      'Cancel',
    );
    if (choice === 'Open') {
      await vscode.env.openExternal(resolved.uri);
    } else if (choice === 'Copy Link') {
      await vscode.env.clipboard.writeText(resolved.uri.toString());
    }
    return;
  }

  const exists = await fileExists(resolved.uri.fsPath);
  if (!exists) {
    const choice = await vscode.window.showWarningMessage(
      `Linked file was not found: ${resolved.uri.fsPath}`,
      'Copy Path',
      'Cancel',
    );
    if (choice === 'Copy Path') await vscode.env.clipboard.writeText(resolved.uri.fsPath);
    return;
  }

  const fileName = path.basename(resolved.uri.fsPath);
  if (resolved.isMarkdown) {
    const choice = await vscode.window.showInformationMessage(
      `Open markdown link "${fileName}"?`,
      'Open Preview',
      'Open Editor',
      'Copy Path',
      'Cancel',
    );
    if (choice === 'Open Preview') {
      const document = await vscode.workspace.openTextDocument(resolved.uri);
      await queuePreview(document, 'open');
    } else if (choice === 'Open Editor') {
      await vscode.window.showTextDocument(resolved.uri, { preview: false });
    } else if (choice === 'Copy Path') {
      await vscode.env.clipboard.writeText(resolved.uri.fsPath);
    }
    return;
  }

  const choice = await vscode.window.showInformationMessage(
    `Open file link "${fileName}"?`,
    'Open',
    'Copy Path',
    'Cancel',
  );
  if (choice === 'Open') {
    await vscode.commands.executeCommand('vscode.open', resolved.uri);
  } else if (choice === 'Copy Path') {
    await vscode.env.clipboard.writeText(resolved.uri.fsPath);
  }
}

function isHttpUri(uri: vscode.Uri): boolean {
  return uri.scheme === 'http' || uri.scheme === 'https';
}

async function openWebLinkInsideVsCode(uri: vscode.Uri): Promise<void> {
  try {
    await vscode.commands.executeCommand('simpleBrowser.show', uri.toString());
  } catch {
    await vscode.commands.executeCommand('vscode.open', uri);
  }
}

function normalizeMessageString(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function readRawMessageString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

type PreviewLinkResolution =
  | { kind: 'external'; uri: vscode.Uri }
  | { kind: 'local'; uri: vscode.Uri; isMarkdown: boolean };

function resolvePreviewLink(session: PreviewSession, rawHref: string): PreviewLinkResolution | null {
  const href = rawHref.trim();
  if (!href || href.startsWith('#')) return null;
  if (href.startsWith('//')) {
    return { kind: 'external', uri: vscode.Uri.parse(`https:${href}`) };
  }

  const localPart = stripQueryAndFragment(href);
  if (/^[a-zA-Z]:[\\/]/.test(localPart) || localPart.startsWith('\\\\')) {
    const decodedPath = decodeHrefPath(localPart).replace(/\//g, path.sep);
    const resolvedPath = path.normalize(decodedPath);
    return {
      kind: 'local',
      uri: vscode.Uri.file(resolvedPath),
      isMarkdown: isMarkdownPath(resolvedPath),
    };
  }

  const schemeMatch = /^([a-z][a-z0-9+.-]*):/i.exec(href);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme === 'http' || scheme === 'https' || scheme === 'mailto') {
      return { kind: 'external', uri: vscode.Uri.parse(href) };
    }
    if (scheme === 'file') {
      const uri = vscode.Uri.parse(href);
      return { kind: 'local', uri, isMarkdown: isMarkdownPath(uri.fsPath) };
    }
    return { kind: 'external', uri: vscode.Uri.parse(href) };
  }

  const sourceUri = getSessionFileUri(session);
  if (!sourceUri) return null;

  if (!localPart) return null;
  const decodedPath = decodeHrefPath(localPart).replace(/\//g, path.sep);
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(sourceUri);
  let resolvedPath: string;
  if (path.isAbsolute(decodedPath)) {
    resolvedPath = path.normalize(decodedPath);
  } else if (localPart.startsWith('/') && workspaceFolder) {
    resolvedPath = path.join(workspaceFolder.uri.fsPath, decodedPath.replace(/^[/\\]+/, ''));
  } else {
    resolvedPath = path.resolve(path.dirname(sourceUri.fsPath), decodedPath);
  }
  return {
    kind: 'local',
    uri: vscode.Uri.file(resolvedPath),
    isMarkdown: isMarkdownPath(resolvedPath),
  };
}

function getSessionFileUri(session: PreviewSession): vscode.Uri | null {
  try {
    const uri = vscode.Uri.parse(session.key);
    return uri.scheme === 'file' ? uri : null;
  } catch {
    return null;
  }
}

function stripQueryAndFragment(href: string): string {
  const queryIndex = href.indexOf('?');
  const hashIndex = href.indexOf('#');
  const indexes = [queryIndex, hashIndex].filter((index) => index >= 0);
  const end = indexes.length ? Math.min(...indexes) : href.length;
  return href.slice(0, end);
}

function decodeHrefPath(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function resolveSkillsDirPath(workspaceFolder: vscode.WorkspaceFolder | null): string {
  const raw = String(vscode.workspace.getConfiguration('mdStudioPreview').get<string>('skillsDir', 'claude_skills/skills') || '').trim();
  const value = raw || 'claude_skills/skills';
  const workspaceRoot = workspaceFolder?.uri.fsPath || process.cwd();
  const withWorkspaceVar = value.replace(/\$\{workspaceFolder\}/g, workspaceRoot);
  return path.isAbsolute(withWorkspaceVar) ? path.normalize(withWorkspaceVar) : path.join(workspaceRoot, withWorkspaceVar);
}

async function diagnoseEnvironment(): Promise<void> {
  const activeDocument = vscode.window.activeTextEditor?.document ?? null;
  const activeUri = activeDocument?.uri.scheme === 'file' ? activeDocument.uri : null;
  const workspaceFolder =
    activeUri ? vscode.workspace.getWorkspaceFolder(activeUri) ?? null : vscode.workspace.workspaceFolders?.[0] ?? null;
  const config = readConfig();
  const lines: string[] = [];
  const pushCheck = (label: string, ok: boolean, detail = '') => {
    lines.push(`${ok ? '[ok]' : '[warn]'} ${label}${detail ? `: ${detail}` : ''}`);
  };

  lines.push(`Markdown Pattern Studio diagnostics`);
  lines.push(`Time: ${new Date().toISOString()}`);
  lines.push(`Extension: ${extensionInstallPath || '(unknown)'}`);
  lines.push(`Workspace: ${workspaceFolder?.uri.fsPath || '(none)'}`);
  lines.push(`Active document: ${activeDocument?.uri.fsPath || '(none)'}`);
  lines.push('');

  pushCheck('Active file is markdown', Boolean(activeDocument && isMarkdownFile(activeDocument)), activeDocument?.languageId || '');

  const bundledCli = resolveBundledCliScriptPath();
  const bundledEngine = resolveBundledParserEnginePath();
  const bundledBuilder = extensionInstallPath ? path.join(extensionInstallPath, 'public', 'template-builder-vscode.html') : '';
  pushCheck('Bundled CLI', Boolean(bundledCli && (await fileExists(bundledCli))), bundledCli || '(missing path)');
  pushCheck('Bundled engine', Boolean(bundledEngine && (await fileExists(bundledEngine))), bundledEngine || '(missing path)');
  pushCheck('Bundled Template Builder', Boolean(bundledBuilder && (await fileExists(bundledBuilder))), bundledBuilder || '(missing path)');

  if (workspaceFolder) {
    const cli = await resolveAvailableCliScriptPath(workspaceFolder, config.cliScriptPath);
    const skillsDir = resolveSkillsDirPath(workspaceFolder);
    pushCheck('Configured CLI script', cli.exists, cli.path);
    pushCheck('Configured skillsDir', await fileExists(skillsDir), skillsDir);
    if (cli.exists) {
      const cliSmoke = await runCliSmokeCheck(config.nodePath, cli.path, workspaceFolder.uri.fsPath);
      pushCheck('CLI smoke test', cliSmoke.ok, cliSmoke.detail || 'node script --help');
    }
  } else {
    pushCheck('Workspace folder', false, 'Open a folder for workspace-relative CLI and skills paths.');
  }

  const nodeCheck = await runVersionCheck(config.nodePath);
  pushCheck('Node executable', nodeCheck.ok, `${config.nodePath}${nodeCheck.detail ? ` (${nodeCheck.detail})` : ''}`);

  outputChannel?.clear();
  outputChannel?.appendLine(lines.join('\n'));
  outputChannel?.show(true);
  const warningCount = lines.filter((line) => line.startsWith('[warn]')).length;
  void vscode.window.showInformationMessage(
    warningCount ? `MD Studio diagnostics completed with ${warningCount} warning(s).` : 'MD Studio diagnostics passed.',
    'Show Output',
  ).then((choice) => {
    if (choice === 'Show Output') outputChannel?.show(true);
  });
}

function runVersionCheck(command: string): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    const child = cp.spawn(command, ['--version'], {
      shell: false,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      resolve({ ok: false, detail: error.message });
    });
    child.on('close', (code) => {
      const detail = (stdout || stderr).trim();
      resolve({ ok: code === 0, detail });
    });
  });
}

function runCliSmokeCheck(nodePath: string, cliPath: string, cwd: string): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    const child = cp.spawn(nodePath, [cliPath, '--help'], {
      cwd,
      shell: false,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      resolve({ ok: false, detail: error.message });
    });
    child.on('close', (code) => {
      const detail = (stdout || stderr).trim().split('\n')[0] || `exit ${code}`;
      resolve({ ok: code === 0, detail });
    });
  });
}

async function resolveAvailableCliScriptPath(
  workspaceFolder: vscode.WorkspaceFolder,
  rawValue: string,
): Promise<{ path: string; exists: boolean }> {
  if (isDefaultCliScriptPath(rawValue)) {
    const bundled = resolveBundledCliScriptPath();
    if (bundled && (await fileExists(bundled))) {
      return { path: bundled, exists: true };
    }
  }

  const primary = resolveCliScriptPath(workspaceFolder, rawValue);
  if (await fileExists(primary)) {
    return { path: primary, exists: true };
  }

  return { path: primary, exists: false };
}

async function promptForCliScriptPath(
  workspaceFolder: vscode.WorkspaceFolder,
  expectedPath: string,
): Promise<string | null> {
  const workspaceKey = workspaceFolder.uri.toString();
  const now = Date.now();
  const dismissedUntil = cliPromptDismissedUntil.get(workspaceKey) ?? 0;
  if (dismissedUntil > now) return null;

  const choice = await vscode.window.showErrorMessage(
    `CLI script was not found at "${expectedPath}".`,
    'Select Script',
    'Not Now',
  );
  if (choice !== 'Select Script') {
    cliPromptDismissedUntil.set(workspaceKey, now + 60_000);
    return null;
  }

  const selected = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    defaultUri: workspaceFolder.uri,
    openLabel: 'Use md-to-html.mjs',
    filters: {
      JavaScript: ['mjs', 'js'],
      All: ['*'],
    },
  });
  if (!selected?.length) {
    cliPromptDismissedUntil.set(workspaceKey, Date.now() + 60_000);
    return null;
  }

  const selectedPath = selected[0].fsPath;
  const exists = await fileExists(selectedPath);
  if (!exists) {
    cliPromptDismissedUntil.set(workspaceKey, Date.now() + 60_000);
    return null;
  }

  await vscode.workspace
    .getConfiguration('mdStudioPreview')
    .update('cliScriptPath', selectedPath, vscode.ConfigurationTarget.Global);
  void vscode.window.showInformationMessage(`Saved mdStudioPreview.cliScriptPath: ${selectedPath}`);
  return selectedPath;
}

function spawnProcess(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    outputChannel?.appendLine(`[cli] cwd=${cwd}`);
    outputChannel?.appendLine(`[cli] ${command} ${args.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg)).join(' ')}`);
    const child = cp.spawn(command, args, {
      cwd,
      shell: false,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      outputChannel?.appendLine(`[cli:error] ${error.message}`);
      reject(error);
    });
    child.on('close', (code) => {
      if (code === 0) {
        if (stdout.trim()) outputChannel?.appendLine(stdout.trim());
        resolve();
        return;
      }
      const message = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n');
      outputChannel?.appendLine(`[cli:exit ${code}] ${message}`);
      reject(new Error(message || `CLI exited with code ${code}`));
    });
  });
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function rewriteLocalFileUris(html: string, webview: vscode.Webview): string {
  let converted = html.replace(/\b(src|href)=("([^"]*)"|'([^']*)')/gi, (full, attr, quoted, doubleQuoted, singleQuoted) => {
    const originalValue = String(doubleQuoted ?? singleQuoted ?? '').trim();
    if (!originalValue.toLowerCase().startsWith('file://')) return full;
    try {
      const fileUri = vscode.Uri.parse(originalValue);
      if (fileUri.scheme !== 'file') return full;
      const webviewUri = webview.asWebviewUri(fileUri).toString();
      const quote = String(quoted).startsWith("'") ? "'" : '"';
      if (String(attr).toLowerCase() === 'href') {
        return `${attr}=${quote}${webviewUri}${quote} data-md-studio-original-href=${quote}${escapeHtmlAttribute(originalValue)}${quote}`;
      }
      return `${attr}=${quote}${webviewUri}${quote}`;
    } catch {
      return full;
    }
  });

  converted = converted.replace(/url\((['"]?)(file:\/\/[^'")]+)\1\)/gi, (full, quote, fileValue) => {
    try {
      const fileUri = vscode.Uri.parse(fileValue);
      if (fileUri.scheme !== 'file') return full;
      const webviewUri = webview.asWebviewUri(fileUri).toString();
      return `url(${quote}${webviewUri}${quote})`;
    } catch {
      return full;
    }
  });

  return converted;
}

async function resolveCursorSectionIdForSave(document: vscode.TextDocument): Promise<string | null> {
  const config = readConfig();
  if (!config.cursorSyncOnSave) return null;

  const cursorLine = resolveBestCursorLine(document);
  if (!cursorLine) return null;

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri) ?? null;
  const parseMarkdownDocument = await loadParseMarkdownParser(workspaceFolder);
  if (!parseMarkdownDocument) return null;

  let parsed: { sections?: ParsedSection[] };
  try {
    parsed = parseMarkdownDocument(document.getText());
  } catch (error) {
    console.warn('[mdStudioPreview] parseMarkdownDocument failed:', error);
    return null;
  }

  const sections = Array.isArray(parsed?.sections) ? parsed.sections : [];
  if (!sections.length) return null;

  return findSectionIdAtOrBeforeLine(sections, cursorLine);
}

function getActiveEditorCursorLine(document: vscode.TextDocument): number | null {
  const activeEditor = vscode.window.activeTextEditor;
  if (!activeEditor) return null;
  if (activeEditor.document.uri.toString() !== document.uri.toString()) return null;
  return activeEditor.selection.active.line + 1;
}

function cacheCursorLineFromEditor(editor: vscode.TextEditor | null): void {
  if (!editor) return;
  const document = editor.document;
  if (!isMarkdownFile(document)) return;
  const line = editor.selection.active.line + 1;
  cursorLineCache.set(document.uri.toString(), line);
}

function captureCursorLineForDocument(document: vscode.TextDocument): void {
  const targetKey = document.uri.toString();
  const visibleEditor = vscode.window.visibleTextEditors.find(
    (editor) => editor.document.uri.toString() === targetKey,
  );
  if (!visibleEditor) return;
  cacheCursorLineFromEditor(visibleEditor);
}

function resolveBestCursorLine(document: vscode.TextDocument): number | null {
  const targetKey = document.uri.toString();
  const visibleEditor = vscode.window.visibleTextEditors.find(
    (editor) => editor.document.uri.toString() === targetKey,
  );
  if (visibleEditor) {
    const line = visibleEditor.selection.active.line + 1;
    cursorLineCache.set(targetKey, line);
    return line;
  }

  const cachedLine = cursorLineCache.get(targetKey) ?? null;
  if (cachedLine && Number.isFinite(cachedLine) && cachedLine > 0) {
    return cachedLine;
  }

  return getActiveEditorCursorLine(document);
}

async function loadParseMarkdownParser(workspaceFolder: vscode.WorkspaceFolder | null): Promise<ParseMarkdownDocumentFn | null> {
  let enginePath: string | null = null;
  if (workspaceFolder) {
    const workspaceEnginePath = path.join(workspaceFolder.uri.fsPath, 'public', 'core', 'engine.js');
    if (await fileExists(workspaceEnginePath)) {
      enginePath = workspaceEnginePath;
    }
  }
  if (!enginePath) {
    const bundledEnginePath = resolveBundledParserEnginePath();
    if (bundledEnginePath && (await fileExists(bundledEnginePath))) {
      enginePath = bundledEnginePath;
    }
  }
  if (!enginePath) return null;

  const cached = parserCache.get(enginePath);
  if (cached) return cached;

  try {
    const moduleUrl = pathToFileURL(enginePath).href;
    const moduleNs = await dynamicImportModule(moduleUrl);
    const parseMarkdownDocument = moduleNs.parseMarkdownDocument;
    if (typeof parseMarkdownDocument !== 'function') return null;
    const parser = parseMarkdownDocument as ParseMarkdownDocumentFn;
    parserCache.set(enginePath, parser);
    return parser;
  } catch (error) {
    console.warn('[mdStudioPreview] unable to import parser module:', error);
    return null;
  }
}

function findSectionIdAtOrBeforeLine(sections: ParsedSection[], cursorLine: number): string | null {
  let lastId: string | null = null;
  for (const section of sections) {
    const sectionId = typeof section?.id === 'string' ? section.id : '';
    const sectionLine = Number(section?.line);
    if (!sectionId || !Number.isFinite(sectionLine)) continue;
    if (sectionLine <= cursorLine) {
      lastId = sectionId;
      continue;
    }
    break;
  }
  return lastId;
}

async function syncPreviewToSection(session: PreviewSession, sectionId: string | null): Promise<void> {
  if (!sectionId) return;
  if (session.lastSyncedSectionId === sectionId) return;
  session.pendingSyncSectionId = sectionId;
  await flushPendingSync(session);
}

async function flushPendingSync(session: PreviewSession): Promise<void> {
  const sectionId = session.pendingSyncSectionId;
  if (!sectionId) return;
  if (!session.isBridgeReady) return;

  const delivered = await postSyncMessageWithRetry(session.panel.webview, sectionId);
  if (!delivered) return;

  session.lastSyncedSectionId = sectionId;
  if (session.pendingSyncSectionId === sectionId) {
    session.pendingSyncSectionId = null;
  }
}

async function postSyncMessageWithRetry(webview: vscode.Webview, sectionId: string): Promise<boolean> {
  const payload = { type: 'mdStudioPreview.syncSection', sectionId };
  const delays = [0, 120, 300];
  let delivered = false;

  for (const waitMs of delays) {
    if (waitMs > 0) {
      await delay(waitMs);
    }
    try {
      delivered = (await webview.postMessage(payload)) || delivered;
    } catch {
      // Continue retrying until the final attempt.
    }
  }

  return delivered;
}

function getOutlineStateKey(documentKey: string): string {
  return `${outlineStateKeyPrefix}${documentKey}`;
}

function loadOutlineCollapsedState(documentKey: string): boolean {
  if (!extensionContextRef) return false;
  return extensionContextRef.workspaceState.get<boolean>(getOutlineStateKey(documentKey), false);
}

async function persistOutlineCollapsedState(documentKey: string, collapsed: boolean): Promise<void> {
  if (!extensionContextRef) return;
  await extensionContextRef.workspaceState.update(getOutlineStateKey(documentKey), collapsed);
}

function loadAppearanceState(): AppearanceOptions {
  if (!extensionContextRef) return defaultAppearanceOptions;
  return normalizeAppearanceState(extensionContextRef.workspaceState.get<unknown>(appearanceStateKey));
}

async function persistAppearanceState(appearance: AppearanceOptions): Promise<void> {
  if (!extensionContextRef) return;
  await extensionContextRef.workspaceState.update(appearanceStateKey, appearance);
}

function normalizeAppearanceMessage(payload: PreviewWebviewMessage): AppearanceOptions {
  const nested = payload.appearance && typeof payload.appearance === 'object'
    ? (payload.appearance as Record<string, unknown>)
    : null;
  return normalizeAppearanceState({
    appearance: nested?.appearance ?? payload.appearance,
    appearanceBackground: nested?.appearanceBackground ?? payload.appearanceBackground,
    appearanceRadius: nested?.appearanceRadius ?? payload.appearanceRadius,
    appearanceFrame: nested?.appearanceFrame ?? payload.appearanceFrame,
    viewerChrome: nested?.viewerChrome ?? payload.viewerChrome,
  });
}

function normalizeAppearanceState(value: unknown): AppearanceOptions {
  const candidate = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    appearance: normalizeChoice(candidate.appearance, ['default', 'clean', 'flat', 'reader', 'print'], 'default'),
    appearanceBackground: normalizeChoice(candidate.appearanceBackground, ['default', 'plain', 'transparent'], 'default'),
    appearanceRadius: normalizeChoice(candidate.appearanceRadius, ['default', 'soft', 'none'], 'default'),
    appearanceFrame: normalizeChoice(candidate.appearanceFrame, ['default', 'lines', 'none'], 'default'),
    viewerChrome: normalizeChoice(candidate.viewerChrome, ['full', 'minimal', 'hidden'], 'full'),
  };
}

function normalizeChoice<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const normalized = String(value ?? '').trim().toLowerCase();
  return allowed.includes(normalized as T) ? (normalized as T) : fallback;
}

function buildAppearanceCliArgs(appearance: AppearanceOptions): string[] {
  const args: string[] = [];
  if (appearance.appearance !== 'default') args.push('--appearance', appearance.appearance);
  if (appearance.appearanceBackground !== 'default') {
    args.push('--appearance-background', appearance.appearanceBackground);
  }
  if (appearance.appearanceRadius !== 'default') args.push('--appearance-radius', appearance.appearanceRadius);
  if (appearance.appearanceFrame !== 'default') args.push('--appearance-frame', appearance.appearanceFrame);
  if (appearance.viewerChrome !== 'full') args.push('--viewer-chrome', appearance.viewerChrome);
  return args;
}

async function cleanupTempFile(tempPath: string | null): Promise<void> {
  if (!tempPath) return;
  try {
    await fs.unlink(tempPath);
  } catch {
    // Ignore temp cleanup failures.
  }
}
