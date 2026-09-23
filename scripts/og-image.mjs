// The link-preview image: public/og-image.png, 1200x630, which WhatsApp, iMessage and the rest show when the
// site is shared.
//
//   node scripts/og-image.mjs [out.png]
//
// It is the loading screen's last frame, drawn by the app's own drawBlob: the blob resolved into the mark, the
// wordmark under it, on paper. Rerun it whenever the mark changes.
//
// It departs from the screen twice. LoadingScreen sets the wordmark at a fixed 30px while the mark scales with
// the viewport, so how big one is next to the other depends on the device; this keeps the proportion a phone
// shows, which is where most people will meet the link, and which keeps the name readable at chat-bubble size.
// And it centres the lockup on its ink rather than putting the mark in the middle, so the whole of it survives
// the centre square some chat apps crop the image to.
//
// Needs puppeteer-core, which the project doesn't depend on: set PUPPETEER_FROM to a directory whose
// node_modules has it. CHROME_PATH defaults to the macOS Chrome install. Baloo 2 comes from Google Fonts, so it
// needs the network.

import fs from 'node:fs'
import http from 'node:http'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PROJECT = fileURLToPath(new URL('..', import.meta.url))
const OUT = path.resolve(process.argv[2] ?? path.join(PROJECT, 'public/og-image.png'))

const WIDTH = 1200
const HEIGHT = 630
const MARK_RADIUS = 170 // the resolved mark's radius, as drawBlob reports it; everything else scales from this

// LoadingScreen's wordmark: font-ui, font-extrabold, tracking-[-.01em], text-ink, leading-none, its box centred
// round(radius * 1.5) below the mark's centre.
const WORDMARK = { text: 'Morse Club', family: 'Baloo 2', weight: 800, tracking: -0.01, color: '#3b2214' }
// The wordmark is 30px on every device; this is the one whose proportion to the mark we keep.
const PHONE = { width: 390, height: 844, wordmarkPx: 30 }

const WHATSAPP_MAX_BYTES = 300 * 1024 // WhatsApp has been seen to drop preview images much over this

const FONTS = `https://fonts.googleapis.com/css2?family=${WORDMARK.family.replaceAll(' ', '+')}:wght@${WORDMARK.weight}&display=block`
const PAGE = `<!doctype html><link rel="stylesheet" href="${FONTS}">`

const require = createRequire(path.join(process.env.PUPPETEER_FROM ?? PROJECT, 'noop.js'))
const imported = await import(pathToFileURL(require.resolve('puppeteer-core')).href)
const puppeteer = imported.default?.launch ? imported.default : imported.default.default

const server = await serve()
const origin = `http://127.0.0.1:${server.address().port}`
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
})
try {
  const page = await browser.newPage()
  await page.goto(`${origin}/`, { waitUntil: 'load' })
  const { dataUrl, wordmarkPx } = await page.evaluate(compose, {
    blobUrl: `${origin}/src/lib/blob.js`,
    width: WIDTH,
    height: HEIGHT,
    markRadius: MARK_RADIUS,
    wordmark: WORDMARK,
    phone: PHONE,
  })
  const png = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')
  fs.writeFileSync(OUT, png)
  console.log(
    `${path.relative(PROJECT, OUT)}: ${WIDTH}x${HEIGHT}, mark radius ${MARK_RADIUS}px, ` +
      `wordmark ${wordmarkPx}px, ${Math.round(png.length / 1024)} KB`,
  )
  if (png.length > WHATSAPP_MAX_BYTES) console.warn(`Over ${WHATSAPP_MAX_BYTES / 1024} KB: WhatsApp may show the link with no image.`)
} finally {
  await browser.close()
  server.close()
}

