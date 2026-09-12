import type {
  TextureSurfaceDistanceTier,
  TextureSurfacePerformanceOptions,
  TextureSurfacePerformancePreset,
  TextureSurfacePerformanceState,
  TextureSurfaceThermalState,
} from './types.js'

export interface ResolvedTextureSurfacePerformanceOptions {
  readonly preset: TextureSurfacePerformancePreset
  readonly maxUploadsPerFrame: number
  readonly maxFps: number
  readonly maxSurfaces: number
  readonly maxTextureBytes: number
  readonly maxTextureBytesPerSurface: number
  readonly maxDiagnosticHistory: number
  readonly minResolutionScale: number
  readonly distanceTiers: readonly TextureSurfaceDistanceTier[]
  readonly pool: false | { readonly maxEntries: number; readonly maxBytes: number }
  readonly occlusion: false | { readonly mode: 'renderer-ray' | 'custom'; readonly intervalMs: number }
  readonly thermalIntervalMs: number
}

interface PresetDefaults {
  readonly maxUploadsPerFrame: number
  readonly maxFps: number
  readonly maxSurfaces: number
  readonly maxTextureBytes: number
  readonly maxTextureBytesPerSurface: number
  readonly distanceTiers: readonly TextureSurfaceDistanceTier[]
  readonly poolEntries: number
  readonly poolBytes: number
}

const MB = 1024 * 1024
const PRESETS: Record<TextureSurfacePerformancePreset, PresetDefaults> = {
  desktop: {
    maxUploadsPerFrame: 4, maxFps: 60, maxSurfaces: 64,
    maxTextureBytes: 256 * MB, maxTextureBytesPerSurface: 32 * MB,
    distanceTiers: [
      { maxDistance: 6, resolutionScale: 1, fpsScale: 1 },
      { maxDistance: 18, resolutionScale: 0.75, fpsScale: 0.5 },
      { maxDistance: 40, resolutionScale: 0.5, fpsScale: 0.25 },
      { maxDistance: Number.POSITIVE_INFINITY, resolutionScale: 0.35, fpsScale: 0.1, suspend: true },
    ],
    poolEntries: 8, poolBytes: 48 * MB,
  },
  mobile: {
    maxUploadsPerFrame: 2, maxFps: 30, maxSurfaces: 24,
    maxTextureBytes: 96 * MB, maxTextureBytesPerSurface: 12 * MB,
    distanceTiers: [
      { maxDistance: 4, resolutionScale: 0.8, fpsScale: 1 },
      { maxDistance: 12, resolutionScale: 0.55, fpsScale: 0.5 },
      { maxDistance: 24, resolutionScale: 0.4, fpsScale: 0.25 },
      { maxDistance: Number.POSITIVE_INFINITY, resolutionScale: 0.3, fpsScale: 0.1, suspend: true },
    ],
    poolEntries: 4, poolBytes: 16 * MB,
  },
  headset: {
    maxUploadsPerFrame: 3, maxFps: 45, maxSurfaces: 32,
    maxTextureBytes: 160 * MB, maxTextureBytesPerSurface: 20 * MB,
    distanceTiers: [
      { maxDistance: 4, resolutionScale: 1, fpsScale: 1 },
      { maxDistance: 10, resolutionScale: 0.7, fpsScale: 0.6 },
      { maxDistance: 22, resolutionScale: 0.45, fpsScale: 0.3 },
      { maxDistance: Number.POSITIVE_INFINITY, resolutionScale: 0.3, fpsScale: 0.1, suspend: true },
    ],
    poolEntries: 6, poolBytes: 32 * MB,
  },
  'battery-saver': {
    maxUploadsPerFrame: 1, maxFps: 20, maxSurfaces: 16,
    maxTextureBytes: 64 * MB, maxTextureBytesPerSurface: 8 * MB,
    distanceTiers: [
      { maxDistance: 3, resolutionScale: 0.65, fpsScale: 1 },
      { maxDistance: 9, resolutionScale: 0.45, fpsScale: 0.5 },
      { maxDistance: 18, resolutionScale: 0.3, fpsScale: 0.2 },
      { maxDistance: Number.POSITIVE_INFINITY, resolutionScale: 0.25, fpsScale: 0.05, suspend: true },
    ],
    poolEntries: 2, poolBytes: 8 * MB,
  },
}

