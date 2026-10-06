// Challenges tab, plus the picker sheet used on the camera and review screens.
import { el, $, icon, sheet, fmtDist, haversine } from './util.js';
import { getChallenges } from './data.js';
import { lastFix } from './location.js';
import { listSubs } from './submissions.js';

function distanceLine(c) {
  const f = lastFix();
  if (!c.location || !f) return null;
  const d = haversine(f.latitude, f.longitude, c.location.latitude, c.location.longitude);
  if (c.radius > 0) return d <= c.radius + (f.accuracy || 0) ? `You're at the spot (${fmtDist(d)} away)` : `You're ${fmtDist(d)} away. Move closer to the challenge location.`;
  return `${fmtDist(d)} away`;
}
const mediaLabel = (m) => (m === 'photo' ? 'Photo' : m === 'video' ? 'Video' : 'Photo or video');

export async function doneIds() {
  const subs = await listSubs();
  return new Set(subs.filter((s) => ['QUEUED','UPLOADING','UPLOADED'].includes(s.status) && s.challengeId).map((s) => s.challengeId));
}

export function mountChallenges(root, app) {
  root.replaceChildren();
  const page = el('div', { class: 'page' }, el('h1', {}, 'Challenges'), el('p', { class: 'muted' }, 'Pick one, then take a photo or video for it.'));
  const list = el('div', { id: 'ch-list' });
  page.append(list); root.append(page);

  async function render() {
    list.replaceChildren(el('p', { class: 'muted' }, 'Loading…'));
    const [{ items, offline, empty }, done] = await Promise.all([getChallenges(), doneIds()]);
    list.replaceChildren();
    if (offline) list.append(el('div', { class: 'notice' }, empty ? 'No challenges saved on this phone yet. Connect to the internet once and they will be kept for offline use.' : 'You are offline. Showing the challenges saved on this phone.'));
    if (!items.length && !empty) list.append(el('p', { class: 'muted' }, 'No challenges have been set up yet. You can still take photos and videos from the Camera tab.'));
    for (const c of items) {
      const dist = distanceLine(c);
      const card = el('div', { class: 'card' },
        el('div', { class: 'row wrap' },
          el('b', { class: 'grow' }, c.name),
          done.has(c.id) ? el('span', { class: 'pill ok' }, 'Done') : null,
          c.points ? el('span', { class: 'pill acc' }, `${c.points} pts`) : null),
        c.description ? el('p', { class: 'small muted', style: { margin: '6px 0 0' } }, c.description) : null,
        c.instructions ? el('p', { class: 'small', style: { margin: '6px 0 0' } }, c.instructions) : null,
        el('div', { class: 'row wrap', style: { margin: '8px 0' } }, el('span', { class: 'pill' }, mediaLabel(c.requiredMedia)),
          c.location ? el('span', { class: 'pill' }, el('span', {}, c.location.name)) : null),
        dist ? el('p', { class: 'small', style: { margin: '0 0 8px' } }, dist) : null,
        el('div', { class: 'row wrap' },
          c.requiredMedia !== 'video' && app.cfg.photosEnabled ? el('button', { class: 'btn grow', onclick: () => app.startChallenge(c, 'photo') }, 'Take photo') : null,
          c.requiredMedia !== 'photo' && app.cfg.videosEnabled ? el('button', { class: 'btn ghost grow', onclick: () => app.startChallenge(c, 'video') }, 'Record video') : null,
          c.location ? el('button', { class: 'btn small ghost', onclick: () => { app.ctx.mapFocus = { lat: c.location.latitude, lon: c.location.longitude }; app.go('map'); } }, 'View on map') : null));
      list.append(card);
    }
  }
  return { show: render };
}

// Bottom sheet: choose a challenge (or none). Resolves with the challenge, null for "No challenge", or undefined if closed.
export function pickChallenge(currentId) {
  return new Promise(async (resolve) => {
    let s, picked;
    const search = el('input', { class: 'input', type: 'search', placeholder: 'Search challenges', 'aria-label': 'Search challenges' });
    const list = el('div');
    const choose = (v) => { picked = v; s.close(); };
    const body = el('div', {}, el('h1', {}, 'Challenge'), search, list);
    s = sheet(body, { label: 'Choose a challenge', onClose: () => resolve(picked) });
    const { items } = await getChallenges();
    const render = () => {
      const q = search.value.trim().toLowerCase();
      list.replaceChildren(
        el('button', { class: 'list-item', style: { width: '100%', textAlign: 'left' }, onclick: () => choose(null) },
          el('div', { class: 'art' }, icon('close')), el('div', { class: 'meta' }, el('b', {}, 'No challenge'), el('span', {}, 'Just a photo or video')),
          currentId ? null : el('span', { class: 'pill ok' }, 'Selected')),
        ...items.filter((c) => !q || c.name.toLowerCase().includes(q)).map((c) =>
          el('button', { class: 'list-item', style: { width: '100%', textAlign: 'left' }, onclick: () => choose(c) },
            el('div', { class: 'art' }, icon('flag')),
            el('div', { class: 'meta' }, el('b', {}, c.name), el('span', {}, `${mediaLabel(c.requiredMedia)}${c.points ? ' · ' + c.points + ' pts' : ''}`)),
            currentId === c.id ? el('span', { class: 'pill ok' }, 'Selected') : null)));
    };
    search.addEventListener('input', render);
    render();
  });
}
