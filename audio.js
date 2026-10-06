// Sounds: the organiser's library (downloaded on demand and kept for offline), custom sounds made on the phone,
// and the mixer that bakes the chosen sound (and optionally the microphone) into the video while it records.
import { api } from './api.js';
import { db, cache } from './db.js';
import { uuid, cleanName } from './util.js';
import { debug } from './debug.js';

/* ---------------- library ---------------- */
export async function fetchSounds({ q = '', category = '', offset = 0, limit = 30 } = {}) {
  const qs = new URLSearchParams({ limit, offset });
  if (q) qs.set('q', q);
  if (category) qs.set('category', category);
  try {
    const r = await api('/api/sounds?' + qs, { auth: false });
    if (!q && !category && offset === 0) cache.set('sounds:list', r).catch(() => {});
    return { ...r, offline: false };
  } catch (e) {
    if (!e.network && e.status !== 0 && e.status < 500) throw e;
    const c = await cache.get('sounds:list'); // offline: use the last list we saw
    const all = (c && c.sounds) || [];
    const needle = q.toLowerCase();
    const sounds = all.filter((s) => (!needle || (s.title + ' ' + s.artist).toLowerCase().includes(needle)) && (!category || s.category === category));
    return { sounds, categories: (c && c.categories) || [], more: false, offline: true };
  }
}

// The audio bytes for a sound, from this phone if we already have them.
export async function getSoundBlob(sound) {
  const local = await db.get('sounds', sound.id);
  if (local && local.blob) return local.blob;
  if (sound.kind === 'custom') throw new Error('That custom sound is no longer on this phone.');
  let blob;
  try {
    if (debug.get('offline') || debug.get('serverDown')) throw new Error('offline');
    const { soundBlob } = await import('./supa.js');
    blob = await soundBlob(sound.id);
  } catch (err) {
    const e = new Error(err && err.network || !navigator.onLine || (err && err.message === 'offline') ? 'This sound needs an internet connection the first time you use it.' : 'Could not get that sound.');
    e.needsNet = !!(err && err.network) || !navigator.onLine || (err && err.message === 'offline');
    throw e;
  }
  await db.put('sounds', { id: sound.id, title: sound.title, artist: sound.artist || '', kind: 'library', blob, duration: sound.duration || 0, savedAt: Date.now() });
  return blob;
}
export async function localSoundIds() { return new Set(await db.keys('sounds')); }
export async function listMySounds() { return (await db.all('sounds')).filter((s) => s.kind === 'custom').sort((a, b) => b.savedAt - a.savedAt); }
export async function deleteLocalSound(id) { await db.del('sounds', id); }

export async function saveCustomSound({ blob, title, duration }) {
  const s = { id: 'custom-' + uuid(), title: cleanName(title, 40) || 'My sound', artist: '', kind: 'custom', blob, duration: duration || 0, savedAt: Date.now() };
  await db.put('sounds', s);
  return { id: s.id, title: s.title, kind: 'custom', duration: s.duration };
}

/* ---------------- one shared AudioContext, unlocked by the first tap ---------------- */
let ctx = null;
export function unlockAudio() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') ctx.resume();
  } catch { /* optional */ }
  return ctx;
}
export const audioContext = () => unlockAudio();

export async function audioLength(blob) {
  try {
    const c = audioContext();
    const buf = await c.decodeAudioData(await blob.arrayBuffer());
    return buf.duration;
  } catch { return 0; }
}

/* ---------------- mixing sound + microphone into the recording ---------------- */
// Returns { track, begin(), cleanup(), noMic } -- track is the audio to add to the video.
export async function buildRecordingAudio({ soundBlob, micMode = 'mix', wantMic = true }) {
  const c = audioContext();
  let micStream = null, noMic = false;
  const needMic = wantMic && !(soundBlob && micMode === 'sound');
  if (needMic) {
    try {
      if (debug.get('noMic')) throw new Error('simulated');
      micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch { noMic = true; }
  }
  if (!soundBlob) {
    return { track: micStream ? micStream.getAudioTracks()[0] : null, begin() {}, noMic, cleanup() { micStream && micStream.getTracks().forEach((t) => t.stop()); } };
  }
  if (!c) throw new Error('This browser cannot mix sounds into a video.');
  const dest = c.createMediaStreamDestination();
  const buffer = await c.decodeAudioData(await soundBlob.arrayBuffer());
  const soundGain = c.createGain();
  soundGain.gain.value = micStream ? (micMode === 'voice' ? 0.3 : 0.8) : 1;
  const nodes = [soundGain];
  soundGain.connect(dest);
  soundGain.connect(c.destination); // so the person filming can hear it too
  let micSrc = null;
  if (micStream) {
    micSrc = c.createMediaStreamSource(micStream);
    const micGain = c.createGain(); micGain.gain.value = 1;
    micSrc.connect(micGain); micGain.connect(dest);
    nodes.push(micGain);
  }
  let src = null;
  return {
    track: dest.stream.getAudioTracks()[0], noMic,
    begin() { src = c.createBufferSource(); src.buffer = buffer; src.connect(soundGain); src.start(); },
    cleanup() {
      try { src && src.stop(); } catch { /* already stopped */ }
      [src, micSrc, ...nodes].forEach((n) => { try { n && n.disconnect(); } catch { /* ignore */ } });
      dest.stream.getTracks().forEach((t) => t.stop());
      micStream && micStream.getTracks().forEach((t) => t.stop());
    },
  };
}

/* ---------------- recording a custom sound ---------------- */
export function pickAudioMime() {
  const list = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  return list.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
}
export class CustomRecorder {
  constructor(maxSeconds) { this.max = maxSeconds; this.chunks = []; }
  async start(onTick) {
    if (debug.get('noMic')) throw Object.assign(new Error('Microphone blocked'), { name: 'NotAllowedError' });
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const mime = pickAudioMime();
    this.rec = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    this.rec.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
    this.t0 = performance.now();
    this.rec.start(500);
    this.tick = setInterval(() => {
      const s = (performance.now() - this.t0) / 1000;
      onTick && onTick(s);
      if (s >= this.max) this.stopPromise = this.stop();
    }, 200);
  }
  stop() {
    if (this.stopPromise && this.stopped) return this.stopPromise;
    clearInterval(this.tick);
    return new Promise((resolve) => {
      const finish = () => {
        this.stream.getTracks().forEach((t) => t.stop());
        const type = (this.rec.mimeType || pickAudioMime() || 'audio/webm').split(';')[0];
        resolve({ blob: new Blob(this.chunks, { type }), duration: Math.min(this.max, (performance.now() - this.t0) / 1000) });
      };
      if (this.rec.state === 'inactive') return finish();
      this.rec.onstop = finish; this.rec.stop(); this.stopped = true;
    });
  }
  cancel() { clearInterval(this.tick); try { this.rec.state !== 'inactive' && this.rec.stop(); } catch { /* ignore */ } this.stream && this.stream.getTracks().forEach((t) => t.stop()); }
}
