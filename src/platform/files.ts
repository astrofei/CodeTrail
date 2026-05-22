import { invoke } from '@tauri-apps/api/core';

type OpenResult = {
  path: string;
  content: string;
};

export type SaveResult = {
  path: string | null;
  usedBrowserDownload: boolean;
};

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function downloadText(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export async function openProjectNative(): Promise<OpenResult | null> {
  if (!isTauriRuntime()) {
    return null;
  }
  return invoke<OpenResult | null>('open_project_dialog');
}

export async function saveTextNative(
  defaultName: string,
  content: string,
  mimeType: string
): Promise<SaveResult> {
  if (!isTauriRuntime()) {
    downloadText(defaultName, content, mimeType);
    return { path: null, usedBrowserDownload: true };
  }

  const path = await invoke<string | null>('save_file_dialog', { defaultName });
  if (!path) {
    return { path: null, usedBrowserDownload: false };
  }

  await invoke('write_text_file', { path, content });
  return { path, usedBrowserDownload: false };
}

export async function overwriteTextNative(path: string, content: string): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error('Overwrite requires the Tauri desktop runtime.');
  }
  await invoke('write_text_file', { path, content });
}
