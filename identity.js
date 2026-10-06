// Who is using this phone. The phone invents its own id + secret, so the name step works with no internet.
import { kv } from './db.js';
import { uuid, randomSecret, cleanName } from './util.js';

const LS = 'jota.identity';
let current = null;

export function loadIdentitySync() {
  if (current) return current;
  try { current = JSON.parse(localStorage.getItem(LS) || 'null'); } catch { current = null; }
  return current;
}
export async function loadIdentity() {
  const fast = loadIdentitySync();
  if (fast) return fast;
  try { // localStorage was cleared but IndexedDB survived (or the other way round)
    const saved = await kv.get('identity');
    if (saved) { current = saved; localStorage.setItem(LS, JSON.stringify(saved)); }
  } catch { /* ignore */ }
  return current;
}
async function save(i) {
  current = i;
  try { localStorage.setItem(LS, JSON.stringify(i)); } catch { /* ignore */ }
  try { await kv.set('identity', i); } catch { /* ignore */ }
}
export async function createIdentity(name) {
  const i = { id: uuid(), secret: randomSecret(32), name: cleanName(name), registered: false, createdAt: new Date().toISOString() };
  await save(i);
  return i;
}
export async function renameIdentity(name) {
  const i = { ...current, name: cleanName(name), registered: false };
  await save(i);
  return i;
}
export async function markRegistered(flag = true) { if (current) await save({ ...current, registered: flag }); }
export async function resetRegistration() { if (current) await save({ ...current, registered: false }); }
export const identity = () => current;
export const deviceId = () => {
  try { let d = localStorage.getItem('jota.device'); if (!d) { d = uuid(); localStorage.setItem('jota.device', d); } return d; } catch { return ''; }
};
