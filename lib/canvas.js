import zlib from 'node:zlib'
import { clamp } from './random.js'

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buffer) {
  let c = 0xffffffff
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii')
  const body = Buffer.concat([typeBuffer, data])
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  body.copy(out, 4)
  out.writeUInt32BE(crc32(body), 8 + data.length)
  return out
}

export function encodePng(rgba, width, height) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const NAMED = {
  black: [0.02, 0.02, 0.02],
  white: [1, 1, 1],
  red: [0.78, 0.2, 0.16],
  blue: [0.16, 0.32, 0.62],
  green: [0.2, 0.48, 0.3],
  orange: [0.9, 0.5, 0.16],
  yellow: [0.95, 0.78, 0.2],
  brown: [0.38, 0.26, 0.16],
  gray: [0.45, 0.45, 0.45],
  grey: [0.45, 0.45, 0.45],
  paper: [0.965, 0.947, 0.91],
  ink: [0.12, 0.15, 0.23],
}

export function parseColor(value, fallback = NAMED.ink) {
  if (Array.isArray(value) && value.length >= 3) {
    return value.slice(0, 3).map((v) => (v > 1 ? v / 255 : v))
  }
  if (typeof value !== 'string') return fallback
  const text = value.trim().toLowerCase()
  if (text.startsWith('#')) {
    let hex = text.slice(1)
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('')
    if (hex.length === 6 || hex.length === 8) {
      return [parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255]
    }
  }
  const rgb = text.match(/^rgba?\(([^)]+)\)$/)
  if (rgb) {
    const parts = rgb[1].split(',').map((v) => Number.parseFloat(v))
    if (parts.length >= 3) return parts.slice(0, 3).map((v) => (v > 1 ? v / 255 : v))
  }
  if (NAMED[text]) return NAMED[text]
  return fallback
}

function cssRgb(color, alpha = 1) {
  const [r, g, b] = color
  return `rgba(${Math.round(clamp(r, 0, 1) * 255)},${Math.round(clamp(g, 0, 1) * 255)},${Math.round(
    clamp(b, 0, 1) * 255,
  )},${clamp(alpha, 0, 1).toFixed(3)})`
}

export class Canvas {
  constructor(width, height, options = {}) {
    this.width = Math.max(1, Math.round(width))
    this.height = Math.max(1, Math.round(height))
    this.scale = Math.max(1, Math.min(3, Number(options.scale) || 2))
    this.dw = this.width * this.scale
    this.dh = this.height * this.scale
    this.paper = options.paper === false ? null : parseColor(options.paper, NAMED.paper)
    this.data = new Float32Array(this.dw * this.dh * 4)
    if (this.paper) {
      for (let i = 0; i < this.dw * this.dh; i += 1) {
        this.data[i * 4] = this.paper[0]
        this.data[i * 4 + 1] = this.paper[1]
        this.data[i * 4 + 2] = this.paper[2]
        this.data[i * 4 + 3] = 1
      }
    }
  }

  blend(x, y, color, alpha) {
    if (x < 0 || y < 0 || x >= this.dw || y >= this.dh) return
    const a = clamp(alpha, 0, 1)
    if (a <= 0) return
    const i = (y * this.dw + x) * 4
    const da = this.data[i + 3]
    const oa = a + da * (1 - a)
    if (oa <= 1e-8) return
    this.data[i] = (color[0] * a + this.data[i] * da * (1 - a)) / oa
    this.data[i + 1] = (color[1] * a + this.data[i + 1] * da * (1 - a)) / oa
    this.data[i + 2] = (color[2] * a + this.data[i + 2] * da * (1 - a)) / oa
    this.data[i + 3] = oa
  }

