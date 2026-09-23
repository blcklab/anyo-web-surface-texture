import type { CompiledPrimitive, CompiledWebSurface } from '@blcklab/anyo'
import { resolveTextureSurfaceQuality, textureSurfaceRegistrationForQuality } from './quality.js'
import type {
  TextureSurfaceCanvas,
  TextureSurfaceInputEvent,
  TextureSurfaceNativeBrowserProvider,
  TextureSurfaceQualityOptions,
  TextureSurfaceQualityMode,
  TextureWebSurfaceApp,
  TextureWebSurfaceAppContext,
} from './types.js'

/**
 * Adapts one generic host-provided browser context to the existing trusted
 * texture-app lifecycle. The package supplies no browser engine itself.
 */
export function createNativeBrowserTextureApp(
  primitive: CompiledPrimitive & { webSurface: CompiledWebSurface },
  provider: TextureSurfaceNativeBrowserProvider,
  options?: TextureSurfaceQualityOptions | TextureSurfaceQualityMode,
  resolvedUrl?: string,
): TextureWebSurfaceApp | null {
  const source = primitive.webSurface.source
  const url = resolvedUrl ?? (source.type === 'url' ? source.url : undefined)
  if (!url) return null
  try {
    if (provider.canPresent && !provider.canPresent(url)) return null
  } catch {
    return null
  }

  const resolution = primitive.webSurface.presentation?.resolution
  const quality = resolveTextureSurfaceQuality({
    ...(typeof options === 'string' ? { mode: options } : options),
    ...(resolution ? { resolution: { width: resolution[0], height: resolution[1] } } : {}),
  }, dpr())

  return Object.freeze({
    mount() { return { dispose() {} } },
    quality: {
      ...(typeof options === 'string' ? { mode: options } : options),
      resolution: { width: quality.width, height: quality.height },
      logicalResolution: { width: quality.logicalWidth, height: quality.logicalHeight },
      devicePixelRatio: quality.deviceScale,
      maxDevicePixelRatio: quality.deviceScale,
    },
    texture: textureSurfaceRegistrationForQuality(quality.preset, {
      width: quality.width,
      height: quality.height,
      label: `anyo-web-surface:browser:${primitive.id}`,
      priority: 100,
    }),
    async createTextureSurface(canvas: TextureSurfaceCanvas, _props: Readonly<Record<string, unknown>>, context: TextureWebSurfaceAppContext) {
      const surface = await provider.createSurface({
        primitiveId: primitive.id,
        url,
        canvas,
        width: quality.width,
        height: quality.height,
        logicalWidth: quality.logicalWidth,
        logicalHeight: quality.logicalHeight,
        deviceScale: quality.deviceScale,
        signal: context.signal,
        invalidate: context.invalidate,
      })
      let disposed = false
      await surface.resize?.({
        width: quality.width,
        height: quality.height,
        logicalWidth: quality.logicalWidth,
        logicalHeight: quality.logicalHeight,
        deviceScale: quality.deviceScale,
      })
      return {
        render() {},
        navigate: async (nextUrl: string) => {
          if (!surface.navigate) return
          await surface.navigate(nextUrl)
        },
        back: async () => { await surface.back?.() },
        forward: async () => { await surface.forward?.() },
        reload: async () => { await surface.reload?.() },
        resize: async () => {
          if (disposed) return
          await surface.resize?.({
            width: quality.width,
            height: quality.height,
            logicalWidth: quality.logicalWidth,
            logicalHeight: quality.logicalHeight,
            deviceScale: quality.deviceScale,
          })
        },
        setInputFocus(focused: boolean) { void surface.focus?.(focused) },
        handleInput(event: TextureSurfaceInputEvent) { return forwardBrowserInput(surface, event, quality) },
        pause() { void surface.suspend?.() },
        resume() { void surface.resume?.() },
        async dispose() {
          if (disposed) return
          disposed = true
          await surface.dispose()
        },
      }
    },
  })
}

function forwardBrowserInput(
  surface: Awaited<ReturnType<TextureSurfaceNativeBrowserProvider['createSurface']>>,
  event: TextureSurfaceInputEvent,
  quality: ReturnType<typeof resolveTextureSurfaceQuality>,
): boolean {
  if (event.type === 'pointer') {
    const x = event.pixel[0] * quality.logicalWidth / quality.width
    const y = event.pixel[1] * quality.logicalHeight / quality.height
    if (event.phase === 'wheel') {
      const delta = event.delta ?? [0, 0, 0]
      return surface.sendWheel?.({ x, y, deltaX: delta[0], deltaY: delta[1], deltaZ: delta[2], timestamp: event.timestamp }) !== false
    }
    return surface.sendPointer?.({
      phase: event.phase,
      x,
      y,
      button: event.button,
      buttons: event.buttons,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      timestamp: event.timestamp,
    }) !== false
  }
  if (event.type === 'keyboard') {
    return surface.sendKeyboard?.({
      phase: event.phase,
      key: event.key,
      code: event.code,
      repeat: event.repeat,
      modifiers: event.modifiers,
      timestamp: event.timestamp,
    }) !== false
  }
  if (event.type === 'text') return surface.sendText?.(event.text, event.inputType) !== false
  return false
}

function dpr(): number {
  const value = Number(globalThis.devicePixelRatio ?? 1)
  return Number.isFinite(value) && value > 0 ? value : 1
}