// Runs in the page: draws the frame and returns it as a PNG data URL.
async function compose({ blobUrl, width, height, markRadius, wordmark, phone }) {
  const { drawBlob, PAPER } = await import(blobUrl)
  // The last frame of the resolve, at rest: no squash, no breath, no wobble.
  const pose = { entry: 1, resolve: 1, restOnly: true }
  const canvasOf = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h }).getContext('2d')
  const scratch = canvasOf(1, 1)
  const radiusIn = (w, h) => drawBlob(scratch, w, h, 0, pose).radius

  // drawBlob sizes the mark from its viewport: find the square viewport that gives markRadius, and the wordmark
  // size that keeps the phone's proportion to it.
  const viewport = (1000 * markRadius) / radiusIn(1000, 1000)
  const wordmarkPx = Math.round((phone.wordmarkPx * markRadius) / radiusIn(phone.width, phone.height))

  const font = `${wordmark.weight} ${wordmarkPx}px "${wordmark.family}"`
  if (!(await document.fonts.load(font, wordmark.text)).length) throw new Error(`${wordmark.family} didn't load.`)

  function draw(ctx, cy) {
    const { width: w } = ctx.canvas
    ctx.clearRect(0, 0, w, ctx.canvas.height)
    ctx.save()
    ctx.translate((w - viewport) / 2, cy - viewport / 2)
    const { radius } = drawBlob(ctx, viewport, viewport, 0, pose)
    ctx.restore()
    if (Math.abs(radius - markRadius) > 0.01) throw new Error(`Drew the mark at radius ${radius}, not ${markRadius}.`)

    ctx.font = font
    ctx.letterSpacing = `${wordmark.tracking * wordmarkPx}px`
    ctx.textAlign = 'center'
    ctx.fillStyle = wordmark.color
    // In a line-height 1 box the baseline sits (ascent - descent) / 2 below the box's centre.
    const { fontBoundingBoxAscent: ascent, fontBoundingBoxDescent: descent } = ctx.measureText(wordmark.text)
    ctx.fillText(wordmark.text, w / 2, cy + Math.round(radius * 1.5) + (ascent - descent) / 2)
  }

  // The first and last rows and columns with any ink in them.
  function inkBounds(ctx) {
    const { width: w, height: h } = ctx.canvas
    const { data } = ctx.getImageData(0, 0, w, h)
    const ink = { top: h, bottom: -1, left: w, right: -1 }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] === 0) continue
        ink.top = Math.min(ink.top, y)
        ink.bottom = y
        ink.left = Math.min(ink.left, x)
        ink.right = Math.max(ink.right, x)
      }
    }
    return ink
  }

  // Draw once with room to spare to find where the ink falls around the mark, then again with that ink centred.
  const probe = canvasOf(width, height * 3)
  const probeCy = Math.round(height * 1.5)
  draw(probe, probeCy)
  const ink = inkBounds(probe)
  const inkWidth = ink.right - ink.left + 1
  const inkHeight = ink.bottom - ink.top + 1
  if (inkWidth > height || inkHeight > height) {
    throw new Error(`The lockup is ${inkWidth}x${inkHeight}px; it has to fit the ${height}px centre square.`)
  }
  const frame = canvasOf(width, height)
  draw(frame, probeCy + Math.round((height - 1 - ink.top - ink.bottom) / 2))

  // drawBlob leaves everything but the mark transparent: in the app the canvas sits on a bg-paper div.
  frame.globalCompositeOperation = 'destination-over'
  frame.fillStyle = PAPER
  frame.fillRect(0, 0, width, height)
  return { dataUrl: frame.canvas.toDataURL('image/png'), wordmarkPx }
}

// The page, and the app's modules for it to import.
function serve() {
  const src = path.join(PROJECT, 'src') + path.sep
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(PAGE)
      return
    }
    const file = path.join(PROJECT, decodeURIComponent(url.pathname))
    if (!file.startsWith(src) || path.extname(file) !== '.js' || !fs.existsSync(file)) {
      res.writeHead(404)
      res.end()
      return
    }
    res.writeHead(200, { 'content-type': 'text/javascript' })
    fs.createReadStream(file).pipe(res)
  })
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)))
}
