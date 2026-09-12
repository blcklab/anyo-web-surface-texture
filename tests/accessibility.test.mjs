import test from 'node:test'
import assert from 'node:assert/strict'
import { createWebSurfaceAppRegistry } from '@blcklab/anyo/web-surface'
import { TextureWebSurfaceRuntime } from '../dist/index.js'

function events() {
  const map = new Map()
  return {
    on(name, listener) { const set = map.get(name) ?? new Set(); set.add(listener); map.set(name, set); return () => set.delete(listener) },
    emit(name, payload) { for (const listener of map.get(name) ?? []) listener(payload) },
  }
}

function contextFor(primitive) {
  const room = { id: 'room:a', roomId: 'a', visible: true }
  const bus = events()
  return {
    world: {
      document: null, compiled: null, transforms: {}, query: {}, exploration: {}, xr: { state: 'idle' },
      on: bus.on, emit: bus.emit, runAction: async () => {}, selectPrimitive: async () => true,
    },
    renderer: {
      canvas: { addEventListener() {}, removeEventListener() {}, focus() {} },
      camera: { getPosition: () => [0, 0, 2], setPosition() {}, getRotation: () => [0, 0], setRotation() {}, getForward: () => [0, 0, -1], getRight: () => [1, 0, 0] },
      whenIdle: async () => {}, setPrimitiveVisibility() {},
    },
    document: {},
    compiled: {
      primitives: [primitive], primitiveById: new Map([[primitive.id, primitive]]),
      roomById: new Map([[room.roomId, room]]), entityById: new Map(),
    },
    transforms: {}, query: {},
  }
}

function primitive() {
  return {
    id: 'entity:terminal', kind: 'image', entityId: 'terminal', roomId: 'a', visible: true,
    transform: { position: [0, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    size: [2, 1, 0.02],
    webSurface: {
      source: { type: 'app', app: 'terminal', props: { title: 'Arcade terminal' } },
      target: { type: 'plane', size: [2, 1] }, renderMode: 'texture',
      fallback: { type: 'snapshot', image: '/terminal.png' }, framePolicy: { mode: 'on-change' }, animations: [],
      interaction: { pointer: false, keyboard: false, scroll: false },
    },
  }
}

function bridge() {
  return {
    backend: 'webgl2', identity: {},
    createDynamicTexture() { return { texture: {}, width: 320, height: 180, version: 0, disposed: false, update() {}, resize() {}, dispose() {} } },
    bindTarget() { return { ok: true, binding: { kind: 'plane', texture: {}, presented: false, setPresented(value) { this.presented = value }, dispose() {} } } },
    dispose() {},
  }
}

async function settle() { await new Promise(resolve => setImmediate(resolve)) }

test('semantic companion exposes labels, focus, controls, announcements, and accessible text input', async () => {
  const registry = createWebSurfaceAppRegistry()
  const states = []
  const announcements = []
  const inputs = []
  const preferences = []
  let companionRequest
  let disposed = 0
  let appContext
  let keyboardRequest
  registry.register('terminal', {
    mount() { return { dispose() {} } },
    devices: { textInput: true },
    texture: { width: 320, height: 180 },
    accessibility: props => ({
      label: props.title,
      description: 'A trusted command terminal rendered on a 3D monitor.',
      instructions: 'Use the companion controls or focus the terminal.',
      prompt: 'Press Focus to interact.',
      contrast: 'high',
      controls: [{ id: 'run', label: 'Run command', action: 'run' }],
      textInput: { label: 'Terminal command', placeholder: 'Type a command' },
    }),
    createTextureSurface(_canvas, _props, context) {
      appContext = context
      return {
        render() {},
        handleInput(event) { inputs.push(event) },
        setAccessibilityPreferences(value) { preferences.push(value) },
        dispose() {},
      }
    },
  })
  const runtime = new TextureWebSurfaceRuntime({
    registry,
    createBridge: () => bridge(),
    canvasFactory: (width, height) => ({ width, height }),
    accessibility: {
      reducedMotion: true,
      highContrast: true,
      provider: {
        mount(request) {
          companionRequest = request
          states.push(request.state)
          return {
            update(state) { states.push(state) },
            announce(message, politeness) { announcements.push([message, politeness]) },
            dispose() { disposed++ },
          }
        },
      },
    },
    input: {
      virtualKeyboard: {
        open(request) { keyboardRequest = request; return { close() {} } },
      },
    },
  })
  const context = contextFor(primitive())
  await runtime.setup(context)
  assert.equal(states.at(-1).descriptor.label, 'Arcade terminal')
  assert.equal(states.at(-1).reducedMotion, true)
  assert.equal(states.at(-1).highContrast, true)
  assert.deepEqual(preferences.at(-1), { reducedMotion: true, highContrast: true })

  assert.equal(companionRequest.focus(), true)
  assert.equal(states.at(-1).focused, true)
  companionRequest.activateControl(states.at(-1).descriptor.controls[0])
  assert.deepEqual(inputs.slice(-2).map(event => [event.type, event.action, event.pressed, event.source]), [
    ['control', 'run', true, 'accessibility'], ['control', 'run', false, 'accessibility'],
  ])

  appContext.accessibility.announce('Command completed', 'assertive')
  assert.deepEqual(announcements, [['Command completed', 'assertive']])
  assert.equal(companionRequest.requestTextInput(), true)
  assert.equal(keyboardRequest.ariaLabel, 'Terminal command')
  assert.equal(keyboardRequest.placeholder, 'Type a command')

  appContext.accessibility.update({ label: 'Updated terminal', controls: [] })
  assert.equal(states.at(-1).descriptor.label, 'Updated terminal')
  companionRequest.blur()
  assert.equal(states.at(-1).focused, false)
  runtime.dispose()
  await settle()
  assert.equal(disposed, 1)
})

test('accessibility metadata failures degrade without breaking texture presentation', async () => {
  const registry = createWebSurfaceAppRegistry()
  const diagnostics = []
  registry.register('terminal', {
    mount() { return { dispose() {} } },
    accessibility: { label: '   ' },
    createTextureSurface() { return { render() {}, dispose() {} } },
  })
  const runtime = new TextureWebSurfaceRuntime({
    registry, createBridge: () => bridge(), canvasFactory: (width, height) => ({ width, height }),
    accessibility: { provider: { mount() { throw new Error('should not mount invalid descriptor') } } },
    diagnostics: diagnostic => diagnostics.push(diagnostic),
  })
  await runtime.setup(contextFor(primitive()))
  assert.equal(runtime.stats.mounted, 1)
  assert.equal(diagnostics.some(value => value.code === 'ANYO_TEXTURE_ACCESSIBILITY_INVALID'), true)
  runtime.dispose()
})
