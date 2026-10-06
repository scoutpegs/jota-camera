// My posts: a map-first memory view. Every geotagged capture is pinned near where it was taken.
import { el, icon, ago, toast, sheet } from './util.js';
import { listSubs, getThumb, getMedia, discard, retryNow, events as subEvents } from './submissions.js';
import { events as upEvents, kick } from './uploader.js';
import { api } from './api.js';
import { identity } from './identity.js';
import { TileMap } from './tilemap.js';
import { onFix, lastFix, startWatch, stopWatch } from './location.js';

function hasCoords(s) {
  return Number.isFinite(Number(s?.latitude)) && Number.isFinite(Number(s?.longitude));
}
function niceDate(v) {
  try { return new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(v)); }
  catch { return ''; }
}
function niceTime(v) {
  try { return new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit' }).format(new Date(v)); }
  catch { return ''; }
}
function distanceText(a, b) {
  const R = 6371000, p1 = Number(a.latitude) * Math.PI / 180, p2 = Number(b.latitude) * Math.PI / 180;
  const dp = (Number(b.latitude) - Number(a.latitude)) * Math.PI / 180, dl = (Number(b.longitude) - Number(a.longitude)) * Math.PI / 180;
  const q = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  const d = 2 * R * Math.atan2(Math.sqrt(q), Math.sqrt(1 - q));
  return d < 1000 ? `${Math.round(d)} m` : `${(d / 1000).toFixed(1)} km`;
}

export function mountPosts(root, app) {
  let urls = [], active = false, remoteCache = [], map = null, current = [], hasFitted = false, activeSheet = null, offFix = null, userFitted = false;
  const objectUrls = new Map();

  const revoke = () => { objectUrls.forEach((u) => URL.revokeObjectURL(u)); objectUrls.clear(); urls = []; };
  const urlForThumb = async (sub) => {
    if (sub.thumbUrl) return sub.thumbUrl;
    const key = `${sub.id}:thumb`;
    if (objectUrls.has(key)) return objectUrls.get(key);
    const b = await getThumb(sub.id).catch(() => null);
    if (!b) return '';
    const u = URL.createObjectURL(b); objectUrls.set(key, u); urls.push(u); return u;
  };

  async function loadRemote() {
    if (navigator.onLine === false || !identity() || !identity().registered) return;
    try { remoteCache = (await api('/api/my/submissions')).submissions || []; } catch { /* cached/local view remains usable */ }
  }

  function allUniqueSubs(local, remote) {
    const byId = new Map(local.map((s) => [s.id, s]));
    for (const r of remote) if (!byId.has(r.id)) byId.set(r.id, { ...r, status: 'UPLOADED' });
    return [...byId.values()].sort((a, b) => String(b.capturedAt).localeCompare(String(a.capturedAt)));
  }

  function cluster(list) {
    const result = [];
    for (const item of list) {
      if (!hasCoords(item)) continue;
      const x = map ? map.latLonToScreen(Number(item.latitude), Number(item.longitude)) : { x: 0, y: 0 };
      let hit = null;
      for (const c of result) {
        const d = Math.hypot(c.screen.x - x.x, c.screen.y - x.y);
        if (d < 46) { hit = c; break; }
      }
      if (hit) {
        hit.items.push(item);
        const n = hit.items.length;
        hit.lat = hit.items.reduce((a, v) => a + Number(v.latitude), 0) / n;
        hit.lon = hit.items.reduce((a, v) => a + Number(v.longitude), 0) / n;
        hit.screen = map.latLonToScreen(hit.lat, hit.lon);
      } else result.push({ lat: Number(item.latitude), lon: Number(item.longitude), items: [item], screen: x });
    }
    return result.map((c) => ({
      id: 'memory:' + c.items.map((x) => x.id).join(','), lat: c.lat, lon: c.lon, kind: 'memory', count: c.items.length,
      mediaType: c.items[0].mediaType, imageUrl: c.items[0].thumbUrl || '', items: c.items, label: '', hitRadius: 34,
    }));
  }

  async function syncMap() {
    if (!map) return;
    const geo = current.filter(hasCoords);
    const markers = [];
    const clusters = cluster(geo);
    for (const c of clusters) {
      const img = c.imageUrl || await urlForThumb(c.items[0]);
      c.imageUrl = img; markers.push(c);
    }
    map.setMarkers(markers);
  }

  function postStatus(s) {
    if (s.status === 'QUEUED') return 'Saved on this phone · waiting to upload';
    if (s.status === 'UPLOADING') return `Uploading ${Math.round((s.progress || 0) * 100)}%`;
    if (s.status === 'UPLOADED') return s.storageProvider === 'DRIVE' ? 'Backed up to Google Drive' : 'Sent to organisers';
    if (s.status === 'FAILED') return s.userMessage || 'Upload needs another try';
    if (s.status === 'DRAFT') return 'Draft · not posted yet';
    return '';
  }

  async function openMemory(items, focusMap = true) {
    if (!items?.length) return;
    const primary = items[0];
    if (focusMap && map && hasCoords(primary)) map.setView(Number(primary.latitude), Number(primary.longitude), Math.max(map.zoom, 16));
    const previews = [];
    for (const s of items.slice(0, 8)) {
      const thumb = await urlForThumb(s);
      previews.push(el('button', { class: 'memory-sheet-thumb', 'aria-label': s.mediaType === 'video' ? 'Open video memory' : 'Open photo memory', onclick: () => { activeSheet?.close(); activeSheet = null; showDetail(s); } },
        thumb ? el('img', { src: thumb, alt: '' }) : el('span', {}, s.mediaType === 'video' ? '▶' : '•')));
    }
    const body = el('div', { class: 'memory-sheet-body' },
      el('div', { class: 'memory-sheet-head' },
        el('div', { class: 'memory-sheet-title' }, el('span', { class: 'kicker' }, 'MY POST'), el('h1', {}, primary.challengeName || (primary.mediaType === 'video' ? 'Video' : 'Photo')),
          el('p', { class: 'muted small' }, `${niceDate(primary.capturedAt)} · ${niceTime(primary.capturedAt)}`)),
        primary.mediaType === 'video' ? el('span', { class: 'memory-type' }, 'VIDEO') : el('span', { class: 'memory-type' }, 'PHOTO')),
      previews.length > 1 ? el('div', { class: 'memory-sheet-strip' }, ...previews) : null,
      primary.caption ? el('p', { class: 'memory-caption' }, primary.caption) : null,
      el('div', { class: 'memory-meta-grid' },
        el('div', {}, el('span', {}, 'Taken'), el('b', {}, `${niceDate(primary.capturedAt)}`)),
        el('div', {}, el('span', {}, 'Time'), el('b', {}, niceTime(primary.capturedAt))),
        hasCoords(primary) ? el('div', {}, el('span', {}, 'Location'), el('b', {}, 'Pinned on map')) : el('div', {}, el('span', {}, 'Location'), el('b', {}, 'Not recorded')),
        primary.challengeName ? el('div', {}, el('span', {}, 'Challenge'), el('b', {}, primary.challengeName)) : null,
      ),
      hasCoords(primary) ? el('p', { class: 'small muted' }, primary.accuracy ? `Location accuracy about ${Math.round(Number(primary.accuracy))} m.` : 'Location was available when this was captured.') : null,
      postStatus(primary) ? el('p', { class: 'small', style: { marginTop: '10px' } }, postStatus(primary)) : null
    );
    activeSheet = sheet(body, { label: 'My post', onClose: () => { activeSheet = null; } });
  }

  async function showDetail(s) {
    const thumb = await urlForThumb(s);
    const media = s.mediaUrl || (s.status !== 'UPLOADED' ? await (async()=>{ const b=await getMedia(s.id).catch(()=>null); if(!b) return ''; const u=URL.createObjectURL(b); urls.push(u); return u; })() : '');
    const frame = s.mediaType === 'video'
      ? (media ? el('video', { class: 'memory-detail-media', controls: true, playsinline: true, preload: 'metadata', src: media }) : (thumb ? el('img', { class: 'memory-detail-media', src: thumb, alt: '' }) : null))
      : (media ? el('img', { class: 'memory-detail-media', src: media, alt: 'Photo' }) : (thumb ? el('img', { class: 'memory-detail-media', src: thumb, alt: 'Photo' }) : null));
    const body = el('div', { class: 'memory-detail' },
      frame,
      el('div', { class: 'memory-detail-copy' },
        el('div', { class: 'row', style: { justifyContent: 'space-between', gap: '12px' } },
          el('div', { class: 'grow' }, el('span', { class: 'kicker' }, s.mediaType === 'video' ? 'VIDEO' : 'PHOTO'), el('h1', {}, s.challengeName || 'My post')),
          hasCoords(s) ? el('span', { class: 'pill acc' }, 'Mapped') : el('span', { class: 'pill' }, 'No location')),
        s.caption ? el('p', {}, s.caption) : null,
        el('p', { class: 'small muted' }, `${niceDate(s.capturedAt)} · ${niceTime(s.capturedAt)}${hasCoords(s) ? ' · ' + (s.accuracy ? `±${Math.round(Number(s.accuracy))} m` : 'location saved') : ''}`),
        s.challengeName ? el('div', { class: 'memory-challenge' }, el('b', {}, s.challengeName), el('span', {}, 'Challenge attached to this post')) : null,
        el('div', { class: 'row' },
          hasCoords(s) ? el('button', { class: 'btn grow', onclick: () => { activeSheet?.close(); activeSheet = null; map?.setView(Number(s.latitude), Number(s.longitude), Math.max(map.zoom, 17)); } }, 'Show on map') : null,
          s.status === 'FAILED' ? el('button', { class: 'btn ghost grow', onclick: async () => { await retryNow(s.id); kick(); toast('Retry queued.', 'ok'); } }, 'Retry upload') : null)));
    activeSheet = sheet(body, { label: 'Post details', onClose: () => { activeSheet = null; } });
  }

  function renderShell() {
    root.replaceChildren();
    const shell = el('div', { class: 'memory-map-shell' });
    const mapHost = el('div', { class: 'memory-map-canvas' });
    const top = el('div', { class: 'memory-map-top' },
      el('div', { class: 'memory-map-title' }, el('span', { class: 'eyebrow' }, 'JOTA-JOTI'), el('h1', {}, 'My posts'), el('span', { id: 'memory-count' }, '')),
      el('div', { class: 'memory-map-actions' },
        el('button', { class: 'memory-map-icon', id: 'memory-locate', 'aria-label': 'Centre on my location', onclick: () => { if (navigator.geolocation && map) navigator.geolocation.getCurrentPosition((pos) => map.setView(pos.coords.latitude, pos.coords.longitude, Math.max(map.zoom, 16)), () => toast('Location is not available on this device.', 'bad')); } }, icon('locate'))));
    const stats = el('div', { class: 'memory-stats' }, el('span', { id: 'memory-stats-text' }, ''));
    const sheetPanel = el('section', { class: 'memory-panel', 'aria-label': 'My post memories' },
      el('div', { class: 'memory-panel-handle' }),
      el('div', { class: 'memory-panel-head' }, el('div', {}, el('h2', {}, 'Your captures'), el('p', { class: 'small' }, 'Scroll the map or tap a capture to open it.')), stats),
      el('div', { class: 'memory-rail', id: 'memory-rail' }),
      el('div', { class: 'memory-no-location', id: 'memory-no-location', hidden: true }, el('b', {}, 'Posts without a location'), el('p', { class: 'small muted' }, 'These captures are still saved, but they were made without location permission.')),
      el('div', { class: 'memory-no-location-list', id: 'memory-no-location-list' })));
    const controls = el('div', { class: 'memory-map-controls' },
      el('button', { class: 'memory-control', 'aria-label': 'Zoom in', onclick: () => map?.zoomBy(1) }, '+'),
      el('button', { class: 'memory-control', 'aria-label': 'Zoom out', onclick: () => map?.zoomBy(-1) }, '−'));
    shell.append(mapHost, top, controls, sheetPanel); root.append(shell);
    map = new TileMap(mapHost, { lat: app.cfg.mapCenterLat, lon: app.cfg.mapCenterLon, zoom: Math.max(app.cfg.mapZoom, 13), tileUrl: app.cfg.tileUrl,
      onMarkerClick: (m) => openMemory(m.items), label: 'Your JOTA-JOTI captures mapped to where they were taken.' });
    return { mapHost, rail: shell.querySelector('#memory-rail'), stats: shell.querySelector('#memory-stats-text'), count: shell.querySelector('#memory-count'), noLocation: shell.querySelector('#memory-no-location'), noLocationList: shell.querySelector('#memory-no-location-list') };
  }

  let ui = null;
  async function render() {
    if (!active) return;
    if (!ui) ui = renderShell();
    const subs = await listSubs();
    revoke();
    const merged = allUniqueSubs(subs, remoteCache);
    current = merged;
    const photoCount = merged.filter((s) => s.mediaType === 'photo').length;
    const videoCount = merged.filter((s) => s.mediaType === 'video').length;
    const mapped = merged.filter(hasCoords);
    const localWaiting = subs.filter((s) => ['QUEUED', 'UPLOADING'].includes(s.status)).length;
    ui.count.textContent = `${merged.length} ${merged.length === 1 ? 'capture' : 'captures'}`;
    ui.stats.textContent = `${photoCount} photos · ${videoCount} videos · ${mapped.length} on the map${localWaiting ? ` · ${localWaiting} waiting` : ''}`;
    ui.rail.replaceChildren();
    for (const s of merged.slice(0, 36)) {
      const thumb = await urlForThumb(s);
      ui.rail.append(el('button', { class: 'memory-card', onclick: () => openMemory([s]), title: s.challengeName || (s.mediaType === 'video' ? 'Video' : 'Photo') },
        el('div', { class: 'memory-card-art' }, thumb ? el('img', { src: thumb, alt: '' }) : el('span', {}, s.mediaType === 'video' ? '▶' : '•'), s.mediaType === 'video' ? el('span', { class: 'memory-card-kind' }, 'VIDEO') : null),
        el('div', { class: 'memory-card-copy' }, el('b', {}, s.challengeName || (s.mediaType === 'video' ? 'Video' : 'Photo')), el('span', {}, hasCoords(s) ? niceDate(s.capturedAt) : 'No location'))));
    }
    if (!merged.length) ui.rail.append(el('div', { class: 'memory-empty' }, el('b', {}, 'No posts yet'), el('p', { class: 'small muted' }, 'Your captures will appear here as soon as you take them.')));
    const noLoc = merged.filter((s) => !hasCoords(s));
    ui.noLocation.hidden = !noLoc.length || !mapped.length;
    ui.noLocationList.replaceChildren(...(!noLoc.length ? [] : noLoc.slice(0, 12).map((s) => el('button', { class: 'memory-list-row', onclick: () => showDetail(s) },
      el('span', { class: 'memory-list-icon' }, s.mediaType === 'video' ? '▶' : '●'), el('span', { class: 'grow' }, el('b', {}, s.challengeName || (s.mediaType === 'video' ? 'Video' : 'Photo')), el('small', {}, `${niceDate(s.capturedAt)} · ${postStatus(s)}`)), icon('chevron')))));
    await syncMap();
    if (mapped.length && !hasFitted) {
      const pts = mapped.map((s) => ({ lat: Number(s.latitude), lon: Number(s.longitude) }));
      if (pts.length) { map.fitTo(pts, 170); hasFitted = true; }
    } else if (!mapped.length && !userFitted && lastFix()) {
      map.setView(lastFix().latitude, lastFix().longitude, Math.max(map.zoom, 14));
      userFitted = true;
    }
  }

  const onProgress = () => render();
  let t;
  const soon = () => { clearTimeout(t); t = setTimeout(render, 180); };
  subEvents.addEventListener('change', soon); upEvents.addEventListener('progress', onProgress);

  return {\n    async show() { active = true; ui = null; map = null; hasFitted = false; userFitted = false; await loadRemote(); await render(); },\n    hide() { active = false; activeSheet?.close(); activeSheet = null; revoke(); offFix && offFix(); offFix = null; stopWatch(); if (map) { map.destroy(); map = null; } root.replaceChildren(); ui = null; },\n  };
}
