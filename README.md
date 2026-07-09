# MV/MZ Web Player

MV/MZ Web Player is a browser player for local RPG Maker MV and MZ web exports.
You can open a local game folder or import a ZIP, then play without uploading
game files to a server.

## Demo

A demo will be added later.

## Use Case

Many RPG Maker games are made for Windows. This app is useful when playing RPG
Maker MV and MZ web exports on Linux or macOS through a browser.

It can also help with language study. The text overlay makes game text easier to
select with browser tools such as the Yomitan extension. Yomitan is a separate
project and is not included with this app.

## App Flow

1. Open the app in your browser.
2. Open a folder for a large game, or import a ZIP for a smaller portable game.
3. Make sure the folder or ZIP contains game `index.html`.
4. Wait while the app scans the folder or imports the ZIP.
5. Select the game from the library.
6. If a session folder says `not bound`, select it and choose the
   same folder again.
7. Play the game in the player area.
8. Use Focus if the game does not receive keyboard input.
9. Use Fullscreen when you want a larger play view.
10. Use Overlay to collect game text in a readable text log.
11. Use Show to make overlay text visible on top of the game.
12. Use Guard to stop chosen keys from going into the game.
13. Download saves from the library when you want to export save data.

## Web Export Examples

A web export is the browser version of an RPG Maker MV or MZ game. It usually
has an `index.html` file and folders such as `js`, `img`, `audio`, and `data`.

Some games keep these files inside a `www` folder:

```text
GameFolder/
  www/
    index.html
    js/
    img/
    audio/
    data/
```

Other games use a flatter layout, often next to files such as `game.exe`:

```text
GameFolder/
  game.exe
  index.html
  js/
  img/
  audio/
  data/
```

## Local Setup

Install dependencies:

```sh
pnpm install
```

Start the development server:

```sh
pnpm run dev
```

Build the app:

```sh
pnpm run build
```

Run tests:

```sh
pnpm run test
```

Preview the production build:

```sh
pnpm run preview
```

## Privacy

The app is built for your own local game files. This project does not provide
game files. Nothing is uploaded by this app or stored on a server.

This is a backendless static web app. It does not need a server database or user
accounts.

Your browser may still limit or clear storage based on its own settings. Export
your saves when you want to keep a backup outside the browser.

ZIP imports are stored in browser storage. Folder opens may be persistent when
the browser supports folder handles, or session-only when it only supports the
older folder picker.

## Notes

This is an unofficial player for user-provided RPG Maker MV and MZ web exports.
It is not affiliated with or endorsed by Gotcha Gotcha Games, KADOKAWA, or
Degica.
