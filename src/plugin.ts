import type {
  CompiledPrimitive,
  CompiledWebSurface,
  PluginRuntimeContext,
  WorldChange,
} from '@blcklab/anyo'
import {
  resolveWebSurfaceTarget,
  WebSurfaceRuntime,
  type WebSurfaceAppContext,
} from '@blcklab/anyo/web-surface'
import { createTextureSurfaceCanvas } from './canvas.js'
import { createNativeBrowserTextureApp } from './browser-provider.js'
import { resolveTextureSurfaceQuality } from './quality.js'
import { createDomAccessibilityCompanionProvider, resolveAccessibilityPreferences } from './accessibility.js'
import { createTextureSurfacePresentation, type TextureSurfacePresentationState } from './presentation.js'
import {
  fitResolutionScale, resolvePerformanceOptions, selectDistanceTierWithHysteresis, thermalMultipliers, textureBytes,
  type ResolvedTextureSurfacePerformanceOptions,
} from './performance.js'
import {
  isTextureWebSurfaceApp,
  type TextureSurfaceCanvas,
  type TextureSurfaceDiagnostic,
  type TextureSurfaceFrame,
  type TextureSurfaceAudioState,
  type TextureSurfaceAccessibilityCompanionHandle,
  type TextureSurfaceAccessibilityCompanionProvider,
  type TextureSurfaceAccessibilityControl,
  type TextureSurfaceAccessibilityDescriptor,
  type TextureSurfaceAccessibilityPreferences,
  type TextureSurfaceMaintenanceController,
  type TextureSurfacePerformanceState,
  type TextureSurfaceThermalState,
  type TextureSurfaceFocusRequest,
  type TextureSurfaceGamepadInputEvent,
  type TextureSurfaceKeyboardInputEvent,
  type TextureSurfaceTextInputRequest,
  type TextureSurfaceTouchControl,
  type TextureSurfaceTouchControlHandle,
  type TextureSurfaceVirtualKeyboardHandle,
  type TextureSurfaceHit,
  type TextureSurfaceHitTestRequest,
  type TextureSurfaceInputController,
  type TextureSurfaceBrowserController,
  type TextureSurfacePointerInputEvent,
  type TextureSurfacePointerPhase,
  type TextureSurfacePointerType,
  type TextureSurfaceRayInput,
  type TextureSurfaceRendererBridge,
  type TextureSurfaceRegistrationOptions,
  type TextureSurfaceTargetBinding,
  type TextureSurfaceRuntimeStats,
  type TextureWebSurfaceApp,
  type TextureWebSurfaceAppContext,
  type TextureWebSurfaceAppInstance,
  type TextureWebSurfacePlugin,
  type TextureWebSurfacePluginOptions,
} from './types.js'

interface MountedTextureSurface {
  primitive: CompiledPrimitive & { webSurface: CompiledWebSurface }
  app: TextureWebSurfaceApp
  instance: TextureWebSurfaceAppInstance
  canvas: TextureSurfaceCanvas
  presentation: TextureSurfacePresentationState
  presentationJson: string
  sourceKey: string
  bridge: TextureSurfaceRendererBridge
  dynamicTexture: ReturnType<TextureSurfaceRendererBridge['createDynamicTexture']>
  binding: TextureSurfaceTargetBinding
  controller: AbortController
  props: Readonly<Record<string, unknown>>
  propsJson: string
  active: boolean
  disposed: boolean
  dirtyVersion: number
  renderedVersion: number
  rendering: boolean
  lastRenderTime: number
  frame: number
  diagnosticCodes: Set<string>
  failed: boolean
  ready: boolean
  audioStateJson: string
  accessibilityDescriptor: TextureSurfaceAccessibilityDescriptor | null
  accessibilityHandle: TextureSurfaceAccessibilityCompanionHandle | null
  accessibilityStateJson: string
  running: boolean
  performance: TextureSurfacePerformanceState
  performanceStateJson: string
  textureBytes: number
  textureKey: string
  targetPrimitiveIds: readonly string[]
  lastOcclusionCheck: number
  targetPosition: readonly [number, number, number]
  textureOptions: TextureSurfaceRegistrationOptions
  distanceTierIndex: number
}

interface PooledDynamicTexture {
  readonly key: string
  readonly bytes: number
  readonly resource: ReturnType<TextureSurfaceRendererBridge['createDynamicTexture']>
  lastUsed: number
}

const DEFAULT_RESOLUTION = Object.freeze({
  width: 512, height: 512,
  colorSpace: 'srgb' as const,
  minFilter: 'linear-mipmap-linear' as const,
  magFilter: 'linear' as const,
  mipmaps: 'generate' as const,
})

export function textureWebSurfacePlugin(options: TextureWebSurfacePluginOptions): TextureWebSurfacePlugin {
  let runtime: TextureWebSurfaceRuntime | null = null
  let fallback: WebSurfaceRuntime | null = null
  let currentContext: PluginRuntimeContext | null = null
  let fallbackSync: Promise<void> = Promise.resolve()
  let stopPresentationListener: (() => void) | null = null
  let finalDisposed = false
  let generation = 0

  const emptyStats = Object.freeze({
    mounted: 0,
    active: 0,
    visible: 0,
    suspended: 0,
    uploads: 0,
    skippedByBudget: 0,
    skippedByDistance: 0,
    skippedByOcclusion: 0,
    skippedByThermal: 0,
    textureBytes: 0,
    pooledTextureBytes: 0,
    pooledTextures: 0,
    diagnosticHistory: 0,
  })

  const input: TextureSurfaceInputController = Object.freeze({
    dispatchRay(value: TextureSurfaceRayInput) { return runtime?.input.dispatchRay(value) ?? false },
    focus(primitiveId: string, request?: TextureSurfaceFocusRequest) { return runtime?.input.focus(primitiveId, request) ?? false },
    blur(primitiveId?: string) { runtime?.input.blur(primitiveId) },
    get focusedPrimitiveId() { return runtime?.input.focusedPrimitiveId ?? null },
  })

  const browser: TextureSurfaceBrowserController = Object.freeze({
    canControl(primitiveId: string) { return runtime?.browser.canControl(primitiveId) ?? false },
    navigate(primitiveId: string, url: string) { return runtime?.browser.navigate(primitiveId, url) ?? Promise.resolve(false) },
    back(primitiveId: string) { return runtime?.browser.back(primitiveId) ?? Promise.resolve(false) },
    forward(primitiveId: string) { return runtime?.browser.forward(primitiveId) ?? Promise.resolve(false) },
    reload(primitiveId: string) { return runtime?.browser.reload(primitiveId) ?? Promise.resolve(false) },
  })

  const maintenance: TextureSurfaceMaintenanceController = Object.freeze({
    recover() { return runtime?.maintenance.recover() ?? Promise.resolve() },
    trimPool() { runtime?.maintenance.trimPool() },
    get stats() { return runtime?.maintenance.stats ?? emptyStats },
  })

  const syncFallback = (): void => {
    const targetRuntime = runtime
    const targetFallback = fallback
    const targetContext = currentContext
    const targetGeneration = generation
    if (!targetRuntime || !targetFallback || !targetContext) return
    fallbackSync = fallbackSync.catch(() => undefined).then(async () => {
      if (
        finalDisposed
        || generation !== targetGeneration
        || runtime !== targetRuntime
        || fallback !== targetFallback
        || currentContext !== targetContext
      ) return
      try {
        await targetFallback.sync(targetContext)
      } catch (error) {
        options.diagnostics?.({
          severity: 'warning',
          code: 'ANYO_TEXTURE_DOM_FALLBACK_SYNC_FAILED',
          message: 'DOM Web Surface fallback synchronization failed.',
          details: { error: error instanceof Error ? error.message : String(error) },
        })
      }
    })
  }

  const teardownWorld = (): void => {
    generation += 1
    stopPresentationListener?.()
    stopPresentationListener = null
    fallback?.dispose()
    fallback = null
    runtime?.dispose()
    runtime = null
    currentContext = null
    fallbackSync = Promise.resolve()
  }

  return {
    name: 'anyo:web-surface-texture',
    registry: options.registry,
    input,
    browser,
    maintenance,
    capabilities: Object.freeze({
      canvasApplications: true as const,
      planeTargets: true as const,
      entitySlotTargets: true as const,
      meshTargets: true as const,
      desktop: true as const,
      immersiveXR: true as const,
      domFallback: options.domFallback !== false,
      pointerInput: true as const,
      touchInput: true as const,
      xrRayInput: true as const,
      keyboardInput: true as const,
      gamepadInput: Boolean(options.input && options.input.getGamepads),
      audioFocus: true as const,
      virtualKeyboard: Boolean(options.input && options.input.virtualKeyboard),
      touchControls: Boolean(options.input && options.input.touchControls),
      curvedTargets: true as const,
      textureTransforms: true as const,
      advancedMaterials: true as const,
      accessibilityCompanion: options.accessibility !== false,
      reducedMotion: true as const,
      semanticControls: true as const,
      performanceBudgets: true as const,
      distanceScaling: true as const,
      texturePooling: options.performance?.pool !== false,
      occlusionSuspension: Boolean(options.performance?.occlusion),
      nativeBrowserProvider: Boolean(options.browserProvider),
    }),
    async setup(context) {
      if (finalDisposed) throw new Error('Texture Web Surface plugin is disposed.')
      teardownWorld()
      const setupGeneration = generation
      const nextRuntime = new TextureWebSurfaceRuntime(options)
      runtime = nextRuntime
      currentContext = context
      stopPresentationListener = nextRuntime.onPresentationChange(syncFallback)
      try {
        await nextRuntime.setup(context)
        if (generation !== setupGeneration || runtime !== nextRuntime || finalDisposed) return
        if (options.domFallback !== false) {
          const fallbackOptions = options.domFallback ?? {}
          const nextFallback = new WebSurfaceRuntime({
            ...fallbackOptions,
            registry: options.registry,
            shouldPresent: primitive => nextRuntime.shouldPresentDomFallback(primitive),
            onDiagnostic(diagnostic) {
              fallbackOptions.onDiagnostic?.(diagnostic)
              options.diagnostics?.({
                severity: diagnostic.severity,
                code: diagnostic.code,
                message: diagnostic.message,
                ...(diagnostic.primitiveId ? { primitiveId: diagnostic.primitiveId } : {}),
                ...(diagnostic.details ? { details: diagnostic.details } : {}),
              })
            },
          })
          fallback = nextFallback
          await nextFallback.sync(context)
        }
      } catch (error) {
        if (runtime === nextRuntime) teardownWorld()
        throw error
      }
    },
    update(deltaSeconds, context) {
      currentContext = context
      runtime?.update(deltaSeconds, context)
      fallback?.update(context)
    },
    async applyChanges(changes, context) {
      currentContext = context
      await runtime?.applyChanges(changes, context)
      await fallbackSync
      await fallback?.sync(context)
    },
    teardown() { teardownWorld() },
    dispose() {
      if (finalDisposed) return
      finalDisposed = true
      teardownWorld()
    },
  }
}

