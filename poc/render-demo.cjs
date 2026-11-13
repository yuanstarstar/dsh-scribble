'use strict';

/*
 * DSH Scribble — proof-of-concept renderer
 * ----------------------------------------
 * Pure JavaScript: procedural single-line strokes -> PNG (pngjs) + SVG.
 * No external fonts, images, or network data. Everything below is drawn
 * from code so the sample is deterministic and license-clean.
 *
 * Run:
 *   node render-demo.cjs
 */

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const W = 1500;
const H = 950;
const SS = 2; // supersampling factor
const SEED = 20261112;

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(SEED);
const rand = (a = 0, b = 1) => a + (b - a) * rnd();
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

const C = {
  paper: [0.966, 0.947, 0.909],
  ink: [0.118, 0.153, 0.227],
  inkSoft: [0.24, 0.28, 0.36],
  red: [0.714, 0.286, 0.204],
  green: [0.255, 0.455, 0.322],
  ochre: [0.855, 0.612, 0.216],
  brown: [0.365, 0.255, 0.157],
  white: [0.992, 0.984, 0.957],
};

function rgb(c) {
  return `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;
}
function rgba(c, a) {
  return `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;
}

class Canvas {
  constructor(w, h, ss) {
    this.w = w;
    this.h = h;
    this.ss = ss;
    this.dw = w * ss;
    this.dh = h * ss;
    this.data = new Float32Array(this.dw * this.dh * 3);
    for (let i = 0; i < this.dw * this.dh; i++) {
      this.data[i * 3] = C.paper[0];
      this.data[i * 3 + 1] = C.paper[1];
      this.data[i * 3 + 2] = C.paper[2];
    }
  }

  blend(x, y, c, a) {
    if (x < 0 || y < 0 || x >= this.dw || y >= this.dh) return;
    const i = (y * this.dw + x) * 3;
    const ia = 1 - a;
    this.data[i] = this.data[i] * ia + c[0] * a;
    this.data[i + 1] = this.data[i + 1] * ia + c[1] * a;
    this.data[i + 2] = this.data[i + 2] * ia + c[2] * a;
  }

