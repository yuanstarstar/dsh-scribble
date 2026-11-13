import zlib from 'node:zlib'

// 纯 JS 的手写图片矢量化：PNG 解码 → 二值化 → 去噪 → 骨架化 → 追踪折线 → 风格特征。
// 只支持 8-bit、非隔行 PNG（灰度 / RGB / 灰度+Alpha / RGBA）；JPEG 请先转 PNG。
// 目标是给 StyleProfile 提供“像不像你的手”的参数，不做 OCR，也不还原具体字形。

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function readChunks(buffer) {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('IMAGE_NOT_PNG: 目前只支持 PNG 图片；JPEG 请先转成 PNG')
  }
  const chunks = []
  let offset = 8
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    chunks.push({ type, data })
    offset += 12 + length
    if (type === 'IEND') break
  }
  return chunks
}

function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

export function decodePng(buffer) {
  const chunks = readChunks(buffer)
  const ihdr = chunks.find((chunk) => chunk.type === 'IHDR')?.data
  if (!ihdr || ihdr.length < 13) throw new Error('PNG_BAD_HEADER: PNG 缺少 IHDR')
  const width = ihdr.readUInt32BE(0)
  const height = ihdr.readUInt32BE(4)
  const bitDepth = ihdr[8]
  const colorType = ihdr[9]
  const interlace = ihdr[12]
  if (bitDepth !== 8) throw new Error(`PNG_UNSUPPORTED_DEPTH: 只支持 8-bit PNG（当前 ${bitDepth}-bit）`)
  if (interlace !== 0) throw new Error('PNG_UNSUPPORTED_INTERLACE: 不支持隔行 PNG')
  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 6 ? 4 : 0
  if (!channels) throw new Error(`PNG_UNSUPPORTED_COLOR: 不支持 colorType=${colorType}`)
  const compressed = Buffer.concat(chunks.filter((chunk) => chunk.type === 'IDAT').map((chunk) => chunk.data))
  if (!compressed.length) throw new Error('PNG_NO_DATA: PNG 没有 IDAT 数据')
  const raw = zlib.inflateSync(compressed)
  const stride = width * channels
  if (raw.length < (stride + 1) * height) throw new Error('PNG_TRUNCATED: PNG 像素数据不完整')
  const rgba = new Uint8ClampedArray(width * height * 4)
  let previous = new Uint8Array(stride)
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]
    const source = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const line = new Uint8Array(stride)
    for (let i = 0; i < stride; i += 1) {
      const left = i >= channels ? line[i - channels] : 0
      const up = previous[i]
      const upLeft = i >= channels ? previous[i - channels] : 0
      let value = source[i]
      if (filter === 1) value = (value + left) & 0xff
      else if (filter === 2) value = (value + up) & 0xff
      else if (filter === 3) value = (value + ((left + up) >> 1)) & 0xff
      else if (filter === 4) value = (value + paeth(left, up, upLeft)) & 0xff
      else if (filter !== 0) throw new Error(`PNG_BAD_FILTER: 未知行过滤器 ${filter}`)
      line[i] = value
    }
    for (let x = 0; x < width; x += 1) {
      const p = x * channels
      const q = (y * width + x) * 4
      if (channels === 1) {
        rgba[q] = line[p]
        rgba[q + 1] = line[p]
        rgba[q + 2] = line[p]
        rgba[q + 3] = 255
      } else if (channels === 2) {
        rgba[q] = line[p]
        rgba[q + 1] = line[p]
        rgba[q + 2] = line[p]
        rgba[q + 3] = line[p + 1]
      } else if (channels === 3) {
        rgba[q] = line[p]
        rgba[q + 1] = line[p + 1]
        rgba[q + 2] = line[p + 2]
        rgba[q + 3] = 255
      } else {
        rgba[q] = line[p]
        rgba[q + 1] = line[p + 1]
        rgba[q + 2] = line[p + 2]
        rgba[q + 3] = line[p + 3]
      }
    }
    previous = line
  }
  return { width, height, rgba }
}

