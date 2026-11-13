import { Canvas, SvgDoc, parseColor } from './canvas.js'
import { clamp, makeRng } from './random.js'
import { resolveStyle } from './style.js'
import { glyphFor, measureText, normalizeText, wrapText } from './glyphs.js'
import { TEMPLATES, fillParams, validateParams } from './templates.js'

export function jitterPoints(points, amplitude, rng, options = {}) {
  if (!Array.isArray(points) || points.length < 2) return points
  if (!amplitude || amplitude <= 0) return points
  const n = points.length
  const closed = Boolean(options.closed)
  const pinStart = Boolean(options.pinStart ?? options.pin)
  const pinEnd = Boolean(options.pinEnd ?? options.pin)
  const at = (i) => (closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i)))
  const wave = Number(options.wave) || 0
  const frequency = Number(options.frequency) || 0.55
  const phase = rng.next() * Math.PI * 2
  const ox = new Array(n)
  const oy = new Array(n)
  for (let i = 0; i < n; i += 1) {
    ox[i] = (rng.next() * 2 - 1) * amplitude
    oy[i] = (rng.next() * 2 - 1) * amplitude
  }
  if (!closed && pinStart) {
    ox[0] = 0
    oy[0] = 0
  }
  if (!closed && pinEnd) {
    ox[n - 1] = 0
    oy[n - 1] = 0
  }
  const out = new Array(n)
  for (let i = 0; i < n; i += 1) {
    const a = ox[at(i - 1)]
    const b = ox[at(i)]
    const c = ox[at(i + 1)]
    const d = oy[at(i - 1)]
    const e = oy[at(i)]
    const f = oy[at(i + 1)]
    const w = Math.sin(i * frequency + phase) * amplitude * wave
    out[i] = [points[i][0] + (a + 2 * b + c) / 4 + w, points[i][1] + (d + 2 * e + f) / 4 - w * 0.55]
  }
  return out
}

function normalizeClosed(points) {
  if (!Array.isArray(points) || points.length < 3) return points
  const first = points[0]
  const last = points[points.length - 1]
  if (Math.hypot(first[0] - last[0], first[1] - last[1]) < 0.001) return points.slice(0, -1)
  return points
}

function pathLength(points) {
  let total = 0
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])
  }
  return total
}

function trimPolyline(points, widths, progress) {
  if (!Array.isArray(points) || points.length < 2) return { points: [], widths: [] }
  if (!(progress < 1)) return { points, widths }
  if (progress <= 0) return { points: [], widths: [] }
  const segments = []
  let total = 0
  for (let i = 1; i < points.length; i += 1) {
    const length = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])
    if (length <= 1e-9) continue
    segments.push({ a: points[i - 1], b: points[i], wa: widths[i - 1], wb: widths[i], length, start: total })
    total += length
  }
  if (!segments.length) return { points: [points[0]], widths: [widths[0]] }
  const target = total * clamp(progress, 0, 1)
  const outPoints = [points[0]]
  const outWidths = [widths[0]]
  for (const segment of segments) {
    if (segment.start >= target) break
    const local = Math.min(1, (target - segment.start) / segment.length)
    const x = segment.a[0] + (segment.b[0] - segment.a[0]) * local
    const y = segment.a[1] + (segment.b[1] - segment.a[1]) * local
    const w = segment.wa + (segment.wb - segment.wa) * local
    if (Math.hypot(x - outPoints[outPoints.length - 1][0], y - outPoints[outPoints.length - 1][1]) > 0.001) {
      outPoints.push([x, y])
      outWidths.push(w)
    } else if (outWidths.length) {
      outWidths[outWidths.length - 1] = w
    }
    if (local < 1) break
  }
  return { points: outPoints, widths: outWidths }
}

function polygonArea(points) {
  let area = 0
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    area += a[0] * b[1] - b[0] * a[1]
  }
  return Math.abs(area) / 2
}

