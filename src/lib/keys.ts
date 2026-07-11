import type { PlayerSettings, ReservedKey } from "./types";

export function matchesReservedKey(event: Pick<KeyboardEvent, "code" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey">, key: ReservedKey): boolean {
  return (
    event.code === key.code &&
    Boolean(event.altKey) === Boolean(key.altKey) &&
    Boolean(event.ctrlKey) === Boolean(key.ctrlKey) &&
    Boolean(event.metaKey) === Boolean(key.metaKey) &&
    Boolean(event.shiftKey) === Boolean(key.shiftKey)
  );
}

export function reservedKeyForEvent(
  event: Pick<KeyboardEvent, "code" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey">,
  settings: PlayerSettings
): ReservedKey | undefined {
  return settings.reservedKeys.find((key) => matchesReservedKey(event, key));
}

export function storageNamespace(gameId: string): string {
  return `mz-player:${gameId}:`;
}

export type RemovableStorage = Pick<Storage, "key" | "length" | "removeItem">;

export function clearGameStorageNamespace(gameId: string, storage: RemovableStorage = window.localStorage): void {
  const prefix = storageNamespace(gameId);
  clearStorageKeysWithPrefix(prefix, storage);
}

export function clearAllGameStorageNamespaces(storage: RemovableStorage = window.localStorage): void {
  clearStorageKeysWithPrefix("mz-player:", storage);
}

function clearStorageKeysWithPrefix(prefix: string, storage: RemovableStorage): void {
  const keys: string[] = [];

  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(prefix)) keys.push(key);
  }

  for (const key of keys) {
    storage.removeItem(key);
  }
}

export function namespaceStorageKey(gameId: string, key: string): string {
  const prefix = storageNamespace(gameId);
  return key.startsWith(prefix) ? key : `${prefix}${key}`;
}

export function unnamespaceStorageKey(gameId: string, key: string): string {
  const prefix = storageNamespace(gameId);
  return key.startsWith(prefix) ? key.slice(prefix.length) : key;
}
