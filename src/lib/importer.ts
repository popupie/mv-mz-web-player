import JSZip from "jszip";
import { defaultPlayerSettings } from "./defaults";
import { detectMime } from "./mime";
import { findEntryPath, normalizeStoredPath, stripCommonWrapper, titleFromEntry } from "./paths";
import {
  createOpfsWriter,
  putGame,
  putIndexedDbBlobs,
  putLocalFolderHandle,
  putStoredFiles,
  replaceStoredFilesForGame,
  supportsOpfs,
  type BrowserFileSystemDirectoryHandle,
  type BrowserFileSystemFileHandle,
} from "./storage";
import type { GameRecord, ImportCandidate, ImportProgress } from "./types";

type ProgressCallback = (progress: ImportProgress) => void;
const PROGRESS_FILE_STEP = 25;
const IDB_BATCH_SIZE = 100;

interface LocalFolderCandidate {
  title: string;
  files: Array<{ path: string; sourcePath: string; size: number; mime: string }>;
  entryPath: string;
  totalBytes: number;
  directoryHandle: BrowserFileSystemDirectoryHandle;
}

export interface SessionFolderCandidate {
  title: string;
  files: Array<{ path: string; file: File; size: number; mime: string }>;
  entryPath: string;
  totalBytes: number;
}

type LocalFolderFileHandleEntry = {
  path: string;
  handle: BrowserFileSystemFileHandle;
};

function zipNameBytes(bytes: string[] | Uint8Array | Buffer): Uint8Array {
  if (bytes instanceof Uint8Array) return bytes;
  return Uint8Array.from(bytes.map((byte) => (typeof byte === "string" ? byte.charCodeAt(0) : byte)));
}

export function decodeZipFileName(bytes: string[] | Uint8Array | Buffer): string {
  const data = zipNameBytes(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    return new TextDecoder("shift_jis", { fatal: true }).decode(data);
  }
}

function shouldReportProgress(index: number, total: number, lastReportTime: number): boolean {
  return index === total || index % PROGRESS_FILE_STEP === 0 || performance.now() - lastReportTime > 160;
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}

