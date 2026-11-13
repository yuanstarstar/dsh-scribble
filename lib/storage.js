import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

export function scribbleRoot() {
  return process.env.DSH_SCRIBBLE_HOME
    ? path.resolve(process.env.DSH_SCRIBBLE_HOME)
    : path.join(os.homedir(), '.dsh', 'scribble')
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function atomicWrite(file, data) {
  ensureDir(path.dirname(file))
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tmp, data)
  fs.renameSync(tmp, file)
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

export function writeJson(file, value) {
  atomicWrite(file, JSON.stringify(value, null, 2))
}

export function appendJsonl(file, value) {
  ensureDir(path.dirname(file))
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`)
}

export function readJsonl(file) {
  try {
    const text = fs.readFileSync(file, 'utf8')
    const out = []
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      try {
        out.push(JSON.parse(line))
      } catch {
        // Skip a torn line rather than losing the whole history.
      }
    }
    return out
  } catch {
    return []
  }
}

export function newId(prefix) {
  const stamp = Date.now().toString(36)
  const random = crypto.randomBytes(4).toString('hex')
  return `${prefix}_${stamp}_${random}`
}

export function safeName(text, fallback = 'scribble') {
  const cleaned = String(text || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 48)
  return cleaned || fallback
}

export function cwdOf(exec) {
  const cwd = exec?.agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd.trim() ? path.resolve(cwd) : process.cwd()
}

export function outputsDir(exec, configured) {
  const cwd = cwdOf(exec)
  if (configured) {
    const resolved = path.resolve(cwd, configured)
    if (!resolved.startsWith(cwd + path.sep) && resolved !== cwd) {
      throw new Error(`OUTPUT_OUTSIDE_WORKSPACE: 输出目录必须在工作区内：${cwd}`)
    }
    return ensureDir(resolved)
  }
  return ensureDir(path.join(cwd, 'scribble-output'))
}

export function writeOutputs(exec, files, options = {}) {
  const dir = outputsDir(exec, options.outputDir)
  const stem = `${safeName(options.filename || options.label)}-${Date.now().toString(36)}`
  const pngPath = path.join(dir, `${stem}.png`)
  const svgPath = path.join(dir, `${stem}.svg`)
  fs.writeFileSync(pngPath, files.png)
  fs.writeFileSync(svgPath, files.svg)
  return { pngPath, svgPath, dir }
}

export function historyFile() {
  return path.join(scribbleRoot(), 'history.jsonl')
}

export function feedbackFile() {
  return path.join(scribbleRoot(), 'feedback.jsonl')
}

export function profilesDir() {
  return ensureDir(path.join(scribbleRoot(), 'profiles'))
}

export function activeFile() {
  return path.join(scribbleRoot(), 'active.json')
}

export function drawingFile(id) {
  return path.join(scribbleRoot(), 'drawings', `${id}.json`)
}

export function recordDrawing(record, snapshot) {
  appendJsonl(historyFile(), record)
  if (snapshot) {
    let text
    try {
      text = JSON.stringify(snapshot)
    } catch {
      return { stored: false, reason: 'snapshot not serializable' }
    }
    if (text.length > 2_000_000) return { stored: false, reason: 'snapshot too large' }
    ensureDir(path.dirname(drawingFile(record.drawingId)))
    fs.writeFileSync(drawingFile(record.drawingId), text)
    return { stored: true, bytes: text.length }
  }
  return { stored: false }
}

export function loadSnapshot(id) {
  return readJson(drawingFile(id), null)
}

export function listHistory(limit = 20) {
  const all = readJsonl(historyFile())
  return all.slice(-Math.max(1, Math.min(200, limit))).reverse()
}

export function findDrawing(id) {
  if (!id) return null
  return readJsonl(historyFile()).find((item) => item.drawingId === id) || null
}

export function lastFeedbackFor(id) {
  const entries = readJsonl(feedbackFile()).filter((item) => item.drawingId === id)
  return entries.length ? entries[entries.length - 1] : null
}
