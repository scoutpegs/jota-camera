// Map tab: official challenge locations and photo spots. Never shows other participants.
import { el, icon, sheet, fmtDist, haversine } from './util.js';
import { cfg } from './config.js';
import { TileMap } from './tilemap.js';
import { getPins, getChallenges } from './data.js';
import { onFix, lastFix, startWatch, stopWatch } from './location.js';
import { doneIds } from './challenges.js';

export function mountMap(root, app) {
  root.replaceChildren();
  const wrap = el('div', { class: 'map-wrap' });
  const banner = el('div', { class: 'map-banner', hidden: true });
  const listBox = el('div', { class: 'page', hidden: true });
  const tools = el('div', { class: 'map-toolbar' },
    el('button', { class: 'tool', 'aria-label': 'Zoom in', onclick: () => map && map.zoomBy(1) }, icon('plus')),
    el('button', { class: 'tool', 'aria-label': 'Zoom out', onclick: () => map && map.zoomBy(-1) }, el('span', { style: { fontSize: '22px', lineHeight: 1 } }, '−')),
    el('button', { class: 'tool', id: 'locate', 'aria-label': 'Centre on my location', onclick: () => { const f = lastFix(); if (f && map) map.setView(f.latitude, f.longitude, Math.max(map.zoom, 16)); } }, icon('locate')),
    el('button', { class: 'tool', id: 'map-list', 'aria-label': 'Show as a list', 'aria-pressed': 'false', onclick: toggleList }, icon('posts')));
  root.append(wrap, banner, tools, listBox);
  let map = null, pins = [], challenges = [], done = new Set(), off = null, showingList = false;

  function toggleList() {
    showingList = !showingList;
    listBox.hidden = !showingList; wrap.hidden = showingList; root.style.overflowY = showingList ? 'auto' : 'hidden';
    root.querySelector('#map-list').setAttribute('aria-pressed', String(showingList));
    if (showingList) drawList();
  }
  function drawList() {
    const f = lastFix();
    listBox.replaceChildren(el('h1', {}, 'Locations'), ...(pins.length ? pins.map((p) =>
      el('button', { class: 'card tap', onclick: () => openPin(p) }, el('b', {}, p.name),
        el('div', { class: 'small muted' }, [p.points ? p.points + ' pts' : '', f ? fmtDist(haversine(f.latitude, f.longitude, p.latitude, p.longitude)) + ' away' : ''].filter(Boolean).join(' · ') || p.category))) : [el('p', { class: 'muted' }, 'No locations yet.')]));
  }

  function chal(p) { return p.challengeIds.map((id) => challenges.find((c) => c.id === id)).filter(Boolean); }

  function openPin(p) {
    const f = lastFix();
    const cs = chal(p);
    let s;
    const photoCs = cs.filter((c) => c.requiredMedia !== 'video'), allowVideo = p.videoAllowed && cfg.videosEnabled;
    const go = (c, mode) => { s.close(); app.startChallenge(c, mode); };
    s = sheet(el('div', {},
      el('h1', {}, p.name),
      p.points ? el('p', {}, el('span', { class: 'pill acc' }, `${p.points} points`)) : null,
      p.description ? el('p', {}, p.description) : null,
      p.instructions ? el('p', { class: 'small muted' }, p.instructions) : null,
      f ? el('p', { class: 'small' }, `${fmtDist(haversine(f.latitude, f.longitude, p.latitude, p.longitude))} from you`) : null,
      el('div', { class: 'stack' },
        ...(cs.length ? cs.flatMap((c) => [
          cs.length > 1 ? el('p', { class: 'small muted', style: { margin: '8px 0 0' } }, c.name + (done.has(c.id) ? ' (done)' : '')) : null,
          c.requiredMedia !== 'video' && cfg.photosEnabled ? el('button', { class: 'btn block', onclick: () => go(c, 'photo') }, 'Take photo') : null,
          c.requiredMedia !== 'photo' && allowVideo ? el('button', { class: 'btn ghost block', onclick: () => go(c, 'video') }, 'Record video') : null,
        ]) : [cfg.photosEnabled ? el('button', { class: 'btn block', onclick: () => { s.close(); app.ctx.challenge = null; app.go('camera', {}, { replace: true }); } }, 'Take photo') : null]),
        cs.length ? el('button', { class: 'btn ghost block', onclick: () => { s.close(); app.go('challenges', {}, { replace: true }); } }, 'View challenge') : null)),
      { label: p.name });
  }

  function paint() {
    if (!map) return;
    map.setMarkers(pins.map((p) => ({ id: p.id, lat: p.latitude, lon: p.longitude, label: p.name, color: chal(p).some((c) => done.has(c.id)) ? '#2f9e66' : '#5a2c84', done: chal(p).length && chal(p).every((c) => done.has(c.id)), pin: p })));
  }

  return {
    async show() {
      if (!map) {
        map = new TileMap(wrap, { tileUrl: cfg.tileUrl, lat: cfg.mapCenterLat, lon: cfg.mapCenterLon, zoom: cfg.mapZoom, onMarkerClick: (m) => openPin(m.pin), label: 'Map of challenge locations. Use the list button for a text version.' });
      }
      map.tileUrl = cfg.tileUrl;
      startWatch(); off && off();
      off = onFix((f) => { if (map) map.setUser(f); });
      if (lastFix()) map.setUser(lastFix());
      const [p, c, d] = await Promise.all([getPins(), getChallenges(), doneIds()]);
      pins = p.items; challenges = c.items; done = d;
      banner.hidden = !(p.offline || navigator.onLine === false);
      banner.textContent = p.empty ? 'No locations saved yet. Connect once to save them for offline use.' : 'You are offline. Locations still work; the map picture may be incomplete.';
      paint();
      if (pins.length) map.fitTo(pins.map((x) => ({ lat: x.latitude, lon: x.longitude })));
      if (showingList) drawList();
      map.resize();
    },
    hide() { off && off(); off = null; stopWatch(); },
  };
}