export class TextureWebSurfaceRuntime {
  private readonly mounted = new Map<string, MountedTextureSurface>()
  private readonly maxUploadsPerFrame: number
  private readonly maxFps: number
  private readonly performanceOptions: ResolvedTextureSurfacePerformanceOptions
  private readonly now: () => number
  private bridge: TextureSurfaceRendererBridge | null = null
  private context: PluginRuntimeContext | null = null
  private worldActive = true
  private disposed = false
  private uploads = 0
  private skippedByBudget = 0
  private skippedByDistance = 0
  private skippedByOcclusion = 0
  private skippedByThermal = 0
  private worldCleanups: Array<() => void> = []
  private readonly reportedDiagnostics = new Set<string>()
  private readonly diagnosticOrder: string[] = []
  private scheduleCursor = 0
  private readonly presentationListeners = new Set<() => void>()
  private readonly inputCleanups: Array<() => void> = []
  private readonly captures = new Map<number, string>()
  private readonly pointerDown = new Map<number, string>()
  private readonly lastPointerHit = new Map<number, { surfaceId: string; hit: TextureSurfaceHit }>()
  private hoveredSurfaceId: string | null = null
  private focusedSurfaceId: string | null = null
  private userGesture = false
  private readonly pressedKeys = new Map<string, { key: string; code: string; modifiers: { alt: boolean; ctrl: boolean; meta: boolean; shift: boolean } }>()
  private readonly touchControlsBySurface = new Map<string, readonly TextureSurfaceTouchControl[]>()
  private virtualKeyboardHandle: TextureSurfaceVirtualKeyboardHandle | null = null
  private touchControlHandle: TextureSurfaceTouchControlHandle | null = null
  private gamepadSnapshotJson = ''
  private readonly accessibilityProvider: TextureSurfaceAccessibilityCompanionProvider | null
  private readonly accessibilityPreferencesSource: ReturnType<typeof resolveAccessibilityPreferences>
  private accessibilityPreferences: TextureSurfaceAccessibilityPreferences
  private readonly texturePool: PooledDynamicTexture[] = []
  private thermalState: TextureSurfaceThermalState = 'nominal'
  private lastThermalCheck = Number.NEGATIVE_INFINITY
  private recovering: Promise<void> | null = null
  readonly input: TextureSurfaceInputController
  readonly browser: TextureSurfaceBrowserController
  readonly maintenance: TextureSurfaceMaintenanceController

  constructor(private readonly options: TextureWebSurfacePluginOptions) {
    this.performanceOptions = resolvePerformanceOptions(options.performance, options.maxUploadsPerFrame, options.maxFps)
    this.maxUploadsPerFrame = this.performanceOptions.maxUploadsPerFrame
    this.maxFps = this.performanceOptions.maxFps
    this.now = options.now ?? (() => typeof performance !== 'undefined' ? performance.now() : Date.now())
    const accessibilityOptions = options.accessibility === false ? undefined : options.accessibility
    this.accessibilityProvider = options.accessibility === false
      ? null
      : accessibilityOptions?.provider ?? (typeof document !== 'undefined'
        ? createDomAccessibilityCompanionProvider({
          ...(accessibilityOptions?.root ? { root: accessibilityOptions.root } : {}),
          ...(accessibilityOptions?.mode ? { mode: accessibilityOptions.mode } : {}),
        })
        : null)
    this.accessibilityPreferencesSource = resolveAccessibilityPreferences(accessibilityOptions)
    this.accessibilityPreferences = Object.freeze({
      reducedMotion: this.accessibilityPreferencesSource.reducedMotion,
      highContrast: this.accessibilityPreferencesSource.highContrast,
    })
    this.accessibilityPreferencesSource.subscribe(preferences => {
      this.accessibilityPreferences = Object.freeze({ ...preferences })
      for (const surface of this.mounted.values()) this.refreshAccessibilityPreferences(surface)
    })
    const runtime = this
    this.input = Object.freeze({
      dispatchRay(input: TextureSurfaceRayInput): boolean { return runtime.dispatchRay(input) },
      focus(primitiveId: string, request?: TextureSurfaceFocusRequest): boolean { return runtime.focus(primitiveId, request) },
      blur(primitiveId?: string): void { runtime.blur(primitiveId) },
      get focusedPrimitiveId(): string | null { return runtime.focusedSurfaceId },
    })
    this.browser = Object.freeze({
      canControl(primitiveId: string): boolean { return runtime.canControlBrowser(primitiveId) },
      navigate(primitiveId: string, url: string): Promise<boolean> { return runtime.invokeBrowserAction(primitiveId, 'navigate', url) },
      back(primitiveId: string): Promise<boolean> { return runtime.invokeBrowserAction(primitiveId, 'back') },
      forward(primitiveId: string): Promise<boolean> { return runtime.invokeBrowserAction(primitiveId, 'forward') },
      reload(primitiveId: string): Promise<boolean> { return runtime.invokeBrowserAction(primitiveId, 'reload') },
    })
    this.maintenance = Object.freeze({
      recover(): Promise<void> { return runtime.recover() },
      trimPool(): void { runtime.trimPool() },
      get stats(): TextureSurfaceRuntimeStats { return runtime.stats },
    })
  }

  private canControlBrowser(primitiveId: string): boolean {
    const instance = this.mounted.get(primitiveId)?.instance
    return Boolean(instance && (instance.navigate || instance.back || instance.forward || instance.reload))
  }

  private async invokeBrowserAction(
    primitiveId: string,
    action: 'navigate' | 'back' | 'forward' | 'reload',
    url?: string,
  ): Promise<boolean> {
    const surface = this.mounted.get(primitiveId)
    if (!surface || surface.disposed || surface.failed) return false
    const fn = surface.instance[action]
    if (typeof fn !== 'function') return false
    try {
      if (action === 'navigate') await (fn as (url: string) => void | Promise<void>).call(surface.instance, String(url ?? ''))
      else await (fn as () => void | Promise<void>).call(surface.instance)
      surface.dirtyVersion += 1
      return true
    } catch (error) {
      this.report({
        severity: 'warning',
        code: 'ANYO_TEXTURE_BROWSER_ACTION_FAILED',
        message: `Browser surface ${action}() failed.`,
        primitiveId,
        details: { error: error instanceof Error ? error.message : String(error) },
      })
      return false
    }
  }

  get stats(): TextureSurfaceRuntimeStats {
    let active = 0
    let visible = 0
    let suspended = 0
    let liveBytes = 0
    for (const surface of this.mounted.values()) {
      if (surface.running) active += 1
      if (surface.active) visible += 1
      if (surface.active && !surface.running) suspended += 1
      liveBytes += surface.textureBytes
    }
    return Object.freeze({
      mounted: this.mounted.size, active, visible, suspended, uploads: this.uploads,
      skippedByBudget: this.skippedByBudget, skippedByDistance: this.skippedByDistance,
      skippedByOcclusion: this.skippedByOcclusion, skippedByThermal: this.skippedByThermal,
      textureBytes: liveBytes, pooledTextureBytes: this.pooledTextureBytes(), pooledTextures: this.texturePool.length,
      diagnosticHistory: this.reportedDiagnostics.size,
    })
  }

  async recover(): Promise<void> {
    if (this.recovering) return this.recovering
    const context = this.context
    if (!context || this.disposed) return
    this.recovering = (async () => {
      for (const id of [...this.mounted.keys()]) this.unmount(id, false)
      this.trimPool()
      this.bridge?.dispose()
      this.bridge = this.options.createBridge(context.renderer)
      if (!this.bridge) {
        this.report({ severity: 'warning', code: 'ANYO_TEXTURE_RENDERER_UNAVAILABLE', message: 'Texture renderer recovery could not create a bridge.' })
        return
      }
      await context.renderer.whenIdle?.()
      await this.sync(context)
      await this.renderInitial()
    })().finally(() => { this.recovering = null })
    return this.recovering
  }

  trimPool(): void {
    for (const pooled of this.texturePool.splice(0)) pooled.resource.dispose()
  }

  private pooledTextureBytes(): number {
    return this.texturePool.reduce((total, entry) => total + entry.bytes, 0)
  }

  isTextureClaimed(primitiveId: string): boolean {
    const surface = this.mounted.get(primitiveId)
    return Boolean(surface && !surface.failed)
  }

  /**
   * Decide whether the managed DOM runtime may own presentation for one surface.
   *
   * A surface that explicitly requests native texture presentation is physical
   * world geometry. Falling back to a browser DOM overlay would break scene
   * depth/occlusion, so the renderer snapshot/plane stays authoritative when
   * no texture capability is available. Explicit dom-overlay/external/snapshot
   * modes keep their existing behavior.
   */
  shouldPresentDomFallback(primitive: CompiledPrimitive & { webSurface: CompiledWebSurface }): boolean {
    if (this.isTextureClaimed(primitive.id)) return false
    const definition = primitive.webSurface
    if (definition.source.type === 'snapshot') return true
    if (definition.presentation?.type === 'overlay') return true
    if (definition.renderMode === 'dom-overlay' || definition.renderMode === 'external' || definition.renderMode === 'snapshot') return true
    return definition.presentation?.type !== 'texture'
  }

  onPresentationChange(listener: () => void): () => void {
    this.presentationListeners.add(listener)
    return () => this.presentationListeners.delete(listener)
  }

  async setup(context: PluginRuntimeContext): Promise<void> {
    this.assertAlive()
    this.context = context
    this.bridge = this.options.createBridge(context.renderer)
    this.installWorldLifecycle(context)
    this.installPointerInput(context)
    this.worldCleanups.push(...this.accessibilityPreferencesSource.cleanups)
    if (!this.bridge) {
      this.report({ severity: 'warning', code: 'ANYO_TEXTURE_RENDERER_UNAVAILABLE', message: 'The active renderer does not provide a texture-surface bridge. Snapshot fallback remains active.' })
      return
    }
    await context.renderer.whenIdle?.()
    await this.sync(context)
    await this.renderInitial()
  }

  update(deltaSeconds: number, context: PluginRuntimeContext): void {
    if (this.disposed || !this.bridge) return
    this.context = context
    let budget = this.maxUploadsPerFrame
    const now = this.now()
    this.pollThermal(now)
    const surfaces = this.scheduledSurfaces()
    if (surfaces.length === 0) return
    const start = this.scheduleCursor % surfaces.length
    for (let offset = 0; offset < surfaces.length; offset += 1) {
      const surface = surfaces[(start + offset) % surfaces.length]
      if (!surface) continue
      this.refreshActive(surface, context)
      this.updatePerformance(surface, context, now)
      if (surface.running) surface.binding.update?.(deltaSeconds)
      if (!surface.running) {
        if (surface.active && surface.performance.reasons.includes('distance')) this.skippedByDistance += 1
        if (surface.active && surface.performance.reasons.includes('occlusion')) this.skippedByOcclusion += 1
        if (surface.active && surface.performance.reasons.includes('thermal')) this.skippedByThermal += 1
        continue
      }
      if (surface.rendering || !this.isDue(surface, now)) continue
      if (budget <= 0) {
        this.skippedByBudget += 1
        continue
      }
      budget -= 1
      this.startRender(surface, now, deltaSeconds, this.reason(surface))
    }
    this.scheduleCursor = (start + 1) % surfaces.length
    this.pollGamepads()
  }

  async applyChanges(_changes: readonly WorldChange[], context: PluginRuntimeContext): Promise<void> {
    if (this.disposed || !this.bridge) return
    this.context = context
    await context.renderer.whenIdle?.()
    await this.sync(context)
    await this.renderInitial()
  }

  dispose(): void {
    if (this.disposed) return
    for (const cleanup of this.worldCleanups.splice(0)) cleanup()
    for (const cleanup of this.inputCleanups.splice(0)) cleanup()
    this.clearInputState()
    for (const id of [...this.mounted.keys()]) this.unmount(id, false)
    this.trimPool()
    this.bridge?.dispose()
    this.bridge = null
    this.context = null
    this.disposed = true
  }