function distanceToPolyline(x, y, points) {
  let best = Infinity
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]
    const b = points[i]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len2 = dx * dx + dy * dy
    let t = 0
    if (len2 > 1e-9) t = clamp(((x - a[0]) * dx + (y - a[1]) * dy) / len2, 0, 1)
    const d = Math.hypot(x - (a[0] + dx * t), y - (a[1] + dy * t))
    if (d < best) best = d
  }
  return best
}

export function line(x1, y1, x2, y2) {
  return [
    [x1, y1],
    [x2, y2],
  ]
}

export function cubic(p0, p1, p2, p3, n = 20) {
  const out = []
  for (let i = 0; i <= n; i += 1) {
    const t = i / n
    const u = 1 - t
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ])
  }
  return out
}

export function arc(cx, cy, rx, ry, a0, a1, n = 48) {
  const out = []
  for (let i = 0; i <= n; i += 1) {
    const a = a0 + ((a1 - a0) * i) / n
    out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry])
  }
  return out
}

export function ellipsePoints(cx, cy, rx, ry, n = 64) {
  return arc(cx, cy, rx, ry, 0, Math.PI * 2, n)
}

export function join(...parts) {
  const out = []
  for (const part of parts) {
    for (const p of part) {
      const last = out[out.length - 1]
      if (!last || Math.hypot(last[0] - p[0], last[1] - p[1]) > 0.001) out.push(p)
    }
  }
  return out
}

export function rectPoints(x, y, w, h) {
  return [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
    [x, y],
  ]
}

export class Renderer {
  constructor({ width, height, style, seed, paper, scale = 2, maxOps = Infinity, revealOp = Infinity, revealProgress = 1 }) {
    this.width = width
    this.height = height
    this.style = style
    this.seed = seed
    this.rng = makeRng(seed)
    this.canvas = new Canvas(width, height, { paper, scale })
    this.svg = new SvgDoc(width, height, { paper })
    this.maxOps = Number.isFinite(Number(maxOps)) ? Math.max(0, Number(maxOps)) : Infinity
    this.revealOp = Number.isFinite(Number(revealOp)) ? Math.max(0, Number(revealOp)) : Infinity
    this.revealProgress = clamp(Number(revealProgress), 0, 1)
    this.opCount = 0
    this.opProgress = 1
  }

  takeOp() {
    const index = this.opCount
    this.opCount += 1
    if (index >= this.maxOps) return false
    if (index < this.revealOp) {
      this.opProgress = 1
      return true
    }
    if (index === this.revealOp) {
      this.opProgress = this.revealProgress
      return true
    }
    return false
  }

  color(value, fallback) {
    return parseColor(value, parseColor(fallback ?? this.style.ink))
  }

