import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SANDBOXED_TEXTURE_PROTOCOL,
  createSandboxedCanvasTextureCapability,
  isTextureWebSurfaceApp,
} from '../dist/index.js'

test('sandboxed texture companion requires an absolute entry URL and advertises texture capability', () => {
  assert.throws(() => createSandboxedCanvasTextureCapability({ entryUrl: './texture.html' }), /absolute URL/)
  const capability = createSandboxedCanvasTextureCapability({
    entryUrl: 'https://cdn.example.com/world/web-surface/app/texture.html',
    texture: { width: 1920, height: 1080 },
  })
  assert.equal(capability.texture.width, 1920)
  assert.equal(capability.texture.height, 1080)
  assert.equal(capability.texture.flipY, true, 'sandboxed canvas frames use top-left canvas pixels and need the GPU Y flip by default')
  const explicit = createSandboxedCanvasTextureCapability({
    entryUrl: 'https://cdn.example.com/world/web-surface/app/texture.html',
    texture: { width: 1920, height: 1080, flipY: false },
  })
  assert.equal(explicit.texture.flipY, false, 'explicit orientation overrides remain supported')
  assert.equal(typeof capability.createTextureSurface, 'function')
  assert.equal(isTextureWebSurfaceApp({ mount() { return { dispose() {} } }, ...capability }), true)
})

test('sandboxed texture companion receives ImageBitmap frames without executing repository code in the host realm', async () => {
  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    ImageBitmap: globalThis.ImageBitmap,
  }
  const messageListeners = new Set()
  const drawLog = []

  class FakeBitmap {
    closed = false
    close() { this.closed = true }
  }
  globalThis.ImageBitmap = FakeBitmap

  const fakeWindow = {
    addEventListener(type, listener) { if (type === 'message') messageListeners.add(listener) },
    removeEventListener(type, listener) { if (type === 'message') messageListeners.delete(listener) },
  }
  globalThis.window = fakeWindow

  let iframe
  globalThis.document = {
    body: {
      append(node) {
        iframe = node
        queueMicrotask(() => node.dispatch('load'))
      },
    },
    createElement(tag) {
      assert.equal(tag, 'iframe')
      const listeners = new Map()
      const contentWindow = {
        postMessage(message) {
          if (message.type === 'init') {
            queueMicrotask(() => emit({ protocol: SANDBOXED_TEXTURE_PROTOCOL, token: message.token, type: 'ready' }, contentWindow))
          } else if (message.type === 'frame') {
            const bitmap = new FakeBitmap()
            queueMicrotask(() => emit({ protocol: SANDBOXED_TEXTURE_PROTOCOL, token: message.token, type: 'frame', requestId: message.requestId, bitmap }, contentWindow))
          }
        },
      }
      return {
        style: {}, attributes: {}, contentWindow, src: '', title: '', removed: false,
        setAttribute(name, value) { this.attributes[name] = String(value) },
        addEventListener(type, listener) { const set = listeners.get(type) ?? new Set(); set.add(listener); listeners.set(type, set) },
        removeEventListener(type, listener) { listeners.get(type)?.delete(listener) },
        dispatch(type) { for (const listener of listeners.get(type) ?? []) listener() },
        remove() { this.removed = true },
      }
    },
  }

  function emit(data, source) {
    for (const listener of messageListeners) listener({ data, source })
  }

  const canvas = {
    width: 1920,
    height: 1080,
    getContext(type) {
      assert.equal(type, '2d')
      return {
        clearRect(...args) { drawLog.push(['clear', ...args]) },
        drawImage(bitmap, ...args) { drawLog.push(['draw', bitmap, ...args]) },
      }
    },
  }
  const abortController = new AbortController()
  let invalidations = 0
  const context = {
    signal: abortController.signal,
    quality: { width: 1920, height: 1080, logicalWidth: 1920, logicalHeight: 1080, deviceScale: 1, mode: 'full-hd', preset: 'full-hd' },
    invalidate() { invalidations++ },
  }
  const capability = createSandboxedCanvasTextureCapability({ entryUrl: 'https://cdn.example.com/texture.html' })
  const instance = await capability.createTextureSurface(canvas, {}, context)
  await instance.render({}, { time: 1, deltaSeconds: 0, frame: 1, reason: 'initial' })
  assert.equal(drawLog.filter(entry => entry[0] === 'draw').length, 1)
  assert.equal(iframe.attributes.sandbox, 'allow-scripts')
  assert.equal(iframe.attributes['aria-hidden'], 'true')
  assert.equal(invalidations, 0)
  await instance.dispose()
  assert.equal(iframe.removed, true)

  if (previous.document === undefined) delete globalThis.document; else globalThis.document = previous.document
  if (previous.window === undefined) delete globalThis.window; else globalThis.window = previous.window
  if (previous.ImageBitmap === undefined) delete globalThis.ImageBitmap; else globalThis.ImageBitmap = previous.ImageBitmap
})
