// Posts saved on this phone. A post is saved here the moment it is captured, long before it is sent.
//   DRAFT     captured, not posted yet (kept safe if the app closes)
//   QUEUED    posted: saved on the phone, waiting to upload (the upload queue)
//   UPLOADING being sent right now
//   UPLOADED  the server confirmed it has the file (the phone's big copy is then removed)
//   FAILED    the server refused it for a reason retrying will not fix (the file is still kept)
import { db, storageProblem } from './db.js';
import { uuid } from './util.js';

export const events = new EventTarget();
const changed = (id) => events.dispatchEvent(new CustomEvent('change', { detail: { id } }));

export async function createDraft({ id = uuid(), blob, thumb, audioBlob, mediaType, mime, duration = 0, capturedAt = new Date().toISOString(), fix, challenge, sound, recovered = false }) {
  const sub = {
    id, mediaType, mime: String(mime || blob.type || '').split(';')[0], size: blob.size, duration,
    capturedAt, challengeId: challenge ? challenge.id : null, challengeName: challenge ? challenge.name : '',
    soundKind: sound ? (sound.kind || 'library') : 'none', soundId: sound && sound.kind !== 'custom' ? sound.id : null, soundLabel: sound ? sound.title : '',
    caption: '', latitude: fix ? fix.latitude : null, longitude: fix ? fix.longitude : null, accuracy: fix ? fix.accuracy : null,
    hasThumb: !!thumb, hasAudio: !!audioBlob, recovered,
    status: 'DRAFT', progress: 0, attempts: 0, nextTry: 0, userMessage: '', lastError: '', createdAt: new Date().toISOString(), uploadedAt: null, backupStatus: 'PENDING', storageProvider: 'LOCAL', backupUrl: '',
  };
  try {
    await db.put('media', blob, id);
    if (thumb) await db.put('media', thumb, id + ':thumb');
    if (audioBlob) await db.put('media', audioBlob, id + ':audio');
    await db.put('submissions', sub);
  } catch (e) {
    const p = storageProblem(e);
    const err = new Error(p.text); err.storage = true; err.full = p.full; err.cause = e;
    throw err;
  }
  changed(id);
  return sub;
}

export const getSub = (id) => db.get('submissions', id);
export const listSubs = async () => (await db.all('submissions')).sort((a, b) => (a.capturedAt < b.capturedAt ? 1 : -1));
export const getMedia = (id) => db.get('media', id);
export const getThumb = (id) => db.get('media', id + ':thumb');
export const getAudio = (id) => db.get('media', id + ':audio');

export async function patchSub(id, patch) {
  const s = await getSub(id);
  if (!s) return null;
  const next = { ...s, ...patch };
  try { await db.put('submissions', next); } catch (e) { const p = storageProblem(e); const err = new Error(p.text); err.storage = true; throw err; }
  changed(id);
  return next;
}

export async function submit(id, patch = {}) {
  return patchSub(id, { ...patch, status: 'QUEUED', attempts: 0, nextTry: 0, userMessage: 'Saved on this phone. Uploading…', submittedAt: new Date().toISOString() });
}

export async function discard(id) {
  await db.del('submissions', id);
  for (const k of [id, id + ':thumb', id + ':audio']) await db.del('media', k);
  changed(id);
}

// After the server confirmed: drop the big files, keep the little picture for the "My posts" list.
export async function finishUploaded(id) {
  await db.del('media', id);
  await db.del('media', id + ':audio');
  return patchSub(id, { status: 'UPLOADED', progress: 1, userMessage: 'Sent to the organisers', uploadedAt: new Date().toISOString(), attempts: 0, lastError: '', storageProvider: 'SUPABASE', backupStatus: 'PENDING' });
}

export async function finishBackupOnly(id) {
  await db.del('media', id);
  await db.del('media', id + ':audio');
  return patchSub(id, { status: 'UPLOADED', progress: 1, userMessage: 'Saved to the Google Drive backup', uploadedAt: new Date().toISOString(), attempts: 0, lastError: '', storageProvider: 'DRIVE', backupStatus: 'DONE' });
}

export async function retryNow(id) {
  return patchSub(id, { status: 'QUEUED', attempts: 0, nextTry: 0, userMessage: 'Trying again…', lastError: '' });
}

export async function pendingCount() {
  const all = await db.all('submissions');
  return all.filter((s) => s.status === 'QUEUED' || s.status === 'UPLOADING').length;
}
export async function draftCount() {
  return (await db.all('submissions')).filter((s) => s.status === 'DRAFT').length;
}
