import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

function crc32(buf) {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i]
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type)
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

function writePng(path, size, paint) {
  const pixels = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = paint(x, y, size)
      const i = (y * size + x) * 4
      pixels[i] = r
      pixels[i + 1] = g
      pixels[i + 2] = b
      pixels[i + 3] = a
    }
  }

  const raw = Buffer.alloc(size * (1 + size * 4))
  for (let y = 0; y < size; y++) {
    raw[y * (1 + size * 4)] = 0
    pixels.copy(raw, y * (1 + size * 4) + 1, y * size * 4, (y + 1) * size * 4)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6

  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
  writeFileSync(path, png)
}

function inHexagon(px, py, cx, cy, r) {
  const dx = Math.abs(px - cx) / r
  const dy = Math.abs(py - cy) / r
  return dy <= 0.866 && dx <= 1 - dy / 1.732
}

function paintIcon(x, y, size) {
  const cx = (size - 1) / 2
  const cy = (size - 1) / 2
  const outer = size * 0.42
  const inner = size * 0.28
  const core = size * 0.12

  if (inHexagon(x, y, cx, cy, outer)) {
    if (!inHexagon(x, y, cx, cy, inner)) return [34, 211, 238, 255]
    if (inHexagon(x, y, cx, cy, core)) return [168, 85, 247, 255]
    return [9, 9, 11, 255]
  }
  return [9, 9, 11, 255]
}

writePng(join(ROOT, 'favicon.png'), 192, paintIcon)
writePng(join(ROOT, 'logo.png'), 512, paintIcon)
console.log('Wrote public/favicon.png (192) and public/logo.png (512)')
