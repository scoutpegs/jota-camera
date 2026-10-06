// Challenges, map pins and "prepare for offline". Always falls back to the copy saved on the phone.
import { api } from './api.js';
import { cache } from './db.js';
import { cfg, refreshConfig } from './config.js';
import { fetchSounds, getSoundBlob } from './audio.js';
import { project, tileUrlFor } from './tilemap.js';

async function cached(key, path, pick) {
  try {
    const r = await api(path, { auth: false });
    const v = pick(r);
    cache.set(key, v).catch(() => {});
    return { items: v, offline: false };
  } catch (e) {
    const v = await cache.get(key).catch(() => null);
    return { items: v || [], offline: true, empty: !v };
  }
}
export const getChallenges = () => cached('challenges', '/api/challenges', (r) => r.challenges);
export const getPins = () => cached('pins', '/api/map', (r) => r.pins);

// Download the small things the app needs when there is no signal at the event.
export async function prepareOffline(onStep = () => {}) {
  const report = [];
  const step = async (label, fn) => { onStep(label); try { report.push({ label, ok: true, detail: await fn() }); } catch (e) { report.push({ label, ok: false, detail: e.message || 'Failed' }); } };
  await step('Competition details', async () => { if (!(await refreshConfig())) throw new Error('No connection'); return 'Saved'; });
  await step('Challenges', async () => { const r = await getChallenges(); if (r.offline) throw new Error('No connection'); return `${r.items.length} saved`; });
  await step('Map locations', async () => { const r = await getPins(); if (r.offline) throw new Error('No connection'); return `${r.items.length} saved`; });
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
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) urls.add(tileUrlFor(cfg.tileUrl, z, ((tx + dx) % n + n) % n, ty + dy));
      }
    }
    // keep it small and polite: the free map servers do not like bulk downloads
    const list = [...urls].slice(0, 60);
    let ok = 0;
    await Promise.all(list.map((u) => fetch(u, { mode: 'cors' }).then((r) => { if (r.ok) ok++; }).catch(() => {})));
    if (!ok) throw new Error('Map pictures could not be saved');
    return `${ok} tiles saved`;
  });
  return report;
}