  stroke(points, options = {}) {
    if (!Array.isArray(points) || points.length < 2) return
    const closed = Boolean(options.closed)
    const source = closed ? normalizeClosed(points) : points
    if (source.length < 2) return
    const color = this.color(options.color, this.style.ink)
    const alpha = options.alpha == null ? this.style.alpha : options.alpha
    const width = options.width == null ? 3 : options.width
    const jitter = options.jitter == null ? this.style.jitter : options.jitter
    const rough = Number(options.roughness ?? this.style.roughness ?? 1)
    const amplitude = options.jitterPx == null ? (jitter * (0.8 + Math.max(0, width) * 0.38) + 0.16) * rough : options.jitterPx
    let pts = jitterPoints(source, amplitude, this.rng, {
      closed,
      pinStart: options.pinStart ?? options.pin,
      pinEnd: options.pinEnd ?? options.pin,
      wave: options.wave ?? 0.55,
    })
    if (pts === source) pts = pts.map((p) => [p[0], p[1]])
    const overshoot = closed || Array.isArray(options.widths)
      ? 0
      : Number(options.overshoot ?? width * 0.28 * rough)
    if (!closed && overshoot > 0 && pts.length >= 2 && !(options.pinStart ?? options.pin) && !(options.pinEnd ?? options.pin)) {
      const first = pts[0]
      const second = pts[1]
      const last = pts[pts.length - 1]
      const prev = pts[pts.length - 2]
      const d0 = Math.hypot(first[0] - second[0], first[1] - second[1]) || 1
      const d1 = Math.hypot(last[0] - prev[0], last[1] - prev[1]) || 1
      first[0] += ((first[0] - second[0]) / d0) * overshoot
      first[1] += ((first[1] - second[1]) / d0) * overshoot
      last[0] += ((last[0] - prev[0]) / d1) * overshoot
      last[1] += ((last[1] - prev[1]) / d1) * overshoot
    }
    const taper = options.taper == null ? this.style.taper : options.taper
    const endWidth = Math.max(0.35, Math.min(1, Number(options.minEndWidth ?? (closed ? 0.9 : 0.66))))
    const widths = Array.isArray(options.widths)
      ? options.widths
      : pts.map((_, i) => {
          if (!taper || pts.length < 3) return width
          const t = i / (pts.length - 1)
          return width * (endWidth + (1 - endWidth) * Math.sin(Math.PI * t))
        })
    if (!this.takeOp()) return
    let drawPoints = pts
    let drawWidths = widths
    let drawClosed = closed
    if (this.opProgress < 1) {
      const wrappedPoints = closed ? [...pts, pts[0]] : pts
      const wrappedWidths = closed ? [...widths, widths[0]] : widths
      const trimmed = trimPolyline(wrappedPoints, wrappedWidths, this.opProgress)
      if (trimmed.points.length < 2) return
      drawPoints = trimmed.points
      drawWidths = trimmed.widths
      drawClosed = false
    }
    if (drawClosed) {
      this.canvas.polyline([...drawPoints, drawPoints[0]], [...drawWidths, drawWidths[0]], color, alpha)
      const avg = drawWidths.reduce((a, b) => a + b, 0) / drawWidths.length
      this.svg.path(drawPoints, avg, color, alpha, true)
    } else {
      this.canvas.polyline(drawPoints, drawWidths, color, alpha)
      const avg = Array.isArray(drawWidths) ? drawWidths.reduce((a, b) => a + b, 0) / drawWidths.length : drawWidths
      this.svg.path(drawPoints, avg, color, alpha, false)
    }
  }

  fill(points, options = {}) {
    if (!Array.isArray(points) || points.length < 3) return
    if (!this.takeOp()) return
    const color = this.color(options.color, this.style.ink)
    const alpha = options.alpha == null ? 1 : options.alpha
    if (this.opProgress < 1 && Array.isArray(options.median) && options.median.length >= 2) {
      this.fillRevealed(points, options.median, this.opProgress, color, alpha)
      return
    }
    this.svg.fillPath(points, color, alpha, true)
    // Pixel fill for convex-ish polygons: scanline even/odd.
    const minY = Math.max(0, Math.floor(Math.min(...points.map((p) => p[1]))))
    const maxY = Math.min(this.canvas.height - 1, Math.ceil(Math.max(...points.map((p) => p[1]))))
    for (let y = minY; y <= maxY; y += 1) {
      const py = y + 0.5
      const xs = []
      for (let i = 0; i < points.length; i += 1) {
        const a = points[i]
        const b = points[(i + 1) % points.length]
        if ((a[1] <= py && b[1] > py) || (b[1] <= py && a[1] > py)) {
          xs.push(a[0] + ((py - a[1]) / (b[1] - a[1])) * (b[0] - a[0]))
        }
      }
      xs.sort((a, b) => a - b)
      for (let i = 0; i + 1 < xs.length; i += 2) {
        this.canvas.fillRect(xs[i], y, Math.max(0.5, xs[i + 1] - xs[i]), 1, color, alpha)
      }
    }
  }

