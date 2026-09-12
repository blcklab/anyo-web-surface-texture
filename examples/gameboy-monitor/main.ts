import { createWorld, explorableBuildingPreset } from '@blcklab/anyo'
import { createWebSurfaceAppRegistry } from '@blcklab/anyo/web-surface'
import { Sekai64Renderer } from '@blcklab/anyo/renderer-sekai64'
import { textureWebSurfacePlugin } from '../../src/index.js'
import { createSekai64TextureSurfaceBridge } from '../../src/sekai64/index.js'
import { createDemoFrameSource } from './demo-frame-source.js'
import { createGameBoyFramebufferApp } from './gameboy-app.js'

const canvas = document.querySelector<HTMLCanvasElement>('#world')
if (!canvas) throw new Error('Missing #world canvas.')

const registry = createWebSurfaceAppRegistry()
registry.register('gameboy-emulator', createGameBoyFramebufferApp(createDemoFrameSource))

const renderer = new Sekai64Renderer({ canvas, backend: 'auto', antialias: true })
const textureSurfaces = textureWebSurfacePlugin({
  registry,
  createBridge: createSekai64TextureSurfaceBridge,
  maxUploadsPerFrame: 2,
  maxFps: 60,
  diagnostics(diagnostic) { console.warn('[Texture Web Surface]', diagnostic) },
})

const world = createWorld({
  renderer,
  plugins: [
    ...explorableBuildingPreset(),
    textureSurfaces,
  ],
})

await world.load('./world.json')
world.start()
window.addEventListener('pagehide', () => world.dispose(), { once: true })
