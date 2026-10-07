import { SUPABASE_URL as U, SUPABASE_KEY as K, GOOGLE_BACKUP_URL as BU, GOOGLE_BACKUP_KEY as BK } from './backend.js';

const $ = (s, r = document) => r.querySelector(s);
const app = $('#app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (d) => (d ? new Date(d).toLocaleString() : '');
const mb = (n) => (n / 1048576).toFixed(1) + ' MB';
const snake = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase()), v]));
const camel = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), v]));

/* ---------- sign in (organiser email + password from Supabase Authentication) ---------- */
let sess = null; try { sess = JSON.parse(sessionStorage.getItem('jj_admin') || 'null'); } catch { /* ignore */ }
const keep = (r) => { sess = { access_token: r.access_token, refresh_token: r.refresh_token, expires_at: r.expires_at || Math.floor(Date.now() / 1000) + 3000, email: r.user && r.user.email || (sess && sess.email) }; sessionStorage.setItem('jj_admin', JSON.stringify(sess)); };
async function token() {
  if (!sess) throw new Error('login');
  if (sess.expires_at * 1000 < Date.now() + 60000) {
    const r = await fetch(`${U}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: { apikey: K, 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: sess.refresh_token }) });
    if (!r.ok) { sess = null; sessionStorage.removeItem('jj_admin'); login('Please log in again.'); throw new Error('login'); }
    keep(await r.json());
  }
  return sess.access_token;
}
async function sb(url, { method = 'GET', body, headers = {}, full = false, raw = false } = {}) {
  const t = await token();
  const r = await fetch(url.startsWith('http') ? url : `${U}/rest/v1/${url}`, {
    method, headers: { apikey: K, authorization: 'Bearer ' + t, ...(body !== undefined && !raw ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
  const text = await r.text(); let d = null; try { d = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  if (!r.ok) throw new Error((d && (d.message || d.error || d.msg)) || 'Something went wrong (' + r.status + ')');
  return full ? { data: d, headers: r.headers } : d;
}
const fail = (e) => { if (e.message !== 'login') alert(e.message); };
const audit = (action, target = '', detail = '') => sb('audit_logs', { method: 'POST', body: { actor: sess.email, action, target, detail } }).catch(() => {});

async function sign(bucket, paths, download) {
  const list = [...new Set(paths.filter(Boolean))]; if (!list.length) return {};
  const r = await sb(`${U}/storage/v1/object/sign/${bucket}`, { method: 'POST', body: { expiresIn: 3600, paths: list } });
  const o = {}; for (const x of r || []) if (x.signedURL) o[x.path] = `${U}/storage/v1${x.signedURL}` + (download ? '&download=' + encodeURIComponent(download) : ''); return o;
}

function login(msg = '') {
  $('#out').hidden = true;
  app.innerHTML = `<div class="card" style="max-width:360px;margin:40px auto"><h2>Organiser login</h2><p class="muted">Use the organiser email and password you made in Supabase (Authentication → Users).</p>
  <form id="f"><input type="email" id="em" placeholder="Email" autofocus style="width:100%;margin-bottom:8px"><input type="password" id="pw" placeholder="Password" style="width:100%"><p class="err">${esc(msg)}</p><button class="btn pri">Log in</button></form></div>`;
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await fetch(`${U}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: K, 'content-type': 'application/json' }, body: JSON.stringify({ email: $('#em').value.trim(), password: $('#pw').value }) });
      const d = await r.json(); if (!r.ok) throw new Error('Wrong email or password');
      keep(d); start();
    } catch (er) { login(er.message); }
  };
}
$('#out').onclick = () => { sess = null; sessionStorage.removeItem('jj_admin'); login(); };

