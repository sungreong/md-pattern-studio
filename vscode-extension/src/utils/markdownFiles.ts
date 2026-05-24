import * as vscode from 'vscode';
import * as path from 'node:path';

export const MARKDOWN_EXTENSIONS = ['.md', '.mdx', '.markdown', '.mdown', '.mkd', '.mkdn'] as const;
export const DEFAULT_FILE_BROWSER_EXCLUDE_GLOB = '{**/node_modules/**,**/.git/**,**/dist/**,**/.next/**}';

const MARKDOWN_EXTENSION_SET = new Set<string>(MARKDOWN_EXTENSIONS);
const MARKDOWN_LANGUAGE_IDS = new Set(['markdown', 'mdx']);
const EXTENSION_TOKEN_RE = /^[a-z0-9][a-z0-9_-]*$/;

export function isMarkdownFile(document: vscode.TextDocument): boolean {
  if (document.isUntitled) return false;
  if (MARKDOWN_LANGUAGE_IDS.has(document.languageId)) return true;
  return isMarkdownPath(document.uri.fsPath);
}

export function isMarkdownFileUri(uri: vscode.Uri): boolean {
  if (uri.scheme !== 'file') return false;
  return isMarkdownPath(uri.fsPath);
}

export function isMarkdownPath(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return MARKDOWN_EXTENSION_SET.has(ext);
}

export function normalizeFileExtension(value: unknown): string | null {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/^\.+/, '');
  if (!normalized || !EXTENSION_TOKEN_RE.test(normalized)) return null;
  return `.${normalized}`;
}

export function normalizeExtraFileExtensions(value: unknown): string[] {
  const rawItems = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,\s]+/)
      : [];
  const extensions: string[] = [];
  for (const rawItem of rawItems) {
    const extension = normalizeFileExtension(rawItem);
    if (!extension || MARKDOWN_EXTENSION_SET.has(extension)) continue;
    if (extensions.includes(extension)) continue;
    extensions.push(extension);
  }
  return extensions;
}

export function readExtraFileExtensions(): string[] {
  const raw = vscode.workspace.getConfiguration('mdStudioFileBrowser').get<unknown>('extraExtensions', []);
  return normalizeExtraFileExtensions(raw);
}

export function getBrowserFileExtensions(extraExtensions: readonly string[] = readExtraFileExtensions()): string[] {
  const extensions: string[] = [...MARKDOWN_EXTENSIONS];
  for (const extension of extraExtensions) {
    const normalized = normalizeFileExtension(extension);
    if (!normalized || extensions.includes(normalized)) continue;
    extensions.push(normalized);
  }
  return extensions;
}

export function buildExtensionGlob(extensions: readonly string[]): string {
  const names = extensions
    .map((extension) => normalizeFileExtension(extension))
    .filter((extension): extension is string => Boolean(extension))
    .map((extension) => extension.slice(1));

  const uniqueNames = [...new Set(names)];
  if (uniqueNames.length === 0) return '**/*.{md,mdx,markdown,mdown,mkd,mkdn}';
  if (uniqueNames.length === 1) return `**/*.${uniqueNames[0]}`;
  return `**/*.{${uniqueNames.join(',')}}`;
}

export function getUriFromCommandArg(commandArg: unknown): vscode.Uri | null {
  if (commandArg instanceof vscode.Uri) return commandArg;
  if (!commandArg || typeof commandArg !== 'object') return null;

  const resourceUri = (commandArg as { resourceUri?: unknown }).resourceUri;
  if (resourceUri instanceof vscode.Uri) return resourceUri;

  const uri = (commandArg as { uri?: unknown }).uri;
  return uri instanceof vscode.Uri ? uri : null;
}