function resizeRgba(image, maxDim) {
  const longest = Math.max(image.width, image.height)
  if (longest <= maxDim) return image
  const scale = maxDim / longest
  const width = Math.max(1, Math.round(image.width * scale))
  const height = Math.max(1, Math.round(image.height * scale))
  const data = new Uint8ClampedArray(width * height * 4)
  const xRatio = image.width / width
  const yRatio = image.height / height
  for (let y = 0; y < height; y += 1) {
    const sy0 = Math.floor(y * yRatio)
    const sy1 = Math.max(sy0 + 1, Math.min(image.height, Math.floor((y + 1) * yRatio)))
    for (let x = 0; x < width; x += 1) {
      const sx0 = Math.floor(x * xRatio)
      const sx1 = Math.max(sx0 + 1, Math.min(image.width, Math.floor((x + 1) * xRatio)))
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let n = 0
      for (let sy = sy0; sy < sy1; sy += 1) {
        for (let sx = sx0; sx < sx1; sx += 1) {
          const p = (sy * image.width + sx) * 4
          r += image.rgba[p]
          g += image.rgba[p + 1]
          b += image.rgba[p + 2]
          a += image.rgba[p + 3]
          n += 1
        }
      }
      const q = (y * width + x) * 4
      data[q] = r / n
      data[q + 1] = g / n
      data[q + 2] = b / n
      data[q + 3] = a / n
    }
  }
  return { width, height, rgba: data }
}

function luminanceOnWhite(rgba) {
  const gray = new Uint8Array(rgba.length / 4)
  for (let i = 0, p = 0; i < gray.length; i += 1, p += 4) {
    const alpha = rgba[p + 3] / 255
    const r = rgba[p] * alpha + 255 * (1 - alpha)
    const g = rgba[p + 1] * alpha + 255 * (1 - alpha)
    const b = rgba[p + 2] * alpha + 255 * (1 - alpha)
    gray[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b)
  }
  return gray
}

function otsuThreshold(gray) {
  const hist = new Uint32Array(256)
  for (let i = 0; i < gray.length; i += 1) hist[gray[i]] += 1
  let total = 0
  let sum = 0
  for (let i = 0; i < 256; i += 1) {
    total += hist[i]
    sum += i * hist[i]
  }
  let sumB = 0
  let weightB = 0
  let best = 0
  let threshold = 127
  for (let i = 0; i < 256; i += 1) {
    weightB += hist[i]
    if (!weightB) continue
    const weightF = total - weightB
    if (!weightF) break
    sumB += i * hist[i]
    const meanB = sumB / weightB
    const meanF = (sum - sumB) / weightF
    const between = weightB * weightF * (meanB - meanF) * (meanB - meanF)
    if (between > best) {
      best = between
      threshold = i
    }
  }
  return threshold
}

function adaptiveMask(gray, width, height, options = {}) {
  const window = Math.max(9, Number(options.window) || 31)
  const radius = Math.floor(window / 2)
  const ratio = Number(options.ratio)
  const bias = Number.isFinite(Number(options.bias)) ? Number(options.bias) : 10
  const integral = new Float64Array((width + 1) * (height + 1))
  for (let y = 0; y < height; y += 1) {
    let row = 0
    for (let x = 0; x < width; x += 1) {
      row += gray[y * width + x]
      integral[(y + 1) * (width + 1) + x + 1] = integral[y * (width + 1) + x + 1] + row
    }
  }
  const mask = new Uint8Array(width * height)
  let ink = 0
  let thresholdSum = 0
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - radius)
    const y1 = Math.min(height - 1, y + radius)
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - radius)
      const x1 = Math.min(width - 1, x + radius)
      const area = (x1 - x0 + 1) * (y1 - y0 + 1)
      const sum = integral[(y1 + 1) * (width + 1) + x1 + 1]
        - integral[y0 * (width + 1) + x1 + 1]
        - integral[(y1 + 1) * (width + 1) + x0]
        + integral[y0 * (width + 1) + x0]
      const localMean = sum / area
      const threshold = ratio ? localMean * ratio : localMean - bias
      thresholdSum += threshold
      if (gray[y * width + x] < threshold) {
        mask[y * width + x] = 1
        ink += 1
      }
    }
  }
  return { mask, ink, threshold: thresholdSum / (width * height) }
}