export async function candidateFromFolder(files: FileList | File[]): Promise<SessionFolderCandidate> {
  const entries = Array.from(files)
    .map((file) => ({
      path: normalizeStoredPath((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name),
      file
    }))
    .filter((entry) => entry.path);

  const normalized = stripCommonWrapper(entries);
  const paths = normalized.map((entry) => entry.path);
  const sessionFiles = normalized.map((entry) => ({
    ...entry,
    size: entry.file.size,
    mime: detectMime(entry.path),
  }));

  return {
    title: titleFromEntry(entries.map((entry) => entry.path), "Imported Game"),
    files: sessionFiles,
    entryPath: findEntryPath(paths),
    totalBytes: sessionFiles.reduce((sum, entry) => sum + entry.size, 0)
  };
}

function isFileHandle(
  handle: BrowserFileSystemDirectoryHandle | BrowserFileSystemFileHandle
): handle is BrowserFileSystemFileHandle {
  return handle.kind === "file" || "getFile" in handle;
}

function isDirectoryHandle(
  handle: BrowserFileSystemDirectoryHandle | BrowserFileSystemFileHandle
): handle is BrowserFileSystemDirectoryHandle {
  return handle.kind === "directory" || "entries" in handle;
}

export async function candidateFromDirectoryHandle(
  directoryHandle: BrowserFileSystemDirectoryHandle,
  onProgress?: ProgressCallback
): Promise<LocalFolderCandidate> {
  if (!directoryHandle.entries) {
    throw new Error("This browser cannot read folders directly.");
  }

  const fileEntries: LocalFolderFileHandleEntry[] = [];
  let lastReportTime = performance.now();
  let lastScanReportTime = performance.now();

  async function scanDirectory(handle: BrowserFileSystemDirectoryHandle, prefix: string) {
    if (!handle.entries) return;

    for await (const [name, entryHandle] of handle.entries()) {
      const path = normalizeStoredPath(prefix ? `${prefix}/${name}` : name);
      if (!path) continue;

      if (isFileHandle(entryHandle)) {
        fileEntries.push({ path, handle: entryHandle });
        if (shouldReportProgress(fileEntries.length, Number.MAX_SAFE_INTEGER, lastScanReportTime)) {
          lastScanReportTime = performance.now();
          onProgress?.({ phase: "reading", label: "Scanning folder", completed: 0, total: 1 });
          await yieldToBrowser();
        }
        continue;
      }

      if (isDirectoryHandle(entryHandle)) {
        await scanDirectory(entryHandle, path);
      }
    }
  }

  await scanDirectory(directoryHandle, "");
  onProgress?.({ phase: "reading", label: "Reading folder", completed: 0, total: fileEntries.length });

  const entries: LocalFolderCandidate["files"] = [];
  for (let index = 0; index < fileEntries.length; index += 1) {
    const entry = fileEntries[index];
    const file = await entry.handle.getFile();
    entries.push({
      path: entry.path,
      sourcePath: entry.path,
      size: file.size,
      mime: detectMime(entry.path),
    });

    if (shouldReportProgress(index + 1, fileEntries.length, lastReportTime)) {
      lastReportTime = performance.now();
      onProgress?.({ phase: "reading", label: "Reading folder", completed: index + 1, total: fileEntries.length });
    }
  }

  const normalized = stripCommonWrapper(entries);
  const paths = normalized.map((entry) => entry.path);
  const totalBytes = normalized.reduce((sum, entry) => sum + entry.size, 0);

  return {
    title: titleFromEntry(entries.map((entry) => entry.path), directoryHandle.name ?? "Imported Game"),
    files: normalized,
    entryPath: findEntryPath(paths),
    totalBytes,
    directoryHandle,
  };
}

export async function candidateFromZip(file: File, onProgress?: ProgressCallback): Promise<ImportCandidate> {
  onProgress?.({ phase: "reading", label: "Reading ZIP", completed: 0, total: file.size });
  const zip = await JSZip.loadAsync(file, { decodeFileName: decodeZipFileName });
  const zipEntries = Object.values(zip.files).filter((entry) => !entry.dir);
  const files: Array<{ path: string; file: Blob }> = [];
  let lastReportTime = performance.now();

  for (let index = 0; index < zipEntries.length; index += 1) {
    const entry = zipEntries[index];
    const blob = await entry.async("blob");
    const path = normalizeStoredPath(entry.name);
    files.push({
      path,
      file: new Blob([blob], { type: detectMime(path) })
    });
    if (shouldReportProgress(index + 1, zipEntries.length, lastReportTime)) {
      lastReportTime = performance.now();
      onProgress?.({ phase: "reading", label: "Reading ZIP", completed: index + 1, total: zipEntries.length });
    }
  }

  const normalized = stripCommonWrapper(files);
  const paths = normalized.map((entry) => entry.path);

  return {
    title: titleFromEntry(files.map((entry) => entry.path), file.name),
    files: normalized,
    entryPath: findEntryPath(paths),
    totalBytes: normalized.reduce((sum, entry) => sum + entry.file.size, 0)
  };
}

export async function importCandidate(candidate: ImportCandidate, onProgress?: ProgressCallback): Promise<GameRecord> {
  const gameId = crypto.randomUUID();
  const now = new Date().toISOString();
  const useOpfs = supportsOpfs();
  let totalBytes = 0;
  let lastReportTime = performance.now();

  onProgress?.({ phase: "storing", label: "Preparing browser storage", completed: 0, total: candidate.files.length });

  if (useOpfs) {
    const writer = await createOpfsWriter(gameId);
    const records = [];
    for (let index = 0; index < candidate.files.length; index += 1) {
      const entry = candidate.files[index];
      const record = await writer.putFile(entry.path, entry.file);
      records.push(record);
      totalBytes += entry.file.size;

      if (shouldReportProgress(index + 1, candidate.files.length, lastReportTime)) {
        lastReportTime = performance.now();
        onProgress?.({ phase: "storing", label: entry.path, completed: index + 1, total: candidate.files.length });
      }
    }
    await putStoredFiles(records);
  } else {
    for (let start = 0; start < candidate.files.length; start += IDB_BATCH_SIZE) {
      const batch = candidate.files.slice(start, start + IDB_BATCH_SIZE);
      await putIndexedDbBlobs(batch.map((entry) => ({ gameId, path: entry.path, blob: entry.file })));
      totalBytes += batch.reduce((sum, entry) => sum + entry.file.size, 0);

      const completed = Math.min(start + batch.length, candidate.files.length);
      onProgress?.({
        phase: "storing",
        label: batch[batch.length - 1]?.path ?? "Storing files",
        completed,
        total: candidate.files.length
      });
    }
  }

  const game: GameRecord = {
    id: gameId,
    title: candidate.title,
    createdAt: now,
    updatedAt: now,
    entryPath: candidate.entryPath,
    fileCount: candidate.files.length,
    totalBytes,
    sourceKind: "stored",
    settings: defaultPlayerSettings()
  };

  await putGame(game);
  onProgress?.({ phase: "done", label: "Imported", completed: candidate.files.length, total: candidate.files.length });
  return game;
}

export async function importLocalFolderCandidate(
  candidate: LocalFolderCandidate,
  onProgress?: ProgressCallback
): Promise<GameRecord> {
  const gameId = crypto.randomUUID();
  const now = new Date().toISOString();

  onProgress?.({ phase: "storing", label: "Saving folder link", completed: 0, total: candidate.files.length });

  await putLocalFolderHandle(gameId, candidate.directoryHandle);
  await putStoredFiles(
    candidate.files.map((entry) => ({
      gameId,
      path: normalizeStoredPath(entry.path),
      size: entry.size,
      mime: entry.mime,
      storageRef: normalizeStoredPath(entry.sourcePath),
      storageKind: "local-folder",
    }))
  );

  const game: GameRecord = {
    id: gameId,
    title: candidate.title,
    createdAt: now,
    updatedAt: now,
    entryPath: candidate.entryPath,
    fileCount: candidate.files.length,
    totalBytes: candidate.totalBytes,
    sourceKind: "local-folder",
    settings: defaultPlayerSettings(),
  };

  await putGame(game);
  onProgress?.({ phase: "done", label: "Folder linked", completed: candidate.files.length, total: candidate.files.length });
  return game;
}

export async function importSessionFolderCandidate(
  candidate: SessionFolderCandidate,
  onProgress?: ProgressCallback
): Promise<GameRecord> {
  const gameId = crypto.randomUUID();
  const now = new Date().toISOString();

  onProgress?.({ phase: "storing", label: "Saving folder session", completed: 0, total: candidate.files.length });

  await putStoredFiles(
    candidate.files.map((entry) => ({
      gameId,
      path: normalizeStoredPath(entry.path),
      size: entry.size,
      mime: entry.mime,
      storageRef: normalizeStoredPath(entry.path),
      storageKind: "session-file",
    }))
  );

  const game: GameRecord = {
    id: gameId,
    title: candidate.title,
    createdAt: now,
    updatedAt: now,
    entryPath: candidate.entryPath,
    fileCount: candidate.files.length,
    totalBytes: candidate.totalBytes,
    sourceKind: "session-folder",
    settings: defaultPlayerSettings(),
  };

  await putGame(game);
  onProgress?.({ phase: "done", label: "Folder opened", completed: candidate.files.length, total: candidate.files.length });
  return game;
}

export async function bindSessionFolderCandidate(
  game: GameRecord,
  candidate: SessionFolderCandidate,
  onProgress?: ProgressCallback
): Promise<GameRecord> {
  const updatedGame: GameRecord = {
    ...game,
    title: candidate.title,
    updatedAt: new Date().toISOString(),
    entryPath: candidate.entryPath,
    fileCount: candidate.files.length,
    totalBytes: candidate.totalBytes,
    sourceKind: "session-folder",
  };

  onProgress?.({ phase: "storing", label: "Binding folder session", completed: 0, total: candidate.files.length });

  await replaceStoredFilesForGame(
    game.id,
    candidate.files.map((entry) => ({
      gameId: game.id,
      path: normalizeStoredPath(entry.path),
      size: entry.size,
      mime: entry.mime,
      storageRef: normalizeStoredPath(entry.path),
      storageKind: "session-file",
    }))
  );
  await putGame(updatedGame);

  onProgress?.({ phase: "done", label: "Folder bound", completed: candidate.files.length, total: candidate.files.length });
  return updatedGame;
}
