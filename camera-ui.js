// The Camera tab: live preview, shutter, photo/video modes, sound, challenge chip.
import { el, icon, toast, haptic, fmtClock, choose } from './util.js';
import { cfg } from './config.js';
import { Camera, CameraError, clearActiveRec } from './camera.js';
import { getFix, startWatch, stopWatch, permissionState, supported as gpsSupported } from './location.js';
import { createDraft, listSubs, getThumb } from './submissions.js';
import { getSoundBlob } from './audio.js';
import { openSounds } from './sounds.js';
import { pickChallenge } from './challenges.js';
import { isIOS, isAndroid } from './install.js';

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
  const brandMark = el('div', { class: 'camera-brand' },
    el('img', { src: 'logo.png', alt: '' }),
    el('div', { class: 'camera-brand-copy' }, el('b', {}, 'JOTA-JOTI'), el('span', { id: 'camera-who' }, ''))
  );
  const torchBtn = el('button', { class: 'tool', id: 'torch', 'aria-label': 'Flashlight', 'aria-pressed': 'false', hidden: true, onclick: async () => {
    const ok = await cam.setTorch(!cam.torchOn); torchBtn.setAttribute('aria-pressed', String(cam.torchOn && ok)); } }, icon('torch'));
  const zoomBtn = el('button', { class: 'tool', id: 'zoom-btn', 'aria-label': 'Zoom', hidden: true, onclick: () => { zoomBar.hidden = !zoomBar.hidden; } }, icon('zoom'));
  const zoomRange = el('input', { type: 'range', 'aria-label': 'Zoom level', oninput: (e) => cam.setZoom(Number(e.target.value)) });
  const zoomBar = el('div', { class: 'zoom-bar', hidden: true }, zoomRange);
  const zoom05 = el('button', { class: 'zoom-preset', type: 'button', hidden: true, onclick: () => setPresetZoom(.5) }, '0.5×');
  const zoom1 = el('button', { class: 'zoom-preset active', type: 'button', onclick: () => setPresetZoom(1) }, '1×');
  const zoom2 = el('button', { class: 'zoom-preset', type: 'button', onclick: () => setPresetZoom(2) }, '2×');
  const zoomPresets = el('div', { class: 'zoom-presets', hidden: true, role: 'group', 'aria-label': 'Quick zoom' }, zoom05, zoom1, zoom2);
  const readout = el('div', { class: 'readout', id: 'readout', 'aria-live': 'off' }, el('i', { class: 'rd' }), el('span', { id: 'rec-time' }, '00:00'));
  const flashEl = el('div', { class: 'flash' });

  const soundLabel = el('span', {}, 'Sound');
  const soundBtn = el('button', { class: 'side-btn', id: 'sound-btn', 'aria-label': 'Choose a sound', onclick: chooseSound }, icon('music'), soundLabel);
  const flipBtn = el('button', { class: 'tool camera-flip', id: 'flip', 'aria-label': 'Switch camera', title: 'Switch camera', onclick: async () => {
    try { await cam.flip(); applyCaps(); } catch (e) { toast('Could not switch camera.', 'bad'); } } }, icon('flip'));
  const ring = el('circle', { cx: '43', cy: '43', r: '43' });
  const ringSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  ringSvg.setAttribute('class', 'ring'); ringSvg.setAttribute('viewBox', '0 0 86 86'); ringSvg.append(ring);
  const core = el('span', { class: 'core' });
  const shutter = el('button', { class: 'shutter', id: 'shutter', 'aria-label': 'Take photo. Hold to record video.', title: 'Tap for a photo · hold for video', type: 'button' }, ringSvg, core);
  const modePhoto = el('button', { id: 'mode-photo', 'aria-pressed': 'true', onclick: () => setMode('photo') }, 'PHOTO');
  const modeVideo = el('button', { id: 'mode-video', 'aria-pressed': 'false', onclick: () => setMode('video') }, 'VIDEO');
  const modes = el('div', { class: 'modes', role: 'group', 'aria-label': 'Camera mode' }, modePhoto, modeVideo);
  const gate = el('div', { class: 'cam-gate', id: 'cam-gate' });
  // Native capture fallback for browsers where getUserMedia/MediaRecorder is unavailable.
  // On supported phones this can also hand off to the OS camera picker, which is more
  // reliable than blocking the participant from capturing anything.
  const latestThumbImg = el('img', { class: 'capture-thumb-image', alt: '', hidden: true });
  const latestThumbFallback = el('span', { class: 'capture-thumb-fallback', 'aria-hidden': 'true' }, icon('posts'));
  const latestThumb = el('button', { class: 'capture-thumb', type: 'button', 'aria-label': 'Open My posts', onclick: () => app.go('posts') }, latestThumbFallback, latestThumbImg);
  const shutterStack = el('div', { class: 'shutter-stack' }, shutter, latestThumb);
  let latestThumbUrl = '';
  const nativeCapture = el('input', { type: 'file', accept: 'image/*,video/*', capture: 'environment', hidden: true, 'aria-label': 'Use device camera' });

  const stage = el('div', { class: 'cam-stage' }, video, el('div', { class: 'vf' }, el('i'), el('i'), el('i'), el('i')), flashEl, readout,
    el('div', { class: 'cam-top' },
      el('div', { class: 'camera-topline' }, brandMark, el('div', { class: 'camera-top-actions' }, flipBtn, torchBtn, zoomBtn)),
      el('div', { class: 'camera-challenge-row' }, el('div', { class: 'row' }, chip, chipX))
    ),
    zoomBar,
    zoomPresets,
    el('div', { class: 'cam-bottom' }, el('div', { class: 'camera-mode-row' }, modes), el('div', { class: 'shutter-row' }, soundBtn, shutterStack)),
    gate);
  root.append(stage, nativeCapture);

  function clearLatestThumb() {
    if (latestThumbUrl) { try { URL.revokeObjectURL(latestThumbUrl); } catch {} latestThumbUrl = ''; }
    latestThumbImg.removeAttribute('src'); latestThumbImg.hidden = true; latestThumbFallback.hidden = false; latestThumb.hidden = false;
  }
  function setLatestThumb(blob) {
    if (!blob) return;
    clearLatestThumb();
    latestThumbUrl = URL.createObjectURL(blob);
    latestThumbImg.src = latestThumbUrl;
    latestThumbImg.hidden = false; latestThumbFallback.hidden = true; latestThumb.hidden = false;
  }
  async function loadLatestThumb() {
    try {
      const recent = (await listSubs()).find((s) => s.hasThumb);
      if (!recent) return;
      const blob = await getThumb(recent.id);
      if (blob) setLatestThumb(blob);
    } catch { /* optional camera gallery preview */ }
  }

  /* ---------- state -> screen ---------- */
  function refresh() {
    const c = app.ctx.challenge;
    chipText.textContent = c ? c.name : 'No challenge';
    const meLabel = document.getElementById('camera-who');
    const me = (() => { try { return JSON.parse(localStorage.getItem('jota.identity') || 'null'); } catch { return null; } })();
    if (meLabel) meLabel.textContent = me && me.name ? `Recording as ${me.name}` : 'Camera';
    chipX.hidden = !c;
    const s = app.ctx.sound;
    document.body.classList.toggle('camera-recording', !!session);
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
    zoomBtn.hidden = !cam.active || (!cam.caps.zoom && !cam.caps.ultraWide);
    zoomPresets.hidden = !cam.active;
    if (cam.caps.zoom) { const z = cam.caps.zoom; Object.assign(zoomRange, { min: z.min, max: z.max, step: z.step, value: z.value }); }
    zoom05.hidden = !cam.caps.ultraWide;
    zoom2.hidden = !(cam.caps.zoom && Number(cam.caps.zoom.max) >= 2);
    zoomBar.hidden = true;
    zoom1.classList.toggle('active', cam.lensMode !== 'ultra');
    zoom05.classList.toggle('active', cam.lensMode === 'ultra');
    refresh();
  }

  async function setPresetZoom(multiplier) {
    const hasSeparateUltra = cam.lenses?.some((x) => x.kind === 'back' && x.ultraWide);
    // 1× and 2× mean the main rear camera when a separate ultra-wide lens is
    // active. This matches the way a phone camera normally changes lenses.
    if (multiplier >= 1 && cam.lensMode === 'ultra' && hasSeparateUltra) {
      try { await cam.start({ facing: 'environment' }); } catch { toast('The main camera could not be selected.', 'bad'); return; }
    }
    if (multiplier === .5) {
      try {
        const ok = await cam.useUltraWide();
        if (!ok) { toast('0.5× is not available on this camera.', ''); return; }
      } catch { toast('The ultra-wide camera could not be selected.', 'bad'); return; }
    } else if (cam.caps.zoom) {
      const z = cam.caps.zoom;
      const base = Math.max(1, Number(z.min) || 1);
      const target = Math.min(z.max, Math.max(z.min, base * multiplier));
      zoomRange.value = target;
      await cam.setZoom(target);
    } else if (multiplier === 1) {
      // 1× is always a valid camera state even when the browser exposes no manual zoom capability.
      cam.lensMode = 'default';
    } else {
      toast('That zoom level is not available on this camera.', '');
      return;
    }
    zoom05.classList.toggle('active', cam.lensMode === 'ultra' || multiplier === .5);
    zoom1.classList.toggle('active', multiplier === 1 && cam.lensMode !== 'ultra');
    zoom2.classList.toggle('active', multiplier === 2 && cam.lensMode !== 'ultra');
    applyCaps();
    zoomBar.hidden = false;
  }

  /* ---------- the permission gate ---------- */
  async function fallbackCapture(file) {
    if (!file) return;
    const max = cfg.maxMediaBytes || 30 * 1024 * 1024;
    if (file.size > max) { toast('That file is too large to save safely. Choose a shorter or smaller capture.', 'bad', 5500); return; }
    const mediaType = file.type.startsWith('video/') ? 'video' : file.type.startsWith('image/') ? 'photo' : '';
    if (!mediaType) { toast('Please choose a photo or video from the camera picker.', 'bad'); return; }
    busy = true;
    try {
      gate.hidden = true;
      let thumb = null;
      if (mediaType === 'photo') {
        thumb = file;
      } else {
        const src = URL.createObjectURL(file);
        try {
          const v = document.createElement('video');
          v.src = src; v.muted = true; v.playsInline = true; v.preload = 'metadata';
          await new Promise((resolve, reject) => {
            v.onloadedmetadata = () => { v.currentTime = Math.min(.25, Math.max(0, (v.duration || 1) / 10)); };
            v.onseeked = () => resolve();
            v.onerror = () => reject(new Error('Could not preview the video.'));
            setTimeout(() => resolve(), 3500);
          });
          if (v.videoWidth && v.videoHeight) {
            const maxSide = 480, scale = Math.min(1, maxSide / Math.max(v.videoWidth, v.videoHeight));
            const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(v.videoWidth * scale)); c.height = Math.max(1, Math.round(v.videoHeight * scale));
            c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
            thumb = await new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', .72));
          }
        } catch { /* video remains valid without a thumbnail */ }
        URL.revokeObjectURL(src);
      }
      const fix = await getFix().catch(() => null);
      const challenge = app.ctx.challenge;
      // The native OS camera picker cannot reliably mix an in-app sound track.
      // Do not claim a sound was attached when the fallback path cannot actually mix it.
      if (mediaType === 'video' && app.ctx.sound) toast('The device camera saved the video with its original audio. The in-app sound was not mixed on this fallback capture.', '', 5000);
      const sub = await createDraft({ blob: file, thumb, mediaType, mime: file.type || (mediaType === 'video' ? 'video/mp4' : 'image/jpeg'), fix, challenge, sound: null });
      toast('Saved. You can review it now and it will upload automatically.', 'ok');
      app.openReview(sub.id);
    } catch (e) {
      await app.saveError(e);
      gate.hidden = false;
    } finally {
      busy = false;
      nativeCapture.value = '';
    }
  }

  nativeCapture.onchange = () => fallbackCapture(nativeCapture.files && nativeCapture.files[0]);

  function showGate(kind) {
    gate.hidden = false;
    const retry = el('button', { class: 'btn block', id: 'cam-retry', onclick: startCam }, kind === 'ask' ? 'Allow camera' : 'Try again');
    const useDevice = el('button', { class: 'btn block ghost', id: 'cam-native', onclick: () => nativeCapture.click() }, 'Use device camera');
    const how = isIOS ? 'Open Settings on your iPhone or iPad, find Safari (or JOTA-JOTI if installed), and allow Camera for this site.'
      : isAndroid ? 'Tap the site controls beside the web address, open Permissions, allow Camera, then try again.'
      : 'Use the camera permission control in the address bar, choose Allow, then try again.';
    const content = {
      ask: [el('h1', {}, 'Camera'), el('p', { class: 'muted' }, 'JOTA-JOTI uses your camera so you can take competition photos and videos.'), retry, useDevice],
      loading: [el('p', { class: 'muted' }, 'Starting the camera…')],
      denied: [el('h1', {}, 'Camera is blocked'), el('p', {}, 'JOTA-JOTI can’t use the live camera yet. ' + how), retry, useDevice],
      none: [el('h1', {}, 'No camera found'), el('p', { class: 'muted' }, 'This device doesn’t seem to have a camera we can use.'), useDevice],
      busy: [el('h1', {}, 'Camera is busy'), el('p', { class: 'muted' }, 'Another app is using the camera. Close it and try again.'), retry, useDevice],
      unsupported: [el('h1', {}, 'Camera not available'), el('p', { class: 'muted' }, 'This browser cannot open the live camera. You can still use the device camera picker for a photo or video.'), useDevice],
      other: [el('h1', {}, 'The camera didn’t start'), el('p', { class: 'muted' }, 'Something went wrong starting the live camera. You can still capture with the device camera.'), retry, useDevice],
    }[kind] || [el('h1', {}, 'Camera'), useDevice];
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
      setLatestThumb(p.thumb || p.blob);
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
    shutter.classList.add('recording'); readout.classList.add('on'); document.body.classList.add('camera-recording'); haptic(20); refresh();
    busy = false;
    const s = session;
    const res = await s.done;
    session = null;
    shutter.classList.remove('recording'); readout.classList.remove('on'); document.body.classList.remove('camera-recording'); ring.style.strokeDashoffset = '270'; refresh();
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
      setLatestThumb(thumb);
      await clearActiveRec(s.recId);
      if (res.persistProblem) toast('Your phone is low on space, so keep this one safe: post it as soon as you can.', 'bad', 7000);
      else if (res.noMic && !sound) toast('The microphone is blocked, so this video has no sound.', '', 6000);
      if (leftWhileRecording || !visible) { leftWhileRecording = false; toast('Your video was saved as a draft in My posts.', 'ok'); }
      else app.openReview(sub.id);
    } catch (e) { app.saveError(e); }
  }

  /* ---------- shutter interactions ---------- */
  let pressTimer = null, pressHeld = false, pressPointerDown = false, suppressNextClick = false;
  function clearPressTimer() { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } }
  async function beginHoldRecord() {
    if (!pressPointerDown || busy || session || !cam.active) return;
    pressHeld = true;
    const fromPhoto = mode === 'photo';
    if (fromPhoto) setMode('video');
    await toggleRecord();
    if (fromPhoto) { mode = 'photo'; app.ctx.mode = 'photo'; }
    if (!pressPointerDown && session) session.stop();
  }
  shutter.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    pressPointerDown = true;
    try { shutter.setPointerCapture(e.pointerId); } catch {}
    clearPressTimer();
    pressTimer = setTimeout(() => { pressTimer = null; beginHoldRecord(); }, 340);
  });
  const finishShutterPointer = (e) => {
    if (!pressPointerDown) return;
    pressPointerDown = false;
    clearPressTimer();
    if (pressHeld) {
      if (session) session.stop();
      pressHeld = false;
      suppressNextClick = true;
      setTimeout(() => { suppressNextClick = false; }, 500);
    }
    try { shutter.releasePointerCapture(e.pointerId); } catch {}
  };
  shutter.addEventListener('pointerup', finishShutterPointer);
  shutter.addEventListener('pointercancel', finishShutterPointer);
  shutter.addEventListener('pointerleave', (e) => { if (pressPointerDown && e.pointerType !== 'mouse') finishShutterPointer(e); });
  shutter.addEventListener('click', (e) => {
    if (suppressNextClick) { e.preventDefault(); suppressNextClick = false; return; }
    onShutter();
  });
  shutter.addEventListener('contextmenu', (e) => e.preventDefault());

  /* ---------- gestures: swipe to change mode, pinch to zoom ---------- */
  const ptrs = new Map(); let swipe = null, pinch0 = null, lastTap = 0;
  stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button,input,.zoom-bar')) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 1) swipe = { x: e.clientX, y: e.clientY, t: performance.now() };
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
      if (Math.abs(dx) > 70 && Math.abs(dy) < 60) {
        if (dx < 0) setMode('video'); else setMode('photo');
      } else if (Math.abs(dx) < 12 && Math.abs(dy) < 12 && performance.now() - (swipe.t || 0) < 350 && !session && cam.caps.flip) {
        const now = performance.now();
        if (now - lastTap < 420) {
          lastTap = 0;
          flipBtn.click();
        } else lastTap = now;
      }
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
      if (cam.active) { beginLocation(); loadLatestThumb(); return; }
      if (await shouldAutoStart()) startCam(); else showGate('ask');
      loadLatestThumb();
    },
    hide() {
      visible = false;
      if (session) { leftWhileRecording = true; session.stop(); document.body.classList.remove('camera-recording'); }
      cam.stopStream();            // never leave the camera or microphone running in the background
      clearLatestThumb();
      stopWatch();
    },
    refresh,
    setMode,
  };
}
