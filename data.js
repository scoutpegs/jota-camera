// Challenges, map pins and "prepare for offline".
// The organiser's Google Sheet is the source of truth for the map URL and location list.
// Supabase remains the fallback so an event can still operate if Apps Script is temporarily unavailable.
import { api } from './api.js';
import { cache } from './db.js';
import { cfg, refreshConfig, refreshSheetConfig } from './config.js';
import { loadSheetConfig, getCachedSheetConfig } from './sheet-config.js';
import { fetchSounds, getSoundBlob } from './audio.js';
import { project, tileUrlFor } from './tilemap.js';

async function cached(key, path, pick) {
  try {
    const r = await api(path, { auth: false });
    const v = pick(r);
    cache.set(key, v).catch(() => {});
    return { items: v, offline: false, source: 'supabase' };
  } catch (e) {
    const v = await cache.get(key).catch(() => null);
    return { items: v || [], offline: true, empty: !v, source: 'cache' };
  }
}

export async function getChallenges() {
  const result = await cached('challenges', '/api/challenges', (r) => r.challenges);
  const sheet = await getCachedSheetConfig().catch(() => null);
  const locations = Array.isArray(sheet?.locations) ? sheet.locations : [];
  if (!locations.length || !Array.isArray(result.items)) return result;

  const byId = new Map(locations.map((p) => [String(p.id), normalisePin(p)]));
  const byChallenge = new Map();
  for (const p of locations) {
    for (const n of (p.challengeNumbers || [])) {
      const key = String(n).trim();
      if (!key) continue;
      if (!byChallenge.has(key)) byChallenge.set(key, normalisePin(p));
    }
  }
  const enriched = result.items.map((c) => {
    if (c.location) return c;
    const explicit = c.locationId ? byId.get(String(c.locationId)) : null;
    const byNumber = byChallenge.get(String(c.number || '').trim());
    const loc = explicit || byNumber;
    if (!loc) return c;
    return { ...c, location: { id: loc.id, name: loc.name, latitude: loc.latitude, longitude: loc.longitude } };
  });
  return { ...result, items: enriched };
}

export async function getPins() {
  // Prefer the Google Sheet on every online map refresh.
  if (navigator.onLine !== false) {
    const sheet = await loadSheetConfig({ force: true }).catch(() => null);
    if (sheet && Array.isArray(sheet.locations)) {
      applySheetMapSettings(sheet.settings || {});
      const items = sheet.locations.filter((p) => p.active !== false).map(normalisePin);
      cache.set('pins', items).catch(() => {});
      return { items, offline: false, source: 'google-sheet', sheetUrl: sheet.sheetUrl || '' };
    }
  }
  const cachedSheet = await getCachedSheetConfig();
  if (cachedSheet && Array.isArray(cachedSheet.locations)) {
    applySheetMapSettings(cachedSheet.settings || {});
    const items = cachedSheet.locations.filter((p) => p.active !== false).map(normalisePin);
    return { items, offline: true, source: 'google-sheet-cache', sheetUrl: cachedSheet.sheetUrl || '' };
  }
  return cached('pins', '/api/map', (r) => r.pins);
}

function applySheetMapSettings(settings) {
  if (settings.mapUrl) cfg.mapUrl = String(settings.mapUrl);
  if (settings.mapTileUrl) cfg.tileUrl = String(settings.mapTileUrl);
  if (settings.mapCenterLat !== undefined && Number.isFinite(Number(settings.mapCenterLat))) cfg.mapCenterLat = Number(settings.mapCenterLat);
  if (settings.mapCenterLon !== undefined && Number.isFinite(Number(settings.mapCenterLon))) cfg.mapCenterLon = Number(settings.mapCenterLon);
  if (settings.mapZoom !== undefined && Number.isFinite(Number(settings.mapZoom))) cfg.mapZoom = Number(settings.mapZoom);
}

function normalisePin(p) {
  return {
    id: String(p.id), name: String(p.name || 'Location'), description: String(p.description || ''), instructions: String(p.instructions || ''),
    latitude: Number(p.latitude), longitude: Number(p.longitude), category: String(p.category || ''), icon: String(p.icon || ''),
    points: Number(p.points || 0), photoRequired: !!p.photoRequired, videoAllowed: p.videoAllowed !== false, active: p.active !== false,
    challengeIds: Array.isArray(p.challengeIds) ? p.challengeIds : [], challengeNumbers: Array.isArray(p.challengeNumbers) ? p.challengeNumbers : [],
  };
}

// Download the small things the app needs when there is no signal at the event.
export async function prepareOffline(onStep = () => {}) {
  const report = [];
  const step = async (label, fn) => { onStep(label); try { report.push({ label, ok: true, detail: await fn() }); } catch (e) { report.push({ label, ok: false, detail: e.message || 'Failed' }); } };
  await step('Competition details', async () => { const ok = await refreshConfig(); if (!ok) throw new Error('No connection'); return 'Saved'; });
  await step('Map settings + locations', async () => {
    const r = await refreshSheetConfig();
    if (!r) throw new Error('Google Sheet could not be read');
    return `${(r ? (r.locations || []).length : 0)} locations saved`;
  });
  await step('Challenges', async () => { const r = await getChallenges(); if (r.offline) throw new Error('No connection'); return `${r.items.length} saved`; });
  await step('Sound list', async () => { const r = await fetchSounds({ limit: 100 }); if (r.offline) throw new Error('No connection'); return `${r.sounds.length} sounds listed`; });
  if (cfg.offlineAudio) {
    await step('Sounds (audio)', async () => {
      const r = await fetchSounds({ limit: 40 }); let n = 0;
      for (const s of r.sounds) { try { await getSoundBlob(s); n++; } catch { /* skip */ } }
      return `${n} downloaded`;
    });
  }
  await step('Map picture', async () => {
    const pins = (await getPins()).items;
    const pts = pins.length ? pins.slice(0, 8).map((p) => ({ lat: p.latitude, lon: p.longitude })) : [{ lat: cfg.mapCenterLat, lon: cfg.mapCenterLon }];
    const urls = new Set();
    for (const z of [cfg.mapZoom, 16]) {
      for (const p of pts) {
        const c = project(p.lat, p.lon, z), n = 2 ** z;
        const tx = Math.floor(c.x / 256), ty = Math.floor(c.y / 256);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
          const ty2 = ty + dy; if (ty2 < 0 || ty2 >= n) continue;
          urls.add(tileUrlFor(cfg.tileUrl, z, ((tx + dx) % n + n) % n, ty2));
        }
      }
    }
    const list = [...urls].slice(0, 60);
    let ok = 0;
    await Promise.all(list.map((u) => fetch(u, { mode: 'cors' }).then((r) => { if (r.ok) ok++; }).catch(() => {})));
    if (!ok) throw new Error('Map pictures could not be saved');
    return `${ok} map tiles saved`;
  });
  return report;
}
