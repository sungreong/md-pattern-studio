import * as vscode from 'vscode';
import * as cp from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { openTemplateBuilderCommand } from './commands/templateBuilder.js';
import { MarkdownFileBrowserProvider, MarkdownFileItem } from './providers/markdownFileTreeProvider.js';

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

type ParseMarkdownDocumentFn = (source: string) => { sections?: ParsedSection[] };

const sessions = new Map<string, PreviewSession>();
const renderQueue = new Map<string, Promise<void>>();
const parserCache = new Map<string, ParseMarkdownDocumentFn>();
const cursorLineCache = new Map<string, number>();
const cliPromptDismissedUntil = new Map<string, number>();
let lastPreviewKey: string | null = null;
let extensionInstallPath = '';
let extensionContextRef: vscode.ExtensionContext | null = null;
let fileBrowserTreeView: vscode.TreeView<MarkdownFileItem> | null = null;
let lastBrowserKey: string | null = null; // tracks the panel opened via file browser
let outputChannel: vscode.OutputChannel | null = null;
const outlineStateKeyPrefix = 'mdStudioPreview:outlineCollapsed:';
const dynamicImportModule = new Function('modulePath', 'return import(modulePath);') as (
  modulePath: string,
) => Promise<Record<string, unknown>>;

export function activate(context: vscode.ExtensionContext) {
  extensionInstallPath = context.extensionPath;
  extensionContextRef = context;
  outputChannel = vscode.window.createOutputChannel('Markdown Pattern Studio');
  context.subscriptions.push(outputChannel);
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
    vscode.commands.registerCommand('mdStudioPreview.diagnoseEnvironment', async () => {
      await diagnoseEnvironment();
    }),
  );

  // --- Markdown File Browser sidebar ---
  const fileBrowserProvider = new MarkdownFileBrowserProvider(context);
  fileBrowserTreeView = vscode.window.createTreeView('mdStudioFileBrowser', {
    treeDataProvider: fileBrowserProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(fileBrowserTreeView);

  context.subscriptions.push(
    vscode.commands.registerCommand('mdStudioFileBrowser.refresh', () => {
      void fileBrowserProvider.refresh();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mdStudioPreview.openFileInViewer', async (commandArg?: unknown) => {
      const uri = await resolveMarkdownUriFromCommandArg(commandArg);
      if (!uri) return;
      const newKey = uri.toString();
      // Close the previous browser panel so only one reader panel stays open
      if (lastBrowserKey && lastBrowserKey !== newKey) {
        const prev = sessions.get(lastBrowserKey);
        if (prev) prev.panel.dispose();
      }
      lastBrowserKey = newKey;
      const document = await vscode.workspace.openTextDocument(uri);
      await queuePreview(document, 'open');
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mdStudioPreview.openFileInNewPanel', async (commandArg?: unknown) => {
      // Context menu passes the TreeItem; inline button / programmatic call passes a Uri.
      const uri = await resolveMarkdownUriFromCommandArg(commandArg);
      if (!uri) return;
      // Open without closing any existing panel — each call creates an independent session
      const document = await vscode.workspace.openTextDocument(uri);
      await queuePreview(document, 'open');
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mdStudioFileBrowser.search', async () => {
      const exclude = '{**/node_modules/**,**/.git/**,**/dist/**,**/.next/**}';
      const uris = await vscode.workspace.findFiles('**/*.{md,mdx,markdown,mdown,mkd,mkdn}', exclude);
      const folders = vscode.workspace.workspaceFolders;

      const items = uris
        .map((uri) => {
          const rel = folders?.length
            ? vscode.workspace.asRelativePath(uri, (folders?.length ?? 0) > 1)
            : uri.fsPath;
          return {
            label: path.basename(uri.fsPath),
            description: path.dirname(rel),
            uri,
          };
        })
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Search markdown files...',
        matchOnDescription: true,
      });
      if (!picked) return;

      // Reuse the single browser panel (same as clicking in tree)
      const newKey = picked.uri.toString();
      if (lastBrowserKey && lastBrowserKey !== newKey) {
        const prev = sessions.get(lastBrowserKey);
        if (prev) prev.panel.dispose();
      }
      lastBrowserKey = newKey;
      const document = await vscode.workspace.openTextDocument(picked.uri);
      await queuePreview(document, 'open');

      // Reveal selected file in the tree
      if (fileBrowserTreeView) {
        try {
          void fileBrowserTreeView.reveal(new MarkdownFileItem(picked.uri, false), {
            select: true,
            focus: false,
          });
        } catch {
          // File may not be in tree — ignore
        }
      }
    }),
  );
}