const TABS = { media: 'Media', challenges: 'Challenges', sounds: 'Sounds', map: 'Map pins', people: 'Participants', settings: 'Settings', backup: 'Google backup', system: 'Health & log' };
async function start() {
  try { const me = await sb('rpc/is_admin', { method: 'POST', body: {} }); if (me !== true) { sess = null; sessionStorage.removeItem('jj_admin'); return login('That account is not an organiser. Check the email you put in the SQL setup.'); } } catch (e) { return login(e.message); }
  $('#out').hidden = false;
  app.innerHTML = `<nav>${Object.entries(TABS).map(([k, v]) => `<button data-t="${k}">${v}</button>`).join('')}</nav><div id="pane"></div>`;
  app.querySelectorAll('nav button').forEach((b) => b.onclick = () => show(b.dataset.t));
  show(location.hash.slice(1) in TABS ? location.hash.slice(1) : 'media');
}
function show(t) {
  location.hash = t;
  app.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
  $('#pane').innerHTML = '<p class="muted">Loading…</p>';
  views[t]().catch(fail);
}
const pane = (h) => ($('#pane').innerHTML = h);
const save = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };
const orq = (cols, t) => `or=(${cols.map((c) => `${c}.ilike.*${t}*`).join(',')})`;
const clean = (s) => String(s || '').replace(/[,()*%\\:"']/g, ' ').trim().slice(0, 60);

const loadSheetConfigAdmin = (timeout = 7000) => new Promise((resolve) => {
  if (!BU || !BK) return resolve(null);
  const cb = `__jjAdminSheet_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const script = document.createElement('script');
  let done = false;
  let timer;
  const finish = (v) => { if (done) return; done = true; clearTimeout(timer); delete window[cb]; script.remove(); resolve(v); };
  window[cb] = (v) => finish(v && v.ok !== false ? v : null);
  script.onerror = () => finish(null);
  script.src = `${BU}?op=publicConfig&key=${encodeURIComponent(BK)}&callback=${encodeURIComponent(cb)}&_=${Date.now()}`;
  timer = setTimeout(() => finish(null), timeout);
  document.head.append(script);
});

/* ---------- Media ---------- */
let mq = { q: '', type: '', review: '', upload: '', challenge: '', offset: 0 }, items = [], selected = new Set();
const PAGE = 48;
const mediaFilter = () => {
  let f = ''; const t = clean(mq.q);
  if (mq.type) f += `&media_type=eq.${mq.type}`;
  if (mq.review) f += `&review_status=eq.${mq.review}`;
  if (mq.upload === 'UPLOADED') f += '&upload_status=eq.UPLOADED';
  else if (mq.upload) f += '&upload_status=neq.UPLOADED';
  if (t) f += '&' + orq(['participant_name', 'caption', 'sound_label'], encodeURIComponent(t));
  if (mq.challenge) f += `&challenge_id=eq.${encodeURIComponent(mq.challenge)}`;
  return f;
};
async function loadAllMediaRows(filter = mediaFilter()) {
  const rows = [];
  for (let offset = 0; offset < 50000; offset += 1000) {
    const batch = await sb(`submissions?select=*,challenges(name)&order=captured_at.desc&limit=1000&offset=${offset}${filter}`);
    rows.push(...batch);
    if (batch.length < 1000) break;
  }
  return rows;
}
function safeFilename(s) {
  return String(s || 'file').replace(/[\\/:*?"<>|\x00-\x1F]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'file';
}
function extFor(row) {
  const key = String(row.mediaKey || '');
  const ext = key.includes('.') ? key.split('.').pop().replace(/[^a-z0-9]/gi, '').toLowerCase() : '';
  return ext || (row.mediaType === 'video' ? 'mp4' : 'jpg');
}
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(data) {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function u16(n) { return [n & 255, (n >>> 8) & 255]; }
function u32(n) { return [n >>> 0 & 255, n >>> 8 & 255, n >>> 16 & 255, n >>> 24 & 255]; }
const ZIP_ENCODER = new TextEncoder();
function dosDateTime(dateValue) {
  const d = new Date(dateValue || Date.now());
  const year = Math.max(1980, d.getFullYear());
  return {
    time: ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | Math.floor(d.getSeconds() / 2),
    date: (((year - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31),
  };
}
function zipStore(files) {
  const local = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = ZIP_ENCODER.encode(String(f.name));
    const data = f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data);
    if (name.length > 0xffff || data.length > 0xffffffff) throw new Error('A ZIP entry is too large.');
    const crc = crc32(data);
    const { time, date } = dosDateTime(f.date);

    const lh = new Uint8Array(30 + name.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, 0, true);      // store, no compression
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length >>> 0, true);
    lv.setUint32(22, data.length >>> 0, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    lh.set(name, 30);
    local.push(lh, data);

    const ch = new Uint8Array(46 + name.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // made by
    cv.setUint16(6, 20, true); // needed
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length >>> 0, true);
    cv.setUint32(24, data.length >>> 0, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset >>> 0, true);
    ch.set(name, 46);
    central.push(ch);
    offset += lh.length + data.length;
  }
  const centralSize = central.reduce((n, x) => n + x.length, 0);
  if (files.length > 0xffff || offset > 0xffffffff || centralSize > 0xffffffff) throw new Error('The ZIP is too large for this browser export.');
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize >>> 0, true);
  ev.setUint32(16, offset >>> 0, true);
  ev.setUint16(20, 0, true);
  return new Blob([...local, ...central, end], { type: 'application/zip' });
}

async function downloadAllRows(rows, statusEl) {
  const normalized = rows.map((r) => r.mediaKey !== undefined ? r : camel(r));
  const uploaded = normalized.filter((r) => r.uploadStatus === 'UPLOADED' && r.mediaKey);
  const driveOnly = normalized.filter((r) => r.storageProvider === 'DRIVE' && r.backupUrl && !r.mediaKey);
  if (!uploaded.length && !driveOnly.length) throw new Error('There are no uploaded media files to download.');
  const totalBytes = uploaded.reduce((n, r) => n + Number(r.size || 0), 0);
  const partLimit = 180 * 1024 * 1024;
  const plannedParts = Math.max(1, Math.ceil(Math.max(totalBytes, 1) / partLimit));
  let files = [], partRows = [], partBytes = 0, done = 0, partNo = 0;
  const makeManifest = (rs) => {
    const lines = ['id,participant,media_type,captured_at,storage_provider,backup_status,backup_url'];
    for (const r of rs) lines.push([r.id, r.participantName, r.mediaType, r.capturedAt, r.storageProvider, r.backupStatus, r.backupUrl].map((v) => String(v ?? '').replace(/"/g, '""')).map((v) => `"${v}"`).join(','));
    return new TextEncoder().encode(lines.join('\n'));
  };
  const flush = async () => {
    if (!files.length && !partRows.length) return;
    files.push({ name: 'metadata.csv', data: makeManifest(partRows) });
    partNo++;
    const blob = zipStore(files);
    const suffix = plannedParts > 1 ? `-part-${partNo}-of-${plannedParts}` : '';
    save(blob, `JOTA-JOTI-media-${new Date().toISOString().slice(0,10)}${suffix}.zip`);
    files = []; partRows = []; partBytes = 0;
    await new Promise((r) => setTimeout(r, 150));
  };
  if (totalBytes > partLimit && statusEl) statusEl.textContent = `Large download · split into ${plannedParts} smaller ZIPs`;
  for (const r of uploaded) {
    const signed = await sign('media', [r.mediaKey]);
    const url = signed[r.mediaKey];
    if (!url) continue;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Could not read ${r.participantName}'s ${r.mediaType}.`);
    const data = new Uint8Array(await resp.arrayBuffer());
    if (files.length && partBytes + data.byteLength > partLimit) await flush();
    files.push({
      name: `${safeFilename(r.participantName)}/${safeFilename(r.id.slice(0, 8))}_${safeFilename(r.participantName)}.${extFor(r)}`,
      data, date: r.capturedAt,
    });
    partRows.push(r); partBytes += data.byteLength; done++;
    if (statusEl) statusEl.textContent = `Preparing download · ${done}/${uploaded.length}`;
  }
  if (driveOnly.length) {
    const lines = ['Some files are stored only in Google Drive and could not be fetched into this ZIP from the browser.', ''];
    for (const r of driveOnly) lines.push(`${r.participantName} · ${r.id} · ${r.backupUrl}`);
    files.push({ name: 'Drive-backup-links.txt', data: new TextEncoder().encode(lines.join('\n')) });
  }
  await flush();
  audit('Downloaded media archive', '', `${rows.length} submissions${partNo > 1 ? ` · ${partNo} ZIP parts` : ''}`);
  if (statusEl) statusEl.textContent = driveOnly.length
    ? `Downloaded ${done} files · ${driveOnly.length} Drive-only links included${partNo > 1 ? ` · ${partNo} ZIPs` : ''}`
    : `Downloaded ${done} files${partNo > 1 ? ` · ${partNo} ZIPs` : ''}`;
}

async function deleteRowsBatched(rows) {
  for (let start = 0; start < rows.length; start += 50) {
    const batch = rows.slice(start, start + 50);
    const keys = batch.flatMap((i) => [i.media_key, i.thumb_key, i.audio_key]).filter(Boolean);
    if (keys.length) {
      for (let k = 0; k < keys.length; k += 100) await sb(`${U}/storage/v1/object/media`, { method: 'DELETE', body: { prefixes: keys.slice(k, k + 100) } });
    }
    await sb(`submissions?id=in.(${batch.map((i) => i.id).join(',')})`, { method: 'DELETE' });
  }
  audit('Deleted submissions', '', `${rows.length} items`);
}
async function media() {
  const [result, challengeRows] = await Promise.all([
    sb(`submissions?select=*,challenges(name)&order=captured_at.desc&limit=${PAGE}&offset=${mq.offset}${mediaFilter()}`, { full: true, headers: { prefer: 'count=exact' } }),
    sb('challenges?select=id,name,number&order=number,name').catch(() => []),
  ]);
  const { data, headers } = result;
  const total = Number((headers.get('content-range') || '').split('/')[1]) || 0;
  const th = await sign('media', data.map((r) => r.thumb_key)).catch(() => ({}));
  items = data.map((r) => ({ ...camel(r), challengeName: r.challenges && r.challenges.name, thumbUrl: th[r.thumb_key] || null }));
  const challengeOptions = challengeRows.map(camel).map((c) => `<option value="${esc(c.id)}">${esc(c.number != null ? `#${c.number} · ${c.name}` : c.name)}</option>`).join('');
  pane(`<section class="admin-hero"><div><span class="eyebrow">JOTA-JOTI CAMERA</span><h2>Media library</h2><p class="muted">Review, export and manage participant photos and videos.</p></div><div class="hero-stat"><b>${total}</b><span>submissions</span></div></section>
    <section class="admin-toolbar card"><div class="filter-grid"><input id="q" placeholder="Search participant, caption or sound" value="${esc(mq.q)}"><select id="ty"><option value="">Photos + videos</option><option value="photo">Photos</option><option value="video">Videos</option></select><select id="rv"><option value="">Any review state</option><option>PENDING</option><option>APPROVED</option><option>REJECTED</option></select><select id="up"><option value="">Any upload state</option><option value="UPLOADED">Uploaded</option><option value="WAITING">Not finished</option></select><select id="ch"><option value="">All challenges</option>${challengeOptions}</select><button id="go" class="btn pri">Apply</button></div>
    <div class="admin-actions"><button id="csv" class="btn">Export CSV</button><button id="sa" class="btn">Select page</button><button id="sar" class="btn">Select all results</button><button id="ap" class="btn">Approve</button><button id="rj" class="btn">Reject</button><button id="dn" class="btn">Download selected</button><button id="dna" class="btn">Download all</button><button id="dl" class="btn danger">Delete selected</button><button id="dla" class="btn danger">Delete all</button></div><div id="bulk-status" class="small muted" aria-live="polite"></div></section>
    <section class="media-grid">${items.map((i) => `<article class="media-tile"><button class="thumb-btn" data-open="${i.id}" aria-label="Open ${esc(i.mediaType)} from ${esc(i.participantName)}"><div class="tile-thumb" style="${i.thumbUrl ? `background-image:url('${i.thumbUrl}')` : ''}">${!i.thumbUrl ? `<span>${i.mediaType === 'video' ? '▶' : 'PHOTO'}</span>` : ''}</div></button><div class="tile-body"><label class="select-line"><input type="checkbox" data-sel="${i.id}" ${selected.has(i.id) ? 'checked' : ''}><span class="name">${esc(i.participantName)}</span></label><div class="tile-meta">${esc(i.mediaType)} · ${esc(i.challengeName || 'No challenge')}</div><div class="tags"><span class="tag ${i.reviewStatus}">${esc(i.reviewStatus)}</span><span class="tag">${esc(i.storageProvider || 'LOCAL')}</span><span class="tag">${esc(i.backupStatus || 'PENDING')}</span></div><time>${esc(fmt(i.capturedAt))}</time></div></article>`).join('') || '<div class="empty-state"><b>No submissions found</b><p>Try changing the filters or take the first JOTA-JOTI capture.</p></div>'}</section>
    <div class="pager"><button id="pv" ${mq.offset ? '' : 'disabled'}>Previous</button><span>${total ? `${mq.offset + 1}–${Math.min(mq.offset + PAGE, total)} of ${total}` : '0 items'}</span><button id="nx" ${mq.offset + PAGE < total ? '' : 'disabled'}>Next</button></div><dialog id="dlg"></dialog>`);
  $('#ty').value = mq.type; $('#rv').value = mq.review; $('#up').value = mq.upload; $('#ch').value = mq.challenge;
  $('#go').onclick = () => { mq = { q: $('#q').value, type: $('#ty').value, review: $('#rv').value, upload: $('#up').value, challenge: $('#ch').value, offset: 0 }; media().catch(fail); };
  $('#pv').onclick = () => { mq.offset -= PAGE; media().catch(fail); }; $('#nx').onclick = () => { mq.offset += PAGE; media().catch(fail); };
  $('#csv').onclick = async () => {
    const rows = await loadAllMediaRows();
    const cell = (v) => { let x = String(v ?? ''); if (/^[=+\-@\t\r]/.test(x)) x = "'" + x; return '"' + x.replace(/"/g, '""') + '"'; };
    const cols = ['id', 'participant_name', 'media_type', 'challenge', 'caption', 'sound_label', 'captured_at', 'latitude', 'longitude', 'upload_status', 'review_status', 'size'];
    save(new Blob([[cols.join(','), ...rows.map((r) => cols.map((c) => cell(c === 'challenge' ? r.challenges && r.challenges.name : r[c])).join(','))].join('\n')], { type: 'text/csv' }), 'jota-camera.csv'); audit('Exported CSV');
  };
  $('#sa').onclick = () => { items.forEach((i) => selected.add(i.id)); media().catch(fail); };
  $('#sar').onclick = async () => { try { const rows = await loadAllMediaRows(); selected = new Set(rows.map((r) => r.id)); media().catch(fail); } catch (e) { fail(e); } };
  document.querySelectorAll('[data-sel]').forEach((c) => c.onchange = () => (c.checked ? selected.add(c.dataset.sel) : selected.delete(c.dataset.sel)));
  const review = (st) => async () => { if (!selected.size) return alert('Select at least one item.'); try { await sb(`submissions?id=in.(${[...selected].join(',')})`, { method: 'PATCH', body: { review_status: st } }); audit(st + ' submissions', '', selected.size + ' items'); selected.clear(); media().catch(fail); } catch (e) { fail(e); } };
  $('#ap').onclick = review('APPROVED'); $('#rj').onclick = review('REJECTED');
  $('#dl').onclick = async () => { const ids = new Set(selected); if (!ids.size) return alert('Select at least one item.'); if (!confirm(`Permanently delete ${ids.size} item(s)? This cannot be undone.`)) return; const chosen = items.filter((i) => ids.has(i.id)); try { await deleteRowsBatched(chosen.map(snake)); selected.clear(); media().catch(fail); } catch (e) { fail(e); } };
  $('#dla').onclick = async () => { const rows = await loadAllMediaRows(); if (!rows.length) return alert('There are no submissions to delete.'); const scope = (mq.q || mq.type || mq.review || mq.upload || mq.challenge) ? 'matching the current filters' : 'in the library'; if (!confirm(`Permanently delete ALL ${rows.length} submissions ${scope}? This removes the Supabase media files and database records. Google Drive backups, if present, are retained. This cannot be undone.`)) return; const st = $('#bulk-status'); st.textContent = 'Deleting…'; try { await deleteRowsBatched(rows); selected.clear(); st.textContent = `Deleted ${rows.length} submissions.`; await media(); } catch (e) { fail(e); } };
  $('#dn').onclick = async () => { const chosen = items.filter((i) => selected.has(i.id)); if (!chosen.length) return alert('Select at least one item.'); const st = $('#bulk-status'); st.textContent = 'Preparing download…'; try { await downloadAllRows(chosen.map(snake), st); } catch (e) { st.textContent = ''; fail(e); } };
  $('#dna').onclick = async () => { const rows = await loadAllMediaRows(); if (!rows.length) return alert('There are no submissions to download.'); const st = $('#bulk-status'); st.textContent = 'Preparing download…'; try { await downloadAllRows(rows, st); } catch (e) { st.textContent = ''; fail(e); } };
  document.querySelectorAll('[data-open]').forEach((t) => t.onclick = () => view(items.find((i) => i.id === t.dataset.open)));
}
async function removeItems(list) { await deleteRowsBatched(list.map((i) => snake(i))); }
async function view(i) {
  const d = $('#dlg');
  const urls = i.uploadStatus === 'UPLOADED' ? await sign('media', [i.mediaKey], `${i.participantName}_${i.id.slice(0, 8)}.${i.mediaKey.split('.').pop()}`) : {};
  const dl = urls[i.mediaKey]; const show = dl ? dl.replace(/&download=[^&]*$/, '') : '';
  const drive = i.backupUrl || '';
  d.innerHTML = `${show ? (i.mediaType === 'video' ? `<video src="${show}" controls playsinline></video>` : `<img src="${show}" alt="">`) : drive ? '<p class="muted">This item is stored in the Google Drive backup.</p>' : '<p class="muted">Not uploaded yet.</p>'}
  <p><b>${esc(i.participantName)}</b> · ${i.mediaType} · ${i.size ? mb(i.size) : ''} · ${fmt(i.capturedAt)}<br>Challenge: ${esc(i.challengeName || 'none')} · Sound: ${esc(i.soundLabel || 'none')}<br>Storage: ${esc(i.storageProvider || 'LOCAL')} · Backup: ${esc(i.backupStatus || 'PENDING')}
  ${i.latitude != null ? `<br>Location: <a target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=${i.latitude}&mlon=${i.longitude}#map=17/${i.latitude}/${i.longitude}">${i.latitude.toFixed(5)}, ${i.longitude.toFixed(5)}</a> (±${Math.round(i.locationAccuracy || 0)} m)` : ''}
  ${i.lastError ? `<br><span class="err">Last error: ${esc(i.lastError)}</span>` : ''}</p>
  <label>Caption</label><input id="cap" style="width:100%" value="${esc(i.caption)}">
  <div class="row" style="margin-top:10px"><button id="sv">Save caption</button><button id="a1">Approve</button><button id="r1">Reject</button>${dl ? `<a class="btn" href="${dl}">Download</a>` : drive ? `<a class="btn" target="_blank" rel="noopener" href="${esc(drive)}">Open Drive backup</a>` : ''}<button id="d1" class="bad">Delete</button><button id="cl">Close</button></div>`;
  d.showModal();
  const patch = (b) => async () => { try { await sb(`submissions?id=eq.${i.id}`, { method: 'PATCH', body: b() }); d.close(); media().catch(fail); } catch (e) { fail(e); } };
  $('#sv').onclick = patch(() => ({ caption: $('#cap').value })); $('#a1').onclick = patch(() => ({ review_status: 'APPROVED' })); $('#r1').onclick = patch(() => ({ review_status: 'REJECTED' }));
  $('#d1').onclick = async () => { if (!confirm('Delete this permanently?')) return; try { await removeItems([i]); d.close(); media().catch(fail); } catch (e) { fail(e); } };
  $('#cl').onclick = () => { d.close(); d.querySelectorAll('video').forEach((v) => v.pause()); };
}

/* ---------- generic editor for challenges / sounds / pins ---------- */
function form(fields, v = {}) {
  return fields.map(([k, label, type, opts]) => {
    const val = v[k] ?? '';
    if (type === 'area') return `<label>${label}</label><textarea data-k="${k}">${esc(val)}</textarea>`;
    if (type === 'select') return `<label>${label}</label><select data-k="${k}">${opts.map((o) => { const [ov, ol] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(ov)}" ${ov === val ? 'selected' : ''}>${esc(ol)}</option>`; }).join('')}</select>`;
    if (type === 'check') return `<label><input type="checkbox" data-k="${k}" ${val === '' || val ? 'checked' : ''}> ${label}</label>`;
    return `<label>${label}</label><input data-k="${k}" type="${type || 'text'}" step="any" value="${esc(val)}" style="width:100%">`;
  }).join('');
}
function read(root, fields) {
  const o = {};
  for (const [k, , type] of fields) {
    const e = root.querySelector(`[data-k="${k}"]`);
    o[k] = type === 'check' ? e.checked : type === 'number' ? (e.value === '' ? null : Number(e.value)) : e.value;
  }
  if (o.locationId === '') o.locationId = null;
  return o;
}
function editor(table, fields, list, reload, { title, html, after, beforeDelete } = {}) {
  const d = $('#dlg');
  const open = (item) => {
    d.innerHTML = `<h3>${item ? 'Edit' : 'Add'} ${title}</h3>${form(fields, item || { active: true })}${html ? html() : ''}<p class="row" style="margin-top:12px"><button class="btn pri" id="ok">Save</button><button id="no">Cancel</button></p>`;
    d.showModal(); $('#no').onclick = () => d.close();
    $('#ok').onclick = async () => {
      try {
        const body = snake(read(d, fields));
        let id = item && item.id;
        if (item) await sb(`${table}?id=eq.${id}`, { method: 'PATCH', body });
        else { const r = await sb(table, { method: 'POST', body, headers: { prefer: 'return=representation' } }); id = r[0].id; }
        if (after) await after(d, id);
        audit((item ? 'Edited ' : 'Added ') + title, id, body.name || body.title || '');
        d.close(); reload().catch(fail);
      } catch (e) { fail(e.message.includes('duplicate') ? new Error('That number is already used. Pick another one.') : e); }
    };
  };
  $('#new').onclick = () => open(null);
  document.querySelectorAll('[data-e]').forEach((b) => b.onclick = () => open(list.find((x) => String(x.id) === b.dataset.e)));
  document.querySelectorAll('[data-d]').forEach((b) => b.onclick = async () => {
    if (!confirm('Delete this? Photos and videos that were already sent stay in the library.')) return;
    try { const item = list.find((x) => String(x.id) === b.dataset.d); if (beforeDelete && item) await beforeDelete(item); await sb(`${table}?id=eq.${b.dataset.d}`, { method: 'DELETE' }); audit('Deleted ' + title, b.dataset.d); reload().catch(fail); } catch (e) { fail(e); }
  });
}

async function challenges() {
  const [rows, pins] = await Promise.all([sb('challenges?select=*&order=sort,number,name'), sb('locations?select=id,name&order=name')]);
  const list = rows.map(camel);
  const CF = [['name', 'Challenge name'], ['number', 'Number (e.g. 12)'], ['kind', 'Type', 'select', ['info', 'photo', 'group_photo', 'photos', 'video', 'sound_video', 'custom']],
    ['description', 'Short description', 'area'], ['instructions', 'Instructions shown to participants', 'area'], ['points', 'Points', 'number'],
    ['photosRequired', 'Photos required', 'number'], ['videosRequired', 'Videos required', 'number'], ['soundNumber', 'Sound number (for sound videos)', 'number'],
    ['locationId', 'Map pin', 'select', [['', '(none)'], ...pins.map((p) => [p.id, p.name])]],
    ['config', 'Extra settings (JSON, optional)', 'area'], ['radius', 'Location radius in metres (0 = none)', 'number'], ['active', 'Active (visible to participants)', 'check']];
  pane(`<div class="row"><button class="btn pri" id="new">Add challenge</button></div><div class="card"><table><tr><th>#</th><th>Name</th><th>Type</th><th>Needs</th><th></th></tr>
    ${list.map((c) => `<tr><td>${esc(c.number)}</td><td>${esc(c.name)}${c.active ? '' : ' <span class="tag">hidden</span>'}</td><td>${esc(c.kind)}</td><td>${c.photosRequired || 0} photo / ${c.videosRequired || 0} video${c.soundNumber != null ? ' / sound ' + c.soundNumber : ''}</td>
    <td><button data-e="${c.id}">Edit</button> <button class="bad" data-d="${c.id}">Delete</button></td></tr>`).join('') || '<tr><td colspan=5 class="muted">No challenges yet.</td></tr>'}</table></div><dialog id="dlg"></dialog>`);
  editor('challenges', CF, list, challenges, { title: 'challenge' });
}

async function downloadSoundRows(rows, statusEl) {
  const usable = rows.filter((s) => s.audioPath);
  if (!usable.length) throw new Error('There are no uploaded audio files to download.');
  const files = [];
  let done = 0;
  for (const s of usable) {
    const signed = await sign('sounds', [s.audioPath]);
    const url = signed[s.audioPath];
    if (!url) continue;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Could not read ${s.title}.`);
    const ext = (s.audioPath.split('.').pop() || 'mp3').toLowerCase();
    files.push({ name: `${safeFilename(s.title || 'sound')}_${safeFilename(s.number ?? s.id.slice(0, 8))}.${ext}`, data: new Uint8Array(await resp.arrayBuffer()), date: s.createdAt });
    done++;
    if (statusEl) statusEl.textContent = `Preparing audio · ${done}/${usable.length}`;
  }
  const csv = ['id,number,title,artist,category,permission_status,duration,audio_path'];
  for (const s of usable) csv.push([s.id,s.number,s.title,s.artist,s.category,s.permissionStatus,s.duration,s.audioPath].map((v)=>`"${String(v??'').replace(/"/g,'""')}"`).join(','));
  files.push({ name: 'audio-metadata.csv', data: new TextEncoder().encode(csv.join('\n')) });
  save(zipStore(files), `JOTA-JOTI-audio-${new Date().toISOString().slice(0,10)}.zip`);
  audit('Downloaded audio archive', '', `${done} audio files`);
  if (statusEl) statusEl.textContent = `Downloaded ${done} audio files`;
}

async function deleteSoundRows(rows) {
  const usable = rows.filter(Boolean);
  for (let start = 0; start < usable.length; start += 50) {
    const batch = usable.slice(start, start + 50);
    const paths = batch.flatMap((s) => [s.audioPath, s.artworkPath]).filter(Boolean);
    for (let k = 0; k < paths.length; k += 100) {
      await sb(`${U}/storage/v1/object/sounds`, { method: 'DELETE', body: { prefixes: paths.slice(k, k + 100) } });
    }
    await sb(`sounds?id=in.(${batch.map((s) => s.id).join(',')})`, { method: 'DELETE' });
  }
  audit('Deleted sounds', '', `${usable.length} audio records`);
}

async function sounds() {
  const rows = await sb('sounds?select=*&order=number.nullslast,title');
  const list = rows.map(camel);
  const urls = await sign('sounds', list.map((s) => s.audioPath)).catch(() => ({}));
  const SF = [['title', 'Title'], ['number', 'Sound number (unique)', 'number'], ['artist', 'Artist / creator'], ['category', 'Category'], ['description', 'Description', 'area'],
    ['attribution', 'Credit line'], ['licenceInfo', 'Licence'], ['source', 'Where it came from'],
    ['permissionStatus', 'Permission', 'select', ['unconfirmed', 'owned', 'licensed', 'royalty-free', 'public-domain', 'permission-granted']],
    ['duration', 'Length in seconds', 'number'], ['active', 'Available to participants', 'check']];
  pane(`<section class="admin-hero"><div><span class="eyebrow">JOTA-JOTI AUDIO</span><h2>Sound library</h2><p class="muted">Add organiser MP3s for participants to use in videos. Keep copyright and permission records with every track.</p></div><div class="hero-stat"><b>${list.length}</b><span>sounds</span></div></section>
  <div class="admin-actions"><button class="btn pri" id="new">Add audio</button><button class="btn" id="dl-sounds">Download all audio</button><button class="btn danger" id="del-sounds">Delete all audio</button><span class="small muted" id="sound-bulk-status" aria-live="polite"></span></div>
  <div class="card"><table><tr><th>No.</th><th>Title</th><th>Category</th><th>File</th><th></th></tr>
  ${list.map((s) => `<tr><td>${s.number ?? ''}</td><td>${esc(s.title)}${s.active ? '' : ' <span class="tag">hidden</span>'}<br><span class="muted">${esc(s.permissionStatus)}</span></td><td>${esc(s.category)}</td>
  <td>${urls[s.audioPath] ? `<audio controls preload="none" src="${urls[s.audioPath]}" style="height:30px"></audio>` : '<span class="err">no audio</span>'}</td>
  <td><button data-e="${s.id}">Edit</button> <button class="bad" data-d="${s.id}">Delete</button></td></tr>`).join('') || '<tr><td colspan=5 class="muted">No sounds yet.</td></tr>'}</table></div><dialog id="dlg"></dialog>`);
  $('#dl-sounds').onclick = async () => { const st = $('#sound-bulk-status'); st.textContent = 'Preparing…'; try { await downloadSoundRows(list, st); } catch (e) { st.textContent = ''; fail(e); } };
  $('#del-sounds').onclick = async () => { if (!list.length) return alert('There are no sounds to delete.'); if (!confirm(`Delete ALL ${list.length} sounds and their MP3/artwork files from Supabase? This cannot be undone. Participant videos already uploaded are not changed.`)) return; const st = $('#sound-bulk-status'); st.textContent='Deleting…'; try { await deleteSoundRows(list); await sounds(); } catch (e) { st.textContent=''; fail(e); } };
  editor('sounds', SF, list, sounds, {
    title: 'sound',
    html: () => '<label>MP3 audio file (optional when editing)</label><input type="file" id="au" accept=".mp3,audio/mpeg"><p class="small muted">MP3 files only. Use audio you are authorised to use.</p>',
    after: async (dlg, id) => {
      const f = dlg.querySelector('#au').files[0]; if (!f) return;
      if (!/\.mp3$/i.test(f.name) && f.type !== 'audio/mpeg') throw new Error('Please choose an MP3 file.');
      if (f.size > 25 * 1024 * 1024) throw new Error('That MP3 is over 25 MB.');
      const path = `${id}.mp3`;
      await sb(`${U}/storage/v1/object/sounds/${path}`, { method: 'POST', body: f, raw: true, headers: { 'content-type': f.type || 'audio/mpeg', 'x-upsert': 'true' } });
      await sb(`sounds?id=eq.${id}`, { method: 'PATCH', body: { audio_path: path, size: f.size } });
    },
    beforeDelete: async (item) => {
      const paths = [item.audioPath, item.artworkPath].filter(Boolean);
      if (paths.length) await sb(`${U}/storage/v1/object/sounds`, { method: 'DELETE', body: { prefixes: paths } });
    },
  });
}

async function map() {
  const sheet = await loadSheetConfigAdmin().catch(() => null);
  const list = (sheet && Array.isArray(sheet.locations) ? sheet.locations : []).map((p) => ({
    id: String(p.id), name: String(p.name || ''), description: String(p.description || ''), instructions: String(p.instructions || ''),
    latitude: Number(p.latitude), longitude: Number(p.longitude), category: String(p.category || ''), icon: String(p.icon || ''),
    points: Number(p.points || 0), photoRequired: !!p.photoRequired, videoAllowed: p.videoAllowed !== false, active: p.active !== false,
    challengeNumbers: Array.isArray(p.challengeNumbers) ? p.challengeNumbers : [],
  })).filter((p) => p.id && p.name && Number.isFinite(p.latitude) && Number.isFinite(p.longitude));
  const sheetUrl = sheet && sheet.sheetUrl ? sheet.sheetUrl : '';
  const syncUrl = `${BU}?op=syncSheet&key=${encodeURIComponent(BK)}`;
  const mapUrl = sheet && sheet.settings && sheet.settings.mapUrl ? String(sheet.settings.mapUrl) : '';
  pane(`<div class="card"><h2>Map pins</h2><p>Google Sheets is the source of truth for the map URL and location list. Edit locations in the <b>Locations</b> sheet, not here.</p>
    <div class="row">${sheetUrl ? `<a class="btn pri" href="${esc(sheetUrl)}" target="_blank" rel="noopener">Open Google Sheet</a>` : ''}
    ${mapUrl ? `<a class="btn" href="${esc(mapUrl)}" target="_blank" rel="noopener">Open Google Maps</a>` : ''}
    ${BU ? `<a class="btn" href="${esc(syncUrl)}" target="_blank" rel="noopener">Sync Sheet → Supabase</a>` : ''}</div>
    <p class="muted">${sheet ? `${list.length} valid locations loaded from the Sheet${sheet.updatedAt ? ` · updated ${fmt(sheet.updatedAt)}` : ''}.` : 'The Google Sheet could not be read. Check the Apps Script deployment and its web-app URL.'}</p></div>
    <div class="card"><table><tr><th>Pin</th><th>Position</th><th>Challenges</th><th>Status</th></tr>${list.map((p) => `<tr><td>${esc(p.icon ? p.icon+' ' : '')}${esc(p.name)}</td><td>${p.latitude.toFixed(6)}, ${p.longitude.toFixed(6)}</td><td>${esc(p.challengeNumbers.join(', ')) || '<span class="muted">none</span>'}</td><td>${p.active ? 'Active' : '<span class="tag">hidden</span>'}</td></tr>`).join('') || '<tr><td colspan=4 class="muted">No valid locations yet. Add rows to the Locations sheet.</td></tr>'}</table></div>
    <div class="card"><h3>Locations sheet columns</h3><p class="muted">ID, Name, Description, Instructions, Latitude, Longitude, Category, Icon, Points, PhotoRequired, VideoAllowed, Active, ChallengeNumbers</p><p class="muted">For ChallengeNumbers, use numbers separated by commas, for example <code>1, 4, 12</code>.</p></div>`);
}

async function people() {
  const [ps, subs] = await Promise.all([sb('participants?select=*&order=name'), sb('submissions?select=participant_id,media_type&limit=10000')]);
  const n = {}; for (const s of subs) { const o = n[s.participant_id] || (n[s.participant_id] = { p: 0, v: 0 }); s.media_type === 'photo' ? o.p++ : o.v++; }
  pane(`<div class="card"><table><tr><th>Name</th><th>Posts</th><th>First seen</th><th>Last seen</th></tr>${ps.map((p) => { const c = n[p.id] || { p: 0, v: 0 }; return `<tr><td>${esc(p.name)}</td><td>${c.p + c.v} (${c.p} photos, ${c.v} videos)</td><td>${fmt(p.created_at)}</td><td>${fmt(p.last_seen_at)}</td></tr>`; }).join('') || '<tr><td colspan=4 class="muted">Nobody yet.</td></tr>'}</table></div>`);
}

const DEFAULTS = { competitionName: 'JOTA-JOTI', photosEnabled: true, videosEnabled: true, maxVideoSeconds: 60, locationMode: 'optional', allowCustomSounds: true, maxCustomAudioSeconds: 15, micMode: 'mix', mediaNotice: '' };
const SET = [['competitionName', 'Competition name'], ['photosEnabled', 'Photos allowed', 'check'], ['videosEnabled', 'Videos allowed', 'check'], ['maxVideoSeconds', 'Longest video (seconds)', 'number'],
  ['locationMode', 'Location', 'select', ['off', 'optional', 'required']], ['allowCustomSounds', 'Let participants record their own sound', 'check'],
  ['maxCustomAudioSeconds', 'Longest custom sound (seconds)', 'number'], ['micMode', 'Video audio', 'select', ['mix', 'voice', 'sound']], ['mediaNotice', 'Notice shown to participants', 'area']];
async function settings() {
  const rows = await sb('settings?select=key,value'); const s = { ...DEFAULTS }; for (const r of rows) s[r.key] = r.value;
  pane(`<div class="card" id="sf">${form(SET, s)}<p><button class="btn pri" id="ok">Save settings</button></p></div>`);
  $('#ok').onclick = async () => {
    try {
      const v = read($('#sf'), SET); v.maxVideoSeconds = Math.min(120, Math.max(5, v.maxVideoSeconds || 60)); v.maxCustomAudioSeconds = Math.min(120, Math.max(3, v.maxCustomAudioSeconds || 15));
      await sb('settings?on_conflict=key', { method: 'POST', body: Object.entries(v).map(([key, value]) => ({ key, value })), headers: { prefer: 'resolution=merge-duplicates' } });
      audit('Changed settings'); alert('Saved. Phones pick it up next time they are online.');
    } catch (e) { fail(e); }
  };
}

async function backup() {
  const rows = await sb('submissions?select=id,participant_name,media_type,size,upload_status,backup_status,storage_provider,backup_at,backup_url,last_error&order=captured_at.desc&limit=10000');
  const uploaded = rows.filter((r) => r.upload_status === 'UPLOADED');
  const done = uploaded.filter((r) => r.backup_status === 'DONE');
  const pending = uploaded.filter((r) => r.backup_status !== 'DONE');
  const errors = rows.filter((r) => r.backup_status === 'ERROR');
  const syncUrl = `${BU}?op=sync&key=${encodeURIComponent(BK)}`;
  pane(`<div class="card"><h2>Google backup</h2><p>Successful uploads stay in Supabase and are copied to Google Drive. If Supabase storage returns a quota/capacity error, the phone sends the saved copy straight to Drive.</p>
    <p><b>${done.length}</b> backed up · <b>${pending.length}</b> waiting · <b>${errors.length}</b> with backup errors</p>
    <p class="muted">The background worker checks for pending backups every 5 minutes.</p>
    <div class="row"><a class="btn pri" href="${esc(syncUrl)}" target="_blank" rel="noopener">Run backup now</a><a class="btn" href="${esc(syncUrl.replace('?op=sync', '?op=status'))}" target="_blank" rel="noopener">Worker status</a></div></div>
    <div class="card"><table><tr><th>Participant</th><th>Kind</th><th>Storage</th><th>Backup</th><th>When</th><th>Link</th></tr>
    ${rows.slice(0,200).map((r) => `<tr><td>${esc(r.participant_name)}</td><td>${esc(r.media_type)}</td><td>${esc(r.storage_provider || 'LOCAL')}</td><td>${esc(r.backup_status || 'PENDING')}</td><td>${fmt(r.backup_at)}</td><td>${r.backup_url ? `<a target="_blank" rel="noopener" href="${esc(r.backup_url)}">Drive</a>` : ''}</td></tr>`).join('') || '<tr><td colspan=6 class="muted">No submissions yet.</td></tr>'}</table></div>`);
}

async function system() {
  const [subs, logs] = await Promise.all([sb('submissions?select=media_type,upload_status,review_status,backup_status,storage_provider,size,last_error,id,participant_name,captured_at&limit=10000'), sb('audit_logs?select=*&order=id.desc&limit=100')]);
  const up = subs.filter((s) => s.upload_status === 'UPLOADED'), bytes = up.reduce((a, s) => a + (s.size || 0), 0), stuck = subs.filter((s) => s.upload_status !== 'UPLOADED');
  pane(`<div class="card"><h3>Totals</h3><p>${subs.length} posts · ${up.length} uploaded · ${subs.filter((s) => s.media_type === 'photo').length} photos · ${subs.filter((s) => s.media_type === 'video').length} videos</p>
  <p>Storage recorded by uploaded submissions: <b>${mb(bytes)}</b>. Supabase Usage is the authority for your current quota.</p>
  <p>Google Drive backup: ${subs.filter((s) => s.upload_status === 'UPLOADED' && s.backup_status === 'DONE').length}/${up.length} complete · ${subs.filter((s) => s.backup_status === 'ERROR').length} errors</p>
  <p>Waiting for review: ${subs.filter((s) => s.review_status === 'PENDING').length} · Approved: ${subs.filter((s) => s.review_status === 'APPROVED').length} · Rejected: ${subs.filter((s) => s.review_status === 'REJECTED').length}</p></div>
  <div class="card"><h3>Unfinished uploads (${stuck.length})</h3><table>${stuck.map((s) => `<tr><td>${esc(s.participant_name)}</td><td>${fmt(s.captured_at)}</td><td>${esc(s.upload_status)}</td><td class="err">${esc(s.last_error)}</td></tr>`).join('') || '<tr><td class="muted">None.</td></tr>'}</table></div>
  <div class="card"><h3>Organiser activity</h3><table>${logs.map((l) => `<tr><td>${fmt(l.created_at)}</td><td>${esc(l.actor)}</td><td>${esc(l.action)}</td><td>${esc(l.target)} ${esc(l.detail)}</td></tr>`).join('')}</table></div>`);
}
const views = { media, challenges, sounds, map, people, settings, backup, system };
sess ? start() : login();
