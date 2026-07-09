const DB_NAME = "mvmz-browser-player";
const DB_VERSION = 2;
const GAME_STORE = "games";
const FILE_STORE = "files";
const BLOB_STORE = "blobs";
const HANDLE_STORE = "handles";
const PLAYER_DESKTOP_RUNTIME_VERSION = "desktop-api-1";
const PLAYER_BRIDGE_RUNTIME_VERSION = "bridge-api-1";
let dbPromise;
const gameCache = new Map();
const fileCache = new Map();

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith("/play/"))
    return;

  event.respondWith(serveGameFile(url, event.request));
});

self.addEventListener("message", (event) => {
  if (
    event.data &&
    event.data.type === "clear-game-cache" &&
    event.data.gameId
  ) {
    gameCache.delete(event.data.gameId);
    fileCache.delete(event.data.gameId);
    return;
  }
  if (event.data && event.data.type === "clear-cache") {
    gameCache.clear();
    fileCache.clear();
  }
});

function openDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(GAME_STORE))
        db.createObjectStore(GAME_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(FILE_STORE)) {
        const store = db.createObjectStore(FILE_STORE, { keyPath: "key" });
        store.createIndex("gameId", "gameId", { unique: false });
      }
      if (!db.objectStoreNames.contains(BLOB_STORE))
        db.createObjectStore(BLOB_STORE, { keyPath: "key" });
      if (!db.objectStoreNames.contains(HANDLE_STORE))
        db.createObjectStore(HANDLE_STORE, { keyPath: "gameId" });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = undefined;
        gameCache.clear();
        fileCache.clear();
      };
      resolve(db);
    };
    request.onerror = () => {
      dbPromise = undefined;
      reject(request.error || new Error("IndexedDB open failed."));
    };
  });

  return dbPromise;
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error("IndexedDB request failed."));
  });
}

