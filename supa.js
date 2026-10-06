// Talks to Supabase. The rest of the app still calls "/api/..." paths; this file answers them.
import { SUPABASE_URL as U, SUPABASE_KEY as K } from './backend.js';
import { ApiError } from './api.js';
import { identity } from './identity.js';

/* ---------- anonymous sign-in (no email needed) ---------- */
const SKEY = 'jj_sb_session';
let sess = null;
try { sess = JSON.parse(localStorage.getItem(SKEY) || 'null'); } catch { /* ignore */ }
const saveSess = (s) => { sess = s; try { if (s) localStorage.setItem(SKEY, JSON.stringify(s)); else localStorage.removeItem(SKEY); } catch { /* ignore */ } };
const pick = (r) => ({
  access_token: r.access_token, refresh_token: r.refresh_token,
  expires_at: r.expires_at || Math.floor(Date.now() / 1000) + (r.expires_in || 3600), uid: (r.user && r.user.id) || (sess && sess.uid),
});

function toError(status, d) {
  const msg = (d && (d.message || d.msg || d.error_description || (typeof d.error === 'string' && d.error))) || `Server said ${status}`;
  let code = (d && (d.code || d.error_code)) || '', st = status;
  if (msg === 'MISSING_PARTS') { code = msg; st = 409; }
  else if (msg === 'UNKNOWN_PARTICIPANT') { code = msg; st = 401; }
  else if (msg === 'TOO_BIG') { code = msg; st = 413; }
  return new ApiError(msg === 'TOO_BIG' ? 'That file is too big (30 MB limit)' : msg, { status: st, code: String(code), data: d });
}

async function http(url, { method = 'GET', headers = {}, body, token } = {}) {
  let res;
  try {
    res = await fetch(url, { method, body, cache: 'no-store', headers: { apikey: K, ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers } });
  } catch { throw new ApiError('No connection', { network: true }); }
  const text = await res.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { /* not json */ }
  if (!res.ok) throw toError(res.status, data);
  return data;
}

