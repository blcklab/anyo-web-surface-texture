import test from 'node:test'
import assert from 'node:assert/strict'
import { createWebSurfaceAppRegistry } from '@blcklab/anyo/web-surface'
import { textureWebSurfacePlugin } from '../dist/index.js'

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase()
    this.dataset = {}
    this.style = {}
    this.children = []
    this.listeners = new Map()
    this.removed = false
    this.inert = false
  }
  setAttribute(name, value) { this[name] = String(value) }
  append(...children) { this.children.push(...children) }
  appendChild(child) { this.append(child); return child }
  replaceChildren(...children) { this.children = [...children] }
  addEventListener(name, listener) { this.listeners.set(name, listener) }
  animate() { return { cancel() {} } }
  remove() { this.removed = true }
}

function events() {
  const values = new Map()
  return {
    on(name, handler) {
      const set = values.get(name) ?? new Set()
      set.add(handler); values.set(name, set)
      return () => set.delete(handler)
    },
  }
}

function primitive() {
  return {
    id: 'entity:screen', entityId: 'screen', kind: 'image', visible: true,
    transform: { position: [0, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    size: [2, 1, 0.02],
    webSurface: {
      source: { type: 'app', app: 'screen-app', props: {} },
      target: { type: 'plane', size: [2, 1] },
      renderMode: 'auto',
      fallback: { type: 'snapshot', image: '/fallback.png' },
      framePolicy: { mode: 'on-change', maxFps: 30 },
      animations: [],
      interaction: { pointer: false, keyboard: false, scroll: false },
    },
  }
}

function context(value) {
  const eventBus = events()
  return {
    world: {
      xr: { state: 'idle' },
      on: eventBus.on,
      runAction: async () => {},
      selectPrimitive: async () => true,
    },
    renderer: {
      whenIdle: async () => {},
      setPrimitiveVisibility() {},
      camera: { projectWorldPoint: () => ({ x: 100, y: 100, depth: 1, visible: true }) },
    },
    document: {},
    compiled: {
      primitives: [value],
      primitiveById: new Map([[value.id, value]]),
      roomById: new Map(),
      entityById: new Map(),
    },
    transforms: {}, query: {},
  }
}

function bridge() {
  return {
    backend: 'webgl2', identity: {},
    createDynamicTexture() {
      return { texture: {}, width: 16, height: 16, version: 0, disposed: false, update() {}, resize() {}, dispose() {} }
    },
    bindTarget() {
      return { ok: true, binding: { kind: 'plane', texture: {}, presented: false, setPresented(value) { this.presented = value }, dispose() {} } }
    },
    dispose() {},
  }
}

async function withFakeDom(callback) {
  const previousDocument = globalThis.document
  const previousMatchMedia = globalThis.matchMedia
  const body = new FakeElement('body')
  globalThis.document = { body, createElement: tag => new FakeElement(tag) }
  globalThis.matchMedia = () => ({ matches: false })
  try { await callback(body) }
  finally {
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
    if (previousMatchMedia === undefined) delete globalThis.matchMedia
    else globalThis.matchMedia = previousMatchMedia
  }
}

test('successful texture presentation claims the app before DOM fallback can mount it', async () => {
  await withFakeDom(async body => {
    const registry = createWebSurfaceAppRegistry()
    let domMounts = 0
    let textureMounts = 0
    registry.register('screen-app', {
      mount() { domMounts++; return { dispose() {} } },
      createTextureSurface() { textureMounts++; return { render() {}, dispose() {} } },
    })
    const plugin = textureWebSurfacePlugin({ registry, createBridge: () => bridge(), canvasFactory: (width, height) => ({ width, height }) })
    await plugin.setup(context(primitive()))
    assert.equal(textureMounts, 1)
    assert.equal(domMounts, 0)
    assert.equal(body.children.length, 1, 'fallback root exists but contains no duplicate app surface')
    assert.equal(body.children[0].children.length, 0)
    plugin.dispose()
  })
})

test('apps without texture capability continue through the managed DOM fallback', async () => {
  await withFakeDom(async body => {
    const registry = createWebSurfaceAppRegistry()
    let domMounts = 0
    let domDisposals = 0
    registry.register('screen-app', {
      mount() { domMounts++; return { dispose() { domDisposals++ } } },
    })
    const plugin = textureWebSurfacePlugin({ registry, createBridge: () => bridge(), canvasFactory: (width, height) => ({ width, height }) })
    await plugin.setup(context(primitive()))
    assert.equal(domMounts, 1)
    assert.equal(body.children[0].children.length, 1)
    plugin.dispose()
    assert.equal(domDisposals, 1)
  })
})

test('failed texture rendering releases the claim and mounts one DOM fallback instance', async () => {
  await withFakeDom(async () => {
    const registry = createWebSurfaceAppRegistry()
    let domMounts = 0
    registry.register('screen-app', {
      mount() { domMounts++; return { dispose() {} } },
      createTextureSurface() { return { render() { throw new Error('bad framebuffer') }, dispose() {} } },
    })
    const plugin = textureWebSurfacePlugin({ registry, createBridge: () => bridge(), canvasFactory: (width, height) => ({ width, height }) })
    await plugin.setup(context(primitive()))
    assert.equal(domMounts, 1)
    plugin.dispose()
  })
})

test('world teardown releases one generation and allows the same plugin to mount the next world', async () => {
  await withFakeDom(async () => {
    const registry = createWebSurfaceAppRegistry()
    let textureMounts = 0
    let textureDisposals = 0
    registry.register('screen-app', {
      mount() { return { dispose() {} } },
      createTextureSurface() {
        textureMounts++
        return { render() {}, dispose() { textureDisposals++ } }
      },
    })

    const plugin = textureWebSurfacePlugin({
      registry,
      createBridge: () => bridge(),
      canvasFactory: (width, height) => ({ width, height }),
      domFallback: false,
    })
    const stableInput = plugin.input
    const stableMaintenance = plugin.maintenance

    await plugin.setup(context(primitive()))
    assert.equal(textureMounts, 1)
    plugin.teardown()
    assert.equal(textureDisposals, 1)

    await plugin.setup(context(primitive()))
    assert.equal(textureMounts, 2)
    assert.equal(plugin.input, stableInput)
    assert.equal(plugin.maintenance, stableMaintenance)

    plugin.dispose()
    assert.equal(textureDisposals, 2)
    await assert.rejects(() => plugin.setup(context(primitive())), /disposed/i)
  })
})
