// Renders build/icon.png (256×256) — the same bold "Q" glyph as the runtime icon (src/main/icon.ts).
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const size = 256
const [R, G, B] = [124, 108, 246]
function qCoverage(u, v) {
  const r = Math.hypot(u - 0.5, v - 0.47)
  if (r <= 0.4 && r >= 0.245) return true
  const [ax, ay, bx, by] = [0.57, 0.6, 0.86, 0.9]
  const t = Math.max(0, Math.min(1, ((u - ax) * (bx - ax) + (v - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)))
  return Math.hypot(u - (ax + t * (bx - ax)), v - (ay + t * (by - ay))) <= 0.075
}
const raw = Buffer.alloc((size * 4 + 1) * size)
const N = 4
for (let y = 0; y < size; y++) {
  raw[y * (size * 4 + 1)] = 0
  for (let x = 0; x < size; x++) {
    let hits = 0
    for (let sy = 0; sy < N; sy++) for (let sx = 0; sx < N; sx++) if (qCoverage((x + (sx + 0.5) / N) / size, (y + (sy + 0.5) / N) / size)) hits++
    raw.set([R, G, B, Math.round((hits / (N * N)) * 255)], y * (size * 4 + 1) + 1 + x * 4)
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let k = n
  for (let i = 0; i < 8; i++) k = k & 1 ? 0xedb88320 ^ (k >>> 1) : k >>> 1
  return k >>> 0
})
const crc32 = (buf) => {
  let crc = 0xffffffff
  for (const b of buf) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(size, 0)
ihdr.writeUInt32BE(size, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
])
writeFileSync(new URL('../build/icon.png', import.meta.url), png)
console.log('build/icon.png written')
