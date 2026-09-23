import test from 'node:test'
import assert from 'node:assert/strict'
import { PerspectiveCamera } from '@blcklab/sekai64/cameras'
import { Geometry, PlaneGeometry } from '@blcklab/sekai64/geometry'
import { StandardMaterial, Texture, TextureMaterial } from '@blcklab/sekai64/materials'
import { Mesh, Node, Scene } from '@blcklab/sekai64/scene'
import { createSekai64TextureSurfaceBridge } from '../dist/sekai64/index.js'

function gpuRenderer() {
  return {
    backend: 'webgl2', disposed: false,
    capabilities: { maxTextureSize: 4096 },
  }
}

function primitive(id = 'entity:surface') {
  return {
    id, kind: 'image', entityId: id.slice(7), visible: true,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    size: [2, 1, 0.02],
  }
}

test('Sekai64 bridge replaces and restores the real plane material', () => {
  const scene = new Scene()
  const geometry = new PlaneGeometry({ width: 1, height: 1 })
  const original = new StandardMaterial({ baseColor: '#111111' })
  const plane = new Mesh({ id: 'entity:surface', geometry, material: original, ownsGeometry: true, ownsMaterial: true })
  scene.add(plane)
  const native = gpuRenderer()
  const camera = new PerspectiveCamera({ aspect: 1 }); camera.position.z = 2; camera.updateMatrices()
  const adapter = {
    canvas: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) },
    setPrimitiveVisibility() {},
    getNativeAccess: () => ({
      engine: { renderer: native }, scene, camera,
      getPrimitiveNode: id => id === plane.id ? plane : undefined,
      getRoomNode: () => undefined,
    }),
  }
  const bridge = createSekai64TextureSurfaceBridge(adapter)
  assert.ok(bridge)
  const dynamic = bridge.createDynamicTexture({ source: { width: 160, height: 144 }, flipY: false })
  dynamic.update({ width: 160, height: 144 })
  const resolution = { resolved: true, kind: 'plane', target: { type: 'plane', size: [2, 1] }, primitive: primitive() }
  const result = bridge.bindTarget({ primitive: primitive(), resolution, texture: dynamic.texture })
  assert.equal(result.ok, true)
  result.binding.setPresented(true)
  assert.notEqual(plane.material, original)
  assert.equal(plane.material.baseColorTexture, dynamic.texture)
  const hit = result.binding.hitTest({ type: 'screen', clientX: 50, clientY: 50 })
  assert.ok(hit)
  assert.ok(Math.abs(hit.uv[0] - 0.5) < 1e-6)
  assert.ok(Math.abs(hit.uv[1] - 0.5) < 1e-6)
  result.binding.setPresented(false)
  assert.equal(plane.material, original)
  result.binding.dispose()
  assert.equal(plane.material, original)
  dynamic.dispose()
  bridge.dispose()
  scene.dispose(); camera.dispose()
})

test('Sekai64 bridge promotes TextureMaterial fallback planes to a live depth-writing screen material', () => {
  const scene = new Scene()
  const geometry = new PlaneGeometry({ width: 1, height: 1 })
  const fallbackTexture = new Texture({ source: { kind: 'data', width: 1, height: 1, data: new Uint8Array([4, 8, 12, 255]) } })
  const original = new TextureMaterial({
    map: fallbackTexture,
    tint: '#ffffff',
    transparent: true,
    doubleSided: true,
    ownsTexture: false,
  })
  const plane = new Mesh({ id: 'entity:surface', geometry, material: original, ownsGeometry: true, ownsMaterial: true })
  scene.add(plane)
  const native = gpuRenderer()
  const camera = new PerspectiveCamera({ aspect: 1 }); camera.position.z = 2; camera.updateMatrices()
  const adapter = {
    canvas: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) },
    setPrimitiveVisibility() {},
    getNativeAccess: () => ({
      engine: { renderer: native }, scene, camera,
      getPrimitiveNode: id => id === plane.id ? plane : undefined,
      getRoomNode: () => undefined,
    }),
  }
  const bridge = createSekai64TextureSurfaceBridge(adapter)
  assert.ok(bridge)
  const dynamic = bridge.createDynamicTexture({ source: { width: 1920, height: 1080 }, flipY: false })
  const surface = {
    ...primitive(),
    webSurface: {
      presentation: {
        type: 'texture',
        resolution: [1920, 1080],
        side: 'double',
        emissive: { color: '#ffffff', intensity: 1, useTexture: true },
      },
    },
  }
  const resolution = { resolved: true, kind: 'plane', target: { type: 'plane', size: [2, 1] }, primitive: surface }
  const result = bridge.bindTarget({ primitive: surface, resolution, texture: dynamic.texture })
  assert.equal(result.ok, true)
  result.binding.setPresented(true)
  assert.ok(plane.material instanceof StandardMaterial)
  assert.equal(plane.material.baseColorTexture, dynamic.texture)
  assert.equal(plane.material.emissiveTexture, dynamic.texture)
  assert.equal(plane.material.transparent, false)
  assert.equal(plane.material.depthWrite, true)
  assert.equal(plane.material.side, 'double')
  const hit = result.binding.hitTest({ type: 'screen', clientX: 50, clientY: 50 })
  assert.ok(hit)
  result.binding.setPresented(false)
  assert.equal(plane.material, original)
  result.binding.dispose()
  assert.equal(plane.material, original)
  dynamic.dispose()
  bridge.dispose()
  scene.dispose(); camera.dispose(); fallbackTexture.dispose()
})