  fillRevealed(points, median, progress, color, alpha) {
    const trimmed = trimPolyline(median, median.map(() => 1), progress)
    if (trimmed.points.length < 2) return
    const partial = trimmed.points
    const medianLength = Math.max(1, pathLength(median))
    const area = polygonArea(points)
    const width = clamp(area / medianLength * 0.58, 0.65, 80)
    const half = width + 1.4
    const bbox = {
      x0: Math.max(0, Math.floor(Math.min(...partial.map((p) => p[0])) - half)),
      x1: Math.min(this.canvas.width - 1, Math.ceil(Math.max(...partial.map((p) => p[0])) + half)),
      y0: Math.max(0, Math.floor(Math.min(...partial.map((p) => p[1])) - half)),
      y1: Math.min(this.canvas.height - 1, Math.ceil(Math.max(...partial.map((p) => p[1])) + half)),
    }
    if (bbox.x1 < bbox.x0 || bbox.y1 < bbox.y0) return
    for (let y = bbox.y0; y <= bbox.y1; y += 1) {
      const py = y + 0.5
      const xs = []
      for (let i = 0; i < points.length; i += 1) {
        const a = points[i]
        const b = points[(i + 1) % points.length]
        if ((a[1] <= py && b[1] > py) || (b[1] <= py && a[1] > py)) {
          xs.push(a[0] + ((py - a[1]) / (b[1] - a[1])) * (b[0] - a[0]))
        }
      }
      xs.sort((a, b) => a - b)
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const from = Math.max(bbox.x0, Math.ceil(xs[i]))
        const to = Math.min(bbox.x1, Math.floor(xs[i + 1]))
        for (let x = from; x <= to; x += 1) {
          if (distanceToPolyline(x + 0.5, py, partial) <= half) {
            this.canvas.fillRect(x, y, 1, 1, color, alpha)
          }
        }
      }
    }
  }

  circle(cx, cy, r, options = {}) {
    const color = this.color(options.color, this.style.ink)
    const width = options.width == null ? 3 : options.width
    const alpha = options.alpha == null ? this.style.alpha : options.alpha
    if (options.fill) {
      const fill = this.color(options.fill, options.color)
      this.canvas.fillCircle(cx, cy, r, fill, options.fillAlpha ?? 1)
      this.svg.circle(cx, cy, r, { fill, fillAlpha: options.fillAlpha ?? 1 })
    }
    if (options.stroke !== false) {
      this.stroke(ellipsePoints(cx, cy, r, r, Math.max(32, Math.round(r * 1.5))), {
        color,
        width,
        alpha,
        jitter: options.jitter,
        closed: true,
        minEndWidth: options.minEndWidth,
      })
    }
  }

  rect(x, y, w, h, options = {}) {
    const color = this.color(options.color, this.style.ink)
    if (options.fill) {
      const fill = this.color(options.fill, options.color)
      this.canvas.fillRect(x, y, w, h, fill, options.fillAlpha ?? 1)
      this.svg.rect(x, y, w, h, { fill, fillAlpha: options.fillAlpha ?? 1 })
    }
    if (options.stroke !== false) {
      this.stroke(rectPoints(x, y, w, h), {
        color,
        width: options.width ?? 3,
        alpha: options.alpha ?? this.style.alpha,
        closed: true,
        jitter: options.jitter,
      })
    }
  }

  text(text, x, baseline, size, options = {}) {
    const style = this.style
    const tracking = options.tracking == null ? style.tracking : options.tracking
    const slant = options.slant == null ? style.slant : options.slant
    const color = this.color(options.color, style.ink)
    const alpha = options.alpha == null ? style.alpha : options.alpha
    const weight = options.weight == null ? style.weight : options.weight
    const bounce = options.bounce == null ? style.bounce : options.bounce
    const rough = Number(options.roughness ?? style.roughness ?? 1)
    const cjkStyle = options.cjkStyle === 'outline' ? 'outline' : 'line'
    const lines = normalizeText(text).split('\n')
    const lineHeight = size * 1.18
    const align = options.align || 'left'
    const measured = Math.max(0, ...lines.map((line) => measureText(line, size, tracking).width))
    let originX = x
    if (align === 'center') originX = x - measured / 2
    if (align === 'right') originX = x - measured
    lines.forEach((lineText, lineIndex) => {
      let pen = originX
      const base = baseline + lineIndex * lineHeight
      for (const ch of lineText) {
        const glyph = glyphFor(ch)
        const dy = (this.rng.next() * 2 - 1) * bounce * size
        const cjkLine = glyph.cjk && cjkStyle === 'line'
        const slantScale = glyph.cjk ? 0.25 : 1
        const cjkRough = glyph.cjk ? 1 + (rough - 1) * (cjkLine ? 0.85 : 0.45) : rough
        const ampBase = (options.jitter == null ? style.jitter : options.jitter) * (0.7 + size * 0.012) * cjkRough
        const ampRaw = ampBase * (glyph.cjk ? (cjkLine ? 1.6 : 0.28) : 1)
        const amp = cjkLine ? Math.min(ampRaw, size * 0.06) : ampRaw
        const wobbleX = glyph.cjk ? (this.rng.next() * 2 - 1) * size * (cjkLine ? 0.032 : 0.006) * cjkRough : 0
        const cjkRot = cjkLine ? (this.rng.next() * 2 - 1) * 0.11 * cjkRough * Math.min(1, size / 150) : 0
        const rotatePoint = cjkRot
          ? (p) => {
              const cx = pen + size * 0.5
              const cy = base - size * 0.5
              const c = Math.cos(cjkRot)
              const s = Math.sin(cjkRot)
              const dx = p[0] - cx
              const dy2 = p[1] - cy
              return [cx + dx * c - dy2 * s, cy + dx * s + dy2 * c]
            }
          : (p) => p
        const useOutlines = Boolean(glyph.outlines && glyph.outlines.length) && !(glyph.cjk && cjkStyle === 'line')
        if (useOutlines) {
          for (let outlineIndex = 0; outlineIndex < glyph.outlines.length; outlineIndex += 1) {
            const outline = glyph.outlines[outlineIndex]
            const pts = outline.map((p) => [
              pen + wobbleX + p[0] * size + slant * slantScale * p[1] * size,
              base - p[1] * size + dy,
            ])
            const median = (glyph.strokes[outlineIndex] || []).map((p) => [
              pen + wobbleX + p[0] * size + slant * slantScale * p[1] * size,
              base - p[1] * size + dy,
            ])
            const jittered = jitterPoints(pts, amp * 0.9, this.rng, { closed: true, wave: 0.45 })
            this.fill(jittered, { color, alpha, median })
          }
        } else {
          const lineArt = glyph.cjk && cjkStyle === 'line'
          for (const stroke of glyph.strokes) {
            if (stroke.length < 2) continue
            const pts = stroke.map((p) => rotatePoint([
              pen + wobbleX + p[0] * size + slant * slantScale * p[1] * size + (this.rng.next() * 2 - 1) * 0.28,
              base - p[1] * size + dy,
            ]))
            const jittered = jitterPoints(pts, amp, this.rng, { wave: 0.7 })
            const glyphWeight = size * weight * (glyph.cjk ? (lineArt ? 1.15 : 1.65) : 1)
            if (lineArt) {
              this.stroke(jittered, {
                width: glyphWeight,
                jitterPx: 0,
                overshoot: 0,
                taper: 0,
                color,
                alpha,
              })
            } else {
              const widths = jittered.map((_, i) => {
                const t = i / Math.max(1, jittered.length - 1)
                return glyphWeight * (0.63 + 0.37 * Math.sin(Math.PI * Math.min(1, t)))
              })
              this.stroke(jittered, {
                widths,
                jitterPx: 0,
                overshoot: rough > 1.25 ? glyphWeight * 0.35 : 0,
                color,
                alpha,
              })
            }
          }
        }
        pen += glyph.advance * size + tracking * size
      }
    })
    return measured
  }
}

