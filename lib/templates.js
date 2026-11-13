import { arc, cubic, ellipsePoints, join, line, rectPoints } from './render.js'
import { ellipseNormal, ellipseOutsideCircleArcs, pointOnEllipse, pointOnEllipseAtX } from './geometry.js'

const ACCENT = {
  red: '#b43a2e',
  green: '#3f7a4c',
  ochre: '#d99a2b',
  brown: '#5d4229',
  blue: '#3b5b8c',
}

const FACE = {
  happy: (r, x, y, s) => {
    r.stroke(arc(x, y, 11 * s, 7 * s, 0.15, Math.PI - 0.15, 18), { width: 2.2 * s, color: r.style.ink })
  },
  sad: (r, x, y, s) => {
    r.stroke(arc(x, y + 6 * s, 10 * s, 7 * s, Math.PI + 0.2, Math.PI * 2 - 0.2, 18), { width: 2.2 * s, color: r.style.ink })
  },
  surprised: (r, x, y, s) => {
    r.circle(x, y, 5.5 * s, { width: 2.2 * s, color: r.style.ink })
  },
  neutral: (r, x, y, s) => {
    r.stroke(line(x - 10 * s, y, x + 10 * s, y), { width: 2.2 * s, color: r.style.ink })
  },
}

function eyes(r, x, y, s, mood) {
  if (mood === 'happy') {
    r.stroke(arc(x - 14 * s, y, 5 * s, 3.5 * s, Math.PI + 0.2, Math.PI * 2 - 0.2, 10), { width: 2 * s, color: r.style.ink })
    r.stroke(arc(x + 14 * s, y, 5 * s, 3.5 * s, Math.PI + 0.2, Math.PI * 2 - 0.2, 10), { width: 2 * s, color: r.style.ink })
  } else {
    r.circle(x - 14 * s, y, 3.2 * s, { fill: r.style.ink, stroke: false })
    r.circle(x + 14 * s, y, 3.2 * s, { fill: r.style.ink, stroke: false })
  }
}

function cloud(r, x, y, scale, color) {
  const pts = []
  const lobes = [
    [-46, 8, 26],
    [-20, -8, 32],
    [16, -4, 30],
    [42, 12, 22],
  ]
  for (const [dx, dy, rad] of lobes) {
    pts.push(...ellipsePoints(x + dx * scale, y + dy * scale, rad * scale, rad * 0.72 * scale, 26))
  }
  r.stroke(pts, { color, width: 3.2 * scale, alpha: 0.72, jitter: 1.1 })
}

export const TEMPLATES = {}

