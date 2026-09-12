import type { WebSurfacePresentation } from '@blcklab/anyo'
import type { TextureSurfaceCanvas, TextureSurfaceDiagnostic } from './types.js'

interface Canvas2DLike {
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void
  clearRect(x: number, y: number, width: number, height: number): void
  drawImage(source: CanvasImageSource, dx: number, dy: number, dWidth: number, dHeight: number): void
}

interface Affine2D { readonly a: number; readonly b: number; readonly c: number; readonly d: number; readonly e: number; readonly f: number }

export interface TextureSurfacePresentationState {
  readonly source: TextureSurfaceCanvas
  readonly output: TextureSurfaceCanvas
  readonly sourceWidth: number
  readonly sourceHeight: number
  readonly baseOutputWidth: number
  readonly baseOutputHeight: number
  readonly outputWidth: number
  readonly outputHeight: number
  readonly outputScale: number
  prepare(): TextureSurfaceCanvas
  mapUv(uv: readonly [number, number]): readonly [number, number] | null
  /** Changes only the uploaded texture resolution; the application framebuffer remains unchanged. */
  setOutputScale(scale: number): boolean
}

export function createTextureSurfacePresentation(
  source: TextureSurfaceCanvas,
  presentation: WebSurfacePresentation | undefined,
  canvasFactory: (width: number, height: number) => TextureSurfaceCanvas,
  diagnostics?: (diagnostic: TextureSurfaceDiagnostic) => void,
  primitiveId?: string,
): TextureSurfacePresentationState {
  const sourceWidth = positiveDimension(source.width)
  const sourceHeight = positiveDimension(source.height)
  const baseOutputWidth = positiveDimension(presentation?.resolution?.[0] ?? sourceWidth)
  const baseOutputHeight = positiveDimension(presentation?.resolution?.[1] ?? sourceHeight)
  const fit = presentation?.fit ?? 'stretch'
  const transform = presentation?.transform
  let outputScale = 1
  let outputWidth = baseOutputWidth
  let outputHeight = baseOutputHeight
  let output: TextureSurfaceCanvas | null = null
  let context: Canvas2DLike | null = null
  let matrix = presentationMatrix(sourceWidth, sourceHeight, outputWidth, outputHeight, fit, transform)
  let inverse = invert(matrix)
  let warned = false

  const needsStaging = (): boolean => outputScale !== 1
    || outputWidth !== sourceWidth || outputHeight !== sourceHeight
    || fit !== 'stretch' || !isIdentityTransform(transform)

  const ensureOutput = (): TextureSurfaceCanvas => {
    if (!needsStaging()) return source
    if (!output) {
      output = canvasFactory(outputWidth, outputHeight)
      context = get2d(output)
    }
    output.width = outputWidth
    output.height = outputHeight
    if (!context) {
      if (!warned) {
        warned = true
        diagnostics?.({
          severity: 'warning',
          code: 'ANYO_TEXTURE_PRESENTATION_CANVAS_UNAVAILABLE',
          message: 'Texture staging could not create a 2D surface; logical framebuffer resolution is used unchanged.',
          ...(primitiveId ? { primitiveId } : {}),
        })
      }
      return source
    }
    return output
  }

  const updateGeometry = (): void => {
    outputWidth = positiveDimension(baseOutputWidth * outputScale)
    outputHeight = positiveDimension(baseOutputHeight * outputScale)
    matrix = presentationMatrix(sourceWidth, sourceHeight, outputWidth, outputHeight, fit, transform)
    inverse = invert(matrix)
    if (output) {
      output.width = outputWidth
      output.height = outputHeight
    }
  }

  return Object.freeze({
    source,
    get output(): TextureSurfaceCanvas { return ensureOutput() },
    sourceWidth,
    sourceHeight,
    baseOutputWidth,
    baseOutputHeight,
    get outputWidth(): number { return needsStaging() && context === null && output !== null ? sourceWidth : outputWidth },
    get outputHeight(): number { return needsStaging() && context === null && output !== null ? sourceHeight : outputHeight },
    get outputScale(): number { return outputScale },
    prepare(): TextureSurfaceCanvas {
      const target = ensureOutput()
      if (target === source || !context) return source
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.clearRect(0, 0, outputWidth, outputHeight)
      context.setTransform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f)
      context.drawImage(source as CanvasImageSource, 0, 0, sourceWidth, sourceHeight)
      context.setTransform(1, 0, 0, 1, 0, 0)
      return target
    },
    mapUv(uv: readonly [number, number]): readonly [number, number] | null {
      if (!needsStaging()) return Object.freeze([clamp01(uv[0]), clamp01(uv[1])])
      if (!inverse) return null
      const outputX = uv[0] * outputWidth
      const outputY = (1 - uv[1]) * outputHeight
      const sourceX = inverse.a * outputX + inverse.c * outputY + inverse.e
      const sourceY = inverse.b * outputX + inverse.d * outputY + inverse.f
      if (sourceX < 0 || sourceY < 0 || sourceX > sourceWidth || sourceY > sourceHeight) return null
      return Object.freeze([clamp01(sourceX / sourceWidth), clamp01(1 - sourceY / sourceHeight)])
    },
    setOutputScale(scale: number): boolean {
      if (!Number.isFinite(scale) || scale <= 0 || scale > 1) throw new RangeError('Texture output scale must be greater than 0 and at most 1.')
      const normalized = Math.max(0.01, Math.min(1, scale))
      if (Math.abs(normalized - outputScale) <= 1e-6) return false
      outputScale = normalized
      updateGeometry()
      ensureOutput()
      return true
    },
  })
}