function maskFromGray(gray, width, height, options = {}) {
  const threshold = Number(options.threshold) || otsuThreshold(gray)
  let mask = new Uint8Array(width * height)
  let ink = 0
  for (let i = 0; i < gray.length; i += 1) {
    if (gray[i] < threshold) {
      mask[i] = 1
      ink += 1
    }
  }
  // 深底浅字：如果一半以上都是“墨”，按反相处理。
  if (ink > gray.length * 0.55) {
    mask = mask.map((value) => (value ? 0 : 1))
    ink = gray.length - ink
  }
  return { mask, ink, threshold }
}

function removeLongLines(mask, width, height, options = {}) {
  const minRunX = Math.max(24, Math.round(width * (Number(options.minRunX) || 0.14)))
  const minRunY = Math.max(24, Math.round(height * (Number(options.minRunY) || 0.2)))
  let removed = 0
  for (let y = 0; y < height; y += 1) {
    let x = 0
    while (x < width) {
      if (!mask[y * width + x]) { x += 1; continue }
      let end = x + 1
      while (end < width && mask[y * width + end]) end += 1
      if (end - x >= minRunX) {
        for (let i = x; i < end; i += 1) {
          if (mask[y * width + i]) { mask[y * width + i] = 0; removed += 1 }
        }
      }
      x = end
    }
  }
  for (let x = 0; x < width; x += 1) {
    let y = 0
    while (y < height) {
      if (!mask[y * width + x]) { y += 1; continue }
      let end = y + 1
      while (end < height && mask[end * width + x]) end += 1
      if (end - y >= minRunY) {
        for (let i = y; i < end; i += 1) {
          if (mask[i * width + x]) { mask[i * width + x] = 0; removed += 1 }
        }
      }
      y = end
    }
  }
  return removed
}

function removeSpecks(mask, width, height, minArea) {
  const seen = new Uint8Array(mask.length)
  const out = new Uint8Array(mask.length)
  const stack = new Int32Array(mask.length)
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue
    let top = 0
    stack[top++] = start
    seen[start] = 1
    const pixels = []
    while (top) {
      const index = stack[--top]
      pixels.push(index)
      const x = index % width
      const y = (index / width) | 0
      if (x > 0 && mask[index - 1] && !seen[index - 1]) { seen[index - 1] = 1; stack[top++] = index - 1 }
      if (x + 1 < width && mask[index + 1] && !seen[index + 1]) { seen[index + 1] = 1; stack[top++] = index + 1 }
      if (y > 0 && mask[index - width] && !seen[index - width]) { seen[index - width] = 1; stack[top++] = index - width }
      if (y + 1 < height && mask[index + width] && !seen[index + width]) { seen[index + width] = 1; stack[top++] = index + width }
    }
    if (pixels.length >= minArea) {
      for (const index of pixels) out[index] = 1
    }
  }
  return out
}

function neighbors8(index, width, height, mask) {
  const x = index % width
  const y = (index / width) | 0
  const out = []
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (!dx && !dy) continue
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      const next = ny * width + nx
      if (mask[next]) out.push(next)
    }
  }
  return out
}

// Zhang-Suen 细化。返回只剩中心线的 mask。
function skeletonize(mask, width, height) {
  const image = new Uint8Array(mask)
  const marker = new Uint8Array(image.length)
  let changed = true
  let guard = 0
  while (changed && guard < 400) {
    changed = false
    guard += 1
    for (let pass = 0; pass < 2; pass += 1) {
      marker.fill(0)
      for (let y = 1; y < height - 1; y += 1) {
        for (let x = 1; x < width - 1; x += 1) {
          const index = y * width + x
          if (!image[index]) continue
          const p2 = image[index - width]
          const p3 = image[index - width + 1]
          const p4 = image[index + 1]
          const p5 = image[index + width + 1]
          const p6 = image[index + width]
          const p7 = image[index + width - 1]
          const p8 = image[index - 1]
          const p9 = image[index - width - 1]
          const neighbors = [p2, p3, p4, p5, p6, p7, p8, p9, p2]
          let count = 0
          let transitions = 0
          for (let i = 0; i < 8; i += 1) {
            if (neighbors[i]) count += 1
            if (!neighbors[i] && neighbors[i + 1]) transitions += 1
          }
          if (count < 2 || count > 6 || transitions !== 1) continue
          const a = pass === 0
            ? !(p2 && p4 && p6)
            : !(p2 && p4 && p8)
          const b = pass === 0
            ? !(p4 && p6 && p8)
            : !(p2 && p6 && p8)
          if (a && b) marker[index] = 1
        }
      }
      let removed = 0
      for (let i = 0; i < image.length; i += 1) {
        if (marker[i]) {
          image[i] = 0
          removed += 1
        }
      }
      if (removed) changed = true
    }
  }
  return image
}