  private async sync(context: PluginRuntimeContext): Promise<void> {
    const eligible = context.compiled.primitives.filter(
      (primitive): primitive is CompiledPrimitive & { webSurface: CompiledWebSurface } => {
        if (!primitive.webSurface) return false
        // Explicit generic DOM/snapshot/external modes belong to the core runtime.
        // `auto` and legacy texture-oriented values remain eligible here.
        if (primitive.webSurface.presentation?.type === 'overlay'
          || primitive.webSurface.renderMode === 'dom-overlay'
          || primitive.webSurface.renderMode === 'snapshot'
          || primitive.webSurface.renderMode === 'external') return false
        const source = primitive.webSurface.source
        if (source.type === 'app') return true
        if (source.type !== 'url' || !this.options.browserProvider) return false
        try { return this.options.browserProvider.canPresent?.(source.url) !== false }
        catch (error) {
          this.reportOnce(undefined, primitive.id, 'ANYO_TEXTURE_BROWSER_PROVIDER_CAPABILITY_FAILED', {
            severity: 'warning',
            code: 'ANYO_TEXTURE_BROWSER_PROVIDER_CAPABILITY_FAILED',
            message: 'The host browser-provider capability check failed; DOM/iframe fallback remains available.',
            details: { error: error instanceof Error ? error.message : String(error) },
          })
          return false
        }
      },
    )
    const ids = new Set(eligible.map(surface => surface.id))
    for (const id of [...this.mounted.keys()]) if (!ids.has(id)) this.unmount(id)

    for (const primitive of eligible) {
      const source = primitive.webSurface.source
      if (source.type === 'snapshot') continue
      let sourceKey = source.type === 'app' ? `app:${source.app}` : `url:${source.url}`
      let app: TextureWebSurfaceApp | undefined
      if (source.type === 'app') {
        const registered = this.options.registry.get(source.app)
        if (isTextureWebSurfaceApp(registered)) {
          app = registered
        } else {
          const browserUrl = registeredBrowserSourceUrl(registered)
          if (browserUrl && this.options.browserProvider) {
            app = createNativeBrowserTextureApp(primitive, this.options.browserProvider, this.options.quality, browserUrl) ?? undefined
            if (app) sourceKey = `${sourceKey}:browser:${browserUrl}`
          }
          if (!app) {
            if (registered) {
              const physical = primitive.webSurface.presentation?.type === 'texture'
              this.reportOnce(undefined, primitive.id, 'ANYO_TEXTURE_APP_UNSUPPORTED', {
                severity: 'info',
                code: 'ANYO_TEXTURE_APP_UNSUPPORTED',
                message: physical
                  ? `Web-surface app "${source.app}" has no texture capability for this host. The physical renderer snapshot/plane remains active; DOM overlay fallback is intentionally suppressed to preserve scene depth.`
                  : `Web-surface app "${source.app}" has no texture capability for this host. DOM or snapshot presentation remains available.`,
                primitiveId: primitive.id,
                details: { physicalTextureRequested: physical, domFallbackAllowed: !physical },
              })
            }
            continue
          }
        }
      } else if (source.type === 'url' && this.options.browserProvider) {
        app = createNativeBrowserTextureApp(primitive, this.options.browserProvider, this.options.quality) ?? undefined
        if (!app) continue
      } else {
        continue
      }
      const existing = this.mounted.get(primitive.id)
      if (!existing) {
        await this.mount(primitive, app, sourceKey, context)
        continue
      }
      if (existing.sourceKey !== sourceKey) {
        this.unmount(primitive.id)
        await this.mount(primitive, app, sourceKey, context)
        continue
      }
      const presentationJson = JSON.stringify(primitive.webSurface.presentation ?? null)
      if (presentationJson !== existing.presentationJson) {
        this.unmount(primitive.id)
        await this.mount(primitive, app, sourceKey, context)
        continue
      }
      existing.primitive = primitive
      const updatedResolution = resolveWebSurfaceTarget(context.compiled, primitive)
      if (updatedResolution.resolved) {
        existing.targetPosition = targetPosition(updatedResolution, primitive)
        existing.targetPrimitiveIds = targetPrimitiveIds(updatedResolution, primitive.id)
      }
      const props = frozenProps(source.type === 'app' ? source.props : undefined)
      const propsJson = JSON.stringify(props)
      if (propsJson !== existing.propsJson) {
        existing.props = props
        existing.propsJson = propsJson
        this.setFailed(existing, false)
        existing.dirtyVersion += 1
        try {
          await existing.instance.update?.(props)
        } catch (error) {
          this.failSurface(existing, 'ANYO_TEXTURE_APP_UPDATE_FAILED', 'Texture surface update() failed.', error)
        }
        if (typeof existing.app.accessibility === 'function') {
          try { this.setAccessibilityDescriptor(existing, existing.app.accessibility(props)) }
          catch (error) {
            this.reportOnce(existing, existing.primitive.id, 'ANYO_TEXTURE_ACCESSIBILITY_INVALID', {
              severity: 'warning', code: 'ANYO_TEXTURE_ACCESSIBILITY_INVALID',
              message: 'The application returned invalid semantic accessibility data.',
              details: { error: error instanceof Error ? error.message : String(error) },
            })
          }
        }
      }
      this.refreshActive(existing, context)
    }
  }

  private async mount(
    primitive: CompiledPrimitive & { webSurface: CompiledWebSurface },
    app: TextureWebSurfaceApp,
    sourceKey: string,
    context: PluginRuntimeContext,
  ): Promise<void> {
    const bridge = this.bridge
    if (!bridge) return
    if (this.mounted.size >= this.performanceOptions.maxSurfaces) {
      this.reportOnce(undefined, primitive.id, 'ANYO_TEXTURE_SURFACE_LIMIT_REACHED', {
        severity: 'warning',
        code: 'ANYO_TEXTURE_SURFACE_LIMIT_REACHED',
        message: `The texture-surface limit (${this.performanceOptions.maxSurfaces}) was reached. DOM or snapshot fallback remains active.`,
      })
      return
    }
    const resolution = resolveWebSurfaceTarget(context.compiled, primitive)
    if (!resolution.resolved) {
      this.report({ severity: 'warning', code: resolution.code, message: resolution.message, primitiveId: primitive.id, details: resolution.details })
      return
    }
    if (resolution.kind === 'wall') {
      this.report({ severity: 'info', code: 'ANYO_TEXTURE_WALL_FALLBACK', message: 'Semantic wall targets are not bound natively yet; the existing plane or snapshot fallback remains active.', primitiveId: primitive.id })
      return
    }

    const textureOptions: TextureSurfaceRegistrationOptions = {
      ...DEFAULT_RESOLUTION,
      ...(this.options.defaultResolution ?? {}),
      ...(app.texture ?? {}),
    }
    const bw = positiveInteger(textureOptions.width, 'texture width')
    const bh = positiveInteger(textureOptions.height, 'texture height')
    const rasterScale = Math.min(2, Math.max(1, textureOptions.rasterScale ?? 1))
    const width = positiveInteger(bw * rasterScale, 'raster width')
    const height = positiveInteger(bh * rasterScale, 'raster height')
    const canvas = (this.options.canvasFactory ?? createTextureSurfaceCanvas)(width, height)
    canvas.width = width
    canvas.height = height
    const controller = new AbortController()
    const props = frozenProps(primitive.webSurface.source.type === 'app' ? primitive.webSurface.source.props : undefined)
    const quality = app.quality
      ? resolveTextureSurfaceQuality(app.quality, currentDevicePixelRatio())
      : resolveTextureSurfaceQuality({
          mode: 'auto',
          resolution: { width, height },
          logicalResolution: { width: bw, height: bh },
          devicePixelRatio: rasterScale,
          maxDevicePixelRatio: rasterScale,
        })
    let pendingAccessibility: TextureSurfaceAccessibilityDescriptor | null = null
    try { pendingAccessibility = resolveAccessibilityDescriptor(app, props) }
    catch (error) {
      this.reportOnce(undefined, primitive.id, 'ANYO_TEXTURE_ACCESSIBILITY_INVALID', {
        severity: 'warning', code: 'ANYO_TEXTURE_ACCESSIBILITY_INVALID',
        message: 'The application returned invalid semantic accessibility data.',
        details: { error: error instanceof Error ? error.message : String(error) },
      })
    }

    let presentation: TextureSurfacePresentationState
    try {
      const texturePresentation = primitive.webSurface.presentation?.type === 'texture' ? primitive.webSurface.presentation : undefined
      presentation = createTextureSurfacePresentation(
        canvas,
        texturePresentation,
        this.options.canvasFactory ?? createTextureSurfaceCanvas,
        diagnostic => this.report(diagnostic),
        primitive.id,
        rasterScale,
      )
    } catch (error) {
      controller.abort()
      this.reportOnce(undefined, primitive.id, 'ANYO_TEXTURE_PRESENTATION_INVALID', {
        severity: 'warning', code: 'ANYO_TEXTURE_PRESENTATION_INVALID',
        message: 'Texture presentation setup failed. Snapshot fallback remains active.', primitiveId: primitive.id,
        details: { error: error instanceof Error ? error.message : String(error) },
      })
      return
    }

    const position = targetPosition(resolution, primitive)
    const targetIds = targetPrimitiveIds(resolution, primitive.id)
    const now = this.now()
    this.pollThermal(now)
    const distance = vecDistance(rendererCameraPosition(context.renderer), position)
    const initialTierSelection = selectDistanceTierWithHysteresis(
      this.performanceOptions.distanceTiers, distance, undefined, this.performanceOptions.resolutionHysteresis,
    )
    const tier = initialTierSelection.tier
    const thermal = thermalMultipliers(this.thermalState)
    const requestedScale = Math.max(this.performanceOptions.minResolutionScale, tier.resolutionScale * thermal.resolution)
    const fit = this.fitScaleForMemory(
      presentation.baseOutputWidth,
      presentation.baseOutputHeight,
      requestedScale,
      textureOptions.mipmaps ?? 'none',
      0,
    )
    if (!fit) {
      controller.abort()
      this.reportOnce(undefined, primitive.id, 'ANYO_TEXTURE_MEMORY_BUDGET_EXCEEDED', {
        severity: 'warning', code: 'ANYO_TEXTURE_MEMORY_BUDGET_EXCEEDED',
        message: 'The texture could not fit inside the configured GPU-memory budget. DOM or snapshot fallback remains active.',
      })
      return
    }
    presentation.setOutputScale(fit.scale)
    const outputWidth = presentation.outputWidth
    const outputHeight = presentation.outputHeight
    const bytes = textureBytes(outputWidth, outputHeight, textureOptions.mipmaps ?? 'none')
    this.evictPoolUntil(this.liveTextureBytes() + bytes)
    if (bytes > this.performanceOptions.maxTextureBytesPerSurface
      || this.liveTextureBytes() + this.pooledTextureBytes() + bytes > this.performanceOptions.maxTextureBytes) {
      controller.abort()
      this.reportOnce(undefined, primitive.id, 'ANYO_TEXTURE_MEMORY_BUDGET_EXCEEDED', {
        severity: 'warning', code: 'ANYO_TEXTURE_MEMORY_BUDGET_EXCEEDED',
        message: 'The actual staging surface exceeded the configured GPU-memory budget. DOM or snapshot fallback remains active.',
        details: { width: outputWidth, height: outputHeight, bytes },
      })
      return
    }
    const performanceReasons: Array<'distance' | 'occlusion' | 'thermal' | 'memory'> = []
    if (tier.suspend) performanceReasons.push('distance')
    if (thermal.suspend) performanceReasons.push('thermal')
    if (fit.memoryLimited) performanceReasons.push('memory')
    const pendingPerformance: TextureSurfacePerformanceState = Object.freeze({
      distance,
      resolutionScale: fit.scale,
      fpsScale: Math.max(0, Math.min(1, tier.fpsScale * thermal.fps)),
      occluded: false,
      thermalState: this.thermalState,
      suspended: Boolean(tier.suspend || thermal.suspend),
      reasons: Object.freeze(performanceReasons),
    })

    let mounted: MountedTextureSurface | undefined
    const runtimeForInput = this
    const appContext: TextureWebSurfaceAppContext = {
      ...baseAppContext(context, primitive, controller.signal),
      canvas,
      backend: bridge.backend,
      quality,
      input: {
        requestFocus: request => mounted ? this.focus(mounted.primitive.id, request) : false,
        releaseFocus: () => { if (mounted) this.blur(mounted.primitive.id) },
        capturePointer: pointerId => mounted ? this.capture(pointerId, mounted.primitive.id) : false,
        releasePointer: pointerId => { if (mounted && this.captures.get(pointerId) === mounted.primitive.id) this.releaseCapture(pointerId) },
        requestTextInput: request => mounted ? this.requestTextInput(mounted.primitive.id, request) : false,
        closeTextInput: () => { if (mounted && this.focusedSurfaceId === mounted.primitive.id) this.closeTextInput() },
        setTouchControls: controls => { if (mounted) this.setTouchControls(mounted.primitive.id, controls) },
        get focused() { return Boolean(mounted && mounted.primitive.id === (runtimeForInput.focusedSurfaceId ?? null)) },
      },
      accessibility: {
        get reducedMotion() { return runtimeForInput.accessibilityPreferences.reducedMotion },
        get highContrast() { return runtimeForInput.accessibilityPreferences.highContrast },
        update: descriptor => {
          pendingAccessibility = freezeAccessibilityDescriptor(descriptor)
          if (mounted) this.setAccessibilityDescriptor(mounted, pendingAccessibility)
        },
        announce: (message, politeness) => {
          if (mounted) this.announceAccessibility(mounted, message, politeness)
        },
      },
      performance: {
        get state() { return mounted?.performance ?? pendingPerformance },
      },
      invalidate: () => {
        if (!mounted || mounted.disposed) return
        this.setFailed(mounted, false)
        mounted.dirtyVersion += 1
        this.refreshActive(mounted, this.context ?? context)
      },
    }
    let instance: TextureWebSurfaceAppInstance | undefined
    try {
      instance = await app.createTextureSurface(canvas, props, appContext)
      if (!instance || typeof instance.dispose !== 'function') {
        throw new Error('createTextureSurface() must return an instance with dispose().')
      }
      await instance.resize?.(width, height)
    } catch (error) {
      controller.abort()
      if (instance && typeof instance.dispose === 'function') {
        await safeDispose(instance, diagnostic => this.report({ ...diagnostic, primitiveId: primitive.id }))
      }
      this.reportOnce(undefined, primitive.id, 'ANYO_TEXTURE_APP_MOUNT_FAILED', {
        severity: 'warning', code: 'ANYO_TEXTURE_APP_MOUNT_FAILED',
        message: 'Texture surface application failed to mount. DOM or snapshot fallback remains active.',
        details: { error: error instanceof Error ? error.message : String(error) },
      })
      return
    }
    if (!instance) return

    const dynamicOptions = {
      source: presentation.output,
      label: textureOptions.label ?? `anyo-web-surface:${primitive.id}`,
      flipY: textureOptions.flipY ?? false,
      colorSpace: textureOptions.colorSpace ?? 'srgb',
      minFilter: textureOptions.minFilter ?? 'nearest',
      magFilter: textureOptions.magFilter ?? 'nearest',
      mipmaps: textureOptions.mipmaps ?? 'none',
    } as const
    const textureKey = dynamicTextureKey(textureOptions, outputWidth, outputHeight)
    let dynamicTexture: ReturnType<TextureSurfaceRendererBridge['createDynamicTexture']>
    try {
      dynamicTexture = await this.acquireDynamicTexture(textureKey, bytes, dynamicOptions)
    } catch (error) {
      controller.abort()
      await safeDispose(instance, diagnostic => this.report({ ...diagnostic, primitiveId: primitive.id }))
      this.reportOnce(undefined, primitive.id, 'ANYO_TEXTURE_RESOURCE_CREATE_FAILED', {
        severity: 'warning', code: 'ANYO_TEXTURE_RESOURCE_CREATE_FAILED',
        message: 'The renderer could not create a dynamic texture. Snapshot fallback remains active.',
        details: { error: error instanceof Error ? error.message : String(error) },
      })
      return
    }
    let bound: ReturnType<TextureSurfaceRendererBridge['bindTarget']>
    try {
      bound = bridge.bindTarget({ primitive, resolution, texture: dynamicTexture.texture })
    } catch (error) {
      controller.abort()
      await safeDispose(instance, diagnostic => this.report({ ...diagnostic, primitiveId: primitive.id }))
      dynamicTexture.dispose()
      this.reportOnce(undefined, primitive.id, 'ANYO_TEXTURE_TARGET_BIND_FAILED', {
        severity: 'warning', code: 'ANYO_TEXTURE_TARGET_BIND_FAILED',
        message: 'The renderer could not bind the texture target. Snapshot fallback remains active.',
        details: { error: error instanceof Error ? error.message : String(error) },
      })
      return
    }
    if (!bound.ok) {
      controller.abort()
      await safeDispose(instance, diagnostic => this.report({ ...diagnostic, primitiveId: primitive.id }))
      dynamicTexture.dispose()
      this.report({
        severity: bound.retryable ? 'warning' : 'error', code: bound.code, message: bound.message,
        primitiveId: primitive.id, ...(bound.details ? { details: bound.details } : {}),
      })
      return
    }
    const surface: MountedTextureSurface = {
      primitive, app, instance, canvas, presentation,
      presentationJson: JSON.stringify(primitive.webSurface.presentation ?? null),
      sourceKey,
      bridge, dynamicTexture, binding: bound.binding, controller, props,
      propsJson: JSON.stringify(props), active: false, disposed: false,
      dirtyVersion: 1, renderedVersion: 0, rendering: false,
      lastRenderTime: Number.NEGATIVE_INFINITY, frame: 0, diagnosticCodes: new Set(),
      failed: false, ready: false, audioStateJson: '', accessibilityDescriptor: pendingAccessibility,
      accessibilityHandle: null, accessibilityStateJson: '', running: false,
      performance: pendingPerformance, performanceStateJson: JSON.stringify(pendingPerformance),
      textureBytes: bytes, textureKey, targetPrimitiveIds: targetIds,
      lastOcclusionCheck: Number.NEGATIVE_INFINITY, targetPosition: position, textureOptions,
      distanceTierIndex: initialTierSelection.index,
    }
    mounted = surface
    this.mounted.set(primitive.id, surface)
    invoke(surface, 'setPerformanceState', () => instance.setPerformanceState?.(pendingPerformance), diagnostic => this.report(diagnostic))
    this.mountAccessibility(surface)
    this.refreshAccessibilityPreferences(surface)
    this.notifyPresentationChange()
    this.refreshActive(surface, context)
  }

