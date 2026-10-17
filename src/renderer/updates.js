/* global icon, brandMark, esc, ui, render, fmtAgo, openModal, closeModal */
// Updates: Settings › Updates, the titlebar chip when a new version is waiting, and the
// "Updated to x" card the first time a new version opens.

const upd = { status: null, changelog: null, notesKey: null, notesSafe: '' };

// GitHub's release notes as HTML (rendered and cleaned by GitHub, as on the release page).
// Only plain formatting, https links and images are kept; anything else becomes its text.
const NOTE_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'P', 'UL', 'OL', 'LI', 'STRONG', 'B', 'EM', 'I', 'CODE', 'PRE', 'A', 'BR', 'BLOCKQUOTE', 'HR', 'DEL', 'IMG']);
const NOTE_DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'SVG', 'MATH', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'LINK', 'META', 'VIDEO', 'SUMMARY']);

function sanitizeNotes(html) {
  const t = document.createElement('template');
  t.innerHTML = String(html);
  [...t.content.querySelectorAll('*')].reverse().forEach((el) => {
    const tag = el.tagName.toUpperCase();
    if (NOTE_DROP.has(tag)) return el.remove();
    if (!NOTE_TAGS.has(tag)) return el.replaceWith(...el.childNodes);
    for (const a of [...el.attributes]) if (!['href', 'src', 'alt'].includes(a.name)) el.removeAttribute(a.name);
    for (const k of ['href', 'src']) if (el.hasAttribute(k) && !/^https:\/\//i.test(el.getAttribute(k))) el.removeAttribute(k);
    if (tag === 'IMG' && !el.getAttribute('src')) return el.remove();
    if (tag === 'A') el.setAttribute('data-note-link', '');
  });
  const box = document.createElement('div');
  box.appendChild(t.content);
  return box.innerHTML;
}

/** Plain-text notes (no HTML from GitHub) as paragraphs and bullet lists. */
function plainNotes(text) {
  const lines = String(text).replace(/\r/g, '').split('\n');
  let html = '';
  let list = false;
  for (const raw of lines) {
    const line = raw.trim();
    const bullet = line.match(/^[-*]\s+(.*)$/);
    if (bullet && !list) html += '<ul>';
    if (!bullet && list) html += '</ul>';
    list = !!bullet;
    if (bullet) html += `<li>${esc(bullet[1])}</li>`;
    else if (/^#+\s/.test(line)) html += `<h4>${esc(line.replace(/^#+\s/, ''))}</h4>`;
    else if (line) html += `<p>${esc(line)}</p>`;
  }
  return html + (list ? '</ul>' : '');
}

function releaseNotes(u) {
  const key = `${u.latest}:${(u.notesHtml || u.notes || '').length}`;
  if (upd.notesKey !== key) {
    upd.notesKey = key;
    upd.notesSafe = u.notesHtml ? sanitizeNotes(u.notesHtml) : u.notes ? plainNotes(u.notes) : '';
  }
  return upd.notesSafe;
}

/** What the updater is doing, as a tone, an icon and a sentence. */
function updMessage(u) {
  const v = (x) => `<b>${esc(x)}</b>`;
  if (u.devCopy) {
    const now = u.state === 'checking' ? ' Checking…' : u.latest ? ` The newest version is ${v(u.latest)}.` : '';
    return { tone: '', ic: 'lock', text: `This copy runs from a folder you're working in, so it only checks for updates (use <code>git pull</code>).${now}` };
  }
  switch (u.repo || u.state === 'error' ? u.state : 'norepo') {
    case 'norepo':
      return { tone: '', ic: 'clock', text: 'Updates switch on once the project has a GitHub repository. Add it below.' };
    case 'checking':
      return { tone: 'busy', ic: 'refresh', text: 'Checking for updates…' };
    case 'downloading':
      return { tone: 'busy', ic: 'down', text: `Downloading version ${v(u.latest)}…` };
    case 'available':
      return { tone: 'new', ic: 'sparkle', text: u.manual ? `Version ${v(u.latest)} is out. Download it from its release page.` : `Version ${v(u.latest)} is out.` };
    case 'ready':
      if (u.installedApp && u.blocked)
        return { tone: 'bad', ic: 'alert', text: 'macOS stopped Pear Drops updating itself. Open System Settings, turn on Pear Drops under <b>App Management</b>, then restart again. Or use the disk image.' };
      if (u.installedApp)
        return {
          tone: 'new',
          ic: 'gift',
          text:
            u.platform === 'darwin' && !u.swap
              ? `Version ${v(u.installed)} is downloaded. Click Install, then drag Pear Drops into Applications (replace the old one).`
              : `Version ${v(u.installed)} is ready. Restart to install it: the app closes, updates and opens again.`,
        };
      return u.needsInstall
        ? { tone: 'new', ic: 'gift', text: `Version ${v(u.installed)} is installed. Quit, then start the app with its launcher to finish: this update reinstalls the app engine once.` }
        : { tone: 'new', ic: 'gift', text: `Version ${v(u.installed)} is installed. Restart to use it.` };
    case 'uptodate':
      return { tone: 'ok', ic: 'check', text: 'You have the newest version.' };
    case 'error':
      return {
        tone: 'bad',
        ic: 'alert',
        text:
          u.error === 'notfound'
            ? "That GitHub repository wasn't found. Check the name, and that it's public."
            : u.error === 'badrepo'
              ? 'That isn’t a GitHub repository name. Use owner/repository.'
              : u.error === 'nowrite'
                ? "Couldn't save the new files in the app's folder. Move it to a folder you own and try again."
                : ['wrongapp', 'nopkg', 'incomplete'].includes(u.error)
                  ? "That repository doesn't look like Pear Drops."
                  : `Couldn't check right now (${esc(u.error)}). It tries again later.`,
      };
    default:
      return { tone: '', ic: 'clock', text: u.repo ? 'Not checked yet.' : '' };
  }
}

function primaryAction(u) {
  if (u.devCopy) return '';
  if (u.state === 'available') return `<button class="btn primary" data-action="update-install">${icon('down')} ${u.manual ? 'Open download page' : u.installedApp ? 'Download update' : 'Download and install'}</button>`;
  if (u.state === 'ready' && !u.needsInstall && !u.blocked)
    return `<button class="btn primary" data-action="update-restart">${icon('reload')} ${u.installedApp ? (u.platform === 'darwin' && !u.swap ? 'Install' : 'Restart and install') : 'Restart now'}</button>`;
  return '';
}

/** Settings › Updates. */
function updatesPane() {
  const u = upd.status;
  if (!u) return '<div class="upd-hero"><div class="spinner"></div></div>';
  const m = updMessage(u);
  const busy = u.state === 'checking' || u.state === 'downloading';
  const beta = /^0\./.test(u.current);
  const progress =
    u.state === 'downloading'
      ? `<div class="upd-progress ${u.progress == null ? 'indeterminate' : ''}"><i style="width:${Math.round((u.progress ?? 0.3) * 100)}%"></i></div><span class="upd-pct num">${u.progress == null ? '' : `${Math.round(u.progress * 100)}%`}</span>`
      : '';
  const notes = (u.state === 'available' || u.state === 'ready') && (u.notesHtml || u.notes) ? releaseNotes(u) : '';
  const release =
    u.latest && (u.state === 'available' || u.state === 'ready')
      ? `<div class="upd-release">
          <div class="upd-release-head"><span class="chip green">${icon('sparkle')} New</span><b>Version ${esc(u.latest)}</b>
            ${u.published ? `<span class="muted">${new Date(u.published).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</span>` : ''}
            <div class="spacer"></div><button class="link small" data-action="update-page">${icon('external')} Release page</button></div>
          ${notes ? `<div class="upd-notes">${notes}</div>` : ''}
        </div>`
      : '';
  const blocked = u.blocked
    ? `<div class="upd-blocked"><button class="btn sm" data-action="update-privacy">${icon('settings')} Open System Settings</button><button class="btn sm ghost" data-action="update-dmg">Use the disk image instead</button></div>`
    : '';
  const toggle = `<button class="switch ${u.auto ? 'on' : ''}" data-action="update-auto" ${u.devCopy ? 'disabled' : ''}></button>`;
  const repo = `<form class="upd-repo" data-update-repo><span class="upd-gh">github.com/</span><input name="repo" value="${esc(u.repo || '')}" placeholder="owner/repository" spellcheck="false" autocomplete="off" /><button class="btn sm">Save</button></form>`;

  return `<div class="upd-hero ${m.tone}">
      <div class="upd-mark">${brandMark(58)}<span class="upd-badge ${m.tone}">${icon(m.ic)}</span></div>
      <div class="upd-info">
        <div class="upd-title">Pear Drops <span class="upd-ver num">v${esc(u.current)}</span>${beta ? '<span class="chip flat">beta</span>' : ''}</div>
        <div class="upd-state">${m.text}</div>
        <div class="upd-sub">${u.lastCheck ? `Checked ${fmtAgo(u.lastCheck)}` : 'Never checked'}${u.repo ? ` · github.com/${esc(u.repo)}` : ''}</div>
      </div>
      <div class="upd-actions">
        ${primaryAction(u)}
        <button class="btn" data-action="update-check" ${!u.repo || busy ? 'disabled' : ''}>${icon('refresh')} Check now</button>
      </div>
      ${progress ? `<div class="upd-progress-row">${progress}</div>` : ''}
    </div>
    ${blocked}
    ${release}
    <div class="setting"><div class="text"><b>Update automatically</b><span>Downloads new versions in the background; they install when you restart.</span></div>${toggle}</div>
    <div class="setting"><div class="text"><b>GitHub repository</b><span>Where new versions come from. It must be public.</span></div>${repo}</div>
    ${release ? '' : `<h4 class="upd-h">What's new</h4>${changelogTimeline()}`}
    <p class="pane-note">Updating replaces the app, keeping the old version as a backup. Your login, settings, history and saved drops aren't touched.</p>`;
}

function changelogTimeline(limit = 8) {
  const list = upd.changelog;
  if (!list) return '<div class="upd-timeline"><div class="spinner"></div></div>';
  if (!list.length) return '<p class="pane-note">No release notes yet.</p>';
  return `<ol class="upd-timeline">${list
    .slice(0, limit)
    .map(
      (v) => `<li class="${v.current ? 'current' : ''}"><span class="upd-dot"></span>
        <div class="upd-v"><b>${esc(v.version)}</b>${v.current ? '<span class="chip green">This version</span>' : ''}</div>
        <ul>${v.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></li>`,
    )
    .join('')}</ol>`;
}

/** A glowing chip in the titlebar while a new version waits. */
function updateChip() {
  const u = upd.status;
  if (!u || u.devCopy) return '';
  if (u.state === 'ready' && !u.needsInstall) return `<button class="tb-update ready" data-action="update-chip" data-tip="Version ${esc(u.installed)} is ready. Click to install">${icon('gift')}<span>Update ready</span></button>`;
  if (u.state === 'downloading') return `<button class="tb-update" data-action="update-chip" data-tip="Downloading version ${esc(u.latest)}">${icon('down')}<span>${u.progress == null ? 'Updating' : `${Math.round(u.progress * 100)}%`}</span></button>`;
  if (u.state === 'available') return `<button class="tb-update" data-action="update-chip" data-tip="Version ${esc(u.latest)} is out">${icon('sparkle')}<span>v${esc(u.latest)}</span></button>`;
  return '';
}

/** The card shown once, the first time a new version opens. */
function whatsNewModal() {
  const j = upd.status?.justUpdated;
  const entry = upd.changelog?.find((v) => v.version === j?.to) ?? upd.changelog?.[0];
  return `<div class="modal-backdrop" data-action="close-whatsnew">
    <div class="modal whatsnew" data-stop>
      <div class="wn-glow"></div>
      <span class="wn-spark s1">✦</span><span class="wn-spark s2">✦</span><span class="wn-spark s3">✦</span>
      <div class="wn-mark">${brandMark(72)}</div>
      <div class="eyebrow">Updated from ${esc(j?.from ?? '')}</div>
      <h2>Pear Drops <span>${esc(j?.to ?? '')}</span></h2>
      ${entry?.items.length ? `<ul class="wn-list">${entry.items.map((i) => `<li>${icon('check')}<span>${esc(i)}</span></li>`).join('')}</ul>` : '<p class="muted">Small fixes and improvements.</p>'}
      <div class="wn-foot"><button class="btn ghost" data-action="whatsnew-all">See every version</button><button class="btn primary" data-action="close-whatsnew">Nice</button></div>
    </div>
  </div>`;
}

const updateActions = {
  'update-check': () => window.pd.updates.check(),
  'update-install': () => window.pd.updates.install(),
  'update-restart': async () => {
    const r = await window.pd.updates.restart();
    if (r?.blocked) {
      ui.settingsTab = 'updates';
      render();
    }
  },
  'update-auto': () => window.pd.updates.settings({ auto: !upd.status?.auto }).then(setUpdateStatus),
  'update-page': () => window.pd.updates.openPage(),
  'update-privacy': () => window.pd.updates.privacySettings(),
  'update-dmg': () => window.pd.updates.useDmg(),
  'update-chip': () => {
    ui.settingsTab = 'updates';
    openModal('settings');
  },
  'close-whatsnew': () => closeModal(),
  'whatsnew-all': () => {
    closeModal();
    ui.settingsTab = 'updates';
    openModal('settings');
  },
};

function setUpdateStatus(status) {
  upd.status = status;
  // The first start of a new version: celebrate it once.
  if (status?.justUpdated && !ui.modal && !upd.shownWhatsNew) {
    upd.shownWhatsNew = true;
    openModal('whatsnew');
  }
  render();
}

function initUpdates() {
  window.pd.updates.onStatus(setUpdateStatus);
  window.pd.updates.status().then(setUpdateStatus);
  window.pd.updates.changelog().then((list) => {
    upd.changelog = list;
    render();
  });
  document.addEventListener('submit', (event) => {
    const form = event.target.closest?.('[data-update-repo]');
    if (!form) return;
    event.preventDefault();
    window.pd.updates.settings({ repo: form.elements.repo.value }).then((s) => {
      setUpdateStatus(s);
      if (s.repo && s.state !== 'error') window.pd.updates.check();
    });
  });
  // Links in release notes open in the browser.
  document.addEventListener('click', (event) => {
    const a = event.target.closest?.('a[data-note-link]');
    if (!a) return;
    event.preventDefault();
    window.pd.updates.openLink(a.href);
  });
}
