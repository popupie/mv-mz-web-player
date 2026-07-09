import { describe, expect, it } from "vitest";
import { candidateFromDirectoryHandle, candidateFromFolder, decodeZipFileName } from "../src/lib/importer";
import type { BrowserFileSystemDirectoryHandle, BrowserFileSystemFileHandle } from "../src/lib/storage";

function fileHandle(name: string, size: number): BrowserFileSystemFileHandle {
  return {
    kind: "file",
    name,
    async getFile() {
      return new File([new Uint8Array(size)], name);
    },
    async createWritable() {
      throw new Error("Test file handles are read-only.");
    },
  };
}

function directoryHandle(
  name: string,
  entries: Record<string, BrowserFileSystemDirectoryHandle | BrowserFileSystemFileHandle>
): BrowserFileSystemDirectoryHandle {
  return {
    kind: "directory",
    name,
    async *entries() {
      for (const entry of Object.entries(entries)) {
        yield entry;
      }
    },
    async getDirectoryHandle(entryName: string) {
      const entry = entries[entryName];
      if (!entry || entry.kind !== "directory") throw new Error(`Missing directory: ${entryName}`);
      return entry;
    },
    async getFileHandle(entryName: string) {
      const entry = entries[entryName];
      if (!entry || entry.kind !== "file") throw new Error(`Missing file: ${entryName}`);
      return entry;
    },
    async removeEntry() {
      throw new Error("Test directory handles are read-only.");
    },
  };
}

function webkitFile(path: string, size: number): File {
  const name = path.split("/").at(-1) ?? path;
  const file = new File([new Uint8Array(size)], name);
  Object.defineProperty(file, "webkitRelativePath", {
    value: path,
  });
  return file;
}

describe("ZIP filename decoding", () => {
  it("decodes UTF-8 names", () => {
    const bytes = new TextEncoder().encode("www/img/pictures/説明14.rpgmvp");

    expect(decodeZipFileName(bytes)).toBe("www/img/pictures/説明14.rpgmvp");
  });

  it("falls back to Shift_JIS names", () => {
    const bytes = new Uint8Array([
      119, 119, 119, 47, 105, 109, 103, 47, 112, 105, 99, 116, 117, 114, 101, 115, 47, 144, 224, 150, 190, 49, 52,
      46, 114, 112, 103, 109, 118, 112
    ]);

    expect(decodeZipFileName(bytes)).toBe("www/img/pictures/説明14.rpgmvp");
  });
});

describe("folder handle scanning", () => {
  it("scans metadata, strips a common wrapper, finds the entrypoint, and keeps source paths", async () => {
    const handle = directoryHandle("Downloads", {
      Game: directoryHandle("Game", {
        "index.html": fileHandle("index.html", 10),
        js: directoryHandle("js", {
          "main.js": fileHandle("main.js", 20),
        }),
        data: directoryHandle("data", {
          "Actors.json": fileHandle("Actors.json", 30),
        }),
      }),
    });

    const candidate = await candidateFromDirectoryHandle(handle);

    expect(candidate.title).toBe("Game");
    expect(candidate.entryPath).toBe("index.html");
    expect(candidate.files).toMatchObject([
      { path: "index.html", sourcePath: "Game/index.html", size: 10 },
      { path: "js/main.js", sourcePath: "Game/js/main.js", size: 20 },
      { path: "data/Actors.json", sourcePath: "Game/data/Actors.json", size: 30 },
    ]);
    expect(candidate.totalBytes).toBe(60);
  });
});

describe("webkit folder scanning", () => {
  it("scans session metadata, strips a common wrapper, and keeps file references", async () => {
    const files = [
      webkitFile("Game/index.html", 10),
      webkitFile("Game/js/main.js", 20),
      webkitFile("Game/data/Actors.json", 30),
    ];

    const candidate = await candidateFromFolder(files);

    expect(candidate.title).toBe("Game");
    expect(candidate.entryPath).toBe("index.html");
    expect(candidate.files).toMatchObject([
      { path: "index.html", size: 10, mime: "text/html; charset=utf-8" },
      { path: "js/main.js", size: 20, mime: "text/javascript; charset=utf-8" },
      { path: "data/Actors.json", size: 30, mime: "application/json; charset=utf-8" },
    ]);
    expect(candidate.files.map((entry) => entry.file)).toEqual(files);
    expect(candidate.totalBytes).toBe(60);
  });
});
