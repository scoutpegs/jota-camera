// "Add to home screen" help. iPhone has no automatic install prompt, so it gets clear steps; Android gets the real prompt.
import { el, icon } from './util.js';

let deferred = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; window.dispatchEvent(new Event('jota-installable')); });
window.addEventListener('appinstalled', () => { try { localStorage.setItem('jota.installed', '1'); } catch { /* ignore */ } deferred = null; });

export const isStandalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
const ua = navigator.userAgent || '';
export const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isAndroid = /Android/i.test(ua);
export const isIOSOtherBrowser = isIOS && /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
export const canPrompt = () => !!deferred;
export async function promptInstall() {
  if (!deferred) return false;
  deferred.prompt();
  const r = await deferred.userChoice.catch(() => null);
  deferred = null;
  return !!(r && r.outcome === 'accepted');
}
export const installDismissed = () => { try { return !!localStorage.getItem('jota.installDismissed'); } catch { return false; } };
export const dismissInstall = () => { try { localStorage.setItem('jota.installDismissed', '1'); } catch { /* ignore */ } };
export const needsInstallStep = () => !isStandalone() && !installDismissed() && !localStorage.getItem('jota.installed');

export function installPanel({ onContinue, continueLabel = 'Continue in browser' }) {
  const wrap = el('div', { class: 'stack' });
  wrap.append(el('h1', {}, 'Add JOTA-JOTI to your home screen'),
    el('p', { class: 'muted' }, 'For the best camera experience, add JOTA-JOTI to your home screen.'));
  if (isIOS) {
    if (isIOSOtherBrowser) wrap.append(el('div', { class: 'notice' }, 'You are not in Safari. On iPhone and iPad, open this page in Safari to add it to your home screen.'));
    wrap.append(el('ol', { class: 'steps' },
      el('li', {}, el('span', {}, 'Tap the ', el('b', {}, 'Share'), ' button ', icon('share'), ' in Safari.')),
      el('li', {}, el('span', {}, 'Tap ', el('b', {}, 'Add to Home Screen'), ' ', icon('plus'), '.')),
      el('li', {}, el('span', {}, 'Tap ', el('b', {}, 'Add'), '.')),
      el('li', {}, el('span', {}, 'Open ', el('b', {}, 'JOTA-JOTI'), ' from your home screen.'))),
      el('p', { class: 'small muted' }, 'The home screen app keeps its own memory, so you will enter your name once more there.'));
  } else if (canPrompt()) {
    wrap.append(el('button', { class: 'btn block', onclick: async () => { if (await promptInstall()) onContinue && onContinue('installed'); } }, 'Add to home screen'));
  } else if (isAndroid) {
    wrap.append(el('ol', { class: 'steps' },
      el('li', {}, el('span', {}, 'Tap the ', el('b', {}, '⋮ menu'), ' in Chrome (top right).')),
      el('li', {}, el('span', {}, 'Tap ', el('b', {}, 'Add to Home screen'), ' or ', el('b', {}, 'Install app'), '.')),
      el('li', {}, el('span', {}, 'Tap ', el('b', {}, 'Install'), ', then open JOTA-JOTI from your home screen.'))));
  } else {
    wrap.append(el('p', { class: 'muted' }, 'In your browser menu, choose “Install app” or “Add to home screen”.'));
  }
  if (onContinue) wrap.append(el('button', { class: 'btn ghost block', onclick: () => onContinue('browser') }, continueLabel));
  return wrap;
}
