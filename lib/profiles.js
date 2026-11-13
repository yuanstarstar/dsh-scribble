import fs from 'node:fs'
import path from 'node:path'
import {
  activeFile,
  feedbackFile,
  findDrawing,
  listHistory,
  newId,
  profilesDir,
  readJson,
  readJsonl,
  scribbleRoot,
  writeJson,
  appendJsonl,
  lastFeedbackFor,
} from './storage.js'
import { PRESETS, STYLE_NUMERIC_KEYS, applyFeedbackTags, numericStyle, resolveStyle } from './style.js'
import { clamp } from './random.js'

function profilePath(id) {
  return path.join(profilesDir(), `${id}.json`)
}

export function listProfiles() {
  const dir = profilesDir()
  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.json'))
  const active = activeProfileId()
  return files
    .map((name) => readJson(path.join(dir, name), null))
    .filter(Boolean)
    .map((profile) => ({ ...profile, active: profile.id === active }))
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
}

export function getProfile(id) {
  if (!id) return null
  return readJson(profilePath(id), null)
}

export function activeProfileId() {
  return readJson(activeFile(), {}).id || null
}

export function setActiveProfile(id) {
  if (!getProfile(id)) throw new Error(`PROFILE_NOT_FOUND: 找不到风格 ${id}`)
  writeJson(activeFile(), { id, updatedAt: new Date().toISOString() })
  return getProfile(id)
}

export function activeProfile() {
  const id = activeProfileId()
  return id ? getProfile(id) : null
}

export function saveProfile(profile) {
  const now = new Date().toISOString()
  const next = { ...profile, updatedAt: now, createdAt: profile.createdAt || now }
  writeJson(profilePath(next.id), next)
  return next
}

function weightedAverage(entries, weights) {
  const sums = {}
  const totals = {}
  let totalWeight = 0
  entries.forEach((entry, index) => {
    const style = numericStyle(entry.style || {})
    const weight = Math.max(0.05, Number(weights?.[index] ?? 1))
    let used = false
    for (const key of STYLE_NUMERIC_KEYS) {
      if (!Number.isFinite(style[key])) continue
      sums[key] = (sums[key] || 0) + style[key] * weight
      totals[key] = (totals[key] || 0) + weight
      used = true
    }
    if (used) totalWeight += weight
  })
  const style = {}
  for (const key of STYLE_NUMERIC_KEYS) {
    if (totals[key]) style[key] = sums[key] / totals[key]
  }
  return { style, totalWeight }
}

export function captureProfile(args = {}) {
  let entries
  if (Array.isArray(args.drawingIds) && args.drawingIds.length) {
    entries = args.drawingIds.map((id) => findDrawing(id))
    const missing = args.drawingIds.filter((id, index) => !entries[index])
    if (missing.length) throw new Error(`DRAWING_NOT_FOUND: ${missing.join(', ')}`)
  } else {
    const limit = Math.max(1, Math.min(100, Number(args.limit) || 20))
    entries = listHistory(limit).reverse()
  }
  const usable = entries.filter((entry) => Object.keys(numericStyle(entry.style || {})).length > 0)
  if (!usable.length) throw new Error('NO_STYLE_SAMPLES: 没有可用的绘画风格样本，先用 scribble_write / scribble_draw 画几张')
  const weights = Array.isArray(args.weights) ? args.weights : undefined
  const { style } = weightedAverage(usable, weights)
  const basePreset = args.basePreset || usable[0].style?.preset || 'child'
  const id = args.id || newId('style')
  const profile = saveProfile({
    id,
    name: String(args.name || '我的风格').slice(0, 40),
    basePreset: PRESETS[basePreset] ? basePreset : 'child',
    style,
    confidence: clamp(1 - Math.exp(-usable.length / 4), 0.08, 0.96),
    stats: {
      samples: usable.length,
      liked: usable.filter((entry) => lastFeedbackFor(entry.drawingId)?.rating === 1).length,
      disliked: usable.filter((entry) => lastFeedbackFor(entry.drawingId)?.rating === -1).length,
    },
    glyphDeviations: {},
    preference: { weights: {}, bias: 0 },
    note: String(args.note || '').slice(0, 300),
  })
  if (args.activate !== false) setActiveProfile(id)
  return { profile, samples: usable.length }
}

// 图片矢量化结果 → 风格画像。只吸收数值手感，不复制字形。
export function captureProfileFromImage(features = {}, meta = {}, args = {}) {
  const style = { preset: 'child' }
  for (const key of STYLE_NUMERIC_KEYS) {
    const value = Number(features[key])
    if (Number.isFinite(value)) style[key] = value
  }
  const id = args.id || newId('style')
  const strokes = Number(meta.strokes) || 0
  const profile = saveProfile({
    id,
    name: String(args.name || '照片学来的风格').slice(0, 40),
    basePreset: 'child',
    style,
    confidence: clamp(0.2 + Math.min(0.45, strokes * 0.012), 0.2, 0.72),
    stats: {
      samples: 1,
      feedback: 0,
      liked: 0,
      disliked: 0,
      source: 'image',
      strokes,
      image: meta.image || null,
    },
    glyphDeviations: {},
    preference: { weights: {}, bias: 0 },
    note: String(args.note || '从手写图片学习：只学线条风格，不复制具体字形').slice(0, 300),
  })
  if (args.activate !== false) setActiveProfile(id)
  return profile
}

