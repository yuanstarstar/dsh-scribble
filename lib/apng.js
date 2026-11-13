// APNG assembler: takes PNG frames of identical size and writes an animated PNG.
// Reuses the existing PNG encoder; no external dependency and no palette loss.

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

function readChunks(buffer) {
  if (buffer.length < 8 || buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('APNG_BAD_SIGNATURE')
  const chunks = []
  let offset = 8
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    chunks.push({ type, data })
    offset += 12 + length
    if (type === 'IEND') break
  }
  return chunks
}

function fcTL(sequence, width, height, delay, dispose = 0, blend = 0) {
  const data = Buffer.alloc(26)
  data.writeUInt32BE(sequence >>> 0, 0)
  data.writeUInt32BE(width, 4)
  data.writeUInt32BE(height, 8)
  data.writeUInt32BE(0, 12)
  data.writeUInt32BE(0, 16)
  data.writeUInt16BE(Math.max(1, Math.round(delay)) & 0xffff, 20)
  data.writeUInt16BE(100, 22)
  data[24] = dispose
  data[25] = blend
  return chunk('fcTL', data)
}

export function framesToApng(frames, options = {}) {
  if (!Array.isArray(frames) || !frames.length) throw new Error('APNG_NO_FRAMES')
  const parsed = frames.map((frame) => readChunks(frame))
  const first = parsed[0]
  const ihdr = first.find((c) => c.type === 'IHDR')?.data
  if (!ihdr) throw new Error('APNG_NO_IHDR')
  const width = ihdr.readUInt32BE(0)
  const height = ihdr.readUInt32BE(4)
  const delay = Math.max(2, Math.round(Number(options.delay) || 7))
  const loop = Math.max(0, Math.round(Number(options.loop) || 0))
  const out = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr)]

  const actl = Buffer.alloc(8)
  actl.writeUInt32BE(frames.length, 0)
  actl.writeUInt32BE(loop, 4)
  out.push(chunk('acTL', actl))

  let sequence = 0
  for (let i = 0; i < parsed.length; i += 1) {
    const idat = Buffer.concat(parsed[i].filter((c) => c.type === 'IDAT').map((c) => c.data))
    if (!idat.length) throw new Error('APNG_NO_IDAT')
    out.push(fcTL(sequence, width, height, delay))
    sequence += 1
    if (i === 0) {
      out.push(chunk('IDAT', idat))
    } else {
      const payload = Buffer.alloc(4 + idat.length)
      payload.writeUInt32BE(sequence >>> 0, 0)
      idat.copy(payload, 4)
      out.push(chunk('fdAT', payload))
      sequence += 1
    }
  }
  out.push(chunk('IEND', Buffer.alloc(0)))
  return Buffer.concat(out)
}
