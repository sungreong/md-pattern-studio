import * as vscode from 'vscode';
import * as path from 'node:path';

interface GitExtensionExports {
  getAPI(version: number): GitApi | undefined;
}

interface GitApi {
  repositories?: GitRepository[];
}

interface GitRepository {
  state?: {
    indexChanges?: GitChange[];
    workingTreeChanges?: GitChange[];
    mergeChanges?: GitChange[];
  };
}

interface GitChange {
  uri?: vscode.Uri;
  status?: number;
}

export async function readGitStatusByPath(): Promise<Map<string, string>> {
  const statusByPath = new Map<string, string>();
  try {
    const extension = vscode.extensions.getExtension<GitExtensionExports>('vscode.git');
    if (!extension) return statusByPath;

    const exports = extension.isActive ? extension.exports : await extension.activate();
    const api = exports?.getAPI?.(1);
    const repositories = Array.isArray(api?.repositories) ? api.repositories : [];
    for (const repository of repositories) {
      const changes = [
        ...(repository.state?.mergeChanges ?? []),
        ...(repository.state?.indexChanges ?? []),
        ...(repository.state?.workingTreeChanges ?? []),
      ];
      for (const change of changes) {
        if (!change.uri?.fsPath) continue;
        const status = mapGitStatus(change.status);
        if (!status) continue;
        statusByPath.set(normalizeFsPath(change.uri.fsPath), status);
      }
    }
  } catch {
    // Git metadata is best effort only.
  }
  return statusByPath;
}

function mapGitStatus(status: number | undefined): string | null {
  switch (status) {
    case 1:
      return 'A';
    case 7:
      return 'U';
    case 2:
    case 6:
      return 'D';
    case 3:
      return 'R';
    case 10:
    case 11:
    case 12:
    case 13:
    case 14:
    case 15:
    case 16:
      return 'U';
    case 0:
    case 5:
      return 'M';
    default:
      return status === undefined ? null : 'M';
  }
}

function normalizeFsPath(fsPath: string): string {
  const normalized = path.normalize(fsPath);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}
