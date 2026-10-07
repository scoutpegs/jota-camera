// Map tab: the organiser's Google Sheet controls the location list and map link.
// The app uses lightweight canvas tiles for the in-app view and can hand off to Google Maps for directions.
import { el, icon, sheet, fmtDist, haversine, toast } from './util.js';
import { cfg } from './config.js';
import { TileMap } from './tilemap.js';
import { getPins, getChallenges } from './data.js';
import { onFix, lastFix, startWatch, stopWatch, getFix } from './location.js';
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
  const place = el('div', { class: 'map-place' },
    el('span', { class: 'eyebrow' }, 'JOTA-JOTI'),
    el('b', {}, 'Event map'),
    el('span', {}, 'Kalgoorlie · Goldfields-Esperance'));
  const viewToggle = el('div', { class: 'map-view-toggle', role: 'group', 'aria-label': 'Map view' },
    el('button', { id: 'map-view-map', type: 'button', 'aria-pressed': 'true', onclick: () => setList(false) }, 'Map'),
    el('button', { id: 'map-view-list', type: 'button', 'aria-pressed': 'false', onclick: () => setList(true) }, 'List'));
  const listBox = el('div', { class: 'page', hidden: true });
  const emptyMap = el('div', { class: 'map-empty', hidden: true });
  const popover = el('div', { class: 'map-popover', hidden: true });
  const tools = el('div', { class: 'map-toolbar' },
    el('button', { class: 'tool', 'aria-label': 'Zoom in', onclick: () => map && map.zoomBy(1) }, icon('plus')),
    el('button', { class: 'tool', 'aria-label': 'Zoom out', onclick: () => map && map.zoomBy(-1) }, el('span', { style: { fontSize: '22px', lineHeight: 1 } }, '−')),
    el('button', { class: 'tool', id: 'locate', 'aria-label': 'Centre on my location', onclick: () => { const f = lastFix(); if (f && map) map.setView(f.latitude, f.longitude, Math.max(map.zoom, 16)); else startWatch(); } }, icon('locate')));
  const external = el('button', { class: 'map-external', hidden: true, onclick: () => { if (cfg.mapUrl) window.open(cfg.mapUrl, '_blank', 'noopener,noreferrer'); } }, icon('map'), el('span', {}, 'Open Google Maps'));
  root.append(wrap, banner, place, viewToggle, external, tools, emptyMap, listBox, popover);
  let map = null, pins = [], challenges = [], done = new Set(), off = null, showingList = false, initialViewSet = false;

  function hidePopover() { popover.hidden = true; popover.replaceChildren(); }

  function showPopoverContent(title, kicker, description, instructions, points, challengeRows = []) {
    const close = el('button', { class: 'map-popover-close', 'aria-label': 'Close', onclick: hidePopover }, icon('close'));
    const iconBox = el('div', { class: 'map-popover-icon' }, icon(challengeRows.length ? 'flag' : 'pin'));
    const titleBlock = el('div', { class: 'grow' },
      el('span', { class: 'kicker' }, kicker),
      el('h2', {}, title),
      points ? el('span', { class: 'pill acc' }, `${points} points`) : null);
    const head = el('div', { class: 'map-popover-head' }, iconBox, titleBlock, close);
    const content = [];
    if (description) content.push(el('p', { class: 'map-popover-description' }, description));
    if (instructions) content.push(el('div', { class: 'map-popover-instructions' },
      el('b', {}, 'What to do'), el('p', {}, instructions)));
    if (challengeRows.length) {
      const list = el('div', { class: 'map-popover-challenges' });
      for (const row of challengeRows) list.append(row);
      content.push(list);
    }
    const actions = el('div', { class: 'map-popover-actions' });
    popover.replaceChildren(head, ...content, actions);
    popover.hidden = false;
    return actions;
  }

  function showChallengePopover(c, location = null) {
    const title = location?.name || c.name;
    const actions = showPopoverContent(title, `CHALLENGE${c.number ? ' · ' + c.number : ''}`, c.description || '', c.instructions || '', c.points || 0);
    const requiredRadius = cfg.enforceRadius ? Number(c.radius || 0) : 0;
    const f = lastFix();
    const distance = location && f ? haversine(f.latitude, f.longitude, Number(location.latitude), Number(location.longitude)) : null;
    const outside = requiredRadius > 0 && (distance == null || distance > requiredRadius);
    if (requiredRadius > 0) {
      actions.append(el('p', { class: `small ${outside ? 'map-range-warning' : 'map-range-ok'}` },
        distance == null ? `This challenge needs your location and must be completed within ${requiredRadius} m.`
          : outside ? `Move closer. You are ${fmtDist(distance)} away.`
          : `You are ${fmtDist(distance)} away and within the challenge area.`));
    }
    if (c.requiredMedia !== 'video' && cfg.photosEnabled) {
      actions.append(el('button', { class: 'btn block', disabled: outside, onclick: () => { hidePopover(); app.startChallenge(c, 'photo'); } }, 'Take photo'));
    }
    if (c.requiredMedia !== 'photo' && cfg.videosEnabled && (!location || location.videoAllowed !== false)) {
      actions.append(el('button', { class: 'btn ghost block', disabled: outside, onclick: () => { hidePopover(); app.startChallenge(c, 'video'); } }, 'Record video'));
    }
    if (location) actions.append(el('button', { class: 'btn ghost block', onclick: () => window.open(googleMapsDirectionsUrl(location), '_blank', 'noopener,noreferrer') }, 'Get directions'));
  }

  function showLocationPopover(p) {
    const actions = showPopoverContent(p.name, 'MAP LOCATION', p.description || '', p.instructions || '', p.points || 0);
    const f = lastFix();
    if (f) actions.append(el('p', { class: 'small muted' }, `${fmtDist(haversine(f.latitude, f.longitude, p.latitude, p.longitude))} from you`));
    if (cfg.photosEnabled) actions.append(el('button', { class: 'btn block', onclick: () => { hidePopover(); app.ctx.challenge = null; app.ctx.mode = 'photo'; app.go('camera', {}, { replace: true }); } }, 'Take photo'));
    if (p.videoAllowed && cfg.videosEnabled) actions.append(el('button', { class: 'btn ghost block', onclick: () => { hidePopover(); app.ctx.challenge = null; app.ctx.mode = 'video'; app.go('camera', {}, { replace: true }); } }, 'Record video'));
    actions.append(el('button', { class: 'btn ghost block', onclick: () => window.open(googleMapsDirectionsUrl(p), '_blank', 'noopener,noreferrer') }, 'Get directions'));
  }

  function setList(next) {
    showingList = !!next;
    if (showingList) hidePopover();
    listBox.hidden = !showingList;
    wrap.hidden = showingList;
    place.hidden = showingList;
    viewToggle.hidden = false;
    tools.hidden = showingList;
    external.hidden = showingList || !cfg.mapUrl;
    root.style.overflowY = showingList ? 'auto' : 'hidden';
    const mapBtn = root.querySelector('#map-view-map');
    const listBtn = root.querySelector('#map-view-list');
    mapBtn.setAttribute('aria-pressed', String(!showingList));
    listBtn.setAttribute('aria-pressed', String(showingList));
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
    if (!cs.length) return location ? showLocationPopover(location) : hidePopover();
    if (cs.length === 1) return showChallengePopover(cs[0], location);

    const actions = showPopoverContent(location?.name || 'Challenges here', 'CHALLENGES', location?.description || '', location?.instructions || '', 0);
    const rows = document.createElement('div');
    rows.className = 'map-popover-challenges';
    for (const c of cs) {
      rows.append(el('button', { class: 'map-popover-challenge-row', onclick: () => showChallengePopover(c, location) },
        el('div', { class: 'challenge-map-number' }, String(c.number || '•')),
        el('div', { class: 'grow' }, el('b', {}, c.name), c.description
          ? el('span', { class: 'small muted' }, c.description)
          : el('span', { class: 'small muted' }, mediaLabel(c.requiredMedia))),
        icon('chevron')));
    }
    const existing = popover.querySelector('.map-popover-challenges');
    if (existing) existing.replaceWith(rows); else popover.insertBefore(rows, actions);
    actions.append(el('button', { class: 'btn ghost block', onclick: () => { hidePopover(); app.go('challenges', {}, { replace: true }); } }, 'View all challenges'));
  }

  function openPin(p) {
    const cs = chal(p);
    if (cs.length) return openChallenges(cs, p);
    showLocationPopover(p);
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
        map = new TileMap(wrap, { tileUrl: cfg.tileUrl, lat: cfg.mapCenterLat, lon: cfg.mapCenterLon, zoom: cfg.mapZoom, onMarkerClick: (m) => m.kind === 'challenge' ? openChallenges(m.challengeGroup, m.pin) : openPin(m.pin), onMapClick: () => hidePopover(), label: 'Map of challenge locations. Use the list button for a text version.' });
      }
      map.tileUrl = cfg.tileUrl;
      external.hidden = !cfg.mapUrl;
      startWatch(); off && off();
      off = onFix((f) => {
        if (!map) return;
        map.setUser(f);
        if (f && !app.ctx.mapFocus) {
          map.setView(f.latitude, f.longitude, Math.max(map.zoom, 16));
          initialViewSet = true;
        }
        if (showingList) drawList();
      });
      const existingFix = lastFix();
      if (existingFix) {
        map.setUser(existingFix);
        if (!app.ctx.mapFocus) { map.setView(existingFix.latitude, existingFix.longitude, Math.max(map.zoom, 16)); initialViewSet = true; }
      } else {
        // Try once in the background so the map can centre on the phone without waiting for event locations.
        getFix().then((f) => {
          if (!f || !map || app.ctx.mapFocus) return;
          map.setUser(f);
          map.setView(f.latitude, f.longitude, Math.max(map.zoom, 16));
          initialViewSet = true;
          if (showingList) drawList();
        }).catch(() => {});
      }
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
      emptyMap.hidden = true;
      emptyMap.replaceChildren();
      paint();
      if (app.ctx.mapFocus) {
        map.setView(Number(app.ctx.mapFocus.lat), Number(app.ctx.mapFocus.lon), Math.max(map.zoom, 16));
        app.ctx.mapFocus = null;
        initialViewSet = true;
      } else if (!initialViewSet) {
        // Never wait for pins: always show a real map. Use the phone location when available,
        // otherwise use the organiser's Kalgoorlie centre. Pins simply layer over the map.
        const f = lastFix();
        if (f) map.setView(f.latitude, f.longitude, Math.max(Number(cfg.mapZoom) || 14, 16));
        else map.setView(Number(cfg.mapCenterLat), Number(cfg.mapCenterLon), Number(cfg.mapZoom));
        initialViewSet = true;
      }
      banner.hidden = false;
      if (navigator.onLine === false || p.offline) {
        banner.textContent = pins.length ? 'Offline: saved event locations are shown on the map. Your location is shown in blue when available.' : 'Map is ready. Your location is shown in blue when location access is allowed. Event locations will appear here when organisers add them.';
      } else {
        banner.textContent = pins.length ? 'Event locations are shown on the map. Your location is the blue dot.' : 'Map is ready. Your location is the blue dot. Event locations will appear here when organisers add them.';
      }
      if (showingList) drawList();
      requestAnimationFrame(() => { map.resize(); map.invalidate(); });
      setTimeout(() => { map.resize(); map.invalidate(); }, 120);
    },
    hide() { off && off(); off = null; stopWatch(); },
  };
}