function normalizePath(path) {
  const parts = [];
  for (const rawPart of path
    .replaceAll("\\", "/")
    .replace(/^\/+/, "")
    .split("/")) {
    const part = rawPart.trim();
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

// Reverse maps for filenames where Shift_JIS bytes were decoded as legacy single-byte ZIP encodings.
const MOJIBAKE_DECODE_TABLES = [
  {
    encoding: "cp437",
    chars:
      "\u00c7\u00fc\u00e9\u00e2\u00e4\u00e0\u00e5\u00e7\u00ea\u00eb\u00e8\u00ef\u00ee\u00ec\u00c4\u00c5\u00c9\u00e6\u00c6\u00f4\u00f6\u00f2\u00fb\u00f9\u00ff\u00d6\u00dc\u00a2\u00a3\u00a5\u20a7\u0192\u00e1\u00ed\u00f3\u00fa\u00f1\u00d1\u00aa\u00ba\u00bf\u2310\u00ac\u00bd\u00bc\u00a1\u00ab\u00bb\u2591\u2592\u2593\u2502\u2524\u2561\u2562\u2556\u2555\u2563\u2551\u2557\u255d\u255c\u255b\u2510\u2514\u2534\u252c\u251c\u2500\u253c\u255e\u255f\u255a\u2554\u2569\u2566\u2560\u2550\u256c\u2567\u2568\u2564\u2565\u2559\u2558\u2552\u2553\u256b\u256a\u2518\u250c\u2588\u2584\u258c\u2590\u2580\u03b1\u00df\u0393\u03c0\u03a3\u03c3\u00b5\u03c4\u03a6\u0398\u03a9\u03b4\u221e\u03c6\u03b5\u2229\u2261\u00b1\u2265\u2264\u2320\u2321\u00f7\u2248\u00b0\u2219\u00b7\u221a\u207f\u00b2\u25a0\u00a0",
  },
  {
    encoding: "cp850",
    chars:
      "\u00c7\u00fc\u00e9\u00e2\u00e4\u00e0\u00e5\u00e7\u00ea\u00eb\u00e8\u00ef\u00ee\u00ec\u00c4\u00c5\u00c9\u00e6\u00c6\u00f4\u00f6\u00f2\u00fb\u00f9\u00ff\u00d6\u00dc\u00f8\u00a3\u00d8\u00d7\u0192\u00e1\u00ed\u00f3\u00fa\u00f1\u00d1\u00aa\u00ba\u00bf\u00ae\u00ac\u00bd\u00bc\u00a1\u00ab\u00bb\u2591\u2592\u2593\u2502\u2524\u00c1\u00c2\u00c0\u00a9\u2563\u2551\u2557\u255d\u00a2\u00a5\u2510\u2514\u2534\u252c\u251c\u2500\u253c\u00e3\u00c3\u255a\u2554\u2569\u2566\u2560\u2550\u256c\u00a4\u00f0\u00d0\u00ca\u00cb\u00c8\u0131\u00cd\u00ce\u00cf\u2518\u250c\u2588\u2584\u00a6\u00cc\u2580\u00d3\u00df\u00d4\u00d2\u00f5\u00d5\u00b5\u00fe\u00de\u00da\u00db\u00d9\u00fd\u00dd\u00af\u00b4\u00ad\u00b1\u2017\u00be\u00b6\u00a7\u00f7\u00b8\u00b0\u00a8\u00b7\u00b9\u00b3\u00b2\u25a0\u00a0",
  },
  {
    encoding: "mac_roman",
    chars:
      "\u00c4\u00c5\u00c7\u00c9\u00d1\u00d6\u00dc\u00e1\u00e0\u00e2\u00e4\u00e3\u00e5\u00e7\u00e9\u00e8\u00ea\u00eb\u00ed\u00ec\u00ee\u00ef\u00f1\u00f3\u00f2\u00f4\u00f6\u00f5\u00fa\u00f9\u00fb\u00fc\u2020\u00b0\u00a2\u00a3\u00a7\u2022\u00b6\u00df\u00ae\u00a9\u2122\u00b4\u00a8\u2260\u00c6\u00d8\u221e\u00b1\u2264\u2265\u00a5\u00b5\u2202\u2211\u220f\u03c0\u222b\u00aa\u00ba\u03a9\u00e6\u00f8\u00bf\u00a1\u00ac\u221a\u0192\u2248\u2206\u00ab\u00bb\u2026\u00a0\u00c0\u00c3\u00d5\u0152\u0153\u2013\u2014\u201c\u201d\u2018\u2019\u00f7\u25ca\u00ff\u0178\u2044\u20ac\u2039\u203a\ufb01\ufb02\u2021\u00b7\u201a\u201e\u2030\u00c2\u00ca\u00c1\u00cb\u00c8\u00cd\u00ce\u00cf\u00cc\u00d3\u00d4\uf8ff\u00d2\u00da\u00db\u00d9\u0131\u02c6\u02dc\u00af\u02d8\u02d9\u02da\u00b8\u02dd\u02db\u02c7",
  },
];

function bytesFromMojibake(value, table, slashAsBackslashAt = -1) {
  const bytes = [];
  let slashIndex = 0;
  for (const char of value) {
    if (char === "/") {
      bytes.push(slashIndex === slashAsBackslashAt ? 0x5c : 0x2f);
      slashIndex += 1;
      continue;
    }
    const code = char.codePointAt(0);
    if (code < 0x80) {
      bytes.push(code);
      continue;
    }
    const index = table.indexOf(char);
    if (index < 0) return undefined;
    bytes.push(index + 0x80);
  }
  return new Uint8Array(bytes);
}

function decodeShiftJis(bytes) {
  try {
    return new TextDecoder("shift_jis", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

function mojibakePathAliases(path) {
  const normalized = normalizePath(path);
  if (!normalized) return [];
  const aliases = [];
  const seen = new Set([normalized]);
  const slashCount = Array.from(normalized).filter((char) => char === "/").length;

  function addAlias(candidate) {
    if (!candidate) return;
    const alias = normalizePath(candidate);
    if (!alias || seen.has(alias)) return;
    aliases.push(alias);
    seen.add(alias);
  }

  for (const table of MOJIBAKE_DECODE_TABLES) {
    const bytes = bytesFromMojibake(normalized, table.chars);
    if (bytes) addAlias(decodeShiftJis(bytes));
    for (let slashIndex = 0; slashIndex < slashCount; slashIndex += 1) {
      const slashBytes = bytesFromMojibake(normalized, table.chars, slashIndex);
      if (slashBytes) addAlias(decodeShiftJis(slashBytes));
    }
  }

  return aliases;
}

function setIfAbsent(map, key, value) {
  if (key && !map.has(key)) map.set(key, value);
}

async function getGame(gameId) {
  if (gameCache.has(gameId)) return gameCache.get(gameId);

  const db = await openDb();
  const game = await requestToPromise(
    db.transaction(GAME_STORE, "readonly").objectStore(GAME_STORE).get(gameId),
  );
  gameCache.set(gameId, game);
  return game;
}

async function getGameFileMap(gameId) {
  const cached = fileCache.get(gameId);
  if (cached) return cached;

  const db = await openDb();
  const records = await requestToPromise(
    db
      .transaction(FILE_STORE, "readonly")
      .objectStore(FILE_STORE)
      .index("gameId")
      .getAll(IDBKeyRange.only(gameId)),
  );
  const map = {
    exact: new Map(),
    lower: new Map(),
    alias: new Map(),
    lowerAlias: new Map(),
    records,
  };
  for (const record of records) {
    const normalized = normalizePath(record.path);
    setIfAbsent(map.exact, normalized, record);
    setIfAbsent(map.lower, normalized.toLowerCase(), record);
    for (const alias of mojibakePathAliases(normalized)) {
      setIfAbsent(map.alias, alias, record);
      setIfAbsent(map.lowerAlias, alias.toLowerCase(), record);
    }
  }
  fileCache.set(gameId, map);
  return map;
}

async function getStoredFile(gameId, path) {
  const map = await getGameFileMap(gameId);
  const normalized = normalizePath(path);
  return (
    map.exact.get(normalized) ||
    map.lower.get(normalized.toLowerCase()) ||
    map.alias.get(normalized) ||
    map.lowerAlias.get(normalized.toLowerCase())
  );
}

async function getGameFiles(gameId) {
  const map = await getGameFileMap(gameId);
  return map.records || [];
}

async function getIndexedDbBlob(storageRef) {
  const db = await openDb();
  const record = await requestToPromise(
    db
      .transaction(BLOB_STORE, "readonly")
      .objectStore(BLOB_STORE)
      .get(storageRef),
  );
  return record && record.blob;
}

async function getLocalFolderHandle(gameId) {
  const db = await openDb();
  const record = await requestToPromise(
    db
      .transaction(HANDLE_STORE, "readonly")
      .objectStore(HANDLE_STORE)
      .get(gameId),
  );
  return record && record.handle;
}

async function getOpfsBlob(gameId, path) {
  try {
    if (!navigator.storage || !navigator.storage.getDirectory) return undefined;
    const parts = normalizePath(path).split("/");
    const name = parts.pop();
    if (!name) return undefined;
    let dir = await navigator.storage.getDirectory();
    dir = await dir.getDirectoryHandle("games");
    dir = await dir.getDirectoryHandle(gameId);
    for (const part of parts) dir = await dir.getDirectoryHandle(part);
    const handle = await dir.getFileHandle(name);
    return await handle.getFile();
  } catch {
    return undefined;
  }
}

async function getLocalFolderBlob(gameId, path) {
  try {
    const handle = await getLocalFolderHandle(gameId);
    if (!handle) return undefined;

    const parts = normalizePath(path).split("/");
    const name = parts.pop();
    if (!name) return undefined;

    let dir = handle;
    for (const part of parts) dir = await dir.getDirectoryHandle(part);
    const fileHandle = await dir.getFileHandle(name);
    return await fileHandle.getFile();
  } catch {
    return undefined;
  }
}

async function serveGameFile(url, request) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const parts = url.pathname.split("/").filter(Boolean);
  const gameId = decodeURIComponent(parts[1] || "");
  const requestedPath = normalizePath(
    parts.slice(2).map(decodeURIComponent).join("/"),
  );
  const game = gameId ? await getGame(gameId) : undefined;
  if (!game) return new Response("Game not found", { status: 404 });

  const path = requestedPath || game.entryPath || "index.html";
  const record = await getStoredFile(gameId, path);
  if (!record) return new Response("File not found", { status: 404 });

  const blob =
    record.storageKind === "local-folder"
      ? await getLocalFolderBlob(gameId, record.storageRef || record.path)
      : record.storageKind === "opfs"
        ? await getOpfsBlob(gameId, record.path)
        : await getIndexedDbBlob(record.storageRef);
  if (!blob) return new Response("File body not found", { status: 404 });

  const headers = new Headers({
    "Content-Type": record.mime || blob.type || "application/octet-stream",
    "Cache-Control": "no-store",
  });

  if (request.method === "HEAD")
    return new Response(null, { status: 200, headers });

  if ((record.mime || "").startsWith("text/html")) {
    const html = await blob.text();
    const files = await getGameFiles(gameId);
    return new Response(injectBridge(html, game, files), { status: 200, headers });
  }

  return new Response(blob, { status: 200, headers });
}

function jsonForScript(value) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function encodedPath(path) {
  return normalizePath(path).split("/").map(encodeURIComponent).join("/");
}

function filenameFromPath(path) {
  const parts = normalizePath(path).split("/");
  return parts.at(-1) || path;
}

function desktopRuntimeConfig(game, files) {
  const gamePrefix = `/play/${encodeURIComponent(game.id)}/`;
  return {
    entryId: game.id,
    fileRoutePrefix: gamePrefix,
    files: files.map((file) => ({
      path: file.path,
      url: `${gamePrefix}${encodedPath(file.path)}`,
      size: file.size,
      mimeType: file.mime || "application/octet-stream",
      name: filenameFromPath(file.path),
    })),
  };
}

function injectBridge(html, game, files) {
  const bridgeConfig = `<script>window.__MZ_PLAYER_BRIDGE__=${jsonForScript({
    gameId: game.id,
    settings: game.settings,
  })};</script>`;
  const desktopConfig = `<script>window.__MZ_PLAYER_DESKTOP_CONFIG=${jsonForScript(
    desktopRuntimeConfig(game, files),
  )};</script>`;
  const runtimeScripts = [
    `<script src="/mz-player-runtime/buffer.js?v=${PLAYER_DESKTOP_RUNTIME_VERSION}"></script>`,
    `<script src="/mz-player-runtime/desktop.js?v=${PLAYER_DESKTOP_RUNTIME_VERSION}"></script>`,
    `<script src="/runtime-bridge.js?v=${PLAYER_BRIDGE_RUNTIME_VERSION}"></script>`,
  ].join("");
  const config = `${bridgeConfig}${desktopConfig}${runtimeScripts}`;

  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${config}`);
  }
  return `${config}${html}`;
}
