// App shell: starts everything, owns the tabs, the top bar, the bottom nav and back-button behaviour.
import { $, el, icon, toast, choose, sheet } from './util.js';
import { openDb, requestPersistence, storageProblem } from './db.js';
import { loadIdentity, identity } from './identity.js';
import { cfg, loadConfig } from './config.js';
import { unlockAudio } from './audio.js';
import { mountOnboarding } from './onboard.js';
import { mountCamera } from './camera-ui.js';
import { recoverInterruptedRecording, clearActiveRec } from './camera.js';
import { createDraft, getSub, discard, pendingCount, events as subEvents } from './submissions.js';
import * as uploader from './uploader.js';
import { debug } from './debug.js';
import { isStandalone, installPanel, installDismissed, dismissInstall } from './install.js';

const TABS = ['camera', 'map', 'challenges', 'posts', 'settings'];
const NAV = [['map', 'Map', 'map'], ['challenges', 'Challenges', 'flag'], ['camera', 'Camera', 'camera'], ['posts', 'My posts', 'posts'], ['settings', 'Settings', 'gear']];
const mounted = {};
const routeStack = [];
const factories = {
  camera: async (root) => mountCamera(root, app),
  review: async (root) => (await import('./review.js')).mountReview(root, app),
  submit: async (root) => (await import('./review.js')).mountSubmit(root, app),
  map: async (root) => (await import('./map-view.js')).mountMap(root, app),
  challenges: async (root) => (await import('./challenges.js')).mountChallenges(root, app),
  posts: async (root) => (await import('./posts.js')).mountPosts(root, app),
  settings: async (root) => (await import('./settings.js')).mountSettings(root, app),
};

let bootDone = false;

function hideBoot() {
  if (bootDone) return;
  bootDone = true;
  const boot = document.getElementById('boot');
  if (!boot) return;
  boot.classList.add('gone');
  window.setTimeout(() => boot.remove(), 350);
}

function showBootError(error) {
  const boot = document.getElementById('boot');
  if (!boot || bootDone) return;
  const msg = String(error?.message || error || 'Unknown startup error');
  boot.dataset.warning = '1';
  boot.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'boot-error';
  const img = document.createElement('img');
  img.src = 'logo.png';
  img.alt = 'JOTA-JOTI';
  const title = document.createElement('strong');
  title.textContent = 'JOTA-JOTI Camera';
  const text = document.createElement('p');
  text.textContent = 'The app could not finish loading. Your saved photos and videos are not being deleted.';
  const retry = document.createElement('button');
  retry.className = 'btn';
  retry.textContent = 'Reload';
  retry.addEventListener('click', () => location.reload());
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = 'Technical details';
  const pre = document.createElement('pre');
  pre.textContent = msg.slice(0, 500);
  details.append(summary, pre);
  box.append(img, title, text, retry, details);
  boot.append(box);
}

function updateViewportHeight() {
  const h = window.visualViewport?.height || window.innerHeight;
  document.documentElement.style.setProperty('--app-height', `${Math.round(h)}px`);
}
updateViewportHeight();
window.addEventListener('resize', updateViewportHeight, { passive: true });
window.addEventListener('orientationchange', () => window.setTimeout(updateViewportHeight, 80), { passive: true });
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', updateViewportHeight, { passive: true });
  window.visualViewport.addEventListener('scroll', updateViewportHeight, { passive: true });
}

export const app = {
  cfg, view: null, params: {},
  back: goBack,
  ctx: { mode: 'photo', challenge: null, sound: null },
  go, refreshWho,
  openReview: (id) => go('review', { id }),
  startChallenge(challenge, mode) {
    app.ctx.challenge = challenge; app.ctx.mode = mode;
    go('camera', {}, { replace: true });
    mounted.camera && mounted.camera.setMode && mounted.camera.setMode(mode);
    mounted.camera && mounted.camera.refresh();
  },
  async saveError(e) {
    console.error(e);
    if (e && e.storage) await choose('This could not be saved', e.message, [{ label: 'OK', value: 'ok' }]);
    else toast('Something went wrong saving that. Please try again.', 'bad');
  },
};

