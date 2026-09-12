import test from 'node:test'
import assert from 'node:assert/strict'
import { createWebSurfaceAppRegistry } from '@blcklab/anyo/web-surface'
import { TextureWebSurfaceRuntime } from '../dist/index.js'

function createEvents() {
  const listeners = new Map()
  return {
    on(name, handler) {
      const set = listeners.get(name) ?? new Set()
      set.add(handler); listeners.set(name, set)
      return () => set.delete(handler)
    },
    emit(name, payload) { for (const handler of listeners.get(name) ?? []) handler(payload) },
  }
}

function makePrimitive(id, room, policy = { mode: 'on-change', maxFps: 30 }) {
  return {
    id,
    kind: 'image',
    entityId: id.replace('entity:', ''),
    transform: { position: [0, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    size: [2, 1, 0.02],
    roomId: room.roomId,
    visible: true,
    webSurface: {
      source: { type: 'app', app: 'framebuffer', props: { id } },
      target: { type: 'plane', size: [2, 1] },
      renderMode: 'auto',
      fallback: { type: 'snapshot', image: '/fallback.png' },
      framePolicy: policy,
      animations: [],
      interaction: { pointer: false, keyboard: false, scroll: false },
    },
  }
}

function makeContext(primitives, room, events) {
  const primitiveById = new Map(primitives.map(value => [value.id, value]))
  return {
    world: {
      document: null,
      compiled: null,
      transforms: {}, query: {}, exploration: {}, xr: { state: 'idle' },
      on: events.on,
      emit: events.emit,
      runAction: async () => {},
      selectPrimitive: async () => true,
    },
    renderer: { whenIdle: async () => {}, setPrimitiveVisibility() {} },
    document: {},
    compiled: {
      primitives,
      primitiveById,
      roomById: new Map([[room.roomId, room]]),
      entityById: new Map(),
    },
    transforms: {}, query: {},
  }
}

function makeBridge(log) {
  return {
    backend: 'webgl2', identity: {},
    createDynamicTexture() {
      return {
        texture: {}, width: 160, height: 144, version: 0, disposed: false,
        update() { log.updates++ },
        resize() {},
        dispose() { log.textureDisposals++ },
      }
    },
    bindTarget({ resolution }) {
      const binding = {
        kind: resolution.kind,
        texture: {}, presented: false,
        setPresented(value) { this.presented = value; log.presented.push(value) },
        dispose() { log.bindingDisposals++ },
      }
      return { ok: true, binding }
    },
    dispose() { log.bridgeDisposals++ },
  }
}

async function settle() { await new Promise(resolve => setImmediate(resolve)) }

test('on-change texture surfaces render, pause with room visibility, resume once, and dispose once', async () => {
  const room = { id: 'room:a', roomId: 'a', visible: true }
  const primitive = makePrimitive('entity:screen', room)
  const events = createEvents()
  const context = makeContext([primitive], room, events)
  const registry = createWebSurfaceAppRegistry()
  const log = { renders: 0, pauses: 0, resumes: 0, actives: [], updates: 0, presented: [], disposals: 0, textureDisposals: 0, bindingDisposals: 0, bridgeDisposals: 0 }
  let invalidate
  registry.register('framebuffer', {
    mount() { return { dispose() {} } },
    texture: { width: 160, height: 144 },
    createTextureSurface(_canvas, _props, appContext) {
      invalidate = appContext.invalidate
      return {
        render() { log.renders++ },
        setActive(value) { log.actives.push(value) },
        pause() { log.pauses++ },
        resume() { log.resumes++ },
        dispose() { log.disposals++ },
      }
    },
  })
  let time = 0
  const bridge = makeBridge(log)
  const runtime = new TextureWebSurfaceRuntime({
    registry,
    createBridge: () => bridge,
    canvasFactory: (width, height) => ({ width, height }),
    now: () => time,
  })

  await runtime.setup(context)
  assert.equal(log.renders, 1)
  assert.equal(log.updates, 1)
  assert.deepEqual(log.actives, [true])
  assert.equal(log.resumes, 1)
  runtime.update(1 / 60, context)
  await settle()
  assert.equal(log.renders, 1, 'clean on-change surfaces do not upload')

  invalidate()
  time = 16
  runtime.update(1 / 60, context)
  await settle()
  assert.equal(log.renders, 2)
  assert.equal(log.updates, 2)

  room.visible = false
  runtime.update(1 / 60, context)
  assert.equal(log.pauses, 1)
  assert.equal(log.presented.at(-1), false)
  runtime.update(1 / 60, context)
  assert.equal(log.pauses, 1, 'pause is idempotent')

  room.visible = true
  time = 32
  runtime.update(1 / 60, context)
  await settle()
  assert.equal(log.resumes, 2)
  assert.equal(log.renders, 3)
  events.emit('world:pause')
  assert.equal(log.pauses, 2)
  events.emit('world:start')
  assert.equal(log.resumes, 3)

  runtime.dispose()
  runtime.dispose()
  await settle()
  assert.equal(log.disposals, 1)
  assert.equal(log.textureDisposals, 1)
  assert.equal(log.bindingDisposals, 1)
  assert.equal(log.bridgeDisposals, 1)
})

test('one coordinated scheduler bounds continuous uploads per update', async () => {
  const room = { id: 'room:a', roomId: 'a', visible: true }
  const primitives = [0, 1, 2].map(index => makePrimitive(`entity:screen-${index}`, room, { mode: 'continuous', maxFps: 60 }))
  const events = createEvents()
  const context = makeContext(primitives, room, events)
  const registry = createWebSurfaceAppRegistry()
  const log = { renders: 0, updates: 0, presented: [], textureDisposals: 0, bindingDisposals: 0, bridgeDisposals: 0 }
  registry.register('framebuffer', {
    mount() { return { dispose() {} } },
    texture: { width: 160, height: 144 },
    createTextureSurface() { return { render() { log.renders++ }, dispose() {} } },
  })
  let time = 0
  const runtime = new TextureWebSurfaceRuntime({
    registry,
    createBridge: () => makeBridge(log),
    canvasFactory: (width, height) => ({ width, height }),
    maxUploadsPerFrame: 1,
    now: () => time,
  })
  await runtime.setup(context)
  assert.equal(log.renders, 1, 'initial uploads obey the same coordinated frame budget')
  time = 100
  runtime.update(0.1, context)
  await settle()
  assert.equal(log.renders, 2, 'only one continuous upload starts under the frame budget')
  assert.ok(runtime.stats.skippedByBudget >= 4)
  runtime.dispose()
})

test('continuous scheduler rotates fairly instead of starving later surfaces', async () => {
  const room = { id: 'room:a', roomId: 'a', visible: true }
  const primitives = [0, 1, 2].map(index => makePrimitive(`entity:screen-${index}`, room, { mode: 'continuous', maxFps: 60 }))
  const events = createEvents()
  const context = makeContext(primitives, room, events)
  const registry = createWebSurfaceAppRegistry()
  const rendered = []
  const log = { updates: 0, presented: [], textureDisposals: 0, bindingDisposals: 0, bridgeDisposals: 0 }
  registry.register('framebuffer', {
    mount() { return { dispose() {} } },
    texture: { width: 160, height: 144 },
    createTextureSurface() {
      return { render(props) { rendered.push(props.id) }, dispose() {} }
    },
  })
  let time = 0
  const runtime = new TextureWebSurfaceRuntime({
    registry,
    createBridge: () => makeBridge(log),
    canvasFactory: (width, height) => ({ width, height }),
    maxUploadsPerFrame: 1,
    now: () => time,
  })
  await runtime.setup(context)
  rendered.length = 0
  for (const next of [100, 200, 300]) {
    time = next
    runtime.update(0.1, context)
    await settle()
  }
  assert.deepEqual(rendered, ['entity:screen-0', 'entity:screen-1', 'entity:screen-2'])
  runtime.dispose()
})

test('fixed-rate surfaces honor both their policy and the global FPS ceiling', async () => {
  const room = { id: 'room:a', roomId: 'a', visible: true }
  const primitive = makePrimitive('entity:screen', room, { mode: 'fixed-rate', maxFps: 120 })
  const events = createEvents()
  const context = makeContext([primitive], room, events)
  const registry = createWebSurfaceAppRegistry()
  const log = { renders: 0, updates: 0, presented: [], textureDisposals: 0, bindingDisposals: 0, bridgeDisposals: 0 }
  registry.register('framebuffer', {
    mount() { return { dispose() {} } },
    createTextureSurface() { return { render() { log.renders++ }, dispose() {} } },
  })
  let time = 0
  const runtime = new TextureWebSurfaceRuntime({
    registry,
    createBridge: () => makeBridge(log),
    canvasFactory: (width, height) => ({ width, height }),
    maxFps: 30,
    now: () => time,
  })
  await runtime.setup(context)
  time = 20
  runtime.update(0.02, context)
  await settle()
  assert.equal(log.renders, 1)
  time = 34
  runtime.update(0.014, context)
  await settle()
  assert.equal(log.renders, 2)
  runtime.dispose()
})

test('mount and dynamic-resource failures degrade to diagnostics without rejecting world setup', async () => {
  const room = { id: 'room:a', roomId: 'a', visible: true }
  const primitive = makePrimitive('entity:screen', room)
  const events = createEvents()
  const context = makeContext([primitive], room, events)
  const diagnostics = []
  const registry = createWebSurfaceAppRegistry()
  let disposed = 0
  registry.register('framebuffer', {
    mount() { return { dispose() {} } },
    createTextureSurface() { throw new Error('emulator boot failed') },
  })
  const runtime = new TextureWebSurfaceRuntime({
    registry,
    createBridge: () => ({
      backend: 'webgl2', identity: {},
      createDynamicTexture() { throw new Error('should not run') },
      bindTarget() { throw new Error('should not run') },
      dispose() { disposed++ },
    }),
    canvasFactory: (width, height) => ({ width, height }),
    diagnostics: value => diagnostics.push(value),
  })
  await runtime.setup(context)
  assert.equal(runtime.stats.mounted, 0)
  assert.equal(diagnostics[0].code, 'ANYO_TEXTURE_APP_MOUNT_FAILED')
  runtime.dispose()
  assert.equal(disposed, 1)

  const registry2 = createWebSurfaceAppRegistry()
  registry2.register('framebuffer', {
    mount() { return { dispose() {} } },
    createTextureSurface() { return { dispose() { disposed++ } } },
  })
  const diagnostics2 = []
  const runtime2 = new TextureWebSurfaceRuntime({
    registry: registry2,
    createBridge: () => ({
      backend: 'webgpu', identity: {},
      createDynamicTexture() { throw new Error('device unavailable') },
      bindTarget() { throw new Error('should not run') },
      dispose() {},
    }),
    canvasFactory: (width, height) => ({ width, height }),
    diagnostics: value => diagnostics2.push(value),
  })
  await runtime2.setup(context)
  assert.equal(runtime2.stats.mounted, 0)
  assert.equal(diagnostics2[0].code, 'ANYO_TEXTURE_RESOURCE_CREATE_FAILED')
  assert.equal(disposed, 2, 'partially mounted app is disposed when GPU creation fails')
  runtime2.dispose()
})

test('render failure restores fallback and explicit invalidation permits recovery', async () => {
  const room = { id: 'room:a', roomId: 'a', visible: true }
  const primitive = makePrimitive('entity:screen', room)
  const events = createEvents()
  const context = makeContext([primitive], room, events)
  const diagnostics = []
  const registry = createWebSurfaceAppRegistry()
  const log = { updates: 0, presented: [], textureDisposals: 0, bindingDisposals: 0, bridgeDisposals: 0 }
  let invalidate
  let attempts = 0
  registry.register('framebuffer', {
    mount() { return { dispose() {} } },
    createTextureSurface(_canvas, _props, appContext) {
      invalidate = appContext.invalidate
      return {
        render() {
          attempts++
          if (attempts === 1) throw new Error('framebuffer read failed')
        },
        dispose() {},
      }
    },
  })
  const runtime = new TextureWebSurfaceRuntime({
    registry,
    createBridge: () => makeBridge(log),
    canvasFactory: (width, height) => ({ width, height }),
    diagnostics: value => diagnostics.push(value),
  })
  await runtime.setup(context)
  assert.equal(runtime.stats.active, 0)
  assert.equal(log.presented.at(-1), false)
  assert.equal(diagnostics[0].code, 'ANYO_TEXTURE_RENDER_FAILED')
  runtime.update(1 / 60, context)
  await settle()
  assert.equal(attempts, 1, 'failed surface remains suspended')

  invalidate()
  runtime.update(1 / 60, context)
  await settle()
  assert.equal(attempts, 2)
  assert.equal(runtime.stats.active, 1)
  assert.equal(log.presented.at(-1), true)
  runtime.dispose()
})

test('app resize receives the configured logical texture resolution', async () => {
  const room = { id: 'room:a', roomId: 'a', visible: true }
  const primitive = makePrimitive('entity:screen', room)
  const events = createEvents()
  const context = makeContext([primitive], room, events)
  const registry = createWebSurfaceAppRegistry()
  const sizes = []
  const log = { updates: 0, presented: [], textureDisposals: 0, bindingDisposals: 0, bridgeDisposals: 0 }
  registry.register('framebuffer', {
    mount() { return { dispose() {} } },
    texture: { width: 160, height: 144 },
    createTextureSurface() {
      return { resize(width, height) { sizes.push([width, height]) }, dispose() {} }
    },
  })
  const runtime = new TextureWebSurfaceRuntime({
    registry,
    createBridge: () => makeBridge(log),
    canvasFactory: (width, height) => ({ width, height }),
  })
  await runtime.setup(context)
  assert.deepEqual(sizes, [[160, 144]])
  runtime.dispose()
})

test('XR ray input maps UV to pixels, owns focus/capture, and suppresses hidden surfaces', async () => {
  const room = { id: 'room:a', roomId: 'a', visible: true }
  const primitive = makePrimitive('entity:screen', room)
  primitive.webSurface.interaction = { pointer: true, keyboard: true, scroll: true }
  const events = createEvents()
  const context = makeContext([primitive], room, events)
  const registry = createWebSurfaceAppRegistry()
  const received = []
  const focus = []
  registry.register('framebuffer', {
    mount() { return { dispose() {} } },
    texture: { width: 160, height: 144 },
    createTextureSurface() {
      return {
        render() {},
        handleInput(event) { received.push(event); return true },
        setInputFocus(value, reason) { focus.push([value, reason]) },
        dispose() {},
      }
    },
  })
  const log = { updates: 0, presented: [], textureDisposals: 0, bindingDisposals: 0, bridgeDisposals: 0 }
  const bridge = makeBridge(log)
  bridge.bindTarget = () => {
    const binding = {
      kind: 'plane', texture: {}, presented: false,
      setPresented(value) { this.presented = value },
      hitTest() {
        return this.presented ? { uv: [0.25, 0.75], point: [1, 2, 3], normal: [0, 0, 1], distance: 2, frontFacing: true } : null
      },
      dispose() {},
    }
    return { ok: true, binding }
  }
  const runtime = new TextureWebSurfaceRuntime({
    registry, createBridge: () => bridge,
    canvasFactory: (width, height) => ({ width, height }),
  })
  await runtime.setup(context)
  assert.equal(runtime.input.dispatchRay({ phase: 'down', origin: [0, 0, 2], direction: [0, 0, -1], pointerId: 7 }), true)
  assert.equal(runtime.input.focusedPrimitiveId, primitive.id)
  runtime.input.dispatchRay({ phase: 'up', origin: [0, 0, 2], direction: [0, 0, -1], pointerId: 7 })
  assert.deepEqual(received.map(event => event.phase), ['down', 'up', 'click'])
  assert.deepEqual(received[0].pixel, [40, 36])
  assert.deepEqual(focus, [[true, 'xr']])

  room.visible = false
  runtime.update(1 / 60, context)
  assert.equal(runtime.input.focusedPrimitiveId, null)
  assert.equal(runtime.input.dispatchRay({ phase: 'select', origin: [0, 0, 2], direction: [0, 0, -1] }), false)
  assert.deepEqual(focus.at(-1), [false, 'programmatic'])
  runtime.dispose()
})

test('XR gaze select uses one isolated nearest surface', async () => {
  const room = { id: 'room:a', roomId: 'a', visible: true }
  const primitives = [makePrimitive('entity:near', room), makePrimitive('entity:far', room)]
  for (const primitive of primitives) primitive.webSurface.interaction = { pointer: true, keyboard: true, scroll: false }
  const context = makeContext(primitives, room, createEvents())
  const registry = createWebSurfaceAppRegistry()
  const clicked = []
  registry.register('framebuffer', {
    mount() { return { dispose() {} } },
    createTextureSurface() { return { render() {}, handleInput(event) { if (event.phase === 'click') clicked.push(event.primitiveId); return true }, dispose() {} } },
  })
  const bridge = {
    backend: 'webgl2', identity: {},
    createDynamicTexture() { return { texture: {}, update() {}, resize() {}, dispose() {} } },
    bindTarget({ primitive }) {
      return { ok: true, binding: {
        kind: 'plane', texture: {}, presented: false,
        setPresented(value) { this.presented = value },
        hitTest() { return this.presented ? { uv: [0.5, 0.5], point: [0, 0, 0], normal: [0, 0, 1], distance: primitive.id.includes('near') ? 1 : 3, frontFacing: true } : null },
        dispose() {},
      } }
    },
    dispose() {},
  }
  const runtime = new TextureWebSurfaceRuntime({ registry, createBridge: () => bridge, canvasFactory: (width, height) => ({ width, height }) })
  await runtime.setup(context)
  assert.equal(runtime.input.dispatchRay({ phase: 'select', pointerType: 'gaze', origin: [0, 0, 2], direction: [0, 0, -1] }), true)
  assert.deepEqual(clicked, ['entity:near'])
  runtime.dispose()
})

test('keyboard input is scoped to the focused surface and synthesizes release on blur', async () => {
  const room = { id: 'room:a', roomId: 'a', visible: true }
  const primitive = makePrimitive('entity:screen', room)
  primitive.webSurface.interaction = { pointer: false, keyboard: true, scroll: false }
  const events = createEvents()
  const context = makeContext([primitive], room, events)
  const keyboardTarget = new EventTarget()
  keyboardTarget.focus = () => {}
  context.renderer.canvas = keyboardTarget
  const registry = createWebSurfaceAppRegistry()
  const received = []
  const focus = []
  registry.register('framebuffer', {
    mount() { return { dispose() {} } },
    createTextureSurface() {
      return {
        render() {},
        handleInput(event) { received.push(event); return true },
        setInputFocus(value, reason) { focus.push([value, reason]) },
        dispose() {},
      }
    },
  })
  const log = { updates: 0, presented: [], textureDisposals: 0, bindingDisposals: 0, bridgeDisposals: 0 }
  const runtime = new TextureWebSurfaceRuntime({
    registry,
    createBridge: () => makeBridge(log),
    canvasFactory: (width, height) => ({ width, height }),
    input: { pointer: false, keyboardTarget },
  })
  await runtime.setup(context)
  assert.equal(runtime.input.focus(primitive.id, { reason: 'keyboard' }), true)
  const keyDown = new Event('keydown', { cancelable: true })
  Object.defineProperties(keyDown, {
    key: { value: 'a' }, code: { value: 'KeyA' }, repeat: { value: false },
    altKey: { value: false }, ctrlKey: { value: false }, metaKey: { value: false }, shiftKey: { value: false },
  })
  keyboardTarget.dispatchEvent(keyDown)
  assert.equal(keyDown.defaultPrevented, true)
  assert.equal(received[0].type, 'keyboard')
  assert.equal(received[0].phase, 'down')
  keyboardTarget.dispatchEvent(new Event('blur'))
  assert.equal(runtime.input.focusedPrimitiveId, null)
  assert.equal(received.at(-1).phase, 'up')
  assert.equal(received.at(-1).synthetic, true)
  assert.deepEqual(focus, [[true, 'keyboard'], [false, 'programmatic']])
  runtime.dispose()
})

test('gamepad, audio, virtual keyboard, and touch controls follow scoped focus and gesture ownership', async () => {
  const room = { id: 'room:a', roomId: 'a', visible: true }
  const primitive = makePrimitive('entity:screen', room)
  primitive.webSurface.interaction = { pointer: true, keyboard: false, scroll: false }
  const context = makeContext([primitive], room, createEvents())
  const registry = createWebSurfaceAppRegistry()
  const received = []
  const audio = []
  let appContext
  let keyboardRequest
  let keyboardClosed = 0
  let touchRequest
  let touchClosed = 0
  let gamepadTimestamp = 1
  registry.register('framebuffer', {
    mount() { return { dispose() {} } },
    devices: { gamepad: true, audio: true, textInput: true },
    createTextureSurface(_canvas, _props, contextValue) {
      appContext = contextValue
      return {
        render() {},
        handleInput(event) { received.push(event); return true },
        setAudioState(state) { audio.push(state) },
        dispose() {},
      }
    },
  })
  const bridge = makeBridge({ updates: 0, presented: [], textureDisposals: 0, bindingDisposals: 0, bridgeDisposals: 0 })
  bridge.bindTarget = () => ({ ok: true, binding: {
    kind: 'plane', texture: {}, presented: false,
    setPresented(value) { this.presented = value },
    hitTest() { return this.presented ? { uv: [0.5, 0.5], point: [0, 0, 0], normal: [0, 0, 1], distance: 1, frontFacing: true } : null },
    dispose() {},
  } })
  const runtime = new TextureWebSurfaceRuntime({
    registry,
    createBridge: () => bridge,
    canvasFactory: (width, height) => ({ width, height }),
    input: {
      getGamepads: () => [{ index: 0, id: 'Pad', connected: true, mapping: 'standard', axes: [0, 0], buttons: [{ pressed: false, touched: false, value: 0 }], timestamp: gamepadTimestamp }],
      virtualKeyboard: {
        open(request) { keyboardRequest = request; return { close() { keyboardClosed++ } } },
      },
      touchControls: {
        show(request) { touchRequest = request; return { close() { touchClosed++ } } },
      },
    },
  })
  await runtime.setup(context)
  assert.equal(audio.at(-1).muted, true)
  assert.equal(runtime.input.focus(primitive.id, { reason: 'gamepad' }), true, 'device-enabled app can focus without keyboard intent')
  runtime.update(1 / 60, context)
  assert.equal(received.filter(event => event.type === 'gamepad').length, 1)
  runtime.update(1 / 60, context)
  assert.equal(received.filter(event => event.type === 'gamepad').length, 1, 'unchanged gamepad state is not repeated')
  gamepadTimestamp = 2
  runtime.update(1 / 60, context)
  assert.equal(received.filter(event => event.type === 'gamepad').length, 2)
  assert.equal(audio.at(-1).muted, true, 'programmatic focus does not unlock audio')

  assert.equal(appContext.input.requestTextInput({ placeholder: 'Name' }), true)
  keyboardRequest.onText('A', 'insertText')
  assert.equal(received.at(-1).type, 'text')
  assert.equal(received.at(-1).text, 'A')
  appContext.input.setTouchControls([{ id: 'a', label: 'A', action: 'button-a' }])
  touchRequest.dispatch('button-a', true)
  assert.equal(received.at(-1).type, 'control')
  assert.equal(received.at(-1).action, 'button-a')
  assert.equal(audio.at(-1).muted, false, 'touch control gesture unlocks focused audio')

  runtime.input.blur(primitive.id)
  assert.equal(keyboardClosed, 1)
  assert.equal(touchClosed, 1)
  assert.equal(audio.at(-1).muted, true)

  runtime.input.dispatchRay({ phase: 'select', origin: [0, 0, 2], direction: [0, 0, -1] })
  assert.equal(audio.at(-1).muted, false)
  room.visible = false
  runtime.update(1 / 60, context)
  assert.equal(audio.at(-1).active, false)
  assert.equal(audio.at(-1).muted, true)
  runtime.dispose()
})

test('contain presentation stages output resolution and inversely maps input into logical pixels', async () => {
  const room = { id: 'room:a', roomId: 'a', visible: true }
  const primitive = makePrimitive('entity:screen', room)
  primitive.webSurface.interaction = { pointer: true, keyboard: false, scroll: false }
  primitive.webSurface.presentation = { type: 'texture', resolution: [200, 100], fit: 'contain' }
  const context = makeContext([primitive], room, createEvents())
  const registry = createWebSurfaceAppRegistry()
  const received = []
  const drawCalls = []
  const canvases = []
  const canvasFactory = (width, height) => {
    const canvas = {
      width, height,
      getContext(kind) {
        if (kind !== '2d') return null
        return {
          setTransform(...args) { drawCalls.push(['transform', ...args]) },
          clearRect(...args) { drawCalls.push(['clear', ...args]) },
          drawImage(source, ...args) { drawCalls.push(['draw', source.width, source.height, ...args]) },
        }
      },
    }
    canvases.push(canvas)
    return canvas
  }
  registry.register('framebuffer', {
    mount() { return { dispose() {} } },
    texture: { width: 100, height: 100 },
    createTextureSurface() { return { render() {}, handleInput(event) { received.push(event); return true }, dispose() {} } },
  })
  let hitUv = [0.5, 0.5]
  let dynamicSource
  const bridge = {
    backend: 'webgl2', identity: {},
    createDynamicTexture(options) {
      dynamicSource = options.source
      return { texture: {}, update(source) { dynamicSource = source }, resize() {}, dispose() {} }
    },
    bindTarget() { return { ok: true, binding: {
      kind: 'plane', texture: {}, presented: false,
      setPresented(value) { this.presented = value },
      hitTest() { return this.presented ? { uv: hitUv, point: [0, 0, 0], normal: [0, 0, 1], distance: 1, frontFacing: true } : null },
      dispose() {},
    } } },
    dispose() {},
  }
  const runtime = new TextureWebSurfaceRuntime({ registry, createBridge: () => bridge, canvasFactory })
  await runtime.setup(context)
  assert.equal(canvases.length, 2)
  assert.deepEqual([dynamicSource.width, dynamicSource.height], [200, 100])
  assert.equal(drawCalls.some(call => call[0] === 'draw'), true)
  assert.equal(runtime.input.dispatchRay({ phase: 'select', origin: [0, 0, 2], direction: [0, 0, -1] }), true)
  assert.deepEqual(received.at(-1).pixel, [50, 50])
  hitUv = [0.1, 0.5]
  assert.equal(runtime.input.dispatchRay({ phase: 'select', origin: [0, 0, 2], direction: [0, 0, -1] }), false, 'letterbox bars do not intercept input')
  runtime.dispose()
})