TEMPLATES.stick_figure = {
  id: 'stick_figure',
  title: '火柴人',
  description: '一个会站、挥手、跑、坐或指的火柴人；可选题词。',
  params: {
    x: { type: 'number', default: 600, min: 0, max: 2000 },
    y: { type: 'number', default: 660, min: 0, max: 2000 },
    scale: { type: 'number', default: 1, min: 0.2, max: 3 },
    pose: { type: 'enum', values: ['stand', 'wave', 'run', 'sit', 'point'], default: 'wave' },
    mood: { type: 'enum', values: ['happy', 'sad', 'surprised', 'neutral'], default: 'happy' },
    hair: { type: 'number', default: 4, min: 0, max: 12 },
  },
  draw(r, p) {
    const s = p.scale
    const x = p.x
    const y = p.y
    const headY = y - 190 * s
    const headR = 38 * s
    const shoulderY = y - 150 * s
    const hipY = y - 96 * s
    const ink = r.style.ink
    const bodyW = 6.2 * s
    r.circle(x, headY, headR, { width: 3.4 * s, color: ink })
    r.stroke(line(x, headY + headR, x, hipY), { width: bodyW, color: ink })
    eyes(r, x, headY - 4 * s, s, p.mood)
    FACE[p.mood](r, x, headY + 12 * s, s)
    for (let i = 0; i < p.hair; i += 1) {
      const a = -Math.PI / 2 + (i - (p.hair - 1) / 2) * 0.18
      r.stroke(
        line(x + Math.cos(a) * headR * 0.95, headY + Math.sin(a) * headR * 0.95, x + Math.cos(a) * headR * 1.42, headY + Math.sin(a) * headR * 1.42),
        { width: 2.2 * s, color: ink, jitter: 0.8 },
      )
    }
    if (p.pose === 'wave') {
      r.stroke(join(line(x, shoulderY, x - 52 * s, y - 112 * s), line(x - 52 * s, y - 112 * s, x - 72 * s, y - 72 * s)), {
        width: 4.6 * s,
        color: ink,
      })
      r.stroke(line(x, shoulderY, x + 66 * s, y - 196 * s), { width: 4.6 * s, color: ink })
      r.stroke(line(x + 66 * s, y - 196 * s, x + 86 * s, y - 232 * s), { width: 4.2 * s, color: ink })
      r.stroke(line(x + 86 * s, y - 232 * s, x + 72 * s, y - 246 * s), { width: 3 * s, color: ink })
      r.stroke(line(x + 86 * s, y - 232 * s, x + 98 * s, y - 250 * s), { width: 3 * s, color: ink })
    } else if (p.pose === 'run') {
      r.stroke(line(x, shoulderY, x - 55 * s, y - 178 * s), { width: 4.6 * s, color: ink })
      r.stroke(line(x, shoulderY, x + 62 * s, y - 120 * s), { width: 4.6 * s, color: ink })
      r.stroke(line(x, hipY, x - 68 * s, y - 62 * s), { width: 5.4 * s, color: ink })
      r.stroke(line(x - 68 * s, y - 62 * s, x - 96 * s, y - 20 * s), { width: 4.2 * s, color: ink })
      r.stroke(line(x, hipY, x + 44 * s, y - 52 * s), { width: 5.4 * s, color: ink })
      r.stroke(line(x + 44 * s, y - 52 * s, x + 22 * s, y - 8 * s), { width: 4.2 * s, color: ink })
    } else if (p.pose === 'sit') {
      r.stroke(line(x, shoulderY, x - 46 * s, y - 108 * s), { width: 4.6 * s, color: ink })
      r.stroke(line(x, shoulderY, x + 46 * s, y - 108 * s), { width: 4.6 * s, color: ink })
      r.stroke(join(line(x, hipY, x + 54 * s, y - 68 * s), line(x + 54 * s, y - 68 * s, x + 54 * s, y - 18 * s)), {
        width: 5.2 * s,
        color: ink,
      })
      r.stroke(join(line(x, hipY, x - 44 * s, y - 60 * s), line(x - 44 * s, y - 60 * s, x - 44 * s, y - 18 * s)), {
        width: 5.2 * s,
        color: ink,
      })
    } else if (p.pose === 'point') {
      r.stroke(line(x, shoulderY, x - 46 * s, y - 110 * s), { width: 4.6 * s, color: ink })
      r.stroke(line(x, shoulderY, x + 82 * s, y - 165 * s), { width: 4.6 * s, color: ink })
      r.stroke(line(x + 82 * s, y - 165 * s, x + 111 * s, y - 176 * s), { width: 3.4 * s, color: ink })
    } else {
      r.stroke(line(x, shoulderY, x - 46 * s, y - 92 * s), { width: 4.6 * s, color: ink })
      r.stroke(line(x, shoulderY, x + 46 * s, y - 92 * s), { width: 4.6 * s, color: ink })
    }
    if (p.pose !== 'sit') {
      r.stroke(line(x, hipY, x - 44 * s, y), { width: 5.4 * s, color: ink })
      r.stroke(line(x, hipY, x + 44 * s, y), { width: 5.4 * s, color: ink })
      r.stroke(line(x - 44 * s, y, x - 65 * s, y + 4 * s), { width: 4.4 * s, color: ink })
      r.stroke(line(x + 44 * s, y, x + 65 * s, y + 4 * s), { width: 4.4 * s, color: ink })
    }
  },
}

