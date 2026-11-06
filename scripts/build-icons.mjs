#!/usr/bin/env node
/**
 * 生成 PWA 图标与 favicon（不依赖在线字体/图片）。
 * 运行前提：python scripts/extract-glyphs.py 已生成 assets-src/glyphs.json
 */
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const root = process.cwd()
const glyphs = JSON.parse(await readFile(path.join(root, 'assets-src', 'glyphs.json'), 'utf8'))
const outDir = path.join(root, 'public', 'icons')
await mkdir(outDir, { recursive: true })

const PAPER = '#e7ddc9'
const INK = '#0b0b0c'

function glyphGroup(char, size, x, y) {
  const info = glyphs.glyphs[char]
  if (!info) throw new Error(`No glyph for ${char}`)
  const [x1, y1, x2, y2] = info.bounds
  const width = Math.max(1, x2 - x1)
  const height = Math.max(1, y2 - y1)
  const scale = Math.min(size / width, size / height)
  const drawX = x - ((x2 - x1) * scale) / 2 - x1 * scale
  const drawY = y + ((y2 - y1) * scale) / 2 + y1 * scale
  return `<g transform="translate(${drawX.toFixed(2)} ${drawY.toFixed(2)}) scale(${scale.toFixed(5)} -${scale.toFixed(5)})"><path d="${info.path}"/></g>`
}

function sealPolygon(cx, cy, size, seed = 0) {
  const jitter = [0, 2.4, -1.8, 1.1, -2.2, 1.7, -1.2, 2.5, -0.8, 1.9, -2.6, 1.3, -1.5, 2.1, -2.3, 0.9, -0.6, 2.2, -1.9, 1.4]
  const points = [
    [0.018, 0.012], [0.15, 0.002], [0.3, 0.01], [0.45, 0.0], [0.6, 0.008],
    [0.75, 0.001], [0.9, 0.009], [0.986, 0.02], [0.998, 0.16], [0.991, 0.32],
    [1.0, 0.5], [0.993, 0.67], [1.0, 0.84], [0.982, 0.988], [0.85, 1.0],
    [0.68, 0.992], [0.5, 1.0], [0.33, 0.993], [0.16, 1.0], [0.016, 0.982],
    [0.0, 0.84], [0.009, 0.66], [0.0, 0.48], [0.006, 0.3], [0.0, 0.14],
  ]
  const left = cx - size / 2
  const top = cy - size / 2
  return points
    .map(([px, py], index) => {
      const dx = jitter[(index + seed) % jitter.length] * (size / 340)
      const dy = jitter[(index + seed + 9) % jitter.length] * (size / 340)
      return `${(left + px * size + dx).toFixed(1)},${(top + py * size + dy).toFixed(1)}`
    })
    .join(' ')
}

function iconSvg({ maskable = false } = {}) {
  const sealSize = maskable ? 300 : 358
  const charSize = maskable ? 108 : 128
  const gap = maskable ? 3 : 6
  const cx = 256
  const cy = 256
  const total = charSize * 2 + gap
  const topY = cy - total / 2 + charSize / 2
  const bottomY = topY + charSize + gap

  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="bg" cx="50%" cy="36%" r="80%">
      <stop offset="0" stop-color="#191714"/>
      <stop offset="0.55" stop-color="#100e0d"/>
      <stop offset="1" stop-color="${INK}"/>
    </radialGradient>
    <linearGradient id="seal" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ab3530"/>
      <stop offset="0.52" stop-color="#992622"/>
      <stop offset="1" stop-color="#7d1a17"/>
    </linearGradient>
    <radialGradient id="stain" cx="62%" cy="20%" r="70%">
      <stop offset="0" stop-color="#b14a40" stop-opacity="0.16"/>
      <stop offset="1" stop-color="#b14a40" stop-opacity="0"/>
    </radialGradient>
    <filter id="grain" x="-10%" y="-10%" width="120%" height="120%">
      <feTurbulence type="fractalNoise" baseFrequency="0.82" numOctaves="3" stitchTiles="stitch" result="noise"/>
      <feColorMatrix in="noise" type="saturate" values="0"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.16"/></feComponentTransfer>
    </filter>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <rect width="512" height="512" fill="url(#stain)"/>
  <circle cx="256" cy="246" r="196" fill="none" stroke="#d8d1c3" stroke-opacity="0.035" stroke-width="1.2"/>
  <g transform="rotate(-2.2 ${cx} ${cy})">
    <polygon points="${sealPolygon(cx, cy, sealSize, 3)}" fill="url(#seal)"/>
    <rect x="${cx - sealSize / 2 + 18}" y="${cy - sealSize / 2 + 18}" width="${sealSize - 36}" height="${sealSize - 36}" fill="none" stroke="${PAPER}" stroke-opacity="0.14" stroke-width="1.1"/> 
    <g fill="${PAPER}" fill-opacity="0.95">
      ${glyphGroup('无', charSize, cx, topY)}
      ${glyphGroup('锋', charSize, cx, bottomY)}
    </g>
  </g>
  <rect width="512" height="512" filter="url(#grain)" opacity="0.55" fill="#ffffff" style="mix-blend-mode:soft-light"/>
</svg>`
}

const standard = iconSvg({ maskable: false })
const maskable = iconSvg({ maskable: true })

await writeFile(path.join(root, 'public', 'favicon.svg'), standard)

for (const size of [192, 512]) {
  await sharp(Buffer.from(standard)).resize(size, size).png({ compressionLevel: 9 }).toFile(
    path.join(outDir, `icon-${size}.png`),
  )
}
await sharp(Buffer.from(standard)).resize(180, 180).png({ compressionLevel: 9 }).toFile(
  path.join(outDir, 'apple-touch-icon.png'),
)
await sharp(Buffer.from(maskable)).resize(512, 512).png({ compressionLevel: 9 }).toFile(
  path.join(outDir, 'icon-maskable-512.png'),
)
console.log('icons generated: 192 / 512 / maskable / apple-touch / favicon')
