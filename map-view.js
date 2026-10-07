// Map tab: the organiser's Google Sheet controls the location list and map link.
// The app uses lightweight canvas tiles for the in-app view and can hand off to Google Maps for directions.
import { el, icon, sheet, fmtDist, haversine, toast } from './util.js';
import { cfg } from './config.js';
import { TileMap } from './tilemap.js';
import { getPins, getChallenges } from './data.js';
import { onFix, lastFix, startWatch, stopWatch } from './location.js';
import { doneIds } from './challenges.js';
import { cache } from './db.js';

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
  const place = el('div', { class: 'map-place' }, el('b', {}, 'Kalgoorlie · Goldfields-Esperance'), el('span', {}, 'Western Australia'));
  const listBox = el('div', { class: 'page', hidden: true });
  const emptyMap = el('div', { class: 'map-empty', hidden: true });
  const tools = el('div', { class: 'map-toolbar' },
    el('button', { class: 'tool', 'aria-label': 'Zoom in', onclick: () => map && map.zoomBy(1) }, icon('plus')),
    el('button', { class: 'tool', 'aria-label': 'Zoom out', onclick: () => map && map.zoomBy(-1) }, el('span', { style: { fontSize: '22px', lineHeight: 1 } }, '−')),
    el('button', { class: 'tool', id: 'locate', 'aria-label': 'Centre on my location', onclick: () => { const f = lastFix(); if (f && map) map.setView(f.latitude, f.longitude, Math.max(map.zoom, 16)); } }, icon('locate')),
    el('button', { class: 'tool', id: 'map-list', 'aria-label': 'Show locations as a list', 'aria-pressed': 'false', onclick: toggleList }, icon('posts')));
  const external = el('button', { class: 'map-external', hidden: true, onclick: () => { if (cfg.mapUrl) window.open(cfg.mapUrl, '_blank', 'noopener,noreferrer'); } }, icon('map'), el('span', {}, 'Open Google Maps'));
  root.append(wrap, banner, place, external, tools, emptyMap, listBox);
  let map = null, pins = [], challenges = [], done = new Set(), off = null, showingList = false, initialViewSet = false;

  function toggleList() {
    showingList = !showingList;
    listBox.hidden = !showingList; wrap.hidden = showingList; place.hidden = showingList; tools.hidden = showingList; external.hidden = showingList || !cfg.mapUrl; root.style.overflowY = showingList ? 'auto' : 'hidden';
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

  function openChallenges(cs, location = null) {
    if (!cs.length) return openPin(location);
    const go = (c, mode) => { s.close(); app.startChallenge(c, mode); };
    const body = el('div', {},
      el('div', { class: 'challenge-map-sheet-head' },
        el('span', { class: 'kicker' }, location ? 'MAP LOCATION' : 'CHALLENGE'),
        el('h1', {}, location ? location.name : (cs.length === 1 ? cs[0].name : 'Challenges here')),
        location?.description ? el('p', { class: 'muted' }, location.description) : null),
      el('div', { class: 'challenge-map-list' }, ...cs.map((c) => {
        const canPhoto = c.requiredMedia !== 'video' && cfg.photosEnabled;
        const canVideo = c.requiredMedia !== 'photo' && cfg.videosEnabled && (!location || location.videoAllowed !== false);
        const requiredRadius = cfg.enforceRadius ? Number(c.radius || 0) : 0;
        const f = lastFix();
        const distance = location && f ? haversine(f.latitude, f.longitude, Number(location.latitude), Number(location.longitude)) : null;
        const outside = requiredRadius > 0 && (distance == null || distance > requiredRadius);
        const rangeNote = outside
          ? el('p', { class: 'small map-range-warning' }, distance == null ? `This challenge needs your location and must be completed within ${requiredRadius} m.` : `Move closer to the pin. You are ${fmtDist(distance)} away and this challenge requires ${requiredRadius} m.`)
          : requiredRadius > 0 && distance != null ? el('p', { class: 'small map-range-ok' }, `You’re ${fmtDist(distance)} away · within the ${requiredRadius} m challenge area.`)
          : null;
        const goChecked = (mode) => {
          if (outside) { toast('Move closer to the challenge location before starting this challenge.', ''); return; }
          go(c, mode);
        };
        return el('div', { class: 'challenge-map-item' },
          el('div', { class: 'row' }, el('div', { class: 'challenge-map-number' }, String(c.number || '•')), el('div', { class: 'grow' }, el('b', {}, c.name), el('span', { class: 'small muted' }, `${c.points ? c.points + ' points' : mediaLabel(c.requiredMedia)}${c.location?.name ? ' · ' + c.location.name : ''}`))),
          c.description ? el('p', { class: 'small muted' }, c.description) : null,
          c.instructions ? el('p', { class: 'small' }, c.instructions) : null,
          rangeNote,
          el('div', { class: 'row' },
            canPhoto ? el('button', { class: 'btn small grow', disabled: outside, onclick: () => goChecked('photo') }, 'Take photo') : null,
            canVideo ? el('button', { class: 'btn small ghost grow', disabled: outside, onclick: () => goChecked('video') }, 'Record video') : null));
      })),
      location ? el('button', { class: 'btn ghost block', onclick: () => window.open(googleMapsDirectionsUrl(location), '_blank', 'noopener,noreferrer') }, 'Get directions') : null,
      el('button', { class: 'btn ghost block', onclick: () => { s.close(); app.go('challenges', {}, { replace: true }); } }, 'View all challenges'));
    const s = sheet(body, { label: 'Challenge location' });
  }

  function openPin(p) {
    const f = lastFix();
    const cs = chal(p);
    if (cs.length) return openChallenges(cs, p);
    const s = sheet(el('div', {},
      el('span', { class: 'kicker' }, 'MAP LOCATION'), el('h1', {}, p.name),
      p.points ? el('p', {}, el('span', { class: 'pill acc' }, `${p.points} points`)) : null,
      p.description ? el('p', {}, p.description) : null,
      p.instructions ? el('p', { class: 'small muted' }, p.instructions) : null,
      f ? el('p', { class: 'small' }, `${fmtDist(haversine(f.latitude, f.longitude, p.latitude, p.longitude))} from you`) : null,
      el('div', { class: 'stack' },
        cfg.photosEnabled ? el('button', { class: 'btn block', onclick: () => { s.close(); app.ctx.challenge = null; app.go('camera', {}, { replace: true }); } }, 'Take photo') : null,
        p.videoAllowed && cfg.videosEnabled ? el('button', { class: 'btn ghost block', onclick: () => { s.close(); app.ctx.challenge = null; app.ctx.mode = 'video'; app.go('camera', {}, { replace: true }); } }, 'Record video') : null,
        el('button', { class: 'btn ghost block', onclick: () => window.open(googleMapsDirectionsUrl(p), '_blank', 'noopener,noreferrer') }, 'Get directions')),
      { label: p.name });
  }

  function paint() {
    if (!map) return;
    const challengeGroups = new Map();
    const resolveLocation = (c) => {
      if (c.location) return c.location;
      const n = String(c.number || '').trim();
      if (!n) return null;
      return pins.find((p) => (p.challengeNumbers || []).some((x) => String(x).trim() === n)) || null;
    };
    for (const c of challenges) {
      const loc = resolveLocation(c);
      if (!loc) continue;
      const key = String(loc.id || `${loc.latitude},${loc.longitude}`);
      if (!challengeGroups.has(key)) challengeGroups.set(key, { loc, challenges: [] });
      challengeGroups.get(key).challenges.push(c);
    }
    const challengeMarkers = [];
    const challengeLocationIds = new Set();
    for (const [key, group] of challengeGroups) {
      const cs = group.challenges, loc = group.loc;
      if (loc.id) challengeLocationIds.add(String(loc.id));
      const label = cs.length === 1 ? String(cs[0].number || '⚑') : String(cs.length);
      challengeMarkers.push({ id: `challenge:${key}`, lat: Number(loc.latitude), lon: Number(loc.longitude), label, kind: 'challenge', count: cs.length, done: cs.every((c) => done.has(c.id)), hitRadius: 28, challengeGroup: cs, pin: loc });
    }
    const plainPins = pins.filter((p) => !challengeLocationIds.has(String(p.id)));
    const locationMarkers = plainPins.map((p) => ({ id: p.id, lat: p.latitude, lon: p.longitude, label: p.name, color: '#5a2c84', done: false, pin: p, kind: 'location', hitRadius: 24 }));
    map.setMarkers([...challengeMarkers, ...locationMarkers]);
  }

  return {
    async show() {
      if (!map) {
        map = new TileMap(wrap, { tileUrl: cfg.tileUrl, lat: cfg.mapCenterLat, lon: cfg.mapCenterLon, zoom: cfg.mapZoom, onMarkerClick: (m) => m.kind === 'challenge' ? openChallenges(m.challengeGroup, m.pin) : openPin(m.pin), label: 'Map of challenge locations. Use the list button for a text version.' });
      }
      map.tileUrl = cfg.tileUrl;
      external.hidden = !cfg.mapUrl;
      startWatch(); off && off();
      off = onFix((f) => { if (map) map.setUser(f); });
      if (lastFix()) map.setUser(lastFix());
      if (!pins.length) {
        const quick = await cache.get('pins').catch(() => null);
        if (Array.isArray(quick) && quick.length) {
          pins = quick;
          paint();
          if (!initialViewSet) map.fitTo(pins.map((x) => ({ lat: Number(x.latitude), lon: Number(x.longitude) })));
        }
      }
      const [p, c, d] = await Promise.all([getPins(), getChallenges(), doneIds()]);
      pins = p.items; challenges = c.items; done = d;
      banner.hidden = !(p.offline || navigator.onLine === false);
      let sourceLabel = '';
      if (p.sheetUrl) { try { sourceLabel = ' · ' + new URL(p.sheetUrl).hostname; } catch {} }
      banner.textContent = p.offline ? (pins.length ? 'Offline. The last saved Google Sheet locations are being used.' : 'Offline. The Kalgoorlie base map is still available. Add locations when you are back online.') : `Locations loaded from the organiser Google Sheet${sourceLabel}.`;
      const challengeCount = challenges.length;
      emptyMap.hidden = !!(pins.length || challengeCount);
      emptyMap.innerHTML = '';
      if (!emptyMap.hidden) {
        emptyMap.append(el('b', {}, 'Kalgoorlie map ready'), el('p', { class: 'small' }, 'The base map is available now. Locations and challenges from the organiser Google Sheet will appear here automatically.'), el('button', { class: 'btn small', onclick: () => app.go('camera') }, 'Open camera'));
      }
      paint();
      const focusPoints = [...pins.map((x) => ({ lat: x.latitude, lon: x.longitude })), ...challenges.filter((c) => c.location).map((c) => ({ lat: Number(c.location.latitude), lon: Number(c.location.longitude) }))];
      if (app.ctx.mapFocus) {
        map.setView(Number(app.ctx.mapFocus.lat), Number(app.ctx.mapFocus.lon), Math.max(map.zoom, 16));
        app.ctx.mapFocus = null;
      } else if (!initialViewSet) {
        if (focusPoints.length) map.fitTo(focusPoints);
        else map.setView(Number(cfg.mapCenterLat), Number(cfg.mapCenterLon), Number(cfg.mapZoom));
        initialViewSet = true;
      }
      if (showingList) drawList();
      map.resize();
    },
    hide() { off && off(); off = null; stopWatch(); },
  };
}