  // A tapered capsule between two logical-space points.
  capsule(x1, y1, r1, x2, y2, r2, c, a = 1) {
    const s = this.ss;
    const X1 = x1 * s;
    const Y1 = y1 * s;
    const X2 = x2 * s;
    const Y2 = y2 * s;
    const R1 = r1 * s;
    const R2 = r2 * s;
    const dx = X2 - X1;
    const dy = Y2 - Y1;
    const len2 = dx * dx + dy * dy;
    const radius = Math.max(R1, R2);
    const minX = Math.max(0, Math.floor(Math.min(X1, X2) - radius - 2));
    const maxX = Math.min(this.dw - 1, Math.ceil(Math.max(X1, X2) + radius + 2));
    const minY = Math.max(0, Math.floor(Math.min(Y1, Y2) - radius - 2));
    const maxY = Math.min(this.dh - 1, Math.ceil(Math.max(Y1, Y2) + radius + 2));
    for (let y = minY; y <= maxY; y++) {
      const py = y + 0.5;
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        let t = 0;
        if (len2 > 1e-9) {
          t = ((px - X1) * dx + (py - Y1) * dy) / len2;
          t = clamp(t, 0, 1);
        }
        const qx = X1 + t * dx;
        const qy = Y1 + t * dy;
        const d = Math.hypot(px - qx, py - qy);
        const rr = R1 + (R2 - R1) * t;
        const cov = clamp((rr + 0.55 - d) / 1.1, 0, 1);
        if (cov > 0) this.blend(x, y, c, a * cov);
      }
    }
  }

  fillCircle(cx, cy, r, c, a = 1) {
    const s = this.ss;
    const CX = cx * s;
    const CY = cy * s;
    const R = r * s;
    const minX = Math.max(0, Math.floor(CX - R - 2));
    const maxX = Math.min(this.dw - 1, Math.ceil(CX + R + 2));
    const minY = Math.max(0, Math.floor(CY - R - 2));
    const maxY = Math.min(this.dh - 1, Math.ceil(CY + R + 2));
    for (let y = minY; y <= maxY; y++) {
      const py = y + 0.5;
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const d = Math.hypot(px - CX, py - CY);
        const cov = clamp((R + 0.55 - d) / 1.1, 0, 1);
        if (cov > 0) this.blend(x, y, c, a * cov);
      }
    }
  }

  // points: logical [[x,y],...], widths: logical full widths per point
  polyline(points, widths, c, a = 1) {
    if (points.length < 2) return;
    for (let i = 0; i < points.length - 1; i++) {
      const w1 = Array.isArray(widths) ? widths[i] : widths;
      const w2 = Array.isArray(widths) ? widths[i + 1] : widths;
      this.capsule(points[i][0], points[i][1], w1 / 2, points[i + 1][0], points[i + 1][1], w2 / 2, c, a);
    }
  }

  downsample() {
    const out = new PNG({ width: this.w, height: this.h });
    const n = this.ss * this.ss;
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        let r = 0;
        let g = 0;
        let b = 0;
        for (let sy = 0; sy < this.ss; sy++) {
          for (let sx = 0; sx < this.ss; sx++) {
            const i = (((y * this.ss + sy) * this.dw) + (x * this.ss + sx)) * 3;
            r += this.data[i];
            g += this.data[i + 1];
            b += this.data[i + 2];
          }
        }
        const o = (y * this.w + x) * 4;
        out.data[o] = Math.round((r / n) * 255);
        out.data[o + 1] = Math.round((g / n) * 255);
        out.data[o + 2] = Math.round((b / n) * 255);
        out.data[o + 3] = 255;
      }
    }
    return out;
  }
}

const canvas = new Canvas(W, H, SS);
const svg = [];

// ---------- stroke helpers ----------

function jitterPoints(points, amp) {
  if (amp <= 0) return points;
  const n = points.length;
  const ox = new Array(n);
  const oy = new Array(n);
  for (let i = 0; i < n; i++) {
    ox[i] = (rnd() * 2 - 1) * amp;
    oy[i] = (rnd() * 2 - 1) * amp;
  }
  const sx = new Array(n);
  const sy = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = ox[Math.max(0, i - 1)];
    const b = ox[i];
    const c = ox[Math.min(n - 1, i + 1)];
    sx[i] = (a + 2 * b + c) / 4;
    const d = oy[Math.max(0, i - 1)];
    const e = oy[i];
    const f = oy[Math.min(n - 1, i + 1)];
    sy[i] = (d + 2 * e + f) / 4;
  }
  return points.map((p, i) => [p[0] + sx[i], p[1] + sy[i]]);
}

function svgStroke(points, width, c, a) {
  if (points.length < 2) return;
  let d = '';
  for (let i = 0; i < points.length; i++) {
    d += (i === 0 ? 'M' : 'L') + points[i][0].toFixed(2) + ' ' + points[i][1].toFixed(2) + ' ';
  }
  svg.push(
    `<path d="${d.trim()}" fill="none" stroke="${rgb(c)}" stroke-opacity="${a}" ` +
      `stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`,
  );
}

function stroke(points, width, c, a = 0.95, jitterAmp = 0, taper = false) {
  const pts = jitterPoints(points, jitterAmp);
  let widths;
  if (taper && pts.length > 2) {
    widths = pts.map((_, i) => {
      const t = i / (pts.length - 1);
      return width * (0.62 + 0.38 * Math.sin(Math.PI * t));
    });
  } else {
    widths = width;
  }
  canvas.polyline(pts, widths, c, a);
  svgStroke(pts, width, c, a);
}