function presentationMatrix(
  sourceWidth: number,
  sourceHeight: number,
  outputWidth: number,
  outputHeight: number,
  fit: 'stretch' | 'contain' | 'cover',
  transform: WebSurfacePresentation['transform'] | undefined,
): Affine2D {
  let scaleX = outputWidth / sourceWidth
  let scaleY = outputHeight / sourceHeight
  if (fit !== 'stretch') {
    const uniform = fit === 'contain' ? Math.min(scaleX, scaleY) : Math.max(scaleX, scaleY)
    scaleX = uniform
    scaleY = uniform
  }
  const baseWidth = sourceWidth * scaleX
  const baseHeight = sourceHeight * scaleY
  const base: Affine2D = {
    a: scaleX, b: 0, c: 0, d: scaleY,
    e: (outputWidth - baseWidth) / 2,
    f: (outputHeight - baseHeight) / 2,
  }
  const userScaleX = transform?.scale?.[0] ?? 1
  const userScaleY = transform?.scale?.[1] ?? 1
  const rotation = ((transform?.rotation ?? 0) * Math.PI) / 180
  const cosine = Math.cos(rotation)
  const sine = Math.sin(rotation)
  const centerX = outputWidth / 2
  const centerY = outputHeight / 2
  const offsetX = (transform?.offset?.[0] ?? 0) * outputWidth
  const offsetY = (transform?.offset?.[1] ?? 0) * outputHeight
  const user = multiply(
    translation(centerX + offsetX, centerY + offsetY),
    multiply(
      { a: cosine * userScaleX, b: sine * userScaleX, c: -sine * userScaleY, d: cosine * userScaleY, e: 0, f: 0 },
      translation(-centerX, -centerY),
    ),
  )
  return multiply(user, base)
}

function multiply(left: Affine2D, right: Affine2D): Affine2D {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  }
}

function translation(x: number, y: number): Affine2D { return { a: 1, b: 0, c: 0, d: 1, e: x, f: y } }

function invert(value: Affine2D): Affine2D | null {
  const determinant = value.a * value.d - value.b * value.c
  if (Math.abs(determinant) <= 1e-12) return null
  return {
    a: value.d / determinant,
    b: -value.b / determinant,
    c: -value.c / determinant,
    d: value.a / determinant,
    e: (value.c * value.f - value.d * value.e) / determinant,
    f: (value.b * value.e - value.a * value.f) / determinant,
  }
}

function get2d(canvas: TextureSurfaceCanvas): Canvas2DLike | null {
  const candidate = canvas as TextureSurfaceCanvas & { getContext?: (kind: string) => unknown }
  const context = candidate.getContext?.('2d')
  if (!context || typeof context !== 'object') return null
  const value = context as Partial<Canvas2DLike>
  return typeof value.setTransform === 'function' && typeof value.clearRect === 'function' && typeof value.drawImage === 'function'
    ? value as Canvas2DLike
    : null
}

function isIdentityTransform(value: WebSurfacePresentation['transform'] | undefined): boolean {
  return !value
    || ((value.offset?.[0] ?? 0) === 0 && (value.offset?.[1] ?? 0) === 0
      && (value.scale?.[0] ?? 1) === 1 && (value.scale?.[1] ?? 1) === 1
      && (value.rotation ?? 0) === 0)
}

function positiveDimension(value: number): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError('Texture presentation dimensions must be positive finite values.')
  return Math.max(1, Math.round(value))
}

function clamp01(value: number): number { return Math.max(0, Math.min(1, value)) }
