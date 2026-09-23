import type {
  TextureSurfaceQualityMode,
  TextureSurfaceQualityOptions,
  TextureSurfaceQualityPreset,
  TextureSurfaceResolvedQuality,
  TextureSurfaceRegistrationOptions,
  TextureSurfaceResolution,
} from './types.js'

export const TEXTURE_SURFACE_QUALITY_PRESETS: Readonly<Record<TextureSurfaceQualityPreset, Readonly<TextureSurfaceResolution>>> = Object.freeze({
  low: Object.freeze({ width: 640, height: 360 }),
  balanced: Object.freeze({ width: 960, height: 540 }),
  hd: Object.freeze({ width: 1280, height: 720 }),
  'full-hd': Object.freeze({ width: 1920, height: 1080 }),
  qhd: Object.freeze({ width: 2560, height: 1440 }),
  ultra: Object.freeze({ width: 3840, height: 2160 }),
})

export function resolveTextureSurfaceQuality(
  options: TextureSurfaceQualityOptions | TextureSurfaceQualityMode | undefined = 'auto',
  environmentDevicePixelRatio = 1,
): TextureSurfaceResolvedQuality {
  const normalized = typeof options === 'string' ? { mode: options } : (options ?? {})
  const mode = normalized.mode ?? 'auto'
  const preset: TextureSurfaceQualityPreset = mode === 'auto' ? (normalized.autoPreset ?? 'balanced') : mode
  const presetResolution = TEXTURE_SURFACE_QUALITY_PRESETS[preset]
  const physical = normalized.resolution ?? presetResolution
  const width = positiveDimension(physical.width, 'quality resolution width')
  const height = positiveDimension(physical.height, 'quality resolution height')
  const requestedDpr = normalized.devicePixelRatio === 'auto' || normalized.devicePixelRatio === undefined
    ? environmentDevicePixelRatio
    : normalized.devicePixelRatio
  const maxDpr = positiveScale(normalized.maxDevicePixelRatio ?? 2, 'quality maxDevicePixelRatio')
  const deviceScale = Math.min(maxDpr, Math.max(1, positiveScale(requestedDpr || 1, 'quality devicePixelRatio')))
  const explicitLogical = normalized.logicalResolution
  const logicalWidth = explicitLogical
    ? positiveDimension(explicitLogical.width, 'quality logical width')
    : Math.max(1, Math.round(width / deviceScale))
  const logicalHeight = explicitLogical
    ? positiveDimension(explicitLogical.height, 'quality logical height')
    : Math.max(1, Math.round(height / deviceScale))
  const effectiveScale = Math.min(deviceScale, width / logicalWidth, height / logicalHeight)

  return Object.freeze({
    mode,
    preset,
    width,
    height,
    logicalWidth,
    logicalHeight,
    deviceScale: effectiveScale,
  })
}

export function textureSurfaceRegistrationForQuality(
  quality: TextureSurfaceQualityPreset | TextureSurfaceQualityOptions | TextureSurfaceQualityMode,
  overrides: Partial<TextureSurfaceRegistrationOptions> = {},
): Readonly<TextureSurfaceRegistrationOptions> {
  const resolved = resolveTextureSurfaceQuality(quality)
  return Object.freeze({
    width: resolved.width,
    height: resolved.height,
    label: `anyo-web-surface:${resolved.preset}`,
    flipY: true,
    colorSpace: 'srgb',
    minFilter: 'linear-mipmap-linear',
    magFilter: 'linear',
    mipmaps: 'generate',
    priority: resolved.preset === 'ultra' ? 120 : resolved.preset === 'qhd' ? 110 : resolved.preset === 'full-hd' ? 100 : resolved.preset === 'hd' ? 90 : resolved.preset === 'balanced' ? 80 : 70,
    ...overrides,
  })
}

/** Backward-compatible 1920x1080 preset. */
export const HD_UI_TEXTURE_SURFACE_OPTIONS: Readonly<TextureSurfaceRegistrationOptions> = Object.freeze({
  ...textureSurfaceRegistrationForQuality('full-hd'),
  label: 'anyo-web-surface:hd-ui',
})


/** Backward-compatible 1280x720 mobile-class preset. */
export const MOBILE_UI_TEXTURE_SURFACE_OPTIONS: Readonly<TextureSurfaceRegistrationOptions> = Object.freeze({
  ...textureSurfaceRegistrationForQuality('hd'),
  label: 'anyo-web-surface:mobile-ui',
  priority: 80,
})

function positiveDimension(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be a positive finite number.`)
  return Math.max(1, Math.round(value))
}

function positiveScale(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be a positive finite number.`)
  return value
}
