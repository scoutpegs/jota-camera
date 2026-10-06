// Map tab: the organiser's Google Sheet controls the location list and map link.
// The app uses lightweight canvas tiles for the in-app view and can hand off to Google Maps for directions.
import { el, icon, sheet, fmtDist, haversine } from './util.js';
import { cfg } from './config.js';
import { TileMap } from './tilemap.js';
import { getPins, getChallenges } from './data.js';
import { onFix, lastFix, startWatch, stopWatch } from './location.js';
import { doneIds } from './challenges.js';

export function googleMapsSearchUrl(p) {
  const query = `${Number(p.latitude).toFixed(6)},${Number(p.longitude).toFixed(6)}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export function googleMapsDirectionsUrl(p) {
  const destination = `${Number(p.latitude).toFixed(6)},${Number(p.longitude).toFixed(6)}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=walking`;
}

export function mountMap(root, app) {
  root.replaceChildren();
  const wrap = el('div', { class: 'map-wrap' });
  const banner = el('div', { class: 'map-banner', hidden: true });
  const listBox = el('div', { class: 'page', hidden: true });
  const tools = el('div', { class: 'map-toolbar' },
    el('button', { class: 'tool', 'aria-label': 'Zoom in', onclick: () => map && map.zoomBy(1) }, icon('plus')),
    el('button', { class: 'tool', 'aria-label': 'Zoom out', onclick: () => map && map.zoomBy(-1) }, el('span', { style: { fontSize: '22px', lineHeight: 1 } }, '−')),
    el('button', { class: 'tool', id: 'locate', 'aria-label': 'Centre on my location', onclick: () => { const f = lastFix(); if (f && map) map.setView(f.latitude, f.longitude, Math.max(map.zoom, 16)); } }, icon('locate')),
    el('button', { class: 'tool', id: 'map-list', 'aria-label': 'Show locations as a list', 'aria-pressed': 'false', onclick: toggleList }, icon('posts')));
  const external = el('button', { class: 'map-external', hidden: true, onclick: () => { if (cfg.mapUrl) window.open(cfg.mapUrl, '_blank', 'noopener,noreferrer'); } }, icon('map'), el('span', {}, 'Open Google Maps'));
  root.append(wrap, banner, external, tools, listBox);
  let map = null, pins = [], challenges = [], done = new Set(), off = null, showingList = false;

  function toggleList() {
    showingList = !showingList;
    listBox.hidden = !showingList; wrap.hidden = showingList; root.style.overflowY = showingList ? 'auto' : 'hidden';
    root.querySelector('#map-list').setAttribute('aria-pressed', String(showingList));
    if (showingList) drawList();
  }

  function drawList() {
    const f = lastFix();
    listBox.replaceChildren(
      el('div', { class: 'map-list-head' }, el('h1', {}, 'Locations'), cfg.mapUrl ? el('button', { class: 'btn small ghost', onclick: () => window.open(cfg.mapUrl, '_blank', 'noopener,noreferrer') }, 'Open Google Maps') : null),
      ...(pins.length ? pins.map((p) => locationCard(p, f)) : [el('p', { class: 'muted' }, 'No locations have been added to the organiser Google Sheet yet.')])
    );
  }

  function locationCard(p, f) {
    const meta = [p.category, p.points ? p.points + ' pts' : '', f ? fmtDist(haversine(f.latitude, f.longitude, p.latitude, p.longitude)) + ' away' : ''].filter(Boolean).join(' · ');
    return el('button', { class: 'card tap map-location-card', onclick: () => openPin(p) },
      el('div', { class: 'row', style: { justifyContent: 'space-between', gap: '12px' } }, el('div', { class: 'grow' }, el('b', {}, p.name), meta ? el('div', { class: 'small muted' }, meta) : null), icon('pin')));
  }

  function chal(p) {
    const byId = (p.challengeIds || []).map((id) => challenges.find((c) => c.id === id)).filter(Boolean);
    const byNumber = (p.challengeNumbers || []).map((n) => challenges.find((c) => String(c.number) === String(n))).filter(Boolean);
    return [...new Map([...byId, ...byNumber].map((c) => [c.id, c])).values()];
  }

  function openPin(p) {
    const f = lastFix();
    const cs = chal(p);
    const go = (c, mode) => { s.close(); app.startChallenge(c, mode); };
    const s = sheet(el('div', {},
      el('h1', {}, p.name),
      p.points ? el('p', {}, el('span', { class: 'pill acc' }, `${p.points} points`)) : null,
      p.description ? el('p', {}, p.description) : null,
      p.instructions ? el('p', { class: 'small muted' }, p.instructions) : null,
      f ? el('p', { class: 'small' }, `${fmtDist(haversine(f.latitude, f.longitude, p.latitude, p.longitude))} from you`) : null,
      el('div', { class: 'stack' },
        ...(cs.length ? cs.flatMap((c) => [
          cs.length > 1 ? el('p', { class: 'small muted', style: { margin: '8px 0 0' } }, c.name + (done.has(c.id) ? ' (done)' : '')) : null,
          c.requiredMedia !== 'video' && cfg.photosEnabled ? el('button', { class: 'btn block', onclick: () => go(c, 'photo') }, 'Take photo') : null,
          c.requiredMedia !== 'photo' && p.videoAllowed && cfg.videosEnabled ? el('button', { class: 'btn ghost block', onclick: () => go(c, 'video') }, 'Record video') : null,
        ]) : [cfg.photosEnabled ? el('button', { class: 'btn block', onclick: () => { s.close(); app.ctx.challenge = null; app.go('camera', {}, { replace: true }); } }, 'Take photo') : null]),
        cs.length ? el('button', { class: 'btn ghost block', onclick: () => { s.close(); app.go('challenges', {}, { replace: true }); } }, 'View challenge') : null,
        el('button', { class: 'btn ghost block', onclick: () => window.open(googleMapsDirectionsUrl(p), '_blank', 'noopener,noreferrer') }, 'Get directions')),
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
      external.hidden = !cfg.mapUrl;
      startWatch(); off && off();
      off = onFix((f) => { if (map) map.setUser(f); });
      if (lastFix()) map.setUser(lastFix());
      const [p, c, d] = await Promise.all([getPins(), getChallenges(), doneIds()]);
      pins = p.items; challenges = c.items; done = d;
      banner.hidden = !(p.offline || navigator.onLine === false);
      banner.textContent = p.offline ? (pins.length ? 'Offline. The last saved Google Sheet locations are being used.' : 'Offline. No saved locations are available yet.') : `Locations loaded from the organiser Google Sheet${p.sheetUrl ? ' · ' + new URL(p.sheetUrl).hostname : ''}.`;
      paint();
      if (pins.length) map.fitTo(pins.map((x) => ({ lat: x.latitude, lon: x.longitude })));
      if (showingList) drawList();
      map.resize();
    },
    hide() { off && off(); off = null; stopWatch(); },
  };
}
