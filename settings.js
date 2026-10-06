// Settings: name, home-screen help, permissions, offline preparation. Hidden extras (tap the version 7 times): test mode + diagnostics.
import { el, sheet, toast, fmtBytes, cleanName, choose } from './util.js';
import { cfg } from './config.js';
import { identity, renameIdentity } from './identity.js';
import { ensureRegistered, api } from './api.js';
import { installPanel, isStandalone } from './install.js';
import { permissionState, startWatch } from './location.js';
import { prepareOffline } from './data.js';
import { storageEstimate, requestPersistence, db } from './db.js';
import { pendingCount, listSubs } from './submissions.js';
import { debug } from './debug.js';
import { pickVideoMime } from './camera.js';
import { fetchSounds } from './audio.js';
import { getPins } from './data.js';

export const VERSION = '1.1.0';

export function mountSettings(root, app) {
  let taps = 0, tapTimer;
  async function render() {
    const me = identity();
    const camState = await q('camera'), micState = await q('microphone'), locState = await permissionState();
    const est = await storageEstimate();
    const prep = el('div');
    const page = el('div', { class: 'page' }, el('h1', {}, 'Settings'),
      el('h2', {}, 'You'),
      el('div', { class: 'card' }, el('div', { class: 'small muted' }, 'Recording as'), el('b', { id: 'who-name' }, me ? me.name : '—'),
        el('div', { style: { marginTop: '10px' } }, el('button', { class: 'btn small ghost', id: 'change-name', onclick: changeName }, 'Change name'))),
      el('h2', {}, 'Home screen'),
      el('div', { class: 'card' }, el('p', { class: 'small' }, isStandalone() ? 'JOTA-JOTI is running from your home screen.' : 'Adding JOTA-JOTI to your home screen gives the best camera experience.'),
        isStandalone() ? null : el('button', { class: 'btn small ghost', onclick: () => { const s = sheet(installPanel({ onContinue: () => s.close(), continueLabel: 'Close' }), { label: 'Add to home screen' }); } }, 'Show me how')),
      el('h2', {}, 'Permissions'),
      el('div', { class: 'card' },
        permRow('Camera', camState), permRow('Microphone', micState), permRow('Location', locState),
        locState !== 'granted' && locState !== 'denied' && locState !== 'unsupported' ? el('button', { class: 'btn small ghost', style: { marginTop: '10px' }, onclick: () => { try { localStorage.removeItem('jota.locSkip'); } catch { /* ignore */ } startWatch(); toast('Asking for location…'); } }, 'Turn on location') : null,
        el('p', { class: 'small muted', style: { margin: '10px 0 0' } }, 'If something is blocked, allow it for this site in your phone or browser settings.')),
      el('h2', {}, 'Offline'),
      el('div', { class: 'card' }, el('p', { class: 'small' }, 'Before you head somewhere with no signal, save the competition details, challenges, map and sound list on this phone.'),
        el('button', { class: 'btn small', id: 'prep-btn', onclick: (e) => prepare(e.currentTarget, prep) }, 'Prepare for offline use'), prep),
      el('h2', {}, 'This phone'),
      el('div', { class: 'card small' }, el('div', {}, `Waiting to upload: ${await pendingCount()}`),
        est && est.quota ? el('div', {}, `Storage used: ${fmtBytes(est.usage || 0)} of about ${fmtBytes(est.quota)}`) : null),
      el('p', { class: 'small muted', style: { textAlign: 'center', marginTop: '24px', minHeight: '44px' }, id: 'ver', onclick: () => {
        taps++; clearTimeout(tapTimer); tapTimer = setTimeout(() => { taps = 0; }, 2500);
        if (taps >= 7) { taps = 0; openDebug(); } } }, `JOTA-JOTI Camera ${VERSION}`));
    root.replaceChildren(page);
  }

  const permRow = (label, st) => el('div', { class: 'row', style: { justifyContent: 'space-between', minHeight: '36px' } }, el('span', {}, label),
    el('span', { class: 'pill ' + (st === 'granted' ? 'ok' : st === 'denied' ? 'bad' : '') }, st === 'granted' ? 'Allowed' : st === 'denied' ? 'Blocked' : st === 'unsupported' ? 'Not available' : 'Not asked yet'));
  async function q(name) { try { return (await navigator.permissions.query({ name })).state; } catch { return name === 'camera' && localStorage.getItem('jota.camOK') ? 'granted' : 'prompt'; } }

  async function changeName() {
    const input = el('input', { class: 'input', maxlength: '40', value: identity().name, 'aria-label': 'Your name' });
    let s;
    const save = async () => {
      const n = cleanName(input.value); if (!n) return;
      await renameIdentity(n); ensureRegistered().catch(() => {}); s.close(); toast('Name updated.', 'ok'); render(); app.refreshWho();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
    s = sheet(el('div', { class: 'stack' }, el('h1', {}, 'Change name'), el('p', { class: 'small muted' }, 'Your earlier posts will show the new name too.'), input, el('button', { class: 'btn block', onclick: save }, 'Save')), { label: 'Change name' });
  }

  async function prepare(btn, out) {
    btn.disabled = true; out.replaceChildren(el('p', { class: 'small muted' }, 'Working…'));
    await requestPersistence();
    const report = await prepareOffline((label) => { out.replaceChildren(el('p', { class: 'small muted' }, label + '…')); });
    out.replaceChildren(...report.map((r) => el('div', { class: 'row small', style: { justifyContent: 'space-between', minHeight: '30px' } }, el('span', {}, r.label), el('span', { class: 'pill ' + (r.ok ? 'ok' : 'bad') }, r.ok ? r.detail : r.detail))));
    btn.disabled = false;
  }

  /* ----- hidden: test mode + diagnostics ----- */
  function openDebug() {
    const labels = { offline: 'Pretend there is no internet', storageFull: 'Pretend Supabase storage is full', failUploads: 'Make uploads fail', slow: 'Slow network', serverDown: 'Pretend the server is down', noGps: 'GPS unavailable', noCamera: 'Camera permission denied', noMic: 'Microphone denied' };
    const out = el('div', { class: 'debug' });
    const body = el('div', {}, el('h1', {}, 'Test mode'), el('p', { class: 'small muted' }, 'For organisers only. These switches only affect this phone.'),
      ...Object.entries(labels).map(([k, l]) => el('label', {}, el('input', { type: 'checkbox', checked: debug.get(k), onchange: (e) => debug.set(k, e.target.checked) }), l)),
      el('div', { class: 'row', style: { margin: '10px 0' } }, el('button', { class: 'btn small', onclick: () => diagnose(out) }, 'Run diagnostics'), el('button', { class: 'btn small ghost', onclick: () => { debug.reset(); s.close(); } }, 'Reset all')), out);
    const s = sheet(body, { label: 'Test mode' });
  }
  async function diagnose(out) {
    out.replaceChildren(el('p', {}, 'Checking…'));
    const rows = [];
    const add = async (name, fn) => { try { rows.push([name, true, await fn()]); } catch (e) { rows.push([name, false, e.message || String(e)]); } };
    await add('Camera', async () => { if (!navigator.mediaDevices) throw new Error('Not supported'); const d = (await navigator.mediaDevices.enumerateDevices()).filter((x) => x.kind === 'videoinput'); if (!d.length) throw new Error('No camera found'); return `${d.length} camera(s), permission: ${await q('camera')}`; });
    await add('Microphone', async () => `permission: ${await q('microphone')}`);
    await add('Location', async () => `permission: ${await permissionState()}`);
    await add('Recording format', async () => { const m = pickVideoMime(); if (!m) throw new Error('This browser cannot record video'); return m; });
    await add('IndexedDB', async () => { await db.put('kv', Date.now(), 'diag'); await db.del('kv', 'diag'); return 'OK'; });
    await add('Offline queue', async () => { const s = await listSubs(); return `${s.length} saved, ${await pendingCount()} waiting`; });
    await add('Server', async () => { await api('/api/health', { auth: false }); return 'Online'; });
    await add('Storage', async () => { const e = await storageEstimate(); if (!e) throw new Error('Unknown'); return `${fmtBytes(e.usage || 0)} used of ${fmtBytes(e.quota || 0)}`; });
    await add('Sound service', async () => { const r = await fetchSounds({ limit: 1 }); if (r.offline) throw new Error('Offline (using saved list)'); return 'OK'; });
    await add('Map service', async () => { const r = await getPins(); if (r.offline) throw new Error('Offline (using saved pins)'); return `${r.items.length} pins`; });
    out.replaceChildren(...rows.map(([n, ok, d]) => el('div', { class: 'row', style: { justifyContent: 'space-between', minHeight: '32px' } }, el('span', {}, n), el('span', { class: 'pill ' + (ok ? 'ok' : 'bad') }, `${ok ? 'OK' : 'Problem'}: ${d}`))));
  }

  return { show: render };
}
