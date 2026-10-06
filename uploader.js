// The upload queue. Runs by itself: no retry buttons needed.
//  * one post at a time, in the order they were taken
//  * each media file uploads in one request; the server confirms its final byte count
//  * the phone's copy is deleted only after the server says "UPLOADED" (a real acknowledgement)
//  * sending the same post twice is harmless: the server recognises the same id
import { api, putChunk, ensureRegistered, ApiError } from './api.js';
import { db } from './db.js';
import { getSub, patchSub, finishUploaded, finishBackupOnly, getMedia, getThumb, getAudio, events as subEvents } from './submissions.js';
import { backupEnabled, fallbackToDrive, notifyBackup } from './backup.js';
import { resetRegistration } from './identity.js';
import { debug } from './debug.js';

export const events = new EventTarget();
const emit = (type, detail) => events.dispatchEvent(new CustomEvent(type, { detail }));

let running = false;
let timer = null;
let started = false;
export const state = { current: null, progress: 0 };

export function start() {
  if (started) return; started = true;
  window.addEventListener('online', () => { resetBackoff().then(kick); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') kick(); });
  window.addEventListener('jota-debug', kick);
  subEvents.addEventListener('change', () => { if (!running) kick(); });
  setInterval(kick, 20000);
  kick();
}

async function resetBackoff() {
  for (const s of await db.all('submissions')) if (s.status === 'QUEUED' && s.nextTry) await patchSub(s.id, { nextTry: 0 });
}

export function kick() {
  if (running) return;
  running = true;
  loop().finally(() => { running = false; });
}

async function pickNext() {
  const all = (await db.all('submissions')).filter((s) => s.status === 'QUEUED' || s.status === 'UPLOADING');
  all.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  const now = Date.now();
  const due = all.find((s) => (s.nextTry || 0) <= now);
  if (!due && all.length) {
    const wake = Math.min(...all.map((s) => s.nextTry || 0)) - now;
    clearTimeout(timer); timer = setTimeout(kick, Math.max(1000, Math.min(wake, 60000)));
  }
  return due || null;
}

async function loop() {
  for (let guard = 0; guard < 500; guard++) {
    const next = await pickNext();
    if (!next) break;
    await uploadOne(next.id);
  }
  state.current = null; emit('idle');
}

const backoff = (n) => Math.min(60000, 2000 * 2 ** Math.min(n, 5)) + Math.random() * 1000;

async function uploadOne(id) {
  let sub = await getSub(id);
  if (!sub || (sub.status !== 'QUEUED' && sub.status !== 'UPLOADING')) return;
  state.current = id; state.progress = sub.progress || 0;
  sub = await patchSub(id, { status: 'UPLOADING', userMessage: sub.backupStatus === 'RETRY' ? 'Saving to Google Drive…' : 'Uploading…' });
  emit('progress', { id, progress: sub.progress || 0 });
  try {
    const blob = await getMedia(id);
    if (sub.backupStatus === 'RETRY') {
      const outcome = await driveFallback(id, sub, blob, new Error('Retrying Google Drive backup'));
      if (outcome === 'done' || outcome === 'pending') return;
    }
    await ensureRegistered();
    if (!blob) throw new ApiError('The saved file is missing from this phone.', { status: 400, code: 'LOCAL_MISSING' });

    let st = await api('/api/submissions', { method: 'POST', isUpload: true, body: {
      id, mediaType: sub.mediaType, mime: sub.mime, size: blob.size, duration: sub.duration, capturedAt: sub.capturedAt,
      challengeId: sub.challengeId, soundKind: sub.soundKind, soundId: sub.soundId, soundLabel: sub.soundLabel, caption: sub.caption,
      latitude: sub.latitude, longitude: sub.longitude, accuracy: sub.accuracy } });

    if (st.uploadStatus !== 'UPLOADED') {
      const thumb = !st.hasThumb && sub.hasThumb ? await getThumb(id) : null;
      if (thumb) await putChunk(`/api/submissions/${id}/thumb`, thumb, { contentType: 'image/jpeg' }).catch((e) => { if (!(e instanceof ApiError) || e.retryable) throw e; });
      const audio = !st.hasAudio && sub.hasAudio ? await getAudio(id) : null;
      if (audio) await putChunk(`/api/submissions/${id}/audio`, audio, { contentType: audio.type.split(';')[0] || 'audio/mpeg' }).catch((e) => { if (!(e instanceof ApiError) || e.retryable) throw e; });

      for (let round = 0; round < 4; round++) {
        const chunk = st.chunkSize;
        const total = Math.ceil(blob.size / chunk);
        const have = new Set(st.parts || []);
        let done = have.size * chunk;
        for (let n = 1; n <= total; n++) {
          if (have.has(n)) continue;
          const piece = blob.slice((n - 1) * chunk, Math.min(blob.size, n * chunk));
          await putChunk(`/api/submissions/${id}/parts/${n}`, piece, {
            onProgress: (loaded) => setProgress(id, Math.min(0.99, (done + loaded) / blob.size)),
          });
          done += piece.size;
          setProgress(id, Math.min(0.99, done / blob.size));
        }
        try {
          st = await api('/api/submissions/' + id + '/complete', { method: 'POST', isUpload: true });
          break;
        } catch (e) {
          if (e instanceof ApiError && e.code === 'MISSING_PARTS' && round < 3) { st = await api(`/api/submissions/${id}/status`); continue; }
          throw e;
        }
      }
    }
    if (st.uploadStatus !== 'UPLOADED') throw new ApiError('Server has not confirmed the upload yet', { status: 503 });
    await finishUploaded(id);
    // The Google backup worker pulls the confirmed Supabase file into Drive. The site stays responsive.
    notifyBackup(id).catch(() => {});
    emit('uploaded', { id, storage: 'SUPABASE' });
  } catch (e) {
    let savedBlob = null;
    try { savedBlob = await getMedia(id); } catch { /* file may be unavailable */ }
    await handleError(id, e, savedBlob);
  } finally {
    state.current = null;
  }
}

let lastProgressWrite = 0;
function setProgress(id, p) {
  state.progress = p; emit('progress', { id, progress: p });
  const now = Date.now();
  if (now - lastProgressWrite > 1500) { lastProgressWrite = now; patchSub(id, { progress: p }).catch(() => {}); }
}

function looksLikeStorageFull(e) {
  if (!e) return false;
  const text = `${e.code || ''} ${e.message || ''}`.toLowerCase();
  return e.status === 413 || e.status === 507 || /quota|storage|storage limit|capacity|payload too large|too big/.test(text);
}

async function driveFallback(id, sub, mediaBlob, cause) {
  if (!backupEnabled() || !mediaBlob || mediaBlob.size > 30 * 1024 * 1024) return false;
  try {
    const thumb = sub.hasThumb ? await getThumb(id) : null;
    const audio = sub.hasAudio ? await getAudio(id) : null;
    await fallbackToDrive({ submission: sub, media: mediaBlob, thumb, audio });
    // Apps Script uses no-cors, so the browser cannot inspect its response. Confirm success
    // through Supabase before deleting the local copy. If confirmation does not arrive,
    // keep the media and retry Drive only rather than risking data loss.
    for (let attempt = 0; attempt < 8; attempt++) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        const st = await api(`/api/submissions/${id}/status`);
        if (st.backupStatus === 'DONE' && st.storageProvider === 'DRIVE') {
          await finishBackupOnly(id);
          emit('uploaded', { id, storage: 'DRIVE', cause: String(cause && cause.message || cause || 'storage full') });
          return 'done';
        }
      } catch { /* keep waiting; the next queue pass can try again */ }
    }
    await patchSub(id, { status: 'QUEUED', backupStatus: 'RETRY', nextTry: Date.now() + 60000, userMessage: 'Saved on this phone. Waiting for Google Drive backup…' }).catch(() => {});
    emit('waiting', { id });
    return 'pending';
  } catch (fallbackError) {
    await patchSub(id, { status: 'QUEUED', backupStatus: 'RETRY', nextTry: Date.now() + 60000, userMessage: 'Saved on this phone. Google Drive backup will retry.', lastError: `Drive backup: ${String(fallbackError.message || fallbackError).slice(0, 180)}` }).catch(() => {});
    return false;
  }
}

