// First open: what this is -> (add to home screen) -> name. On iPhone the install step comes first, because the
// home-screen app has its own memory and would otherwise ask for the name all over again.
import { el, $, cleanName } from './util.js';
import { cfg } from './config.js';
import { createIdentity, renameIdentity, identity } from './identity.js';
import { ensureRegistered } from './api.js';
import { requestMediaPermissions } from './camera.js';
import { isIOS } from './install.js';

export function mountOnboarding(root, done) {
  // Keep the critical first-run path short: welcome -> name -> camera/microphone -> camera.
  // Install help remains available from Settings so it never delays camera access.
  const steps = ['welcome', 'name'];
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
      shell(el('img', { class: 'big-logo', src: 'logo.png', alt: 'JOTA-JOTI' }),
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
        // Request camera + microphone immediately after the name. A microphone denial is non-fatal;
        // the camera should still open and the user can continue without recorded microphone audio.
        try { await requestMediaPermissions(); } catch { /* camera screen will explain any block */ }
        next();
      };
      btn.addEventListener('click', go);
      input.addEventListener('input', check);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      shell(el('h1', {}, 'What’s your name?'), el('p', { class: 'muted' }, 'Your name goes with every photo and video you send, so the organisers know who took it.'),
        el('label', { class: 'field' }, el('span', {}, 'Your name'), input), btn);
      check();
    }
  }
  render();
}
