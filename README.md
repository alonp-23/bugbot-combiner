# Bugbot Prompt Combiner

<img src="icons/icon128.png" width="64" alt="logo" />

A Chrome extension for reviewing GitHub pull requests. Click the toolbar icon on any PR to:

- **Combine review comments** — Cursor Bugbot findings, unresolved human review comments, and CodeRabbit comments, each merged into one copyable prompt.
- **Mark files as viewed** — mark all files viewed / unviewed, or only the noise (`i18n/`, `*.test.*`, `help-center/`).
- **Auto-mark noise** — toggle it on and noise files are marked viewed whenever you open a PR's Files changed tab.

The toolbar badge shows how many open review comments the current PR has.

## Install

1. Download the latest zip from [Releases](../../releases) and unzip it somewhere permanent.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and pick the `bugbot-combiner` folder.

To update, replace the folder with the new release and click reload on the extension card.

## Customizing

The noise patterns live in `AUTO_VIEWED_PATTERNS` in `content.js`.

## PR soundtrack

The popup suggests a random song from `songs.txt` with a Spotify link. To use your own playlist, replace the file with lines in the form `1. Title — Artist`.
