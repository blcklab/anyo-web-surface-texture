import type {
  CompiledPrimitive,
  PluginRuntimeContext,
  RendererAdapter,
  WebSurfaceFramePolicy,
  WorldPlugin,
} from '@blcklab/anyo'
import type {
  RegisteredWebSurfaceApp,
  WebSurfaceAppContext,
  WebSurfaceAppRegistry,
  WebSurfaceTargetResolution,
  WebSurfaceRuntimeOptions,
} from '@blcklab/anyo/web-surface'
import type {
  DynamicTexture,
  DynamicTextureOptions,
  DynamicTextureSource,
} from '@blcklab/sekai64/dynamic-texture'
import type { Texture } from '@blcklab/sekai64/materials'

export type TextureSurfaceCanvas = HTMLCanvasElement | OffscreenCanvas

export interface TextureSurfaceResolution {
  readonly width: number
  readonly height: number
}

export type TextureSurfaceQualityPreset = 'low' | 'balanced' | 'hd' | 'full-hd' | 'qhd' | 'ultra'
export type TextureSurfaceQualityMode = 'auto' | TextureSurfaceQualityPreset

export interface TextureSurfaceQualityOptions {
  /** Auto resolves to balanced unless autoPreset is supplied. */
  readonly mode?: TextureSurfaceQualityMode
  readonly autoPreset?: TextureSurfaceQualityPreset
  /** Explicit physical framebuffer ceiling. Presets remain useful labels/policies. */
  readonly resolution?: TextureSurfaceResolution
  /** Optional logical browser/UI viewport. Defaults to physical size divided by bounded DPR. */
  readonly logicalResolution?: TextureSurfaceResolution
  readonly devicePixelRatio?: number | 'auto'
  /** Defaults to 2. Physical preset size is never multiplied by DPR. */
  readonly maxDevicePixelRatio?: number
}

export interface TextureSurfaceBrowserSource {
  /** Resolved host-owned URL for an app that may be promoted to a native browser texture when a provider is available. */
  readonly url: string
}

export interface TextureSurfaceBrowserBackedApp extends RegisteredWebSurfaceApp {
  /** Host-only capability hint. This metadata is never authored in world JSON. */
  readonly browserSource: TextureSurfaceBrowserSource
}

export interface TextureSurfaceResolvedQuality extends TextureSurfaceResolution {
  readonly mode: TextureSurfaceQualityMode
  readonly preset: TextureSurfaceQualityPreset
  readonly logicalWidth: number
  readonly logicalHeight: number
  readonly deviceScale: number
}

export interface TextureSurfaceRegistrationOptions extends TextureSurfaceResolution {
  /** Optional supersampling multiplier for the application framebuffer and uploaded presentation. Defaults to 1; maximum 2. */
  readonly rasterScale?: number
  readonly label?: string
  readonly flipY?: boolean
  readonly colorSpace?: 'srgb' | 'linear'
  readonly minFilter?: 'nearest' | 'linear' | 'nearest-mipmap-nearest' | 'linear-mipmap-nearest' | 'nearest-mipmap-linear' | 'linear-mipmap-linear'
  readonly magFilter?: 'nearest' | 'linear'
  readonly mipmaps?: 'none' | 'generate'
  readonly priority?: number
}

export interface TextureSurfaceFrame {
  readonly time: number
  readonly deltaSeconds: number
  readonly frame: number
  readonly reason: 'initial' | 'dirty' | 'fixed-rate' | 'continuous'
}

export type TextureSurfacePerformancePreset = 'desktop' | 'mobile' | 'headset' | 'battery-saver'
export type TextureSurfaceThermalState = 'nominal' | 'fair' | 'serious' | 'critical'

export interface TextureSurfaceDistanceTier {
  readonly maxDistance: number
  readonly resolutionScale: number
  readonly fpsScale: number
  readonly suspend?: boolean
}

