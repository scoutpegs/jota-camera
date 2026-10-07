// Tiny helpers shared by the whole app (no framework).
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// el('div', {class:'x', onclick:fn}, 'text', childEl) -- text is always inserted as text, never as HTML.
export function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  if (String(tag).toLowerCase() === 'button' && attrs?.type == null) n.type = 'button';
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v; // only ever used with our own static markup
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  if (tag === 'button' && !n.hasAttribute('type')) n.type = 'button';
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return n;
}

export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));
export function randomSecret(len = 32) {
  const b = crypto.getRandomValues(new Uint8Array(len));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function fmtClock(sec) {
  sec = Math.max(0, Math.floor(sec));
  return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
}
export function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
  if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
  return (n / 1073741824).toFixed(2) + ' GB';
}
export function fmtDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}
export function ago(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (isNaN(s)) return '';
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  return Math.floor(s / 86400) + ' d ago';
}
export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
export const fmtDist = (m) => (m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(1) + ' km');

export function cleanName(s, max = 40) {
  return String(s || '').replace(/[\u0000-\u0008\u000b-\u001f\u007f​-‏‪-‮<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

let toastTimer;
export function toast(msg, kind = '', ms = 4200) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = el('div', { class: 'toast ' + kind, role: 'status' }, msg);
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), ms);
}

export function haptic(ms = 12) { try { navigator.vibrate && navigator.vibrate(ms); } catch { /* optional */ } }

// SVG icons (simple outlines). Built from our own constants only.
const ICONS = {
  camera: '<path d="M4 8.5h3l2-3h6l2 3h3v10.5H4z"/><circle cx="12" cy="13.5" r="3.4"/>',
  map: '<path d="m3 6 6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>',
  flag: '<path d="M6 21V4"/><path d="M6 4h11l-2.2 4L17 12H6"/>',
  posts: '<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.4"/><path d="m5 17 4.5-4.2 3.4 3 2.6-2.4L19 17.5"/>',
  music: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.6"/><circle cx="16.5" cy="16" r="2.6"/>',
  flip: '<path d="M7 7H4V4"/><path d="M4 7a8 8 0 0 1 13-3"/><path d="M17 17h3v3"/><path d="M20 17a8 8 0 0 1-13 3"/>',
  torch: '<path d="m9 2 6 2-1.3 5.2L17 13l-4.2 1.2L11 22l-2-1.3 2-6L7 12l2-1.4z"/>',
  zoom: '<circle cx="10.8" cy="10.8" r="6"/><path d="m15.3 15.3 4.7 4.7M10.8 8v5.6M8 10.8h5.6"/>',
  play: '<path d="m8 5 11 7-11 7z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  back: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
  check: '<path d="m5 12 4 4 10-10"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M18.5 5.5l-2.1 2.1M7.6 16.4l-2.1 2.1"/>',
  pin: '<path d="M12 21s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  share: '<path d="M12 15V4"/><path d="m8 8 4-4 4 4"/><path d="M5 12v8h14v-8"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  mic: '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  locate: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  list: '<path d="M5 6h14M5 12h14M5 18h14"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
};
export function icon(name, cls = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
  if (cls) s.setAttribute('class', cls);
  s.innerHTML = ICONS[name] || '';
  return s;
}

// A modal bottom sheet. Returns {el, close}. Escape and the scrim close it.
export function sheet(content, { dialog = false, onClose, label = 'Dialog' } = {}) {
  const prevFocus = document.activeElement;
  const box = el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': label }, dialog ? null : el('div', { class: 'grab' }), content);
  const scrim = el('div', { class: 'scrim' + (dialog ? ' dialog' : '') }, box);
  let closed = false;
  const close = (result) => {
    if (closed) return; closed = true;
    scrim.remove(); document.removeEventListener('keydown', onKey);
    try { prevFocus && prevFocus.focus && prevFocus.focus(); } catch { /* ignore */ }
    onClose && onClose(result);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  scrim.addEventListener('click', (e) => { if (e.target === scrim) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(scrim);
  const first = box.querySelector('input,button,textarea,select');
  first && setTimeout(() => first.focus(), 30);
  return { el: box, close };
}

// confirm('Delete?', ['Keep','Discard','Cancel']) -> resolves with the label tapped
export function choose(title, text, buttons) {
  return new Promise((resolve) => {
    let s;
    const done = (v) => { s.close(); resolve(v); };
    const body = el('div', {}, el('h1', {}, title), text ? el('p', { class: 'muted' }, text) : null,
      el('div', { class: 'stack' }, buttons.map((b) => el('button', { class: 'btn block ' + (b.cls || ''), onclick: () => done(b.value) }, b.label))));
    s = sheet(body, { dialog: true, label: title, onClose: () => resolve(null) });
  });
}
