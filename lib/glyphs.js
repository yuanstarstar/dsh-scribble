import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const DATA = JSON.parse(fs.readFileSync(path.join(ROOT, 'hershey.json'), 'utf8'))

export const FONT_META = DATA.meta
export const GLYPHS = DATA.glyphs

const FALLBACKS = {
  '\u2014': '-',
  '\u2013': '-',
  '\u2018': "'",
  '\u2019': "'",
  '\u201c': '"',
  '\u201d': '"',
  '\u00a0': ' ',
  '\uff0c': ',',
  '\u3002': '.',
  '\u3001': ',',
  '\uff1f': '?',
  '\uff01': '!',
  '\uff1a': ':',
  '\uff1b': ';',
  '\uff08': '(',
  '\uff09': ')',
  '\u3010': '[',
  '\u3011': ']',
  '\u300a': '<',
  '\u300b': '>',
  '\u300c': '"',
  '\u300d': '"',
  '\u300e': '"',
  '\u300f': '"',
  '\u2026': '...',
}

export function normalizeText(text) {
  return String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, '    ')
    .split('')
    .map((ch) => FALLBACKS[ch] || ch)
    .join('')
}

export function installGlyphs(map) {
  if (!map || typeof map[Symbol.iterator] !== 'function') return 0
  let count = 0
  for (const [ch, glyph] of map) {
    if (!ch || !glyph) continue
    GLYPHS[ch] = glyph
    count += 1
  }
  return count
}

export function glyphFor(ch) {
  if (GLYPHS[ch]) return GLYPHS[ch]
  if (ch && GLYPHS[ch.toUpperCase()]) return GLYPHS[ch.toUpperCase()]
  if (ch === ' ') return { advance: 0.33, strokes: [] }
  return GLYPHS['?'] || { advance: 0.5, strokes: [] }
}

export function unsupportedChars(text) {
  const bad = new Set()
  for (const ch of normalizeText(text)) {
    if (ch === '\n' || ch === ' ' || GLYPHS[ch]) continue
    if (GLYPHS[ch.toUpperCase()]) continue
    bad.add(ch)
  }
  return [...bad]
}

export function measureLine(text, size, tracking) {
  let width = 0
  for (const ch of text) {
    const glyph = glyphFor(ch)
    width += glyph.advance * size + tracking * size
  }
  return Math.max(0, width - tracking * size)
}

export function measureText(text, size, tracking) {
  const lines = normalizeText(text).split('\n')
  return {
    width: Math.max(0, ...lines.map((line) => measureLine(line, size, tracking))),
    height: lines.length * size * 1.18,
    lines,
  }
}

export function wrapText(text, size, tracking, maxWidth) {
  const source = normalizeText(text)
  if (!maxWidth || maxWidth <= 0) return source
  const out = []
  for (const paragraph of source.split('\n')) {
    if (!paragraph) {
      out.push('')
      continue
    }
    let line = ''
    for (const token of paragraph.match(/\s+|[^\s]+/g) || []) {
      const candidate = line + token
      if (measureLine(candidate.trimEnd(), size, tracking) <= maxWidth || !line.trim()) {
        line = candidate
        continue
      }
      out.push(line.trimEnd())
      line = token.trimStart()
      while (line && measureLine(line, size, tracking) > maxWidth) {
        let cut = 1
        while (cut < line.length && measureLine(line.slice(0, cut + 1), size, tracking) <= maxWidth) cut += 1
        out.push(line.slice(0, cut))
        line = line.slice(cut)
      }
    }
    if (line) out.push(line.trimEnd())
  }
  return out.join('\n')
}