function paperValue(args, style) {
  if (args.paper === false) return false
  if (typeof args.paper === 'string') return args.paper
  if (args.paper === true) return style.paper
  return style.paper
}

export function renderText(args = {}) {
  const style = resolveStyle(args.style, args.profile)
  if (Number.isFinite(Number(args.roughness))) style.roughness = Number(args.roughness)
  const original = normalizeText(args.text ?? '')
  if (!original.trim()) throw new Error('TEXT_EMPTY: text 不能为空')
  const size = clamp(Number(args.size) || 132, 12, 480)
  const tracking = style.tracking
  const requestedWidth = Number(args.width) ? clamp(Number(args.width), 64, 4096) : null
  const padding = Math.max(24, Math.round(size * 0.38))
  const wrapWidth = (requestedWidth || 4096) - padding * 2
  const text = wrapText(original, size, tracking, wrapWidth)
  const measured = measureText(text, size, tracking)
  const width = Math.max(1, Math.round(requestedWidth || measured.width + padding * 2))
  const height = Math.max(1, Math.round(Number(args.height) || measured.height + padding * 2))
  const paper = paperValue(args, style)
  const seed = Number.isFinite(Number(args.seed)) ? Number(args.seed) : (Date.now() ^ 0x9e3779b9) >>> 0
  const renderer = new Renderer({
    width,
    height,
    style,
    seed,
    paper,
    maxOps: args.maxOps,
    revealOp: args.revealOp,
    revealProgress: args.revealProgress,
  })
  const baseline = padding + size * 0.82
  renderer.text(text, args.align === 'center' ? width / 2 : args.align === 'right' ? width - padding : padding, baseline, size, {
    align: args.align || 'left',
    color: args.color,
    alpha: args.alpha,
    roughness: style.roughness,
    cjkStyle: args.cjkStyle,
  })
  return {
    png: renderer.canvas.toPng(),
    svg: renderer.svg.toString(),
    width,
    height,
    seed,
    style,
    text,
    measured,
    ops: renderer.opCount,
  }
}