  private async renderInitial(): Promise<void> {
    const now = this.now()
    const pending: Promise<void>[] = []
    let budget = this.maxUploadsPerFrame
    for (const surface of this.scheduledSurfaces()) {
      if (budget <= 0) {
        this.skippedByBudget += 1
        continue
      }
      if (!surface.running || surface.rendering || surface.renderedVersion > 0) continue
      budget -= 1
      const task = this.renderSurface(surface, now, 0, 'initial')
      if (task) pending.push(task)
    }
    await Promise.allSettled(pending)
  }

  private scheduledSurfaces(): MountedTextureSurface[] {
    return [...this.mounted.values()].sort((left, right) =>
      texturePriority(right.textureOptions) - texturePriority(left.textureOptions))
  }

  private startRender(surface: MountedTextureSurface, time: number, deltaSeconds: number, reason: TextureSurfaceFrame['reason']): void {
    const pending = this.renderSurface(surface, time, deltaSeconds, reason)
    void pending?.catch(error => this.failSurface(surface, 'ANYO_TEXTURE_RENDER_FAILED', 'Texture surface rendering failed.', error))
  }

  private renderSurface(
    surface: MountedTextureSurface,
    time: number,
    deltaSeconds: number,
    reason: TextureSurfaceFrame['reason'],
  ): Promise<void> | null {
    if (surface.rendering || surface.disposed) return null
    surface.rendering = true
    surface.frame += 1
    const version = surface.dirtyVersion
    const frame: TextureSurfaceFrame = Object.freeze({ time, deltaSeconds, frame: surface.frame, reason })
    return Promise.resolve().then(() => surface.instance.render?.(surface.props, frame)).then(() => {
      if (surface.disposed || surface.controller.signal.aborted) return
      const prepared = surface.presentation.prepare()
      surface.dynamicTexture.update(prepared)
      surface.textureBytes = textureBytes(prepared.width, prepared.height, surface.textureOptions.mipmaps ?? 'none')
      surface.textureKey = dynamicTextureKey(surface.textureOptions, prepared.width, prepared.height)
      this.setReady(surface, true)
      this.setFailed(surface, false)
      surface.lastRenderTime = time
      surface.renderedVersion = version
      this.uploads += 1
    }).catch(error => {
      this.failSurface(surface, 'ANYO_TEXTURE_RENDER_FAILED', 'Texture surface rendering failed.', error)
    }).finally(() => {
      surface.rendering = false
    })
  }

  private failSurface(surface: MountedTextureSurface, code: string, message: string, error: unknown): void {
    this.reportOnce(surface, surface.primitive.id, code, {
      severity: 'warning',
      code,
      message: `${message} Snapshot fallback was restored.`,
      primitiveId: surface.primitive.id,
      details: { error: error instanceof Error ? error.message : String(error) },
    })
    this.setReady(surface, false)
    this.setFailed(surface, true)
    this.setActive(surface, false)
  }

  private refreshActive(surface: MountedTextureSurface, context: PluginRuntimeContext): void {
    // Visibility/presentation ownership is independent from world pause. A paused
    // world keeps the last physical GPU frame presented; only updates/input stop.
    this.setActive(surface, !surface.failed && effectiveVisibility(surface.primitive, context))
  }

  private setActive(surface: MountedTextureSurface, active: boolean): void {
    const changed = surface.active !== active
    if (changed) {
      surface.active = active
      surface.binding.setPresented(active && surface.ready)
      this.refreshAccessibility(surface)
    }
    // World start/pause may change running state even when visibility is unchanged.
    this.refreshRunning(surface)
  }

  private refreshRunning(surface: MountedTextureSurface): void {
    // An unready visible surface is allowed to render one initial frame even while
    // world controls are paused, so physical screens never flash back to snapshots.
    const needsInitialFrame = surface.active && !surface.ready
    const running = surface.active && !surface.failed && !surface.performance.suspended
      && (this.worldActive || needsInitialFrame)
    if (surface.running === running) return
    surface.running = running
    invoke(surface, 'setActive', () => surface.instance.setActive?.(running), diagnostic => this.report(diagnostic))
    if (running) {
      surface.dirtyVersion += 1
      invoke(surface, 'resume', () => surface.instance.resume?.(), diagnostic => this.report(diagnostic))
    } else {
      this.releaseSurfaceInput(surface.primitive.id)
      invoke(surface, 'pause', () => surface.instance.pause?.(), diagnostic => this.report(diagnostic))
    }
    this.updateAudioState(surface)
    this.refreshAccessibility(surface)
  }

  private isDue(surface: MountedTextureSurface, now: number): boolean {
    const policy = surface.primitive.webSurface.framePolicy
    if (policy.mode === 'on-change') return surface.dirtyVersion !== surface.renderedVersion
    const fps = Math.min(this.maxFps, positiveInteger(policy.maxFps ?? 30, 'framePolicy.maxFps')) * surface.performance.fpsScale
    return fps > 0 && now - surface.lastRenderTime >= 1000 / fps
  }

  private reason(surface: MountedTextureSurface): TextureSurfaceFrame['reason'] {
    const mode = surface.primitive.webSurface.framePolicy.mode
    if (mode === 'continuous') return 'continuous'
    if (mode === 'fixed-rate') return 'fixed-rate'
    return 'dirty'
  }

  private unmount(id: string, allowPool = true): void {
    const surface = this.mounted.get(id)
    if (!surface) return
    const wasClaimed = !surface.failed
    this.mounted.delete(id)
    this.releaseSurfaceInput(id)
    surface.disposed = true
    surface.controller.abort()
    surface.binding.dispose()
    this.releaseDynamicTexture(surface, allowPool)
    try { surface.accessibilityHandle?.dispose() } catch { /* companion cleanup is best effort */ }
    surface.accessibilityHandle = null
    void safeDispose(surface.instance, diagnostic => this.report({ ...diagnostic, primitiveId: id }))
    if (wasClaimed) this.notifyPresentationChange()
  }

