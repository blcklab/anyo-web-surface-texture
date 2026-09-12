import test from 'node:test'
import assert from 'node:assert/strict'
import { createTextureSurfacePresentation } from '../dist/presentation.js'

function canvas(width, height, log = []) {
  return {
    width, height,
    getContext(kind) {
      if (kind !== '2d') return null
      return {
        setTransform(...args) { log.push(['transform', ...args]) },
        clearRect(...args) { log.push(['clear', ...args]) },
        drawImage(source, ...args) { log.push(['draw', source.width, source.height, ...args]) },
      }
    },
  }
}

test('cover mapping crops the logical framebuffer without leaking out-of-range input', () => {
  const source = canvas(100, 100)
  const state = createTextureSurfacePresentation(source, { type: 'texture', resolution: [200, 100], fit: 'cover' }, canvas)
  assert.deepEqual(state.mapUv([0.5, 0.5]), [0.5, 0.5])
  const top = state.mapUv([0.5, 1])
  const bottom = state.mapUv([0.5, 0])
  assert.ok(Math.abs(top[1] - 0.75) < 1e-9)
  assert.ok(Math.abs(bottom[1] - 0.25) < 1e-9)
})

test('offset, scale, and rotation share one invertible visual/input transform', () => {
  const log = []
  const source = canvas(100, 100)
  const state = createTextureSurfacePresentation(source, {
    type: 'texture', resolution: [100, 100], fit: 'stretch',
    transform: { offset: [0.1, -0.2], scale: [1.2, 0.8], rotation: 30 },
  }, (width, height) => canvas(width, height, log))
  state.prepare()
  assert.equal(log.some(call => call[0] === 'draw'), true)
  const mapped = state.mapUv([0.6, 0.7])
  assert.ok(mapped)
  assert.ok(Math.abs(mapped[0] - 0.5) < 1e-9)
  assert.ok(Math.abs(mapped[1] - 0.5) < 1e-9)
})