export function deactivate() {
  for (const session of sessions.values()) {
    void cleanupTempFile(session.tempOutputPath);
    session.panel.dispose();
  }
  sessions.clear();
  extensionContextRef = null;
  fileBrowserTreeView = null;
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

const MARKDOWN_EXTENSIONS = new Set(['.md', '.mdx', '.markdown', '.mdown', '.mkd', '.mkdn']);
const MARKDOWN_LANGUAGE_IDS = new Set(['markdown', 'mdx']);

function isMarkdownFile(document: vscode.TextDocument): boolean {
  if (document.isUntitled) return false;
  if (MARKDOWN_LANGUAGE_IDS.has(document.languageId)) return true;
  const ext = document.uri.fsPath.toLowerCase().slice(document.uri.fsPath.lastIndexOf('.'));
  return MARKDOWN_EXTENSIONS.has(ext);
}

function isMarkdownFileUri(uri: vscode.Uri): boolean {
  if (uri.scheme !== 'file') return false;
  const ext = path.extname(uri.fsPath).toLowerCase();
  return MARKDOWN_EXTENSIONS.has(ext);
}

function getUriFromCommandArg(commandArg: unknown): vscode.Uri | null {
  if (commandArg instanceof vscode.Uri) return commandArg;
  if (!commandArg || typeof commandArg !== 'object') return null;

  const resourceUri = (commandArg as { resourceUri?: unknown }).resourceUri;
  if (resourceUri instanceof vscode.Uri) return resourceUri;

  const uri = (commandArg as { uri?: unknown }).uri;
  if (uri instanceof vscode.Uri) return uri;

  return null;
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

async function resolveTargetDocument(): Promise<vscode.TextDocument | null> {
  const active = vscode.window.activeTextEditor?.document;
  if (active && isMarkdownFile(active)) {
    cacheCursorLineFromEditor(vscode.window.activeTextEditor || null);
    return active;
  }
  if (lastPreviewKey) {
    try {
      const uri = vscode.Uri.parse(lastPreviewKey);
      const document = await vscode.workspace.openTextDocument(uri);
      if (isMarkdownFile(document)) return document;
    } catch {
      // Ignore and fall through to message.
    }
  }
  void vscode.window.showErrorMessage('Open a markdown file and try again.');
  return null;
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
  if (reason !== 'save') {
    const saved = await ensureSaved(document);
    if (!saved) return;
  }
  const syncTargetSectionId = reason === 'save' ? await resolveCursorSectionIdForSave(document) : null;

  const key = document.uri.toString();
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

    const html = injectPreviewSyncBridge(
      rewriteLocalFileUris(renderOutput.html, session.panel.webview),
      config.preferredViewMode,
      session.outlineCollapsed,
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

    // Sync sidebar selection to the currently previewed file
    if (fileBrowserTreeView) {
      try {
        void fileBrowserTreeView.reveal(new MarkdownFileItem(document.uri, false), {
          select: true,
          focus: false,
        });
      } catch {
        // File may not be in the tree (outside workspace) — ignore
      }
    }

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
    const payload = message as { type?: unknown; collapsed?: unknown };
    if (payload.type === 'mdStudioPreview.ready') {
      session.isBridgeReady = true;
      void flushPendingSync(session);
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
  const primary = resolveCliScriptPath(workspaceFolder, rawValue);
  if (await fileExists(primary)) {
    return { path: primary, exists: true };
  }

  if (isDefaultCliScriptPath(rawValue)) {
    const bundled = resolveBundledCliScriptPath();
    if (bundled && (await fileExists(bundled))) {
      return { path: bundled, exists: true };
    }
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

function rewriteLocalFileUris(html: string, webview: vscode.Webview): string {
  let converted = html.replace(/\b(src|href)=("([^"]*)"|'([^']*)')/gi, (full, attr, quoted, doubleQuoted, singleQuoted) => {
    const originalValue = String(doubleQuoted ?? singleQuoted ?? '').trim();
    if (!originalValue.toLowerCase().startsWith('file://')) return full;
    try {
      const fileUri = vscode.Uri.parse(originalValue);
      if (fileUri.scheme !== 'file') return full;
      const webviewUri = webview.asWebviewUri(fileUri).toString();
      const quote = String(quoted).startsWith("'") ? "'" : '"';
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

function injectPreviewSyncBridge(
  html: string,
  preferredViewMode: 'auto' | 'slides' | 'stack',
  initialOutlineCollapsed: boolean,
): string {
  if (html.includes('mdStudioPreview.syncSection')) return html;
  const bridgeScript = `
<script>
(function () {
  if (window.__mdStudioPreviewSyncInstalled) return;
  window.__mdStudioPreviewSyncInstalled = true;
  const preferredViewMode = ${JSON.stringify(preferredViewMode)};
  const initialOutlineCollapsed = ${initialOutlineCollapsed ? 'true' : 'false'};

  const vscodeApi = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
  const notifyReady = () => {
    if (!vscodeApi || typeof vscodeApi.postMessage !== 'function') return;
    vscodeApi.postMessage({ type: 'mdStudioPreview.ready' });
  };
  const notifyOutlineState = (collapsed) => {
    if (!vscodeApi || typeof vscodeApi.postMessage !== 'function') return;
    vscodeApi.postMessage({ type: 'mdStudioPreview.outlineStateChanged', collapsed: Boolean(collapsed) });
  };

  const notifyReadyTwice = () => {
    notifyReady();
    window.setTimeout(notifyReady, 120);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', notifyReadyTwice, { once: true });
  } else {
    notifyReadyTwice();
  }

  const shouldUseStackByPreference = () => {
    if (preferredViewMode === 'stack') return true;
    if (preferredViewMode === 'slides') return false;
    return window.innerWidth < 1400;
  };

  const applyPreferredViewMode = () => {
    if (!shouldUseStackByPreference()) return;
    if (document.body.classList.contains('export-stacked')) return;
    const toggle = document.querySelector('.export-slide-nav [data-action="toggle"]');
    if (!toggle || typeof toggle.click !== 'function') return;
    toggle.click();
  };

  const modeCheckDelays = [0, 80, 220, 450, 900];
  for (const waitMs of modeCheckDelays) {
    window.setTimeout(applyPreferredViewMode, waitMs);
  }

  const getOutlineCollapsed = (outline) => Boolean(outline && outline.classList.contains('is-collapsed'));

  const applyInitialOutlineState = () => {
    const outline = document.querySelector('.export-outline');
    if (!outline) return false;
    const toggle = outline.querySelector('[data-outline-toggle]');
    const current = getOutlineCollapsed(outline);
    if (current !== initialOutlineCollapsed) {
      if (toggle && typeof toggle.click === 'function') {
        toggle.click();
      } else {
        outline.classList.toggle('is-collapsed', initialOutlineCollapsed);
      }
    }

    const collapsed = getOutlineCollapsed(outline);
    if (toggle) {
      toggle.textContent = collapsed ? 'Show' : 'Hide';
      if (!toggle.hasAttribute('data-md-studio-outline-bound')) {
        toggle.setAttribute('data-md-studio-outline-bound', '1');
        toggle.addEventListener('click', () => {
          window.setTimeout(() => {
            notifyOutlineState(getOutlineCollapsed(outline));
          }, 0);
        });
      }
    }

    notifyOutlineState(collapsed);
    return true;
  };

  const outlineCheckDelays = [0, 80, 220, 450, 900];
  for (const waitMs of outlineCheckDelays) {
    window.setTimeout(applyInitialOutlineState, waitMs);
  }

  const findByDataValue = (selector, attrName, targetValue) => {
    const nodes = document.querySelectorAll(selector);
    for (const node of nodes) {
      if (node.getAttribute(attrName) === targetValue) {
        return node;
      }
    }
    return null;
  };

  const findTarget = (sectionId) => {
    if (!sectionId) return null;
    const byId = document.getElementById(sectionId);
    if (byId) return byId;
    return findByDataValue('[data-section-id]', 'data-section-id', sectionId);
  };

  window.addEventListener('message', (event) => {
    const data = event && event.data ? event.data : null;
    if (!data || data.type !== 'mdStudioPreview.syncSection') return;

    const sectionId = String(data.sectionId || '').trim();
    if (!sectionId) return;

    const outlineLink = findByDataValue('[data-outline-id]', 'data-outline-id', sectionId);
    if (outlineLink && typeof outlineLink.click === 'function') {
      outlineLink.click();
      return;
    }

    const target = findTarget(sectionId);
    if (!target || typeof target.scrollIntoView !== 'function') return;

    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  });
})();
</script>`;

  const searchScript = `
<style>
#mps-search-bar {
  position: fixed;
  top: 12px;
  right: 12px;
  z-index: 99999;
  display: none;
  align-items: center;
  gap: 5px;
  background: var(--vscode-editorWidget-background, #252526);
  border: 1px solid var(--vscode-editorWidget-border, #454545);
  border-radius: 6px;
  padding: 5px 8px;
  box-shadow: 0 4px 18px rgba(0,0,0,0.45);
  font-family: var(--vscode-font-family, system-ui, sans-serif);
  font-size: 13px;
  color: var(--vscode-editorWidget-foreground, #ccc);
}
#mps-search-input {
  background: var(--vscode-input-background, #3c3c3c);
  border: 1px solid var(--vscode-input-border, transparent);
  color: var(--vscode-input-foreground, #ccc);
  border-radius: 3px;
  padding: 3px 8px;
  font-size: 13px;
  width: 190px;
  outline: none;
}
#mps-search-input:focus { border-color: var(--vscode-focusBorder, #007fd4); }
#mps-search-count { min-width: 56px; text-align: center; font-size: 11px; opacity: 0.7; }
.mps-search-btn {
  background: transparent;
  border: none;
  color: var(--vscode-editorWidget-foreground, #ccc);
  cursor: pointer;
  font-size: 14px;
  padding: 2px 5px;
  border-radius: 3px;
  line-height: 1;
}
.mps-search-btn:hover { background: var(--vscode-toolbar-hoverBackground, rgba(255,255,255,0.1)); }
mark.mps-hit { background: #ffeb3b; color: #000; border-radius: 2px; padding: 0 1px; }
mark.mps-hit.mps-hit-active { background: #ff9800; outline: 2px solid #ff9800; }
</style>
<div id="mps-search-bar">
  <input id="mps-search-input" type="text" placeholder="Search in document..." autocomplete="off" spellcheck="false">
  <span id="mps-search-count"></span>
  <button class="mps-search-btn" id="mps-search-prev" title="Previous (Shift+Enter)">↑</button>
  <button class="mps-search-btn" id="mps-search-next" title="Next (Enter)">↓</button>
  <button class="mps-search-btn" id="mps-search-close" title="Close (Escape)">✕</button>
</div>
<script>
(function () {
  if (window.__mpsSearchInstalled) return;
  window.__mpsSearchInstalled = true;

  const bar = document.getElementById('mps-search-bar');
  const input = document.getElementById('mps-search-input');
  const countEl = document.getElementById('mps-search-count');
  const prevBtn = document.getElementById('mps-search-prev');
  const nextBtn = document.getElementById('mps-search-next');
  const closeBtn = document.getElementById('mps-search-close');

  let marks = [];
  let currentIndex = -1;
  let lastQuery = '';
  let debounceTimer = null;

  function escapeRegex(s) {
    // Escape regex special chars without using a regex literal (avoids template literal issues)
    var specials = ['.', '*', '+', '?', '^', '(', ')', '|', '[', ']'];
    var result = s;
    for (var i = 0; i < specials.length; i++) {
      result = result.split(specials[i]).join('\\\\' + specials[i]);
    }
    return result;
  }

  function clearMarks() {
    marks.forEach(function (m) {
      if (!m.parentNode) return;
      m.parentNode.replaceChild(document.createTextNode(m.textContent || ''), m);
    });
    // Normalize merged text nodes
    document.body.normalize();
    marks = [];
    currentIndex = -1;
  }

  function highlightAll(query) {
    clearMarks();
    if (!query) { updateCount(); return; }

    var regex = new RegExp(escapeRegex(query), 'gi');
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var el = node.parentElement;
        if (!el) return NodeFilter.FILTER_REJECT;
        var tag = el.tagName.toLowerCase();
        if (tag === 'script' || tag === 'style' || tag === 'noscript') return NodeFilter.FILTER_REJECT;
        if (el.closest && el.closest('#mps-search-bar')) return NodeFilter.FILTER_REJECT;
        return (node.textContent || '').search(regex) !== -1
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_SKIP;
      }
    });

    var textNodes = [];
    var node;
    while ((node = walker.nextNode())) textNodes.push(node);

    textNodes.forEach(function (textNode) {
      var text = textNode.textContent || '';
      regex.lastIndex = 0;
      var fragment = document.createDocumentFragment();
      var lastIdx = 0;
      var match;
      while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIdx) {
          fragment.appendChild(document.createTextNode(text.slice(lastIdx, match.index)));
        }
        var mark = document.createElement('mark');
        mark.className = 'mps-hit';
        mark.textContent = match[0];
        fragment.appendChild(mark);
        marks.push(mark);
        lastIdx = regex.lastIndex;
      }
      if (lastIdx < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(lastIdx)));
      }
      if (textNode.parentNode) textNode.parentNode.replaceChild(fragment, textNode);
    });

    updateCount();
    if (marks.length) { currentIndex = 0; activateMark(0); }
  }

  function activateMark(index) {
    marks.forEach(function (m, i) {
      m.classList.toggle('mps-hit-active', i === index);
    });
    if (marks[index]) {
      marks[index].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    updateCount();
  }

  function updateCount() {
    if (!lastQuery) { countEl.textContent = ''; return; }
    if (!marks.length) { countEl.textContent = 'No results'; return; }
    countEl.textContent = (currentIndex + 1) + ' / ' + marks.length;
  }

  function goNext() {
    if (!marks.length) return;
    currentIndex = (currentIndex + 1) % marks.length;
    activateMark(currentIndex);
  }

  function goPrev() {
    if (!marks.length) return;
    currentIndex = (currentIndex - 1 + marks.length) % marks.length;
    activateMark(currentIndex);
  }

  function openSearch() {
    bar.style.display = 'flex';
    input.focus();
    input.select();
  }

  function closeSearch() {
    bar.style.display = 'none';
    clearMarks();
    input.value = '';
    lastQuery = '';
    countEl.textContent = '';
  }

  input.addEventListener('input', function () {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () {
      var q = input.value;
      if (q === lastQuery) return;
      lastQuery = q;
      highlightAll(q);
    }, 180);
  });

  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.shiftKey ? goPrev() : goNext();
    } else if (e.key === 'Escape') {
      closeSearch();
    }
  });

  prevBtn.addEventListener('click', goPrev);
  nextBtn.addEventListener('click', goNext);
  closeBtn.addEventListener('click', closeSearch);

  window.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      e.stopPropagation();
      openSearch();
    } else if (e.key === 'Escape' && bar.style.display !== 'none') {
      closeSearch();
    }
  }, true);
})();
</script>`;

  const lower = html.toLowerCase();
  const bodyIndex = lower.lastIndexOf('</body>');
  if (bodyIndex === -1) return `${html}\n${bridgeScript}\n${searchScript}`;
  return `${html.slice(0, bodyIndex)}\n${bridgeScript}\n${searchScript}\n${html.slice(bodyIndex)}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setPanelStatus(panel: vscode.WebviewPanel, message: string): void {
  panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      margin: 0;
      padding: 18px;
    }
    .status {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      padding: 12px;
      background: color-mix(in srgb, var(--vscode-editor-background) 90%, var(--vscode-editor-foreground) 10%);
    }
  </style>
</head>
<body>
  <div class="status">${escapeHtml(message)}</div>
</body>
</html>`;
}

function renderErrorHtml(message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-editorError-foreground);
      background: var(--vscode-editor-background);
      margin: 0;
      padding: 18px;
    }
    pre {
      white-space: pre-wrap;
      border: 1px solid var(--vscode-editorError-foreground);
      border-radius: 8px;
      padding: 12px;
      background: color-mix(in srgb, var(--vscode-editor-background) 88%, var(--vscode-editorError-foreground) 12%);
      color: var(--vscode-editorError-foreground);
    }
  </style>
</head>
<body>
  <pre>${escapeHtml(message)}</pre>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function assertFileExists(targetPath: string, message: string): Promise<void> {
  try {
    await fs.access(targetPath);
  } catch {
    throw new Error(message);
  }
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
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

async function cleanupTempFile(tempPath: string | null): Promise<void> {
  if (!tempPath) return;
  try {
    await fs.unlink(tempPath);
  } catch {
    // Ignore temp cleanup failures.
  }
}

function errorToMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