export function applyFeedback(args = {}) {
  const drawingId = String(args.drawingId || '')
  if (!drawingId) throw new Error('DRAWING_ID_REQUIRED: 需要 drawingId')
  const drawing = findDrawing(drawingId)
  if (!drawing) throw new Error(`DRAWING_NOT_FOUND: 找不到绘画 ${drawingId}`)
  const profile = activeProfile()
  if (!profile) throw new Error('NO_ACTIVE_PROFILE: 还没有学习中的风格，先 scribble_style action:"capture"')
  const rating = Number(args.rating ?? 0)
  if (![-1, 0, 1].includes(rating)) throw new Error('RATING_INVALID: rating 只能是 -1 / 0 / 1')
  const tags = Array.isArray(args.tags) ? args.tags.map(String) : []
  const result = applyFeedbackTags(profile.style || {}, tags)
  const next = {
    ...profile,
    style: result.style,
    confidence: clamp(Number(profile.confidence || 0.1) + (rating > 0 ? 0.03 : rating < 0 ? -0.015 : 0), 0.03, 0.99),
    stats: {
      ...(profile.stats || {}),
      feedback: Number(profile.stats?.feedback || 0) + 1,
      liked: Number(profile.stats?.liked || 0) + (rating > 0 ? 1 : 0),
      disliked: Number(profile.stats?.disliked || 0) + (rating < 0 ? 1 : 0),
    },
  }
  if (args.compareTo && args.preferred) {
    next.preference = {
      ...(next.preference || { weights: {}, bias: 0 }),
      weights: { ...(next.preference?.weights || {}), [String(args.compareTo)]: Number(args.preferred === 'current' ? 1 : -1) },
    }
  }
  saveProfile(next)
  appendJsonl(feedbackFile(), {
    feedbackId: newId('fb'),
    drawingId,
    profileId: next.id,
    rating,
    tags,
    compareTo: args.compareTo ? String(args.compareTo) : null,
    preferred: args.preferred ? String(args.preferred) : null,
    note: String(args.note || '').slice(0, 300),
    changes: result.changes,
    createdAt: new Date().toISOString(),
  })
  return { profile: next, changes: result.changes }
}

export function learnProfile(args = {}) {
  const profile = activeProfile()
  if (!profile) throw new Error('NO_ACTIVE_PROFILE: 还没有学习中的风格，先 capture')
  const limit = Math.max(1, Math.min(200, Number(args.limit) || 30))
  const entries = listHistory(limit).reverse()
  const weights = entries.map((entry) => {
    const feedback = lastFeedbackFor(entry.drawingId)
    if (!feedback) return 1
    if (feedback.rating > 0) return 1.6
    if (feedback.rating < 0) return 0.25
    return 1
  })
  const { style } = weightedAverage(entries, weights)
  if (!Object.keys(style).length) throw new Error('NO_STYLE_SAMPLES: 没有可学习的样本')
  const next = saveProfile({
    ...profile,
    style,
    confidence: clamp(Number(profile.confidence || 0.1) + 0.04, 0.03, 0.99),
    stats: { ...(profile.stats || {}), samples: entries.length, learnedAt: new Date().toISOString() },
  })
  return { profile: next, samples: entries.length }
}

export function deleteProfile(id) {
  const profile = getProfile(id)
  if (!profile) throw new Error(`PROFILE_NOT_FOUND: 找不到风格 ${id}`)
  fs.rmSync(profilePath(id), { force: true })
  if (activeProfileId() === id) fs.rmSync(activeFile(), { force: true })
  return { id, name: profile.name }
}

export function resetActive() {
  const profile = activeProfile()
  if (!profile) return { reset: false }
  const next = saveProfile({
    ...profile,
    style: {},
    confidence: 0.05,
    glyphDeviations: {},
    preference: { weights: {}, bias: 0 },
    stats: { samples: 0, feedback: 0, liked: 0, disliked: 0 },
  })
  return { reset: true, profile: next }
}

export function historyWithRatings(limit = 20) {
  return listHistory(limit).map((entry) => {
    const feedback = lastFeedbackFor(entry.drawingId)
    return { ...entry, rating: feedback?.rating ?? null, feedbackTags: feedback?.tags ?? [] }
  })
}

export function profileSummary(profile) {
  if (!profile) return '未启用风格（使用内置预设）'
  return `${profile.name}（${profile.id}，样本 ${profile.stats?.samples ?? 0}，置信度 ${(Number(profile.confidence || 0) * 100).toFixed(
    0,
  )}%）`
}

export function profileExport(profile) {
  return JSON.stringify(profile, null, 2)
}

export function profilePathFor(id) {
  return profilePath(id)
}

export function rootPath() {
  return scribbleRoot()
}