test('Sekai64 bridge resolves a named entity-slot monitor mesh and hides the fallback plane only while live', () => {
  const scene = new Scene()
  const geometry = new PlaneGeometry({ width: 1, height: 1 })
  const screenMaterial = new StandardMaterial({ baseColor: '#050505' })
  const screen = new Mesh({ id: 'screen-mesh', name: 'DisplayPanel', geometry, material: screenMaterial })
  const monitor = new Node({ id: 'entity:monitor' }).add(screen)
  const fallbackMaterial = new StandardMaterial({ baseColor: '#333333' })
  const fallback = new Mesh({ id: 'entity:surface', geometry, material: fallbackMaterial })
  scene.add(monitor, fallback)
  const visibility = []
  const native = gpuRenderer()
  const nodes = new Map([[monitor.id, monitor], [fallback.id, fallback]])
  const adapter = {
    setPrimitiveVisibility(id, visible) { visibility.push([id, visible]) },
    getNativeAccess: () => ({
      engine: { renderer: native }, scene,
      getPrimitiveNode: id => nodes.get(id),
      getRoomNode: () => undefined,
    }),
  }
  const bridge = createSekai64TextureSurfaceBridge(adapter)
  const dynamic = bridge.createDynamicTexture({ source: { width: 160, height: 144 }, flipY: false })
  const resolution = {
    resolved: true,
    kind: 'entity-slot',
    target: { type: 'entity-slot', entity: 'monitor', slot: 'screen' },
    entity: { id: 'monitor', primitiveIds: ['entity:monitor'], childIds: [], transform: {}, authoringId: 'monitor', type: 'model', sourcePath: '' },
    slot: { entityId: 'monitor', slot: 'screen', mesh: 'DisplayPanel', materialSlot: 0, uvSet: 0 },
  }
  const result = bridge.bindTarget({ primitive: primitive(), resolution, texture: dynamic.texture })
  assert.equal(result.ok, true)
  result.binding.setPresented(true)
  assert.equal(screen.material.baseColorTexture, dynamic.texture)
  assert.deepEqual(visibility.at(-1), ['entity:surface', false])
  result.binding.setPresented(false)
  assert.equal(screen.material, screenMaterial)
  assert.deepEqual(visibility.at(-1), ['entity:surface', true])
  result.binding.dispose()
  dynamic.dispose()
  bridge.dispose()
  scene.dispose()
})

test('named-target fallback visibility restores its authored native state', () => {
  const scene = new Scene()
  const geometry = new PlaneGeometry({ width: 1, height: 1 })
  const screen = new Mesh({ id: 'screen', name: 'DisplayPanel', geometry, material: new StandardMaterial() })
  const monitor = new Node({ id: 'entity:monitor' }).add(screen)
  const fallback = new Mesh({ id: 'entity:surface', visible: false, geometry, material: new StandardMaterial() })
  scene.add(monitor, fallback)
  const visibility = []
  const native = gpuRenderer()
  const nodes = new Map([[monitor.id, monitor], [fallback.id, fallback]])
  const adapter = {
    setPrimitiveVisibility(id, visible) { visibility.push([id, visible]) },
    getNativeAccess: () => ({
      engine: { renderer: native }, scene,
      getPrimitiveNode: id => nodes.get(id),
      getRoomNode: () => undefined,
    }),
  }
  const bridge = createSekai64TextureSurfaceBridge(adapter)
  const dynamic = bridge.createDynamicTexture({ source: { width: 16, height: 16 } })
  const resolution = {
    resolved: true,
    kind: 'entity-slot',
    target: { type: 'entity-slot', entity: 'monitor', slot: 'screen' },
    entity: { id: 'monitor', primitiveIds: ['entity:monitor'], childIds: [], transform: {}, authoringId: 'monitor', type: 'model', sourcePath: '' },
    slot: { entityId: 'monitor', slot: 'screen', mesh: 'DisplayPanel', materialSlot: 0, uvSet: 0 },
  }
  const result = bridge.bindTarget({ primitive: primitive(), resolution, texture: dynamic.texture })
  assert.equal(result.ok, true)
  result.binding.setPresented(true)
  result.binding.setPresented(false)
  assert.deepEqual(visibility.at(-1), ['entity:surface', false])
  result.binding.dispose()
  assert.deepEqual(visibility.at(-1), ['entity:surface', false])
  dynamic.dispose(); bridge.dispose(); scene.dispose()
})

