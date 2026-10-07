// After the shutter: Review (preview, challenge, location) -> NEXT -> Submit (summary, caption, SUBMIT).
import { el, icon, choose, toast, haversine, fmtDist, fmtClock } from './util.js';
import { cfg } from './config.js';
import { identity } from './identity.js';
import { getSub, patchSub, getMedia, getThumb, discard, submit as queueSubmit } from './submissions.js';
import { pickChallenge } from './challenges.js';
import { getChallenges } from './data.js';
import { getFix } from './location.js';
import { kick } from './uploader.js';
import { debug } from './debug.js';

export async function leaveDialog() {
  return choose('Leave this post?', 'It is saved on this phone as a draft, so nothing is lost unless you discard it.',
    [{ label: 'Keep as draft', value: 'keep' }, { label: 'Discard', value: 'discard', cls: 'danger' }, { label: 'Cancel', value: 'cancel', cls: 'ghost' }]);
}

async function challengeCheck(sub) {
  // Returns { info, block } -- block stops NEXT with a friendly reason
  const hasFix = sub.latitude !== null && sub.latitude !== undefined;
  if (cfg.locationMode === 'required' && !hasFix) return { block: 'This competition needs your location on every post. Turn location on, then tap “Try again” below.', info: '' };
  if (!sub.challengeId) return { info: '', block: null };
  const { items } = await getChallenges();
  const ch = items.find((c) => c.id === sub.challengeId);
  if (!ch || !ch.location) return { info: '', block: null };
  if (!hasFix) return { info: ch.radius ? 'No location was captured, so we can’t check you were at the challenge spot.' : '', block: cfg.enforceRadius && ch.radius ? 'This challenge needs your location to check you are at the spot. Turn location on, then tap “Try again”.' : null };
  const d = haversine(sub.latitude, sub.longitude, ch.location.latitude, ch.location.longitude);
  if (!ch.radius) return { info: `${fmtDist(d)} from ${ch.location.name}`, block: null };
  const ok = d <= ch.radius + (sub.accuracy || 0);
  return {
    info: ok ? `You were at ${ch.location.name} (${fmtDist(d)} away).` : `You were ${fmtDist(d)} from ${ch.location.name}. The challenge asks for within ${fmtDist(ch.radius)}.`,
    block: !ok && cfg.enforceRadius ? `Move closer to the challenge location (within ${fmtDist(ch.radius)}) and take it again, or choose “No challenge”.` : null,
  };
}

const locText = (s) => (s.latitude === null || s.latitude === undefined ? 'Unavailable' : `Available (±${Math.round(s.accuracy || 0)} m)`);

export function mountReview(root, app) {
  root.replaceChildren();
  let url = null, sub = null;
  const cleanup = () => { if (url) { URL.revokeObjectURL(url); url = null; } };

  async function render() {
    root.replaceChildren();
    const blob = await getMedia(sub.id);
    if (!blob) { toast('That file is no longer on this phone.', 'bad'); return app.go('camera', {}, { replace: true }); }
    url = URL.createObjectURL(blob);
    const media = sub.mediaType === 'photo'
      ? el('img', { src: url, alt: 'Your photo' })
      : el('video', { src: url, controls: '', playsinline: '', loop: '', preload: 'metadata', 'aria-label': 'Your video' });
    const chipText = el('span', {}, sub.challengeName || 'No challenge');
    const msg = el('div');
    const next = el('button', { class: 'btn grow', id: 'next-btn', onclick: () => app.go('submit', { id: sub.id }) }, 'Next');
    const retry = el('button', { class: 'btn small ghost', hidden: true, onclick: async () => {
      retry.disabled = true; const f = await getFix(); retry.disabled = false;
      if (!f) { toast('Still can’t find your location. Check that location is allowed for this site.', 'bad'); return; }
      sub = await patchSub(sub.id, { latitude: f.latitude, longitude: f.longitude, accuracy: f.accuracy }); locChip.textContent = locText(sub); evaluate();
    } }, 'Try again');
    const locChip = el('span', { class: 'pill ' + (sub.latitude === null || sub.latitude === undefined ? 'warn' : 'ok') }, locText(sub));
    async function evaluate() {
      const { info, block } = await challengeCheck(sub);
      locChip.className = 'pill ' + (sub.latitude === null || sub.latitude === undefined ? 'warn' : 'ok'); locChip.textContent = 'Location: ' + locText(sub);
      retry.hidden = !(sub.latitude === null || sub.latitude === undefined) || cfg.locationMode === 'off';
      msg.replaceChildren(...[info ? el('p', { class: 'small', style: { margin: 0 } }, info) : null, block ? el('div', { class: 'notice bad', style: { margin: 0 } }, block) : null].filter(Boolean));
      next.disabled = !!block;
    }
    locChip.textContent = 'Location: ' + locText(sub);
    const chip = el('button', { class: 'chip', id: 'review-challenge', onclick: async () => {
      const c = await pickChallenge(sub.challengeId); if (c === undefined) return;
      sub = await patchSub(sub.id, { challengeId: c ? c.id : null, challengeName: c ? c.name : '' }); chipText.textContent = sub.challengeName || 'No challenge'; evaluate();
    } }, icon('flag'), chipText);

    const bar = el('div', { class: 'review-bar' },
      el('div', { class: 'row wrap' }, chip, locChip, retry, sub.soundLabel ? el('span', { class: 'pill acc' }, '♪ ' + sub.soundLabel) : null,
        sub.mediaType === 'video' ? el('span', { class: 'pill' }, fmtClock(sub.duration)) : null),
      msg,
      el('div', { class: 'row' }, el('button', { class: 'btn ghost', id: 'retake-btn', onclick: () => leave() }, 'Retake'), next));
    const close = el('button', { class: 'tool review-discard-x', 'aria-label': 'Discard photo or video', title: 'Discard', onclick: async () => {
      const r = await choose('Discard this capture?', 'The saved photo or video will be removed from this phone.', [{ label: 'Discard', value: 'discard', cls: 'danger' }, { label: 'Keep it', value: 'keep', cls: 'ghost' }]);
      if (r !== 'discard') return;
      try { await discard(sub.id); toast('Capture discarded.', 'ok'); app.go('camera', {}, { replace: true }); }
      catch { toast('The capture could not be discarded. It is still saved on this phone.', 'bad', 5500); }
    } }, icon('close'));
    root.append(el('div', { class: 'stage' }, media), close, bar);
    evaluate();
  }

  async function leave() {
    const r = await leaveDialog();
    if (r === 'discard') {
      try { await discard(sub.id); app.go('camera', {}, { replace: true }); }
      catch { toast('The draft could not be discarded. It is still saved on this phone.', 'bad', 5500); }
    }
    else if (r === 'keep') { toast('Saved as a draft in My posts.'); app.go('camera', {}, { replace: true }); }
  }

  return {
    async show({ id }) {
      cleanup();
      sub = await getSub(id);
      if (!sub || sub.status !== 'DRAFT') return app.go('camera', {}, { replace: true });
      await render();
    },
    hide() { cleanup(); root.querySelectorAll('video').forEach((v) => v.pause()); },
    leave,
    current: () => sub,
  };
}