let pending = null;
export function session() {
  if (sess && sess.expires_at * 1000 > Date.now() + 60000) return Promise.resolve(sess);
  if (!pending) {
    pending = (async () => {
      const json = { 'content-type': 'application/json' };
      if (sess && sess.refresh_token) {
        try { saveSess(pick(await http(`${U}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: json, body: JSON.stringify({ refresh_token: sess.refresh_token }) }))); return sess; }
        catch (e) { if (e.network || e.status >= 500) throw e; }
      }
      saveSess(pick(await http(`${U}/auth/v1/signup`, { method: 'POST', headers: json, body: '{}' })));
      return sess;
    })().finally(() => { pending = null; });
  }
  return pending;
}

async function run(fn, auth) {
  try { return await fn(); }
  catch (e) {
    if (auth && e.status === 401 && e.code !== 'UNKNOWN_PARTICIPANT' && sess) { sess.expires_at = 0; return fn(); } // token expired: refresh once and retry
    throw e;
  }
}
const rest = (path, { method = 'GET', body, auth = false, prefer } = {}) => run(async () => {
  const token = auth ? (await session()).access_token : undefined;
  return http(`${U}/rest/v1/${path}`, { method, token, headers: { 'content-type': 'application/json', ...(prefer ? { prefer } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
}, auth);
const rpc = (name, args) => rest('rpc/' + name, { method: 'POST', body: args, auth: true });

async function sign(bucket, paths) {
  const list = [...new Set(paths.filter(Boolean))];
  if (!list.length) return {};
  const s = await session();
  const r = await http(`${U}/storage/v1/object/sign/${bucket}`, { method: 'POST', token: s.access_token, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expiresIn: 7200, paths: list }) });
  const out = {};
  for (const x of r || []) if (x.signedURL) out[x.path] = `${U}/storage/v1${x.signedURL}`;
  return out;
}

/* ---------- shaping rows the way the screens expect ---------- */
function challengeOut(c, loc, snd) {
  const photos = c.photos_required || 0, videos = c.videos_required || 0;
  let config = {}; try { config = JSON.parse(c.config || '{}'); } catch { /* ignore */ }
  return {
    id: c.id, number: c.number || '', name: c.name, kind: c.kind || 'photo', description: c.description || '', instructions: c.instructions || '',
    points: c.points || 0, radius: c.radius || 0, active: !!c.active, config, photosRequired: photos, videosRequired: videos,
    requiredMedia: !photos && !videos ? 'none' : videos && !photos ? 'video' : photos && !videos ? 'photo' : 'any',
    soundNumber: c.sound_number ?? null,
    sound: snd ? { id: snd.id, title: snd.title, number: c.sound_number } : null,
    soundMissing: c.sound_number !== null && c.sound_number !== undefined && !snd,
    locationId: c.location_id || null,
    location: loc ? { id: loc.id, name: loc.name, latitude: loc.latitude, longitude: loc.longitude } : null,
  };
}
const pinOut = (r, challengeIds) => ({
  id: r.id, name: r.name, description: r.description || '', instructions: r.instructions || '', latitude: r.latitude, longitude: r.longitude,
  category: r.category || '', icon: r.icon || '', points: r.points || 0, photoRequired: !!r.photo_required, videoAllowed: !!r.video_allowed,
  active: !!r.active, challengeIds, challengeNumbers: Array.isArray(r.challenge_numbers) ? r.challenge_numbers : [],
});
const cleanQ = (s) => String(s || '').replace(/[,()*%\\:"']/g, ' ').trim().slice(0, 60);

/* ---------- the "/api/..." paths ---------- */
export async function handle(path, { method = 'GET', body } = {}) {
  const u = new URL(path, 'http://x');
  const p = u.pathname, q = u.searchParams;
  let m;

  if (p === '/api/health') { await rest('settings?select=key&limit=1'); return { ok: true }; }

  if (p === '/api/config') {
    const rows = await rest('settings?select=key,value');
    const settings = {}; for (const r of rows || []) settings[r.key] = r.value;
    return { settings, serverNow: new Date().toISOString() };
  }

  if (p === '/api/participants' && method === 'POST') {
    await session();
    await rpc('register_participant', { p_id: body.id, p_name: body.name, p_device: body.deviceId || '' });
    return { ok: true };
  }

  if (p === '/api/challenges') {
    const [chs, locs, snds] = await Promise.all([
      rest('challenges?select=*&active=eq.true'), rest('locations?select=*&active=eq.true'),
      rest('sounds?select=id,title,number&active=eq.true&audio_path=not.is.null&number=not.is.null')]);
    const L = new Map(locs.map((l) => [l.id, l])), S = new Map(snds.map((s) => [s.number, s]));
    chs.sort((a, b) => (a.sort - b.sort) || ((parseInt(a.number, 10) || 0) - (parseInt(b.number, 10) || 0)) || a.name.localeCompare(b.name));
    return { challenges: chs.map((c) => challengeOut(c, L.get(c.location_id), S.get(c.sound_number))) };
  }

  if (p === '/api/map') {
    const [locs, chs] = await Promise.all([rest('locations?select=*&active=eq.true&order=name'), rest('challenges?select=id,location_id&active=eq.true&location_id=not.is.null')]);
    const by = new Map();
    for (const c of chs) { if (!by.has(c.location_id)) by.set(c.location_id, []); by.get(c.location_id).push(c.id); }
    return { pins: locs.map((l) => pinOut(l, by.get(l.id) || [])) };
  }

  if (p === '/api/sounds') {
    const limit = Math.min(100, Math.max(1, parseInt(q.get('limit'), 10) || 30)), offset = Math.max(0, parseInt(q.get('offset'), 10) || 0);
    const text = cleanQ(q.get('q')), cat = cleanQ(q.get('category'));
    let f = 'in_library=eq.true' + (cat ? `&category=eq.${encodeURIComponent(cat)}` : '');
    if (text) f += `&or=(title.ilike.*${encodeURIComponent(text)}*,artist.ilike.*${encodeURIComponent(text)}*,description.ilike.*${encodeURIComponent(text)}*)`;
    const [rows, cats] = await Promise.all([
      rest(`sounds?select=id,title,artist,description,category,duration,attribution,artwork_path&${f}&order=title&limit=${limit + 1}&offset=${offset}`),
      rest('sounds?select=category&in_library=eq.true&category=neq.&limit=1000')]);
    let art = {}; try { if (rows.some((r) => r.artwork_path)) art = await sign('sounds', rows.map((r) => r.artwork_path)); } catch { /* artwork is optional */ }
    return {
      sounds: rows.slice(0, limit).map((r) => ({ id: r.id, title: r.title, artist: r.artist, description: r.description, category: r.category, duration: r.duration, credit: r.attribution, artworkUrl: art[r.artwork_path] || null })),
      categories: [...new Set(cats.map((c) => c.category))].sort(), more: rows.length > limit,
    };
  }

  if (p === '/api/my/submissions') {
    const pid = identity() && identity().id;
    const rows = await rest(`submissions?select=id,media_type,mime,captured_at,uploaded_at,upload_status,review_status,backup_status,storage_provider,backup_url,caption,challenge_id,thumb_key,media_key,duration,latitude,longitude,location_accuracy,sound_label,challenges(name)&participant_id=eq.${pid}&order=captured_at.desc&limit=300`, { auth: true });
    let urls = {};
    try {
      const paths = rows.flatMap((r) => [r.thumb_key, r.media_key]).filter(Boolean);
      urls = await sign('media', paths);
    } catch { /* signed media is optional; metadata still works */ }
    return { submissions: rows.map((r) => ({
      id: r.id, mediaType: r.media_type, mime: r.mime, duration: r.duration || 0, capturedAt: r.captured_at, uploadedAt: r.uploaded_at, uploadStatus: r.upload_status, reviewStatus: r.review_status,
      backupStatus: r.backup_status, storageProvider: r.storage_provider, backupUrl: r.backup_url,
      caption: r.caption, challengeId: r.challenge_id, challengeName: r.challenges && r.challenges.name, soundLabel: r.sound_label || '',
      latitude: r.latitude, longitude: r.longitude, accuracy: r.location_accuracy,
      thumbUrl: urls[r.thumb_key] || null, mediaUrl: urls[r.media_key] || null
    })) };
  }

  if (p === '/api/submissions' && method === 'POST') {
    return rpc('create_submission', { b: { ...body, participantId: identity() && identity().id } });
  }
  if ((m = /^\/api\/submissions\/([0-9a-f-]{36})\/(status|complete|report)$/i.exec(p))) {
    const id = m[1].toLowerCase();
    if (m[2] === 'status') return rpc('get_submission_status', { p_id: id });
    if (m[2] === 'complete') return rpc('complete_submission', { p_id: id });
    return rpc('report_problem', { p_id: id, p_error: body && body.error });
  }

  throw new ApiError('Not found: ' + p, { status: 404 });
}

/* ---------- uploads (one request per file, with progress) ---------- */
export async function putFile(path, blob, { onProgress, contentType = 'application/octet-stream' } = {}) {
  const m = /^\/api\/submissions\/([0-9a-f-]{36})\/(thumb|audio|parts\/\d+)$/i.exec(path);
  if (!m) throw new ApiError('Bad upload path', { status: 400 });
  const rows = await rest(`submissions?id=eq.${m[1].toLowerCase()}&select=media_key,thumb_key,audio_key`, { auth: true });
  const row = rows && rows[0];
  if (!row) throw new ApiError('Unknown submission', { status: 404, code: 'UNKNOWN_SUBMISSION' });
  const key = m[2] === 'thumb' ? row.thumb_key : m[2] === 'audio' ? row.audio_key : row.media_key;
  if (!key) throw new ApiError('Not expected', { status: 400, code: 'BAD_CONTENT' });
  const s = await session();
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', `${U}/storage/v1/object/media/${key}`);
    x.setRequestHeader('apikey', K); x.setRequestHeader('authorization', 'Bearer ' + s.access_token);
    x.setRequestHeader('content-type', contentType); x.setRequestHeader('x-upsert', 'true'); x.setRequestHeader('cache-control', 'max-age=3600');
    x.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded, e.total); };
    x.onerror = () => reject(new ApiError('No connection', { network: true }));
    x.ontimeout = () => reject(new ApiError('Timed out', { network: true }));
    x.onabort = () => reject(new ApiError('Cancelled', { network: true }));
    x.timeout = 300000;
    x.onload = () => {
      let d = null; try { d = JSON.parse(x.responseText); } catch { /* ignore */ }
      if (x.status >= 200 && x.status < 300) resolve(d || { ok: true });
      else { const st = Number(d && d.statusCode) || x.status; if (st === 401 && sess) sess.expires_at = 0; reject(toError(st, d)); }
    };
    x.send(blob);
  });
}

// The audio bytes for one library sound.
export async function soundBlob(id) {
  const rows = await rest(`sounds?id=eq.${encodeURIComponent(id)}&select=audio_path`);
  const path = rows && rows[0] && rows[0].audio_path;
  if (!path) throw new ApiError('That sound is not available', { status: 404 });
  const s = await session();
  let res;
  try { res = await fetch(`${U}/storage/v1/object/authenticated/sounds/${path}`, { headers: { apikey: K, authorization: 'Bearer ' + s.access_token }, cache: 'no-store' }); }
  catch { throw new ApiError('No connection', { network: true }); }
  if (!res.ok) throw new ApiError('Could not get that sound', { status: res.status });
  return res.blob();
}
