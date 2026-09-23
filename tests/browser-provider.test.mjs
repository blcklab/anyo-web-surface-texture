import test from 'node:test'
import assert from 'node:assert/strict'
import { createNativeBrowserTextureApp, textureWebSurfacePlugin } from '../dist/index.js'
import { createWorld } from '@blcklab/anyo/core'
import { entitiesPlugin } from '@blcklab/anyo/entities'
import { createWebSurfaceAppRegistry } from '@blcklab/anyo/web-surface'

class Renderer {
  canvas = { getBoundingClientRect: () => ({ width: 800, height: 600 }) }
  camera = { getPosition: () => [0, 1.6, 2], setPosition() {}, getRotation: () => [0, 0], setRotation() {}, getForward: () => [0, 0, -1], getRight: () => [1, 0, 0] }
  async mount() {}
  async applyChanges() {}
  setPrimitiveVisibility() {}
  setRoomVisibility() {}
  render() {}
  resize() {}
  pick() { return null }
  dispose() {}
}

function bridge() {
  return {
    backend: 'webgl2', identity: {},
    createDynamicTexture({ source }) {
      return { texture: {}, width: source.width, height: source.height, version: 0, disposed: false, update() {}, resize() {}, dispose() {} }
    },
    bindTarget() {
      return { ok: true, binding: { kind: 'plane', texture: {}, presented: false, setPresented(value) { this.presented = value }, dispose() {} } }
    },
    dispose() {},
  }
}

