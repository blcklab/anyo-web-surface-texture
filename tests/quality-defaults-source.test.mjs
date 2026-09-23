import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../src/plugin.ts', import.meta.url), 'utf8')

test('physical Web Surface defaults use sRGB trilinear mipmapped sampling', () => {
  assert.match(source, /colorSpace: 'srgb' as const/)
  assert.match(source, /minFilter: 'linear-mipmap-linear' as const/)
  assert.match(source, /magFilter: 'linear' as const/)
  assert.match(source, /mipmaps: 'generate' as const/)
})
