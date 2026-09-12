import test from 'node:test'
import assert from 'node:assert/strict'
import {
  HD_UI_TEXTURE_SURFACE_OPTIONS,
  MOBILE_UI_TEXTURE_SURFACE_OPTIONS,
} from '../dist/index.js'

test('HD UI preset keeps text-heavy surfaces crisp at oblique viewing angles', () => {
  assert.deepEqual(HD_UI_TEXTURE_SURFACE_OPTIONS, {
    width: 1920,
    height: 1080,
    label: 'anyo-web-surface:hd-ui',
    flipY: true,
    colorSpace: 'srgb',
    minFilter: 'linear-mipmap-linear',
    magFilter: 'linear',
    mipmaps: 'generate',
    priority: 100,
  })
  assert.equal(Object.isFrozen(HD_UI_TEXTURE_SURFACE_OPTIONS), true)
})

test('mobile UI preset preserves the same sampling contract at a smaller texture budget', () => {
  assert.deepEqual(MOBILE_UI_TEXTURE_SURFACE_OPTIONS, {
    width: 1280,
    height: 720,
    label: 'anyo-web-surface:mobile-ui',
    flipY: true,
    colorSpace: 'srgb',
    minFilter: 'linear-mipmap-linear',
    magFilter: 'linear',
    mipmaps: 'generate',
    priority: 80,
  })
  assert.equal(Object.isFrozen(MOBILE_UI_TEXTURE_SURFACE_OPTIONS), true)
})
