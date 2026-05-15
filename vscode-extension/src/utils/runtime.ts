import * as fs from 'node:fs/promises';

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function assertFileExists(targetPath: string, message: string): Promise<void> {
  try {
    await fs.access(targetPath);
  } catch {
    throw new Error(message);
  }
}

export async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export function errorToMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