  private setReady(surface: MountedTextureSurface, ready: boolean): void {
    if (surface.ready === ready) return
    surface.ready = ready
    surface.binding.setPresented(surface.active && ready)
    this.refreshRunning(surface)
  }

  private setFailed(surface: MountedTextureSurface, failed: boolean): void {
    if (surface.failed === failed) return
    const wasClaimed = !surface.failed
    surface.failed = failed
    if (wasClaimed !== !failed) this.notifyPresentationChange()
  }

  private notifyPresentationChange(): void {
    for (const listener of this.presentationListeners) {
      try { listener() }
      catch (error) {
        this.report({
          severity: 'warning',
          code: 'ANYO_TEXTURE_PRESENTATION_LISTENER_FAILED',
          message: 'A texture-presentation coordination listener failed.',
          details: { error: error instanceof Error ? error.message : String(error) },
        })
      }
    }
  }

  private installPointerInput(context: PluginRuntimeContext): void {
    for (const cleanup of this.inputCleanups.splice(0)) cleanup()
    if (this.options.input === false) return
    const canvas = context.renderer.canvas
    if (!canvas || typeof canvas.addEventListener !== 'function') return
    if (this.options.input?.pointer !== false) {
      const on = <K extends keyof HTMLElementEventMap>(name: K, listener: (event: HTMLElementEventMap[K]) => void, options?: AddEventListenerOptions): void => {
        canvas.addEventListener(name, listener as EventListener, options)
        this.inputCleanups.push(() => canvas.removeEventListener(name, listener as EventListener, options))
      }
      on('pointermove', event => this.handleDomPointer('move', event))
      on('pointerdown', event => this.handleDomPointer('down', event))
      on('pointerup', event => this.handleDomPointer('up', event))
      on('pointercancel', event => this.handleDomPointer('cancel', event))
      on('pointerleave', event => this.handleCanvasLeave(event))
      const wheelTarget: EventTarget = canvas.ownerDocument ?? canvas
      const wheel = (event: Event): void => {
        if (wheelTarget !== canvas && event.target !== canvas) return
        this.handleWheel(event as WheelEvent)
      }
      wheelTarget.addEventListener('wheel', wheel, { capture: true, passive: false })
      this.inputCleanups.push(() => wheelTarget.removeEventListener('wheel', wheel, true))
    }
    const keyboardTarget = this.options.input?.keyboardTarget || canvas
    const keyDown = (event: Event): void => this.handleKeyboard('down', event as KeyboardEvent)
    const keyUp = (event: Event): void => this.handleKeyboard('up', event as KeyboardEvent)
    const blur = (): void => this.blur()
    keyboardTarget.addEventListener('keydown', keyDown)
    keyboardTarget.addEventListener('keyup', keyUp)
    keyboardTarget.addEventListener('blur', blur)
    this.inputCleanups.push(() => keyboardTarget.removeEventListener('keydown', keyDown))
    this.inputCleanups.push(() => keyboardTarget.removeEventListener('keyup', keyUp))
    this.inputCleanups.push(() => keyboardTarget.removeEventListener('blur', blur))
  }