function rdp(points, epsilon) {
  if (points.length < 3) return points
  const sq = epsilon * epsilon
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const stack = [[0, points.length - 1]]
  while (stack.length) {
    const [start, end] = stack.pop()
    const [x1, y1] = points[start]
    const [x2, y2] = points[end]
    const dx = x2 - x1
    const dy = y2 - y1
    const denom = dx * dx + dy * dy
    let best = -1
    let bestDistance = 0
    for (let i = start + 1; i < end; i += 1) {
      const [px, py] = points[i]
      let distance
      if (!denom) {
        distance = (px - x1) ** 2 + (py - y1) ** 2
      } else {
        const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / denom))
        const qx = x1 + t * dx
        const qy = y1 + t * dy
        distance = (px - qx) ** 2 + (py - qy) ** 2
      }
      if (distance > bestDistance) {
        bestDistance = distance
        best = i
      }
    }
    if (best >= 0 && bestDistance > sq) {
      keep[best] = 1
      stack.push([start, best], [best, end])
    }
  }
  return points.filter((_, index) => keep[index])
}

function traceSkeleton(skeleton, width, height) {
  const visited = new Uint8Array(skeleton.length)
  const degree = new Uint8Array(skeleton.length)
  let total = 0
  for (let i = 0; i < skeleton.length; i += 1) {
    if (!skeleton[i]) continue
    total += 1
    degree[i] = neighbors8(i, width, height, skeleton).length
  }
  const paths = []
  const walk = (start) => {
    const points = []
    let current = start
    let previous = -1
    let guard = 0
    while (current >= 0 && !visited[current] && guard < skeleton.length) {
      guard += 1
      visited[current] = 1
      points.push([current % width, (current / width) | 0])
      const options = neighbors8(current, width, height, skeleton).filter((next) => next !== previous && !visited[next])
      if (!options.length) break
      let next = options[0]
      if (options.length > 1) {
        // 交叉点优先保持方向，减少来回拐。
        const px = current % width
        const py = (current / width) | 0
        let bestScore = -Infinity
        for (const candidate of options) {
          const cx = candidate % width
          const cy = (candidate / width) | 0
          const dx = cx - px
          const dy = cy - py
          const score = previous >= 0
            ? dx * (px - (previous % width)) + dy * (py - ((previous / width) | 0))
            : 0
          if (score > bestScore) {
            bestScore = score
            next = candidate
          }
        }
      }
      previous = current
      current = next
    }
    return points
  }
  for (let i = 0; i < skeleton.length; i += 1) {
    if (skeleton[i] && !visited[i] && degree[i] !== 2) {
      const points = walk(i)
      if (points.length >= 4) paths.push(points)
    }
  }
  for (let i = 0; i < skeleton.length; i += 1) {
    if (skeleton[i] && !visited[i]) {
      const points = walk(i)
      if (points.length >= 4) paths.push(points)
    }
  }
  return { paths, total, degree }
}

// 3-4 倒角距离变换：给每个墨迹像素算到背景的距离（近似笔半径）。
function distanceTransform(mask, width, height) {
  const INF = 1e9
  const dist = new Float32Array(mask.length)
  for (let i = 0; i < mask.length; i += 1) dist[i] = mask[i] ? INF : 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x
      if (!dist[i]) continue
      let value = dist[i]
      if (y > 0) value = Math.min(value, dist[i - width] + 1)
      if (x > 0) value = Math.min(value, dist[i - 1] + 1)
      if (x > 0 && y > 0) value = Math.min(value, dist[i - width - 1] + 1.4142)
      if (x + 1 < width && y > 0) value = Math.min(value, dist[i - width + 1] + 1.4142)
      dist[i] = value
    }
  }
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const i = y * width + x
      if (!dist[i]) continue
      let value = dist[i]
      if (y + 1 < height) value = Math.min(value, dist[i + width] + 1)
      if (x + 1 < width) value = Math.min(value, dist[i + 1] + 1)
      if (x + 1 < width && y + 1 < height) value = Math.min(value, dist[i + width + 1] + 1.4142)
      if (x > 0 && y + 1 < height) value = Math.min(value, dist[i + width - 1] + 1.4142)
      dist[i] = value
    }
  }
  return dist
}