export interface TextureSurfacePerformanceState {
  readonly distance: number
  readonly resolutionScale: number
  readonly fpsScale: number
  readonly occluded: boolean
  readonly thermalState: TextureSurfaceThermalState
  readonly suspended: boolean
  readonly reasons: readonly ('distance' | 'occlusion' | 'thermal' | 'memory')[]
}

export interface TextureSurfacePerformanceContext {
  readonly state: TextureSurfacePerformanceState
}

export interface TextureSurfaceFocusRequest {
  readonly reason?: 'pointer' | 'keyboard' | 'gamepad' | 'xr' | 'programmatic'
}

export interface TextureSurfaceInputContext {
  requestFocus(request?: TextureSurfaceFocusRequest): boolean
  releaseFocus(): void
  capturePointer(pointerId: number): boolean
  releasePointer(pointerId: number): void
  requestTextInput(request?: TextureSurfaceTextInputRequest): boolean
  closeTextInput(): void
  setTouchControls(controls: readonly TextureSurfaceTouchControl[]): void
  readonly focused: boolean
}

export interface TextureSurfaceAccessibilityPreferences {
  readonly reducedMotion: boolean
  readonly highContrast: boolean
}

export type TextureSurfaceAccessibilityRole = 'application' | 'region' | 'document' | 'group'

export interface TextureSurfaceAccessibilityControl {
  readonly id: string
  readonly label: string
  readonly action: string
  readonly description?: string
  readonly shortcut?: string
  readonly pressed?: boolean
  readonly disabled?: boolean
}

/** Explicit semantic companion data. Raw texture pixels are never treated as accessible content. */
export interface TextureSurfaceAccessibilityDescriptor {
  readonly label: string
  readonly description?: string
  readonly role?: TextureSurfaceAccessibilityRole
  readonly instructions?: string
  readonly prompt?: string
  readonly live?: 'off' | 'polite' | 'assertive'
  readonly contrast?: 'auto' | 'standard' | 'high'
  readonly controls?: readonly TextureSurfaceAccessibilityControl[]
  readonly textInput?: Omit<TextureSurfaceTextInputRequest, 'ariaLabel'> & { readonly label?: string }
}

export interface TextureSurfaceAccessibilityState extends TextureSurfaceAccessibilityPreferences {
  readonly primitiveId: string
  readonly descriptor: TextureSurfaceAccessibilityDescriptor
  readonly focused: boolean
  readonly active: boolean
}

export interface TextureSurfaceAccessibilityCompanionHandle {
  update(state: TextureSurfaceAccessibilityState): void
  announce?(message: string, politeness?: 'polite' | 'assertive'): void
  dispose(): void
}

export interface TextureSurfaceAccessibilityCompanionProvider {
  mount(request: {
    readonly state: TextureSurfaceAccessibilityState
    readonly focus: () => boolean
    readonly blur: () => void
    readonly activateControl: (control: TextureSurfaceAccessibilityControl) => void
    readonly requestTextInput: () => boolean
  }): TextureSurfaceAccessibilityCompanionHandle
}

export interface TextureSurfaceAccessibilityContext {
  readonly reducedMotion: boolean
  readonly highContrast: boolean
  update(descriptor: TextureSurfaceAccessibilityDescriptor): void
  announce(message: string, politeness?: 'polite' | 'assertive'): void
}

export interface TextureWebSurfaceAppContext extends WebSurfaceAppContext {
  readonly canvas: TextureSurfaceCanvas
  readonly backend: string
  /** Physical framebuffer and logical UI sizing chosen for this mounted surface. */
  readonly quality: TextureSurfaceResolvedQuality
  readonly input: TextureSurfaceInputContext
  readonly accessibility: TextureSurfaceAccessibilityContext
  readonly performance: TextureSurfacePerformanceContext
  /** Marks an on-change surface dirty. It never creates its own RAF loop. */
  invalidate(): void
}