export function resolvePerformanceOptions(
  options: TextureSurfacePerformanceOptions | undefined,
  legacyUploads: number | undefined,
  legacyFps: number | undefined,
): ResolvedTextureSurfacePerformanceOptions {
  const preset = options?.preset ?? 'desktop'
  const defaults = PRESETS[preset]
  const distanceTiers = normalizeDistanceTiers(options?.distanceTiers ?? defaults.distanceTiers)
  const pool = options?.pool === false ? false : {
    maxEntries: positiveInteger(options?.pool?.maxEntries ?? defaults.poolEntries, 'performance.pool.maxEntries'),
    maxBytes: positiveInteger(options?.pool?.maxBytes ?? defaults.poolBytes, 'performance.pool.maxBytes'),
  }
  const occlusion = options?.occlusion === false || options?.occlusion === undefined ? false : {
    mode: options.occlusion.mode ?? (options.occlusion.test ? 'custom' : 'renderer-ray'),
    intervalMs: positiveNumber(options.occlusion.intervalMs ?? 250, 'performance.occlusion.intervalMs'),
  }
  return Object.freeze({
    preset,
    maxUploadsPerFrame: positiveInteger(legacyUploads ?? defaults.maxUploadsPerFrame, 'maxUploadsPerFrame'),
    maxFps: Math.min(240, positiveInteger(legacyFps ?? defaults.maxFps, 'maxFps')),
    maxSurfaces: positiveInteger(options?.maxSurfaces ?? defaults.maxSurfaces, 'performance.maxSurfaces'),
    maxTextureBytes: positiveInteger(options?.maxTextureBytes ?? defaults.maxTextureBytes, 'performance.maxTextureBytes'),
    maxTextureBytesPerSurface: positiveInteger(options?.maxTextureBytesPerSurface ?? defaults.maxTextureBytesPerSurface, 'performance.maxTextureBytesPerSurface'),
    maxDiagnosticHistory: positiveInteger(options?.maxDiagnosticHistory ?? 256, 'performance.maxDiagnosticHistory'),
    minResolutionScale: unitInterval(options?.minResolutionScale ?? 0.25, 'performance.minResolutionScale'),
    distanceTiers,
    pool,
    occlusion,
    thermalIntervalMs: positiveNumber(options?.thermal?.intervalMs ?? 1000, 'performance.thermal.intervalMs'),
  })
}

export function selectDistanceTier(
  tiers: readonly TextureSurfaceDistanceTier[],
  distance: number,
): TextureSurfaceDistanceTier {
  return tiers.find(tier => distance <= tier.maxDistance) ?? tiers[tiers.length - 1] as TextureSurfaceDistanceTier
}

export function thermalMultipliers(state: TextureSurfaceThermalState): {
  readonly resolution: number
  readonly fps: number
  readonly suspend: boolean
} {
  switch (state) {
    case 'fair': return { resolution: 0.9, fps: 0.75, suspend: false }
    case 'serious': return { resolution: 0.65, fps: 0.5, suspend: false }
    case 'critical': return { resolution: 0.5, fps: 0, suspend: true }
    default: return { resolution: 1, fps: 1, suspend: false }
  }
}

export function textureBytes(width: number, height: number, mipmaps: 'none' | 'generate'): number {
  const base = Math.max(1, Math.round(width)) * Math.max(1, Math.round(height)) * 4
  return Math.ceil(base * (mipmaps === 'generate' ? 4 / 3 : 1))
}

export function fitResolutionScale(
  width: number,
  height: number,
  requestedScale: number,
  minimumScale: number,
  byteBudget: number,
  mipmaps: 'none' | 'generate',
): number {
  const requested = Math.max(minimumScale, Math.min(1, requestedScale))
  if (textureBytes(width * requested, height * requested, mipmaps) <= byteBudget) return requested
  const ratio = Math.sqrt(byteBudget / textureBytes(width, height, mipmaps))
  return Math.max(minimumScale, Math.min(requested, ratio))
}

function normalizeDistanceTiers(value: readonly TextureSurfaceDistanceTier[]): readonly TextureSurfaceDistanceTier[] {
  if (value.length === 0) throw new Error('performance.distanceTiers must contain at least one tier.')
  const tiers: TextureSurfaceDistanceTier[] = value.map(tier => Object.freeze({
    maxDistance: tier.maxDistance === Number.POSITIVE_INFINITY ? tier.maxDistance : positiveNumber(tier.maxDistance, 'distanceTier.maxDistance'),
    resolutionScale: unitInterval(tier.resolutionScale, 'distanceTier.resolutionScale'),
    fpsScale: unitInterval(tier.fpsScale, 'distanceTier.fpsScale'),
    ...(tier.suspend ? { suspend: true } : {}),
  })).sort((left, right) => left.maxDistance - right.maxDistance)
  if (tiers[tiers.length - 1]?.maxDistance !== Number.POSITIVE_INFINITY) {
    const last = tiers[tiers.length - 1] as TextureSurfaceDistanceTier
    tiers.push(Object.freeze({ ...last, maxDistance: Number.POSITIVE_INFINITY }))
  }
  return Object.freeze(tiers)
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`)
  return value
}

function positiveNumber(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive finite number.`)
  return value
}

function unitInterval(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0 || value > 1) throw new Error(`${name} must be greater than 0 and at most 1.`)
  return value
}