TEMPLATES.cat = {
  id: 'cat',
  title: '猫',
  description: '坐猫/走猫/趴猫，带尾巴和胡须。',
  params: {
    x: { type: 'number', default: 600, min: 0, max: 2000 },
    y: { type: 'number', default: 650, min: 0, max: 2000 },
    scale: { type: 'number', default: 1, min: 0.3, max: 3 },
    pose: { type: 'enum', values: ['sit', 'walk', 'lie'], default: 'sit' },
    tail: { type: 'enum', values: ['up', 'curl', 'straight'], default: 'curl' },
    whiskers: { type: 'boolean', default: true },
  },
  draw(r, p) {
    const s = p.scale
    const x = p.x
    const y = p.y
    const ink = r.style.ink
    const lie = p.pose === 'lie'
    const bodyY = lie ? y - 42 * s : y - 58 * s
    const bodyRx = 86 * s
    const bodyRy = (lie ? 40 : 48) * s
    const headR = 40 * s
    const headAngle = lie ? -0.3 : -0.64
    const neck = pointOnEllipse(x, bodyY, bodyRx, bodyRy, headAngle)
    const normal = ellipseNormal(bodyRx, bodyRy, headAngle)
    const headX = neck[0] + normal[0] * (headR - 8 * s)
    const headY = neck[1] + normal[1] * (headR - 8 * s)

    const bodyArcs = ellipseOutsideCircleArcs(x, bodyY, bodyRx, bodyRy, headX, headY, headR - 1.2 * s)
    if (bodyArcs.length === 1 && bodyArcs[0].a1 - bodyArcs[0].a0 >= Math.PI * 2 - 0.001) {
      r.stroke(ellipsePoints(x, bodyY, bodyRx, bodyRy, 54), {
        width: 4.2 * s,
        color: ink,
        closed: true,
        minEndWidth: 1,
      })
    } else {
      for (const part of bodyArcs) {
        const n = Math.max(24, Math.round(((part.a1 - part.a0) * Math.max(bodyRx, bodyRy)) / 4))
        r.stroke(arc(x, bodyY, bodyRx, bodyRy, part.a0, part.a1, Math.min(180, n)), {
          width: 4.2 * s,
          color: ink,
          pin: true,
          minEndWidth: 1,
        })
      }
    }
    r.circle(headX, headY, headR, { width: 3.6 * s, color: ink, minEndWidth: 1 })

    const earR = headR - 1.2 * s
    const earPoint = (a) => [headX + Math.cos(a) * earR, headY + Math.sin(a) * earR]
    r.stroke([earPoint(-2.34), [headX - 14 * s, headY - 62 * s], earPoint(-1.58)], {
      width: 3.4 * s,
      color: ink,
      pin: true,
      minEndWidth: 1,
    })
    r.stroke([earPoint(-1.13), [headX + 34 * s, headY - 60 * s], earPoint(-0.52)], {
      width: 3.4 * s,
      color: ink,
      pin: true,
      minEndWidth: 1,
    })

    r.circle(headX - 13 * s, headY - 4 * s, 3.2 * s, { fill: ink, stroke: false })
    r.circle(headX + 13 * s, headY - 4 * s, 3.2 * s, { fill: ink, stroke: false })
    r.stroke([ [headX - 4 * s, headY + 8 * s], [headX, headY + 13 * s], [headX + 4 * s, headY + 8 * s] ], {
      width: 2.2 * s,
      color: ACCENT.red,
    })
    if (p.whiskers) {
      for (const dy of [-8, 0, 8]) {
        r.stroke(line(headX - 8 * s, headY + 8 * s, headX - 56 * s, headY + (8 + dy) * s), {
          width: 1.6 * s,
          color: ink,
          alpha: 0.7,
          pinStart: true,
        })
        r.stroke(line(headX + 8 * s, headY + 8 * s, headX + 56 * s, headY + (8 + dy) * s), {
          width: 1.6 * s,
          color: ink,
          alpha: 0.7,
          pinStart: true,
        })
      }
    }
    if (!lie) {
      for (const [dx, paw] of [[-42, -14], [10, 14]]) {
        const legX = x + dx * s
        const edgeY = pointOnEllipseAtX(x, bodyY, bodyRx, bodyRy, legX, 1)[1] + 1.2 * s
        r.stroke(line(legX, edgeY, legX, y), { width: 4.2 * s, color: ink, pin: true, minEndWidth: 1 })
        r.stroke(line(legX, y, x + (dx + paw) * s, y), { width: 3.4 * s, color: ink, pin: true, minEndWidth: 1 })
      }
    }

    const tailStart = pointOnEllipse(x, bodyY, bodyRx, bodyRy, -2.72)
    if (p.tail === 'up') {
      r.stroke(join(cubic(tailStart, [x - 116 * s, bodyY - 86 * s], [x - 106 * s, bodyY - 150 * s], [x - 84 * s, bodyY - 176 * s])), {
        width: 4.4 * s,
        color: ink,
        pinStart: true,
        minEndWidth: 1,
      })
    } else if (p.tail === 'straight') {
      r.stroke(line(tailStart[0], tailStart[1], x - 150 * s, bodyY - 22 * s), {
        width: 4.4 * s,
        color: ink,
        pinStart: true,
        minEndWidth: 1,
      })
    } else {
      r.stroke(
        join(
          cubic(tailStart, [x - 130 * s, bodyY + 8 * s], [x - 148 * s, bodyY - 60 * s], [x - 122 * s, bodyY - 96 * s]),
          cubic([x - 122 * s, bodyY - 96 * s], [x - 110 * s, bodyY - 116 * s], [x - 94 * s, bodyY - 112 * s], [x - 100 * s, bodyY - 94 * s]),
        ),
        { width: 4.2 * s, color: ink, pinStart: true, minEndWidth: 1 },
      )
    }
  },
}