function outlineCircle(cx, cy, r, width, c, a = 0.95, wobble = 0) {
  const pts = [];
  const n = 72;
  for (let i = 0; i <= n; i++) {
    const th = (i / n) * Math.PI * 2;
    const rr = r + (wobble ? (rnd() * 2 - 1) * wobble : 0);
    pts.push([cx + Math.cos(th) * rr, cy + Math.sin(th) * rr]);
  }
  const jittered = jitterPoints(pts, Math.max(0.3, wobble * 0.35));
  canvas.polyline(jittered, width, c, a);
  svg.push(
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${rgb(c)}" ` +
      `stroke-opacity="${a}" stroke-width="${width}"/>`,
  );
}

function fillCircle(cx, cy, r, c, a = 1) {
  canvas.fillCircle(cx, cy, r, c, a);
  svg.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${rgb(c)}" fill-opacity="${a}"/>`);
}

// ---------- geometry ----------

function line(x1, y1, x2, y2) {
  return [
    [x1, y1],
    [x2, y2],
  ];
}

function cubic(p0, p1, p2, p3, n = 18) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
  return out;
}

function join(...parts) {
  const out = [];
  for (const part of parts) {
    for (const p of part) {
      const last = out[out.length - 1];
      if (!last || Math.hypot(last[0] - p[0], last[1] - p[1]) > 0.001) out.push(p);
    }
  }
  return out;
}

function arc(cx, cy, rx, ry, a0, a1, n = 48) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return out;
}

// ---------- tiny stroke font (uppercase + digits) ----------

const GLYPHS = {};

function glyph(ch, advance, strokes) {
  GLYPHS[ch] = { advance, strokes };
}

glyph('D', 0.72, [
  line(0.09, 0, 0.09, 1),
  join(
    cubic([0.09, 0], [0.54, -0.01], [0.8, 0.22], [0.8, 0.5]),
    cubic([0.8, 0.5], [0.8, 0.78], [0.54, 1.01], [0.09, 1]),
  ),
]);

glyph('S', 0.66, [
  join(
    cubic([0.57, 0.1], [0.48, 0.02], [0.13, 0.0], [0.1, 0.22]),
    cubic([0.1, 0.22], [0.08, 0.4], [0.4, 0.45], [0.46, 0.5]),
    cubic([0.46, 0.5], [0.56, 0.58], [0.56, 0.9], [0.16, 0.93]),
  ),
]);

glyph('H', 0.72, [
  line(0.1, 0, 0.1, 1),
  line(0.56, 0, 0.56, 1),
  line(0.1, 0.5, 0.56, 0.5),
]);

glyph('I', 0.38, [
  line(0.19, 0, 0.19, 1),
  line(0.06, 0, 0.32, 0),
  line(0.06, 1, 0.32, 1),
]);

glyph('A', 0.68, [
  line(0.07, 1, 0.3, 0),
  line(0.3, 0, 0.57, 1),
  line(0.18, 0.62, 0.45, 0.62),
]);

glyph('N', 0.72, [
  line(0.1, 1, 0.1, 0),
  line(0.1, 0, 0.56, 1),
  line(0.56, 1, 0.56, 0),
]);

glyph('2', 0.64, [
  join(
    cubic([0.1, 0.2], [0.1, -0.02], [0.55, -0.02], [0.55, 0.2]),
    line(0.55, 0.2, 0.1, 0.96),
    line(0.1, 0.96, 0.6, 0.96),
  ),
]);

glyph('0', 0.64, [arc(0.32, 0.5, 0.23, 0.47, 0, Math.PI * 2, 56)]);

glyph('6', 0.64, [
  join(
    cubic([0.55, 0.07], [0.5, 0.0], [0.12, 0.3], [0.1, 0.58]),
    line(0.1, 0.58, 0.1, 0.72),
    arc(0.32, 0.72, 0.22, 0.23, Math.PI, Math.PI * 3, 48),
  ),
]);

glyph(' ', 0.3, []);

