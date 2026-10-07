// The camera itself: preview, photo, video (with sound mixed in), torch, zoom, and crash-safe recording.
import { db, kv } from './db.js';
import { buildRecordingAudio } from './audio.js';
import { debug } from './debug.js';
import { sleep, uuid } from './util.js';

export function pickVideoMime() {
  if (!window.MediaRecorder) return '';
  // Prefer formats that are natively friendly to the current browser. Safari/iOS has
  // stronger MP4 support, while Chromium/Android generally prefers WebM. Always let
  // MediaRecorder decide what is actually supported instead of guessing.
  const ua = navigator.userAgent || '';
  const safariLike = /Safari\//.test(ua) && !/Chrome|CriOS|Android|Edg\//.test(ua);
  const iosLike = /iPhone|iPad|iPod/.test(ua);
  const lists = safariLike || iosLike
    ? [
        // Modern iOS/iPadOS Safari supports WebM and it avoids known portrait/rotation
        // edge cases seen with some MP4 MediaRecorder variants. Older iOS falls through
        // automatically to MP4 because isTypeSupported() rejects WebM there.
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=vp9,opus',
        'video/webm',
        'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
        'video/mp4;codecs=avc1',
        'video/mp4',
      ]
    : [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
        'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
        'video/mp4;codecs=avc1',
        'video/mp4',
      ];
  return lists.find((m) => MediaRecorder.isTypeSupported(m)) || '';
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


export async function requestMediaPermissions() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new CameraError('unsupported', 'This browser cannot use the camera.');
  }

  let combinedStream = null;
  try {
    combinedStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    try { localStorage.setItem('jota.camOK', '1'); localStorage.setItem('jota.micOK', '1'); } catch { /* ignore */ }
    combinedStream.getTracks().forEach((t) => t.stop());
    return { camera: true, microphone: true };
  } catch (combinedError) {
    combinedStream?.getTracks().forEach((t) => t.stop());
  }

  let camera = false;
  let microphone = false;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    camera = true;
    try { localStorage.setItem('jota.camOK', '1'); } catch { /* ignore */ }
    stream.getTracks().forEach((t) => t.stop());
  } catch (e) {
    const kind = explain(e);
    throw kind;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    microphone = true;
    try { localStorage.setItem('jota.micOK', '1'); } catch { /* ignore */ }
    stream.getTracks().forEach((t) => t.stop());
  } catch {
    // Microphone is optional for opening the camera. Recording will explain the limitation later.
  }
  return { camera, microphone };
}
export function coverCrop(videoWidth, videoHeight, viewWidth, viewHeight) {
  const vw = Math.max(1, Number(videoWidth) || 1), vh = Math.max(1, Number(videoHeight) || 1);
  const rw = Math.max(1, Number(viewWidth) || vw), rh = Math.max(1, Number(viewHeight) || vh);
  const sourceRatio = vw / vh, viewRatio = rw / rh;
  if (sourceRatio > viewRatio) {
    const sw = Math.max(1, Math.round(vh * viewRatio));
    return { sx: Math.round((vw - sw) / 2), sy: 0, sw, sh: vh };
  }
  const sh = Math.max(1, Math.round(vw / viewRatio));
  return { sx: 0, sy: Math.round((vh - sh) / 2), sw: vw, sh };
}

function classifyCameraLabel(label) {
  const x = String(label || '').toLowerCase();
  if (/front|face|user|facetime/.test(x)) return 'front';
  if (/ultra|wide|0[.,]?5|back|rear|environment/.test(x)) return 'back';
  return 'unknown';
}

