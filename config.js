// Competition settings from the organiser, cached so they work offline.
// Map URL + location data is sourced from the organiser's Google Sheet via Apps Script.
import { api } from './api.js';
import { cache } from './db.js';
import { loadSheetConfig } from './sheet-config.js';

export const DEFAULTS = {
  competitionName: 'JOTA-JOTI', photosEnabled: true, videosEnabled: true, maxVideoSeconds: 60, videoBitsPerSecond: 2000000, maxMediaBytes: 31457280,
  locationMode: 'optional', enforceRadius: false, allowCustomSounds: true, allowAudioUploads: true, maxCustomAudioSeconds: 15,
  micMode: 'mix', mediaNotice: '', aButtonLabel: 'A', aButtonUrl: '',
  tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  mapUrl: 'https://www.google.com/maps/search/?api=1&query=Kalgoorlie%2C%20Western%20Australia',
  mapCenterLat: -30.7489, mapCenterLon: 121.4658, mapZoom: 14, offlineAudio: false,
};
export const cfg = { ...DEFAULTS };
export let serverOffsetMs = 0; // server clock minus phone clock

export async function loadConfig() {
  try { const c = await cache.get('config'); if (c) Object.assign(cfg, c); } catch { /* ignore */ }
  try {
    const c = await cache.get('sheet:map');
    if (c && c.settings) Object.assign(cfg, normaliseSettings(c.settings));
  } catch { /* ignore */ }
  // Do not block camera startup on either remote source.
  refreshConfig();
  refreshSheetConfig();
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

export async function refreshSheetConfig() {
  const r = await loadSheetConfig({ force: true });
  if (!r) return false;
  Object.assign(cfg, normaliseSettings(r.settings));
  window.dispatchEvent(new CustomEvent('jota-sheet-config', { detail: r }));
  window.dispatchEvent(new Event('jota-config'));
  return true;
}

function normaliseSettings(raw) {
  const out = { ...raw };
  const bools = ['photosEnabled', 'videosEnabled', 'enforceRadius', 'allowCustomSounds', 'allowAudioUploads', 'offlineAudio'];
  const nums = ['maxVideoSeconds', 'videoBitsPerSecond', 'maxMediaBytes', 'maxCustomAudioSeconds', 'mapCenterLat', 'mapCenterLon', 'mapZoom'];
  for (const k of bools) if (typeof out[k] === 'string') out[k] = ['true', '1', 'yes', 'on'].includes(out[k].trim().toLowerCase());
  for (const k of nums) if (out[k] !== undefined && out[k] !== '') out[k] = Number(out[k]);
  if (out.mapTileUrl && !out.tileUrl) out.tileUrl = out.mapTileUrl;
  if (out.googleMapsUrl && !out.mapUrl) out.mapUrl = out.googleMapsUrl;
  return out;
}
