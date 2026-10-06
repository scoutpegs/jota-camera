// Google Apps Script / Drive backup bridge.
// The organiser's Apps Script polls Supabase for normal backups. If Supabase storage is full,
// the browser can send the saved media directly to the Apps Script as a Drive fallback.
import { GOOGLE_BACKUP_URL, GOOGLE_BACKUP_KEY, MAX_MEDIA_BYTES } from './backend.js';

export const backupEnabled = () => !!(GOOGLE_BACKUP_URL && GOOGLE_BACKUP_KEY);

function base64(buffer) {
  const bytes = new Uint8Array(buffer);
  const step = 0x8000;
  let out = '';
  for (let i = 0; i < bytes.length; i += step) {
    out += String.fromCharCode(...bytes.subarray(i, Math.min(i + step, bytes.length)));
  }
  return btoa(out);
}

async function post(payload) {
  if (!backupEnabled()) throw new Error('Google backup is not configured.');
  let response;
  try {
    response = await fetch(GOOGLE_BACKUP_URL, {
      method: 'POST',
      redirect: 'follow',
      mode: 'no-cors',
      headers: { 'content-type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ clientKey: GOOGLE_BACKUP_KEY, ...payload }),
    });
  } catch (e) {
    throw new Error('Google backup is not reachable.');
  }
  // no-cors returns an opaque response by design. The Apps Script is idempotent by submission id.
  if (response && response.type !== 'opaque' && !response.ok) throw new Error('Google backup rejected the request.');
  return true;
}

// Fast path after a successful Supabase upload. Apps Script then fetches the file from Supabase itself.
export function notifyBackup(submissionId) {
  if (!backupEnabled() || !submissionId) return Promise.resolve(false);
  return post({ op: 'notify', submissionId }).then(() => true).catch(() => false);
}

export async function fallbackToDrive({ submission, media, thumb = null, audio = null }) {
  if (!backupEnabled()) throw new Error('Google backup is not configured.');
  if (!media || media.size < 1) throw new Error('The saved media is missing.');
  if (media.size > MAX_MEDIA_BYTES) throw new Error('This media is too large for the Google Drive fallback.');

  const files = [];
  const add = async (kind, blob, name) => {
    if (!blob || !blob.size) return;
    files.push({ kind, name, mime: blob.type || 'application/octet-stream', size: blob.size, data: base64(await blob.arrayBuffer()) });
  };
  const ext = String((submission.mime || media.type || '').split('/')[1] || 'bin').split(';')[0].replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'bin';
  await add('media', media, `${submission.id}.${ext}`);
  await add('thumb', thumb, `${submission.id}_thumb.jpg`);
  await add('audio', audio, `${submission.id}_audio.${String((audio && audio.type || 'audio/mpeg').split('/')[1] || 'bin').split(';')[0].replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'bin'}`);

  await post({ op: 'fallback', submissionId: submission.id, participantName: submission.participantName || '', mediaType: submission.mediaType || '', challengeId: submission.challengeId || '', challengeName: submission.challengeName || '', capturedAt: submission.capturedAt || '', mime: submission.mime || media.type || '', size: media.size, duration: submission.duration || 0, files });
  return true;
}

export async function ping() {
  if (!backupEnabled()) return { configured: false };
  try {
    const r = await fetch(`${GOOGLE_BACKUP_URL}?op=health&key=${encodeURIComponent(GOOGLE_BACKUP_KEY)}`, { cache: 'no-store', redirect: 'follow' });
    const text = await r.text();
    try { return JSON.parse(text); } catch { return { ok: r.ok }; }
  } catch { return { ok: false }; }
}