async function enumerateLensOptions() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videos = devices.filter((d) => d.kind === 'videoinput');
    return videos.map((d) => {
      let caps = {};
      try { caps = typeof d.getCapabilities === 'function' ? (d.getCapabilities() || {}) : {}; } catch { /* optional */ }
      const label = d.label || 'Camera';
      const kind = classifyCameraLabel(label);
      const minZoom = Number(caps.zoom?.min);
      const maxZoom = Number(caps.zoom?.max);
      const ultraWide = /ultra.?wide|wide.?angle|0[.,]?5x|0[.,]?5|13mm|14mm|15mm/.test(label.toLowerCase()) || (Number.isFinite(minZoom) && minZoom <= 0.5);
      return { deviceId: d.deviceId, groupId: d.groupId || '', label, kind, ultraWide, minZoom: Number.isFinite(minZoom) ? minZoom : null, maxZoom: Number.isFinite(maxZoom) ? maxZoom : null };
    });
  } catch { return []; }
}

export class Camera {
  constructor(video) {
    this.video = video; this.stream = null; this.facing = 'environment';
    this.caps = { torch: false, zoom: null, flip: false, focus: false, stabilization: false, ultraWide: false };
    this.lenses = [];
    this.activeDeviceId = '';
    this.lensMode = 'default';
    this.torchOn = false; this.wake = null; this.session = null;
  }
  get active() { return !!this.stream && this.stream.getVideoTracks().some((t) => t.readyState === 'live'); }

  async start(arg = this.facing) {
    if (debug.get('noCamera')) throw new CameraError('denied', 'Camera permission was blocked.');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw explain(null);
    const opts = typeof arg === 'string' ? { facing: arg } : (arg || {});
    const facing = opts.facing || this.facing || 'environment';
    this.facing = facing;
    const video = {
      facingMode: { ideal: facing },
      // Prefer the camera's native 4:3-style sensor mode. On tall phones this
      // gives a wider field of view than forcing a 16:9 stream, while the actual
      // saved frame is still cropped to the exact visible viewfinder.
      width: { ideal: 1920, max: 2560 },
      height: { ideal: 1440, max: 1920 },
      frameRate: { ideal: 30, max: 60 },
      aspectRatio: { ideal: 4 / 3 },
      resizeMode: { ideal: 'none' },
    };
    if (opts.deviceId) { delete video.facingMode; video.deviceId = { exact: opts.deviceId }; }
    // Keep the existing stream alive until the new camera stream is acquired. This
    // avoids a black/empty preview when switching between the main, selfie, and
    // ultra-wide cameras. If the browser refuses a second stream while the old
    // one is active, retry once after releasing it.
    let nextStream = null;
    let firstError = null;
    try {
      nextStream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    } catch (e) {
      firstError = e;
    }
    if (!nextStream && firstError) {
      try {
        this.stopStream();
        const fallback = { video: { facingMode: { ideal: facing } }, audio: false };
        if (opts.deviceId) fallback.video = { deviceId: { exact: opts.deviceId } };
        nextStream = await navigator.mediaDevices.getUserMedia(fallback);
      } catch (e2) { throw explain(e2); }
    }
    if (!nextStream) throw explain(firstError);
    const oldStream = this.stream;
    this.stream = nextStream;
    if (oldStream) oldStream.getTracks().forEach((t) => t.stop());
    this.video.srcObject = this.stream;
    this.video.muted = true; this.video.playsInline = true; this.video.autoplay = true;
    try { await this.video.play(); } catch { /* the stream can still become ready after a user gesture */ }
    await this.waitForVideoReady(1400);
    const track = this.stream.getVideoTracks()[0];
    const settings = track.getSettings ? track.getSettings() : {};
    this.facing = settings.facingMode || facing;
    this.activeDeviceId = settings.deviceId || opts.deviceId || '';
    this.lensMode = opts.deviceId ? 'selected' : 'default';
    const c = track.getCapabilities ? track.getCapabilities() : {};
    this.caps.torch = !!c.torch;
    this.caps.focus = Array.isArray(c.focusMode) && c.focusMode.includes('continuous');
    this.caps.stabilization = Array.isArray(c.imageStabilizationMode) && c.imageStabilizationMode.length > 0;
    this.caps.zoom = c.zoom && c.zoom.max > c.zoom.min ? { min: c.zoom.min, max: c.zoom.max, step: c.zoom.step || 0.1, value: settings.zoom ?? c.zoom.min } : null;
    this.lenses = await enumerateLensOptions();
    const backs = this.lenses.filter((x) => x.kind === 'back');
    const ultra = backs.find((x) => x.ultraWide);
    const wideByTrack = !!(c.zoom && Number(c.zoom.min) <= 0.5);
    this.caps.ultraWide = !!ultra || wideByTrack;
    this.lensInfo = {
      currentLabel: String(settings.label || ''),
      facing: this.facing,
      rearCount: backs.length,
      ultraWideDetected: !!ultra || wideByTrack,
      ultraWideLabel: ultra?.label || '',
      camerasDetected: this.lenses.length,
    };
    this.caps.flip = this.lenses.length > 1 || this.facing === 'environment';
    try {
      const advanced = [];
      if (this.caps.focus) advanced.push({ focusMode: 'continuous' });
      if (Array.isArray(c.exposureMode) && c.exposureMode.includes('continuous')) advanced.push({ exposureMode: 'continuous' });
      if (Array.isArray(c.whiteBalanceMode) && c.whiteBalanceMode.includes('continuous')) advanced.push({ whiteBalanceMode: 'continuous' });
      if (advanced.length) await track.applyConstraints({ advanced });
    } catch { /* optional camera controls */ }
    try {
      if (this.caps.stabilization) {
        const modes = c.imageStabilizationMode;
        const preferred = modes.includes('high') ? 'high' : modes.includes('standard') ? 'standard' : modes[0];
        await track.applyConstraints({ advanced: [{ imageStabilizationMode: preferred }] });
      } else if ('contentHint' in track) track.contentHint = 'motion';
    } catch { /* stabilization is device-dependent */ }
    this.torchOn = false;
    return this.caps;
  }

