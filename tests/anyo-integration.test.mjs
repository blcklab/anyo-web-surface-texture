import test from 'node:test'
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { createWorld } from '@blcklab/anyo/core'
import { buildingPlugin } from '@blcklab/anyo/building'
import { assetsPlugin } from '@blcklab/anyo/assets'
import { entitiesPlugin } from '@blcklab/anyo/entities'
import { createWebSurfaceAppRegistry } from '@blcklab/anyo/web-surface'
import { textureWebSurfacePlugin } from '../dist/index.js'

class Camera {
  getPosition() { return [0, 1.65, 2] }
  setPosition() {}
  getRotation() { return [0, 0] }
  setRotation() {}
  getForward() { return [0, 0, -1] }
  getRight() { return [1, 0, 0] }
}

class Renderer {
  canvas = { getBoundingClientRect: () => ({ width: 800, height: 600 }) }
  camera = new Camera()
  async mount() {}
  async applyChanges() {}
  setPrimitiveVisibility() {}
  setRoomVisibility() {}
  render() {}
  resize() {}
  pick() { return null }
  dispose() {}
}

function bridge(log) {
  return {
    backend: 'webgl2', identity: {},
    createDynamicTexture({ source }) {
      return {
        texture: {}, width: source.width, height: source.height, version: 0, disposed: false,
        update() { log.uploads++ }, resize() {}, dispose() { log.textureDisposals++ },
      }
    },
    bindTarget() {
      return {
        ok: true,
        binding: {
          kind: 'plane', texture: {}, presented: false,
          setPresented(value) { this.presented = value; log.presented.push(value) },
          dispose() { log.bindingDisposals++ },
        },
      }
    },
    dispose() { log.bridgeDisposals++ },
  }
}

test('real Anyo world compilation mounts a trusted framebuffer app and updates bound props without remounting', async () => {
  const registry = createWebSurfaceAppRegistry()
  const log = { renders: [], appUpdates: [], uploads: 0, presented: [], appDisposals: 0, textureDisposals: 0, bindingDisposals: 0, bridgeDisposals: 0 }
  registry.register('gameboy-framebuffer', {
    mount() { return { dispose() {} } },
    texture: { width: 160, height: 144 },
    createTextureSurface(canvas, props) {
      assert.equal(canvas.width, 160)
      assert.equal(canvas.height, 144)
      return {
        render(next) { log.renders.push(next.frame) },
        update(next) { log.appUpdates.push(next.frame) },
        dispose() { log.appDisposals++ },
      }
    },
  })
  const renderer = new Renderer()
  const plugin = textureWebSurfacePlugin({
    registry,
    createBridge: () => bridge(log),
    canvasFactory: (width, height) => ({ width, height }),
  })
  const world = createWorld({ renderer, plugins: [buildingPlugin(), entitiesPlugin(), plugin], autoResize: false })
  await world.load({
    version: '0.6',
    data: { frame: 1 },
    building: { floors: [{ id: 'ground', elevation: 0, rooms: [{ id: 'arcade', size: [8, 8] }] }] },
    entities: [{
      id: 'gameboy-screen',
      type: 'web-surface',
      room: 'arcade',
      size: [1.6, 1.44],
      webSurface: {
        source: { type: 'app', app: 'gameboy-framebuffer', props: { frame: { $bind: 'frame' } } },
        target: { type: 'plane', size: [1.6, 1.44] },
        fallback: { type: 'snapshot', image: '/gameboy-offline.png' },
        framePolicy: { mode: 'on-change' },
      },
    }],
  })
  assert.deepEqual(log.renders, [1])
  assert.equal(log.uploads, 1)
  assert.deepEqual(log.presented, [false, true], 'snapshot stays visible until the first framebuffer upload succeeds')

  await world.setData('frame', 2)
  assert.deepEqual(log.appUpdates, [2])
  world.dispose()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(log.appDisposals, 1)
  assert.equal(log.textureDisposals, 1)
  assert.equal(log.bindingDisposals, 1)
  assert.equal(log.bridgeDisposals, 1)
})

test('Game Boy monitor fixture resolves its prefab-local DisplayPanel surface-host slot', async () => {
  const registry = createWebSurfaceAppRegistry()
  registry.register('gameboy-emulator', {
    mount() { return { dispose() {} } },
    texture: { width: 160, height: 144 },
    createTextureSurface() { return { render() {}, dispose() {} } },
  })
  let captured
  const plugin = textureWebSurfacePlugin({
    registry,
    createBridge: () => ({
      backend: 'webgpu', identity: {},
      createDynamicTexture() {
        return { texture: {}, width: 160, height: 144, version: 0, disposed: false, update() {}, resize() {}, dispose() {} }
      },
      bindTarget(request) {
        captured = request.resolution
        return { ok: true, binding: { kind: request.resolution.kind, texture: {}, presented: false, setPresented(value) { this.presented = value }, dispose() {} } }
      },
      dispose() {},
    }),
    canvasFactory: (width, height) => ({ width, height }),
    domFallback: false,
  })
  const renderer = new Renderer()
  const world = createWorld({ renderer, plugins: [buildingPlugin(), assetsPlugin(), entitiesPlugin(), plugin], autoResize: false })
  const document = JSON.parse(await readFile(new URL('../examples/gameboy-monitor/world.json', import.meta.url), 'utf8'))
  await world.load(document)
  assert.equal(captured.kind, 'entity-slot')
  assert.equal(captured.entity.id, 'monitor/body')
  assert.equal(captured.slot.mesh, 'DisplayPanel')
  assert.equal(captured.slot.materialSlot, 0)
  assert.equal(captured.slot.uvSet, 0)
  world.dispose()
})
