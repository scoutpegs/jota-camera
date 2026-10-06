// The camera itself: preview, photo, video (with sound mixed in), torch, zoom, and crash-safe recording.
import { db, kv } from './db.js';
import { buildRecordingAudio } from './audio.js';
import { debug } from './debug.js';
import { sleep, uuid } from './util.js';

export function pickVideoMime() {
  if (!window.MediaRecorder) return '';
  // MP4 first: plays everywhere, seeks properly, is easy for the organiser to edit. WebM only if the phone cannot do MP4.
  const list = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4',
    'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return list.find((m) => MediaRecorder.isTypeSupported(m)) || '';
}

export class CameraError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; } // kind: denied | none | busy | unsupported | other
}

function explain(e) {
  const n = e && e.name;
  if (n === 'NotAllowedError' || n === 'SecurityError' || n === 'PermissionDeniedError') return new CameraError('denied', 'Camera permission was blocked.');
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return new CameraError('none', 'No camera was found on this device.');
  if (n === 'NotReadableError' || n === 'AbortError') return new CameraError('busy', 'The camera is being used by another app.');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return new CameraError('unsupported', 'This browser cannot use the camera. Try Safari on iPhone or Chrome on Android.');
  return new CameraError('other', 'The camera could not start.');
}

export class Camera {
  constructor(video) {
    this.video = video; this.stream = null; this.facing = 'environment';
    this.caps = { torch: false, zoom: null, flip: false };
    this.torchOn = false; this.wake = null; this.session = null;
  }
  get active() { return !!this.stream && this.stream.getVideoTracks().some((t) => t.readyState === 'live'); }

