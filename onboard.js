// First open: what this is -> (add to home screen) -> name. On iPhone the install step comes first, because the
// home-screen app has its own memory and would otherwise ask for the name all over again.
import { el, $, cleanName } from './util.js';
import { cfg } from './config.js';
import { createIdentity, renameIdentity, identity } from './identity.js';
import { ensureRegistered } from './api.js';
import { needsInstallStep, installPanel, dismissInstall, isIOS } from './install.js';

export function mountOnboarding(root, done) {
  const steps = ['welcome', isIOS && needsInstallStep() ? 'install' : null, 'name', !isIOS && needsInstallStep() ? 'install' : null].filter(Boolean);
  let idx = 0;
  const next = () => { idx++; idx >= steps.length ? finish() : render(); };
  const finish = () => { done(); };

  function shell(...kids) {
    root.replaceChildren(el('div', { class: 'onboard' }, ...kids));
    const first = root.querySelector('input,button.btn');
    first && setTimeout(() => first.focus({ preventScroll: true }), 50);
  }

  function render() {
    const step = steps[idx];
    if (step === 'welcome') {
      shell(el('img', { class: 'big-logo', src: 'icons/logo.png', alt: 'JOTA-JOTI' }),
        el('h1', {}, 'JOTA-JOTI CAMERA'),
        el('p', { class: 'muted' }, 'Take photos and videos during JOTA-JOTI, complete challenges, and send your adventures back to the organisers.'),
        el('div', { class: 'notice' }, cfg.mediaNotice || 'Photos, videos, sounds and location that you post are sent to the JOTA-JOTI organisers. Other participants cannot see them.'),
        el('button', { class: 'btn block', onclick: next }, 'Get started'));
    } else if (step === 'name') {
      const input = el('input', { class: 'input', id: 'name-input', type: 'text', maxlength: '40', autocomplete: 'given-name', autocapitalize: 'words', enterkeyhint: 'go', placeholder: 'Your name', 'aria-label': 'Your name', value: identity() ? identity().name : '' });
      const btn = el('button', { class: 'btn block' }, 'Continue');
      const check = () => { btn.disabled = !cleanName(input.value); };
      const go = async () => {
        const name = cleanName(input.value); if (!name) return;
        btn.disabled = true;
        if (identity()) await renameIdentity(name); else await createIdentity(name);
        ensureRegistered().catch(() => {}); // fine if offline: the uploader registers later
        next();
      };
      btn.addEventListener('click', go);
      input.addEventListener('input', check);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      shell(el('h1', {}, 'What’s your name?'), el('p', { class: 'muted' }, 'Your name goes with every photo and video you send, so the organisers know who took it.'),
        el('label', { class: 'field' }, el('span', {}, 'Your name'), input), btn);
      check();
    } else if (step === 'install') {
      shell(installPanel({
        onContinue: (how) => { dismissInstall(); next(); },
      }));
    }
  }
  render();
}
