import type { TextureWebSurfaceApp } from '../../src/index.js'

export const GAME_BOY_WIDTH = 160
export const GAME_BOY_HEIGHT = 144

/** Host-owned adapter. ROM bytes, saves, audio, and controls stay outside world JSON and this package. */
export interface GameBoyFrameSource {
  readonly rgba: Uint8ClampedArray
  runFrame(): void
  pause?(): void
  resume?(): void
  dispose(): void
}

export type CreateGameBoyFrameSource = () => GameBoyFrameSource | Promise<GameBoyFrameSource>

export function createGameBoyFramebufferApp(createFrameSource: CreateGameBoyFrameSource): TextureWebSurfaceApp {
  return {
    texture: {
      width: GAME_BOY_WIDTH,
      height: GAME_BOY_HEIGHT,
      minFilter: 'nearest',
      magFilter: 'nearest',
      mipmaps: 'none',
      colorSpace: 'srgb',
      label: 'gameboy-framebuffer',
    },

    mount(container) {
      container.innerHTML = `
        <div style="width:100%;height:100%;display:grid;place-items:center;padding:8%;background:#111827;color:#f8fafc;font:600 clamp(14px,3cqw,30px)/1.4 system-ui,sans-serif;text-align:center">
          Live GPU framebuffer unavailable.<br>Using the safe browser fallback.
        </div>
      `
      return { dispose() { container.replaceChildren() } }
    },

    async createTextureSurface(canvas) {
      const context = canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
      if (!context) throw new Error('A 2D canvas context is required for the Game Boy framebuffer adapter.')
      const frameSource = await createFrameSource()
      if (frameSource.rgba.length !== GAME_BOY_WIDTH * GAME_BOY_HEIGHT * 4) {
        frameSource.dispose()
        throw new Error(`Expected a ${GAME_BOY_WIDTH}×${GAME_BOY_HEIGHT} RGBA framebuffer.`)
      }
      const image = context.createImageData(GAME_BOY_WIDTH, GAME_BOY_HEIGHT)
      return {
        render() {
          frameSource.runFrame()
          image.data.set(frameSource.rgba)
          context.putImageData(image, 0, 0)
        },
        pause() { frameSource.pause?.() },
        resume() { frameSource.resume?.() },
        dispose() { frameSource.dispose() },
      }
    },
  }
}
