import type { TextureSurfaceCanvas } from './types.js'

export function createTextureSurfaceCanvas(width: number, height: number): TextureSurfaceCanvas {
  assertDimension(width, 'width')
  assertDimension(height, 'height')
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    return canvas
  }
  throw new Error('Texture Web Surfaces require OffscreenCanvas or an HTML document canvas. Supply canvasFactory in non-browser environments.')
}

function assertDimension(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) throw new Error(`Texture surface ${name} must be a positive integer.`)
}
