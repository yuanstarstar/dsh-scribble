import { decodePng } from './vectorize.js'
import { framesToApng } from './apng.js'
import { encodePng } from './canvas.js'
import { renderScene, renderText } from './render.js'

function scaleNearest(image, width, height) {
  const data = new Uint8ClampedArray(width * height * 4)
  const xRatio = image.width / width
  const yRatio = image.height / height
  for (let y = 0; y < height; y += 1) {
    const sy = Math.min(image.height - 1, Math.floor(y * yRatio))
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(image.width - 1, Math.floor(x * xRatio))
      const src = (sy * image.width + sx) * 4
      const dst = (y * width + x) * 4
      data[dst] = image.rgba[src]
      data[dst + 1] = image.rgba[src + 1]
      data[dst + 2] = image.rgba[src + 2]
      data[dst + 3] = image.rgba[src + 3]
    }
  }
  return { width, height, rgba: data }
}

export function buildAnimation(kind, args, totalOps, options = {}) {
  const maxFrames = Math.max(2, Math.min(160, Number(options.maxFrames) || 32))
  const maxWidth = Math.max(240, Math.min(900, Number(options.width) || 720))
  const ops = Math.max(0, Math.round(Number(totalOps) || 0))
  if (ops < 2) return null
  const count = Math.min(maxFrames, ops * 3)
  const render = kind === 'scene' ? renderScene : renderText
  const frames = []
  const points = []
  for (let i = 1; i <= count; i += 1) {
    const opPosition = (ops * i) / count
    const revealOp = i === count ? ops : Math.floor(opPosition)
    const revealProgress = i === count ? 1 : opPosition - revealOp
    points.push([revealOp, revealProgress])
    const rendered = render({ ...args, revealOp, revealProgress })
    frames.push(decodePng(rendered.png))
  }
  const last = frames[frames.length - 1]
  const width = Math.min(maxWidth, last.width)
  const height = Math.max(1, Math.round((last.height * width) / last.width))
  const pngFrames = frames.map((frame) => {
    const scaled = scaleNearest(frame, width, height)
    return encodePng(Buffer.from(scaled.rgba), width, height)
  })
  const apng = framesToApng(pngFrames, { delay: 7, loop: 0 })
  return { apng, width, height, frames: count, ops, points }
}