async function handleError(id, e, savedBlob = null) {
  const sub = await getSub(id);
  if (!sub) return;
  const err = e instanceof ApiError ? e : new ApiError(String(e && e.message || e), { network: true });
  if (err.status === 401 || err.code === 'UNKNOWN_PARTICIPANT') { // server does not know this phone yet (new database?): register again
    await resetRegistration();
    await patchSub(id, { status: 'QUEUED', nextTry: Date.now() + 1500, userMessage: 'Saved on this phone. Reconnecting…' });
    return;
  }
  if (looksLikeStorageFull(err) && savedBlob) {
    const subNow = await getSub(id);
    if (subNow) {
      const outcome = await driveFallback(id, subNow, savedBlob, err);
      if (outcome === 'done' || outcome === 'pending') return;
    }
  }
  if (err.retryable) {
    const attempts = (sub.attempts || 0) + 1;
    const offline = navigator.onLine === false || err.network;
    await patchSub(id, {
      status: 'QUEUED', attempts, nextTry: Date.now() + backoff(attempts), lastError: String(err.message).slice(0, 200),
      userMessage: offline ? 'Saved on this phone. Waiting for internet…' : 'Saved on this phone. The server is busy, trying again soon…',
    });
    emit('waiting', { id });
    return;
  }
  // The server said no and retrying will not change that. Keep the file, tell the organiser.
  const friendly = ({
    BAD_CONTENT: 'The server did not accept this file. It is still saved on your phone.',
    LOCAL_MISSING: 'This post lost its file on your phone. Please take it again.',
  })[err.code] || (err.status === 413 ? 'This file is too big for the server. It is still saved on your phone.' : 'The server could not accept this post. It is still saved on your phone and the organisers can see the problem.');
  await patchSub(id, { status: 'FAILED', userMessage: friendly, lastError: `${err.status} ${err.message}`.slice(0, 200) });
  try { await api(`/api/submissions/${id}/report`, { method: 'POST', body: { error: `${err.status} ${err.code || ''} ${err.message}` } }); } catch { /* best effort */ }
  emit('failed', { id });
}

export { debug };
