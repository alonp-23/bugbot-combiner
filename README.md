# Bugbot Prompt Combiner

<img src="icons/icon128.png" width="64" alt="logo" />

A Chrome extension for reviewing GitHub pull requests. Click the toolbar icon on any PR to:

- **Review comments** — every open comment, split into **Bots** (Cursor Bugbot, CodeRabbit, Copilot, any `[bot]` account) and **Humans**. Expand a comment to preview it, copy one, or copy them all as a single prompt. Works on both the Conversation and Files changed tabs.
- **Mark files as viewed** — mark all files viewed / unviewed, or only the noise (`i18n/`, `*.test.*`, `help-center/`).
- **Auto-mark noise** — toggle it on and noise files are marked viewed whenever you open a PR's Files changed tab.

The toolbar badge shows how many open review comments the current PR has.

## Install

1. Download the latest zip from [Releases](../../releases) and unzip it somewhere permanent.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and pick the `bugbot-combiner` folder.

To update: when a new release is out, the popup shows **Update available**. Click **Download**, replace your extension folder with the unzipped one, then click **Reload** — open PR tabs refresh automatically.

## Customizing

The noise patterns live in `AUTO_VIEWED_PATTERNS` in `content.js`.

## PR soundtrack

The popup suggests a random song from `songs.txt` with a Spotify link. To use your own playlist, replace the file with lines in the form `1. Title — Artist`.

## Privacy

Bugbot Prompt Combiner does not collect, store, or share any personal data.

- It runs only on `github.com` pages. It reads review comments and file lists from the pull request you have open so it can show them in the popup, and that content never leaves your browser.
- The only thing it saves is your "auto-mark noise files" setting and the result of the version check, in Chrome's own extension storage.
- Its only network request is a version check against this repository's public [GitHub Releases](https://api.github.com/repos/alonp-23/bugbot-combiner/releases/latest), which sends no information about you or your pull requests.
- It has no analytics, tracking, or ads, and no data is sold or transferred to anyone.

Questions: open an issue in this repository.
