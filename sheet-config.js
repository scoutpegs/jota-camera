// Public event configuration read from the organiser's Google Sheet through Apps Script JSONP.
// This is intentionally public: participants need the map/location list, but no organiser secret is returned.
import { GOOGLE_BACKUP_URL, GOOGLE_BACKUP_KEY } from './backend.js';
import { cache } from './db.js';

let inFlight = null;
let seq = 0;

export function loadSheetConfig({ force = false, timeout = 7000 } = {}) {
  if (!GOOGLE_BACKUP_URL || !GOOGLE_BACKUP_KEY) return Promise.resolve(null);
  if (inFlight && !force) return inFlight;
  inFlight = new Promise((resolve) => {
    const callback = `__jotaSheet_${Date.now()}_${++seq}`;
    let timer = null;
    let script = null;
    let finished = false;
    const cleanup = () => {
      finished = true;
      if (timer) clearTimeout(timer);
      try { delete window[callback]; } catch { window[callback] = undefined; }
      if (script) script.remove();
    };
    const done = (value) => { cleanup(); resolve(value); };

    window[callback] = (payload) => {
      if (!payload || typeof payload !== 'object' || payload.ok === false) {
        done(null);
        return;
      }
      const settings = payload.settings || {};
      const locations = Array.isArray(payload.locations) ? payload.locations : [];
      const value = {
        settings,
        locations: locations.filter(validLocation),
        sheetUrl: payload.sheetUrl || '',
        updatedAt: payload.updatedAt || '',
        source: 'google-sheet',
      };
      cache.set('sheet:map', value).catch(() => {});
      done(value);
    };

    script = document.createElement('script');
    script.async = true;
    script.src = `${GOOGLE_BACKUP_URL}?op=publicConfig&key=${encodeURIComponent(GOOGLE_BACKUP_KEY)}&callback=${encodeURIComponent(callback)}&_=${Date.now()}`;
    script.onerror = () => done(null);
    timer = setTimeout(() => done(null), timeout);
    document.head.append(script);
  }).catch(() => null).finally(() => { inFlight = null; });
  return inFlight;
}

export async function getCachedSheetConfig() {
  return cache.get('sheet:map').catch(() => null);
}

function validLocation(x) {
  return x && x.id && x.name && Number.isFinite(Number(x.latitude)) && Number.isFinite(Number(x.longitude));
}
