// Settings: name, home-screen help, permissions and offline preparation.
import { el, sheet, toast, fmtBytes, cleanName, choose } from './util.js';
import { identity, renameIdentity } from './identity.js';
import { ensureRegistered } from './api.js';
import { installPanel, isStandalone } from './install.js';
import { permissionState, startWatch } from './location.js';
import { prepareOffline } from './data.js';
import { storageEstimate, requestPersistence } from './db.js';
import { pendingCount } from './submissions.js';

export const VERSION = '1.4.1';

export function mountSettings(root, app) {
  async function render() {
    const me = identity();
    const camState = await q('camera'), micState = await q('microphone'), locState = await permissionState();
    const est = await storageEstimate();
    const prep = el('div', { class: 'settings-output', id: 'prep-output' });
    const page = el('div', { class: 'page settings-page' },
      el('div', { class: 'settings-hero' },
        el('span', { class: 'eyebrow' }, 'JOTA-JOTI'),
        el('h1', {}, 'Settings'),
        el('p', { class: 'muted' }, 'Keep the camera, permissions and offline content ready to go.')),

      el('section', { class: 'settings-section' },
        el('h2', {}, 'Your details'),
        el('div', { class: 'card settings-card' },
          el('div', { class: 'settings-card-main' },
            el('span', { class: 'small muted' }, 'Recording as'),
            el('b', { id: 'who-name' }, me ? me.name : '—')),
          el('button', { class: 'btn small ghost', id: 'change-name', onclick: changeName }, 'Change name'))),

      el('section', { class: 'settings-section' },
        el('h2', {}, 'Home screen'),
        el('div', { class: 'card settings-card stack' },
          el('div', { class: 'settings-card-main' },
            el('b', {}, isStandalone() ? 'JOTA-JOTI is installed' : 'Recommended: add JOTA-JOTI to your home screen'),
            el('p', { class: 'small muted' }, isStandalone() ? 'You are running the app from the device home screen.' : 'This gives the camera a cleaner full-screen experience and makes it easier to launch.')),
          isStandalone() ? el('span', { class: 'pill ok' }, 'Installed') : el('button', { class: 'btn small', onclick: () => { let panel; panel = sheet(installPanel({ onContinue: () => panel?.close(), continueLabel: 'Close' }), { label: 'Add JOTA-JOTI to your home screen' }); } }, 'Show me how'))),

      el('section', { class: 'settings-section' },
        el('h2', {}, 'Permissions'),
        el('div', { class: 'card settings-card stack' },
          permRow('Camera', camState), permRow('Microphone', micState), permRow('Location', locState),
          locState !== 'granted' && locState !== 'denied' && locState !== 'unsupported'
            ? el('button', { class: 'btn small ghost', onclick: () => { try { localStorage.removeItem('jota.locSkip'); } catch {} startWatch(); toast('Asking for location…'); } }, 'Turn on location')
            : null,
          el('p', { class: 'small muted settings-help' }, 'Camera and microphone are needed for capture. Location is optional unless the organiser has made it required.'))),

      el('section', { class: 'settings-section' },
        el('h2', {}, 'Offline use'),
        el('div', { class: 'card settings-card stack' },
          el('div', {}, el('b', {}, 'Prepare this phone'), el('p', { class: 'small muted' }, 'Save competition details, the map, challenges and sounds so the app keeps working when signal is weak or unavailable.')),
          el('button', { class: 'btn', id: 'prep-btn', onclick: (e) => prepare(e.currentTarget, prep) }, 'Prepare for offline use'), prep)),

      el('section', { class: 'settings-section' },
        el('h2', {}, 'Storage & uploads'),
        el('div', { class: 'card settings-card stack' },
          el('div', { class: 'settings-stat' }, el('b', {}, String(await pendingCount())), el('span', {}, 'waiting to upload')),
          est && est.quota ? el('p', { class: 'small muted' }, `${fmtBytes(est.usage || 0)} used of about ${fmtBytes(est.quota)}`) : el('p', { class: 'small muted' }, 'Storage use is provided by your browser.'))),

      el('p', { class: 'settings-version' }, `JOTA-JOTI Camera ${VERSION}`));
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

  return { show: render };
}