  capsule(x1, y1, r1, x2, y2, r2, color, alpha) {
    const s = this.scale
    const X1 = x1 * s
    const Y1 = y1 * s
    const X2 = x2 * s
    const Y2 = y2 * s
    const R1 = Math.max(0.35, r1 * s)
    const R2 = Math.max(0.35, r2 * s)
    const dx = X2 - X1
    const dy = Y2 - Y1
    const len2 = dx * dx + dy * dy
    const radius = Math.max(R1, R2)
    const minX = Math.max(0, Math.floor(Math.min(X1, X2) - radius - 2))
    const maxX = Math.min(this.dw - 1, Math.ceil(Math.max(X1, X2) + radius + 2))
    const minY = Math.max(0, Math.floor(Math.min(Y1, Y2) - radius - 2))
    const maxY = Math.min(this.dh - 1, Math.ceil(Math.max(Y1, Y2) + radius + 2))
    for (let y = minY; y <= maxY; y += 1) {
      const py = y + 0.5
      for (let x = minX; x <= maxX; x += 1) {
        const px = x + 0.5
        let t = 0
        if (len2 > 1e-9) t = clamp(((px - X1) * dx + (py - Y1) * dy) / len2, 0, 1)
        const qx = X1 + t * dx
        const qy = Y1 + t * dy
        const d = Math.hypot(px - qx, py - qy)
        const rr = R1 + (R2 - R1) * t
        const cov = clamp((rr + 0.55 - d) / 1.1, 0, 1)
        if (cov > 0) this.blend(x, y, color, alpha * cov)
      }
    }
  }

  polyline(points, widths, color, alpha = 1) {
    if (!Array.isArray(points) || points.length < 2) return
    for (let i = 0; i < points.length - 1; i += 1) {
      const w1 = Array.isArray(widths) ? widths[i] : widths
      const w2 = Array.isArray(widths) ? widths[i + 1] : widths
      this.capsule(points[i][0], points[i][1], w1 / 2, points[i + 1][0], points[i + 1][1], w2 / 2, color, alpha)
    }
  }

  fillCircle(cx, cy, r, color, alpha = 1) {
    const s = this.scale
    const CX = cx * s
    const CY = cy * s
    const R = Math.max(0.35, r * s)
    const minX = Math.max(0, Math.floor(CX - R - 2))
    const maxX = Math.min(this.dw - 1, Math.ceil(CX + R + 2))
    const minY = Math.max(0, Math.floor(CY - R - 2))
    const maxY = Math.min(this.dh - 1, Math.ceil(CY + R + 2))
    for (let y = minY; y <= maxY; y += 1) {
      const py = y + 0.5
      for (let x = minX; x <= maxX; x += 1) {
        const px = x + 0.5
        const d = Math.hypot(px - CX, py - CY)
        const cov = clamp((R + 0.55 - d) / 1.1, 0, 1)
        if (cov > 0) this.blend(x, y, color, alpha * cov)
      }
    }
  }

  fillRect(x, y, w, h, color, alpha = 1) {
    const s = this.scale
    const x0 = Math.max(0, Math.floor(x * s))
    const y0 = Math.max(0, Math.floor(y * s))
    const x1 = Math.min(this.dw - 1, Math.ceil((x + w) * s))
    const y1 = Math.min(this.dh - 1, Math.ceil((y + h) * s))
    for (let py = y0; py <= y1; py += 1) {
      for (let px = x0; px <= x1; px += 1) this.blend(px, py, color, alpha)
    }
  }

  toPng() {
    const rgba = Buffer.alloc(this.width * this.height * 4)
    const n = this.scale * this.scale
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        let r = 0
        let g = 0
        let b = 0
        let a = 0
        for (let sy = 0; sy < this.scale; sy += 1) {
          for (let sx = 0; sx < this.scale; sx += 1) {
            const i = (((y * this.scale + sy) * this.dw) + (x * this.scale + sx)) * 4
            const alpha = this.data[i + 3]
            r += this.data[i] * alpha
            g += this.data[i + 1] * alpha
            b += this.data[i + 2] * alpha
            a += alpha
          }
        }
        const o = (y * this.width + x) * 4
        if (a <= 1e-8) {
          rgba[o] = 0
          rgba[o + 1] = 0
          rgba[o + 2] = 0
          rgba[o + 3] = 0
        } else {
          rgba[o] = Math.round(clamp(r / a, 0, 1) * 255)
          rgba[o + 1] = Math.round(clamp(g / a, 0, 1) * 255)
          rgba[o + 2] = Math.round(clamp(b / a, 0, 1) * 255)
          rgba[o + 3] = Math.round(clamp(a / n, 0, 1) * 255)
        }
      }
    }
    return encodePng(rgba, this.width, this.height)
  }
}