  private handleKeyboard(phase: 'down' | 'up', event: KeyboardEvent): void {
    const surface = this.focusedSurfaceId ? this.mounted.get(this.focusedSurfaceId) : undefined
    if (!surface || !surface.running || surface.failed || !surface.primitive.webSurface.interaction.keyboard) return
    if (phase === 'down') this.markUserGesture()
    const modifiers = Object.freeze({ alt: event.altKey, ctrl: event.ctrlKey, meta: event.metaKey, shift: event.shiftKey })
    const input: TextureSurfaceKeyboardInputEvent = Object.freeze({
      type: 'keyboard', phase, primitiveId: surface.primitive.id, key: event.key, code: event.code,
      repeat: event.repeat, modifiers, timestamp: event.timeStamp,
    })
    if (phase === 'down') this.pressedKeys.set(event.code || event.key, { key: event.key, code: event.code, modifiers: { ...modifiers } })
    else this.pressedKeys.delete(event.code || event.key)
    const consumed = this.dispatchInput(surface, input)
    if (consumed || ((this.options.input && this.options.input.preventKeyboardDefault) ?? true)) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  private allowPointer(phase: Exclude<TextureSurfacePointerPhase, 'enter' | 'leave' | 'click' | 'wheel'>, event: PointerEvent): boolean {
    const allowed = this.options.input && this.options.input.pointerButtons
    if (!allowed || phase === 'cancel') return true
    if (phase !== 'move') return allowed.includes(event.button)
    return !event.buttons || allowed.some(button => (event.buttons & (button === 1 ? 4 : button === 2 ? 2 : 1 << button)) !== 0)
  }

  private handleDomPointer(phase: Exclude<TextureSurfacePointerPhase, 'enter' | 'leave' | 'click' | 'wheel'>, event: PointerEvent): void {
    if (this.disposed || !this.allowPointer(phase, event)) return
    const canvas = this.context?.renderer.canvas
    if (!canvas) return
    const pointerLocked = typeof document !== 'undefined' && document.pointerLockElement === canvas
    if (pointerLocked && !this.focusedSurfaceId) return
    const rect = canvas.getBoundingClientRect()
    const request: TextureSurfaceHitTestRequest = {
      type: 'screen',
      clientX: pointerLocked ? rect.left + rect.width / 2 : event.clientX,
      clientY: pointerLocked ? rect.top + rect.height / 2 : event.clientY,
    }
    const capturedId = this.captures.get(event.pointerId)
    const candidate = capturedId
      ? this.hitSpecific(capturedId, request) ?? this.lastCandidate(event.pointerId, capturedId)
      : this.pickSurface(request, 'pointer')

    if (phase === 'move' && !capturedId) this.updateHover(candidate, event.pointerId, domPointerType(event.pointerType), event.timeStamp)
    if (!candidate) {
      if (phase === 'cancel' || phase === 'up') this.releaseCapture(event.pointerId)
      return
    }
    this.lastPointerHit.set(event.pointerId, { surfaceId: candidate.surface.primitive.id, hit: candidate.hit })
    if (phase === 'down') {
      this.markUserGesture()
      this.pointerDown.set(event.pointerId, candidate.surface.primitive.id)
      this.focus(candidate.surface.primitive.id, { reason: 'pointer' })
      if ((this.options.input && this.options.input.captureOnPointerDown) ?? true) {
        this.capture(event.pointerId, candidate.surface.primitive.id)
        try { canvas.setPointerCapture?.(event.pointerId) } catch { /* browsers may reject synthetic pointers */ }
      }
      void this.context?.world.selectPrimitive({
        primitiveId: candidate.surface.primitive.id,
        ...(candidate.surface.primitive.entityId ? { entityId: candidate.surface.primitive.entityId } : {}),
        source: 'web-surface',
        point: candidate.hit.point,
      })
    }
    const consumed = this.dispatchPointer(candidate.surface, candidate.hit, {
      phase,
      pointerId: event.pointerId,
      pointerType: domPointerType(event.pointerType),
      button: event.button,
      buttons: event.buttons,
      captured: this.captures.get(event.pointerId) === candidate.surface.primitive.id,
      timestamp: event.timeStamp,
    })
    if (phase === 'up') {
      if (this.pointerDown.get(event.pointerId) === candidate.surface.primitive.id) {
        this.dispatchPointer(candidate.surface, candidate.hit, {
          phase: 'click', pointerId: event.pointerId, pointerType: domPointerType(event.pointerType),
          button: event.button, buttons: event.buttons, captured: true, timestamp: event.timeStamp,
        })
      }
      this.pointerDown.delete(event.pointerId)
      this.releaseCapture(event.pointerId)
    } else if (phase === 'cancel') {
      this.pointerDown.delete(event.pointerId)
      this.releaseCapture(event.pointerId)
    }
    if (consumed) event.preventDefault()
  }

  private handleCanvasLeave(event: PointerEvent): void {
    if (this.captures.has(event.pointerId)) return
    this.updateHover(null, event.pointerId, domPointerType(event.pointerType), event.timeStamp)
  }

  private handleWheel(event: WheelEvent): void {
    const canvas = this.context?.renderer.canvas
    const focusedId = this.focusedSurfaceId
    if (!canvas || !focusedId) return
    const surface = this.mounted.get(focusedId)
    if (!surface?.primitive.webSurface.interaction.scroll) return
    const rect = canvas.getBoundingClientRect()
    const pointerLocked = typeof document !== 'undefined' && document.pointerLockElement === canvas
    const request: TextureSurfaceHitTestRequest = {
      type: 'screen',
      clientX: pointerLocked ? rect.left + rect.width / 2 : event.clientX,
      clientY: pointerLocked ? rect.top + rect.height / 2 : event.clientY,
    }
    const candidate = this.hitSpecific(focusedId, request)
    if (!candidate) return
    this.dispatchPointer(candidate.surface, candidate.hit, {
      phase: 'wheel', pointerId: 0, pointerType: 'mouse', button: 0, buttons: 0,
      captured: false, timestamp: event.timeStamp, delta: [event.deltaX, event.deltaY, event.deltaZ],
    })
    if ((this.options.input && this.options.input.preventWheelDefault) ?? true) {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
    }
  }

  private dispatchRay(input: TextureSurfaceRayInput): boolean {
    if (this.disposed) return false
    const pointerId = input.pointerId ?? (input.pointerType === 'gaze' ? -2 : -1)
    const pointerType = input.pointerType ?? 'xr-controller'
    const request: TextureSurfaceHitTestRequest = { type: 'ray', origin: input.origin, direction: input.direction }
    if (input.phase === 'select') {
      this.markUserGesture()
      const candidate = this.pickSurface(request, 'pointer')
      if (!candidate) return false
      this.focus(candidate.surface.primitive.id, { reason: 'xr' })
      this.dispatchPointer(candidate.surface, candidate.hit, { phase: 'down', pointerId, pointerType, button: input.button ?? 0, buttons: input.buttons ?? 1, captured: false, timestamp: input.timestamp ?? this.now() })
      this.dispatchPointer(candidate.surface, candidate.hit, { phase: 'up', pointerId, pointerType, button: input.button ?? 0, buttons: 0, captured: false, timestamp: input.timestamp ?? this.now() })
      return this.dispatchPointer(candidate.surface, candidate.hit, { phase: 'click', pointerId, pointerType, button: input.button ?? 0, buttons: 0, captured: false, timestamp: input.timestamp ?? this.now() })
    }
    const mapped: 'move' | 'down' | 'up' | 'cancel' = input.phase
    const capturedId = this.captures.get(pointerId)
    const candidate = capturedId ? this.hitSpecific(capturedId, request) ?? this.lastCandidate(pointerId, capturedId) : this.pickSurface(request, 'pointer')
    if (mapped === 'move' && !capturedId) this.updateHover(candidate, pointerId, pointerType, input.timestamp ?? this.now())
    if (!candidate) return false
    if (mapped === 'down') {
      this.markUserGesture()
      this.pointerDown.set(pointerId, candidate.surface.primitive.id)
      this.focus(candidate.surface.primitive.id, { reason: 'xr' })
      if ((this.options.input && this.options.input.captureOnPointerDown) ?? true) this.capture(pointerId, candidate.surface.primitive.id)
    }
    const consumed = this.dispatchPointer(candidate.surface, candidate.hit, {
      phase: mapped, pointerId, pointerType, button: input.button ?? 0, buttons: input.buttons ?? (mapped === 'down' ? 1 : 0),
      captured: this.captures.get(pointerId) === candidate.surface.primitive.id, timestamp: input.timestamp ?? this.now(),
    })
    if (mapped === 'up' || mapped === 'cancel') {
      if (mapped === 'up' && this.pointerDown.get(pointerId) === candidate.surface.primitive.id) {
        this.dispatchPointer(candidate.surface, candidate.hit, { phase: 'click', pointerId, pointerType, button: input.button ?? 0, buttons: 0, captured: true, timestamp: input.timestamp ?? this.now() })
      }
      this.pointerDown.delete(pointerId)
      this.releaseCapture(pointerId)
    }
    return consumed
  }

  private pickSurface(request: TextureSurfaceHitTestRequest, purpose: 'pointer' | 'scroll'): { surface: MountedTextureSurface; hit: TextureSurfaceHit } | null {
    let closest: { surface: MountedTextureSurface; hit: TextureSurfaceHit } | null = null
    for (const surface of this.mounted.values()) {
      if (!surface.running || !surface.ready || !surface.binding.presented || surface.failed) continue
      const interaction = surface.primitive.webSurface.interaction
      if (purpose === 'pointer' ? !interaction.pointer : !interaction.scroll) continue
      const physicalHit = surface.binding.hitTest?.(request)
      const hit = physicalHit ? this.mapPresentationHit(surface, physicalHit) : null
      if (!hit || (closest && closest.hit.distance <= hit.distance)) continue
      closest = { surface, hit }
    }
    return closest
  }

  private hitSpecific(surfaceId: string, request: TextureSurfaceHitTestRequest): { surface: MountedTextureSurface; hit: TextureSurfaceHit } | null {
    const surface = this.mounted.get(surfaceId)
    if (!surface || !surface.running || !surface.ready || !surface.binding.presented || surface.failed) return null
    const physicalHit = surface.binding.hitTest?.(request)
    const hit = physicalHit ? this.mapPresentationHit(surface, physicalHit) : null
    return hit ? { surface, hit } : null
  }

  private lastCandidate(pointerId: number, surfaceId: string): { surface: MountedTextureSurface; hit: TextureSurfaceHit } | null {
    const previous = this.lastPointerHit.get(pointerId)
    const surface = this.mounted.get(surfaceId)
    return previous?.surfaceId === surfaceId && surface ? { surface, hit: previous.hit } : null
  }

  private mapPresentationHit(surface: MountedTextureSurface, hit: TextureSurfaceHit): TextureSurfaceHit | null {
    const mapped = surface.presentation.mapUv(hit.uv)
    if (!mapped) return null
    return Object.freeze({ ...hit, uv: mapped })
  }

  private dispatchPointer(surface: MountedTextureSurface, hit: TextureSurfaceHit, input: {
    phase: TextureSurfacePointerPhase
    pointerId: number
    pointerType: TextureSurfacePointerType
    button: number
    buttons: number
    captured: boolean
    timestamp: number
    delta?: readonly [number, number, number]
  }): boolean {
    const u = clamp01(hit.uv[0])
    const v = clamp01(hit.uv[1])
    const event: TextureSurfacePointerInputEvent = Object.freeze({
      type: 'pointer', phase: input.phase, primitiveId: surface.primitive.id,
      pointerId: input.pointerId, pointerType: input.pointerType, button: input.button, buttons: input.buttons,
      uv: Object.freeze([u, v]) as readonly [number, number],
      pixel: Object.freeze([u * surface.canvas.width, (1 - v) * surface.canvas.height]) as readonly [number, number],
      point: hit.point, normal: hit.normal, distance: hit.distance, captured: input.captured, timestamp: input.timestamp,
      ...(input.delta ? { delta: input.delta } : {}),
    })
    try { return surface.instance.handleInput?.(event) === true }
    catch (error) {
      this.reportOnce(surface, surface.primitive.id, 'ANYO_TEXTURE_INPUT_FAILED', {
        severity: 'warning', code: 'ANYO_TEXTURE_INPUT_FAILED', message: 'Texture surface input handling failed.',
        details: { error: error instanceof Error ? error.message : String(error) },
      })
      return false
    }
  }

  private updateHover(candidate: { surface: MountedTextureSurface; hit: TextureSurfaceHit } | null, pointerId: number, pointerType: TextureSurfacePointerType, timestamp: number): void {
    const nextId = candidate?.surface.primitive.id ?? null
    if (nextId === this.hoveredSurfaceId) return
    const previous = this.hoveredSurfaceId ? this.mounted.get(this.hoveredSurfaceId) : undefined
    const previousHit = this.lastPointerHit.get(pointerId)?.hit
    if (previous && previousHit) this.dispatchPointer(previous, previousHit, { phase: 'leave', pointerId, pointerType, button: -1, buttons: 0, captured: false, timestamp })
    this.hoveredSurfaceId = nextId
    if (candidate) this.dispatchPointer(candidate.surface, candidate.hit, { phase: 'enter', pointerId, pointerType, button: -1, buttons: 0, captured: false, timestamp })
  }

  private focus(primitiveId: string, request: TextureSurfaceFocusRequest = {}): boolean {
    const surface = this.mounted.get(primitiveId)
    const focusCapable = Boolean(surface && (
      surface.primitive.webSurface.interaction.keyboard
      || surface.primitive.webSurface.interaction.scroll
      || surface.app.devices?.gamepad
      || surface.app.devices?.audio
      || surface.app.devices?.textInput
      || surface.accessibilityDescriptor !== null
    ))
    if (!surface || !surface.running || surface.failed || !focusCapable) return false
    if (this.focusedSurfaceId === primitiveId) return true
    const previous = this.focusedSurfaceId ? this.mounted.get(this.focusedSurfaceId) : undefined
    if (previous) invoke(previous, 'setInputFocus', () => previous.instance.setInputFocus?.(false, request.reason ?? 'programmatic'), diagnostic => this.report(diagnostic))
    this.focusedSurfaceId = primitiveId
    invoke(surface, 'setInputFocus', () => surface.instance.setInputFocus?.(true, request.reason ?? 'programmatic'), diagnostic => this.report(diagnostic))
    try { this.context?.renderer.canvas.focus?.({ preventScroll: true }) } catch { /* focus is best effort */ }
    this.refreshTouchControls()
    this.updateAudioStates()
    if (previous) this.refreshAccessibility(previous)
    this.refreshAccessibility(surface)
    return true
  }

  private blur(primitiveId?: string): void {
    if (!this.focusedSurfaceId || (primitiveId && primitiveId !== this.focusedSurfaceId)) return
    const previous = this.mounted.get(this.focusedSurfaceId)
    this.focusedSurfaceId = null
    this.releasePressedKeys(previous)
    this.closeTextInput()
    this.closeTouchControls()
    if (previous) invoke(previous, 'setInputFocus', () => previous.instance.setInputFocus?.(false, 'programmatic'), diagnostic => this.report(diagnostic))
    this.updateAudioStates()
    if (previous) this.refreshAccessibility(previous)
  }

  private capture(pointerId: number, primitiveId: string): boolean {
    const surface = this.mounted.get(primitiveId)
    if (!surface || !surface.running || surface.failed) return false
    this.captures.set(pointerId, primitiveId)
    return true
  }

  private releaseCapture(pointerId: number): void {
    this.captures.delete(pointerId)
    this.lastPointerHit.delete(pointerId)
  }

  private releaseSurfaceInput(primitiveId: string): void {
    if (this.hoveredSurfaceId === primitiveId) this.hoveredSurfaceId = null
    if (this.focusedSurfaceId === primitiveId) this.blur(primitiveId)
    for (const [pointerId, id] of [...this.captures]) if (id === primitiveId) this.releaseCapture(pointerId)
    for (const [pointerId, id] of [...this.pointerDown]) if (id === primitiveId) this.pointerDown.delete(pointerId)
  }

  private clearInputState(): void {
    this.hoveredSurfaceId = null
    this.blur()
    this.captures.clear()
    this.pointerDown.clear()
    this.lastPointerHit.clear()
    this.releasePressedKeys()
    this.closeTextInput()
    this.closeTouchControls()
    this.updateAudioStates()
  }

  private dispatchInput(surface: MountedTextureSurface, event: Parameters<NonNullable<TextureWebSurfaceAppInstance['handleInput']>>[0]): boolean {
    try { return surface.instance.handleInput?.(event) === true }
    catch (error) {
      this.reportOnce(surface, surface.primitive.id, 'ANYO_TEXTURE_INPUT_FAILED', {
        severity: 'warning', code: 'ANYO_TEXTURE_INPUT_FAILED', message: 'Texture surface input handling failed.',
        details: { error: error instanceof Error ? error.message : String(error) },
      })
      return false
    }
  }

  private markUserGesture(): void {
    if (this.userGesture) return
    this.userGesture = true
    this.updateAudioStates()
  }

  private releasePressedKeys(surface = this.focusedSurfaceId ? this.mounted.get(this.focusedSurfaceId) : undefined): void {
    if (surface) {
      for (const value of this.pressedKeys.values()) {
        const event: TextureSurfaceKeyboardInputEvent = Object.freeze({
          type: 'keyboard', phase: 'up', primitiveId: surface.primitive.id, key: value.key, code: value.code,
          repeat: false, modifiers: Object.freeze({ ...value.modifiers }), timestamp: this.now(), synthetic: true,
        })
        this.dispatchInput(surface, event)
      }
    }
    this.pressedKeys.clear()
  }

  private requestTextInput(primitiveId: string, request: TextureSurfaceTextInputRequest = {}): boolean {
    const surface = this.mounted.get(primitiveId)
    const provider = this.options.input && this.options.input.virtualKeyboard
    if (!surface || this.focusedSurfaceId !== primitiveId || !surface.running || !surface.app.devices?.textInput || !provider) return false
    this.closeTextInput()
    const semanticText = surface.accessibilityDescriptor?.textInput
    const { label: semanticLabel, ...semanticRequest } = semanticText ?? {}
    const ariaLabel = request.ariaLabel ?? semanticLabel ?? surface.accessibilityDescriptor?.label
    this.virtualKeyboardHandle = provider.open({
      ...semanticRequest,
      ...request,
      ...(ariaLabel ? { ariaLabel } : {}),
      primitiveId,
      onText: (text, inputType) => {
        const current = this.mounted.get(primitiveId)
        if (!current || this.focusedSurfaceId !== primitiveId || !current.running) return
        this.dispatchInput(current, Object.freeze({ type: 'text', primitiveId, text, ...(inputType ? { inputType } : {}), timestamp: this.now() }))
      },
      onKey: (phase, key, code = key) => {
        const current = this.mounted.get(primitiveId)
        if (!current || this.focusedSurfaceId !== primitiveId || !current.running) return
        this.dispatchInput(current, Object.freeze({
          type: 'keyboard', phase, primitiveId, key, code, repeat: false,
          modifiers: Object.freeze({ alt: false, ctrl: false, meta: false, shift: false }), timestamp: this.now(), synthetic: true,
        }))
      },
      onClose: () => { this.virtualKeyboardHandle = null },
    })
    return true
  }

  private closeTextInput(): void {
    const handle = this.virtualKeyboardHandle
    this.virtualKeyboardHandle = null
    try { handle?.close() } catch { /* provider cleanup is best effort */ }
  }

  private setTouchControls(primitiveId: string, controls: readonly TextureSurfaceTouchControl[]): void {
    this.touchControlsBySurface.set(primitiveId, Object.freeze(controls.map(control => Object.freeze({ ...control }))))
    if (this.focusedSurfaceId === primitiveId) this.refreshTouchControls()
  }

  private refreshTouchControls(): void {
    this.closeTouchControls()
    const primitiveId = this.focusedSurfaceId
    const provider = this.options.input && this.options.input.touchControls
    if (!primitiveId || !provider) return
    const controls = this.touchControlsBySurface.get(primitiveId) ?? []
    if (controls.length === 0) return
    this.touchControlHandle = provider.show({
      primitiveId,
      controls,
      dispatch: (action, pressed) => {
        const surface = this.mounted.get(primitiveId)
        if (!surface || !surface.running || this.focusedSurfaceId !== primitiveId) return
        this.markUserGesture()
        this.dispatchInput(surface, Object.freeze({ type: 'control', primitiveId, action, pressed, source: 'touch', timestamp: this.now() }))
      },
    })
  }

  private closeTouchControls(): void {
    const handle = this.touchControlHandle
    this.touchControlHandle = null
    try { handle?.close() } catch { /* provider cleanup is best effort */ }
  }

  private pollGamepads(): void {
    const surface = this.focusedSurfaceId ? this.mounted.get(this.focusedSurfaceId) : undefined
    if (!surface || !surface.running || !surface.app.devices?.gamepad) {
      this.gamepadSnapshotJson = ''
      return
    }
    const provider = this.options.input && this.options.input.getGamepads
    if (!provider) {
      this.gamepadSnapshotJson = ''
      return
    }
    const gamepads = provider()
    const snapshots = gamepads.filter((value): value is NonNullable<typeof value> => Boolean(value)).map(gamepad => ({
      index: gamepad.index, id: gamepad.id, connected: gamepad.connected, mapping: gamepad.mapping,
      axes: [...gamepad.axes], buttons: gamepad.buttons.map(button => ({ pressed: button.pressed, touched: button.touched, value: button.value })),
      timestamp: gamepad.timestamp,
    }))
    const json = JSON.stringify(snapshots)
    if (json === this.gamepadSnapshotJson) return
    this.gamepadSnapshotJson = json
    for (const gamepad of snapshots) {
      const event: TextureSurfaceGamepadInputEvent = Object.freeze({
        type: 'gamepad', primitiveId: surface.primitive.id, index: gamepad.index, id: gamepad.id,
        connected: gamepad.connected, mapping: gamepad.mapping, axes: Object.freeze(gamepad.axes),
        buttons: Object.freeze(gamepad.buttons.map(button => Object.freeze(button))), timestamp: gamepad.timestamp,
      })
      this.dispatchInput(surface, event)
    }
  }

  private updateAudioStates(): void {
    for (const surface of this.mounted.values()) this.updateAudioState(surface)
  }

  private updateAudioState(surface: MountedTextureSurface): void {
    if (!surface.app.devices?.audio) return
    const focused = this.focusedSurfaceId === surface.primitive.id
    const state: TextureSurfaceAudioState = Object.freeze({
      focused,
      active: surface.running,
      allowedByUserGesture: this.userGesture,
      muted: !(focused && surface.running && this.userGesture),
    })
    const json = JSON.stringify(state)
    if (json === surface.audioStateJson) return
    surface.audioStateJson = json
    invoke(surface, 'setAudioState', () => surface.instance.setAudioState?.(state), diagnostic => this.report(diagnostic))
  }

  private pollThermal(now: number): void {
    const thermal = this.options.performance?.thermal
    if (!thermal || now - this.lastThermalCheck < this.performanceOptions.thermalIntervalMs) return
    this.lastThermalCheck = now
    try {
      const next = thermal.getState()
      if (!['nominal', 'fair', 'serious', 'critical'].includes(next)) throw new Error(`Unsupported thermal state: ${String(next)}`)
      this.thermalState = next
    } catch (error) {
      this.report({
        severity: 'warning', code: 'ANYO_TEXTURE_THERMAL_HOOK_FAILED',
        message: 'The host thermal-state hook failed; nominal policy remains active.',
        details: { error: error instanceof Error ? error.message : String(error) },
      })
      this.thermalState = 'nominal'
    }
  }

  private updatePerformance(surface: MountedTextureSurface, context: PluginRuntimeContext, now: number): void {
    const camera = rendererCameraPosition(context.renderer)
    const distance = vecDistance(camera, surface.targetPosition)
    const tierSelection = selectDistanceTierWithHysteresis(
      this.performanceOptions.distanceTiers, distance, surface.distanceTierIndex, this.performanceOptions.resolutionHysteresis,
    )
    surface.distanceTierIndex = tierSelection.index
    const tier = tierSelection.tier
    const thermal = thermalMultipliers(this.thermalState)
    let occluded = surface.performance.occluded
    if (this.performanceOptions.occlusion && now - surface.lastOcclusionCheck >= this.performanceOptions.occlusion.intervalMs) {
      surface.lastOcclusionCheck = now
      occluded = this.testOcclusion(surface, context, camera, distance)
    }
    const reasons: Array<'distance' | 'occlusion' | 'thermal' | 'memory'> = []
    if (tier.suspend) reasons.push('distance')
    if (occluded) reasons.push('occlusion')
    if (thermal.suspend) reasons.push('thermal')
    const requestedScale = Math.max(this.performanceOptions.minResolutionScale, tier.resolutionScale * thermal.resolution)
    const applied = this.applyResolutionScale(surface, requestedScale)
    if (applied.memoryLimited) reasons.push('memory')
    const next: TextureSurfacePerformanceState = Object.freeze({
      distance,
      resolutionScale: applied.scale,
      fpsScale: Math.max(0, Math.min(1, tier.fpsScale * thermal.fps)),
      occluded,
      thermalState: this.thermalState,
      suspended: Boolean(tier.suspend || occluded || thermal.suspend),
      reasons: Object.freeze(reasons),
    })
    const json = JSON.stringify(next)
    if (json === surface.performanceStateJson) return
    surface.performance = next
    surface.performanceStateJson = json
    invoke(surface, 'setPerformanceState', () => surface.instance.setPerformanceState?.(next), diagnostic => this.report(diagnostic))
    this.refreshRunning(surface)
  }

  private testOcclusion(
    surface: MountedTextureSurface,
    context: PluginRuntimeContext,
    cameraPosition: readonly [number, number, number],
    distance: number,
  ): boolean {
    const configured = this.options.performance?.occlusion
    if (!configured || distance <= 0.05) return false
    try {
      if ((configured.mode ?? (configured.test ? 'custom' : 'renderer-ray')) === 'custom') {
        return configured.test?.({
          primitiveId: surface.primitive.id, primitive: surface.primitive, cameraPosition,
          targetPosition: surface.targetPosition, distance, renderer: context.renderer,
          targetPrimitiveIds: surface.targetPrimitiveIds,
        }) ?? false
      }
      if (!context.renderer.pickRay) {
        this.reportOnce(surface, surface.primitive.id, 'ANYO_TEXTURE_OCCLUSION_UNAVAILABLE', {
          severity: 'info', code: 'ANYO_TEXTURE_OCCLUSION_UNAVAILABLE',
          message: 'Occlusion suspension requested, but the renderer has no pickRay() capability.',
        })
        return false
      }
      const direction = normalizeDirection(cameraPosition, surface.targetPosition)
      const hit = context.renderer.pickRay(cameraPosition, direction, { near: 0.05, far: distance + 0.1 })
      if (!hit || surface.targetPrimitiveIds.includes(hit.primitiveId)) return false
      return (hit.distance ?? Number.POSITIVE_INFINITY) < distance - 0.05
    } catch (error) {
      this.reportOnce(surface, surface.primitive.id, 'ANYO_TEXTURE_OCCLUSION_FAILED', {
        severity: 'warning', code: 'ANYO_TEXTURE_OCCLUSION_FAILED',
        message: 'Occlusion testing failed and was disabled for this check.',
        details: { error: error instanceof Error ? error.message : String(error) },
      })
      return false
    }
  }

  private applyResolutionScale(surface: MountedTextureSurface, requestedScale: number): { scale: number; memoryLimited: boolean } {
    const fit = this.fitScaleForMemory(
      surface.presentation.baseOutputWidth,
      surface.presentation.baseOutputHeight,
      requestedScale,
      surface.textureOptions.mipmaps ?? 'none',
      surface.textureBytes,
    )
    if (!fit) return { scale: surface.presentation.outputScale, memoryLimited: true }
    const changed = surface.presentation.setOutputScale(fit.scale)
    if (!changed) return fit
    // Do not call DynamicTexture.resize() here. That would replace the last good
    // frame with a blank intermediate source before the app has produced the
    // newly-sized frame. On browser GPU backends that transient blank canvas can
    // also be rejected as an invalid external image. Keep the previous texture
    // presented until the next render atomically updates it with prepare().
    surface.dirtyVersion += 1
    return fit
  }

  private fitScaleForMemory(
    width: number,
    height: number,
    requestedScale: number,
    mipmaps: 'none' | 'generate',
    currentBytes: number,
  ): { scale: number; memoryLimited: boolean } | null {
    const minimum = this.performanceOptions.minResolutionScale
    const requested = Math.max(minimum, Math.min(1, requestedScale))
    const liveWithoutCurrent = this.liveTextureBytes() - currentBytes
    const minimumBytes = textureBytes(width * minimum, height * minimum, mipmaps)
    this.evictPoolUntil(liveWithoutCurrent + minimumBytes)
    const available = Math.min(
      this.performanceOptions.maxTextureBytesPerSurface,
      this.performanceOptions.maxTextureBytes - liveWithoutCurrent - this.pooledTextureBytes(),
    )
    if (available < minimumBytes) return null
    const scale = fitResolutionScale(width, height, requested, minimum, available, mipmaps)
    return { scale, memoryLimited: scale + 1e-6 < requested }
  }

  private liveTextureBytes(): number {
    let bytes = 0
    for (const surface of this.mounted.values()) bytes += surface.textureBytes
    return bytes
  }

  private evictPoolUntil(requiredLiveBytes: number): void {
    const pool = this.performanceOptions.pool
    if (!pool) return
    this.texturePool.sort((left, right) => left.lastUsed - right.lastUsed)
    while (this.texturePool.length > 0 && requiredLiveBytes + this.pooledTextureBytes() > this.performanceOptions.maxTextureBytes) {
      this.texturePool.shift()?.resource.dispose()
    }
  }

  private async acquireDynamicTexture(
    key: string,
    bytes: number,
    options: Parameters<TextureSurfaceRendererBridge['createDynamicTexture']>[0],
  ): Promise<ReturnType<TextureSurfaceRendererBridge['createDynamicTexture']>> {
    const index = this.texturePool.findIndex(entry => entry.key === key)
    if (index >= 0) {
      const pooled = this.texturePool.splice(index, 1)[0] as PooledDynamicTexture
      const source = options.source
      if (!source) throw new Error('Pooled dynamic textures require an update source.')
      await pooled.resource.update(source)
      return pooled.resource
    }
    this.evictPoolUntil(this.liveTextureBytes() + bytes)
    const bridge = this.bridge
    if (!bridge) throw new Error('Texture bridge is unavailable.')
    return bridge.createDynamicTexture(options)
  }

  private releaseDynamicTexture(surface: MountedTextureSurface, allowPool: boolean): void {
    const pool = this.performanceOptions.pool
    if (!allowPool || !pool || surface.dynamicTexture.disposed || surface.textureBytes > pool.maxBytes) {
      surface.dynamicTexture.dispose()
      return
    }
    this.texturePool.push({ key: surface.textureKey, bytes: surface.textureBytes, resource: surface.dynamicTexture, lastUsed: this.now() })
    this.texturePool.sort((left, right) => left.lastUsed - right.lastUsed)
    while (this.texturePool.length > pool.maxEntries || this.pooledTextureBytes() > pool.maxBytes) {
      this.texturePool.shift()?.resource.dispose()
    }
  }

  private mountAccessibility(surface: MountedTextureSurface): void {
    if (!this.accessibilityProvider || !surface.accessibilityDescriptor) return
    try {
      surface.accessibilityHandle = this.accessibilityProvider.mount({
        state: this.accessibilityState(surface),
        focus: () => this.focus(surface.primitive.id, { reason: 'keyboard' }),
        blur: () => this.blur(surface.primitive.id),
        activateControl: control => this.activateAccessibilityControl(surface, control),
        requestTextInput: () => this.requestTextInput(surface.primitive.id, {}),
      })
      this.refreshAccessibility(surface)
    } catch (error) {
      this.reportOnce(surface, surface.primitive.id, 'ANYO_TEXTURE_ACCESSIBILITY_MOUNT_FAILED', {
        severity: 'warning', code: 'ANYO_TEXTURE_ACCESSIBILITY_MOUNT_FAILED',
        message: 'The semantic accessibility companion could not be mounted.',
        details: { error: error instanceof Error ? error.message : String(error) },
      })
    }
  }

  private setAccessibilityDescriptor(surface: MountedTextureSurface, descriptor: TextureSurfaceAccessibilityDescriptor): void {
    surface.accessibilityDescriptor = freezeAccessibilityDescriptor(descriptor)
    surface.accessibilityStateJson = ''
    if (!surface.accessibilityHandle) this.mountAccessibility(surface)
    else this.refreshAccessibility(surface)
  }

  private refreshAccessibilityPreferences(surface: MountedTextureSurface): void {
    invoke(surface, 'setAccessibilityPreferences', () => surface.instance.setAccessibilityPreferences?.(this.accessibilityPreferences), diagnostic => this.report(diagnostic))
    this.refreshAccessibility(surface)
  }

  private refreshAccessibility(surface: MountedTextureSurface): void {
    if (!surface.accessibilityDescriptor || !surface.accessibilityHandle) return
    const state = this.accessibilityState(surface)
    const json = JSON.stringify(state)
    if (json === surface.accessibilityStateJson) return
    surface.accessibilityStateJson = json
    try { surface.accessibilityHandle.update(state) }
    catch (error) {
      this.reportOnce(surface, surface.primitive.id, 'ANYO_TEXTURE_ACCESSIBILITY_UPDATE_FAILED', {
        severity: 'warning', code: 'ANYO_TEXTURE_ACCESSIBILITY_UPDATE_FAILED',
        message: 'The semantic accessibility companion failed to update.',
        details: { error: error instanceof Error ? error.message : String(error) },
      })
    }
  }

  private accessibilityState(surface: MountedTextureSurface) {
    return Object.freeze({
      primitiveId: surface.primitive.id,
      descriptor: surface.accessibilityDescriptor as TextureSurfaceAccessibilityDescriptor,
      focused: this.focusedSurfaceId === surface.primitive.id,
      active: surface.running,
      ...this.accessibilityPreferences,
    })
  }

  private announceAccessibility(surface: MountedTextureSurface, message: string, politeness: 'polite' | 'assertive' = 'polite'): void {
    try { surface.accessibilityHandle?.announce?.(message, politeness) }
    catch { /* announcements are non-critical */ }
  }

  private activateAccessibilityControl(surface: MountedTextureSurface, control: TextureSurfaceAccessibilityControl): void {
    if (!surface.running || control.disabled) return
    this.markUserGesture()
    this.focus(surface.primitive.id, { reason: 'keyboard' })
    for (const pressed of [true, false]) {
      this.dispatchInput(surface, Object.freeze({
        type: 'control', primitiveId: surface.primitive.id, action: control.action,
        pressed, source: 'accessibility', timestamp: this.now(),
      }))
    }
  }

  private installWorldLifecycle(context: PluginRuntimeContext): void {
    for (const cleanup of this.worldCleanups.splice(0)) cleanup()
    this.worldCleanups.push(context.world.on('world:start', () => {
      this.worldActive = true
      for (const surface of this.mounted.values()) this.refreshActive(surface, this.context ?? context)
    }))
    this.worldCleanups.push(context.world.on('world:pause', () => {
      this.worldActive = false
      for (const surface of this.mounted.values()) this.refreshRunning(surface)
    }))
    this.worldCleanups.push(context.world.on('world:stop', () => {
      this.worldActive = false
      for (const surface of this.mounted.values()) this.setActive(surface, false)
    }))
  }

  private reportOnce(surface: MountedTextureSurface | undefined, primitiveId: string, code: string, diagnostic: TextureSurfaceDiagnostic): void {
    const key = `${primitiveId}:${code}`
    if (surface?.diagnosticCodes.has(code) || this.reportedDiagnostics.has(key)) return
    surface?.diagnosticCodes.add(code)
    this.reportedDiagnostics.add(key)
    this.diagnosticOrder.push(key)
    while (this.diagnosticOrder.length > this.performanceOptions.maxDiagnosticHistory) {
      const oldest = this.diagnosticOrder.shift()
      if (oldest) this.reportedDiagnostics.delete(oldest)
    }
    this.report({ ...diagnostic, primitiveId })
  }

  private report(diagnostic: TextureSurfaceDiagnostic): void {
    this.options.diagnostics?.(Object.freeze({ ...diagnostic }))
  }

  private assertAlive(): void {
    if (this.disposed) throw new Error('TextureWebSurfaceRuntime is disposed.')
  }
}

function baseAppContext(
  context: PluginRuntimeContext,
  primitive: CompiledPrimitive,
  signal: AbortSignal,
): WebSurfaceAppContext {
  return {
    world: context.world,
    entityId: primitive.entityId ?? primitive.id,
    primitiveId: primitive.id,
    signal,
    interaction: primitive.webSurface?.interaction ?? { pointer: false, keyboard: false, scroll: false },
    runAction: (name, params = {}) => context.world.runAction(name, params, 'web-surface-texture'),
    select: selection => context.world.selectPrimitive({
      primitiveId: primitive.id,
      ...(primitive.entityId ? { entityId: primitive.entityId } : {}),
      source: 'web-surface',
      ...selection,
    }),
  }
}

function effectiveVisibility(
  primitive: CompiledPrimitive & { webSurface: CompiledWebSurface },
  context: PluginRuntimeContext,
): boolean {
  if (!primitive.visible) return false
  if (primitive.roomId && !context.compiled.roomById.get(primitive.roomId)?.visible) return false
  const resolution = resolveWebSurfaceTarget(context.compiled, primitive)
  if (!resolution.resolved) return false
  if (resolution.kind === 'wall') return resolution.room.visible
  if (resolution.kind === 'entity-slot' || resolution.kind === 'mesh') {
    if (resolution.entity.roomId && !context.compiled.roomById.get(resolution.entity.roomId)?.visible) return false
    for (const primitiveId of resolution.entity.primitiveIds) {
      const targetPrimitive = context.compiled.primitiveById.get(primitiveId)
      if (targetPrimitive && targetPrimitive.visible) return true
    }
    return resolution.entity.primitiveIds.length === 0
  }
  return true
}

function targetPosition(
  resolution: ReturnType<typeof resolveWebSurfaceTarget>,
  primitive: CompiledPrimitive,
): readonly [number, number, number] {
  const value = resolution.resolved && (resolution.kind === 'entity-slot' || resolution.kind === 'mesh')
    ? resolution.entity.transform.position
    : primitive.transform.position
  return Object.freeze([value[0], value[1], value[2]])
}

function targetPrimitiveIds(
  resolution: ReturnType<typeof resolveWebSurfaceTarget>,
  fallbackId: string,
): readonly string[] {
  if (!resolution.resolved) return Object.freeze([fallbackId])
  if (resolution.kind === 'entity-slot' || resolution.kind === 'mesh') {
    return Object.freeze([...resolution.entity.primitiveIds])
  }
  return Object.freeze([fallbackId])
}

function rendererCameraPosition(renderer: PluginRuntimeContext['renderer']): readonly [number, number, number] {
  const camera = (renderer as PluginRuntimeContext['renderer'] & { camera?: { getPosition?: () => readonly [number, number, number] } }).camera
  const value = camera?.getPosition?.()
  if (!value || value.length < 3 || !value.every(Number.isFinite)) return Object.freeze([0, 0, 0])
  return Object.freeze([value[0], value[1], value[2]])
}

function vecDistance(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2])
}

