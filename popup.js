const AUTO_VIEWED_STORAGE_KEY = 'autoMarkNoiseViewed';
const TABS = [
  { key: 'bugbot', label: 'Bugbot' },
  { key: 'human', label: 'Human' },
  { key: 'coderabbit', label: 'CodeRabbit' },
];
const MarkLabels = {
  noise: 'i18n / tests / help-center',
  viewed: 'all files viewed',
  unviewed: 'all files unviewed',
};

const $ = (id) => document.getElementById(id);
let tabId;
let datasets = {};
let active = 'bugbot';
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
      btn.textContent = `${label} (${datasets[key]?.count ?? 0})`;
      btn.addEventListener('click', () => {
        active = key;
        renderTabs();
      });
      return btn;
    }),
  );
  const text = datasets[active]?.text || '';
  $('output').value = text || 'Nothing to copy on this PR.';
  $('copy').disabled = !text;
  $('diagnostics').hidden = active !== 'bugbot';
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

async function init() {
  $('version').textContent = `v${chrome.runtime.getManifest().version}`;

  const stored = await chrome.storage.sync.get(AUTO_VIEWED_STORAGE_KEY);
  $('auto').checked = Boolean(stored[AUTO_VIEWED_STORAGE_KEY]);
  $('auto').addEventListener('change', (e) =>
    chrome.storage.sync.set({ [AUTO_VIEWED_STORAGE_KEY]: e.target.checked }),
  );

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id;
  if (!tab?.url?.startsWith('https://github.com/')) {
    showMessage('Open a GitHub pull request to use this extension.');
    return;
  }

  const state = await send({ type: 'getState' });
  if (!state) {
    showMessage('Reload this GitHub page so the extension can attach to it.');
    return;
  }
  if (!state.onPull) {
    showMessage('Open a GitHub pull request to use this extension.');
    return;
  }

  datasets = state.datasets;
  active = TABS.find(({ key }) => datasets[key].count)?.key || 'bugbot';
  $('content').hidden = false;
  renderTabs();
  renderMark(state);

  $('copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(datasets[active].text);
      flash($('copy'), 'Copied!');
    } catch (_) {
      $('output').select();
      flash($('copy'), 'Select & ⌘C');
    }
  });

  $('diagnostics').addEventListener('click', async () => {
    const res = await send({ type: 'diagnostics' });
    if (res?.diagnostics) $('output').value = res.diagnostics;
  });

  document.querySelectorAll('[data-mode]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const res = await send({ type: 'mark', mode: btn.dataset.mode });
      if (res?.onPull) renderMark(res);
    }),
  );
}

init();
