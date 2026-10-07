// A small, dependency-free slippy map: OpenStreetMap-style tiles drawn on a canvas, drag / pinch / wheel,
// markers (optionally draggable), and a "you are here" dot. Tiles the phone has already seen are served by the
// service worker, so a map you looked at before still draws without internet.
const TILE = 256;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const MAX_LAT = 85.0511;

export function project(lat, lon, z) {
  const n = TILE * 2 ** z, s = Math.sin(clamp(lat, -MAX_LAT, MAX_LAT) * Math.PI / 180);
  return { x: (lon + 180) / 360 * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
}
export function unproject(x, y, z) {
  const n = TILE * 2 ** z;
  return { lon: x / n * 360 - 180, lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI };
}
export const tileUrlFor = (tpl, z, x, y) => tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y).replace('{s}', 'a');

export class TileMap {
  constructor(container, opts = {}) {
    this.tileUrl = opts.tileUrl || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
    this.lat = opts.lat ?? 0; this.lon = opts.lon ?? 0; this.zoom = opts.zoom ?? 3;
    this.minZoom = opts.minZoom ?? 2; this.maxZoom = opts.maxZoom ?? 19;
    this.onMarkerClick = opts.onMarkerClick; this.onMapClick = opts.onMapClick; this.onMarkerDrag = opts.onMarkerDrag;
    this.markers = []; this.user = null; this.tiles = new Map(); this.pointers = new Map(); this.markerImages = new Map();
    this.canvas = document.createElement('canvas');
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('role', 'application');
    this.canvas.setAttribute('aria-label', opts.label || 'Map. Use the list view for an accessible version.');
    container.append(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.container = container;
    this.bind();
    this.onlineHandler = () => { this.tiles.forEach((t, k) => { if (t.failed) this.tiles.delete(k); }); this.invalidate(); };
    window.addEventListener('online', this.onlineHandler);
    this.resize();
  }

  destroy() { this.ro.disconnect(); window.removeEventListener('online', this.onlineHandler); this.markerImages.forEach((img) => { try { img.src = ''; } catch {} }); this.markerImages.clear(); this.canvas.remove(); }
  resize() {
    const r = this.container.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.w = Math.max(1, r.width); this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * this.dpr); this.canvas.height = Math.round(this.h * this.dpr);
    this.invalidate();
  }
  invalidate() { if (this.raf) return; this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); }); }

  setView(lat, lon, zoom) { this.lat = clamp(lat, -MAX_LAT, MAX_LAT); this.lon = lon; if (zoom !== undefined) this.zoom = clamp(zoom, this.minZoom, this.maxZoom); this.invalidate(); }
  setMarkers(m) { this.markers = m; this.invalidate(); }
  setUser(u) { this.user = u; this.invalidate(); }
  zoomBy(d) { this.zoomAt(this.w / 2, this.h / 2, this.zoom + d); }
  fitTo(points, pad = 60) {
    if (!points.length) return;
    if (points.length === 1) return this.setView(points[0].lat, points[0].lon, Math.max(this.zoom, 16));
    const lats = points.map((p) => p.lat), lons = points.map((p) => p.lon);
    const [la0, la1, lo0, lo1] = [Math.min(...lats), Math.max(...lats), Math.min(...lons), Math.max(...lons)];
    for (let z = this.maxZoom; z >= this.minZoom; z--) {
      const a = project(la1, lo0, z), b = project(la0, lo1, z);
      if (b.x - a.x <= this.w - pad * 2 && b.y - a.y <= this.h - pad * 2) { this.setView((la0 + la1) / 2, (lo0 + lo1) / 2, z); return; }
    }
    this.setView((la0 + la1) / 2, (lo0 + lo1) / 2, this.minZoom);
  }

  zoomAt(px, py, z) {
    z = clamp(z, this.minZoom, this.maxZoom);
    const before = this.screenToLatLon(px, py);
    this.zoom = z;
    const p = project(before.lat, before.lon, z), c = project(this.lat, this.lon, z);
    const target = unproject(c.x + (p.x - (c.x + px - this.w / 2)), c.y + (p.y - (c.y + py - this.h / 2)), z);
    this.lat = clamp(target.lat, -MAX_LAT, MAX_LAT); this.lon = target.lon;
    this.invalidate();
  }
  screenToLatLon(px, py) {
    const c = project(this.lat, this.lon, this.zoom);
    return unproject(c.x + px - this.w / 2, c.y + py - this.h / 2, this.zoom);
  }
  latLonToScreen(lat, lon) {
    const c = project(this.lat, this.lon, this.zoom), p = project(lat, lon, this.zoom);
    return { x: p.x - c.x + this.w / 2, y: p.y - c.y + this.h / 2 };
  }

  /* ---------- input ---------- */
  bind() {
    const cv = this.canvas;
    cv.style.touchAction = 'none';
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      const pt = this.local(e);
      this.pointers.set(e.pointerId, { ...pt, x0: pt.x, y0: pt.y, t0: performance.now() });
      if (this.pointers.size === 1) {
        const m = this.hit(pt.x, pt.y);
        this.dragMarker = m && m.draggable ? m : null;
        this.moved = false;
      } else { this.moved = true; this.dragMarker = null; this.pinch = this.pinchInfo(); }
    });
    cv.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const pt = this.local(e);
      const dx = pt.x - p.x, dy = pt.y - p.y;
      if (Math.hypot(pt.x - p.x0, pt.y - p.y0) > 6) this.moved = true;
      p.x = pt.x; p.y = pt.y;
      if (this.pointers.size >= 2) {
        const now = this.pinchInfo();
        if (this.pinch && this.pinch.d > 0) {
          this.panBy(now.cx - this.pinch.cx, now.cy - this.pinch.cy);
          this.zoomAt(now.cx, now.cy, this.zoom + Math.log2(now.d / this.pinch.d));
        }
        this.pinch = now;
      } else if (this.dragMarker && this.moved) {
        const ll = this.screenToLatLon(pt.x, pt.y);
        this.dragMarker.lat = ll.lat; this.dragMarker.lon = ll.lon; this.invalidate();
      } else if (this.moved) this.panBy(dx, dy);
    });
    const up = (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size === 0) {
        if (this.dragMarker && this.moved) { this.onMarkerDrag && this.onMarkerDrag(this.dragMarker); }
        else if (!this.moved && performance.now() - p.t0 < 600) {
          const m = this.hit(p.x, p.y);
          if (m) this.onMarkerClick && this.onMarkerClick(m);
          else if (this.onMapClick) { const ll = this.screenToLatLon(p.x, p.y); this.onMapClick(ll.lat, ll.lon); }
        }
        this.dragMarker = null;
      }
      this.pinch = this.pointers.size >= 2 ? this.pinchInfo() : null;
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', (e) => { e.preventDefault(); const pt = this.local(e); this.zoomAt(pt.x, pt.y, this.zoom - e.deltaY * 0.0025); }, { passive: false });
    cv.addEventListener('dblclick', (e) => { const pt = this.local(e); this.zoomAt(pt.x, pt.y, this.zoom + 1); });
    cv.addEventListener('keydown', (e) => {
      const step = 60;
      if (e.key === '+' || e.key === '=') this.zoomBy(1); else if (e.key === '-') this.zoomBy(-1);
      else if (e.key === 'ArrowLeft') this.panBy(step, 0); else if (e.key === 'ArrowRight') this.panBy(-step, 0);
      else if (e.key === 'ArrowUp') this.panBy(0, step); else if (e.key === 'ArrowDown') this.panBy(0, -step);
    });
  }
  local(e) { const r = this.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  pinchInfo() {
    const [a, b] = [...this.pointers.values()];
    return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) };
  }
  panBy(dx, dy) {
    const c = project(this.lat, this.lon, this.zoom);
    const t = unproject(c.x - dx, c.y - dy, this.zoom);
    this.lat = clamp(t.lat, -MAX_LAT, MAX_LAT); this.lon = t.lon;
    this.invalidate();
  }
  hit(px, py) {
    let best = null, bd = Infinity;
    for (const m of this.markers) {
      const s = this.latLonToScreen(m.lat, m.lon);
      let d = Infinity;
      if (m.kind === 'memory') {
        const hw = 30, hh = 38;
        if (px >= s.x - hw && px <= s.x + hw && py >= s.y - hh && py <= s.y + hh) { d = 0; }
      } else {
        d = Math.hypot(s.x - px, s.y - py);
        if (d > (m.hitRadius || 24)) d = Infinity;
      }
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  }

  /* ---------- drawing ---------- */
  markerImage(url) {
    if (!url) return null;
    let img = this.markerImages.get(url);
    if (img) return img;
    img = new Image();
    if (!url.startsWith('blob:')) img.crossOrigin = 'anonymous';
    img.onload = () => this.invalidate();
    img.onerror = () => { this.markerImages.delete(url); };
    img.src = url;
    this.markerImages.set(url, img);
    if (this.markerImages.size > 160) this.markerImages.delete(this.markerImages.keys().next().value);
    return img;
  }
  roundedRectPath(ctx, x, y, w, h, r) {
    const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y); ctx.arcTo(x + w, y, x + w, y + h, rr); ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr); ctx.arcTo(x, y, x + w, y, rr); ctx.closePath();
  }
  drawMemoryMarker(m, s) {
    const ctx = this.ctx;
    const w = 48, h = 62, x = s.x - w / 2, y = s.y - h / 2;
    const img = this.markerImage(m.imageUrl);
    ctx.save();
    this.roundedRectPath(ctx, x + 1, y + 1, w - 2, h - 2, 11);
    // Light-theme memory marker: looks like a small physical photo card rather than a dark map pin.
    ctx.fillStyle = '#ffffff'; ctx.fill();
    ctx.lineWidth = 2.5; ctx.strokeStyle = '#6b3c94'; ctx.stroke();
    ctx.save(); this.roundedRectPath(ctx, x + 4, y + 4, w - 8, h - 16, 8); ctx.clip();
    if (img && img.complete && img.naturalWidth) ctx.drawImage(img, x + 4, y + 4, w - 8, h - 16);
    else { ctx.fillStyle = '#eef1f4'; ctx.fillRect(x + 4, y + 4, w - 8, h - 16); ctx.fillStyle = '#6b3c94'; ctx.font = '800 16px system-ui'; ctx.textAlign = 'center'; ctx.fillText(m.mediaType === 'video' ? '▶' : '•', s.x, y + 30); }
    ctx.restore();
    ctx.fillStyle = '#45515a'; ctx.font = '800 9px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(m.mediaType === 'video' ? 'VIDEO' : 'PHOTO', s.x, y + h - 5);
    if (m.count > 1) {
      const bx = x + w - 2, by = y + 1;
      ctx.fillStyle = '#6b3c94'; ctx.beginPath(); ctx.arc(bx, by, 11, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '800 11px system-ui'; ctx.fillText(String(m.count), bx, by + 4);
    }
    ctx.restore();
  }
  drawChallengeMarker(m, s) {
    const ctx = this.ctx;
    ctx.save();
    const r = m.selected ? 17 : 14;
    ctx.fillStyle = m.done ? '#2f9e66' : '#f4b400'; ctx.strokeStyle = '#151515'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (m.done) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.3; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(s.x - 5, s.y); ctx.lineTo(s.x - 1, s.y + 4); ctx.lineTo(s.x + 6, s.y - 5); ctx.stroke();
    } else {
      ctx.fillStyle = '#171717'; ctx.font = '800 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(m.label || '!', s.x, s.y + 4);
    }
    if (m.count > 1) {
      ctx.fillStyle = '#5a2c84'; ctx.beginPath(); ctx.arc(s.x + 12, s.y - 12, 8.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '800 9px system-ui'; ctx.fillText(String(m.count), s.x + 12, s.y - 9);
    }
    ctx.restore();
  }
  tile(z, x, y) {
    const key = `${z}/${x}/${y}`;
    let t = this.tiles.get(key);
    if (!t) {
      t = { img: new Image(), ok: false, failed: false };
      t.img.crossOrigin = 'anonymous';
      t.img.onload = () => { t.ok = true; this.invalidate(); };
      t.img.onerror = () => { t.failed = true; this.invalidate(); };
      t.img.src = tileUrlFor(this.tileUrl, z, x, y);
      this.tiles.set(key, t);
      if (this.tiles.size > 400) this.tiles.delete(this.tiles.keys().next().value);
    }
    return t;
  }
  drawOfflineFallback(ctx, w, h) {
    ctx.save();
    ctx.fillStyle = '#edf3ef'; ctx.fillRect(0, 0, w, h);
    // A deliberately simple fallback keeps the map usable when tiles are not cached.
    // The real OpenStreetMap tiles take over automatically when connectivity is available.
    ctx.strokeStyle = '#d7e0da'; ctx.lineWidth = 1;
    const grid = Math.max(44, Math.min(88, Math.round(84 - this.zoom * 2)));
    for (let x = (w / 2) % grid; x < w; x += grid) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = (h / 2) % grid; y < h; y += grid) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    // Main roads are intentionally schematic only; do not imply exact street geometry offline.
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 8; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-40, h * .62); ctx.bezierCurveTo(w * .26, h * .47, w * .52, h * .62, w + 50, h * .34); ctx.stroke();
    ctx.strokeStyle = '#d8dde1'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(w * .18, -30); ctx.bezierCurveTo(w * .30, h * .28, w * .23, h * .68, w * .52, h + 30); ctx.stroke();
    ctx.fillStyle = '#51636d'; ctx.textAlign = 'left';
    ctx.font = '700 19px system-ui, sans-serif'; ctx.fillText('Boulder, Western Australia', 18, 40);
    ctx.font = '12px system-ui, sans-serif'; ctx.fillStyle = '#617079'; ctx.fillText('Event map · live locations appear here when available', 18, 60);
    ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = '#748189'; ctx.fillText('Offline base view · map tiles will layer in when available', 18, h - 20);
    ctx.restore();
  }

  draw() {
    const { ctx, w, h } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // Always draw the Boulder base first. Live OSM tiles are layered on top when available.
    // That keeps the map useful during first load, weak signal and offline use.
    this.drawOfflineFallback(ctx, w, h);
    const tz = clamp(Math.round(this.zoom), this.minZoom, this.maxZoom), scale = 2 ** (this.zoom - tz);
    const c = project(this.lat, this.lon, tz), n = 2 ** tz;
    const x0 = c.x - w / 2 / scale, y0 = c.y - h / 2 / scale;
    ctx.strokeStyle = '#2d2d36'; ctx.lineWidth = 1;
    for (let tx = Math.floor(x0 / TILE); tx <= Math.floor((x0 + w / scale) / TILE); tx++) {
      for (let ty = Math.floor(y0 / TILE); ty <= Math.floor((y0 + h / scale) / TILE); ty++) {
        if (ty < 0 || ty >= n) continue;
        const sx = (tx * TILE - x0) * scale, sy = (ty * TILE - y0) * scale, size = TILE * scale + 0.6;
        const t = this.tile(tz, ((tx % n) + n) % n, ty);
        if (t.ok) ctx.drawImage(t.img, sx, sy, size, size);
      }
    }
    // you are here
    if (this.user) {
      const s = this.latLonToScreen(this.user.latitude, this.user.longitude);
      const mpp = 156543.03 * Math.cos(this.user.latitude * Math.PI / 180) / 2 ** this.zoom;
      const r = Math.min(160, Math.max(0, (this.user.accuracy || 0) / mpp));
      if (r > 8) { ctx.fillStyle = 'rgba(80,140,255,.16)'; ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, 7); ctx.fill(); }
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(s.x, s.y, 9, 0, 7); ctx.fill();
      ctx.fillStyle = '#3b82f6'; ctx.beginPath(); ctx.arc(s.x, s.y, 6, 0, 7); ctx.fill();
    }
    for (const m of this.markers) {
      const s = this.latLonToScreen(m.lat, m.lon);
      if (s.x < -60 || s.y < -70 || s.x > w + 60 || s.y > h + 70) continue;
      if (m.kind === 'memory') { this.drawMemoryMarker(m, s); continue; }
      if (m.kind === 'challenge') { this.drawChallengeMarker(m, s); continue; }
      const r = m.selected ? 12 : 9;
      if (m.selected) { ctx.fillStyle = 'rgba(255,179,0,.30)'; ctx.beginPath(); ctx.arc(s.x, s.y, 19, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = m.color || '#5a2c84'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      if (m.done) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(s.x - 4, s.y); ctx.lineTo(s.x - 1, s.y + 3); ctx.lineTo(s.x + 4, s.y - 3); ctx.stroke(); }
      if (m.label && this.zoom >= 15) {
        ctx.font = '600 12px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,.75)'; ctx.strokeText(m.label, s.x, s.y + r + 14); ctx.fillStyle = '#fff'; ctx.fillText(m.label, s.x, s.y + r + 14);
      }
    }
    ctx.font = '10px system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(36,52,62,.72)';
    ctx.fillText('© OpenStreetMap contributors', w - 8, h - 8);
  }
}