test('mesh targets resolve directly and unsupported UV sets fail without mutating materials', () => {
  const scene = new Scene()
  const geometry = new Geometry({
    positions: new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    uvs1: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
  })
  const original = new StandardMaterial({ baseColor: '#222222' })
  const screen = new Mesh({ id: 'screen', name: 'Panel', geometry, material: original })
  const monitor = new Node({ id: 'entity:monitor' }).add(screen)
  scene.add(monitor)
  const native = gpuRenderer()
  const adapter = {
    getNativeAccess: () => ({
      engine: { renderer: native }, scene,
      getPrimitiveNode: id => id === monitor.id ? monitor : undefined,
      getRoomNode: () => undefined,
    }),
  }
  const bridge = createSekai64TextureSurfaceBridge(adapter)
  const dynamic = bridge.createDynamicTexture({ source: { width: 32, height: 32 } })
  const entity = { id: 'monitor', primitiveIds: ['entity:monitor'], childIds: [], transform: {}, authoringId: 'monitor', type: 'model', sourcePath: '' }
  const good = bridge.bindTarget({
    primitive: primitive(),
    resolution: { resolved: true, kind: 'mesh', target: { type: 'mesh', entity: 'monitor', mesh: 'Panel', uvSet: 1 }, entity },
    texture: dynamic.texture,
  })
  assert.equal(good.ok, true)
  good.binding.setPresented(true)
  assert.equal(screen.material.baseColorTexCoord, 1)
  good.binding.dispose()
  assert.equal(screen.material, original)

  const bad = bridge.bindTarget({
    primitive: primitive(),
    resolution: { resolved: true, kind: 'mesh', target: { type: 'mesh', entity: 'monitor', mesh: 'Panel', uvSet: 2 }, entity },
    texture: dynamic.texture,
  })
  assert.equal(bad.ok, false)
  assert.equal(bad.code, 'ANYO_TEXTURE_UV_SET_UNSUPPORTED')
  assert.equal(screen.material, original)
  dynamic.dispose(); bridge.dispose(); scene.dispose()
})

