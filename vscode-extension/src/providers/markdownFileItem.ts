import * as vscode from 'vscode';
import { isMarkdownFileUri } from '../utils/markdownFiles.js';

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
      const isMarkdown = isMarkdownFileUri(resourceUri);
      this.command = {
        command: isMarkdown ? 'mdStudioPreview.openFileInViewer' : 'mdStudioFileBrowser.openInEditor',
        title: isMarkdown ? 'Open in Viewer' : 'Open in Editor',
        arguments: [resourceUri],
      };
    }
  }
}
