# MV/MZ Web Player

MV/MZ Web Player is a browser player for local RPG Maker MV and MZ web exports.
You can import a game folder or ZIP file, keep it in browser storage, and play it
without uploading the game files to a server.

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
2. Import an RPG Maker MV or MZ web export folder, or import a ZIP file.
3. Wait while the app reads the files and stores them in the browser.
4. Select the game from the library.
5. Play the game in the player area.
6. Use Focus if the game does not receive keyboard input.
7. Use Fullscreen when you want a larger play view.
8. Use Overlay to collect game text in a readable text log.
9. Use Show to make overlay text visible on top of the game.
10. Use Guard to stop chosen keys from going into the game.
11. Download saves from the library when you want to export save data.

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

Import the folder or ZIP that contains game `index.html`.

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
game files. Imported files stay in your browser storage. They are not stored by
this project, and they are not uploaded by this app.

This is a backendless static web app. It does not need a server database or user
accounts.

Your browser may still limit or clear storage based on its own settings. Export
your saves when you want to keep a backup outside the browser.

## Notes

This is an unofficial player for user-provided RPG Maker MV and MZ web exports.
It is not affiliated with or endorsed by Gotcha Gotcha Games, KADOKAWA, or
Degica.