export interface TextureWebSurfaceAppInstance {
  /** Optional browser navigation surface. Native/remote browser-backed apps may implement these. */
  navigate?(url: string): void | Promise<void>
  back?(): void | Promise<void>
  forward?(): void | Promise<void>
  reload?(): void | Promise<void>
  render?(props: Readonly<Record<string, unknown>>, frame: TextureSurfaceFrame): void | Promise<void>
  update?(props: Readonly<Record<string, unknown>>): void | Promise<void>
  resize?(width: number, height: number): void | Promise<void>
  setActive?(active: boolean): void
  pause?(): void
  resume?(): void
  /** Synchronous high-frequency input hook. Return true when the app consumed the event. */
  handleInput?(event: TextureSurfaceInputEvent): boolean | void
  setInputFocus?(focused: boolean, reason: TextureSurfaceFocusRequest['reason']): void
  setAudioState?(state: TextureSurfaceAudioState): void
  setAccessibilityPreferences?(preferences: TextureSurfaceAccessibilityPreferences): void
  setPerformanceState?(state: TextureSurfacePerformanceState): void
  dispose(): void | Promise<void>
}

/** Existing DOM mount remains available; texture presentation is an additive host capability. */
export interface TextureSurfaceApplicationDevices {
  readonly gamepad?: boolean
  readonly audio?: boolean
  readonly textInput?: boolean
}

export interface TextureWebSurfaceApp extends RegisteredWebSurfaceApp {
  readonly devices?: TextureSurfaceApplicationDevices
  readonly texture?: TextureSurfaceRegistrationOptions
  /** Optional app/provider quality policy; physical canvas dimensions remain authoritative. */
  readonly quality?: TextureSurfaceQualityOptions | TextureSurfaceQualityMode
  readonly accessibility?: TextureSurfaceAccessibilityDescriptor | ((props: Readonly<Record<string, unknown>>) => TextureSurfaceAccessibilityDescriptor)
  createTextureSurface(
    canvas: TextureSurfaceCanvas,
    props: Readonly<Record<string, unknown>>,
    context: TextureWebSurfaceAppContext,
  ): TextureWebSurfaceAppInstance | Promise<TextureWebSurfaceAppInstance>
}


export type TextureSurfacePointerType = 'mouse' | 'touch' | 'pen' | 'xr-controller' | 'gaze'
export type TextureSurfacePointerPhase =
  | 'enter' | 'leave' | 'move' | 'down' | 'up' | 'cancel' | 'click' | 'wheel'

export interface TextureSurfaceHitTestScreenRequest {
  readonly type: 'screen'
  readonly clientX: number
  readonly clientY: number
}

export interface TextureSurfaceHitTestRayRequest {
  readonly type: 'ray'
  readonly origin: readonly [number, number, number]
  readonly direction: readonly [number, number, number]
  readonly near?: number
  readonly far?: number
}

export type TextureSurfaceHitTestRequest = TextureSurfaceHitTestScreenRequest | TextureSurfaceHitTestRayRequest

export interface TextureSurfaceHit {
  readonly uv: readonly [number, number]
  readonly point: readonly [number, number, number]
  readonly normal: readonly [number, number, number]
  readonly distance: number
  readonly frontFacing: boolean
}

export interface TextureSurfacePointerInputEvent {
  readonly type: 'pointer'
  readonly phase: TextureSurfacePointerPhase
  readonly primitiveId: string
  readonly pointerId: number
  readonly pointerType: TextureSurfacePointerType
  readonly button: number
  readonly buttons: number
  readonly uv: readonly [number, number]
  readonly pixel: readonly [number, number]
  readonly point: readonly [number, number, number]
  readonly normal: readonly [number, number, number]
  readonly distance: number
  readonly captured: boolean
  readonly timestamp: number
  readonly delta?: readonly [number, number, number]
}

