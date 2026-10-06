// Competition settings from the organiser, cached so they work offline.
import { api } from './api.js';
import { cache } from './db.js';

export const DEFAULTS = {
  competitionName: 'JOTA-JOTI', photosEnabled: true, videosEnabled: true, maxVideoSeconds: 60, videoBitsPerSecond: 2000000, maxMediaBytes: 31457280,
  locationMode: 'optional', enforceRadius: false, allowCustomSounds: true, allowAudioUploads: true, maxCustomAudioSeconds: 15,
  micMode: 'mix', mediaNotice: '', aButtonLabel: 'A', aButtonUrl: '', tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  mapCenterLat: -30.7745, mapCenterLon: 121.488, mapZoom: 13, offlineAudio: false,
};
export const cfg = { ...DEFAULTS };
export let serverOffsetMs = 0; // server clock minus phone clock

export async function loadConfig() {
  try { const c = await cache.get('config'); if (c) Object.assign(cfg, c); } catch { /* ignore */ }
  refreshConfig(); // don't wait for the network: the camera must open fast
}
export async function refreshConfig() {
  try {
    const r = await api('/api/config', { auth: false });
    Object.assign(cfg, r.settings);
    if (r.serverNow) serverOffsetMs = new Date(r.serverNow).getTime() - Date.now();
    await cache.set('config', r.settings);
    window.dispatchEvent(new Event('jota-config'));
    return true;
  } catch { return false; }
}
