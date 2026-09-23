import test from 'node:test'
import assert from 'node:assert/strict'
import { createWebSurfaceAppRegistry } from '@blcklab/anyo/web-surface'
import { TextureWebSurfaceRuntime } from '../dist/index.js'

function target() {
  const listeners = new Map()
  return {
    listeners,
    addEventListener(name, listener, options) { listeners.set(name, { listener, options }) },
    removeEventListener(name) { listeners.delete(name) },
  }
}

test('focused scroll surface owns wheel before renderer-canvas camera listeners', async () => {
  const documentTarget = target()
  const canvasTarget = target()
  const canvas = Object.assign(canvasTarget, {
    ownerDocument: documentTarget,
    focus() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 640, height: 360, right: 640, bottom: 360 } },
  })
  const room = { id: 'room:a', roomId: 'a', visible: true }
  const primitive = {
    id: 'entity:screen', kind: 'image', entityId: 'screen', roomId: 'a', visible: true,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, size: [2, 1, 0.02],
    webSurface: {
      source: { type: 'app', app: 'framebuffer', props: {} }, target: { type: 'plane', size: [2, 1] },
      renderMode: 'auto', fallback: { type: 'snapshot', image: '/fallback.png' },
      framePolicy: { mode: 'on-change' }, animations: [],
      interaction: { pointer: true, keyboard: false, scroll: true },
    },
  }
  const events = new Map()
  const context = {
    world: {
      document: null, compiled: null, transforms: {}, query: {}, exploration: {}, xr: { state: 'idle' },
      on(name, handler) { const set = events.get(name) ?? new Set(); set.add(handler); events.set(name, set); return () => set.delete(handler) },
      emit(name, payload) { for (const handler of events.get(name) ?? []) handler(payload) },
      runAction: async () => {}, selectPrimitive: async () => true,
    },
    renderer: { canvas, whenIdle: async () => {}, setPrimitiveVisibility() {} },
    document: {},
    compiled: {
      primitives: [primitive], primitiveById: new Map([[primitive.id, primitive]]),
      roomById: new Map([['a', room]]), entityById: new Map(),
    },
    transforms: {}, query: {},
  }
  const received = []
  const registry = createWebSurfaceAppRegistry()
  registry.register('framebuffer', {
    mount() { return { dispose() {} } }, texture: { width: 320, height: 180 },
    createTextureSurface() { return { render() {}, handleInput(event) { received.push(event); return true }, dispose() {} } },
  })
  const bridge = {
    backend: 'webgl2', identity: {},
    createDynamicTexture() { return { texture: {}, update() {}, resize() {}, dispose() {} } },
    bindTarget() { return { ok: true, binding: {
      kind: 'plane', texture: {}, presented: false,
      setPresented(value) { this.presented = value },
      hitTest() { return this.presented ? { uv: [0.5, 0.5], point: [0, 0, 0], normal: [0, 0, 1], distance: 1, frontFacing: true } : null },
      dispose() {},
    } } },
    dispose() {},
  }
  const runtime = new TextureWebSurfaceRuntime({ registry, createBridge: () => bridge, canvasFactory: (width, height) => ({ width, height }) })
  await runtime.setup(context)

  const installed = documentTarget.listeners.get('wheel')
  assert.ok(installed, 'wheel interception is installed above the renderer canvas')
  assert.deepEqual(installed.options, { capture: true, passive: false })
  assert.equal(runtime.input.focus(primitive.id, { reason: 'pointer' }), true, 'scroll-only intent is focus capable')

  const calls = { prevent: 0, stop: 0, immediate: 0 }
  installed.listener({
    target: canvas, clientX: 320, clientY: 180, deltaX: 1, deltaY: 12, deltaZ: 0, timeStamp: 7,
    preventDefault() { calls.prevent++ }, stopPropagation() { calls.stop++ }, stopImmediatePropagation() { calls.immediate++ },
  })
  assert.equal(received.at(-1)?.phase, 'wheel')
  assert.deepEqual(received.at(-1)?.delta, [1, 12, 0])
  assert.deepEqual(calls, { prevent: 1, stop: 1, immediate: 1 })

  runtime.input.blur(primitive.id)
  installed.listener({
    target: canvas, clientX: 320, clientY: 180, deltaX: 0, deltaY: 12, deltaZ: 0, timeStamp: 8,
    preventDefault() { calls.prevent++ }, stopPropagation() { calls.stop++ }, stopImmediatePropagation() { calls.immediate++ },
  })
  assert.equal(received.length, 1, 'unfocused hover leaves wheel available to the host camera')
  assert.deepEqual(calls, { prevent: 1, stop: 1, immediate: 1 })
  runtime.dispose()
})
