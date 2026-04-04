import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createTemplateBuilderPanel } from '../webview/templateBuilderPanel.js';

/**
 * Command handler for `mdStudioPreview.openTemplateBuilder`.
 *
 * Resolves the skills directory from settings, scans for SKILL.md files,
 * then opens the Drag-and-Drop Template Builder Webview panel.
 */
export async function openTemplateBuilderCommand(
  context: vscode.ExtensionContext,
): Promise<void> {
  const workspaceFolder = resolveWorkspaceFolder();
  const insertState: InsertState = {
    lastEditorUri: toInsertableUri(vscode.window.activeTextEditor),
  };

  const htmlFilePath = await resolveBuilderHtmlPath(context, workspaceFolder);
  if (!htmlFilePath) {
    void vscode.window.showErrorMessage(
      'Template Builder: public/template-builder-vscode.html not found. Open the workspace root or reinstall the extension.',
    );
    return;
  }

  const panel = await createTemplateBuilderPanel(context, {
    htmlFilePath,
    onGenerate: async (markdown: string) => {
      await handleGenerate(markdown, workspaceFolder);
    },
    onInsert: async (markdown: string) => {
      await handleInsert(markdown, insertState);
    },
    onCopy: async (markdown: string) => {
      await vscode.env.clipboard.writeText(markdown);
      void vscode.window.showInformationMessage('Template Builder: Markdown copied to clipboard 📋');
    },
  });

  const activeEditorSub = vscode.window.onDidChangeActiveTextEditor((editor) => {
    const uri = toInsertableUri(editor);
    if (uri) insertState.lastEditorUri = uri;
  });
  panel.onDidDispose(() => activeEditorSub.dispose());
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function resolveWorkspaceFolder(): vscode.WorkspaceFolder | null {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return null;
  const active = vscode.window.activeTextEditor?.document.uri;
  if (active) {
    const matched = vscode.workspace.getWorkspaceFolder(active);
    if (matched) return matched;
  }
  return folders[0];
}

// skillsDir resolver removed

/**
 * Resolves the path to public/template-builder-vscode.html.
 * Priority:
 *   1. Workspace root / public/template-builder-vscode.html  (development mode)
 *   2. Extension install directory / public/template-builder-vscode.html (bundled)
 */
async function resolveBuilderHtmlPath(
  context: vscode.ExtensionContext,
  workspaceFolder: vscode.WorkspaceFolder | null,
): Promise<string | null> {
  if (workspaceFolder) {
    const workspacePath = path.join(workspaceFolder.uri.fsPath, 'public', 'template-builder-vscode.html');
    if (await fileExists(workspacePath)) return workspacePath;
  }
  const bundledPath = path.join(context.extensionPath, 'public', 'template-builder-vscode.html');
  if (await fileExists(bundledPath)) return bundledPath;
  return null;
}

async function handleGenerate(
  markdown: string,
  workspaceFolder: vscode.WorkspaceFolder | null,
): Promise<void> {
  const targetDir = workspaceFolder
    ? path.join(workspaceFolder.uri.fsPath, 'templates')
    : path.join(process.cwd(), 'templates');

  try {
    await fs.mkdir(targetDir, { recursive: true });
  } catch {
    // Directory already exists — safe to ignore.
  }

  const timestamp = formatTimestamp(new Date());
  const fileName = `${timestamp}_template.md`;
  const filePath = path.join(targetDir, fileName);

  try {
    await fs.writeFile(filePath, markdown, 'utf8');
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`Template Builder: Failed to write file — ${msg}`);
    return;
  }

  const uri = vscode.Uri.file(filePath);
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document, { preview: false });
  void vscode.window.showInformationMessage(`Template saved: templates/${fileName}`);
}

async function handleInsert(markdown: string, state: InsertState): Promise<void> {
  try {
    const editor = await resolveInsertEditor(state);
    const success = await editor.edit((editBuilder) => {
      editBuilder.insert(editor.selection.active, markdown);
    });
    if (!success) {
      void vscode.window.showErrorMessage('Template Builder: Insert failed.');
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`Template Builder: Unable to open insert target — ${msg}`);
  }
}

interface InsertState {
  lastEditorUri?: vscode.Uri;
}

function toInsertableUri(editor: vscode.TextEditor | undefined): vscode.Uri | undefined {
  if (!editor) return undefined;
  const scheme = editor.document.uri.scheme;
  if (scheme === 'output' || scheme === 'debug' || scheme === 'vscode-userdata') return undefined;
  return editor.document.uri;
}

async function resolveInsertEditor(state: InsertState): Promise<vscode.TextEditor> {
  const active = vscode.window.activeTextEditor;
  if (active) return active;

  if (state.lastEditorUri) {
    try {
      const doc = await vscode.workspace.openTextDocument(state.lastEditorUri);
      return await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: false });
    } catch {
      // fallback below
    }
  }

  const untitledDoc = await vscode.workspace.openTextDocument({ language: 'markdown', content: '' });
  return await vscode.window.showTextDocument(untitledDoc, { preview: false, preserveFocus: false });
}

function formatTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    String(date.getFullYear()) +
    pad(date.getMonth() + 1) +
    pad(date.getDate()) +
    pad(date.getHours()) +
    pad(date.getMinutes()) +
    pad(date.getSeconds())
  );
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
