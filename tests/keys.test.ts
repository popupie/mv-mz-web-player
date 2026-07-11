import { describe, expect, it } from "vitest";
import { defaultPlayerSettings } from "../src/lib/defaults";
import { clearAllGameStorageNamespaces, clearGameStorageNamespace, matchesReservedKey, namespaceStorageKey, reservedKeyForEvent, unnamespaceStorageKey } from "../src/lib/keys";
import { dictionaryGuardFor, normalizeDictionaryDismissGuard, normalizePlayerSettings, overlayTogglePatch, showTogglePatch } from "../src/lib/playerSettings";
import type { GameRecord, PlayerSettings } from "../src/lib/types";

function gameWithSettings(settings: Partial<PlayerSettings>): GameRecord {
  return {
    id: "game-a",
    title: "Game A",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    entryPath: "index.html",
    fileCount: 1,
    totalBytes: 1,
    settings: { ...defaultPlayerSettings(), ...settings },
  };
}

type MemoryStorage = Pick<Storage, "key" | "length" | "removeItem"> & {
  entries(): [string, string][];
  setItem(key: string, value: string): void;
};

function createMemoryStorage(): MemoryStorage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    entries() {
      return Array.from(values.entries());
    },
    key(index: number) {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key: string) {
      values.delete(String(key));
    },
    setItem(key: string, value: string) {
      values.set(String(key), String(value));
    },
  };
}

describe("reserved keys", () => {
  it("defaults guard to enabled with no trigger keys", () => {
    const guard = defaultPlayerSettings().dictionaryDismissGuard;
    expect(guard.enabled).toBe(true);
    expect(guard.triggers).toEqual([]);
  });

  it("matches exact modifier state", () => {
    const key = defaultPlayerSettings().reservedKeys[0];
    expect(matchesReservedKey({ code: "KeyT", altKey: true, ctrlKey: false, metaKey: false, shiftKey: false }, key)).toBe(true);
    expect(matchesReservedKey({ code: "KeyT", altKey: false, ctrlKey: false, metaKey: false, shiftKey: false }, key)).toBe(false);
  });

  it("finds the configured action", () => {
    const settings = defaultPlayerSettings();
    expect(reservedKeyForEvent({ code: "KeyR", altKey: true, ctrlKey: false, metaKey: false, shiftKey: false }, settings)?.action).toBe("toggleReader");
  });
});

describe("overlay settings", () => {
  it("turns overlay on with reader mode and hidden readable text", () => {
    expect(overlayTogglePatch(gameWithSettings({ overlayEnabled: false, readableOverlay: false, readerMode: false }))).toEqual({
      overlayEnabled: true,
      readableOverlay: false,
      readerMode: true,
    });
  });

  it("turns overlay off by clearing all overlay flags", () => {
    expect(overlayTogglePatch(gameWithSettings({ overlayEnabled: true, readableOverlay: true, readerMode: true }))).toEqual({
      overlayEnabled: false,
      readableOverlay: false,
      readerMode: false,
    });
  });

  it("toggles show mode only while keeping overlay and reader mode active", () => {
    expect(showTogglePatch(gameWithSettings({ overlayEnabled: true, readableOverlay: false, readerMode: true }))).toEqual({
      overlayEnabled: true,
      readableOverlay: true,
      readerMode: true,
    });
    expect(showTogglePatch(gameWithSettings({ overlayEnabled: true, readableOverlay: true, readerMode: true }))).toEqual({
      overlayEnabled: true,
      readableOverlay: false,
      readerMode: true,
    });
  });

  it("does not enable show mode when overlay is off", () => {
    expect(showTogglePatch(gameWithSettings({ overlayEnabled: false, readableOverlay: true, readerMode: true }))).toEqual({
      overlayEnabled: false,
      readableOverlay: false,
      readerMode: false,
    });
  });

  it("falls back to no guard triggers when guard triggers are missing or empty", () => {
    expect(normalizeDictionaryDismissGuard(undefined)).toEqual({
      enabled: true,
      triggers: [],
    });
    expect(dictionaryGuardFor(gameWithSettings({ dictionaryDismissGuard: { enabled: false, triggers: [] } }))).toEqual({
      enabled: false,
      triggers: [],
    });
  });

  it("normalizes incomplete player settings to the overlay defaults", () => {
    expect(normalizePlayerSettings(undefined)).toMatchObject({
      overlayEnabled: false,
      readableOverlay: false,
      readerMode: false,
      dictionaryDismissGuard: {
        enabled: true,
        triggers: [],
      },
    });
    expect(normalizePlayerSettings(undefined).reservedKeys.map((key) => key.action)).toEqual(["toggleOverlay", "toggleReader", "fullscreen"]);
  });

  it("keeps reader and readable state tied to overlay state", () => {
    expect(normalizePlayerSettings({ overlayEnabled: true, readableOverlay: false, readerMode: false })).toMatchObject({
      overlayEnabled: true,
      readableOverlay: false,
      readerMode: true,
    });
    expect(normalizePlayerSettings({ overlayEnabled: false, readableOverlay: true, readerMode: true })).toMatchObject({
      overlayEnabled: false,
      readableOverlay: false,
      readerMode: false,
    });
  });
});

describe("localStorage namespacing", () => {
  it("separates RPG Maker keys per game", () => {
    expect(namespaceStorageKey("game-a", "RPG File1")).toBe("mz-player:game-a:RPG File1");
    expect(namespaceStorageKey("game-b", "RPG File1")).toBe("mz-player:game-b:RPG File1");
  });

  it("does not double namespace and can remove a namespace", () => {
    const key = namespaceStorageKey("game-a", "RPG Global");
    expect(namespaceStorageKey("game-a", key)).toBe(key);
    expect(unnamespaceStorageKey("game-a", key)).toBe("RPG Global");
  });

  it("clears only localStorage entries tied to one game namespace", () => {
    const storage = createMemoryStorage();
    storage.setItem(namespaceStorageKey("game-a", "RPG File1"), "save-a");
    storage.setItem(namespaceStorageKey("game-a", "Plugin State"), "state-a");
    storage.setItem(namespaceStorageKey("game-b", "RPG File1"), "save-b");
    storage.setItem("unrelated", "keep");

    clearGameStorageNamespace("game-a", storage);

    expect(storage.entries()).toEqual([
      [namespaceStorageKey("game-b", "RPG File1"), "save-b"],
      ["unrelated", "keep"],
    ]);
  });

  it("clears all player localStorage namespaces", () => {
    const storage = createMemoryStorage();
    storage.setItem(namespaceStorageKey("game-a", "RPG File1"), "save-a");
    storage.setItem(namespaceStorageKey("game-b", "RPG File1"), "save-b");
    storage.setItem("unrelated", "keep");

    clearAllGameStorageNamespaces(storage);

    expect(storage.entries()).toEqual([["unrelated", "keep"]]);
  });
});
