import type { TextureSurfaceRegistrationOptions } from './types.js'

/**
 * Stable high-definition defaults for text-heavy dashboards and websites.
 * The preset uses a single on-change GPU texture, correct canvas orientation,
 * trilinear minification, and generated mipmaps for oblique viewing.
 */
export const HD_UI_TEXTURE_SURFACE_OPTIONS: Readonly<TextureSurfaceRegistrationOptions> = Object.freeze({
  width: 1920,
  height: 1080,
  label: 'anyo-web-surface:hd-ui',
  flipY: true,
  colorSpace: 'srgb',
  minFilter: 'linear-mipmap-linear',
  magFilter: 'linear',
  mipmaps: 'generate',
  priority: 100,
})

/** Compact high-quality fallback for mobile-class devices. */
export const MOBILE_UI_TEXTURE_SURFACE_OPTIONS: Readonly<TextureSurfaceRegistrationOptions> = Object.freeze({
  width: 1280,
  height: 720,
  label: 'anyo-web-surface:mobile-ui',
  flipY: true,
  colorSpace: 'srgb',
  minFilter: 'linear-mipmap-linear',
  magFilter: 'linear',
  mipmaps: 'generate',
  priority: 80,
})