export interface TextureSurfaceKeyboardInputEvent {
  readonly type: 'keyboard'
  readonly phase: 'down' | 'up'
  readonly primitiveId: string
  readonly key: string
  readonly code: string
  readonly repeat: boolean
  readonly modifiers: Readonly<{ alt: boolean; ctrl: boolean; meta: boolean; shift: boolean }>
  readonly timestamp: number
  readonly synthetic?: boolean
}

export interface TextureSurfaceTextInputEvent {
  readonly type: 'text'
  readonly primitiveId: string
  readonly text: string
  readonly inputType?: string
  readonly timestamp: number
}

export interface TextureSurfaceGamepadButton {
  readonly pressed: boolean
  readonly touched: boolean
  readonly value: number
}

export interface TextureSurfaceGamepadInputEvent {
  readonly type: 'gamepad'
  readonly primitiveId: string
  readonly index: number
  readonly id: string
  readonly connected: boolean
  readonly mapping: string
  readonly axes: readonly number[]
  readonly buttons: readonly TextureSurfaceGamepadButton[]
  readonly timestamp: number
}

export interface TextureSurfaceControlInputEvent {
  readonly type: 'control'
  readonly primitiveId: string
  readonly action: string
  readonly pressed: boolean
  readonly source: 'touch' | 'accessibility'
  readonly timestamp: number
}

export type TextureSurfaceInputEvent =
  | TextureSurfacePointerInputEvent
  | TextureSurfaceKeyboardInputEvent
  | TextureSurfaceTextInputEvent
  | TextureSurfaceGamepadInputEvent
  | TextureSurfaceControlInputEvent

export interface TextureSurfaceRayInput {
  readonly phase: 'move' | 'down' | 'up' | 'cancel' | 'select'
  readonly origin: readonly [number, number, number]
  readonly direction: readonly [number, number, number]
  readonly pointerId?: number
  readonly pointerType?: 'xr-controller' | 'gaze'
  readonly button?: number
  readonly buttons?: number
  readonly timestamp?: number
}

export interface TextureSurfaceTextInputRequest {
  readonly value?: string
  readonly placeholder?: string
  readonly inputMode?: string
  readonly multiline?: boolean
  readonly maxLength?: number
  readonly ariaLabel?: string
}

export interface TextureSurfaceVirtualKeyboardHandle {
  update?(request: TextureSurfaceTextInputRequest): void
  close(): void
}

export interface TextureSurfaceVirtualKeyboardProvider {
  open(request: TextureSurfaceTextInputRequest & {
    readonly primitiveId: string
    readonly onText: (text: string, inputType?: string) => void
    readonly onKey: (phase: 'down' | 'up', key: string, code?: string) => void
    readonly onClose: () => void
  }): TextureSurfaceVirtualKeyboardHandle
}

export interface TextureSurfaceTouchControl {
  readonly id: string
  readonly label: string
  readonly action: string
  readonly position?: 'left' | 'right' | 'bottom'
}

export interface TextureSurfaceTouchControlHandle {
  update?(controls: readonly TextureSurfaceTouchControl[]): void
  close(): void
}

export interface TextureSurfaceTouchControlProvider {
  show(request: {
    readonly primitiveId: string
    readonly controls: readonly TextureSurfaceTouchControl[]
    readonly dispatch: (action: string, pressed: boolean) => void
  }): TextureSurfaceTouchControlHandle
}

export interface TextureSurfaceAudioState {
  readonly focused: boolean
  readonly active: boolean
  readonly muted: boolean
  readonly allowedByUserGesture: boolean
}

export interface TextureSurfaceGamepadLike {
  readonly index: number
  readonly id: string
  readonly connected: boolean
  readonly mapping: string
  readonly axes: readonly number[]
  readonly buttons: readonly { readonly pressed: boolean; readonly touched: boolean; readonly value: number }[]
  readonly timestamp: number
}

