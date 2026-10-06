// Talking to the server. Every call goes through guard() so test mode can simulate outages.
import { identity, markRegistered, deviceId } from './identity.js';
import { debug } from './debug.js';
import { sleep } from './util.js';
import { handle, putFile } from './supa.js';

export class ApiError extends Error {
  constructor(message, { status = 0, code = '', network = false, data = null } = {}) {
    super(message); this.status = status; this.code = code; this.network = network; this.data = data;
  }
  // Worth trying again later? (no connection, server busy or having a bad moment)
  get retryable() { return this.network || this.status === 0 || this.status >= 500 || this.status === 429 || this.status === 408 || this.status === 401; }
}

async function guard(isUpload = false) {
  if (debug.get('offline') || debug.get('serverDown')) { await sleep(150); throw new ApiError('Simulated: no connection', { network: true }); }
  if (debug.get('slow')) await sleep(2500);
  if (isUpload && debug.get('storageFull')) { await sleep(150); throw new ApiError('Simulated storage quota exceeded', { status: 507, code: 'STORAGE_FULL' }); }
  if (isUpload && debug.get('failUploads')) { await sleep(150); throw new ApiError('Simulated: upload failed', { network: true }); }
}

export const authHeader = () => {
  const i = identity();
  return i ? { authorization: `Bearer ${i.id}.${i.secret}` } : {};
};

export async function api(path, { method = 'GET', body, headers = {}, auth = true, isUpload = false, signal, raw } = {}) {
  await guard(isUpload);
  return handle(path, { method, body: body !== undefined ? body : raw !== undefined ? JSON.parse(raw) : undefined });
}

// Make sure the server knows this participant. Safe to call over and over.
let registering = null;
export function ensureRegistered(force = false) {
  const i = identity();
  if (!i) return Promise.reject(new ApiError('No participant yet'));
  if (i.registered && !force) return Promise.resolve(i);
  if (!registering) {
    registering = api('/api/participants', { method: 'POST', auth: false, body: { id: i.id, secret: i.secret, name: i.name, deviceId: deviceId() } })
      .then(async () => { await markRegistered(true); return identity(); })
      .finally(() => { registering = null; });
  }
  return registering;
}

// One request per file; the progress callback fires while it uploads.
export function putChunk(path, blob, { onProgress, contentType = 'application/octet-stream' } = {}) {
  return guard(true).then(() => putFile(path, blob, { onProgress, contentType }));
}
