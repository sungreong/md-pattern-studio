import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pipeline } from 'node:stream/promises';

const yazl = require('yazl') as {
  ZipFile: new () => {
    outputStream: NodeJS.ReadableStream;
    addFile(realPath: string, metadataPath: string): void;
    end(): void;
    on(event: 'error', listener: (error: Error) => void): void;
  };
};

interface SkillSource {
  id: string;
  label: string;
  description: string;
  rootDir: string;
}

interface ExportableSkill {
  id: string;
  name: string;
  description: string;
  dir: string;
  source: SkillSource;
}

interface SourcePick extends vscode.QuickPickItem {
  source: SkillSource;
}

interface SkillPick extends vscode.QuickPickItem {
  skill: ExportableSkill;
}

const bundledProfiles = [
  { id: 'claude', label: 'Bundled Claude' },
  { id: 'agents', label: 'Bundled Agents' },
  { id: 'codex', label: 'Bundled Codex' },
] as const;

const excludedNames = new Set(['.git', 'node_modules', '.DS_Store', 'Thumbs.db', 'desktop.ini']);

export async function downloadSkillFolderCommand(context: vscode.ExtensionContext): Promise<void> {
  const workspaceFolder = resolveWorkspaceFolder();
  const sources = await resolveSkillSources(context, workspaceFolder);

  if (sources.length === 0) {
    void vscode.window.showErrorMessage('MD Studio: No bundled or workspace skill folders were found.');
    return;
  }

  const source = await pickSkillSource(sources);
  if (!source) return;

  const skills = await scanExportableSkills(source);
  if (skills.length === 0) {
    void vscode.window.showErrorMessage(`MD Studio: No skill folders with SKILL.md found in ${source.rootDir}.`);
    return;
  }

  const skill = await pickSkill(skills);
  if (!skill) return;

  const defaultDir = workspaceFolder?.uri.fsPath || os.homedir();
  const saveUri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(path.join(defaultDir, `${safeFileName(skill.id)}.zip`)),
    filters: {
      'ZIP Archives': ['zip'],
    },
    saveLabel: 'Download Skill Folder',
    title: `Download ${skill.id} as ZIP`,
  });
  if (!saveUri) return;

  if (isSameOrInside(saveUri.fsPath, skill.dir)) {
    void vscode.window.showErrorMessage('MD Studio: Save the ZIP outside the skill folder to avoid archiving itself.');
    return;
  }

  try {
    await fs.mkdir(path.dirname(saveUri.fsPath), { recursive: true });
    await zipSkillFolder(skill.dir, saveUri.fsPath, safeFileName(skill.id));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`MD Studio: Failed to download skill folder - ${message}`);
    return;
  }

  const revealAction = 'Reveal in Explorer';
  const action = await vscode.window.showInformationMessage(
    `MD Studio: Skill folder downloaded to ${saveUri.fsPath}`,
    revealAction,
  );
  if (action === revealAction) {
    await vscode.commands.executeCommand('revealFileInOS', saveUri);
  }
}

async function resolveSkillSources(
  context: vscode.ExtensionContext,
  workspaceFolder: vscode.WorkspaceFolder | null,
): Promise<SkillSource[]> {
  const sources: SkillSource[] = [];

  for (const profile of bundledProfiles) {
    const rootDir = await firstExistingDirectory([
      path.join(context.extensionPath, 'ai_skills', profile.id, 'skills'),
      path.resolve(context.extensionPath, '..', 'ai_skills', profile.id, 'skills'),
    ]);
    if (rootDir) {
      sources.push({
        id: `bundled-${profile.id}`,
        label: profile.label,
        description: rootDir,
        rootDir,
      });
    }
  }

  const workspaceSkillsDir = resolveWorkspaceSkillsDir(workspaceFolder);
  if (workspaceSkillsDir) {
    sources.push({
      id: 'workspace',
      label: 'Workspace configured skillsDir',
      description: workspaceSkillsDir,
      rootDir: workspaceSkillsDir,
    });
  }

  return sources;
}

async function firstExistingDirectory(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    if (await directoryExists(candidate)) return path.normalize(candidate);
  }
  return null;
}

async function pickSkillSource(sources: SkillSource[]): Promise<SkillSource | null> {
  const picked = await vscode.window.showQuickPick<SourcePick>(
    sources.map((source) => ({
      label: source.label,
      description: source.id,
      detail: source.description,
      source,
    })),
    {
      ignoreFocusOut: true,
      placeHolder: 'Choose the skill source to download from',
    },
  );
  return picked?.source ?? null;
}