test('curved mesh presentation applies advanced screen material and restores named glass overlay', () => {
  const scene = new Scene()
  const curved = new Geometry({
    positions: new Float32Array([-1, -1, 0, 0, -1, 0.2, 1, -1, 0, -1, 1, 0, 0, 1, 0.2, 1, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    uvs: new Float32Array([0, 0, 0.5, 0, 1, 0, 0, 1, 0.5, 1, 1, 1]),
    indices: new Uint16Array([0, 1, 4, 0, 4, 3, 1, 2, 5, 1, 5, 4]),
  })
  const screenOriginal = new StandardMaterial({ baseColor: '#111111' })
  const glassOriginal = new StandardMaterial({ baseColor: [0.5, 0.8, 1, 0.6], transparent: true })
  const screen = new Mesh({ id: 'screen', name: 'CurvedPanel', geometry: curved, material: screenOriginal })
  const glass = new Mesh({ id: 'glass', name: 'ScreenGlass', geometry: curved, material: glassOriginal })
  const monitor = new Node({ id: 'entity:monitor' }).add(screen, glass)
  scene.add(monitor)
  const native = gpuRenderer()
  const adapter = {
    getNativeAccess: () => ({
      engine: { renderer: native }, scene,
      getPrimitiveNode: id => id === monitor.id ? monitor : undefined,
      getRoomNode: () => undefined,
    }),
  }
  const bridge = createSekai64TextureSurfaceBridge(adapter)
  const dynamic = bridge.createDynamicTexture({ source: { width: 320, height: 180 } })
  const surfacePrimitive = {
    ...primitive(),
    webSurface: {
      presentation: {
        type: 'texture', side: 'double', transparent: true, opacity: 0.75,
        emissive: { color: '#66ccff', intensity: 3, useTexture: true },
        glass: { mesh: 'ScreenGlass', opacity: 0.2 },
      },
    },
  }
  const entity = { id: 'monitor', primitiveIds: ['entity:monitor'], childIds: [], transform: {}, authoringId: 'monitor', type: 'model', sourcePath: '' }
  const result = bridge.bindTarget({
    primitive: surfacePrimitive,
    resolution: { resolved: true, kind: 'mesh', target: { type: 'mesh', entity: 'monitor', mesh: 'CurvedPanel', materialSlot: 0, uvSet: 0 }, entity },
    texture: dynamic.texture,
  })
  assert.equal(result.ok, true)
  result.binding.setPresented(true)
  assert.equal(screen.material.side, 'double')
  assert.equal(screen.material.alphaMode, 'blend')
  assert.equal(screen.material.baseColor.a, 0.75)
  assert.equal(screen.material.emissiveIntensity, 3)
  assert.equal(screen.material.emissiveTexture, dynamic.texture)
  assert.notEqual(glass.material, glassOriginal)
  assert.equal(glass.material.alphaMode, 'blend')
  assert.equal(glass.material.baseColor.a, 0.2)
  result.binding.setPresented(false)
  assert.equal(screen.material, screenOriginal)
  assert.equal(glass.material, glassOriginal)
  result.binding.dispose()
  dynamic.dispose(); bridge.dispose(); scene.dispose()
})

test('materialSlot selects among repeated named mesh primitives', () => {
  const scene = new Scene()
  const geometry = new PlaneGeometry({ width: 1, height: 1 })
  const firstMaterial = new StandardMaterial({ baseColor: '#111111' })
  const secondMaterial = new StandardMaterial({ baseColor: '#222222' })
  const first = new Mesh({ id: 'panel-0', name: 'Panel', geometry, material: firstMaterial })
  const second = new Mesh({ id: 'panel-1', name: 'Panel', geometry, material: secondMaterial })
  const model = new Node({ id: 'entity:model' }).add(first, second)
  scene.add(model)
  const adapter = { getNativeAccess: () => ({ engine: { renderer: gpuRenderer() }, scene, getPrimitiveNode: id => id === model.id ? model : undefined, getRoomNode: () => undefined }) }
  const bridge = createSekai64TextureSurfaceBridge(adapter)
  const dynamic = bridge.createDynamicTexture({ source: { width: 16, height: 16 } })
  const entity = { id: 'model', primitiveIds: ['entity:model'], childIds: [], transform: {}, authoringId: 'model', type: 'model', sourcePath: '' }
  const result = bridge.bindTarget({ primitive: primitive(), resolution: { resolved: true, kind: 'mesh', target: { type: 'mesh', entity: 'model', mesh: 'Panel', materialSlot: 1 }, entity }, texture: dynamic.texture })
  assert.equal(result.ok, true)
  result.binding.setPresented(true)
  assert.equal(first.material, firstMaterial)
  assert.equal(second.material.baseColorTexture, dynamic.texture)
  result.binding.dispose(); dynamic.dispose(); bridge.dispose(); scene.dispose()
})

test('optional presentation decoration follows binding lifecycle without owning a scheduler', () => {
  const scene = new Scene()
  const geometry = new PlaneGeometry({ width: 1, height: 1 })
  const original = new StandardMaterial()
  const plane = new Mesh({ id: 'entity:surface', geometry, material: original })
  scene.add(plane)
  const camera = new PerspectiveCamera()
  const calls = []
  const adapter = {
    getNativeAccess: () => ({
      engine: { renderer: gpuRenderer() }, scene, camera,
      getPrimitiveNode: id => id === plane.id ? plane : undefined,
      getRoomNode: () => undefined,
    }),
  }
  const bridge = createSekai64TextureSurfaceBridge(adapter, {
    decorateBinding(context) {
      assert.equal(context.mesh, plane)
      assert.equal(context.originalMaterial, original)
      return {
        setPresented(value) { calls.push(['presented', value]) },
        update(deltaSeconds) { calls.push(['update', deltaSeconds]) },
        dispose() { calls.push(['dispose']) },
      }
    },
  })
  const dynamic = bridge.createDynamicTexture({ source: { width: 16, height: 16 } })
  const result = bridge.bindTarget({ primitive: primitive(), resolution: { resolved: true, kind: 'plane', target: { type: 'plane' }, primitive: primitive() }, texture: dynamic.texture })
  assert.equal(result.ok, true)
  result.binding.update(1)
  assert.deepEqual(calls, [])
  result.binding.setPresented(true)
  result.binding.update(0.25)
  result.binding.setPresented(false)
  result.binding.dispose()
  assert.deepEqual(calls, [['presented', true], ['update', 0.25], ['presented', false], ['dispose']])
  dynamic.dispose(); bridge.dispose(); scene.dispose(); camera.dispose()
})