function drawText(text, x, y, size, opts = {}) {
  const color = opts.color || C.ink;
  const alpha = opts.alpha == null ? 0.95 : opts.alpha;
  const tracking = (opts.tracking == null ? 0.02 : opts.tracking) * size;
  const slant = opts.slant == null ? 0.035 : opts.slant;
  const weight = opts.weight == null ? 0.042 : opts.weight;
  const bounce = opts.bounce == null ? 0.006 : opts.bounce;
  let pen = x;
  for (const ch of text) {
    const g = GLYPHS[ch] || GLYPHS[' '];
    const dy = (rnd() * 2 - 1) * bounce * size;
    for (const strokePts of g.strokes) {
      const pts = strokePts.map((p) => {
        const gx = p[0] + (1 - p[1]) * slant;
        return [pen + gx * size + (rnd() * 2 - 1) * 0.35, y + p[1] * size + dy];
      });
      const ptsJ = jitterPoints(pts, 0.55 + size * 0.0022);
      const widths = ptsJ.map((_, i) => {
        const t = i / Math.max(1, ptsJ.length - 1);
        return size * weight * (0.66 + 0.34 * Math.sin(Math.PI * Math.min(1, t)));
      });
      canvas.polyline(ptsJ, widths, color, alpha);
      svgStroke(ptsJ, size * weight, color, alpha);
    }
    pen += (g.advance + tracking / size) * size + (rnd() * 2 - 1) * size * 0.004;
  }
  return pen;
}

// ---------- scene ----------

// ground
const ground = [];
for (let x = 78; x <= 1450; x += 8) {
  ground.push([x, 760 + Math.sin(x * 0.018) * 3 + (rnd() * 2 - 1) * 1.2]);
}
stroke(ground, 3.2, C.inkSoft, 0.72, 0.5);

// grass tufts
for (let i = 0; i < 26; i++) {
  const gx = rand(110, 1420);
  const gh = rand(7, 17);
  stroke(line(gx, 760, gx + rand(-7, 7), 760 - gh), 2.0, C.green, 0.55, 0.7);
}

// sun
fillCircle(1282, 168, 55, C.ochre, 0.82);
outlineCircle(1282, 168, 55, 4.2, C.red, 0.88, 1.0);
for (let i = 0; i < 12; i++) {
  const a = (i / 12) * Math.PI * 2 + 0.06;
  const r1 = 68;
  const r2 = 88 + rand(-5, 6);
  stroke(
    line(1282 + Math.cos(a) * r1, 168 + Math.sin(a) * r1, 1282 + Math.cos(a) * r2, 168 + Math.sin(a) * r2),
    3.4,
    C.ochre,
    0.9,
    0.6,
  );
}

// tree
const TX = 640;
const TY = 356;
const trunkL = [];
const trunkR = [];
for (let y = 760; y >= TY + 66; y -= 10) {
  trunkL.push([TX - 12 + Math.sin(y * 0.03) * 3 + (rnd() * 2 - 1) * 1.0, y]);
  trunkR.push([TX + 14 + Math.sin(y * 0.026 + 1) * 3 + (rnd() * 2 - 1) * 1.0, y]);
}
stroke(trunkL, 7.0, C.brown, 0.9, 0.35);
stroke(trunkR, 6.2, C.brown, 0.9, 0.35);
stroke(line(TX - 9, TY + 160, TX - 58, TY + 80), 4.6, C.brown, 0.85, 0.6);
stroke(line(TX + 9, TY + 138, TX + 56, TY + 66), 4.2, C.brown, 0.85, 0.6);