export interface TextureSurfaceInputController {
  dispatchRay(input: TextureSurfaceRayInput): boolean
  focus(primitiveId: string, request?: TextureSurfaceFocusRequest): boolean
  blur(primitiveId?: string): void
  readonly focusedPrimitiveId: string | null
}

export interface TextureSurfaceBrowserController {
  /** True when the mounted surface exposes host-browser navigation controls. */
  canControl(primitiveId: string): boolean
  navigate(primitiveId: string, url: string): Promise<boolean>
  back(primitiveId: string): Promise<boolean>
  forward(primitiveId: string): Promise<boolean>
  reload(primitiveId: string): Promise<boolean>
}

export interface TextureSurfaceInputOptions {
  /** Pointer listeners are installed only on the renderer canvas. Defaults to true. */
  readonly pointer?: boolean
  /** Mouse/pointer buttons forwarded to Web Surfaces. Defaults to all buttons. Use [0] for normal primary-click web interaction while preserving host right-drag camera controls. */
  readonly pointerButtons?: readonly number[]
  /** Automatically captures a pointer after a successful down event. Defaults to true. */
  readonly captureOnPointerDown?: boolean
  /** When a focused scroll-capable surface is under the pointer, prevent host/default wheel handling. Defaults to true. */
  readonly preventWheelDefault?: boolean
  /** Keyboard events are scoped to this target; defaults to the renderer canvas. */
  readonly keyboardTarget?: EventTarget
  readonly preventKeyboardDefault?: boolean
  readonly getGamepads?: () => readonly (TextureSurfaceGamepadLike | null)[]
  readonly virtualKeyboard?: TextureSurfaceVirtualKeyboardProvider
  readonly touchControls?: TextureSurfaceTouchControlProvider
}

export interface TextureSurfaceAccessibilityOptions {
  /** Custom semantic-companion host. A lightweight DOM provider is used when omitted in browsers. */
  readonly provider?: TextureSurfaceAccessibilityCompanionProvider
  readonly root?: HTMLElement
  readonly mode?: 'screen-reader-only' | 'compact'
  readonly reducedMotion?: boolean | 'auto'
  readonly highContrast?: boolean | 'auto'
}

export interface TextureSurfaceOcclusionRequest {
  readonly primitiveId: string
  readonly primitive: CompiledPrimitive
  readonly cameraPosition: readonly [number, number, number]
  readonly targetPosition: readonly [number, number, number]
  readonly distance: number
  readonly renderer: RendererAdapter
  readonly targetPrimitiveIds: readonly string[]
}

export interface TextureSurfaceOcclusionOptions {
  readonly mode?: 'renderer-ray' | 'custom'
  readonly intervalMs?: number
  readonly test?: (request: TextureSurfaceOcclusionRequest) => boolean
}

export interface TextureSurfacePoolOptions {
  readonly maxEntries?: number
  readonly maxBytes?: number
}

export interface TextureSurfaceThermalOptions {
  readonly getState: () => TextureSurfaceThermalState
  readonly intervalMs?: number
}

export interface TextureSurfaceBrowserPointerEvent {
  readonly phase: TextureSurfacePointerPhase
  readonly x: number
  readonly y: number
  readonly button: number
  readonly buttons: number
  readonly pointerId: number
  readonly pointerType: TextureSurfacePointerType
  readonly timestamp: number
}

export interface TextureSurfaceBrowserWheelEvent {
  readonly x: number
  readonly y: number
  readonly deltaX: number
  readonly deltaY: number
  readonly deltaZ: number
  readonly timestamp: number
}

export interface TextureSurfaceBrowserKeyboardEvent {
  readonly phase: 'down' | 'up'
  readonly key: string
  readonly code: string
  readonly repeat: boolean
  readonly modifiers: Readonly<{ alt: boolean; ctrl: boolean; meta: boolean; shift: boolean }>
  readonly timestamp: number
}

