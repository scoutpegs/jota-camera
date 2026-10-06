// GPS. The position is taken when the photo is taken, never when it is uploaded.
import { debug } from './debug.js';

let watchId = null;
let latest = null; // {latitude, longitude, accuracy, at}
let denied = false;
const listeners = new Set();

export const supported = () => 'geolocation' in navigator;
export const onFix = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const lastFix = () => latest;
export const isDenied = () => denied;

export async function permissionState() {
  if (!supported()) return 'unsupported';
  try { if (navigator.permissions) return (await navigator.permissions.query({ name: 'geolocation' })).state; } catch { /* iOS Safari may not support this */ }
  return localStorage.getItem('jota.locAsked') ? (denied ? 'denied' : 'granted') : 'prompt';
}

function accept(pos) {
  latest = { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy, at: pos.timestamp || Date.now() };
  denied = false;
  listeners.forEach((f) => f(latest));
}
function fail(err) { if (err && err.code === 1) { denied = true; listeners.forEach((f) => f(null)); } }

export function startWatch() {
  if (!supported() || watchId !== null) return;
  try { localStorage.setItem('jota.locAsked', '1'); } catch { /* ignore */ }
  watchId = navigator.geolocation.watchPosition(accept, fail, { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 });
}
export function stopWatch() {
  if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
}

// The position to attach to a photo/video taken right now: {latitude, longitude, accuracy} or null.
export async function getFix() {
  if (debug.get('noGps') || !supported()) return null;
  if (latest && Date.now() - latest.at < 30000) return pick(latest);
  const fresh = await new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => { accept(p); resolve(latest); },
      (e) => { fail(e); resolve(null); },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 3500 });
  });
  if (fresh) return pick(fresh);
  if (latest && Date.now() - latest.at < 5 * 60000) return pick(latest); // recent enough, and honest about its age via accuracy
  return null;
}
const pick = (f) => ({ latitude: f.latitude, longitude: f.longitude, accuracy: f.accuracy });
