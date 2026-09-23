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

import {
  TEXTURE_SURFACE_QUALITY_PRESETS,
  resolveTextureSurfaceQuality,
  textureSurfaceRegistrationForQuality,
} from '../dist/index.js'

test('S24 exposes bounded 360p through optional 4K physical tiers', () => {
  assert.deepEqual(TEXTURE_SURFACE_QUALITY_PRESETS, {
    low: { width: 640, height: 360 },
    balanced: { width: 960, height: 540 },
    hd: { width: 1280, height: 720 },
    'full-hd': { width: 1920, height: 1080 },
    qhd: { width: 2560, height: 1440 },
    ultra: { width: 3840, height: 2160 },
  })
  assert.deepEqual(textureSurfaceRegistrationForQuality('full-hd').width, 1920)
  assert.deepEqual(textureSurfaceRegistrationForQuality('full-hd').height, 1080)
})

test('DPR changes logical viewport without multiplying Full-HD into accidental 4K', () => {
  const resolved = resolveTextureSurfaceQuality({ mode: 'full-hd', devicePixelRatio: 'auto', maxDevicePixelRatio: 2 }, 2)
  assert.equal(resolved.width, 1920)
  assert.equal(resolved.height, 1080)
  assert.equal(resolved.logicalWidth, 960)
  assert.equal(resolved.logicalHeight, 540)
  assert.equal(resolved.deviceScale, 2)
})


test('optional QHD and Ultra tiers keep the high-quality sRGB sampling contract', () => {
  assert.deepEqual(textureSurfaceRegistrationForQuality('qhd'), {
    width: 2560, height: 1440, label: 'anyo-web-surface:qhd', flipY: true, colorSpace: 'srgb',
    minFilter: 'linear-mipmap-linear', magFilter: 'linear', mipmaps: 'generate', priority: 110,
  })
  assert.deepEqual(textureSurfaceRegistrationForQuality('ultra'), {
    width: 3840, height: 2160, label: 'anyo-web-surface:ultra', flipY: true, colorSpace: 'srgb',
    minFilter: 'linear-mipmap-linear', magFilter: 'linear', mipmaps: 'generate', priority: 120,
  })
})