function normalizeDirection(
  origin: readonly [number, number, number],
  target: readonly [number, number, number],
): readonly [number, number, number] {
  const x = target[0] - origin[0]
  const y = target[1] - origin[1]
  const z = target[2] - origin[2]
  const length = Math.hypot(x, y, z)
  return length > 1e-9 ? Object.freeze([x / length, y / length, z / length]) : Object.freeze([0, 0, -1])
}

function texturePriority(options: TextureSurfaceRegistrationOptions): number {
  return Number.isFinite(options.priority) ? options.priority as number : 0
}

function dynamicTextureKey(options: TextureSurfaceRegistrationOptions, width: number, height: number): string {
  return JSON.stringify([
    Math.max(1, Math.round(width)), Math.max(1, Math.round(height)),
    options.flipY ?? false, options.colorSpace ?? 'srgb',
    options.minFilter ?? 'nearest', options.magFilter ?? 'nearest', options.mipmaps ?? 'none',
  ])
}

function domPointerType(value: string): TextureSurfacePointerType {
  return value === 'touch' || value === 'pen' ? value : 'mouse'
}

function clamp01(value: number): number { return Math.max(0, Math.min(1, value)) }

function registeredBrowserSourceUrl(app: unknown): string | undefined {
  if (!app || typeof app !== 'object') return undefined
  const candidate = (app as { browserSource?: { url?: unknown } }).browserSource?.url
  if (typeof candidate !== 'string' || !candidate.trim()) return undefined
  try {
    const url = new URL(candidate)
    return url.href
  } catch {
    return undefined
  }
}