export interface TextureSurfaceNativeBrowserSurface {
  navigate?(url: string): void | Promise<void>
  back?(): void | Promise<void>
  forward?(): void | Promise<void>
  reload?(): void | Promise<void>
  resize?(request: { readonly width: number; readonly height: number; readonly logicalWidth: number; readonly logicalHeight: number; readonly deviceScale: number }): void | Promise<void>
  focus?(focused: boolean): void | Promise<void>
  sendPointer?(event: TextureSurfaceBrowserPointerEvent): boolean | void
  sendKeyboard?(event: TextureSurfaceBrowserKeyboardEvent): boolean | void
  sendWheel?(event: TextureSurfaceBrowserWheelEvent): boolean | void
  sendText?(text: string, inputType?: string): boolean | void
  suspend?(): void | Promise<void>
  resume?(): void | Promise<void>
  dispose(): void | Promise<void>
}

export interface TextureSurfaceNativeBrowserProvider {
  /** Host-controlled capability/trust gate. Backend details never enter world JSON. */
  canPresent?(url: string): boolean
  createSurface(request: {
    /** Stable Anyo primitive identity so hosts can reuse/reclaim browser sessions across remounts. */
    readonly primitiveId: string
    readonly url: string
    readonly canvas: TextureSurfaceCanvas
    readonly width: number
    readonly height: number
    readonly logicalWidth: number
    readonly logicalHeight: number
    readonly deviceScale: number
    readonly signal: AbortSignal
    /** Provider calls this after producing a new framebuffer. */
    readonly invalidate: () => void
  }): TextureSurfaceNativeBrowserSurface | Promise<TextureSurfaceNativeBrowserSurface>
}

export interface TextureSurfacePerformanceOptions {
  readonly preset?: TextureSurfacePerformancePreset
  readonly maxSurfaces?: number
  readonly maxTextureBytes?: number
  readonly maxTextureBytesPerSurface?: number
  readonly maxDiagnosticHistory?: number
  readonly minResolutionScale?: number
  readonly distanceTiers?: readonly TextureSurfaceDistanceTier[]
  /** Distance dead-band in world units used when crossing resolution tiers. Defaults to 0.5. */
  readonly resolutionHysteresis?: number
  readonly occlusion?: false | TextureSurfaceOcclusionOptions
  readonly pool?: false | TextureSurfacePoolOptions
  readonly thermal?: TextureSurfaceThermalOptions
}

export interface TextureSurfaceDiagnostic {
  readonly severity: 'info' | 'warning' | 'error'
  readonly code: string
  readonly message: string
  readonly primitiveId?: string | undefined
  readonly details?: Readonly<Record<string, unknown>> | undefined
}

export interface TextureSurfaceTargetBinding {
  readonly kind: 'plane' | 'entity-slot' | 'mesh'
  readonly texture: Texture
  readonly presented: boolean
  setPresented(presented: boolean): void
  update?(deltaSeconds: number): void
  hitTest?(request: TextureSurfaceHitTestRequest): TextureSurfaceHit | null
  dispose(): void
}

export type TextureSurfaceBindingResult =
  | { readonly ok: true; readonly binding: TextureSurfaceTargetBinding }
  | {
      readonly ok: false
      readonly retryable: boolean
      readonly code: string
      readonly message: string
      readonly details?: Readonly<Record<string, unknown>>
    }

export interface TextureSurfaceRendererBridge {
  readonly backend: string
  readonly identity: object
  createDynamicTexture(options: DynamicTextureOptions): DynamicTexture
  bindTarget(request: {
    readonly primitive: CompiledPrimitive
    readonly resolution: Extract<WebSurfaceTargetResolution, { resolved: true }>
    readonly texture: Texture
  }): TextureSurfaceBindingResult
  dispose(): void
}