  async start(facing = this.facing) {
    this.stopStream();
    if (debug.get('noCamera')) throw new CameraError('denied', 'Camera permission was blocked.');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw explain(null);
    this.facing = facing;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    } catch (e) {
      try { // some phones refuse the size hints: ask for any camera
        this.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      } catch (e2) { throw explain(e2); }
    }
    this.video.srcObject = this.stream;
    this.video.muted = true; this.video.playsInline = true;
    try { await this.video.play(); } catch { /* autoplay hiccup: the stream still works */ }
    const track = this.stream.getVideoTracks()[0];
    const settings = track.getSettings ? track.getSettings() : {};
    this.facing = settings.facingMode || facing;
    const c = track.getCapabilities ? track.getCapabilities() : {};
    this.caps.torch = !!c.torch;
    this.caps.zoom = c.zoom && c.zoom.max > c.zoom.min ? { min: c.zoom.min, max: c.zoom.max, step: c.zoom.step || 0.1, value: settings.zoom || c.zoom.min } : null;
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      this.caps.flip = devs.filter((d) => d.kind === 'videoinput').length > 1;
    } catch { this.caps.flip = false; }
    this.torchOn = false;
    return this.caps;
  }

  get mirrored() { return this.facing === 'user'; }

  stopStream() {
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
    this.releaseWake();
  }
  stop() { if (this.session) this.session.stop(); this.stopStream(); }

  async flip() { return this.start(this.facing === 'user' ? 'environment' : 'user'); }

  async setTorch(on) {
    const track = this.stream && this.stream.getVideoTracks()[0];
    if (!track || !this.caps.torch) return false;
    try { await track.applyConstraints({ advanced: [{ torch: !!on }] }); this.torchOn = !!on; return true; } catch { return false; }
  }
  async setZoom(v) {
    const track = this.stream && this.stream.getVideoTracks()[0];
    if (!track || !this.caps.zoom) return;
    try { await track.applyConstraints({ advanced: [{ zoom: v }] }); this.caps.zoom.value = v; } catch { /* ignore */ }
  }

  async wakeLock() { try { if (navigator.wakeLock) this.wake = await navigator.wakeLock.request('screen'); } catch { /* optional */ } }
  releaseWake() { try { this.wake && this.wake.release(); } catch { /* ignore */ } this.wake = null; }

  /* ---- photo ---- */
  async photo() {
    const v = this.video;
    if (!v.videoWidth) throw new CameraError('other', 'The camera is not ready yet.');
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth; canvas.height = v.videoHeight;
    canvas.getContext('2d').drawImage(v, 0, 0);
    const blob = await toBlob(canvas, 'image/jpeg', 0.92);
    if (!blob) throw new CameraError('other', 'The photo could not be created.');
    return { blob, thumb: await this.makeThumb(), mime: 'image/jpeg', width: canvas.width, height: canvas.height };
  }
  async makeThumb() {
    const v = this.video;
    if (!v.videoWidth) return null;
    const scale = 480 / Math.max(v.videoWidth, v.videoHeight);
    const c = document.createElement('canvas');
    c.width = Math.round(v.videoWidth * scale); c.height = Math.round(v.videoHeight * scale);
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    return toBlob(c, 'image/jpeg', 0.72);
  }

  /* ---- video ----
     Every second of video is also written to IndexedDB while recording, so even if the phone dies mid-recording
     the footage so far can be recovered the next time the app opens. */
  async record({ soundBlob = null, micMode = 'mix', maxSeconds = 60, bitrate = 2500000, meta = {}, onTick }) {
    if (!this.active) throw new CameraError('other', 'The camera is not running.');
    const mime = pickVideoMime();
    if (!window.MediaRecorder) throw new CameraError('unsupported', 'This browser cannot record video.');
    const audio = await buildRecordingAudio({ soundBlob, micMode });
    const tracks = [...this.stream.getVideoTracks()];
    if (audio.track) tracks.push(audio.track);
    const recId = uuid();
    const subId = meta.subId || uuid();
    let rec;
    try {
      rec = new MediaRecorder(new MediaStream(tracks), { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: bitrate, audioBitsPerSecond: 128000 });
    } catch { rec = new MediaRecorder(new MediaStream(tracks)); }
    const type = (rec.mimeType || mime || 'video/mp4').split(';')[0];
    const chunks = []; let i = 0, persistProblem = false;
    await kv.set('activeRec', { recId, subId, type, startedAt: new Date().toISOString(), meta }).catch(() => { persistProblem = true; });
    rec.ondataavailable = (e) => {
      if (!e.data || !e.data.size) return;
      chunks.push(e.data);
      db.put('recChunks', { rec: recId, i: i++, blob: e.data }).catch(() => { persistProblem = true; });
    };
    const t0 = performance.now();
    let finished = false, resolveDone;
    const done = new Promise((r) => { resolveDone = r; });
    const finish = async () => {
      if (finished) return; finished = true;
      clearInterval(tick); audio.cleanup(); this.session = null; this.releaseWake();
      const duration = (performance.now() - t0) / 1000;
      const blob = new Blob(chunks, { type });
      resolveDone({ blob, mime: type, duration, subId, noAudio: !audio.track || (audio.noMic && !soundBlob), noMic: audio.noMic, persistProblem });
      // the finished video is saved as a draft by the caller; only then is the safety copy removed (see clearActiveRec)
      this.lastRecId = recId;
    };
    rec.onstop = finish;
    rec.onerror = finish;
    const tick = setInterval(() => {
      const s = (performance.now() - t0) / 1000;
      onTick && onTick(s);
      if (s >= maxSeconds) stop();
    }, 200);
    const stop = () => { if (rec.state !== 'inactive') { try { rec.stop(); } catch { finish(); } } else finish(); };
    rec.start(1000);
    audio.begin();
    this.wakeLock();
    this.session = { stop, done, subId, recId };
    // a small picture for the post list, taken a moment into the recording
    this.session.thumb = sleep(700).then(() => this.makeThumb());
    return this.session;
  }
}

export async function clearActiveRec(recId) {
  try { await db.delChunks(recId); } catch { /* ignore */ }
  try { const a = await kv.get('activeRec'); if (a && a.recId === recId) await kv.del('activeRec'); } catch { /* ignore */ }
}

// Called at start-up: was a recording cut short (phone died, browser killed)? Hand back what was saved.
export async function recoverInterruptedRecording() {
  let a;
  try { a = await kv.get('activeRec'); } catch { return null; }
  if (!a) return null;
  const chunks = await db.chunks(a.recId);
  if (!chunks.length) { await clearActiveRec(a.recId); return null; }
  const blob = new Blob(chunks.map((c) => c.blob), { type: a.type });
  return { blob, mime: a.type, subId: a.subId, meta: a.meta || {}, startedAt: a.startedAt, recId: a.recId };
}

function toBlob(canvas, type, q) { return new Promise((res) => canvas.toBlob(res, type, q)); }