function hashFor(name, params) { return '#/' + name + (params && params.id ? '/' + params.id : ''); }
function parseHash() {
  const m = /^#\/([a-z]+)(?:\/([0-9a-f-]+))?/.exec(location.hash);
  return m ? { name: m[1], params: m[2] ? { id: m[2] } : {} } : { name: 'camera', params: {} };
}

async function setView(name, params = {}) {
  if (!factories[name]) name = 'camera';
  const prev = app.view;
  if (prev && prev !== name && mounted[prev] && mounted[prev].hide) mounted[prev].hide();
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  const root = document.getElementById('v-' + name);
  root.classList.add('active');
  app.view = name; app.params = params;
  const globalBack = $('#global-back');
  if (globalBack) globalBack.hidden = name === 'onboard' || (name === 'camera' && routeStack.length === 0);
  if (!mounted[name]) mounted[name] = await factories[name](root);
  if (app.view !== name) return; // navigated away while loading
  mounted[name].show && await mounted[name].show(params);
  const navName = name === 'review' || name === 'submit' ? 'camera' : name;
  document.querySelectorAll('#nav button[data-view]').forEach((b) => {
    if (b.dataset.view === navName) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  const full = name === 'review';
  document.body.dataset.view = name;
  document.body.classList.toggle('standalone', !!(window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true);
  document.title = 'JOTA-JOTI Camera' + (full ? '' : ' · ' + ({ camera: 'Camera', map: 'Map', challenges: 'Challenges', posts: 'My posts', settings: 'Settings', submit: 'Submit' }[name] || ''));
}

function go(name, params = {}, { replace = false } = {}) {
  const same = app.view === name && JSON.stringify(app.params || {}) === JSON.stringify(params || {});
  if (same) return setView(name, params);
  if (app.view && !replace && app.view !== name) routeStack.push({ name: app.view, params: { ...(app.params || {}) } });
  if (replace && name === 'camera' && !(params && params.id)) routeStack.length = 0;
  const st = { name, params };
  if (replace) history.replaceState(st, '', hashFor(name, params));
  else history.pushState(st, '', hashFor(name, params));
  return setView(name, params);
}

async function goBack() {
  const prev = routeStack.pop();
  if (prev) return go(prev.name, prev.params, { replace: true });
  if (app.view && app.view !== 'camera') return go('camera', {}, { replace: true });
}

window.addEventListener('popstate', async (e) => {
  if (app.view === 'review') { // Back pressed on an unfinished post: ask, don't just throw it away
    history.pushState({ name: 'review', params: app.params }, '', hashFor('review', app.params)); // stay put
    const r = await mounted.review.leave();
    return r;
  }
  const st = e.state || parseHash();
  if (routeStack.length) routeStack.pop();
  setView(st.name, st.params || {});
});

/* ---------- top bar + nav ---------- */
function refreshWho() {
  const me = identity();
  const who = $('#who');
  const back = $('#global-back');
  who.textContent = me ? 'Recording as ' + me.name : '';
  who.onclick = () => go('settings');
  if (back) {
    back.replaceChildren(icon('back'), el('span', {}, 'Back'));
    back.onclick = () => goBack();
    back.hidden = app.view === 'camera' || !app.view;
  }
}

function buildNav() {
  const nav = $('#nav');
  nav.replaceChildren(...NAV.map(([name, label, ic]) => el('button', { 'data-view': name, id: 'nav-' + name, onclick: () => go(name) }, icon(ic), el('span', {}, label))));
  const posts = nav.querySelector('#nav-posts');
  posts.append(el('span', { class: 'badge', id: 'posts-badge', hidden: true }));
  nav.hidden = false; $('#topbar').hidden = false;
  buildInstallBanner();
}

function buildInstallBanner() {
  if (isStandalone() || installDismissed() || document.getElementById('install-banner')) return;
  let panel = null;
  const open = () => {
    panel = sheet(installPanel({
      onContinue: () => panel?.close(),
      continueLabel: 'Close'
    }), { label: 'Add JOTA-JOTI to your home screen' });
  };
  const bar = el('div', { id: 'install-banner', role: 'region', 'aria-label': 'Install recommendation' },
    el('span', { class: 'ib-text' }, el('b', {}, 'Recommended: '), 'add JOTA-JOTI to your home screen for the best full-screen camera experience.'),
    el('button', { class: 'ib-btn', type: 'button', onclick: open }, 'Show me'),
    el('button', { class: 'ib-x', type: 'button', 'aria-label': 'Dismiss install recommendation', onclick: () => { dismissInstall(); bar.remove(); } }, icon('close'))
  );
  $('#topbar').after(bar);
}

async function updateStatus() {
  const n = await pendingCount().catch(() => 0);
  const offline = navigator.onLine === false || debug.get('offline') || debug.get('serverDown');
  const s = $('#status'), t = $('#status-text');
  s.classList.toggle('offline', offline); s.classList.toggle('busy', !offline && n > 0);
  t.textContent = offline ? (n ? `Offline · ${n} saved` : 'Offline') : n ? `Uploading ${n}` : 'Online';
  const b = $('#posts-badge'); if (b) { b.hidden = !n; b.textContent = n; }
}

/* ---------- start ---------- */
async function recoverRecording() {
  try {
    const rec = await recoverInterruptedRecording();
    if (!rec) return;
    if (!(await getSub(rec.subId))) {
      await createDraft({ id: rec.subId, blob: rec.blob, mediaType: 'video', mime: rec.mime, capturedAt: rec.startedAt, recovered: true,
        challenge: rec.meta.challenge || null, sound: rec.meta.sound || null });
      toast('A video that was cut short has been recovered. You will find it in My posts.', 'ok', 7000);
    }
    await clearActiveRec(rec.recId);
  } catch (e) { console.warn('recovery failed', e); }
}

async function begin(returning) {
  buildNav(); refreshWho();
  $('#v-onboard').classList.remove('active');
  requestPersistence();
  uploader.start();
  recoverRecording();
  const st = parseHash();
  let target = TABS.includes(st.name) ? st : { name: 'camera', params: {} };
  if ((st.name === 'review' || st.name === 'submit') && st.params.id) {
    const s = await getSub(st.params.id);
    if (s && s.status === 'DRAFT') target = st;
  }
  await go(target.name, target.params, { replace: true });
  hideBoot();
  if (returning) toast('Welcome back, ' + identity().name, '', 2200);
  updateStatus();
}

async function boot() {
  try {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').then((r) => r.update()).catch(() => {});
    }
    document.addEventListener('pointerdown', () => unlockAudio(), { passive: true });
    let dbOk = true;
    try { await openDb(); } catch (e) { dbOk = false; console.warn('IndexedDB unavailable', e); }
    await loadIdentity();
    await loadConfig();
    window.addEventListener('online', updateStatus); window.addEventListener('offline', updateStatus);
    window.addEventListener('jota-debug', updateStatus);
    subEvents.addEventListener('change', updateStatus);
    uploader.events.addEventListener('idle', updateStatus);
    if (!dbOk) {
      document.getElementById('v-onboard').classList.add('active');
      document.getElementById('v-onboard').replaceChildren(
        el('div', { class: 'onboard' },
          el('h1', {}, 'Can’t save files here'),
          el('p', {}, storageProblem(new Error('NO_IDB')).text),
          el('button', { class: 'btn block', onclick: () => location.reload() }, 'Reload'))
      );
      return;
    }
    if (identity()) return begin(true);
    document.getElementById('v-onboard').classList.add('active');
    mountOnboarding(document.getElementById('v-onboard'), () => begin(false));
    hideBoot();
  } catch (e) {
    console.error('JOTA-JOTI startup failed', e);
    showBootError(e);
  }
}

boot();