TEMPLATES.dog = {
  id: 'dog',
  title: '狗',
  description: '一只坐着的狗，垂耳、尾巴可选。',
  params: {
    x: { type: 'number', default: 600, min: 0, max: 2000 },
    y: { type: 'number', default: 650, min: 0, max: 2000 },
    scale: { type: 'number', default: 1, min: 0.3, max: 3 },
    ears: { type: 'enum', values: ['floppy', 'pointy'], default: 'floppy' },
    tail: { type: 'enum', values: ['wag', 'up', 'short'], default: 'wag' },
  },
  draw(r, p) {
    const s = p.scale
    const x = p.x
    const y = p.y
    const ink = r.style.ink
    r.stroke(ellipsePoints(x, y - 66 * s, 88 * s, 50 * s, 54), { width: 4.4 * s, color: ink, closed: true })
    const headX = x + 74 * s
    const headY = y - 130 * s
    r.circle(headX, headY, 42 * s, { width: 3.6 * s, color: ink })
    if (p.ears === 'floppy') {
      r.stroke(join(cubic([headX - 32 * s, headY - 30 * s], [headX - 66 * s, headY - 20 * s], [headX - 70 * s, headY + 26 * s], [headX - 38 * s, headY + 22 * s])), {
        width: 4.2 * s,
        color: ink,
      })
      r.stroke(join(cubic([headX + 32 * s, headY - 30 * s], [headX + 66 * s, headY - 20 * s], [headX + 70 * s, headY + 26 * s], [headX + 38 * s, headY + 22 * s])), {
        width: 4.2 * s,
        color: ink,
      })
    } else {
      r.stroke([ [headX - 30 * s, headY - 26 * s], [headX - 24 * s, headY - 68 * s], [headX - 4 * s, headY - 34 * s] ], {
        width: 3.6 * s,
        color: ink,
        closed: true,
      })
      r.stroke([ [headX + 8 * s, headY - 36 * s], [headX + 28 * s, headY - 68 * s], [headX + 34 * s, headY - 24 * s] ], {
        width: 3.6 * s,
        color: ink,
        closed: true,
      })
    }
    r.circle(headX - 14 * s, headY - 6 * s, 3.2 * s, { fill: ink, stroke: false })
    r.circle(headX + 14 * s, headY - 6 * s, 3.2 * s, { fill: ink, stroke: false })
    r.circle(headX, headY + 10 * s, 7 * s, { fill: ink, stroke: false })
    r.stroke(arc(headX, headY + 18 * s, 10 * s, 7 * s, 0.2, Math.PI - 0.2, 14), { width: 2.2 * s, color: ink })
    r.stroke(line(headX, headY + 17 * s, headX, headY + 27 * s), { width: 2 * s, color: ink })
    r.stroke(line(x - 40 * s, y - 22 * s, x - 40 * s, y), { width: 4.2 * s, color: ink })
    r.stroke(line(x + 10 * s, y - 22 * s, x + 10 * s, y), { width: 4.2 * s, color: ink })
    const tailStart = [x - 84 * s, y - 82 * s]
    if (p.tail === 'up') r.stroke(line(tailStart[0], tailStart[1], x - 112 * s, y - 156 * s), { width: 4.4 * s, color: ink })
    else if (p.tail === 'short') r.stroke(line(tailStart[0], tailStart[1], x - 112 * s, y - 94 * s), { width: 4.4 * s, color: ink })
    else
      r.stroke(
        join(
          cubic(tailStart, [x - 126 * s, y - 62 * s], [x - 146 * s, y - 110 * s], [x - 122 * s, y - 148 * s]),
          cubic([x - 122 * s, y - 148 * s], [x - 110 * s, y - 166 * s], [x - 90 * s, y - 160 * s], [x - 96 * s, y - 140 * s]),
        ),
        { width: 4.2 * s, color: ink },
      )
  },
}

