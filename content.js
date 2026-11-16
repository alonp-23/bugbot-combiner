/**
 * Bugbot Prompt Combiner
 *
 * On a GitHub PR conversation page, finds every Cursor Bugbot "Fix in Cursor"
 * link, decodes the prompt encoded inside it, and merges them all into a single
 * prompt you can copy in one click — instead of opening each bug one by one.
 *
 * Bugbot links look like:  cursor://anysphere.cursor-deeplink/createchat?data=<JWT>
 * The prompt lives in the JWT payload (base64url JSON, readable without the key).
 * We also handle ?prompt= / ?text= variants and decode defensively.
 */
(() => {
  if (window.__bugbotCombinerLoaded) return;
  window.__bugbotCombinerLoaded = true;

  // ---------- decoding helpers ----------
  function b64urlDecode(input) {
    let str = input.replace(/-/g, '+').replace(/_/g, '/');
    const pad = str.length % 4;
    if (pad) str += '='.repeat(4 - pad);
    try {
      const bin = atob(str);
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      return new TextDecoder('utf-8').decode(bytes);
    } catch (_) {
      return null;
    }
  }

  // Recursively pull the most prompt-like string out of a decoded JSON object.
  const PROMPT_KEYS = /^(prompt|text|message|instructions?|body|content|task|query)$/i;
  function extractPromptFromObject(obj) {
    let best = '';
    const visit = (val, keyHint) => {
      if (val == null) return;
      if (typeof val === 'string') {
        if (keyHint && PROMPT_KEYS.test(keyHint) && val.length > best.length) {
          best = val;
        }
        return;
      }
      if (Array.isArray(val)) {
        val.forEach((v) => visit(v, keyHint));
        return;
      }
      if (typeof val === 'object') {
        for (const [k, v] of Object.entries(val)) visit(v, k);
      }
    };
    visit(obj, null);
    return best;
  }

  function decodeJwtPayload(token) {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const json = b64urlDecode(parts[1]);
    if (!json) return null;
    try {
      return JSON.parse(json);
    } catch (_) {
      return null;
    }
  }

  // Try to pull a prompt out of an arbitrary encoded blob (JWT or base64url JSON).
  function tryDecodeBlob(v) {
    if (!v || v.length < 8) return null;
    if (v.split('.').length >= 2) {
      const payload = decodeJwtPayload(v);
      if (payload) {
        return extractPromptFromObject(payload) || JSON.stringify(payload, null, 2);
      }
    }
    const json = b64urlDecode(v);
    if (json && /^[\s]*[{[]/.test(json)) {
      try {
        const obj = JSON.parse(json);
        return extractPromptFromObject(obj) || JSON.stringify(obj, null, 2);
      } catch (_) {
        /* not json */
      }
    }
    return null;
  }

  // Given a "Fix in Cursor" URL, return the best-effort prompt text.
  function decodePromptFromHref(href) {
    let url;
    try {
      // Custom schemes (cursor://) -> normalize so URL()/searchParams behave.
      url = new URL(href.replace(/^[a-z][a-z0-9+.-]*:\/\//i, 'https://_cursor_/'), location.href);
    } catch (_) {
      return { prompt: null, raw: href };
    }

    // Collect params from both the query string and the hash fragment.
    const entries = [...url.searchParams.entries()];
    const hash = url.hash.replace(/^#/, '');
    if (hash.includes('=')) {
      try {
        for (const [k, v] of new URLSearchParams(hash).entries()) entries.push([k, v]);
      } catch (_) {}
    }

    // 1) Plain text-bearing params.
    for (const [k, v] of entries) {
      if (/^(prompt|text|message|q|instructions?|task)$/i.test(k) && v) {
        return { prompt: safeDecodeURIComponent(v), raw: href, via: k };
      }
    }
    // 2) Any param value that decodes as a JWT / base64 JSON (data=, payload=, etc.).
    for (const [k, v] of entries) {
      const got = tryDecodeBlob(v);
      if (got) return { prompt: got, raw: href, via: k };
    }
    return { prompt: null, raw: href };
  }

  function safeDecodeURIComponent(v) {
    try {
      return decodeURIComponent(v.replace(/\+/g, ' '));
    } catch (_) {
      return v;
    }
  }

  // Resolve the operative URL for a "Fix in Cursor" control (anchor, button, etc.).
  function resolveUrl(el) {
    if (el.tagName === 'A' && el.getAttribute('href')) return el.href || el.getAttribute('href');
    const innerA = el.querySelector?.('a[href]');
    if (innerA) return innerA.href || innerA.getAttribute('href');
    const closeA = el.closest?.('a[href]');
    if (closeA) return closeA.href || closeA.getAttribute('href');
    for (const attr of el.attributes || []) {
      if (/(href|url|deeplink|cursor|data-)/i.test(attr.name) && /(https?:|cursor:|[?&]data=)/i.test(attr.value)) {
        return attr.value;
      }
    }
    const onclick = el.getAttribute?.('onclick') || '';
    const m = onclick.match(/(https?:\/\/[^'"\s)]+|cursor:\/\/[^'"\s)]+)/i);
    if (m) return m[1];
    return null;
  }

  // Everything that might carry the "Fix in Cursor" label, including image badges.
  function controlLabel(el) {
    const parts = [
      el.textContent || '',
      el.getAttribute?.('aria-label') || '',
      el.getAttribute?.('title') || '',
      el.getAttribute?.('alt') || '',
    ];
    el.querySelectorAll?.('img').forEach((img) => parts.push(img.alt || '', img.getAttribute('aria-label') || ''));
    return parts.join(' ');
  }

  function looksLikeFixControl(el) {
    const label = controlLabel(el);
    // Only the "Fix in Cursor" control — never "Fix in Web" / browser agent.
    if (/\bweb\b/i.test(label)) return false;
    return /fix\s+in\s+cursor|open\s+in\s+cursor/i.test(label);
  }

  // ---------- finding bugbot links ----------
  function findFixLinks() {
    const controls = Array.from(
      document.querySelectorAll('a, button, [role="button"], summary, img'),
    );
    const matches = controls.filter(looksLikeFixControl);

    const seen = new Set();
    const results = [];
    for (const el of matches) {
      const url = resolveUrl(el);
      if (!url) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      const decoded = decodePromptFromHref(url);
      const context = getCommentContext(el);
      results.push({ href: url, ...decoded, ...context });
    }

    if (window.__bugbotDebug) {
      // eslint-disable-next-line no-console
      console.info('[BugbotCombiner] matched controls:', matches.length, 'resolved urls:', results.map((r) => r.href));
    }
    return results;
  }

  function getCommentContext(el) {
    const container =
      el.closest('[id^="issuecomment-"]') ||
      el.closest('[id^="discussion_r"]') ||
      el.closest('.js-comment') ||
      el.closest('.timeline-comment') ||
      el.closest('.TimelineItem');
    let permalink = '';
    let title = '';
    if (container) {
      if (container.id) {
        permalink = `${location.origin}${location.pathname}#${container.id}`;
      }
      const ts = container.querySelector('a.js-timestamp, a[href*="#issuecomment-"], a[href*="#discussion_r"]');
      if (ts && ts.href) permalink = ts.href;
      // Bugbot bodies usually open with a bold/heading bug summary.
      const heading = container.querySelector(
        '.comment-body h1, .comment-body h2, .comment-body h3, .comment-body strong, .markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body strong',
      );
      if (heading) title = (heading.textContent || '').trim().slice(0, 120);
    }
    return { permalink, title };
  }

  // Human-readable breakdown of each control's token — for diagnosing format.
  function getDiagnostics() {
    const controls = Array.from(
      document.querySelectorAll('a, button, [role="button"], summary, img'),
    ).filter(looksLikeFixControl);
    const lines = [`Matched ${controls.length} "Fix in Cursor" control(s).`, `Page: ${location.href}`, ''];
    controls.forEach((el, i) => {
      const url = resolveUrl(el);
      lines.push(`#${i} <${el.tagName.toLowerCase()}> label="${controlLabel(el).trim().slice(0, 50)}"`);
      lines.push(`url: ${url || '(none found on element)'}`);
      try {
        const u = new URL((url || '').replace(/^[a-z][a-z0-9+.-]*:\/\//i, 'https://_c_/'), location.href);
        lines.push(`host: ${u.host}  path: ${u.pathname}`);
        const all = [...u.searchParams.entries()];
        const hash = u.hash.replace(/^#/, '');
        if (hash.includes('=')) for (const e of new URLSearchParams(hash).entries()) all.push(e);
        if (all.length === 0) lines.push('(no query params)');
        for (const [k, v] of all) {
          const segs = v.split('.');
          lines.push(`param "${k}": length=${v.length} dotSegments=${segs.length}`);
          if (segs.length >= 2) {
            lines.push(`  jwt header : ${b64urlDecode(segs[0])}`);
            lines.push(`  payload    : ${(b64urlDecode(segs[1]) || '(not base64)').slice(0, 500)}`);
          } else {
            lines.push(`  valuePreview: ${v.slice(0, 200)}`);
          }
        }
      } catch (e) {
        lines.push(`(could not parse url: ${e.message})`);
      }
      lines.push('');
    });
    return lines.join('\n');
  }

  // ---------- collect bug descriptions from the Bugbot comment bodies ----------
  function extractCommentBody(container) {
    const body =
      container.querySelector('.comment-body') ||
      container.querySelector('.markdown-body') ||
      container.querySelector('[class*="comment-body"]') ||
      container;
    const clone = body.cloneNode(true);
    // Drop the action buttons / badges so we keep just the bug description.
    clone
      .querySelectorAll('a, button, [role="button"], img, .btn, .Button')
      .forEach((el) => {
        if (/fix in cursor|fix in web|open in cursor/i.test(controlLabel(el))) {
          (el.closest('p, div, li') || el).remove();
        }
      });
    let text = (clone.innerText || '').replace(/\n{3,}/g, '\n\n').trim();
    text = text.replace(/^(Fix in Cursor|Fix in Web|Open in Cursor)\s*$/gim, '').trim();
    return text;
  }

  // ---------- comment scan (classic UI, new Conversation UI, and Files changed) ----------
  // Every comment lives in an element whose id carries its database id.
  const COMMENT_ID = /^(issuecomment-|discussion_r|r)(\d+)$/;
  const LEGACY_THREAD = '.js-resolvable-timeline-thread-container, .review-thread-component';
  const KNOWN_BOTS = /^(coderabbitai|cursor|copilot|github-actions|dependabot|renovate|sonarcloud|codecov|vercel|linear|sentry|greptile|graphite-app)$/i;

  function getCommentUnits() {
    const units = Array.from(document.querySelectorAll('[id]')).filter(
      (el) => COMMENT_ID.test(el.id) && getBodyEl(el),
    );
    return units.filter((el) => !units.some((other) => other !== el && el.contains(other)));
  }

  function getBodyEl(unit) {
    return unit.querySelector('.comment-body') || unit.querySelector('.markdown-body');
  }

  function getAuthorName(unit) {
    const el =
      unit.querySelector('a[class*="AuthorName"]') ||
      unit.querySelector('.author') ||
      unit.querySelector('[data-hovercard-type="user"]') ||
      unit.querySelector('a.Link--primary.text-bold');
    return (el?.textContent || '').trim();
  }

  // GitHub App accounts are suffixed "[bot]"; some UIs drop the suffix, so also match known names.
  function isBotAuthor(name) {
    return /\[bot\]\s*$/i.test(name) || KNOWN_BOTS.test(name.trim());
  }

  function isResolveButton(btn) {
    return /^(un)?resolve\b/i.test(btn.getAttribute('aria-label') || '');
  }

  // Nearest ancestor holding the thread's Resolve / Unresolve button (new UIs), or the classic thread box.
  function getThread(unit) {
    if (unit.id.startsWith('issuecomment-')) return null;
    const legacy = unit.closest(LEGACY_THREAD);
    if (legacy) return legacy;
    let node = unit.parentElement;
    for (let i = 0; i < 12 && node && node !== document.body; i++, node = node.parentElement) {
      if (Array.from(node.querySelectorAll('button[aria-label]')).some(isResolveButton)) return node;
    }
    return null;
  }

  function isResolved(thread) {
    const buttons = Array.from(thread.querySelectorAll('button[aria-label]')).filter(isResolveButton);
    if (buttons.length) return buttons.some((b) => /^unresolve/i.test(b.getAttribute('aria-label')));
    if (thread.getAttribute('data-resolved') === 'true') return true;
    if (/(^|\s)(is-resolved|resolved)(\s|$)/i.test(thread.className)) return true;
    const toggler = thread.querySelector('.js-resolvable-thread-toggler, .timeline-comment-label');
    return Boolean(toggler && /resolved/i.test(toggler.textContent || ''));
  }

  function getFileAndLine(unit, thread) {
    const labelled = Array.from(thread?.querySelectorAll('button[aria-label]') || [])
      .map((b) => b.getAttribute('aria-label').match(/ in (.+), line (\d+)$/))
      .find(Boolean);
    if (labelled) return { file: labelled[1], line: labelled[2] };

    const entry = unit.closest('[class*="PullRequestDiffsList-module__diffEntry"], [class*="diffEntry"]');
    const lineCell = unit.closest('td[data-line-number]');
    if (entry) return { file: getEntryPath(entry), line: lineCell?.getAttribute('data-line-number') || '' };

    const pathAncestor = unit.closest('[data-tagsearch-path], [data-path]');
    const diffLink = thread?.querySelector('a[href*="#diff-"]');
    const file =
      pathAncestor?.getAttribute('data-tagsearch-path') ||
      pathAncestor?.getAttribute('data-path') ||
      (diffLink?.textContent || '').trim();
    const nums = Array.from(thread?.querySelectorAll('[data-line-number]') || [])
      .map((el) => parseInt(el.getAttribute('data-line-number'), 10))
      .filter((n) => n > 0);
    return { file, line: nums.length ? String(Math.max(...nums)) : '' };
  }

  function getPermalink(unit) {
    const [, kind, id] = unit.id.match(COMMENT_ID);
    const pullPath = location.pathname.match(/^\/[^/]+\/[^/]+\/pull\/\d+/)[0];
    const anchor = kind === 'issuecomment-' ? `issuecomment-${id}` : `discussion_r${id}`;
    return `${location.origin}${pullPath}#${anchor}`;
  }

  function getTitle(bodyEl, body) {
    const heading = bodyEl.querySelector('h1, h2, h3, h4');
    return (heading?.textContent || '').trim().slice(0, 120) || firstLine(body);
  }

  function firstLine(text) {
    return (text || '').split('\n').find((l) => l.trim())?.trim().slice(0, 120) || '';
  }

  function collectComments() {
    const seen = new Set();
    const result = { bots: [], humans: [] };
    for (const unit of getCommentUnits()) {
      const permalink = getPermalink(unit);
      if (seen.has(permalink)) continue;
      seen.add(permalink);
      const author = getAuthorName(unit);
      if (!author) continue;
      const thread = getThread(unit);
      if (thread && isResolved(thread)) continue;
      const bot = isBotAuthor(author);
      if (!bot && !thread) continue;
      const bodyEl = getBodyEl(unit);
      const body = extractCommentBody(unit);
      if (!body) continue;
      const { file, line } = thread ? getFileAndLine(unit, thread) : { file: '', line: '' };
      result[bot ? 'bots' : 'humans'].push({ author, file, line, permalink, body, title: getTitle(bodyEl, body) });
    }
    return result;
  }

  // ---------- prompt output ----------
  function locationLabel(it) {
    return it.file ? `${it.file}${it.line ? `:${it.line}` : ''}` : '';
  }

  function formatComment(it, i) {
    const loc = locationLabel(it);
    const header = `### ${i + 1}. ${it.author}${loc ? ` (${loc})` : ''}`;
    return [header, it.permalink ? `Source: ${it.permalink}` : '', '', it.body].filter(Boolean).join('\n');
  }

  const Intros = {
    bots: (n) => `Please address the following ${n} bot review comment(s) on this PR:\n`,
    humans: (n) => `Please address the following ${n} reviewer comment(s) on this PR:\n`,
  };

  function buildDatasets() {
    return Object.fromEntries(
      Object.entries(collectComments()).map(([key, list]) => [
        key,
        {
          count: list.length,
          text: list.length ? [Intros[key](list.length), list.map(formatComment).join('\n\n---\n\n')].join('\n') : '',
          items: list.map((it) => ({
            title: it.title,
            meta: [it.author, locationLabel(it)].filter(Boolean).join(' · '),
            body: it.body.startsWith(it.title) ? it.body.slice(it.title.length).trim() || it.body : it.body,
            permalink: it.permalink,
            text: formatComment(it, 0),
          })),
        },
      ]),
    );
  }

  // ---------- Files changed: mark viewed / unviewed ----------
  // GitHub's Files-changed view (2025 rewrite) renders each file as a CSS-module
  // "diffEntry" and the "Viewed" control as a toggle <button aria-pressed>, not a
  // checkbox. Module hashes (e.g. "__djnVa") change across deploys, so match on the
  // stable name prefix; fall back to the content-visibility signature / aria-label,
  // which don't depend on GitHub's build-time class names at all.
  function getDiffEntries() {
    const primary = Array.from(document.querySelectorAll('[class*="PullRequestDiffsList-module__diffEntry"]'));
    if (primary.length) return primary;
    return Array.from(document.querySelectorAll('[style*="content-visibility"]'));
  }

  function getViewedButton(entry) {
    return (
      entry.querySelector('[class*="MarkAsViewedButton-module"]') ||
      entry.querySelector('button[aria-pressed][aria-label="Viewed"], button[aria-pressed][aria-label="Not Viewed"]')
    );
  }

  // Large-diff entries use `content-visibility: auto` and don't mount their controls
  // (including the Viewed button) until scrolled near the viewport — scroll each one
  // into view first and wait for it to mount. Big files can take a couple seconds.
  async function getMountedViewedButton(entry) {
    let btn = getViewedButton(entry);
    if (btn) return btn;
    entry.scrollIntoView({ block: 'center' });
    for (let i = 0; i < 20 && !btn; i++) {
      await new Promise((r) => setTimeout(r, 150));
      btn = getViewedButton(entry);
    }
    return btn;
  }

  // Files that are noise in review (translations, tests, help-center content).
  const AUTO_VIEWED_PATTERNS = [/(^|\/)i18n\//, /\.test\.[^/]+$/, /(^|\/)help-center\//];
  const AUTO_VIEWED_STORAGE_KEY = 'autoMarkNoiseViewed';

  function isNoisePath(path) {
    return AUTO_VIEWED_PATTERNS.some((re) => re.test(path));
  }

  function getEntryPath(entry) {
    const pathEl = entry.querySelector('[data-tagsearch-path], [data-path], [data-file-path]');
    if (pathEl) {
      return (
        pathEl.getAttribute('data-tagsearch-path') ||
        pathEl.getAttribute('data-path') ||
        pathEl.getAttribute('data-file-path')
      );
    }
    const nameEl =
      entry.querySelector('[class*="file-name"] a, [class*="FileName"] a, [class*="file-name"], [class*="FileName"]') ||
      entry.querySelector('h3 a, a[href*="#diff-"]');
    // GitHub wraps paths with zero-width / bidi marks to allow line-breaking.
    return (nameEl?.textContent || '').replace(/[‎‏​]/g, '').trim();
  }

  async function getMountedEntryPath(entry) {
    let path = getEntryPath(entry);
    if (path) return path;
    entry.scrollIntoView({ block: 'center' });
    for (let i = 0; i < 20 && !path; i++) {
      await new Promise((r) => setTimeout(r, 150));
      path = getEntryPath(entry);
    }
    return path;
  }

  // Click (not just set aria-pressed) so GitHub's own handlers fire and the viewed
  // state actually persists server-side. Scrolling to a later (still-unmounted) entry
  // can unmount an earlier one before its click finishes persisting, which silently
  // reverts its optimistic UI state back to "not viewed" on remount — so this runs
  // several verification passes and re-clicks anything that isn't in the target state
  // yet, rather than trusting a single pass to converge.
  async function setAllViewed(shouldBeChecked, onProgress, pathFilter) {
    let changed = 0;
    for (let pass = 0; pass < 5; pass++) {
      let mismatched = 0;
      for (const entry of getDiffEntries()) {
        if (pathFilter) {
          const path = await getMountedEntryPath(entry);
          if (!path || !pathFilter(path)) continue;
        }
        const btn = await getMountedViewedButton(entry);
        if (!btn) {
          mismatched++;
          continue;
        }
        const isViewed = btn.getAttribute('aria-pressed') === 'true';
        if (isViewed === shouldBeChecked) continue;
        mismatched++;
        btn.click();
        changed++;
        onProgress?.(changed);
        await new Promise((r) => setTimeout(r, 400));
      }
      if (!mismatched) break;
    }
    return changed;
  }

  // Lives in the page so a run keeps going after the popup closes; the popup polls it.
  const markState = { running: false, mode: null, done: 0, result: null };

  async function runMark(mode) {
    if (markState.running) return;
    const scrollY = window.scrollY;
    Object.assign(markState, { running: true, mode, done: 0, result: null });
    const n = await setAllViewed(
      mode !== 'unviewed',
      (done) => (markState.done = done),
      mode === 'noise' ? isNoisePath : undefined,
    );
    window.scrollTo({ top: scrollY });
    Object.assign(markState, { running: false, result: n });
  }

  let autoMarkEnabled = false;
  chrome.storage.sync.get(AUTO_VIEWED_STORAGE_KEY).then((stored) => {
    autoMarkEnabled = Boolean(stored[AUTO_VIEWED_STORAGE_KEY]);
    refresh();
  });
  chrome.storage.onChanged.addListener((changes) => {
    if (!(AUTO_VIEWED_STORAGE_KEY in changes)) return;
    autoMarkEnabled = Boolean(changes[AUTO_VIEWED_STORAGE_KEY].newValue);
    refresh();
  });

  // Runs once per PR per page session, so manually un-viewing a file sticks.
  const autoMarkedPulls = new Set();
  function maybeAutoMarkNoise() {
    if (!autoMarkEnabled || !getDiffEntries().length) return;
    const pullKey = location.pathname.match(/^\/[^/]+\/[^/]+\/pull\/\d+/)?.[0];
    if (!pullKey || autoMarkedPulls.has(pullKey) || markState.running) return;
    autoMarkedPulls.add(pullKey);
    runMark('noise');
  }

  // ---------- popup messaging ----------
  function isPullPage() {
    return /^\/[^/]+\/[^/]+\/pull\/\d+/.test(location.pathname);
  }

  const MessageHandlers = {
    getState: () => ({ datasets: buildDatasets() }),
    getMarkState: () => ({}),
    mark: (msg) => {
      runMark(msg.mode);
      return {};
    },
    diagnostics: () => ({ diagnostics: getDiagnostics() }),
  };

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    const handler = MessageHandlers[msg?.type];
    if (!handler) return;
    if (!isPullPage()) {
      sendResponse({ onPull: false });
      return;
    }
    sendResponse({ onPull: true, hasDiff: getDiffEntries().length > 0, mark: markState, ...handler(msg) });
  });

  // ---------- toolbar badge + lifecycle ----------
  let lastCount = null;
  function refresh() {
    const count = isPullPage()
      ? Object.values(buildDatasets()).reduce((sum, ds) => sum + ds.count, 0)
      : 0;
    if (count !== lastCount) {
      lastCount = count;
      try {
        chrome.runtime.sendMessage({ type: 'count', count }).catch(() => {});
      } catch (_) {
        // Extension was reloaded; this orphaned content script can't talk to it anymore.
      }
    }
    if (isPullPage()) maybeAutoMarkNoise();
  }

  let debounce;
  const observer = new MutationObserver(() => {
    clearTimeout(debounce);
    debounce = setTimeout(refresh, 400);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // GitHub navigates via Turbo/pjax without full reloads.
  document.addEventListener('turbo:load', refresh);
  document.addEventListener('pjax:end', refresh);
  window.addEventListener('popstate', refresh);

  // Debug helper: run `bugbotDebug()` in the page console to inspect the token.
  window.bugbotDebug = () => {
    window.__bugbotDebug = true;
    const controls = Array.from(
      document.querySelectorAll('a, button, [role="button"], summary, img'),
    ).filter(looksLikeFixControl);
    const report = controls.map((el, i) => {
      const url = resolveUrl(el);
      let parsed = null;
      try {
        const u = new URL((url || '').replace(/^[a-z][a-z0-9+.-]*:\/\//i, 'https://_c_/'), location.href);
        const params = {};
        for (const [k, v] of u.searchParams.entries()) {
          const segs = v.split('.').length;
          params[k] = {
            length: v.length,
            jwtSegments: segs,
            header: segs >= 2 ? b64urlDecode(v.split('.')[0]) : null,
            payloadPreview: segs >= 2 ? (b64urlDecode(v.split('.')[1]) || '').slice(0, 300) : null,
          };
        }
        parsed = { host: u.host, path: u.pathname, params };
      } catch (_) {}
      // eslint-disable-next-line no-console
      console.log(`#${i}`, el.tagName, controlLabel(el).trim().slice(0, 40), '\n', url, '\n', parsed);
      return { url, parsed };
    });
    // eslint-disable-next-line no-console
    console.log('[BugbotCombiner] decoded results:', findFixLinks());
    return report;
  };

  // Broad scanner: dumps the raw HTML of ANYTHING mentioning "cursor" so we can
  // see the real button markup. Run `bugbotScan()` and paste the output.
  window.bugbotScan = () => {
    const all = Array.from(document.querySelectorAll('a, button, [role="button"], img, summary, span'));
    const cands = all.filter((el) => {
      const t = `${controlLabel(el)} ${el.getAttribute?.('href') || ''}`;
      return /cursor/i.test(t);
    });
    // eslint-disable-next-line no-console
    console.log(`[BugbotCombiner] ${cands.length} element(s) mentioning "cursor":`);
    cands.forEach((el, i) => {
      // eslint-disable-next-line no-console
      console.log(`#${i} <${el.tagName.toLowerCase()}> href=${el.getAttribute?.('href') || '—'}`);
      // eslint-disable-next-line no-console
      console.log(el.outerHTML.slice(0, 800));
    });
    return cands.map((el) => el.outerHTML);
  };

  // eslint-disable-next-line no-console
  console.info('[BugbotCombiner] loaded. On a PR, click the extension icon in the toolbar.');

  refresh();
})();