function primitive() {
  return {
    id: 'screen', entityId: 'screen', kind: 'image', visible: true,
    transform: { position: [0, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    size: [2, 1, 0.02],
    webSurface: {
      source: { type: 'url', url: 'https://example.com/app' },
      target: { type: 'plane', size: [2, 1] },
      presentation: { type: 'texture', resolution: [1920, 1080] },
      renderMode: 'auto', fallback: { type: 'snapshot', image: '/fallback.png' },
      framePolicy: { mode: 'on-change', maxFps: 30 }, animations: [],
      interaction: { pointer: true, keyboard: true, scroll: true },
    },
  }
}

test('native browser provider adapter keeps 1080p physical size bounded while forwarding logical input', async () => {
  const calls = { create: null, resizes: [], focus: [], pointers: [], wheels: [], keys: [], text: [], navigation: [], suspend: 0, resume: 0, dispose: 0 }
  const provider = {
    canPresent(url) { return url.startsWith('https://example.com/') },
    async createSurface(request) {
      calls.create = request
      return {
        navigate(url) { calls.navigation.push(['navigate', url]) },
        back() { calls.navigation.push(['back']) },
        forward() { calls.navigation.push(['forward']) },
        reload() { calls.navigation.push(['reload']) },
        resize(value) { calls.resizes.push(value) },
        focus(value) { calls.focus.push(value) },
        sendPointer(value) { calls.pointers.push(value); return true },
        sendWheel(value) { calls.wheels.push(value); return true },
        sendKeyboard(value) { calls.keys.push(value); return true },
        sendText(value, inputType) { calls.text.push([value, inputType]); return true },
        suspend() { calls.suspend++ },
        resume() { calls.resume++ },
        dispose() { calls.dispose++ },
      }
    },
  }
  const app = createNativeBrowserTextureApp(primitive(), provider, { mode: 'full-hd', devicePixelRatio: 2 })
  assert.ok(app)
  assert.equal(app.texture.width, 1920)
  assert.equal(app.texture.height, 1080)
  const context = {
    signal: new AbortController().signal,
    invalidate() {},
    quality: { width: 1920, height: 1080, logicalWidth: 960, logicalHeight: 540, deviceScale: 2, mode: 'full-hd', preset: 'full-hd' },
  }
  const instance = await app.createTextureSurface({ width: 1920, height: 1080 }, {}, context)
  assert.equal(calls.create.primitiveId, 'screen')
  assert.equal(calls.create.width, 1920)
  assert.equal(calls.create.height, 1080)
  assert.equal(calls.create.logicalWidth, 960)
  instance.handleInput({
    type: 'pointer', phase: 'down', primitiveId: 'screen', pointerId: 1, pointerType: 'mouse',
    button: 0, buttons: 1, uv: [0.5, 0.5], pixel: [960, 540], point: [0, 0, 0], normal: [0, 0, 1],
    distance: 1, captured: false, timestamp: 1,
  })
  assert.equal(calls.pointers[0].x, 480)
  assert.equal(calls.pointers[0].y, 270)
  instance.handleInput({
    type: 'pointer', phase: 'wheel', primitiveId: 'screen', pointerId: 1, pointerType: 'mouse',
    button: 0, buttons: 0, uv: [0.5, 0.5], pixel: [960, 540], point: [0, 0, 0], normal: [0, 0, 1],
    distance: 1, captured: false, timestamp: 2, delta: [1, 2, 3],
  })
  assert.deepEqual([calls.wheels[0].deltaX, calls.wheels[0].deltaY, calls.wheels[0].deltaZ], [1, 2, 3])
  instance.handleInput({ type: 'keyboard', phase: 'down', primitiveId: 'screen', key: 'A', code: 'KeyA', repeat: false, modifiers: { alt: false, ctrl: false, meta: false, shift: false }, timestamp: 3 })
  instance.handleInput({ type: 'text', primitiveId: 'screen', text: 'a', inputType: 'insertText', timestamp: 4 })
  await instance.navigate('https://example.com/next')
  await instance.back()
  await instance.forward()
  await instance.reload()
  instance.setInputFocus(true)
  instance.pause()
  instance.resume()
  await instance.dispose()
  assert.equal(calls.keys.length, 1)
  assert.deepEqual(calls.text, [['a', 'insertText']])
  assert.deepEqual(calls.focus, [true])
  assert.deepEqual(calls.navigation, [
    ['navigate', 'https://example.com/next'], ['back'], ['forward'], ['reload'],
  ])
  assert.equal(calls.suspend, 1)
  assert.equal(calls.resume, 1)
  assert.equal(calls.dispose, 1)
})

test('plugin advertises native-browser capability only when a host provider is injected', () => {
  const registry = { get() {}, register() {}, has() { return false }, clear() {} }
  const without = textureWebSurfacePlugin({ registry, createBridge: () => null, domFallback: false })
  assert.equal(without.capabilities.nativeBrowserProvider, false)
  without.dispose()
  const withProvider = textureWebSurfacePlugin({
    registry, createBridge: () => null, domFallback: false,
    browserProvider: { createSurface() { return { dispose() {} } } },
  })
  assert.equal(withProvider.capabilities.nativeBrowserProvider, true)
  withProvider.dispose()
})

test('registered repository app can be promoted to native browser texture through host-only browserSource metadata', async () => {
  const registry = createWebSurfaceAppRegistry()
  registry.register('research-dashboard', {
    browserSource: { url: 'https://cdn.example.com/world/web-surface/research-dashboard/index.html' },
    mount() { return { dispose() {} } },
  })
  const calls = []
  const provider = {
    canPresent(url) { calls.push(['canPresent', url]); return true },
    createSurface(request) {
      calls.push(['createSurface', request.primitiveId, request.url, request.width, request.height])
      return { dispose() { calls.push(['dispose']) } }
    },
  }
  const plugin = textureWebSurfacePlugin({
    registry,
    browserProvider: provider,
    createBridge: () => bridge(),
    canvasFactory: (width, height) => ({ width, height }),
    quality: { mode: 'full-hd', maxDevicePixelRatio: 1 },
    domFallback: false,
  })
  const renderer = new Renderer()
  const world = createWorld({ renderer, plugins: [entitiesPlugin(), plugin], autoResize: false })
  await world.load({
    version: '0.8',
    entities: [{
      id: 'repo-screen', type: 'web-surface', size: [1.92, 1.08],
      webSurface: {
        source: { type: 'app', app: 'research-dashboard' },
        target: { type: 'plane', size: [1.92, 1.08] },
        presentation: { type: 'texture', resolution: [1920, 1080] },
        fallback: { type: 'snapshot', image: '/fallback.png' },
      },
    }],
  })
  assert.ok(calls.some(call => call[0] === 'createSurface' && call[1] === 'entity:repo-screen' && call[2].includes('/research-dashboard/index.html') && call[3] === 1920 && call[4] === 1080))
  world.dispose()
})


test('plugin browser controller navigates a mounted provider-backed physical surface', async () => {
  const registry = createWebSurfaceAppRegistry()
  const navigation = []
  const plugin = textureWebSurfacePlugin({
    registry, domFallback: false, createBridge: () => bridge(),
    canvasFactory: (width, height) => ({ width, height }),
    browserProvider: {
      createSurface() {
        return {
          navigate(url) { navigation.push(['navigate', url]) },
          back() { navigation.push(['back']) },
          forward() { navigation.push(['forward']) },
          reload() { navigation.push(['reload']) },
          dispose() {},
        }
      },
    },
  })
  const renderer = new Renderer()
  const world = createWorld({ renderer, plugins: [entitiesPlugin(), plugin], autoResize: false })
  await world.load({
    version: '0.8',
    entities: [{
      id: 'browser-screen', type: 'web-surface', size: [2, 1],
      webSurface: {
        source: { type: 'url', url: 'https://example.com/' },
        target: { type: 'plane', size: [2, 1] },
        presentation: { type: 'texture', resolution: [1920, 1080] },
        fallback: { type: 'snapshot', image: '/fallback.png' },
      },
    }],
  })
  assert.equal(plugin.browser.canControl('entity:browser-screen'), true)
  assert.equal(await plugin.browser.navigate('entity:browser-screen', 'https://openai.com/'), true)
  assert.equal(await plugin.browser.back('entity:browser-screen'), true)
  assert.equal(await plugin.browser.forward('entity:browser-screen'), true)
  assert.equal(await plugin.browser.reload('entity:browser-screen'), true)
  assert.equal(await plugin.browser.reload('missing'), false)
  assert.deepEqual(navigation, [
    ['navigate', 'https://openai.com/'], ['back'], ['forward'], ['reload'],
  ])
  world.dispose()
})
