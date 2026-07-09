const githubUrl = "https://github.com/popupie/mv-mz-browser-player";

interface AboutModalProps {
  onClose: () => void;
}

export function AboutModal({ onClose }: AboutModalProps) {
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="about-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
      >
        <div className="modal-header">
          <div>
            <h2 id="about-title">MV/MZ Web Player</h2>
            <p>A browser player for local RPG Maker MV and MZ web exports.</p>
          </div>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="modal-section">
          <h3>How to Use</h3>
          <ol>
            <li>
              Open a folder for a large game, or import a ZIP for a smaller
              portable game.
            </li>
            <li>
              If a session folder shows not bound, select it and choose the same
              folder again.
            </li>
            <li>
              Make sure it contains game <code>index.html</code>.
            </li>
            <li>Select a game from the library.</li>
            <li>Use the Overlay for transparent selectable text.</li>
            <li>Enable Show to make overlay text visible.</li>
            <li>Use Guard to stop configured keys from entering the game.</li>
            <li>Download saves when you want to keep a backup.</li>
          </ol>
        </div>

        <div className="modal-section">
          <h3>Privacy</h3>
          <p>
            This project does not provide game files. Nothing is uploaded by
            this app or stored on a server.
          </p>
          <p>
            This is a backendless static web app. It does not need a server
            database or user accounts.
          </p>
          <p>
            Large folder games are linked for the current browser session when
            persistent folder access is unavailable.
          </p>
        </div>

        <div className="modal-section">
          <h3>About</h3>
          <p>
            Unofficial player for user-provided RPG Maker MV and MZ web exports,
            designed for convenient local play and text extraction.
          </p>
          <p>
            Not affiliated with or endorsed by Gotcha Gotcha Games, KADOKAWA, or
            Degica.
          </p>
          <p>
            Source code is available on{" "}
            <a href={githubUrl} target="_blank" rel="noreferrer">
              GitHub
            </a>
            .
          </p>
        </div>
      </section>
    </div>
  );
}