TEMPLATES.bird = {
  id: 'bird',
  title: '鸟',
  description: '飞鸟或停在枝头的小鸟。',
  params: {
    x: { type: 'number', default: 600, min: 0, max: 2000 },
    y: { type: 'number', default: 420, min: 0, max: 2000 },
    scale: { type: 'number', default: 1, min: 0.3, max: 3 },
    pose: { type: 'enum', values: ['flying', 'perched'], default: 'flying' },
    wing: { type: 'enum', values: ['up', 'down', 'flat'], default: 'up' },
  },
  draw(r, p) {
    const s = p.scale
    const ink = r.style.ink
    const x = p.x
    const y = p.y
    r.stroke(ellipsePoints(x, y, 64 * s, 34 * s, 48), { width: 4.2 * s, color: ink, closed: true })
    r.circle(x + 52 * s, y - 24 * s, 25 * s, { width: 3.2 * s, color: ink })
    r.stroke([ [x + 72 * s, y - 28 * s], [x + 104 * s, y - 20 * s], [x + 72 * s, y - 12 * s] ], {
      width: 2.6 * s,
      color: ACCENT.ochre,
      closed: true,
    })
    r.circle(x + 60 * s, y - 30 * s, 2.6 * s, { fill: ink, stroke: false })
    const root = [x - 8 * s, y - 8 * s]
    if (p.wing === 'up') {
      r.stroke(join(cubic(root, [x - 40 * s, y - 84 * s], [x - 82 * s, y - 112 * s], [x - 120 * s, y - 96 * s])), { width: 4.2 * s, color: ink })
      r.stroke(join(cubic(root, [x - 28 * s, y - 70 * s], [x - 70 * s, y - 90 * s], [x - 100 * s, y - 76 * s])), { width: 2.4 * s, color: ink, alpha: 0.7 })
    } else if (p.wing === 'down') {
      r.stroke(join(cubic(root, [x - 30 * s, y + 54 * s], [x - 76 * s, y + 86 * s], [x - 118 * s, y + 62 * s])), { width: 4.2 * s, color: ink })
    } else {
      r.stroke(line(root[0], root[1], x - 116 * s, y - 8 * s), { width: 4.2 * s, color: ink })
    }
    r.stroke([ [x - 56 * s, y], [x - 104 * s, y - 18 * s] ], { width: 2.2 * s, color: ink })
    r.stroke([ [x - 56 * s, y], [x - 102 * s, y + 12 * s] ], { width: 2.2 * s, color: ink })
    if (p.pose === 'perched') {
      r.stroke(line(x - 12 * s, y + 30 * s, x - 14 * s, y + 72 * s), { width: 2.4 * s, color: ink })
      r.stroke(line(x + 14 * s, y + 30 * s, x + 16 * s, y + 72 * s), { width: 2.4 * s, color: ink })
      r.stroke(line(x - 120 * s, y + 74 * s, x + 120 * s, y + 74 * s), { width: 3.4 * s, color: ACCENT.brown })
    }
  },
}

TEMPLATES.house = {
  id: 'house',
  title: '房子',
  description: '有屋顶、门、窗、烟囱的房子。',
  params: {
    x: { type: 'number', default: 600, min: 0, max: 2000 },
    y: { type: 'number', default: 650, min: 0, max: 2000 },
    scale: { type: 'number', default: 1, min: 0.3, max: 3 },
    chimney: { type: 'boolean', default: true },
    windows: { type: 'number', default: 2, min: 0, max: 4 },
  },
  draw(r, p) {
    const s = p.scale
    const x = p.x
    const y = p.y
    const ink = r.style.ink
    const w = 300 * s
    const h = 190 * s
    r.rect(x - w / 2, y - h, w, h, { width: 4 * s, color: ink })
    r.stroke([ [x - w / 2 - 20 * s, y - h], [x, y - h - 120 * s], [x + w / 2 + 20 * s, y - h] ], {
      width: 4.4 * s,
      color: ink,
      closed: true,
    })
    r.rect(x - 34 * s, y - 104 * s, 68 * s, 104 * s, { width: 3.2 * s, color: ink })
    r.circle(x + 20 * s, y - 52 * s, 3 * s, { fill: ink, stroke: false })
    for (let i = 0; i < p.windows; i += 1) {
      const wx = x - w / 2 + 40 * s + i * 80 * s
      if (wx > x + w / 2 - 50 * s) break
      r.rect(wx, y - 150 * s, 46 * s, 46 * s, { width: 2.8 * s, color: ink })
      r.stroke(line(wx + 23 * s, y - 150 * s, wx + 23 * s, y - 104 * s), { width: 1.6 * s, color: ink, alpha: 0.7 })
      r.stroke(line(wx, y - 127 * s, wx + 46 * s, y - 127 * s), { width: 1.6 * s, color: ink, alpha: 0.7 })
    }
    if (p.chimney) {
      r.rect(x + 70 * s, y - h - 128 * s, 34 * s, 70 * s, { width: 3.2 * s, color: ink })
      r.stroke(
        join(
          cubic([x + 87 * s, y - h - 128 * s], [x + 76 * s, y - h - 166 * s], [x + 102 * s, y - h - 180 * s], [x + 92 * s, y - h - 210 * s]),
          cubic([x + 92 * s, y - h - 210 * s], [x + 84 * s, y - h - 230 * s], [x + 108 * s, y - h - 236 * s], [x + 104 * s, y - h - 254 * s]),
        ),
        { width: 2.4 * s, color: ink, alpha: 0.45 },
      )
    }
  },
}