async function scanExportableSkills(source: SkillSource): Promise<ExportableSkill[]> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(source.rootDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const skills: ExportableSkill[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;

    const skillDir = path.join(source.rootDir, entry.name);
    const skillMdPath = path.join(skillDir, 'SKILL.md');
    if (!(await fileExists(skillMdPath))) continue;

    let content = '';
    try {
      content = await fs.readFile(skillMdPath, 'utf8');
    } catch {
      // A skill without a readable SKILL.md is not exportable.
      continue;
    }

    const meta = parseSkillMeta(entry.name, content);
    skills.push({
      id: entry.name,
      name: meta.name,
      description: meta.description,
      dir: skillDir,
      source,
    });
  }

  return skills;
}

async function pickSkill(skills: ExportableSkill[]): Promise<ExportableSkill | null> {
  const picked = await vscode.window.showQuickPick<SkillPick>(
    skills.map((skill) => ({
      label: skill.name || skill.id,
      description: skill.id,
      detail: `${skill.source.label} - ${skill.description || skill.dir}`,
      skill,
    })),
    {
      ignoreFocusOut: true,
      matchOnDescription: true,
      matchOnDetail: true,
      placeHolder: 'Choose a skill folder to download',
    },
  );
  return picked?.skill ?? null;
}

async function zipSkillFolder(sourceDir: string, outputPath: string, zipRootName: string): Promise<void> {
  const zipFile = new yazl.ZipFile();
  const zipError = new Promise<never>((_resolve, reject) => {
    zipFile.on('error', reject);
  });
  const streamDone = pipeline(zipFile.outputStream, createWriteStream(outputPath));

  await addDirectoryToZip(zipFile, sourceDir, '', zipRootName);
  zipFile.end();

  await Promise.race([streamDone, zipError]);
}

async function addDirectoryToZip(
  zipFile: InstanceType<typeof yazl.ZipFile>,
  currentDir: string,
  relativeDir: string,
  zipRootName: string,
): Promise<void> {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (excludedNames.has(entry.name) || entry.isSymbolicLink()) continue;

    const absolutePath = path.join(currentDir, entry.name);
    const relativePath = relativeDir ? path.join(relativeDir, entry.name) : entry.name;

    if (entry.isDirectory()) {
      await addDirectoryToZip(zipFile, absolutePath, relativePath, zipRootName);
      continue;
    }

    if (!entry.isFile()) continue;
    zipFile.addFile(absolutePath, toZipPath(zipRootName, relativePath));
  }
}

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

function resolveWorkspaceSkillsDir(workspaceFolder: vscode.WorkspaceFolder | null): string | null {
  const raw = String(
    vscode.workspace.getConfiguration('mdStudioPreview').get<string>('skillsDir', 'claude_skills/skills') || '',
  ).trim();
  const value = raw || 'claude_skills/skills';
  const workspaceRoot = workspaceFolder?.uri.fsPath || '';
  const expanded = workspaceRoot ? value.replace(/\$\{workspaceFolder\}/g, workspaceRoot) : value;

  if (path.isAbsolute(expanded)) return path.normalize(expanded);
  if (!workspaceRoot) return null;
  return path.join(workspaceRoot, expanded);
}

function parseSkillMeta(id: string, content: string): { name: string; description: string } {
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!frontmatterMatch) return { name: id, description: '' };

  const yamlBlock = frontmatterMatch[1];
  const nameMatch = yamlBlock.match(/^name:\s*(.+)$/m);
  const descMatch = yamlBlock.match(/^description:\s*(.+)$/m);

  return {
    name: nameMatch ? stripQuotes(nameMatch[1].trim()) : id,
    description: descMatch ? stripQuotes(descMatch[1].trim()) : '',
  };
}

function stripQuotes(value: string): string {
  return value.replace(/^["']|["']$/g, '');
}

function toZipPath(...segments: string[]): string {
  return segments
    .join('/')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/');
}

function safeFileName(value: string): string {
  const cleaned = value.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || 'skill';
}

function isSameOrInside(candidatePath: string, parentPath: string): boolean {
  const normalizedCandidate = normalizeForCompare(candidatePath);
  const normalizedParent = normalizeForCompare(parentPath);
  const relative = path.relative(normalizedParent, normalizedCandidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function normalizeForCompare(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

async function directoryExists(targetPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(targetPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(targetPath);
    return stat.isFile();
  } catch {
    return false;
  }
}
