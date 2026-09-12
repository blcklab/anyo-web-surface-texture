import test from 'node:test'
import assert from 'node:assert/strict'
import { createWebSurfaceAppRegistry } from '@blcklab/anyo/web-surface'
import { TextureWebSurfaceRuntime } from '../dist/index.js'

function events() {
  const listeners = new Map()
  return {
    on(name, handler) { const set = listeners.get(name) ?? new Set(); set.add(handler); listeners.set(name, set); return () => set.delete(handler) },
    emit(name, payload) { for (const handler of listeners.get(name) ?? []) handler(payload) },
  }
}

function primitive(id, room, policy = { mode: 'continuous', maxFps: 60 }) {
  return {
    id, kind: 'image', entityId: id, roomId: room.roomId, visible: true,
    transform: { position: [0, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    size: [2, 1, 0.02],
    webSurface: {
      source: { type: 'app', app: 'framebuffer', props: { id } },
      target: { type: 'plane', size: [2, 1] }, renderMode: 'auto',
      fallback: { type: 'snapshot', image: '/fallback.png' }, framePolicy: policy,
      animations: [], interaction: { pointer: true, keyboard: true, scroll: true },
    },
  }
}

function context(primitives, room, cameraPosition = [0, 1, 2]) {
  const lifecycle = events()
  const camera = { value: cameraPosition }
  const value = {
    world: {
      document: null, compiled: null, transforms: {}, query: {}, exploration: {}, xr: { state: 'idle' },
      on: lifecycle.on, emit: lifecycle.emit, runAction: async () => {}, selectPrimitive: async () => true,
    },
    renderer: {
      camera: { getPosition: () => camera.value }, whenIdle: async () => {}, setPrimitiveVisibility() {},
    },
    document: {}, transforms: {}, query: {},
    compiled: { primitives, primitiveById: new Map(primitives.map(item => [item.id, item])), roomById: new Map([[room.roomId, room]]), entityById: new Map() },
  }
  return { value, camera, setPrimitives(next) { value.compiled.primitives = next; value.compiled.primitiveById = new Map(next.map(item => [item.id, item])) } }
}

function canvas(width, height) {
  const context2d = { setTransform() {}, clearRect() {}, drawImage() {} }
  return { width, height, getContext: kind => kind === '2d' ? context2d : null }
}

function bridge(log) {
  return {
    backend: 'webgl2', identity: {},
    createDynamicTexture(options) {
      log.creates += 1
      const resource = {
        texture: {}, width: options.source.width, height: options.source.height, version: 0, disposed: false,
        update() { log.updates += 1 },
        resize(width, height) { resource.width = width; resource.height = height; log.resizes.push([width, height]) },
        dispose() { if (!resource.disposed) { resource.disposed = true; log.disposals += 1 } },
      }
      return resource
    },
    bindTarget() {
      const binding = {
        kind: 'plane', texture: {}, presented: false,
        setPresented(value) { binding.presented = value; log.presented.push(value) },
        hitTest() { return null }, update() {}, dispose() { log.bindingDisposals += 1 },
      }
      log.bindings.push(binding)
      return { ok: true, binding }
    },
    dispose() { log.bridgeDisposals += 1 },
  }
}

function registry(log) {
  const value = createWebSurfaceAppRegistry()
  value.register('framebuffer', {
    mount() { return { dispose() {} } }, texture: { width: 160, height: 144 },
    createTextureSurface(_canvas, props) {
      return {
        render() { log.renders.push(props.id) }, pause() { log.pauses += 1 }, resume() { log.resumes += 1 },
        setPerformanceState(state) { log.performance.push(state) }, dispose() { log.appDisposals += 1 },
      }
    },
  })
  return value
}

async function settle() { await new Promise(resolve => setImmediate(resolve)) }
function log() { return { creates: 0, updates: 0, resizes: [], disposals: 0, presented: [], bindings: [], bindingDisposals: 0, bridgeDisposals: 0, renders: [], pauses: 0, resumes: 0, performance: [], appDisposals: 0 } }

test('distance scaling suspends app work while preserving the last native frame', async () => {
  const room = { id: 'room:a', roomId: 'a', visible: true }
  const screen = primitive('screen', room)
  const scene = context([screen], room)
  const calls = log()
  let time = 0
  const runtime = new TextureWebSurfaceRuntime({
    registry: registry(calls), createBridge: () => bridge(calls), canvasFactory: canvas, now: () => time,
    performance: {
      minResolutionScale: 0.25,
      distanceTiers: [
        { maxDistance: 3, resolutionScale: 1, fpsScale: 1 },
        { maxDistance: 10, resolutionScale: 0.5, fpsScale: 0.5 },
        { maxDistance: Infinity, resolutionScale: 0.25, fpsScale: 0.1, suspend: true },
      ],
    },
  })
  await runtime.setup(scene.value)
  assert.equal(runtime.stats.active, 1)
  assert.equal(calls.bindings[0].presented, true)

  scene.camera.value = [0, 1, 6]
  time = 100
  runtime.update(0.1, scene.value)
  await settle()
  assert.deepEqual(calls.resizes.at(-1), [80, 72])
  assert.equal(calls.performance.at(-1).resolutionScale, 0.5)

  scene.camera.value = [0, 1, 20]
  time = 200
  runtime.update(0.1, scene.value)
  await settle()
  assert.equal(runtime.stats.active, 0)
  assert.equal(runtime.stats.visible, 1)
  assert.equal(runtime.stats.suspended, 1)
  assert.equal(calls.bindings[0].presented, true, 'last frame remains visible while app work is suspended')
  assert.ok(calls.performance.at(-1).reasons.includes('distance'))

  scene.camera.value = [0, 1, 2]
  time = 300
  runtime.update(0.1, scene.value)
  await settle()
  assert.equal(runtime.stats.active, 1)
  assert.equal(calls.performance.at(-1).suspended, false)
  runtime.dispose()
})

test('custom occlusion and host thermal policy suspend and resume the same scoped lifecycle', async () => {
  const room = { id: 'room:a', roomId: 'a', visible: true }
  const screen = primitive('screen', room)
  const scene = context([screen], room)
  const calls = log()
  let occluded = false
  let thermal = 'nominal'
  let time = 0
  const runtime = new TextureWebSurfaceRuntime({
    registry: registry(calls), createBridge: () => bridge(calls), canvasFactory: canvas, now: () => time,
    performance: {
      occlusion: { mode: 'custom', intervalMs: 1, test: () => occluded },
      thermal: { intervalMs: 1, getState: () => thermal },
    },
  })
  await runtime.setup(scene.value)
  occluded = true
  time = 2
  runtime.update(0.016, scene.value)
  assert.equal(runtime.stats.suspended, 1)
  assert.equal(calls.performance.at(-1).occluded, true)
  occluded = false
  thermal = 'critical'
  time = 4
  runtime.update(0.016, scene.value)
  assert.equal(calls.performance.at(-1).thermalState, 'critical')
  assert.ok(calls.performance.at(-1).reasons.includes('thermal'))
  thermal = 'nominal'
  time = 6
  runtime.update(0.016, scene.value)
  assert.equal(runtime.stats.active, 1)
  assert.equal(calls.bindings[0].presented, true)
  runtime.dispose()
})

test('memory budgets scale textures and the bounded pool reuses exact resources across replacement', async () => {
  const room = { id: 'room:a', roomId: 'a', visible: true }
  const first = primitive('screen-a', room, { mode: 'on-change', maxFps: 30 })
  const scene = context([first], room)
  const calls = log()
  const runtime = new TextureWebSurfaceRuntime({
    registry: registry(calls), createBridge: () => bridge(calls), canvasFactory: canvas,
    performance: { maxTextureBytesPerSurface: 40_000, maxTextureBytes: 80_000, pool: { maxEntries: 2, maxBytes: 80_000 } },
  })
  await runtime.setup(scene.value)
  assert.ok(runtime.stats.textureBytes <= 40_000)
  assert.equal(calls.creates, 1)

  scene.setPrimitives([])
  await runtime.applyChanges([], scene.value)
  assert.equal(runtime.stats.pooledTextures, 1)
  assert.equal(calls.disposals, 0)

  for (let index = 0; index < 50; index += 1) {
    const next = primitive(`screen-${index}`, room, { mode: 'on-change', maxFps: 30 })
    scene.setPrimitives([next])
    await runtime.applyChanges([], scene.value)
    assert.equal(runtime.stats.pooledTextures, 0)
    scene.setPrimitives([])
    await runtime.applyChanges([], scene.value)
    assert.equal(runtime.stats.pooledTextures, 1)
    assert.ok(runtime.stats.pooledTextureBytes <= 40_000)
  }
  assert.equal(calls.creates, 1, 'exact pooled dynamic texture is reused across repeated world replacement')
  runtime.maintenance.trimPool()
  runtime.dispose()
  assert.equal(calls.disposals, 1)
})

test('surface, diagnostic, and recovery controls remain bounded', async () => {
  const room = { id: 'room:a', roomId: 'a', visible: true }
  const screens = ['a', 'b', 'c'].map(id => primitive(`screen-${id}`, room, { mode: 'on-change', maxFps: 30 }))
  const scene = context(screens, room)
  const calls = log()
  const diagnostics = []
  let bridges = 0
  const runtime = new TextureWebSurfaceRuntime({
    registry: registry(calls), createBridge: () => { bridges += 1; return bridge(calls) }, canvasFactory: canvas,
    diagnostics: value => diagnostics.push(value),
    performance: { maxSurfaces: 1, maxDiagnosticHistory: 2, pool: false },
  })
  await runtime.setup(scene.value)
  assert.equal(runtime.stats.mounted, 1)
  assert.equal(runtime.stats.diagnosticHistory, 2)
  assert.equal(diagnostics.filter(item => item.code === 'ANYO_TEXTURE_SURFACE_LIMIT_REACHED').length, 2)
  const disposalsBeforeRecovery = calls.disposals
  await runtime.maintenance.recover()
  assert.equal(bridges, 2)
  assert.equal(calls.disposals, disposalsBeforeRecovery + 1, 'recovery disposes stale GPU resources instead of pooling them')
  assert.equal(runtime.stats.mounted, 1)
  assert.equal(runtime.stats.diagnosticHistory, 2)
  runtime.dispose()
})
