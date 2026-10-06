// Local storage on the phone. Photos and videos live in IndexedDB (never localStorage).
// Stores:  kv (app state) | submissions (the upload queue) | media (the files) | recChunks (crash-safe recording)
//          sounds (downloaded sounds) | cache (competition, challenges, map, sound list)
const NAME = 'jota-camera';
const VERSION = 2;
let dbp;

export function openDb() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('NO_IDB'));
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      let subs;
      if (!db.objectStoreNames.contains('submissions')) subs = db.createObjectStore('submissions', { keyPath: 'id' });
      else subs = req.transaction.objectStore('submissions');
      if (!subs.indexNames.contains('status')) subs.createIndex('status', 'status');
      if (!db.objectStoreNames.contains('media')) db.createObjectStore('media');
      if (!db.objectStoreNames.contains('recChunks')) db.createObjectStore('recChunks', { keyPath: ['rec', 'i'] });
      if (!db.objectStoreNames.contains('sounds')) db.createObjectStore('sounds', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbp = null; reject(req.error); };
    req.onblocked = () => reject(new Error('DB_BLOCKED'));
  });
  return dbp;
}

function run(store, mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    let out;
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
    out = fn(tx.objectStore(store), tx);
  })).then((v) => v);
}
const wrap = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

export const db = {
  async get(store, key) { let r; await run(store, 'readonly', (s) => { r = wrap(s.get(key)); }); return r; },
  async put(store, value, key) { await run(store, 'readwrite', (s) => { s.put(value, key); }); },
  async del(store, key) { await run(store, 'readwrite', (s) => { s.delete(key); }); },
  async all(store) { let r; await run(store, 'readonly', (s) => { r = wrap(s.getAll()); }); return r; },
  async keys(store) { let r; await run(store, 'readonly', (s) => { r = wrap(s.getAllKeys()); }); return r; },
  async clear(store) { await run(store, 'readwrite', (s) => { s.clear(); }); },
  async getMany(store, keys) { const out = []; await run(store, 'readonly', (s) => { for (const k of keys) out.push(wrap(s.get(k))); }); return Promise.all(out); },
  // all chunks of one recording, in order
  async chunks(rec) {
    let r;
    await run('recChunks', 'readonly', (s) => { r = wrap(s.getAll(IDBKeyRange.bound([rec, 0], [rec, Number.MAX_SAFE_INTEGER]))); });
    return r;
  },
  async delChunks(rec) {
    await run('recChunks', 'readwrite', (s) => { s.delete(IDBKeyRange.bound([rec, 0], [rec, Number.MAX_SAFE_INTEGER])); });
  },
};

export const kv = {
  get: (k) => db.get('kv', k),
  set: (k, v) => db.put('kv', v, k),
  del: (k) => db.del('kv', k),
};

// Cached copies of server data so the app keeps working offline.
export const cache = {
  async get(k) { const r = await db.get('cache', k); return r ? r.value : null; },
  set: (k, value) => db.put('cache', { value, at: Date.now() }, k),
};

// Turn a low-level storage error into words a participant understands.
export function storageProblem(e) {
  const msg = String((e && (e.name + ' ' + e.message)) || e);
  if (/Quota/i.test(msg)) return { full: true, text: 'Your phone is running low on storage, so this could not be saved safely. Free up some space (delete old videos or apps) and try again.' };
  if (/NO_IDB|SecurityError|InvalidState|UnknownError/i.test(msg)) return { full: false, text: 'This browser is not letting the app save files on your phone (private browsing can do this). Please open JOTA-JOTI in a normal browser window or add it to your home screen.' };
  return { full: false, text: 'The app could not save this on your phone. Please try again.' };
}

export async function requestPersistence() {
  try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch { /* optional */ }
  return false;
}
export async function storageEstimate() {
  try { if (navigator.storage && navigator.storage.estimate) return await navigator.storage.estimate(); } catch { /* optional */ }
  return null;
}