export function mountSubmit(root, app) {
  let sub = null, url = null;
  return {
    async show({ id }) {
      if (url) URL.revokeObjectURL(url);
      sub = await getSub(id);
      if (!sub || sub.status !== 'DRAFT') return app.go('camera', {}, { replace: true });
      const pic = (await getThumb(id)) || (sub.mediaType === 'photo' ? await getMedia(id) : null);
      url = pic ? URL.createObjectURL(pic) : null;
      const caption = el('textarea', { class: 'input', id: 'caption', maxlength: '280', placeholder: 'Add a caption (optional)', 'aria-label': 'Caption' });
      const row = (k, v) => [el('dt', {}, k), el('dd', {}, v)];
      const go = el('button', { class: 'btn block', id: 'submit-btn', onclick: async () => {
        go.disabled = true;
        try {
          await queueSubmit(sub.id, { caption: caption.value.slice(0, 280) });
          const offline = navigator.onLine === false || debug.get('offline') || debug.get('serverDown');
          toast(offline ? `Your ${sub.mediaType} has been saved safely on this device and will upload automatically when the connection returns.` : `Saved on this phone. Uploading your ${sub.mediaType} now…`, 'ok', 6000);
          app.ctx.challenge = null;
          kick();
          app.go('camera', {}, { replace: true });
        } catch (e) { go.disabled = false; app.saveError(e); }
      } }, 'Submit');
      root.replaceChildren(el('div', { class: 'page' },
        el('h1', {}, 'Your JOTA-JOTI post'),
        url ? el('img', { class: 'thumb-lg', src: url, alt: 'Preview of your ' + sub.mediaType }) : null,
        el('dl', { style: { margin: '10px 0' } },
          el('div', { class: 'kv' }, ...row('Name', identity() ? identity().name : '')),
          el('div', { class: 'kv' }, ...row('Type', sub.mediaType === 'photo' ? 'Photo' : 'Video · ' + fmtClock(sub.duration))),
          sub.mediaType === 'video' ? el('div', { class: 'kv' }, ...row('Sound', sub.soundLabel || 'None')) : null,
          el('div', { class: 'kv' }, ...row('Challenge', sub.challengeName || 'No challenge')),
          el('div', { class: 'kv' }, ...row('Location', locText(sub)))),
        el('label', { class: 'field' }, el('span', {}, 'Caption'), caption),
        go, el('p', { style: { height: '8px' } }),
        el('button', { class: 'btn ghost block danger', onclick: async () => {
          const r = await choose('Delete this draft?', 'The saved photo or video will be removed from this phone.', [{ label: 'Delete draft', value: 'delete', cls: 'danger' }, { label: 'Keep it', value: 'keep', cls: 'ghost' }]);
          if (r !== 'delete') return;
          try { await (await import('./submissions.js')).discard(sub.id); toast('Draft deleted.', 'ok'); app.go('camera', {}, { replace: true }); }
          catch { toast('The draft could not be deleted. It is still saved on this phone.', 'bad', 5500); }
        } }, 'Delete draft')));
      root.scrollTop = 0;
    },
    hide() { if (url) { URL.revokeObjectURL(url); url = null; } },
  };
}
