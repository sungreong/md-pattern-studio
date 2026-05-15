import * as vscode from 'vscode';

export class MarkdownFileItem extends vscode.TreeItem {
  constructor(
    public readonly resourceUri: vscode.Uri,
    public readonly isDirectory: boolean,
    label?: string,
  ) {
    super(
      resourceUri,
      isDirectory
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );
    if (label) this.label = label;
    this.contextValue = isDirectory ? 'mdFolder' : 'mdFile';
    if (!isDirectory) {
      this.command = {
        command: 'mdStudioPreview.openFileInViewer',
        title: 'Open in Viewer',
        arguments: [resourceUri],
      };
    }
  }
}