  get mirrored() { return this.facing === 'user'; }

  async waitForVideoReady(timeout = 1400) {
    if (this.video.videoWidth && this.video.videoHeight) return true;
    return new Promise((resolve) => {
      let done = false;
      const finish = (ok) => { if (done) return; done = true; clearTimeout(timer); this.video.removeEventListener('loadedmetadata', onMeta); this.video.removeEventListener('canplay', onMeta); resolve(ok); };
      const onMeta = () => finish(!!(this.video.videoWidth && this.video.videoHeight));
      const timer = setTimeout(() => finish(false), timeout);
      this.video.addEventListener('loadedmetadata', onMeta, { once: true });
      this.video.addEventListener('canplay', onMeta, { once: true });
    });
  }

  stopStream() {
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
    this.releaseWake();
  }
  stop() { if (this.session) this.session.stop(); this.stopStream(); }

  async flip() { return this.start(this.facing === 'user' ? { facing: 'environment' } : { facing: 'user' }); }

  async useUltraWide() {
    if (this.facing === 'user') return false;
    const z = this.caps.zoom;
    if (z && Number(z.min) <= 0.5) {
      await this.setZoom(0.5);
      this.lensMode = 'ultra';
      return true;
    }
    // On browsers that expose individual rear cameras, use the device whose
    // label/capabilities identify it as an ultra-wide lens. Never guess based
    // on a generic back-camera number.
    const candidate = this.lenses.find((x) => x.kind === 'back' && x.ultraWide);
    if (!candidate) return false;
    try {
      await this.start({ deviceId: candidate.deviceId, facing: 'environment' });
      this.lensMode = 'ultra';
      if (this.caps.zoom && Number(this.caps.zoom.min) <= 0.5) await this.setZoom(0.5);
      return true;
    } catch {
      return false;
    }
  }

