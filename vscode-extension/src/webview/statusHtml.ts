import * as vscode from 'vscode';

export function setPanelStatus(panel: vscode.WebviewPanel, message: string): void {
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

export function renderErrorHtml(message: string): string {
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
