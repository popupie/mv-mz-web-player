import type { ChangeEvent, KeyboardEvent, RefObject } from "react";
import { formatBytes } from "../lib/format";
import type {
  DictionaryDismissGuard,
  GameRecord,
  ImportProgress,
} from "../lib/types";
import { DictionaryGuardPanel } from "./DictionaryGuardPanel";
import { GameCard } from "./GameCard";
import { Icon } from "./Icon";
import { ImportProgressCard } from "./ImportProgressCard";

interface LibraryPanelProps {
  activeGame?: GameRecord;
  activeGuard: DictionaryDismissGuard;
  aboutOpen: boolean;
  directoryInputRef: RefObject<HTMLInputElement | null>;
  error: string | null;
  games: GameRecord[];
  importFolder: (event: ChangeEvent<HTMLInputElement>) => void;
  importZip: (event: ChangeEvent<HTMLInputElement>) => void;
  progress: ImportProgress;
  quotaPercent: number;
  recordingGuardTrigger: boolean;
  removeGame: (game: GameRecord) => void;
  removeGuardTrigger: (game: GameRecord, index: number) => void;
  recordGuardTrigger: (game: GameRecord, event: KeyboardEvent) => void;
  resetError: () => void;
  setAboutOpen: (open: boolean | ((open: boolean) => boolean)) => void;
  setActiveGameId: (gameId: string) => void;
  setIdle: () => void;
  setDictionaryGuard: (game: GameRecord, guard: DictionaryDismissGuard) => void;
  setRecordingGuardTrigger: (recording: boolean) => void;
  storage?: StorageEstimate;
  zipInputRef: RefObject<HTMLInputElement | null>;
}

export function LibraryPanel({
  activeGame,
  activeGuard,
  aboutOpen,
  directoryInputRef,
  error,
  games,
  importFolder,
  importZip,
  progress,
  quotaPercent,
  recordingGuardTrigger,
  removeGame,
  removeGuardTrigger,
  recordGuardTrigger,
  resetError,
  setAboutOpen,
  setActiveGameId,
  setIdle,
  setDictionaryGuard,
  setRecordingGuardTrigger,
  storage,
  zipInputRef,
}: LibraryPanelProps) {
  return (
    <section className="library-panel" aria-label="Game library">
      <div className="sidebar-top">
        <div className="brand-row">
          <div>
            <h1>MV/MZ Web Player</h1>
          </div>
          <div className="brand-actions">
            <button
              type="button"
              className="icon-button info-button"
              aria-label="Home"
              title="Home"
              aria-pressed={!activeGame}
              onClick={setIdle}
            >
              <Icon name="home" />
            </button>
            <button
              type="button"
              className="icon-button info-button"
              aria-label="About"
              title="About"
              aria-pressed={aboutOpen}
              onClick={() => setAboutOpen((open) => !open)}
            >
              <Icon name="info" />
            </button>
          </div>
        </div>

        <div className="import-actions">
          <button
            type="button"
            aria-label="Import folder"
            title="Import folder"
            onClick={() => directoryInputRef.current?.click()}
          >
            <Icon name="folder" />
          </button>
          <button
            type="button"
            aria-label="Import ZIP"
            title="Import ZIP"
            onClick={() => zipInputRef.current?.click()}
          >
            <Icon name="archive" />
          </button>
          <input
            ref={directoryInputRef}
            className="hidden-input"
            type="file"
            multiple
            onChange={importFolder}
            {...{ webkitdirectory: "" }}
          />
          <input
            ref={zipInputRef}
            className="hidden-input"
            type="file"
            accept=".zip,application/zip"
            onChange={importZip}
          />
        </div>
      </div>

      <div className="game-list">
        {progress.phase !== "idle" && (
          <ImportProgressCard progress={progress} />
        )}

        {error && (
          <div className="alert dismissible-alert">
            <span>{error}</span>
            <button
              type="button"
              aria-label="Dismiss error"
              title="Dismiss error"
              onClick={resetError}
            >
              <Icon name="x" />
            </button>
          </div>
        )}

        {games.map((game) => (
          <GameCard
            key={game.id}
            active={game.id === activeGame?.id}
            game={game}
            onDelete={removeGame}
            onSelect={setActiveGameId}
          />
        ))}
      </div>

      <div className="sidebar-bottom">
        <DictionaryGuardPanel
          activeGame={activeGame}
          guard={activeGuard}
          onRecordTrigger={recordGuardTrigger}
          onRemoveTrigger={removeGuardTrigger}
          onToggle={setDictionaryGuard}
          recording={recordingGuardTrigger}
          setRecording={setRecordingGuardTrigger}
        />

        <div className="storage-meter">
          <div>
            <span>Browser storage</span>
            <span>{storage?.usage ? formatBytes(storage.usage) : "0 B"}</span>
          </div>
          <progress value={quotaPercent} max={100} />
        </div>
      </div>
    </section>
  );
}