  async setTorch(on) {
    const track = this.stream && this.stream.getVideoTracks()[0];
    if (!track || !this.caps.torch) return false;
    try { await track.applyConstraints({ advanced: [{ torch: !!on }] }); this.torchOn = !!on; return true; } catch { return false; }
  }
  async setZoom(v) {
    const track = this.stream && this.stream.getVideoTracks()[0];
    if (!track || !this.caps.zoom) return;
    const z = this.caps.zoom;
    const target = Math.min(Number(z.max), Math.max(Number(z.min), Number(v)));
    if (!Number.isFinite(target)) return;
    this._zoomQueued = target;
    if (this._zoomBusy) return this._zoomPromise;
    this._zoomBusy = true;
    this._zoomPromise = (async () => {
      try {
        while (this._zoomQueued != null && this.stream) {
          const next = this._zoomQueued; this._zoomQueued = null;
          if (Math.abs(Number(this.caps.zoom.value) - next) < 0.01) continue;
          try { await track.applyConstraints({ advanced: [{ zoom: next }] }); this.caps.zoom.value = next; } catch { /* a rapid pinch can be rejected; the next queued value will be tried */ }
        }
      } finally { this._zoomBusy = false; this._zoomPromise = null; }
    })();
    return this._zoomPromise;
  }

  async wakeLock() { try { if (navigator.wakeLock) this.wake = await navigator.wakeLock.request('screen'); } catch { /* optional */ } }
  releaseWake() { try { this.wake && this.wake.release(); } catch { /* ignore */ } this.wake = null; }

  /* ---- photo ---- */
  async photo() {
    const v = this.video;
    if (!v.videoWidth || !v.videoHeight) await this.waitForVideoReady(1200);
    if (!v.videoWidth || !v.videoHeight) throw new CameraError('other', 'The camera is not ready yet.');
    // The preview uses object-fit: cover. Crop the captured frame using the exact same
    // viewfinder ratio so the saved photo is the picture the participant just saw.
    const rect = v.getBoundingClientRect ? v.getBoundingClientRect() : { width: v.clientWidth, height: v.clientHeight };
    const crop = coverCrop(v.videoWidth, v.videoHeight, rect.width || window.innerWidth, rect.height || window.innerHeight);
    const canvas = document.createElement('canvas');
    canvas.width = crop.sw; canvas.height = crop.sh;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new CameraError('other', 'The photo could not be created.');
    if (this.mirrored) {
      ctx.translate(canvas.width, 0); ctx.scale(-1, 1);
    }
    ctx.drawImage(v, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, crop.sw, crop.sh);
    const blob = await toBlob(canvas, 'image/jpeg', 0.92);
    if (!blob) throw new CameraError('other', 'The photo could not be created.');
    return { blob, thumb: await this.makeThumb(crop), mime: 'image/jpeg', width: canvas.width, height: canvas.height };
  }
  async makeThumb(crop = null) {
    const v = this.video;
    if (!v.videoWidth) return null;
    if (!crop) { const rect = v.getBoundingClientRect ? v.getBoundingClientRect() : { width: v.clientWidth, height: v.clientHeight }; crop = coverCrop(v.videoWidth, v.videoHeight, rect.width || v.videoWidth, rect.height || v.videoHeight); }
    const maxSide = 480, scale = Math.min(1, maxSide / Math.max(crop.sw, crop.sh));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(crop.sw * scale)); c.height = Math.max(1, Math.round(crop.sh * scale));
    const ctx = c.getContext('2d', { alpha: false });
    if (this.mirrored) { ctx.translate(c.width, 0); ctx.scale(-1, 1); }
    ctx.drawImage(v, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, c.width, c.height);
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
    const recordStream = new MediaStream(tracks);
    try {
      rec = new MediaRecorder(recordStream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: bitrate, audioBitsPerSecond: 128000 });
    } catch {
      try { rec = new MediaRecorder(recordStream); }
      catch { audio.cleanup(); throw new CameraError('unsupported', 'This phone cannot record video in a format the browser supports. You can use the device camera picker instead.'); }
    }
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
