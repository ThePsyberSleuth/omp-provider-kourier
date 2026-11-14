// Pins the video finding in the README: Kourier's chat + responses schemas accept images
// but drop/refuse video parts. Skips without a key, so it is CI-safe.
//
// The signal is prompt-token accounting, not HTTP status: a dropped video part returns
// 200 with the media discarded, which no status check can catch.
import {describe, expect, test} from 'bun:test'
import zlib from 'node:zlib'

const key = process.env.KOURIER_API_KEY
const model = 'deepseek-v4.1-flash'
const prompt = 'List, in order, the colours shown by the attached media from first to last.'

// Minimal valid PNG via raw deflate of scanlines; solid colour, 8x8.
function solidPng(r: number, g: number, b: number): Buffer {
  const w = 8, h = 8
  const raw = Buffer.alloc(h * (w * 3 + 1))
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1)
    for (let x = 0; x < w; x++) {
      raw[row + 1 + x * 3] = r
      raw[row + 2 + x * 3] = g
      raw[row + 3 + x * 3] = b
    }
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body) >>> 0)
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// Structurally valid MP4 header; the point is that it is well-formed enough to route.
const MP4 = (() => {
  const b = Buffer.alloc(2048)
  Buffer.from([0, 0, 0, 0x18]).copy(b, 0)
  b.write('ftypisom', 4, 'ascii')
  b.writeUInt32BE(0x200, 12)
  b.write('isomiso2', 16, 'ascii')
  return b.toString('base64')
})()

async function post(path: string, body: unknown) {
  const response = await fetch(`https://api.kourier.sh/v1${path}`, {
    method: 'POST',
    headers: {Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'User-Agent': 'curl/8.7.1'},
    body: JSON.stringify(body),
  })
  return {status: response.status, json: await response.json() as any}
}

const tokens = (r: any) => (r.usage?.prompt_tokens ?? r.usage?.input_tokens) as number | undefined

describe.skipIf(!key)('Kourier media schemas (live)', () => {
  test('images are read correctly (the control that proves the vision path works)', async () => {
    const red = solidPng(220, 30, 30).toString('base64')
    const {status, json} = await post('/chat/completions', {
      model, max_tokens: 400,
      messages: [
        {role: 'user', content: [{type: 'image_url', image_url: {url: `data:image/png;base64,${red}`}}]},
        {role: 'user', content: prompt},
      ],
    })
    expect(status).toBe(200)
    expect(String(json.choices?.[0]?.message?.content ?? '').toLowerCase()).toContain('red')
  })

  test('a video part is accepted but carries no media tokens', async () => {
    const {status: baseStatus, json: baseJson} = await post('/chat/completions', {
      model, max_tokens: 40, messages: [{role: 'user', content: prompt}],
    })
    expect(baseStatus).toBe(200)
    const baseline = tokens(baseJson)!

    const {status, json} = await post('/chat/completions', {
      model, max_tokens: 60,
      messages: [
        {role: 'user', content: [{type: 'video_url', video_url: {url: `data:video/mp4;base64,${MP4}`}}]},
        {role: 'user', content: prompt},
      ],
    })
    // 200, and the media was dropped: no extra prompt tokens over the text-only baseline.
    expect(status).toBe(200)
    expect(tokens(json)!).toBeLessThanOrEqual(baseline + 5)
  })

  test('the responses surface rejects a video part with 400', async () => {
    const {status} = await post('/responses', {
      model, max_output_tokens: 60,
      input: [
        {role: 'user', content: [{type: 'input_video', video_url: `data:video/mp4;base64,${MP4}`}]},
        {role: 'user', content: prompt},
      ],
    })
    expect(status).toBe(400)
  })
})