TEMPLATES.tree = {
  id: 'tree',
  title: '树',
  description: '一棵有树冠、树干和可选苹果的树。',
  params: {
    x: { type: 'number', default: 600, min: 0, max: 2000 },
    y: { type: 'number', default: 660, min: 0, max: 2000 },
    scale: { type: 'number', default: 1, min: 0.3, max: 3 },
    apples: { type: 'number', default: 3, min: 0, max: 12 },
    lean: { type: 'number', default: 0, min: -0.3, max: 0.3 },
  },
  draw(r, p) {
    const s = p.scale
    const x = p.x
    const y = p.y
    const ink = r.style.ink
    const top = y - 270 * s
    const trunk = []
    for (let t = 0; t <= 1; t += 0.08) {
      trunk.push([x - 16 * s + p.lean * t * 120 * s + Math.sin(t * 5) * 3 * s, y - t * 220 * s])
    }
    r.stroke(trunk, { width: 12 * s, color: ACCENT.brown })
    r.stroke(trunk.map(([px, py]) => [px + 24 * s, py]), { width: 10 * s, color: ACCENT.brown })
    r.stroke(line(x - 4 * s, y - 180 * s, x - 62 * s, y - 232 * s), { width: 5 * s, color: ACCENT.brown })
    r.stroke(line(x + 16 * s, y - 190 * s, x + 68 * s, y - 246 * s), { width: 5 * s, color: ACCENT.brown })
    const canopy = []
    for (let i = 0; i <= 96; i += 1) {
      const a = (i / 96) * Math.PI * 2
      const rad = (108 + Math.sin(a * 5 + 0.8) * 16 + Math.sin(a * 3 + 2.1) * 7) * s
      canopy.push([x + p.lean * 80 * s + Math.cos(a) * rad * 1.04, top + 34 * s + Math.sin(a) * rad * 0.82])
    }
    r.stroke(canopy, { width: 4.6 * s, color: ACCENT.green, closed: true })
    for (let i = 0; i < 7; i += 1) {
      const a = (i / 7) * Math.PI * 2
      r.stroke(arc(x + Math.cos(a) * 44 * s, top + 42 * s + Math.sin(a) * 30 * s, 22 * s, 16 * s, a, a + 1.6, 14), {
        width: 2 * s,
        color: ACCENT.green,
        alpha: 0.35,
      })
    }
    for (let i = 0; i < p.apples; i += 1) {
      const a = (i / Math.max(1, p.apples)) * Math.PI * 2 + 0.4
      const ax = x + Math.cos(a) * 54 * s
      const ay = top + 40 * s + Math.sin(a) * 40 * s
      r.circle(ax, ay, 10 * s, { fill: ACCENT.red, stroke: true, width: 2 * s, color: ACCENT.red })
      r.stroke(line(ax, ay - 10 * s, ax + 2 * s, ay - 17 * s), { width: 1.8 * s, color: ACCENT.brown })
    }
  },
}

TEMPLATES.sun_cloud = {
  id: 'sun_cloud',
  title: '太阳与云',
  description: '太阳光芒和几朵云。',
  params: {
    x: { type: 'number', default: 850, min: 0, max: 2000 },
    y: { type: 'number', default: 220, min: 0, max: 2000 },
    scale: { type: 'number', default: 1, min: 0.3, max: 3 },
    rays: { type: 'number', default: 12, min: 0, max: 24 },
    clouds: { type: 'number', default: 2, min: 0, max: 5 },
  },
  draw(r, p) {
    const s = p.scale
    const x = p.x
    const y = p.y
    r.circle(x, y, 56 * s, { fill: ACCENT.ochre, fillAlpha: 0.55, width: 4.2 * s, color: ACCENT.red })
    for (let i = 0; i < p.rays; i += 1) {
      const a = (i / Math.max(1, p.rays)) * Math.PI * 2
      r.stroke(
        line(x + Math.cos(a) * 70 * s, y + Math.sin(a) * 70 * s, x + Math.cos(a) * (92 + (i % 3) * 4) * s, y + Math.sin(a) * (92 + (i % 3) * 4) * s),
        { width: 3.4 * s, color: ACCENT.ochre },
      )
    }
    for (let i = 0; i < p.clouds; i += 1) {
      cloud(r, x - 220 * s + i * 120 * s, y + 130 * s + (i % 2) * 46 * s, s * (0.8 + (i % 2) * 0.18), ACCENT.blue)
    }
  },
}