export interface TextureWebSurfacePluginOptions {
  readonly registry: WebSurfaceAppRegistry
  readonly createBridge: (renderer: RendererAdapter) => TextureSurfaceRendererBridge | null
  readonly canvasFactory?: (width: number, height: number) => TextureSurfaceCanvas
  readonly defaultResolution?: TextureSurfaceResolution
  /** Maximum uploads started from one plugin update. Defaults to 4. */
  readonly maxUploadsPerFrame?: number
  /** Hard ceiling applied to fixed and continuous policies. Defaults to 60. */
  readonly maxFps?: number
  readonly input?: false | TextureSurfaceInputOptions
  /** Explicit semantic companion UI. Defaults to browser DOM support when semantic data is provided. */
  readonly accessibility?: false | TextureSurfaceAccessibilityOptions
  readonly performance?: TextureSurfacePerformanceOptions
  /** Host quality policy. Full-HD remains capped at a true 1920x1080 physical framebuffer. */
  readonly quality?: TextureSurfaceQualityOptions | TextureSurfaceQualityMode
  /** Optional host-supplied top-level browser context. No browser runtime is bundled by this package. */
  readonly browserProvider?: false | TextureSurfaceNativeBrowserProvider
  readonly diagnostics?: (diagnostic: TextureSurfaceDiagnostic) => void
  /** DOM/iframe fallback routing is enabled by default. Set false when another host owns overlay presentation. */
  readonly domFallback?: false | Omit<WebSurfaceRuntimeOptions, 'registry' | 'shouldPresent'>
  readonly now?: () => number
}

export interface TextureWebSurfacePlugin extends WorldPlugin {
  readonly registry: WebSurfaceAppRegistry
  readonly input: TextureSurfaceInputController
  /** Host browser controls for native/remote browser-backed physical surfaces. */
  readonly browser: TextureSurfaceBrowserController
  readonly maintenance: TextureSurfaceMaintenanceController
  readonly capabilities: {
    readonly canvasApplications: true
    readonly planeTargets: true
    readonly entitySlotTargets: true
    readonly meshTargets: true
    readonly desktop: true
    readonly immersiveXR: true
    readonly domFallback: boolean
    readonly pointerInput: true
    readonly touchInput: true
    readonly xrRayInput: true
    readonly keyboardInput: true
    readonly gamepadInput: boolean
    readonly audioFocus: true
    readonly virtualKeyboard: boolean
    readonly touchControls: boolean
    readonly curvedTargets: true
    readonly textureTransforms: true
    readonly advancedMaterials: true
    readonly accessibilityCompanion: boolean
    readonly reducedMotion: true
    readonly semanticControls: true
    readonly performanceBudgets: true
    readonly distanceScaling: true
    readonly texturePooling: boolean
    readonly occlusionSuspension: boolean
    readonly nativeBrowserProvider: boolean
  }
}

export interface TextureSurfaceMaintenanceController {
  recover(): Promise<void>
  trimPool(): void
  readonly stats: TextureSurfaceRuntimeStats
}

export interface TextureSurfaceRuntimeStats {
  readonly mounted: number
  readonly active: number
  readonly visible: number
  readonly suspended: number
  readonly uploads: number
  readonly skippedByBudget: number
  readonly skippedByDistance: number
  readonly skippedByOcclusion: number
  readonly skippedByThermal: number
  readonly textureBytes: number
  readonly pooledTextureBytes: number
  readonly pooledTextures: number
  readonly diagnosticHistory: number
}

export function isTextureWebSurfaceApp(app: RegisteredWebSurfaceApp | undefined): app is TextureWebSurfaceApp {
  return Boolean(app && typeof (app as Partial<TextureWebSurfaceApp>).createTextureSurface === 'function')
}

export type {
  CompiledPrimitive,
  DynamicTexture,
  DynamicTextureSource,
  PluginRuntimeContext,
  WebSurfaceFramePolicy,
  WebSurfaceTargetResolution,
}