export function applyTransform(point, transform = {}) {
  let [x, y] = point
  if (transform.rotate) {
    const a = (Number(transform.rotate) * Math.PI) / 180
    const c = Math.cos(a)
    const s = Math.sin(a)
    ;[x, y] = [x * c - y * s, x * s + y * c]
  }
  const scale = Number(transform.scale ?? 1)
  x *= scale
  y *= scale
  x += Number(transform.x ?? 0)
  y += Number(transform.y ?? 0)
  return [x, y]
}

export function drawElements(renderer, elements, transform) {
  if (!Array.isArray(elements)) return
  for (const el of elements) {
    if (!el || typeof el !== 'object') continue
    const type = el.type
    if (type === 'group') {
      const next = {
        ...transform,
        x: Number(transform?.x ?? 0) + Number(el.transform?.x ?? 0),
        y: Number(transform?.y ?? 0) + Number(el.transform?.y ?? 0),
        scale: Number(transform?.scale ?? 1) * Number(el.transform?.scale ?? 1),
        rotate: Number(transform?.rotate ?? 0) + Number(el.transform?.rotate ?? 0),
      }
      drawElements(renderer, el.children, next)
      continue
    }
    const points = (el.points || []).map((p) => applyTransform(p, transform))
    if (type === 'line') {
      const a = applyTransform([Number(el.x1), Number(el.y1)], transform)
      const b = applyTransform([Number(el.x2), Number(el.y2)], transform)
      renderer.stroke([a, b], { color: el.color, width: el.width, alpha: el.alpha, jitter: el.jitter })
    } else if (type === 'path') {
      renderer.stroke(points, {
        color: el.color,
        width: el.width,
        alpha: el.alpha,
        closed: el.closed,
        jitter: el.jitter,
      })
      if (el.fill) renderer.fill(points, { color: el.color || el.fill, alpha: el.alpha })
    } else if (type === 'circle') {
      const c = applyTransform([Number(el.cx), Number(el.cy)], transform)
      const scale = Number(transform?.scale ?? 1) * Number(el.scale ?? 1)
      renderer.circle(c[0], c[1], Number(el.r) * scale, {
        fill: el.fill,
        stroke: el.stroke,
        color: el.color,
        width: el.width,
        alpha: el.alpha,
      })
    } else if (type === 'ellipse') {
      const c = applyTransform([Number(el.cx), Number(el.cy)], transform)
      const scale = Number(transform?.scale ?? 1) * Number(el.scale ?? 1)
      const pts = ellipsePoints(c[0], c[1], Number(el.rx) * scale, Number(el.ry) * scale, 64)
      if (el.fill) renderer.fill(pts, { color: el.fill, alpha: el.fillAlpha ?? 1 })
      renderer.stroke(pts, { color: el.color, width: el.width, alpha: el.alpha, closed: true })
    } else if (type === 'rect') {
      const p = applyTransform([Number(el.x), Number(el.y)], transform)
      const scale = Number(transform?.scale ?? 1)
      renderer.rect(p[0], p[1], Number(el.w) * scale, Number(el.h) * scale, {
        fill: el.fill,
        stroke: el.stroke,
        color: el.color,
        width: el.width,
        alpha: el.alpha,
      })
    } else if (type === 'text') {
      const p = applyTransform([Number(el.x), Number(el.y)], transform)
      renderer.text(el.text, p[0], p[1], Number(el.size) || 48, {
        align: el.align,
        color: el.color,
        alpha: el.alpha,
        tracking: el.tracking,
      })
    }
  }
}

