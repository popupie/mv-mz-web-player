import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { candidateFromFolder, candidateFromZip, importCandidate } from "../lib/importer";
import { registerPlayerServiceWorker } from "../lib/serviceWorker";
import { deleteGame, estimateStorage, getAllGames, updateGameSettings } from "../lib/storage";
import type { GameRecord, ImportProgress } from "../lib/types";

export const idleProgress: ImportProgress = {
  phase: "idle",
  label: "",
  completed: 0,
  total: 0,
};

type ImportCandidateReader = () => Promise<Awaited<ReturnType<typeof candidateFromFolder>>>;

function clearServiceWorkerGameCache(gameId: string) {
  navigator.serviceWorker.controller?.postMessage({
    type: "clear-game-cache",
    gameId,
  });
}

export function useGameLibrary(onImportStart?: () => void) {
  const [games, setGames] = useState<GameRecord[]>([]);
  const [activeGameId, setActiveGameId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ImportProgress>(idleProgress);
  const [error, setError] = useState<string | null>(null);
  const [storage, setStorage] = useState<StorageEstimate | undefined>();

  const activeGame = useMemo(() => games.find((game) => game.id === activeGameId), [activeGameId, games]);

  useEffect(() => {
    void boot();
  }, []);

  async function boot() {
    setError(null);
    try {
      await registerPlayerServiceWorker();
      await refreshGames();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start the browser player.");
    }
  }

  async function refreshGames(nextActiveId?: string) {
    const nextGames = await getAllGames();
    setGames(nextGames);
    setStorage(await estimateStorage());
    if (nextActiveId) {
      setActiveGameId(nextActiveId);
    }
  }

  async function importFolder(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    event.target.value = "";
    if (!files || files.length === 0) return;

    await runImport(async () => candidateFromFolder(files));
  }

  async function importZip(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    await runImport(async () => candidateFromZip(file, setProgress));
  }

  async function runImport(readCandidate: ImportCandidateReader) {
    setError(null);
    onImportStart?.();
    try {
      setProgress({ phase: "reading", label: "Reading files", completed: 0, total: 1 });
      const candidate = await readCandidate();
      const game = await importCandidate(candidate, setProgress);
      clearServiceWorkerGameCache(game.id);
      await refreshGames(game.id);
      setProgress(idleProgress);
    } catch (cause) {
      setProgress({ phase: "error", label: "Import failed", completed: 0, total: 0 });
      setError(cause instanceof Error ? cause.message : "Import failed.");
    }
  }

  async function removeGame(game: GameRecord) {
    setError(null);
    await deleteGame(game.id);
    clearServiceWorkerGameCache(game.id);
    const remaining = games.filter((item) => item.id !== game.id);
    setGames(remaining);
    setActiveGameId(remaining[0]?.id ?? null);
    setStorage(await estimateStorage());
  }

  async function saveGameSettings(game: GameRecord, patch: Partial<GameRecord["settings"]>): Promise<GameRecord> {
    const updated: GameRecord = {
      ...game,
      settings: { ...game.settings, ...patch },
      updatedAt: new Date().toISOString(),
    };
    setGames((items) => items.map((item) => (item.id === updated.id ? updated : item)));
    await updateGameSettings(updated);
    clearServiceWorkerGameCache(updated.id);
    return updated;
  }

  return {
    activeGame,
    activeGameId,
    error,
    games,
    importFolder,
    importZip,
    progress,
    removeGame,
    saveGameSettings,
    setActiveGameId,
    setError,
    storage,
  };
}
