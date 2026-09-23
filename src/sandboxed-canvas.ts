import type {
  TextureSurfaceCanvas,
  TextureSurfaceFrame,
  TextureSurfaceInputEvent,
  TextureSurfaceQualityMode,
  TextureSurfaceQualityOptions,
  TextureSurfaceRegistrationOptions,
  TextureWebSurfaceAppContext,
  TextureWebSurfaceAppInstance,
} from './types.js'

export const SANDBOXED_TEXTURE_PROTOCOL = 'anyo-sandboxed-texture@1' as const

export interface SandboxedTextureSurfaceAppOptions {
  readonly entryUrl: string
  readonly title?: string
  readonly sandbox?: readonly string[]
  readonly referrerPolicy?: ReferrerPolicy
  readonly texture?: TextureSurfaceRegistrationOptions
  readonly quality?: TextureSurfaceQualityOptions | TextureSurfaceQualityMode
  readonly readyTimeoutMs?: number
  readonly frameTimeoutMs?: number
}

export interface SandboxedTextureSurfaceCapability {
  readonly texture?: TextureSurfaceRegistrationOptions
  readonly quality?: TextureSurfaceQualityOptions | TextureSurfaceQualityMode
  createTextureSurface(
    canvas: TextureSurfaceCanvas,
    props: Readonly<Record<string, unknown>>,
    context: TextureWebSurfaceAppContext,
  ): Promise<TextureWebSurfaceAppInstance>
}

type TextureHostMessage =
  | { readonly protocol: typeof SANDBOXED_TEXTURE_PROTOCOL; readonly token: string; readonly type: 'init'; readonly width: number; readonly height: number; readonly logicalWidth: number; readonly logicalHeight: number; readonly deviceScale: number; readonly props: Readonly<Record<string, unknown>> }
  | { readonly protocol: typeof SANDBOXED_TEXTURE_PROTOCOL; readonly token: string; readonly type: 'frame'; readonly requestId: number; readonly frame: TextureSurfaceFrame; readonly props: Readonly<Record<string, unknown>> }
  | { readonly protocol: typeof SANDBOXED_TEXTURE_PROTOCOL; readonly token: string; readonly type: 'resize'; readonly width: number; readonly height: number }
  | { readonly protocol: typeof SANDBOXED_TEXTURE_PROTOCOL; readonly token: string; readonly type: 'props'; readonly props: Readonly<Record<string, unknown>> }
  | { readonly protocol: typeof SANDBOXED_TEXTURE_PROTOCOL; readonly token: string; readonly type: 'input'; readonly event: TextureSurfaceInputEvent }
  | { readonly protocol: typeof SANDBOXED_TEXTURE_PROTOCOL; readonly token: string; readonly type: 'active'; readonly active: boolean }
  | { readonly protocol: typeof SANDBOXED_TEXTURE_PROTOCOL; readonly token: string; readonly type: 'pause' | 'resume' | 'dispose' }

interface TextureClientMessage {
  readonly protocol?: unknown
  readonly token?: unknown
  readonly type?: unknown
  readonly requestId?: unknown
  readonly bitmap?: unknown
  readonly message?: unknown
}

interface PendingFrame {
  readonly resolve: () => void
  readonly reject: (error: Error) => void
  readonly timeout: ReturnType<typeof setTimeout>
}

