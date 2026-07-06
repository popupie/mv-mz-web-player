import { Buffer } from "buffer";
import { describe, expect, it } from "vitest";
import { namespaceStorageKey } from "../src/lib/keys";
import { collectSaveExportEntries } from "../src/lib/saveExport";

type MemoryStorage = Pick<Storage, "getItem" | "key" | "length"> & {
  setItem(key: string, value: string): void;
};

function createMemoryStorage(): MemoryStorage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    getItem(key: string) {
      return values.get(String(key)) ?? null;
    },
    key(index: number) {
      return Array.from(values.keys())[index] ?? null;
    },
    setItem(key: string, value: string) {
      values.set(String(key), String(value));
    },
  };
}

describe("save export entries", () => {
  it("exports only save data for the requested game namespace", () => {
    const storage = createMemoryStorage();
    storage.setItem(namespaceStorageKey("game-a", "RPG File1"), "save-a");
    storage.setItem(namespaceStorageKey("game-b", "RPG File1"), "save-b");

    expect(collectSaveExportEntries("game-a", storage)).toEqual([
      { path: "save/file1.rpgsave", data: "save-a" },
    ]);
  });

  it("maps RPG Maker save keys to normal save filenames", () => {
    const storage = createMemoryStorage();
    storage.setItem(namespaceStorageKey("game-a", "RPG Config"), "config");
    storage.setItem(namespaceStorageKey("game-a", "RPG Global"), "global");
    storage.setItem(namespaceStorageKey("game-a", "RPG File12bak"), "backup");

    expect(collectSaveExportEntries("game-a", storage)).toEqual([
      { path: "save/config.rpgsave", data: "config" },
      { path: "save/file12.rpgsave.bak", data: "backup" },
      { path: "save/global.rpgsave", data: "global" },
    ]);
  });

  it("decodes virtual filesystem base64 files and skips directory markers", () => {
    const storage = createMemoryStorage();
    const bytes = Buffer.from([0, 1, 2, 255]);
    storage.setItem(namespaceStorageKey("game-a", "__mz_player_desktop_fs:dir:save"), "1");
    storage.setItem(
      namespaceStorageKey("game-a", "__mz_player_desktop_fs:file:save/file2.rpgsave"),
      `__mz_player_desktop_fs:base64:${bytes.toString("base64")}`,
    );

    const entries = collectSaveExportEntries("game-a", storage);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.path).toBe("save/file2.rpgsave");
    expect(entries[0]?.data).toEqual(new Uint8Array(bytes));
  });

  it("keeps unknown namespaced localStorage entries under localStorage", () => {
    const storage = createMemoryStorage();
    storage.setItem(namespaceStorageKey("game-a", "Plugin State"), "{\"seen\":true}");

    expect(collectSaveExportEntries("game-a", storage)).toEqual([
      { path: "localStorage/Plugin%20State.txt", data: "{\"seen\":true}" },
    ]);
  });
});