// canopy: a wobbly cloud-shaped mass, translucent washes + leaf scribbles
fillCircle(TX, TY - 8, 92, C.green, 0.10);
fillCircle(TX - 56, TY + 28, 62, C.green, 0.10);
fillCircle(TX + 58, TY + 32, 60, C.green, 0.09);
fillCircle(TX - 6, TY + 58, 62, C.green, 0.08);
const cloud = [];
for (let i = 0; i <= 96; i++) {
  const th = (i / 96) * Math.PI * 2;
  const r = 102 + Math.sin(th * 5 + 0.7) * 17 + Math.sin(th * 3 + 1.9) * 8;
  cloud.push([TX + Math.cos(th) * r * 1.06, TY + Math.sin(th) * r * 0.84]);
}
stroke(cloud, 4.8, C.green, 0.84, 1.4);
for (let i = 0; i < 8; i++) {
  const cx = TX + rand(-75, 75);
  const cy = TY + rand(-50, 65);
  const a0 = rand(0, Math.PI * 2);
  const a1 = a0 + rand(1.0, 2.0);
  stroke(arc(cx, cy, rand(16, 34), rand(12, 26), a0, a1, 18), 2.0, C.green, 0.28, 0.8);
}

// apples
for (const [ax, ay] of [
  [TX - 48, TY - 22],
  [TX + 42, TY + 6],
  [TX - 4, TY + 50],
]) {
  fillCircle(ax, ay, 10, C.red, 0.9);
  outlineCircle(ax, ay, 10, 2.0, C.red, 0.9, 0.6);
  stroke(line(ax, ay - 10, ax + 2, ay - 18), 2.0, C.brown, 0.8, 0.4);
}

// stick figure
const SX = 910;
const footY = 760;
const hipY = 610;
const shoulderY = 485;
const headY = 424;
const headR = 55;

// legs
stroke(line(SX, hipY, SX - 55, footY - 4), 7.0, C.ink, 0.95, 0.8);
stroke(line(SX, hipY, SX + 58, footY - 4), 7.0, C.ink, 0.95, 0.8);
stroke(line(SX - 55, footY - 4, SX - 78, footY + 2), 5.0, C.ink, 0.9, 0.5);
stroke(line(SX + 58, footY - 4, SX + 82, footY + 2), 5.0, C.ink, 0.9, 0.5);

// body
stroke(line(SX, hipY, SX, shoulderY), 7.5, C.ink, 0.96, 0.6);

// arms: one down, one waving
stroke(line(SX, shoulderY, SX - 72, 545), 6.2, C.ink, 0.95, 0.7);
stroke(line(SX - 72, 545, SX - 92, 592), 5.6, C.ink, 0.95, 0.7);
stroke(line(SX, shoulderY, SX + 70, 430), 6.2, C.ink, 0.95, 0.7);
stroke(line(SX + 70, 430, SX + 103, 374), 5.6, C.ink, 0.95, 0.7);
// waving hand
for (let i = -1; i <= 1; i++) {
  stroke(line(SX + 103, 374, SX + 103 + i * 13, 350), 3.6, C.ink, 0.9, 0.5);
}

// head
outlineCircle(SX, headY, headR, 7.2, C.ink, 0.97, 1.0);
// hair
for (let i = 0; i < 5; i++) {
  const a = -2.5 + i * 0.22;
  stroke(
    line(
      SX + Math.cos(a) * (headR - 2),
      headY + Math.sin(a) * (headR - 2),
      SX + Math.cos(a) * (headR + 12),
      headY + Math.sin(a) * (headR + 12),
    ),
    3.2,
    C.ink,
    0.85,
    0.4,
  );
}
// eyes
fillCircle(SX - 20, headY - 9, 4.2, C.ink, 0.95);
fillCircle(SX + 20, headY - 9, 4.2, C.ink, 0.95);
// smile
stroke(
  join(
    [[SX - 22, headY + 18], [SX - 10, headY + 28]],
    cubic([SX - 10, headY + 28], [SX, headY + 36], [SX + 12, headY + 34], [SX + 22, headY + 18], 16),
  ),
  3.2,
  C.ink,
  0.9,
  0.4,
);