TEMPLATES.flower = {
  id: 'flower',
  title: '花',
  description: '一朵带茎和叶子的花。',
  params: {
    x: { type: 'number', default: 600, min: 0, max: 2000 },
    y: { type: 'number', default: 660, min: 0, max: 2000 },
    scale: { type: 'number', default: 1, min: 0.3, max: 3 },
    petals: { type: 'number', default: 6, min: 3, max: 12 },
    leaves: { type: 'number', default: 2, min: 0, max: 4 },
  },
  draw(r, p) {
    const s = p.scale
    const x = p.x
    const y = p.y
    const topY = y - 230 * s
    r.stroke(join(cubic([x, y], [x - 8 * s, y - 90 * s], [x + 12 * s, y - 160 * s], [x, topY])), {
      width: 4.6 * s,
      color: ACCENT.green,
    })
    for (let i = 0; i < p.leaves; i += 1) {
      const ly = y - 80 * s - i * 58 * s
      const dir = i % 2 === 0 ? -1 : 1
      r.stroke(
        join(
          cubic([x, ly], [x + dir * 30 * s, ly - 14 * s], [x + dir * 58 * s, ly - 8 * s], [x + dir * 68 * s, ly + 12 * s]),
          cubic([x + dir * 68 * s, ly + 12 * s], [x + dir * 38 * s, ly + 16 * s], [x + dir * 12 * s, ly + 8 * s], [x, ly]),
        ),
        { width: 3.2 * s, color: ACCENT.green },
      )
    }
    for (let i = 0; i < p.petals; i += 1) {
      const a = (i / p.petals) * Math.PI * 2
      const cx = x + Math.cos(a) * 36 * s
      const cy = topY + Math.sin(a) * 36 * s
      r.stroke(ellipsePoints(cx, cy, 25 * s, 14 * s, 28).map((q) => [
        x + (q[0] - x) * 0.7 + Math.cos(a) * 18 * s,
        topY + (q[1] - topY) * 0.7 + Math.sin(a) * 18 * s,
      ]), { width: 3 * s, color: ACCENT.red, closed: true })
    }
    r.circle(x, topY, 17 * s, { fill: ACCENT.ochre, fillAlpha: 0.7, width: 2.6 * s, color: ACCENT.ochre })
  },
}

TEMPLATES.heart_star_arrow = {
  id: 'heart_star_arrow',
  title: '爱心/星星/箭头',
  description: '一个爱心、星星或箭头，适合当图标。',
  params: {
    x: { type: 'number', default: 600, min: 0, max: 2000 },
    y: { type: 'number', default: 360, min: 0, max: 2000 },
    scale: { type: 'number', default: 1, min: 0.2, max: 4 },
    kind: { type: 'enum', values: ['heart', 'star', 'arrow'], default: 'heart' },
  },
  draw(r, p) {
    const s = p.scale
    const x = p.x
    const y = p.y
    if (p.kind === 'heart') {
      const pts = []
      for (let i = 0; i <= 80; i += 1) {
        const t = (i / 80) * Math.PI * 2
        const hx = 16 * Math.sin(t) ** 3
        const hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)
        pts.push([x + hx * 5.2 * s, y - hy * 5.2 * s])
      }
      r.stroke(pts, { width: 4.2 * s, color: ACCENT.red, closed: true })
      r.fill(pts, { color: ACCENT.red, alpha: 0.16 })
    } else if (p.kind === 'star') {
      const pts = []
      for (let i = 0; i < 10; i += 1) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5
        const rad = (i % 2 === 0 ? 112 : 46) * s
        pts.push([x + Math.cos(a) * rad, y + Math.sin(a) * rad])
      }
      r.stroke(pts, { width: 4 * s, color: ACCENT.ochre, closed: true })
      r.fill(pts, { color: ACCENT.ochre, alpha: 0.18 })
    } else {
      r.stroke(line(x - 140 * s, y, x + 120 * s, y), { width: 6 * s, color: ACCENT.blue })
      r.stroke([ [x + 40 * s, y - 52 * s], [x + 132 * s, y], [x + 40 * s, y + 52 * s] ], { width: 6 * s, color: ACCENT.blue })
    }
  },
}

