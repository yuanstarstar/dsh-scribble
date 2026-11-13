import { clamp } from './random.js'

export const STYLE_NUMERIC_KEYS = [
  'slant',
  'weight',
  'contrast',
  'roundness',
  'jitter',
  'roughness',
  'bounce',
  'tracking',
  'taper',
  'alpha',
  'xHeight',
  'capHeight',
]

export const STYLE_RANGES = {
  slant: [-0.35, 0.35],
  weight: [0.008, 0.14],
  contrast: [0, 1],
  roundness: [0, 1],
  jitter: [0, 3],
  roughness: [0.4, 2.5],
  bounce: [0, 0.06],
  tracking: [-0.08, 0.25],
  taper: [0, 1],
  alpha: [0.25, 1],
  xHeight: [0.2, 0.8],
  capHeight: [0.4, 1.2],
}

export const PRESETS = {
  clean: {
    label: '干净',
    slant: 0.012,
    weight: 0.026,
    contrast: 0.16,
    roundness: 0.45,
    jitter: 0.18,
    bounce: 0.0015,
    tracking: 0.03,
    taper: 0.2,
    alpha: 0.97,
    ink: '#1f2937',
    paper: '#f8f5ec',
  },
  pencil: {
    label: '铅笔',
    slant: 0.03,
    weight: 0.031,
    contrast: 0.34,
    roundness: 0.5,
    jitter: 0.62,
    bounce: 0.0035,
    tracking: 0.025,
    taper: 0.38,
    alpha: 0.9,
    ink: '#30302e',
    paper: '#faf6e9',
  },
  brush: {
    label: '毛笔',
    slant: 0.045,
    weight: 0.064,
    contrast: 0.58,
    roundness: 0.6,
    jitter: 0.42,
    bounce: 0.005,
    tracking: 0.018,
    taper: 0.72,
    alpha: 0.94,
    ink: '#111827',
    paper: '#f6efe1',
  },
  child: {
    label: '童趣',
    slant: 0.038,
    weight: 0.043,
    contrast: 0.4,
    roundness: 0.67,
    jitter: 1.18,
    bounce: 0.008,
    tracking: 0.028,
    taper: 0.42,
    alpha: 0.95,
    ink: '#1f2937',
    paper: '#f7f2e5',
  },
  ink: {
    label: '钢笔',
    slant: 0.055,
    weight: 0.022,
    contrast: 0.52,
    roundness: 0.42,
    jitter: 0.3,
    roughness: 1,
    bounce: 0.002,
    tracking: 0.032,
    taper: 0.55,
    alpha: 0.96,
    ink: '#172033',
    paper: '#fbf8ef',
  },
  messy: {
    label: '歪歪扭扭',
    slant: 0.085,
    weight: 0.052,
    contrast: 0.46,
    roundness: 0.72,
    jitter: 1.35,
    roughness: 1.2,
    bounce: 0.018,
    tracking: 0.055,
    taper: 0.34,
    alpha: 0.93,
    ink: '#23201d',
    paper: '#f7f0df',
  },
}

export const STYLE_NAMES = Object.keys(PRESETS)

export function resolveStyle(input, profile) {
  const presetName = typeof input === 'string' ? input : profile?.basePreset || 'child'
  const preset = PRESETS[presetName] || PRESETS.child
  const base = { ...preset, preset: PRESETS[presetName] ? presetName : 'child' }
  if (profile?.style && typeof profile.style === 'object') {
    for (const key of STYLE_NUMERIC_KEYS) {
      if (Number.isFinite(Number(profile.style[key]))) base[key] = Number(profile.style[key])
    }
  }
  // 显式指定预设时，预设优先于画像；画像只在“沿用当前风格”时生效。
  if (typeof input === 'string' && PRESETS[input]) Object.assign(base, PRESETS[input], { preset: input })
  if (input && typeof input === 'object') {
    if (input.preset && PRESETS[input.preset]) Object.assign(base, PRESETS[input.preset], { preset: input.preset })
    for (const [key, value] of Object.entries(input)) {
      if (key === 'preset' || key === 'label') continue
      if (STYLE_NUMERIC_KEYS.includes(key) && Number.isFinite(Number(value))) base[key] = Number(value)
      else if (key === 'ink' || key === 'paper' || key === 'color') base[key] = value
    }
  }
  for (const [key, [min, max]] of Object.entries(STYLE_RANGES)) {
    if (Number.isFinite(Number(base[key]))) base[key] = clamp(Number(base[key]), min, max)
  }
  return base
}

export function numericStyle(style) {
  const out = {}
  for (const key of STYLE_NUMERIC_KEYS) {
    if (Number.isFinite(Number(style?.[key]))) out[key] = Number(style[key])
  }
  return out
}

export function styleSummary(style) {
  const parts = []
  for (const key of ['slant', 'weight', 'jitter', 'tracking', 'taper', 'alpha']) {
    if (Number.isFinite(Number(style?.[key]))) parts.push(`${key}=${Number(style[key]).toFixed(3)}`)
  }
  return parts.join(' ')
}

export function applyFeedbackTags(style, tags) {
  const next = { ...style }
  const changes = []
  const bump = (key, delta) => {
    const before = Number(next[key])
    const [min, max] = STYLE_RANGES[key]
    next[key] = clamp(before + delta, min, max)
    if (Math.abs(next[key] - before) > 1e-9) changes.push(`${key} ${before.toFixed(3)}→${next[key].toFixed(3)}`)
  }
  for (const tag of tags || []) {
    if (tag === 'too_tidy') {
      bump('jitter', 0.12)
      bump('bounce', 0.001)
    } else if (tag === 'too_messy') {
      bump('jitter', -0.12)
      bump('bounce', -0.001)
    } else if (tag === 'too_slanted') {
      bump('slant', -0.02)
    } else if (tag === 'too_straight') {
      bump('slant', 0.02)
    } else if (tag === 'too_thin') {
      bump('weight', 0.004)
    } else if (tag === 'too_thick') {
      bump('weight', -0.004)
    } else if (tag === 'too_round') {
      bump('roundness', -0.08)
    } else if (tag === 'too_sharp') {
      bump('roundness', 0.08)
    } else if (tag === 'too_tight') {
      bump('tracking', 0.008)
    } else if (tag === 'too_loose') {
      bump('tracking', -0.008)
    }
  }
  return { style: next, changes }
}
