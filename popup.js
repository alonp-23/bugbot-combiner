const AUTO_VIEWED_STORAGE_KEY = 'autoMarkNoiseViewed';
const TABS = [
  { key: 'bots', label: 'Bots' },
  { key: 'humans', label: 'Humans' },
];
const MarkLabels = {
  noise: 'i18n / tests / help-center',
  viewed: 'all files viewed',
  unviewed: 'all files unviewed',
};

const $ = (id) => document.getElementById(id);
let tabId;
let datasets = {};
let active = 'bots';
let pollTimer;

function showMessage(text) {
  $('message').textContent = text;
  $('message').hidden = false;
  $('content').hidden = true;
}

async function send(msg) {
  try {
    return await chrome.tabs.sendMessage(tabId, msg);
  } catch (_) {
    return null;
  }
}

function renderTabs() {
  $('tabs').replaceChildren(
    ...TABS.map(({ key, label }) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `tab${key === active ? ' active' : ''}`;
      const count = document.createElement('span');
      count.className = 'count';
      count.textContent = datasets[key]?.count ?? 0;
      btn.append(label, count);
      btn.addEventListener('click', () => {
        active = key;
        renderTabs();
      });
      return btn;
    }),
  );
  const text = datasets[active]?.text || '';
  renderList(datasets[active]?.items || []);
  $('output').hidden = true;
  $('copy').hidden = !text;
  $('diagnostics').hidden = active !== 'bots';
}

const EmptyMessages = {
  bots: 'No open bot comments on this PR.',
  humans: 'No open review comments from people.',
};

function renderList(items) {
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = EmptyMessages[active];
    $('list').replaceChildren(empty);
    return;
  }
  $('list').replaceChildren(
    ...items.map((item, i) => {
      const details = document.createElement('details');
      details.className = 'item';
      details.open = items.length === 1;

      const summary = document.createElement('summary');
      const title = document.createElement('div');
      title.className = 'item-title';
      title.textContent = `${i + 1}. ${item.title || 'Comment'}`;
      summary.append(title);
      if (item.meta) {
        const meta = document.createElement('div');
        meta.className = 'item-meta';
        meta.textContent = item.meta;
        summary.append(meta);
      }

      const body = document.createElement('div');
      body.className = 'item-body';
      body.textContent = item.body;

      const actions = document.createElement('div');
      actions.className = 'row end';
      if (item.permalink) {
        const open = document.createElement('a');
        open.className = 'btn ghost small';
        open.href = item.permalink;
        open.target = '_blank';
        open.textContent = 'Open';
        actions.append(open);
      }
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'btn small';
      copy.textContent = 'Copy';
      copy.addEventListener('click', () => copyText(item.text, copy));
      actions.append(copy);

      details.append(summary, body, actions);
      return details;
    }),
  );
}

async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    flash(btn, 'Copied!');
  } catch (_) {
    flash(btn, 'Copy failed');
  }
}

function renderMark({ hasDiff, mark }) {
  $('files-hint').hidden = hasDiff;
  $('files-actions').hidden = !hasDiff;
  document.querySelectorAll('[data-mode]').forEach((btn) => (btn.disabled = mark.running));
  if (mark.running) {
    $('mark-status').textContent = `Marking ${MarkLabels[mark.mode]}… (${mark.done} changed)`;
  } else if (mark.result != null) {
    $('mark-status').textContent = mark.result
      ? `Marked ${MarkLabels[mark.mode]} — ${mark.result} file(s) changed.`
      : `Nothing to change for ${MarkLabels[mark.mode]}.`;
  } else {
    $('mark-status').textContent = '';
  }
  clearTimeout(pollTimer);
  if (mark.running) pollTimer = setTimeout(pollMark, 400);
}

async function pollMark() {
  const state = await send({ type: 'getMarkState' });
  if (state?.onPull) renderMark(state);
}

async function flash(btn, text) {
  const original = btn.textContent;
  btn.textContent = text;
  setTimeout(() => (btn.textContent = original), 1500);
}

let songs = [];

async function loadSongs() {
  const text = await (await fetch(chrome.runtime.getURL('songs.txt'))).text();
  songs = text
    .split('\n')
    .map((line) => line.match(/^\d+\.\s+(.+?)\s+—\s+(.+)$/))
    .filter(Boolean)
    .map(([, title, artist]) => ({ title, artist }));
}

function showRandomSong() {
  if (!songs.length) return;
  const { title, artist } = songs[Math.floor(Math.random() * songs.length)];
  $('song-title').textContent = title;
  $('song-title').title = title;
  $('song-artist').textContent = artist;
  // Drop " - 2011 Remaster"-style suffixes and extra artists so Spotify search finds the track.
  const query = `${title.split(' - ')[0]} ${artist.split(',')[0]}`;
  $('song-play').href = `https://open.spotify.com/search/${encodeURIComponent(query)}`;
  $('song').hidden = false;
}

async function init() {
  $('version').textContent = `v${chrome.runtime.getManifest().version}`;

  $('song-shuffle').addEventListener('click', showRandomSong);
  loadSongs().then(showRandomSong);

  const stored = await chrome.storage.sync.get(AUTO_VIEWED_STORAGE_KEY);
  $('auto').checked = Boolean(stored[AUTO_VIEWED_STORAGE_KEY]);
  $('auto').addEventListener('change', (e) =>
    chrome.storage.sync.set({ [AUTO_VIEWED_STORAGE_KEY]: e.target.checked }),
  );

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id;

  const state = await send({ type: 'getState' });
  if (!state) {
    showMessage(
      tab?.url && !tab.url.startsWith('https://github.com/')
        ? 'Open a GitHub pull request to use this extension.'
        : 'Reload this GitHub page so the extension can attach to it.',
    );
    return;
  }
  if (!state.onPull) {
    showMessage('Open a GitHub pull request to use this extension.');
    return;
  }

  datasets = state.datasets;
  active = TABS.find(({ key }) => datasets[key].count)?.key || 'bots';
  $('content').hidden = false;
  renderTabs();
  renderMark(state);

  $('copy').addEventListener('click', () => copyText(datasets[active].text, $('copy')));

  $('diagnostics').addEventListener('click', async () => {
    const res = await send({ type: 'diagnostics' });
    if (!res?.diagnostics) return;
    $('output').value = res.diagnostics;
    $('output').hidden = false;
  });

  document.querySelectorAll('[data-mode]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const res = await send({ type: 'mark', mode: btn.dataset.mode });
      if (res?.onPull) renderMark(res);
    }),
  );
}

init();