TEMPLATES.speech_bubble = {
  id: 'speech_bubble',
  title: '对话泡',
  description: '一个圆角对话泡，带文字和尾巴。',
  params: {
    x: { type: 'number', default: 600, min: 0, max: 2000 },
    y: { type: 'number', default: 300, min: 0, max: 2000 },
    scale: { type: 'number', default: 1, min: 0.3, max: 3 },
    text: { type: 'string', default: 'HI' },
    tail: { type: 'enum', values: ['left', 'right', 'none'], default: 'left' },
    round: { type: 'number', default: 1, min: 0, max: 1 },
  },
  draw(r, p) {
    const s = p.scale
    const x = p.x
    const y = p.y
    const ink = r.style.ink
    const w = 300 * s
    const h = 150 * s
    const rr = 46 * s * p.round
    const pts = []
    const steps = 8
    const corners = [
      [x + w / 2 - rr, y - h / 2 + rr, -Math.PI / 2],
      [x + w / 2 - rr, y + h / 2 - rr, 0],
      [x - w / 2 + rr, y + h / 2 - rr, Math.PI / 2],
      [x - w / 2 + rr, y - h / 2 + rr, Math.PI],
    ]
    for (const [cx, cy, a0] of corners) {
      for (let i = 0; i <= steps; i += 1) {
        const a = a0 + (i / steps) * (Math.PI / 2)
        pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr])
      }
    }
    pts.push(pts[0])
    if (p.tail !== 'none') {
      const tx = p.tail === 'left' ? x - w * 0.22 : x + w * 0.22
      const tail = [
        [tx - 24 * s, y + h / 2 - 2],
        [tx + (p.tail === 'left' ? -26 : 26) * s, y + h / 2 + 56 * s],
        [tx + 24 * s, y + h / 2 - 2],
      ]
      const idx = pts.findIndex((q) => q[0] >= tx - 24 * s && q[1] >= y + h / 2 - 2)
      if (idx > 0) pts.splice(idx, 1, ...tail)
    }
    r.stroke(pts, { width: 3.8 * s, color: ink, closed: true })
    const size = Math.min(58 * s, h * 0.34)
    r.text(String(p.text), x, y + size * 0.34, size, { align: 'center', color: ink, jitter: 0.35 })
  },
}

TEMPLATES.scene_park = {
  id: 'scene_park',
  title: '公园小景',
  description: '树、太阳、火柴人和对话泡的组合。',
  params: {
    x: { type: 'number', default: 600, min: 0, max: 2000 },
    y: { type: 'number', default: 700, min: 0, max: 2000 },
    scale: { type: 'number', default: 1, min: 0.4, max: 2 },
    text: { type: 'string', default: 'HI' },
  },
  draw(r, p, size) {
    const s = p.scale
    const y = Math.min(p.y, size.height - 26 * s)
    const ground = []
    for (let gx = 18; gx <= size.width - 18; gx += 9) {
      ground.push([gx, y + Math.sin(gx * 0.018) * 2.2 + (r.rng.next() * 2 - 1) * 0.9])
    }
    r.stroke(ground, { color: r.style.ink, width: 2.2, alpha: 0.42, jitter: 0.5 })
    for (let i = 0; i < 22; i += 1) {
      const gx = 30 + r.rng.next() * (size.width - 60)
      r.stroke(line(gx, y, gx + (r.rng.next() * 2 - 1) * 7, y - 7 - r.rng.next() * 10), {
        color: ACCENT.green,
        width: 1.8,
        alpha: 0.45,
        jitter: 0.7,
      })
    }
    TEMPLATES.sun_cloud.draw(r, { x: size.width - 200 * s, y: Math.max(110 * s, 130 * s), scale: s * 0.9, rays: 12, clouds: 1 }, size)
    TEMPLATES.tree.draw(r, { x: size.width * 0.34, y, scale: s * 0.86, apples: 2, lean: -0.04 }, size)
    TEMPLATES.stick_figure.draw(
      r,
      { x: size.width * 0.62, y: y - 4, scale: s * 0.86, pose: 'wave', mood: 'happy', hair: 4 },
      size,
    )
    TEMPLATES.speech_bubble.draw(
      r,
      { x: size.width * 0.62 + 92 * s, y: Math.max(110 * s, y - 290 * s), scale: s * 0.62, text: p.text, tail: 'left', round: 1 },
      size,
    )
  },
}

export function fillParams(template, params = {}) {
  const out = {}
  for (const [key, spec] of Object.entries(template.params || {})) {
    const value = params[key]
    if (value === undefined || value === null || value === '') out[key] = spec.default
    else if (spec.type === 'number') out[key] = Number(value)
    else if (spec.type === 'boolean') out[key] = Boolean(value)
    else out[key] = String(value)
  }
  return out
}

export function validateParams(template, params) {
  const errors = []
  for (const [key, spec] of Object.entries(template.params || {})) {
    const value = params[key]
    if (spec.type === 'number') {
      if (!Number.isFinite(value)) errors.push(`${key} 必须是数字`)
      else if (spec.min !== undefined && value < spec.min) errors.push(`${key} 不能小于 ${spec.min}`)
      else if (spec.max !== undefined && value > spec.max) errors.push(`${key} 不能大于 ${spec.max}`)
    } else if (spec.type === 'enum' && !spec.values.includes(value)) {
      errors.push(`${key} 必须是 ${spec.values.join(' / ')} 之一`)
    } else if (spec.type === 'string' && typeof value !== 'string') {
      errors.push(`${key} 必须是字符串`)
    }
  }
  return errors
}

export function templateList() {
  return Object.values(TEMPLATES).map((template) => ({
    id: template.id,
    title: template.title,
    description: template.description,
    params: template.params,
  }))
}
