// "My posts": everything taken on this phone, with honest upload status.
import { el, $, icon, fmtDate, ago, fmtClock, toast, choose } from './util.js';
import { listSubs, getThumb, discard, retryNow, events as subEvents } from './submissions.js';
import { events as upEvents, kick } from './uploader.js';
import { api } from './api.js';
import { identity } from './identity.js';

export function mountPosts(root, app) {
  let urls = [], active = false, bars = new Map(), remoteCache = [];
  async function loadRemote() {
    if (navigator.onLine === false || !identity() || !identity().registered) return;
    try { remoteCache = (await api('/api/my/submissions')).submissions; } catch { /* offline is fine */ }
  }
  const revoke = () => { urls.forEach((u) => URL.revokeObjectURL(u)); urls = []; bars = new Map(); };

  async function render() {
    if (!active) return;
    const subs = await listSubs();
    revoke();
    const remote = remoteCache.filter((r) => !subs.some((s) => s.id === r.id));
    const count = (f) => subs.filter(f).length + remote.filter(f).length;
    const photos = count((s) => (s.mediaType === 'photo')), videos = count((s) => (s.mediaType === 'video'));
    const uploading = subs.filter((s) => s.status === 'UPLOADING').length;
    const saved = subs.filter((s) => s.status === 'QUEUED').length;
    const sent = subs.filter((s) => s.status === 'UPLOADED').length + remote.length;
    const page = el('div', { class: 'page' }, el('h1', {}, 'My posts'),
      el('div', { class: 'row wrap', style: { marginBottom: '14px' } },
        el('span', { class: 'pill' }, `Photos ${photos}`), el('span', { class: 'pill' }, `Videos ${videos}`),
        el('span', { class: 'pill acc' }, `Uploading ${uploading}`), el('span', { class: 'pill warn' }, `Saved offline ${saved}`), el('span', { class: 'pill ok' }, `Submitted ${sent}`)));
    if (!subs.length && !remote.length) page.append(el('p', { class: 'muted' }, 'Nothing here yet. Photos and videos you take will appear here with their upload status.'));

    for (const s of subs) {
      const th = await getThumb(s.id);
      let bg = ''; if (th) { const u = URL.createObjectURL(th); urls.push(u); bg = `url("${u}")`; }
      const bar = el('i', { style: { width: Math.round((s.progress || 0) * 100) + '%' } });
      bars.set(s.id, bar);
      const status = ({
        DRAFT: ['Draft, not posted yet', 'warn'], QUEUED: [s.userMessage || 'Saved on this phone. Waiting to upload.', 'warn'],
        UPLOADING: [`Uploading ${Math.round((s.progress || 0) * 100)}%`, 'acc'], UPLOADED: [s.storageProvider === 'DRIVE' ? 'Saved to Google Drive backup' : 'Sent to the organisers', 'ok'], FAILED: [s.userMessage || 'Could not be sent', 'bad'],
      })[s.status] || ['', ''];
      const actions = [];
      if (s.status === 'DRAFT') actions.push(el('button', { class: 'btn small', onclick: () => app.go('review', { id: s.id }) }, 'Continue'));
      if (s.status === 'FAILED') actions.push(el('button', { class: 'btn small', onclick: async () => { await retryNow(s.id); kick(); } }, 'Try again'));
      if (s.status === 'DRAFT' || s.status === 'FAILED') actions.push(el('button', { class: 'btn small danger', 'aria-label': 'Delete', onclick: async () => {
        const r = await choose(s.status === 'FAILED' ? 'Delete this post?' : 'Delete this draft?', 'This cannot be undone.', [{ label: 'Delete', value: 'del', cls: 'danger' }, { label: 'Cancel', value: 'no', cls: 'ghost' }]);
        if (r === 'del') { await discard(s.id); render(); } } }, 'Delete'));
      page.append(el('div', { class: 'post', 'data-id': s.id, 'data-status': s.status },
        el('div', { class: 'tb', style: { backgroundImage: bg } }, s.mediaType === 'video' ? el('span', { class: 'vid' }, fmtClock(s.duration)) : null),
        el('div', { class: 'info' }, el('b', {}, s.challengeName || (s.mediaType === 'photo' ? 'Photo' : 'Video')),
          el('span', { class: 'small muted' }, ago(s.capturedAt)),
          el('div', {}, el('span', { class: 'pill ' + status[1] }, status[0])),
          s.status === 'UPLOADING' ? el('div', { class: 'bar' }, bar) : null,
          actions.length ? el('div', { class: 'row', style: { marginTop: '8px' } }, actions) : null)));
    }
    for (const r of remote) {
      page.append(el('div', { class: 'post' },
        el('div', { class: 'tb', style: r.thumbUrl ? { backgroundImage: `url("${r.thumbUrl}")` } : {} }),
        el('div', { class: 'info' }, el('b', {}, r.challengeName || (r.mediaType === 'photo' ? 'Photo' : 'Video')), el('span', { class: 'small muted' }, ago(r.capturedAt)),
          el('div', {}, el('span', { class: 'pill ' + (r.storageProvider === 'DRIVE' ? 'acc' : 'ok') }, r.storageProvider === 'DRIVE' ? 'Saved to Google Drive backup' : 'Sent to the organisers')))));
    }
    root.replaceChildren(page);
  }

  const onProgress = (e) => { const b = bars.get(e.detail.id); if (b) b.style.width = Math.round(e.detail.progress * 100) + '%'; };
  let t; const soon = () => { clearTimeout(t); t = setTimeout(render, 250); };
  subEvents.addEventListener('change', soon);
  upEvents.addEventListener('progress', onProgress);
  return { async show() { active = true; await render(); await loadRemote(); render(); }, hide() { active = false; revoke(); } };
}
