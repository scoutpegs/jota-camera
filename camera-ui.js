// The Camera tab: live preview, shutter, photo/video modes, sound, challenge chip.
import { el, icon, toast, haptic, fmtClock, sleep } from './util.js';
import { cfg } from './config.js';
import { Camera, CameraError, clearActiveRec } from './camera.js';
import { getFix, startWatch, stopWatch, permissionState, supported as gpsSupported, isDenied } from './location.js';
import { createDraft } from './submissions.js';
import { getSoundBlob } from './audio.js';
import { openSounds } from './sounds.js';
import { pickChallenge } from './challenges.js';
import { isIOS, isAndroid } from './install.js';
import { choose } from './util.js';

export function mountCamera(root, app) {
  root.replaceChildren();
  const video = el('video', { playsinline: '', muted: '', autoplay: '', 'aria-label': 'Camera preview' });
  const cam = new Camera(video);
  let mode = app.ctx.mode || 'photo';
  let session = null, busy = false, visible = false, leftWhileRecording = false;

  /* ---------- controls ---------- */
  const chipText = el('span', {}, 'No challenge');
  const chipX = el('button', { class: 'chip x', 'aria-label': 'Clear challenge', onclick: (e) => { e.stopPropagation(); app.ctx.challenge = null; refresh(); } }, icon('close'));
  const chip = el('button', { class: 'chip', id: 'challenge-chip', 'aria-label': 'Choose a challenge', onclick: chooseChallenge }, icon('flag'), chipText);
  const torchBtn = el('button', { class: 'tool', id: 'torch', 'aria-label': 'Flashlight', 'aria-pressed': 'false', hidden: true, onclick: async () => {
    const ok = await cam.setTorch(!cam.torchOn); torchBtn.setAttribute('aria-pressed', String(cam.torchOn && ok)); } }, icon('torch'));
  const zoomBtn = el('button', { class: 'tool', id: 'zoom-btn', 'aria-label': 'Zoom', hidden: true, onclick: () => { zoomBar.hidden = !zoomBar.hidden; } }, icon('zoom'));
  const zoomRange = el('input', { type: 'range', 'aria-label': 'Zoom level', oninput: (e) => cam.setZoom(Number(e.target.value)) });
  const zoomBar = el('div', { class: 'zoom-bar', hidden: true }, zoomRange);
  const zoom1 = el('button', { class: 'zoom-preset active', type: 'button', onclick: () => setPresetZoom(1) }, '1×');
  const zoom2 = el('button', { class: 'zoom-preset', type: 'button', onclick: () => setPresetZoom(2) }, '2×');
  const zoomPresets = el('div', { class: 'zoom-presets', hidden: true, role: 'group', 'aria-label': 'Quick zoom' }, zoom1, zoom2);
  const readout = el('div', { class: 'readout', id: 'readout', 'aria-live': 'off' }, el('i', { class: 'rd' }), el('span', { id: 'rec-time' }, '00:00'));
  const flashEl = el('div', { class: 'flash' });

  const soundLabel = el('span', {}, 'Sound');
  const soundBtn = el('button', { class: 'side-btn', id: 'sound-btn', 'aria-label': 'Choose a sound', onclick: chooseSound }, icon('music'), soundLabel);
  const flipBtn = el('button', { class: 'side-btn', id: 'flip', 'aria-label': 'Switch camera', onclick: async () => {
    try { await cam.flip(); applyCaps(); } catch (e) { toast('Could not switch camera.', 'bad'); } } }, icon('flip'), el('span', {}, 'Flip'));
  const ring = el('circle', { cx: '43', cy: '43', r: '43' });
  const ringSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  ringSvg.setAttribute('class', 'ring'); ringSvg.setAttribute('viewBox', '0 0 86 86'); ringSvg.append(ring);
  const core = el('span', { class: 'core' });
  const shutter = el('button', { class: 'shutter', id: 'shutter', 'aria-label': 'Take photo', onclick: onShutter }, ringSvg, core);
  const modePhoto = el('button', { id: 'mode-photo', 'aria-pressed': 'true', onclick: () => setMode('photo') }, 'PHOTO');
  const modeVideo = el('button', { id: 'mode-video', 'aria-pressed': 'false', onclick: () => setMode('video') }, 'VIDEO');
  const modes = el('div', { class: 'modes', role: 'group', 'aria-label': 'Camera mode' }, modePhoto, modeVideo);
  const gate = el('div', { class: 'cam-gate', id: 'cam-gate' });

  const stage = el('div', { class: 'cam-stage' }, video, el('div', { class: 'vf' }, el('i'), el('i'), el('i'), el('i')), flashEl, readout,
    el('div', { class: 'cam-top' }, el('div', { class: 'row' }, chip, chipX), el('div', { class: 'tools' }, torchBtn, zoomBtn)),
    zoomBar,
    zoomPresets,
    el('div', { class: 'cam-bottom' }, el('div', { class: 'shutter-row' }, soundBtn, shutter, flipBtn), modes),
    gate);
  root.append(stage);

  /* ---------- state -> screen ---------- */
  function refresh() {
    const c = app.ctx.challenge;
    chipText.textContent = c ? c.name : 'No challenge';
    chipX.hidden = !c;
    const s = app.ctx.sound;
    soundLabel.textContent = s ? s.title : 'Sound';
    const canPhoto = cfg.photosEnabled, canVideo = cfg.videosEnabled;
    modes.hidden = !(canPhoto && canVideo);
    if (!canPhoto && mode === 'photo') mode = 'video';
    if (!canVideo && mode === 'video') mode = 'photo';
    modePhoto.setAttribute('aria-pressed', String(mode === 'photo')); modeVideo.setAttribute('aria-pressed', String(mode === 'video'));
    shutter.classList.toggle('video', mode === 'video');
    shutter.setAttribute('aria-label', mode === 'photo' ? 'Take photo' : (session ? 'Stop recording' : 'Start recording'));
    soundBtn.classList.toggle('empty', mode !== 'video' || !!session);
    flipBtn.classList.toggle('empty', !cam.caps.flip || !!session);
    video.classList.toggle('mirror', cam.mirrored);
    app.ctx.mode = mode;
  }
  function setMode(m) {
    if (session) return;
    if (m === 'photo' && !cfg.photosEnabled) return; if (m === 'video' && !cfg.videosEnabled) return;
    mode = m; refresh();
  }
  function applyCaps() {
    torchBtn.hidden = !cam.caps.torch; torchBtn.setAttribute('aria-pressed', 'false');
    zoomBtn.hidden = !cam.caps.zoom;
    zoomPresets.hidden = !cam.caps.zoom;
    if (cam.caps.zoom) { const z = cam.caps.zoom; Object.assign(zoomRange, { min: z.min, max: z.max, step: z.step, value: z.value }); }
    zoomBar.hidden = true;
    refresh();
  }

  function setPresetZoom(multiplier) {
    const z = cam.caps.zoom;
    if (!z) return;
    const base = Math.max(1, Number(z.min) || 1);
    const target = Math.min(z.max, Math.max(z.min, base * multiplier));
    zoomRange.value = target;
    cam.setZoom(target);
    zoom1.classList.toggle('active', multiplier === 1);
    zoom2.classList.toggle('active', multiplier === 2);
  }

  /* ---------- the permission gate ---------- */
  function showGate(kind) {
    gate.hidden = false;
    const retry = el('button', { class: 'btn block', id: 'cam-retry', onclick: startCam }, kind === 'ask' ? 'Allow camera' : 'Try again');
    const how = isIOS ? 'Open Settings on your iPhone, find Safari (or JOTA-JOTI if it is on your home screen), and set Camera to Allow for this site.'
      : isAndroid ? 'Tap the lock icon next to the web address, tap Permissions, and set Camera to Allow. Then come back and try again.'
      : 'Click the camera icon in the address bar, choose Allow, then try again.';
    const content = {
      ask: [el('h1', {}, 'Camera'), el('p', { class: 'muted' }, 'JOTA-JOTI uses your camera so you can take competition photos and videos.'), retry],
      loading: [el('p', { class: 'muted' }, 'Starting the camera…')],
      denied: [el('h1', {}, 'Camera is blocked'), el('p', {}, 'JOTA-JOTI can’t use your camera yet. ' + how), retry],
      none: [el('h1', {}, 'No camera found'), el('p', { class: 'muted' }, 'This device doesn’t seem to have a camera we can use.'), retry],
      busy: [el('h1', {}, 'Camera is busy'), el('p', { class: 'muted' }, 'Another app is using the camera. Close it and try again.'), retry],
      unsupported: [el('h1', {}, 'Camera not available'), el('p', { class: 'muted' }, 'This browser can’t use the camera. Try Safari on iPhone or Chrome on Android.')],
      other: [el('h1', {}, 'The camera didn’t start'), el('p', { class: 'muted' }, 'Something went wrong starting the camera.'), retry],
    }[kind] || [];
    gate.replaceChildren(...content, kind === 'loading' ? null : el('p', { class: 'small muted', style: { marginTop: '16px' } }, 'You can still look at Challenges and the Map, and your saved posts keep uploading.'));
  }

  async function startCam() {
    showGate('loading');
    try {
      await cam.start();
      gate.hidden = true;
      try { localStorage.setItem('jota.camOK', '1'); } catch { /* ignore */ }
      applyCaps();
      beginLocation();
    } catch (e) {
      showGate(e instanceof CameraError ? e.kind : 'other');
    }
  }

  async function shouldAutoStart() {
    if (localStorage.getItem('jota.camOK')) return true;
    try { if (navigator.permissions) return (await navigator.permissions.query({ name: 'camera' })).state === 'granted'; } catch { /* unsupported */ }
    return false;
  }

  /* ---------- location: explained first, asked once ---------- */
  async function beginLocation() {
    if (cfg.locationMode === 'off' || !gpsSupported()) return;
    const st = await permissionState();
    if (st === 'granted' || (localStorage.getItem('jota.locAsked') && st !== 'denied')) return startWatch();
    if (st === 'denied' || localStorage.getItem('jota.locSkip')) return;
    const pick = await choose('Add location?', 'Location can be attached to your competition photos and videos so organisers know where they were taken. The camera works fine without it.',
      [{ label: 'Allow location', value: 'yes' }, { label: 'Not now', value: 'no', cls: 'ghost' }]);
    if (pick === 'yes') startWatch(); else { try { localStorage.setItem('jota.locSkip', '1'); } catch { /* ignore */ } }
  }

  /* ---------- choosing things ---------- */
  async function chooseChallenge() {
    if (session) return;
    const c = await pickChallenge(app.ctx.challenge && app.ctx.challenge.id);
    if (c === undefined) return;
    app.ctx.challenge = c;
    if (c && c.requiredMedia === 'photo') mode = 'photo'; else if (c && c.requiredMedia === 'video' && cfg.videosEnabled) mode = 'video';
    refresh();
  }
  async function chooseSound() {
    if (session) return;
    const r = await openSounds({ current: app.ctx.sound });
    if (!r) return;
    app.ctx.sound = r.action === 'use' ? r.sound : null;
    refresh();
  }

  /* ---------- taking things ---------- */
  function flash() { flashEl.classList.remove('go'); void flashEl.offsetWidth; flashEl.classList.add('go'); }

  function onShutter() {
    if (!cam.active) { startCam(); return; }
    if (mode === 'photo') takePhoto(); else toggleRecord();
  }

  async function takePhoto() {
    if (busy) return; busy = true;
    flash(); haptic(15);
    const fixP = getFix(); // where we are *right now*
    try {
      const p = await cam.photo();
      if (p.blob.size > (cfg.maxMediaBytes || 30 * 1024 * 1024)) {
        toast('That photo is too large to save safely. Please move closer, use less zoom, or try again.', 'bad', 5000);
        return;
      }
      const fix = await fixP;
      const sub = await createDraft({ blob: p.blob, thumb: p.thumb, mediaType: 'photo', mime: p.mime, fix, challenge: app.ctx.challenge });
      app.openReview(sub.id);
    } catch (e) { app.saveError(e); } finally { busy = false; }
  }

  async function toggleRecord() {
    if (session) { session.stop(); return; }
    if (busy) return; busy = true;
    const fixP = getFix();
    const challenge = app.ctx.challenge, sound = app.ctx.sound;
    let soundBlob = null;
    if (sound) {
      try { soundBlob = await getSoundBlob(sound); }
      catch (e) { toast(e.message || 'That sound is not available.', 'bad'); busy = false; return; }
    }
    try {
      session = await cam.record({
        soundBlob, micMode: cfg.micMode, maxSeconds: cfg.maxVideoSeconds, bitrate: cfg.videoBitsPerSecond,
        meta: { challenge: challenge && { id: challenge.id, name: challenge.name }, sound: sound && { id: sound.id, title: sound.title, kind: sound.kind } },
        onTick: (s) => {
          document.getElementById('rec-time').textContent = `${fmtClock(s)} / ${fmtClock(cfg.maxVideoSeconds)}`;
          ring.style.strokeDashoffset = String(270 * (1 - Math.min(1, s / cfg.maxVideoSeconds)));
        },
      });
    } catch (e) {
      busy = false;
      toast(e instanceof CameraError ? e.message : 'Recording could not start on this phone.', 'bad');
      return;
    }
    shutter.classList.add('recording'); readout.classList.add('on'); haptic(20); refresh();
    busy = false;
    const s = session;
    const res = await s.done;
    session = null;
    shutter.classList.remove('recording'); readout.classList.remove('on'); ring.style.strokeDashoffset = '270'; refresh();
    try {
      if (!res.blob.size) { await clearActiveRec(s.recId); toast('Nothing was recorded. Please try again.', 'bad'); return; }
      if (res.blob.size > (cfg.maxMediaBytes || 30 * 1024 * 1024)) {
        await clearActiveRec(s.recId);
        toast('That video is too large to save safely. Keep it shorter and try again.', 'bad', 5000);
        return;
      }
      const thumb = await s.thumb.catch(() => null);
      const fix = await fixP;
      const sub = await createDraft({ id: res.subId, blob: res.blob, thumb, mediaType: 'video', mime: res.mime, duration: res.duration, fix, challenge, sound });
      await clearActiveRec(s.recId);
      if (res.persistProblem) toast('Your phone is low on space, so keep this one safe: post it as soon as you can.', 'bad', 7000);
      else if (res.noMic && !sound) toast('The microphone is blocked, so this video has no sound.', '', 6000);
      if (leftWhileRecording || !visible) { leftWhileRecording = false; toast('Your video was saved as a draft in My posts.', 'ok'); }
      else app.openReview(sub.id);
    } catch (e) { app.saveError(e); }
  }

  /* ---------- gestures: swipe to change mode, pinch to zoom ---------- */
  const ptrs = new Map(); let swipe = null, pinch0 = null;
  stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button,input,.zoom-bar')) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 1) swipe = { x: e.clientX, y: e.clientY };
    else if (ptrs.size === 2 && cam.caps.zoom) { swipe = null; const [a, b] = [...ptrs.values()]; pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y), z: cam.caps.zoom.value }; }
  });
  stage.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 2 && pinch0) {
      const [a, b] = [...ptrs.values()]; const z = cam.caps.zoom;
      const v = Math.min(z.max, Math.max(z.min, pinch0.z * (Math.hypot(a.x - b.x, a.y - b.y) / pinch0.d)));
      zoomRange.value = v; cam.setZoom(v);
    }
  });
  const endPtr = (e) => {
    if (swipe && ptrs.size === 1 && ptrs.has(e.pointerId)) {
      const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
      if (Math.abs(dx) > 70 && Math.abs(dy) < 60) { if (dx < 0) setMode('video'); else setMode('photo'); }
    }
    ptrs.delete(e.pointerId); swipe = null; if (ptrs.size < 2) pinch0 = null;
  };
  stage.addEventListener('pointerup', endPtr); stage.addEventListener('pointercancel', endPtr);

  /* ---------- lifecycle ---------- */
  document.addEventListener('visibilitychange', async () => {
    if (!visible) return;
    if (document.visibilityState === 'hidden') { if (session) { leftWhileRecording = true; session.stop(); } cam.stopStream(); }
    else if (!cam.active) { if (await shouldAutoStart()) startCam(); }
  });
  window.addEventListener('jota-config', refresh);

  return {
    async show() {
      visible = true; refresh();
      if (cam.active) { beginLocation(); return; }
      if (await shouldAutoStart()) startCam(); else showGate('ask');
    },
    hide() {
      visible = false;
      if (session) { leftWhileRecording = true; session.stop(); }
      cam.stopStream();            // never leave the camera or microphone running in the background
      stopWatch();
    },
    refresh,
    setMode,
  };
}