function frozenProps(value: Record<string, unknown> | undefined): Readonly<Record<string, unknown>> {
  return Object.freeze(structuredClone(value ?? {}))
}

function resolveAccessibilityDescriptor(
  app: TextureWebSurfaceApp,
  props: Readonly<Record<string, unknown>>,
): TextureSurfaceAccessibilityDescriptor | null {
  if (!app.accessibility) return null
  return freezeAccessibilityDescriptor(typeof app.accessibility === 'function' ? app.accessibility(props) : app.accessibility)
}

function freezeAccessibilityDescriptor(descriptor: TextureSurfaceAccessibilityDescriptor): TextureSurfaceAccessibilityDescriptor {
  if (!descriptor || typeof descriptor.label !== 'string' || descriptor.label.trim().length === 0) {
    throw new TypeError('Texture surface accessibility descriptors require a non-empty label.')
  }
  return Object.freeze({
    ...descriptor,
    label: descriptor.label.trim(),
    ...(descriptor.controls ? { controls: Object.freeze(descriptor.controls.map(control => Object.freeze({ ...control }))) } : {}),
    ...(descriptor.textInput ? { textInput: Object.freeze({ ...descriptor.textInput }) } : {}),
  })
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`)
  return value
}

function invoke(
  surface: MountedTextureSurface,
  operation: string,
  callback: () => void | undefined,
  diagnostic: (value: TextureSurfaceDiagnostic) => void,
): void {
  try { callback() }
  catch (error) {
    diagnostic({
      severity: 'warning',
      code: 'ANYO_TEXTURE_APP_LIFECYCLE_FAILED',
      message: `Texture surface ${operation}() failed.`,
      primitiveId: surface.primitive.id,
      details: { operation, error: error instanceof Error ? error.message : String(error) },
    })
  }
}

async function safeDispose(
  instance: TextureWebSurfaceAppInstance,
  diagnostic: (value: TextureSurfaceDiagnostic) => void,
): Promise<void> {
  try { await instance.dispose() }
  catch (error) {
    diagnostic({
      severity: 'warning',
      code: 'ANYO_TEXTURE_APP_DISPOSE_FAILED',
      message: 'Texture surface dispose() failed.',
      details: { error: error instanceof Error ? error.message : String(error) },
    })
  }
}

function currentDevicePixelRatio(): number {
  const value = Number(globalThis.devicePixelRatio ?? 1)
  return Number.isFinite(value) && value > 0 ? value : 1
}