function pathLength(points) {
  let length = 0
  for (let i = 1; i < points.length; i += 1) {
    length += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])
  }
  return length
}

function percentile(values, p) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))
  return sorted[index]
}

function componentBoxes(mask, width, height) {
  const seen = new Uint8Array(mask.length)
  const stack = new Int32Array(mask.length)
  const boxes = []
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue
    let top = 0
    stack[top++] = start
    seen[start] = 1
    let minX = width
    let minY = height
    let maxX = 0
    let maxY = 0
    let area = 0
    while (top) {
      const index = stack[--top]
      const x = index % width
      const y = (index / width) | 0
      area += 1
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
      if (x > 0 && mask[index - 1] && !seen[index - 1]) { seen[index - 1] = 1; stack[top++] = index - 1 }
      if (x + 1 < width && mask[index + 1] && !seen[index + 1]) { seen[index + 1] = 1; stack[top++] = index + 1 }
      if (y > 0 && mask[index - width] && !seen[index - width]) { seen[index - width] = 1; stack[top++] = index - width }
      if (y + 1 < height && mask[index + width] && !seen[index + width]) { seen[index + width] = 1; stack[top++] = index + width }
    }
    boxes.push({ x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1, area })
  }
  return boxes
}

function median(values) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function fitSlant(paths) {
  const slopes = []
  for (const points of paths) {
    if (points.length < 3) continue
    let maxY = -Infinity
    for (const [, y] of points) maxY = Math.max(maxY, y)
    let sx = 0
    let sy = 0
    let sxx = 0
    let sxy = 0
    let n = 0
    for (const [x, y] of points) {
      const h = maxY - y
      sx += x
      sy += h
      sxx += x * x
      sxy += x * h
      n += 1
    }
    const denom = n * sxx - sx * sx
    if (n >= 3 && Math.abs(denom) > 1e-6) {
      const slope = (n * sxy - sx * sy) / denom
      if (Number.isFinite(slope)) slopes.push(slope)
    }
  }
  return slopes.length ? median(slopes) : 0
}

function fitJitter(paths, emPx) {
  const residuals = []
  for (const points of paths) {
    if (points.length < 5) continue
    for (let i = 2; i < points.length - 2; i += 1) {
      const avgX = (points[i - 2][0] + points[i - 1][0] + points[i][0] + points[i + 1][0] + points[i + 2][0]) / 5
      const avgY = (points[i - 2][1] + points[i - 1][1] + points[i][1] + points[i + 1][1] + points[i + 2][1]) / 5
      residuals.push(Math.hypot(points[i][0] - avgX, points[i][1] - avgY))
    }
  }
  const typical = residuals.length ? median(residuals) : 0
  return typical / Math.max(1, emPx * 0.0035)
}