// speech bubble
const bx = 1044;
const by = 244;
const bw = 236;
const bh = 126;
const bubble = join(
  line(bx + 18, by, bx + bw - 18, by),
  cubic([bx + bw - 18, by], [bx + bw, by], [bx + bw, by + 18], [bx + bw, by + 24], 6),
  line(bx + bw, by + 24, bx + bw, by + bh - 24),
  cubic([bx + bw, by + bh - 24], [bx + bw, by + bh], [bx + bw - 18, by + bh], [bx + bw - 24, by + bh], 6),
  line(bx + bw - 24, by + bh, bx + 58, by + bh),
  line(bx + 58, by + bh, bx + 14, by + bh + 46),
  line(bx + 14, by + bh + 46, bx + 24, by + bh),
  line(bx + 24, by + bh, bx + 18, by + bh),
  cubic([bx + 18, by + bh], [bx, by + bh], [bx, by + bh - 18], [bx, by + bh - 24], 6),
  line(bx, by + bh - 24, bx, by + 24),
  cubic([bx, by + 24], [bx, by + 8], [bx + 8, by], [bx + 18, by], 6),
);
stroke(bubble, 3.6, C.ink, 0.9, 0.5);
drawText('HI', bx + 72, by + 34, 64, { weight: 0.046, slant: 0.02, tracking: 0.03 });

// title
drawText('DSH', 104, 118, 188, { weight: 0.047, slant: 0.055, tracking: 0.01, bounce: 0.004 });
// underline
const underline = [];
for (let x = 108; x <= 512; x += 6) {
  underline.push([x, 320 + Math.sin(x * 0.04) * 1.5 + (rnd() * 2 - 1) * 0.7]);
}
stroke(underline, 3.4, C.red, 0.78, 0.4);

// subtitle
drawText('HAND 2026', 110, 352, 42, { weight: 0.052, slant: 0.02, tracking: 0.05, bounce: 0.008, alpha: 0.82 });

// seal
const sealX = 1352;
const sealY = 786;
const sealS = 88;
fillCircle(sealX + sealS / 2, sealY + sealS / 2, sealS * 0.52, C.red, 0.86);
outlineCircle(sealX + sealS / 2, sealY + sealS / 2, sealS * 0.52, 3.0, C.red, 0.9, 0.8);
drawText('DSH', sealX + 15, sealY + 26, 26, { color: C.white, alpha: 0.96, weight: 0.065, slant: 0.0, tracking: 0.02 });

// signature
const sig = [];
for (let t = 0; t <= 1; t += 0.02) {
  const x = 100 + t * 230;
  const y = 872 + Math.sin(t * 13) * 9 + Math.sin(t * 31) * 3;
  sig.push([x, y]);
}
stroke(sig, 2.6, C.inkSoft, 0.72, 0.4);
fillCircle(332, 866, 3.5, C.red, 0.85);

// ---------- paper grain + vignette ----------
const png = canvas.downsample();
const grainRnd = mulberry32(SEED ^ 0x9e3779b9);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4;
    const n = (grainRnd() * 2 - 1) * 4.6;
    const dx = (x - W / 2) / (W / 2);
    const dy = (y - H / 2) / (H / 2);
    const vig = 1 - 0.035 * Math.min(1, dx * dx + dy * dy);
    for (let k = 0; k < 3; k++) {
      png.data[o + k] = clamp(Math.round(png.data[o + k] * vig + n), 0, 255);
    }
  }
}

fs.mkdirSync(path.join(__dirname), { recursive: true });
const pngPath = path.join(__dirname, 'dsh-scribble-demo.png');
const svgPath = path.join(__dirname, 'dsh-scribble-demo.svg');
fs.writeFileSync(pngPath, PNG.sync.write(png));

const bg = `<rect width="${W}" height="${H}" fill="${rgb(C.paper)}"/>`;
fs.writeFileSync(
  svgPath,
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">\n` +
    `<title>DSH Scribble proof of concept</title>\n` +
    bg +
    '\n' +
    svg.join('\n') +
    '\n</svg>\n',
);

console.log('wrote', pngPath);
console.log('wrote', svgPath);
console.log('svg elements', svg.length);