export class SvgDoc {
  constructor(width, height, options = {}) {
    this.width = width
    this.height = height
    this.paper = options.paper === false ? null : parseColor(options.paper, NAMED.paper)
    this.parts = []
  }

  path(points, width, color, alpha = 1, closed = false) {
    if (!Array.isArray(points) || points.length < 2) return
    const d = points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${Number(p[0]).toFixed(2)} ${Number(p[1]).toFixed(2)}`)
      .join(' ')
    this.parts.push(
      `<path d="${d}${closed ? ' Z' : ''}" fill="none" stroke="${cssRgb(color, 1)}" stroke-opacity="${clamp(
        alpha,
        0,
        1,
      ).toFixed(3)}" stroke-width="${Number(width).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`,
    )
  }

  fillPath(points, color, alpha = 1, closed = true) {
    if (!Array.isArray(points) || points.length < 2) return
    const d = points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${Number(p[0]).toFixed(2)} ${Number(p[1]).toFixed(2)}`)
      .join(' ')
    this.parts.push(
      `<path d="${d}${closed ? ' Z' : ''}" fill="${cssRgb(color, 1)}" fill-opacity="${clamp(alpha, 0, 1).toFixed(3)}" stroke="none"/>`,
    )
  }

  circle(cx, cy, r, options = {}) {
    const fill = options.fill ? ` fill="${cssRgb(options.fill, 1)}" fill-opacity="${clamp(options.fillAlpha ?? 1, 0, 1).toFixed(3)}"` : ' fill="none"'
    const stroke = options.stroke
      ? ` stroke="${cssRgb(options.stroke, 1)}" stroke-opacity="${clamp(options.alpha ?? 1, 0, 1).toFixed(3)}" stroke-width="${Number(
          options.width ?? 2,
        ).toFixed(2)}"`
      : ''
    this.parts.push(`<circle cx="${Number(cx).toFixed(2)}" cy="${Number(cy).toFixed(2)}" r="${Number(r).toFixed(2)}"${fill}${stroke}/>`)
  }

  rect(x, y, w, h, options = {}) {
    const fill = options.fill ? ` fill="${cssRgb(options.fill, 1)}" fill-opacity="${clamp(options.fillAlpha ?? 1, 0, 1).toFixed(3)}"` : ' fill="none"'
    const stroke = options.stroke
      ? ` stroke="${cssRgb(options.stroke, 1)}" stroke-opacity="${clamp(options.alpha ?? 1, 0, 1).toFixed(3)}" stroke-width="${Number(
          options.width ?? 2,
        ).toFixed(2)}"`
      : ''
    const rx = options.rx ? ` rx="${Number(options.rx).toFixed(2)}"` : ''
    this.parts.push(
      `<rect x="${Number(x).toFixed(2)}" y="${Number(y).toFixed(2)}" width="${Number(w).toFixed(2)}" height="${Number(
        h,
      ).toFixed(2)}"${rx}${fill}${stroke}/>`,
    )
  }

  toString() {
    const bg = this.paper
      ? `<rect x="0" y="0" width="${this.width}" height="${this.height}" fill="${cssRgb(this.paper, 1)}"/>`
      : ''
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${this.width}" height="${this.height}" viewBox="0 0 ${this.width} ${this.height}">\n${bg}\n${this.parts.join(
      '\n',
    )}\n</svg>\n`
  }
}
