import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))

assert.equal(pkg.version, '1.0.1-rc.19')
assert.equal(pkg.author, 'Avelurs Tinio')
assert.equal(pkg.license, 'MIT')
assert.deepEqual(pkg.peerDependencies, {
  '@blcklab/anyo': '>=0.9.1-rc.16 <0.10.0 || >=0.10.0-rc.1 <1.0.0',
  '@blcklab/sekai64': '>=0.7.0 <0.8.0 || >=0.8.0-0 <0.9.0',
})
assert.deepEqual(Object.keys(pkg.dependencies ?? {}), [], 'Texture package must keep zero runtime dependencies.')
assert.deepEqual(Object.keys(pkg.exports).sort(), ['.', './package.json', './sekai64'])

const main = await import(new URL('dist/index.js', root))
assert.deepEqual(Object.keys(main).sort(), [
  'HD_UI_TEXTURE_SURFACE_OPTIONS',
  'MOBILE_UI_TEXTURE_SURFACE_OPTIONS',
  'SANDBOXED_TEXTURE_PROTOCOL',
  'TEXTURE_SURFACE_QUALITY_PRESETS',
  'TextureWebSurfaceRuntime',
  'createDomAccessibilityCompanionProvider',
  'createNativeBrowserTextureApp',
  'createSandboxedCanvasTextureCapability',
  'createTextureSurfaceCanvas',
  'isTextureWebSurfaceApp',
  'resolveTextureSurfaceQuality',
  'textureSurfaceRegistrationForQuality',
  'textureWebSurfacePlugin',
])

const sekai = await import(new URL('dist/sekai64/index.js', root))
assert.deepEqual(Object.keys(sekai).sort(), ['createSekai64TextureSurfaceBridge'])

const declarations = await readFile(new URL('dist/types.d.ts', root), 'utf8')
for (const name of [
  'TextureWebSurfaceApp',
  'TextureSurfaceInputEvent',
  'TextureSurfaceAccessibilityDescriptor',
  'TextureSurfacePerformanceState',
  'TextureSurfacePerformanceOptions',
  'TextureSurfaceQualityOptions',
  'TextureSurfaceNativeBrowserProvider',
  'TextureSurfaceBrowserBackedApp',
  'TextureSurfaceBrowserSource',
]) assert.ok(declarations.includes(name), `${name} must remain declared.`)

console.log('Verified Web Surface Texture 1.0.1-rc.19 runtime, type, peer, ownership, and subpath contracts.')
