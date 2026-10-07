// The Sounds sheet: browse/search the organiser's library, your own sounds, and record or add a custom sound.
import { el, icon, sheet, fmtClock, toast, choose } from './util.js';
import { cfg } from './config.js';
import { fetchSounds, getSoundBlob, localSoundIds, listMySounds, saveCustomSound, deleteLocalSound, CustomRecorder, audioLength } from './audio.js';

export function openSounds({ current } = {}) {
  return new Promise((resolve) => {
    let s, result, tab = 'all', offset = 0, loading = false;
    let player = null, playingId = null, localIds = new Set();
    const stopPlayer = () => { if (player) { player.pause(); URL.revokeObjectURL(player.src); player = null; } playingId = null; };

    const search = el('input', { class: 'input', type: 'search', placeholder: 'Search sounds', 'aria-label': 'Search sounds' });
    const tabs = el('div', { class: 'tabs', role: 'group', 'aria-label': 'Sound categories' });
    const list = el('div', { 'aria-live': 'polite' });
    const msg = el('div');
    const body = el('div', {}, el('h1', {}, 'Sounds'), current ? el('div', { class: 'notice ok' }, `Using: ${current.title} `, el('button', { class: 'link', onclick: () => finish({ action: 'clear' }) }, 'Remove sound')) : null, search, tabs, msg, list);
    s = sheet(body, { label: 'Sounds', onClose: () => { stopPlayer(); resolve(result); } });
    function finish(r) { result = r; s.close(); }

    let categories = [];
    function drawTabs() {
      const names = [['all', 'All'], ...categories.map((c) => [c, c]), ['mine', 'My sounds']];
      if (cfg.allowCustomSounds || cfg.allowAudioUploads) names.push(['custom', 'Custom']);
      tabs.replaceChildren(...names.map(([k, label]) => el('button', { 'aria-pressed': String(tab === k), onclick: () => { tab = k; offset = 0; stopPlayer(); drawTabs(); render(true); } }, label)));
    }

    async function useSound(snd) {
      msg.replaceChildren(el('p', { class: 'muted' }, 'Saving this sound on your phone…'));
      try { await getSoundBlob(snd); finish({ action: 'use', sound: { id: snd.id, title: snd.title, artist: snd.artist || '', kind: snd.kind || 'library', duration: snd.duration || 0 } }); }
      catch (e) { msg.replaceChildren(el('div', { class: 'notice bad' }, e.message)); }
    }
    async function toggle(snd, btn) {
      if (playingId === snd.id) { stopPlayer(); render(false); return; }
      stopPlayer();
      try {
        const blob = await getSoundBlob(snd);
        player = new Audio(URL.createObjectURL(blob)); playingId = snd.id;
        player.onended = () => { stopPlayer(); render(false); };
        await player.play(); render(false);
      } catch (e) { stopPlayer(); msg.replaceChildren(el('div', { class: 'notice bad' }, e.message || 'Could not play that sound.')); }
    }

    const row = (snd, { mine } = {}) => el('div', { class: 'list-item' },
      el('div', { class: 'art' }, snd.artworkUrl ? el('img', { src: snd.artworkUrl, alt: '', loading: 'lazy' }) : icon('music')),
      el('div', { class: 'meta' }, el('b', {}, snd.title), el('span', {}, [snd.artist, snd.duration ? fmtClock(snd.duration) : '', localIds.has(snd.id) ? 'saved on phone' : ''].filter(Boolean).join(' · ') || snd.category || '')),
      el('button', { class: 'icon-btn', 'aria-label': (playingId === snd.id ? 'Stop preview of ' : 'Preview ') + snd.title, onclick: (e) => toggle(snd, e.currentTarget) }, icon(playingId === snd.id ? 'pause' : 'play')),
      el('button', { class: 'btn small', disabled: !!(current && current.id === snd.id), onclick: () => useSound(snd) }, current && current.id === snd.id ? 'Using' : 'Use'),
      mine ? el('button', { class: 'icon-btn', 'aria-label': 'Delete ' + snd.title, title: 'Delete sound', onclick: async () => {
        const r = await choose('Delete this sound?', `Remove “${snd.title}” from this phone?`, [{ label: 'Delete sound', value: 'delete', cls: 'danger' }, { label: 'Keep it', value: 'keep', cls: 'ghost' }]);
        if (r !== 'delete') return;
        await deleteLocalSound(snd.id);
        if (current && current.id === snd.id) finish({ action: 'clear' });
        else render(true);
      } }, icon('close')) : null);

    async function render(reset) {
      if (tab === 'custom') return renderCustom();
      msg.replaceChildren();
      localIds = await localSoundIds();
      if (tab === 'mine') {
        const mine = await listMySounds();
        list.replaceChildren(...(mine.length ? mine.map((m) => row({ ...m, artworkUrl: null }, { mine: true })) : [el('p', { class: 'muted' }, 'Sounds you record or add will show up here.')]));
        return;
      }
      if (loading) return; loading = true;
      if (reset) { offset = 0; list.replaceChildren(el('p', { class: 'muted' }, 'Loading sounds…')); }
      try {
        const r = await fetchSounds({ q: search.value.trim(), category: tab === 'all' ? '' : tab, offset });
        if (r.categories.length && r.categories.join() !== categories.join()) { categories = r.categories; drawTabs(); }
        if (reset) list.replaceChildren();
        if (r.offline) msg.replaceChildren(el('div', { class: 'notice' }, 'You are offline. Showing the sounds saved on this phone.'));
        if (!r.sounds.length && reset) list.append(el('p', { class: 'muted' }, search.value ? 'No sounds match that search.' : 'No sounds have been added yet.'));
        r.sounds.forEach((x) => list.append(row(x)));
        list.querySelectorAll('.more').forEach((n) => n.remove());
        if (r.more) { offset += r.sounds.length; list.append(el('button', { class: 'btn ghost block more', onclick: () => render(false) }, 'Load more')); }
      } catch (e) { list.replaceChildren(el('div', { class: 'notice bad' }, 'Could not load sounds. ' + e.message)); }
      loading = false;
    }

    function renderCustom() {
      msg.replaceChildren();
      const max = cfg.maxCustomAudioSeconds;
      const box = el('div', { class: 'stack' });
      list.replaceChildren(box);
      if (!cfg.allowCustomSounds && !cfg.allowAudioUploads) { box.append(el('p', { class: 'muted' }, 'Custom sounds are switched off for this competition.')); return; }
      let rec, recorded;
      const timeEl = el('div', { class: 'big-time', 'aria-live': 'off' }, '00:00');
      const status = el('p', { class: 'muted small', style: { textAlign: 'center' } }, `Up to ${max} seconds.`);
      const actions = el('div', { class: 'stack' });
      const draw = (state) => {
        actions.replaceChildren();
        if (state === 'idle') {
          if (cfg.allowCustomSounds) actions.append(el('button', { class: 'btn block', onclick: start }, el('span', { class: 'rec-dot' }), 'Start recording'));
          if (cfg.allowAudioUploads) {
            const input = el('input', { type: 'file', accept: 'audio/*', class: 'sr', onchange: fromFile });
            actions.append(el('button', { class: 'btn ghost block', onclick: () => input.click() }, 'Use an audio file'), input);
          }
        } else if (state === 'recording') actions.append(el('button', { class: 'btn block', onclick: stop }, 'Stop'));
        else if (state === 'done') {
          let p;
          actions.append(
            el('button', { class: 'btn ghost block', onclick: (e) => { if (p) { p.pause(); p = null; return; } p = new Audio(URL.createObjectURL(recorded.blob)); p.onended = () => { p = null; }; p.play(); } }, 'Play'),
            el('button', { class: 'btn block', onclick: async () => {
              const snd = await saveCustomSound({ blob: recorded.blob, title: 'My sound ' + new Date().toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }), duration: recorded.duration });
              finish({ action: 'use', sound: snd });
            } }, 'Use sound'),
            el('button', { class: 'btn ghost block', onclick: () => { timeEl.textContent = '00:00'; draw('idle'); } }, 'Retake'));
        }
      };
      async function start() {
        status.textContent = 'Starting the microphone…';
        rec = new CustomRecorder(max);
        try {
          await rec.start((t) => { timeEl.textContent = fmtClock(t); if (t >= max) stop(); });
          status.textContent = 'Recording… Microphone access is used to record your custom sound.'; draw('recording');
        } catch (e) {
          status.replaceChildren('Microphone is blocked. Allow it in your browser or phone settings, then try again.');
          draw('idle');
        }
      }
      let stopping = false;
      async function stop() {
        if (stopping) return; stopping = true;
        recorded = await rec.stop(); stopping = false;
        timeEl.textContent = fmtClock(recorded.duration); status.textContent = 'Happy with it?'; draw('done');
      }
      async function fromFile(e) {
        const f = e.target.files[0]; if (!f) return;
        const len = await audioLength(f);
        if (!len) { status.textContent = 'That file could not be read as audio.'; return; }
        if (len > max + 0.5) { status.textContent = `That clip is ${Math.round(len)} seconds. The limit is ${max} seconds.`; return; }
        recorded = { blob: f, duration: len }; timeEl.textContent = fmtClock(len); status.textContent = f.name; draw('done');
      }
      box.append(el('p', { class: 'muted small' }, 'Record your own sound or use an audio file. It plays under your video.'), timeEl, status, actions);
      draw('idle');
    }

    search.addEventListener('input', () => { clearTimeout(search._t); search._t = setTimeout(() => { if (tab === 'custom' || tab === 'mine') tab = 'all'; drawTabs(); render(true); }, 250); });
    drawTabs(); render(true);
  });
}
