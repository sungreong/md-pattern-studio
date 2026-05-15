import * as vscode from 'vscode';
import * as path from 'node:path';

const MARKDOWN_EXTENSIONS = new Set(['.md', '.mdx', '.markdown', '.mdown', '.mkd', '.mkdn']);
const MARKDOWN_LANGUAGE_IDS = new Set(['markdown', 'mdx']);

export function isMarkdownFile(document: vscode.TextDocument): boolean {
  if (document.isUntitled) return false;
  if (MARKDOWN_LANGUAGE_IDS.has(document.languageId)) return true;
  const ext = document.uri.fsPath.toLowerCase().slice(document.uri.fsPath.lastIndexOf('.'));
  return MARKDOWN_EXTENSIONS.has(ext);
}

export function isMarkdownFileUri(uri: vscode.Uri): boolean {
  if (uri.scheme !== 'file') return false;
  const ext = path.extname(uri.fsPath).toLowerCase();
  return MARKDOWN_EXTENSIONS.has(ext);
}

export function getUriFromCommandArg(commandArg: unknown): vscode.Uri | null {
  if (commandArg instanceof vscode.Uri) return commandArg;
  if (!commandArg || typeof commandArg !== 'object') return null;

  const resourceUri = (commandArg as { resourceUri?: unknown }).resourceUri;
  if (resourceUri instanceof vscode.Uri) return resourceUri;

  const uri = (commandArg as { uri?: unknown }).uri;
  return uri instanceof vscode.Uri ? uri : null;
}