export function drawFreeStrokes(renderer, strokes) {
  if (!Array.isArray(strokes)) return
  for (const stroke of strokes) {
    if (!stroke || !Array.isArray(stroke.points)) continue
    renderer.stroke(stroke.points, {
      color: stroke.color,
      width: stroke.width,
      alpha: stroke.alpha,
      jitter: stroke.jitter,
      closed: stroke.closed,
    })
  }
}

export function renderScene(args = {}) {
  const style = resolveStyle(args.style, args.profile)
  if (Number.isFinite(Number(args.roughness))) style.roughness = Number(args.roughness)
  const width = Math.max(64, Math.round(Number(args.width) || 1200))
  const height = Math.max(64, Math.round(Number(args.height) || 800))
  const paper = paperValue(args, style)
  const seed = Number.isFinite(Number(args.seed)) ? Number(args.seed) : (Date.now() ^ 0x85ebca6b) >>> 0
  const renderer = new Renderer({
    width,
    height,
    style,
    seed,
    paper,
    maxOps: args.maxOps,
    revealOp: args.revealOp,
    revealProgress: args.revealProgress,
  })
  if (args.ground !== false && ['tree', 'house', 'stick_figure'].includes(args.template)) {
    const requestedY = Number(args.params?.y)
    const groundY = Math.min(height - 8, Math.max(8, Number.isFinite(requestedY) ? requestedY : height * 0.82))
    const ground = []
    for (let x = 24; x <= width - 24; x += 10) {
      ground.push([x, groundY + Math.sin(x * 0.02) * 2 + (renderer.rng.next() * 2 - 1) * 0.8])
    }
    renderer.stroke(ground, { color: style.ink, width: 2.2, alpha: 0.45, jitter: 0.5 })
  }
  if (args.template) {
    const template = TEMPLATES[args.template]
    if (!template) throw new Error(`TEMPLATE_UNKNOWN: 没有模板 ${args.template}`)
    const params = fillParams(template, args.params || {})
    const errors = validateParams(template, params)
    if (errors.length) throw new Error(`PARAM_INVALID: ${errors.join('; ')}`)
    template.draw(renderer, params, { width, height })
  }
  drawElements(renderer, args.elements)
  drawFreeStrokes(renderer, args.strokes)
  if (args.caption) {
    const captionSize = Math.min(56, Math.max(20, Math.round(width / 22)))
    renderer.text(String(args.caption), width / 2, height - captionSize * 1.1, captionSize, {
      align: 'center',
      color: args.captionColor || style.ink,
      alpha: 0.82,
      cjkStyle: args.cjkStyle,
      roughness: style.roughness,
    })
  }
  return {
    png: renderer.canvas.toPng(),
    svg: renderer.svg.toString(),
    width,
    height,
    seed,
    style,
    ops: renderer.opCount,
  }
}
