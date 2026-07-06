import { formatBytes } from "../lib/format";
import type { GameRecord } from "../lib/types";
import { Icon } from "./Icon";

interface GameCardProps {
  active: boolean;
  game: GameRecord;
  onDelete: (game: GameRecord) => void;
  onDownloadSaves: (game: GameRecord) => void;
  onSelect: (gameId: string) => void;
}

export function GameCard({ active, game, onDelete, onDownloadSaves, onSelect }: GameCardProps) {
  return (
    <article className={active ? "game-card active" : "game-card"}>
      <button type="button" className="game-main" onClick={() => onSelect(game.id)}>
        <strong>{game.title}</strong>
        <span>
          {game.fileCount} files · {formatBytes(game.totalBytes)}
        </span>
      </button>

      <button
        type="button"
        className="icon-button"
        aria-label={`Download saves for ${game.title}`}
        title="Download saves"
        onClick={() => onDownloadSaves(game)}
      >
        <Icon name="download" />
      </button>

      <button type="button" className="icon-button" aria-label={`Delete ${game.title}`} onClick={() => onDelete(game)}>
        <Icon name="trash" />
      </button>
    </article>
  );
}
