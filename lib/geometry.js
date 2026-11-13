export function pointOnEllipse(cx, cy, rx, ry, angle) {
  return [cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry]
}

export function ellipseNormal(rx, ry, angle) {
  const nx = Math.cos(angle) / rx
  const ny = Math.sin(angle) / ry
  const len = Math.hypot(nx, ny) || 1
  return [nx / len, ny / len]
}

export function pointOnEllipseAtX(cx, cy, rx, ry, px, side = 1) {
  const dx = Math.max(-rx, Math.min(rx, px - cx))
  const ratio = dx / rx
  return [px, cy + side * ry * Math.sqrt(Math.max(0, 1 - ratio * ratio))]
}

export function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

function angleRunsOutside(isOutside, samples = 720) {
  const outside = new Array(samples)
  let outsideCount = 0
  for (let i = 0; i < samples; i += 1) {
    outside[i] = Boolean(isOutside((i / samples) * Math.PI * 2))
    if (outside[i]) outsideCount += 1
  }
  if (outsideCount === samples) return [{ a0: 0, a1: Math.PI * 2 }]
  if (outsideCount === 0) return []

  const step = (Math.PI * 2) / samples
  const boundary = (aOut, aIn) => {
    let lo = aOut
    let hi = aIn
    for (let i = 0; i < 18; i += 1) {
      const mid = (lo + hi) / 2
      if (isOutside(mid)) lo = mid
      else hi = mid
    }
    return (lo + hi) / 2
  }

  let anchor = 0
  while (!outside[anchor]) anchor += 1
  let start = anchor
  while (outside[(start - 1 + samples) % samples]) start = (start - 1 + samples) % samples

  const arcs = []
  let offset = 0
  while (offset < samples) {
    const idx = (start + offset) % samples
    if (!outside[idx]) {
      offset += 1
      continue
    }
    let length = 1
    while (length < samples && outside[(start + offset + length) % samples]) length += 1
    const rawStart = (start + offset) * step
    const rawEnd = rawStart + length * step
    const a0 = boundary(rawStart - step, rawStart)
    const a1 = length === samples ? rawStart + Math.PI * 2 : boundary(rawEnd - step, rawEnd)
    arcs.push({ a0, a1 })
    offset += length
  }
  return arcs
}

export function ellipseOutsideCircleArcs(cx, cy, rx, ry, ox, oy, radius, samples = 720) {
  return angleRunsOutside((a) => {
    const px = cx + Math.cos(a) * rx
    const py = cy + Math.sin(a) * ry
    return Math.hypot(px - ox, py - oy) >= radius
  }, samples)
}

export function circleOutsideEllipseArcs(cx, cy, radius, ex, ey, erx, ery, samples = 720) {
  const inset = 1 - 1.2 / Math.max(1, Math.max(erx, ery))
  return angleRunsOutside((a) => {
    const px = cx + Math.cos(a) * radius
    const py = cy + Math.sin(a) * radius
    const nx = (px - ex) / erx
    const ny = (py - ey) / ery
    return nx * nx + ny * ny >= inset
  }, samples)
}
