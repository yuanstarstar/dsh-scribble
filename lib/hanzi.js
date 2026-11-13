import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DATA_VERSION = '2.0.1'
const CDN = `https://cdn.jsdelivr.net/npm/hanzi-writer-data@${DATA_VERSION}`
const CJK_RE = /^[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]$/

export function isCjkChar(ch) {
  return CJK_RE.test(ch)
}

export function hasCjk(text) {
  return [...String(text ?? '')].some(isCjkChar)
}

function cacheRoot() {
  const home = process.env.DSH_SCRIBBLE_HOME || path.join(os.homedir(), '.dsh', 'scribble')
  return path.join(home, 'hanzi', DATA_VERSION)
}

function cachePath(ch) {
  return path.join(cacheRoot(), `${ch.codePointAt(0).toString(16)}.json`)
}

function toEm([x, y]) {
  return [x / 1024, y / 1024]
}

function parsePath(d) {
  const tokens = String(d).match(/[MmLlQqCcZz]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) || []
  const out = []
  let points = []
  let current = [0, 0]
  let start = [0, 0]
  let i = 0
  const num = () => Number(tokens[i++])
  const push = (p) => points.push(toEm(p))
  while (i < tokens.length) {
    const cmd = tokens[i++]
    if (cmd === 'M' || cmd === 'm') {
      if (points.length) out.push(points)
      const p = [num(), num()]
      current = cmd === 'm' ? [current[0] + p[0], current[1] + p[1]] : p
      start = current
      points = []
      push(current)
    } else if (cmd === 'L' || cmd === 'l') {
      const p = [num(), num()]
      current = cmd === 'l' ? [current[0] + p[0], current[1] + p[1]] : p
      push(current)
    } else if (cmd === 'Q' || cmd === 'q') {
      const c = [num(), num()]
      const p = [num(), num()]
      const cc = cmd === 'q' ? [current[0] + c[0], current[1] + c[1]] : c
      const pp = cmd === 'q' ? [current[0] + p[0], current[1] + p[1]] : p
      const p0 = current
      for (let s = 1; s <= 8; s += 1) {
        const t = s / 8
        const u = 1 - t
        push([
          u * u * p0[0] + 2 * u * t * cc[0] + t * t * pp[0],
          u * u * p0[1] + 2 * u * t * cc[1] + t * t * pp[1],
        ])
      }
      current = pp
    } else if (cmd === 'C' || cmd === 'c') {
      const c1 = [num(), num()]
      const c2 = [num(), num()]
      const p = [num(), num()]
      const cc1 = cmd === 'c' ? [current[0] + c1[0], current[1] + c1[1]] : c1
      const cc2 = cmd === 'c' ? [current[0] + c2[0], current[1] + c2[1]] : c2
      const pp = cmd === 'c' ? [current[0] + p[0], current[1] + p[1]] : p
      const p0 = current
      for (let s = 1; s <= 10; s += 1) {
        const t = s / 10
        const u = 1 - t
        push([
          u * u * u * p0[0] + 3 * u * u * t * cc1[0] + 3 * u * t * t * cc2[0] + t * t * t * pp[0],
          u * u * u * p0[1] + 3 * u * u * t * cc1[1] + 3 * u * t * t * cc2[1] + t * t * t * pp[1],
        ])
      }
      current = pp
    } else if (cmd === 'Z' || cmd === 'z') {
      if (points.length) out.push(points)
      points = []
      current = start
    }
  }
  if (points.length) out.push(points)
  return out.filter((poly) => poly.length >= 3)
}

function toGlyph(data) {
  const outlines = Array.isArray(data.strokes)
    ? data.strokes.flatMap((d) => parsePath(d))
    : []
  const medians = Array.isArray(data.medians)
    ? data.medians.map((stroke) => stroke.map(toEm)).filter((stroke) => stroke.length >= 2)
    : []
  if (!outlines.length && !medians.length) throw new Error('HANZI_EMPTY: 这个字没有可用笔画数据')
  return { advance: 1, strokes: medians, outlines, cjk: true }
}

async function fetchHanzi(ch) {
  const url = `${CDN}/${encodeURIComponent(ch)}.json`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12000)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

export async function loadHanzi(ch) {
  if (!isCjkChar(ch)) throw new Error(`HANZI_NOT_CJK: ${ch}`)
  const file = cachePath(ch)
  if (fs.existsSync(file)) {
    try {
      return toGlyph(JSON.parse(fs.readFileSync(file, 'utf8')))
    } catch {
      try { fs.unlinkSync(file) } catch {}
    }
  }
  const data = await fetchHanzi(ch)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({
    strokes: data.strokes,
    medians: data.medians,
    radStrokes: data.radStrokes,
    _source: `hanzi-writer-data@${DATA_VERSION}`,
    _license: 'Arphic Public License (see ARPHICPL.TXT)',
  }))
  return toGlyph(data)
}

export async function loadHanziText(text) {
  const chars = [...new Set([...String(text ?? '')].filter(isCjkChar))]
  const out = new Map()
  const concurrency = 4
  let cursor = 0
  async function worker() {
    while (cursor < chars.length) {
      const ch = chars[cursor++]
      try {
        out.set(ch, await loadHanzi(ch))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`HANZI_FETCH_FAILED: ${ch} (${message})`)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, chars.length) }, worker))
  return out
}