export function createSandboxedCanvasTextureCapability(options: SandboxedTextureSurfaceAppOptions): SandboxedTextureSurfaceCapability {
  const entryUrl = validateUrl(options.entryUrl)
  const readyTimeoutMs = positiveTimeout(options.readyTimeoutMs ?? 5000, 'readyTimeoutMs')
  const frameTimeoutMs = positiveTimeout(options.frameTimeoutMs ?? 3000, 'frameTimeoutMs')
  const sandbox = options.sandbox ?? ['allow-scripts']

  return Object.freeze({
    ...(options.texture ? { texture: Object.freeze({ flipY: true, ...options.texture }) } : {}),
    ...(options.quality ? { quality: options.quality } : {}),
    async createTextureSurface(canvas: TextureSurfaceCanvas, props: Readonly<Record<string, unknown>>, context: TextureWebSurfaceAppContext) {
      if (typeof document === 'undefined' || typeof window === 'undefined') {
        throw new Error('Sandboxed texture companions require a browser document.')
      }
      const sink = createBitmapSink(canvas)
      const iframe = document.createElement('iframe')
      iframe.src = entryUrl
      iframe.title = options.title ?? 'Anyo texture surface renderer'
      iframe.setAttribute('sandbox', sandbox.join(' '))
      iframe.setAttribute('loading', 'eager')
      iframe.setAttribute('aria-hidden', 'true')
      iframe.setAttribute('tabindex', '-1')
      iframe.setAttribute('referrerpolicy', options.referrerPolicy ?? 'no-referrer')
      Object.assign(iframe.style, {
        position: 'fixed',
        width: '1px',
        height: '1px',
        left: '-10000px',
        top: '-10000px',
        opacity: '0',
        pointerEvents: 'none',
        border: '0',
      })
      document.body.append(iframe)

      const token = createToken()
      const pending = new Map<number, PendingFrame>()
      let requestId = 0
      let disposed = false
      let currentProps = props
      let resolveReady!: () => void
      let rejectReady!: (error: Error) => void
      const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject })
      const readyTimeout = setTimeout(() => rejectReady(new Error(`Sandboxed texture renderer did not become ready within ${readyTimeoutMs}ms.`)), readyTimeoutMs)

      const post = (message: TextureHostMessage): void => {
        if (disposed) return
        iframe.contentWindow?.postMessage(message, '*')
      }

      const cleanupPending = (error: Error): void => {
        for (const frame of pending.values()) {
          clearTimeout(frame.timeout)
          frame.reject(error)
        }
        pending.clear()
      }

      const onMessage = (event: MessageEvent<TextureClientMessage>): void => {
        if (event.source !== iframe.contentWindow) return
        const data = event.data
        if (!data || data.protocol !== SANDBOXED_TEXTURE_PROTOCOL || data.token !== token) return
        if (data.type === 'ready') {
          clearTimeout(readyTimeout)
          resolveReady()
          return
        }
        if (data.type === 'invalidate') {
          context.invalidate()
          return
        }
        if (data.type === 'error') {
          const message = typeof data.message === 'string' && data.message ? data.message : 'Sandboxed texture renderer reported an error.'
          rejectReady(new Error(message))
          cleanupPending(new Error(message))
          return
        }
        if (data.type !== 'frame' || !Number.isInteger(data.requestId)) return
        const frame = pending.get(data.requestId as number)
        if (!frame) return
        pending.delete(data.requestId as number)
        clearTimeout(frame.timeout)
        if (!isImageBitmap(data.bitmap)) {
          frame.reject(new Error('Sandboxed texture renderer returned a frame without an ImageBitmap.'))
          return
        }
        try {
          sink.draw(data.bitmap)
          data.bitmap.close()
          frame.resolve()
        } catch (error) {
          data.bitmap.close()
          frame.reject(error instanceof Error ? error : new Error(String(error)))
        }
      }

      const abort = (): void => {
        if (disposed) return
        disposed = true
        clearTimeout(readyTimeout)
        cleanupPending(new Error('Sandboxed texture renderer was aborted.'))
        window.removeEventListener('message', onMessage)
        try { post({ protocol: SANDBOXED_TEXTURE_PROTOCOL, token, type: 'dispose' }) } catch { /* best effort */ }
        iframe.src = 'about:blank'
        iframe.remove()
      }

      window.addEventListener('message', onMessage)
      context.signal.addEventListener('abort', abort, { once: true })

      try {
        await waitForLoad(iframe, context.signal)
        post({
          protocol: SANDBOXED_TEXTURE_PROTOCOL,
          token,
          type: 'init',
          width: canvas.width,
          height: canvas.height,
          logicalWidth: context.quality.logicalWidth,
          logicalHeight: context.quality.logicalHeight,
          deviceScale: context.quality.deviceScale,
          props: currentProps,
        })
        await ready
      } catch (error) {
        abort()
        throw error
      }

      return {
        async render(_props: Readonly<Record<string, unknown>>, frame: TextureSurfaceFrame) {
          if (disposed) return
          const id = ++requestId
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
              pending.delete(id)
              reject(new Error(`Sandboxed texture frame ${id} timed out after ${frameTimeoutMs}ms.`))
            }, frameTimeoutMs)
            pending.set(id, { resolve, reject, timeout })
            post({ protocol: SANDBOXED_TEXTURE_PROTOCOL, token, type: 'frame', requestId: id, frame, props: currentProps })
          })
        },
        update(nextProps: Readonly<Record<string, unknown>>) {
          currentProps = nextProps
          post({ protocol: SANDBOXED_TEXTURE_PROTOCOL, token, type: 'props', props: nextProps })
        },
        resize(width: number, height: number) {
          post({ protocol: SANDBOXED_TEXTURE_PROTOCOL, token, type: 'resize', width, height })
        },
        setActive(active: boolean) { post({ protocol: SANDBOXED_TEXTURE_PROTOCOL, token, type: 'active', active }) },
        pause() { post({ protocol: SANDBOXED_TEXTURE_PROTOCOL, token, type: 'pause' }) },
        resume() { post({ protocol: SANDBOXED_TEXTURE_PROTOCOL, token, type: 'resume' }) },
        handleInput(event: TextureSurfaceInputEvent) {
          post({ protocol: SANDBOXED_TEXTURE_PROTOCOL, token, type: 'input', event })
          return true
        },
        dispose() { abort() },
      }
    },
  })
}

function createBitmapSink(canvas: TextureSurfaceCanvas): { draw(bitmap: ImageBitmap): void } {
  const context = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  if (!context || typeof context.drawImage !== 'function') {
    throw new Error('Sandboxed texture companions require a 2D-capable canvas sink.')
  }
  return {
    draw(bitmap) {
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    },
  }
}

function waitForLoad(iframe: HTMLIFrameElement, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'))
  return new Promise((resolve, reject) => {
    const onLoad = () => { cleanup(); resolve() }
    const onAbort = () => { cleanup(); reject(new DOMException('Aborted', 'AbortError')) }
    const cleanup = () => {
      iframe.removeEventListener('load', onLoad)
      signal.removeEventListener('abort', onAbort)
    }
    iframe.addEventListener('load', onLoad, { once: true })
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function isImageBitmap(value: unknown): value is ImageBitmap {
  return typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap
}

function validateUrl(value: string): string {
  try { return new URL(value).href }
  catch { throw new TypeError('Sandboxed texture entry must be an absolute URL.') }
}

function positiveTimeout(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new TypeError(`${name} must be a positive finite number.`)
  return value
}

function createToken(): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid) return uuid
  return `anyo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}
