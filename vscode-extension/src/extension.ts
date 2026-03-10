import * as vscode from 'vscode';
import * as cp from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

type PreviewReason = 'open' | 'refresh' | 'save';

interface ExtensionConfig {
  autoOnSave: boolean;
  cursorSyncOnSave: boolean;
  nodePath: string;
  cliScriptPath: string;
  preferredViewMode: 'auto' | 'slides' | 'stack';
  extraArgs: string[];
}

interface PreviewSession {
  panel: vscode.WebviewPanel;
  key: string;
  tempOutputPath: string | null;
  lastSyncedSectionId: string | null;
  isBridgeReady: boolean;
  pendingSyncSectionId: string | null;
}

interface RenderOutput {
  html: string;
  workspaceFolder: vscode.WorkspaceFolder;
  outputPath: string;
  inputDir: string;
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
const dynamicImportModule = new Function('modulePath', 'return import(modulePath);') as (
  modulePath: string,
) => Promise<Record<string, unknown>>;

export function activate(context: vscode.ExtensionContext) {
  extensionInstallPath = context.extensionPath;
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
}

export function deactivate() {
  for (const session of sessions.values()) {
    void cleanupTempFile(session.tempOutputPath);
    session.panel.dispose();
  }
  sessions.clear();
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
  const rawPreferredViewMode = String(config.get<string>('preferredViewMode', 'auto') || 'auto').trim().toLowerCase();
  const preferredViewMode: 'auto' | 'slides' | 'stack' =
    rawPreferredViewMode === 'slides' || rawPreferredViewMode === 'stack' ? rawPreferredViewMode : 'auto';
  return { autoOnSave, cursorSyncOnSave, nodePath, cliScriptPath, preferredViewMode, extraArgs };
}

function isMarkdownFile(document: vscode.TextDocument): boolean {
  return document.languageId === 'markdown' && !document.isUntitled;
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
      renderOutput.workspaceFolder.uri,
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
  };
  sessions.set(key, session);

  panel.webview.onDidReceiveMessage((message: unknown) => {
    if (!message || typeof message !== 'object') return;
    const payload = message as { type?: unknown };
    if (payload.type !== 'mdStudioPreview.ready') return;
    session.isBridgeReady = true;
    void flushPendingSync(session);
  });

  panel.onDidDispose(() => {
    sessions.delete(key);
    void cleanupTempFile(session.tempOutputPath);
  });

  return session;
}

async function runCliRenderer(document: vscode.TextDocument): Promise<RenderOutput> {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (!workspaceFolder) {
    throw new Error('Preview works only for markdown files inside the current workspace.');
  }

  const config = readConfig();
  const scriptCandidate = await resolveAvailableCliScriptPath(workspaceFolder, config.cliScriptPath);
  let scriptPath = scriptCandidate.path;
  if (!scriptCandidate.exists) {
    const selectedScriptPath = await promptForCliScriptPath(workspaceFolder, scriptCandidate.path);
    if (!selectedScriptPath) {
      throw new Error(
        `CLI script was not found at "${scriptCandidate.path}". Set "mdStudioPreview.cliScriptPath" to a valid relative or absolute path.`,
      );
    }
    scriptPath = selectedScriptPath;
  }

  const inputPath = document.uri.fsPath;
  const inputDir = path.dirname(inputPath);
  const tempDir = path.join(os.tmpdir(), 'markdown-pattern-studio-preview');
  await fs.mkdir(tempDir, { recursive: true });

  const safeBaseName = path
    .basename(inputPath, path.extname(inputPath))
    .replace(/[^a-zA-Z0-9._-]+/g, '_');
  const outputPath = path.join(tempDir, `${safeBaseName}-${Date.now()}.html`);

  const args = [scriptPath, inputPath, '--out', outputPath, '--base-dir', inputDir, ...config.extraArgs];
  await spawnProcess(config.nodePath, args, workspaceFolder.uri.fsPath);

  const html = await fs.readFile(outputPath, 'utf8');
  return { html, workspaceFolder, outputPath, inputDir };
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
      reject(error);
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const message = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n');
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

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (!workspaceFolder) return null;

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

async function loadParseMarkdownParser(workspaceFolder: vscode.WorkspaceFolder): Promise<ParseMarkdownDocumentFn | null> {
  const workspaceRoot = workspaceFolder.uri.fsPath;
  const cached = parserCache.get(workspaceRoot);
  if (cached) return cached;

  const enginePath = path.join(workspaceRoot, 'public', 'core', 'engine.js');
  try {
    await fs.access(enginePath);
  } catch {
    return null;
  }

  try {
    const moduleUrl = pathToFileURL(enginePath).href;
    const moduleNs = await dynamicImportModule(moduleUrl);
    const parseMarkdownDocument = moduleNs.parseMarkdownDocument;
    if (typeof parseMarkdownDocument !== 'function') return null;
    const parser = parseMarkdownDocument as ParseMarkdownDocumentFn;
    parserCache.set(workspaceRoot, parser);
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

function injectPreviewSyncBridge(html: string, preferredViewMode: 'auto' | 'slides' | 'stack'): string {
  if (html.includes('mdStudioPreview.syncSection')) return html;
  const bridgeScript = `
<script>
(function () {
  if (window.__mdStudioPreviewSyncInstalled) return;
  window.__mdStudioPreviewSyncInstalled = true;
  const preferredViewMode = ${JSON.stringify(preferredViewMode)};

  const vscodeApi = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
  const notifyReady = () => {
    if (!vscodeApi || typeof vscodeApi.postMessage !== 'function') return;
    vscodeApi.postMessage({ type: 'mdStudioPreview.ready' });
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

  const lower = html.toLowerCase();
  const bodyIndex = lower.lastIndexOf('</body>');
  if (bodyIndex === -1) return `${html}\n${bridgeScript}`;
  return `${html.slice(0, bodyIndex)}\n${bridgeScript}\n${html.slice(bodyIndex)}`;
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