export function vectorizePng(buffer, options = {}) {
  const decoded = decodePng(buffer)
  const image = resizeRgba(decoded, Number(options.maxDim) || 900)
  const gray = luminanceOnWhite(image.rgba)
  const thresholdMask = options.adaptive === false
    ? maskFromGray(gray, image.width, image.height, options)
    : adaptiveMask(gray, image.width, image.height, options)
  const minArea = Math.max(4, Math.round(thresholdMask.ink * (Number(options.minAreaRatio) || 0.0015)))
  if (options.removeLines !== false) removeLongLines(thresholdMask.mask, image.width, image.height, options)
  const mask = removeSpecks(thresholdMask.mask, image.width, image.height, minArea)
  const boxes = componentBoxes(mask, image.width, image.height).filter((box) => box.area >= minArea)
  let minX = image.width
  let minY = image.height
  let maxX = 0
  let maxY = 0
  for (const box of boxes) {
    minX = Math.min(minX, box.x)
    minY = Math.min(minY, box.y)
    maxX = Math.max(maxX, box.x + box.width)
    maxY = Math.max(maxY, box.y + box.height)
  }
  if (!boxes.length) throw new Error('IMAGE_NO_INK: 没找到笔画，换一张对比度更高的图')
  const pad = 2
  const cropX = Math.max(0, minX - pad)
  const cropY = Math.max(0, minY - pad)
  const cropW = Math.min(image.width, maxX + pad) - cropX
  const cropH = Math.min(image.height, maxY + pad) - cropY
  const crop = new Uint8Array(cropW * cropH)
  let inkPixels = 0
  for (let y = 0; y < cropH; y += 1) {
    for (let x = 0; x < cropW; x += 1) {
      const value = mask[(y + cropY) * image.width + (x + cropX)]
      crop[y * cropW + x] = value
      if (value) inkPixels += 1
    }
  }
  const skeleton = skeletonize(crop, cropW, cropH)
  const dist = distanceTransform(crop, cropW, cropH)
  const traced = traceSkeleton(skeleton, cropW, cropH)
  const rawPaths = traced.paths
  const paths = rawPaths
    .map((points) => rdp(points.map(([x, y]) => [x + cropX, y + cropY]), Number(options.simplify) || 1.35))
    .filter((points) => points.length >= 2 && pathLength(points) >= 5)
  if (!paths.length) throw new Error('IMAGE_NO_STROKE: 没有追踪到可用笔画，可能笔画太粗或噪声太多')
  const heights = boxes.map((box) => box.height)
  const bboxHeight = maxY - minY
  const capPx = percentile(heights, 0.82)
  const emPx = Math.max(28, capPx / 0.5 || bboxHeight / 0.62)
  const strokeLength = paths.reduce((sum, points) => sum + pathLength(points), 0)
  const radii = []
  for (let y = 0; y < cropH; y += 1) {
    for (let x = 0; x < cropW; x += 1) {
      if (skeleton[y * cropW + x]) radii.push(dist[y * cropW + x])
    }
  }
  const widthFromSkeleton = radii.length ? median(radii) * 2 : 0
  const avgWidth = widthFromSkeleton ? widthFromSkeleton * 2 : inkPixels / Math.max(1, strokeLength)
  const bottoms = boxes.map((box) => box.y + box.height)
  const bottomMedian = median(bottoms)
  const bouncePx = median(bottoms.map((value) => Math.abs(value - bottomMedian)))
  const gaps = []
  const ordered = [...boxes].sort((a, b) => a.x - b.x)
  for (let i = 1; i < ordered.length; i += 1) {
    gaps.push(Math.max(0, ordered[i].x - (ordered[i - 1].x + ordered[i - 1].width)))
  }
  const gapAvg = gaps.length ? gaps.reduce((sum, value) => sum + value, 0) / gaps.length : 0
  const slant = fitSlant(paths) * 0.75
  const jitter = fitJitter(rawPaths, emPx)
  const weight = avgWidth / emPx
  const features = {
    slant: Math.max(-0.35, Math.min(0.35, slant)),
    weight: Math.max(0.018, Math.min(0.16, weight)),
    contrast: 0.55,
    roundness: 0.55,
    jitter: Math.max(0.35, Math.min(3, 0.35 + jitter)),
    bounce: Math.max(0, Math.min(0.03, bouncePx / emPx)),
    tracking: Math.max(0.025, Math.min(0.15, (gapAvg / emPx) * 0.5)),
    taper: 0.35,
    alpha: 1,
    xHeight: 0.3,
    capHeight: Math.max(0.25, Math.min(0.62, capPx / emPx)),
  }
  return {
    image: { width: image.width, height: image.height, inkPixels, boxes: boxes.length },
    strokes: paths,
    features,
    meta: {
      threshold: thresholdMask.threshold,
      emPx,
      avgWidth,
      strokeLength,
      strokeCount: paths.length,
      bbox: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
    },
  }
}

export function toSvgPaths(strokes, width, height, options = {}) {
  const color = options.color || '#243447'
  const lineWidth = Number(options.lineWidth) || 2
  const body = strokes.map((points) => {
    const d = points.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
    return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${lineWidth}" stroke-linecap="round" stroke-linejoin="round"/>`
  }).join('\n')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#fffdf5"/>${body}</svg>`
}
