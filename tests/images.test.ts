import { describe, expect, it } from 'vitest'
import { hitsItem, inFrame, itemBox, parseBoard, rotateAbout, scaleAbout, serializeBoard, transformItem, type ImageItem } from '../src/shared/whiteboard'
import { IMAGE_EMBED, imagesOf } from '../src/shared/vault'
import { deviceFit, DEVICES } from '../src/shared/browser'

const pic: ImageItem = { id: 'a', type: 'image', x: 0, y: 0, w: 200, h: 100, src: '.images/2026-10-18-ab12cd34.png' }

describe('pictures on a board', () => {
  it('survives the file and drops what is not a vault picture', () => {
    const text = serializeBoard({ v: 1, bg: parseBoard('').bg, items: [pic, { ...pic, id: 'b', src: '../secret.png' }, { ...pic, id: 'c', src: 'C:/x.png' }] })
    const b = parseBoard(text)
    expect(b.items).toEqual([pic])
  })
  it('scales from a corner and turns like a shape', () => {
    const big = transformItem(pic, scaleAbout(2, 0, 0))
    expect([big.x, big.y, big.w, big.h]).toEqual([0, 0, 400, 200])
    const turned = transformItem(pic, rotateAbout(90, 100, 50))
    expect(turned.rot).toBe(90)
    const b = itemBox(turned)
    expect([Math.round(b.x1 - b.x0), Math.round(b.y1 - b.y0)]).toEqual([100, 200])
  })
  it('is hit inside and caught by a frame', () => {
    expect(hitsItem(pic, 100, 50, 1)).toBe(true)
    expect(hitsItem(pic, 300, 50, 1)).toBe(false)
    expect(inFrame(pic, { x0: 150, y0: 80, x1: 400, y1: 400 })).toBe(true)
  })
})

describe('pictures of notes', () => {
  it('finds them in a note and in a board', () => {
    const note = 'a\n![[.images/2026-01-01-aaaa1111.png]]\nb ![[.audio/x.webm]]'
    expect(imagesOf(note)).toEqual(['.images/2026-01-01-aaaa1111.png'])
    expect(imagesOf(serializeBoard({ v: 1, bg: parseBoard('').bg, items: [pic] }))).toEqual([pic.src])
    expect(IMAGE_EMBED.test('![[.images/x.jpg]]')).toBe(true)
    expect(IMAGE_EMBED.test('![[.images/../x.jpg]]')).toBe(false)
  })
})

describe('device mode', () => {
  it('fits a phone into a pane, never bigger than it is', () => {
    const iphone = DEVICES.find((d) => d.name.startsWith('iPhone 12'))!
    const f = deviceFit(iphone, { x: 0, y: 0, w: 1000, h: 600 })
    expect(f.scale).toBeLessThan(1)
    expect(f.h).toBeLessThanOrEqual(600 - 32)
    expect(Math.abs(f.w / f.h - iphone.w / iphone.h)).toBeLessThan(0.01)
    expect(deviceFit(iphone, { x: 0, y: 0, w: 2000, h: 2000 }).scale).toBe(1)
  })
})
