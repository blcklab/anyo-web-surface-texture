import type {
  TextureSurfaceAccessibilityCompanionHandle,
  TextureSurfaceAccessibilityCompanionProvider,
  TextureSurfaceAccessibilityControl,
  TextureSurfaceAccessibilityOptions,
  TextureSurfaceAccessibilityState,
} from './types.js'

export interface DomAccessibilityCompanionProviderOptions {
  readonly root?: HTMLElement
  readonly mode?: 'screen-reader-only' | 'compact'
}

export function createDomAccessibilityCompanionProvider(
  options: DomAccessibilityCompanionProviderOptions = {},
): TextureSurfaceAccessibilityCompanionProvider {
  return {
    mount(request) {
      const documentRef = options.root?.ownerDocument ?? (typeof document !== 'undefined' ? document : null)
      if (!documentRef) throw new Error('DOM accessibility companions require a document.')
      const host = options.root ?? documentRef.body
      const section = documentRef.createElement('section')
      const title = documentRef.createElement('strong')
      const description = documentRef.createElement('p')
      const instructions = documentRef.createElement('p')
      const prompt = documentRef.createElement('p')
      const controls = documentRef.createElement('div')
      const live = documentRef.createElement('div')
      const focusButton = documentRef.createElement('button')
      const blurButton = documentRef.createElement('button')
      const textButton = documentRef.createElement('button')
      const mode = options.mode ?? 'screen-reader-only'

      section.dataset.anyoAccessibilityCompanion = request.state.primitiveId
      section.tabIndex = -1
      section.append(title, description, instructions, prompt, focusButton, blurButton, textButton, controls, live)
      live.setAttribute('aria-atomic', 'true')
      focusButton.type = 'button'
      blurButton.type = 'button'
      textButton.type = 'button'
      focusButton.addEventListener('click', request.focus)
      blurButton.addEventListener('click', request.blur)
      textButton.addEventListener('click', request.requestTextInput)
      applyMode(section, mode)
      host.append(section)

      let disposed = false
      const handle: TextureSurfaceAccessibilityCompanionHandle = {
        update(state) {
          if (disposed) return
          updateSection(section, title, description, instructions, prompt, controls, focusButton, blurButton, textButton, state, request.activateControl)
          live.setAttribute('aria-live', state.descriptor.live ?? 'polite')
        },
        announce(message, politeness = 'polite') {
          if (disposed) return
          live.setAttribute('aria-live', politeness)
          live.textContent = ''
          queueMicrotask(() => { if (!disposed) live.textContent = message })
        },
        dispose() {
          if (disposed) return
          disposed = true
          section.remove()
        },
      }
      handle.update(request.state)
      return handle
    },
  }
}

export function resolveAccessibilityPreferences(options: TextureSurfaceAccessibilityOptions | undefined): {
  readonly reducedMotion: boolean
  readonly highContrast: boolean
  readonly cleanups: readonly (() => void)[]
  readonly subscribe: (listener: (preferences: { reducedMotion: boolean; highContrast: boolean }) => void) => void
} {
  const cleanups: Array<() => void> = []
  const listeners = new Set<(preferences: { reducedMotion: boolean; highContrast: boolean }) => void>()
  const reducedQuery = autoQuery(options?.reducedMotion, '(prefers-reduced-motion: reduce)')
  const contrastQuery = autoQuery(options?.highContrast, '(prefers-contrast: more)')
  let reducedMotion = resolvePreference(options?.reducedMotion, reducedQuery)
  let highContrast = resolvePreference(options?.highContrast, contrastQuery)
  const emit = (): void => {
    const value = Object.freeze({ reducedMotion, highContrast })
    for (const listener of listeners) listener(value)
  }
  const watch = (query: MediaQueryList | null, assign: (value: boolean) => void): void => {
    if (!query) return
    const listener = (event: MediaQueryListEvent): void => { assign(event.matches); emit() }
    query.addEventListener?.('change', listener)
    cleanups.push(() => query.removeEventListener?.('change', listener))
  }
  if (options?.reducedMotion === undefined || options.reducedMotion === 'auto') watch(reducedQuery, value => { reducedMotion = value })
  if (options?.highContrast === undefined || options.highContrast === 'auto') watch(contrastQuery, value => { highContrast = value })
  return {
    get reducedMotion() { return reducedMotion },
    get highContrast() { return highContrast },
    cleanups,
    subscribe(listener) { listeners.add(listener) },
  }
}

function autoQuery(value: boolean | 'auto' | undefined, query: string): MediaQueryList | null {
  if (value !== undefined && value !== 'auto') return null
  return typeof matchMedia === 'function' ? matchMedia(query) : null
}

function resolvePreference(value: boolean | 'auto' | undefined, query: MediaQueryList | null): boolean {
  return typeof value === 'boolean' ? value : Boolean(query?.matches)
}

function updateSection(
  section: HTMLElement,
  title: HTMLElement,
  description: HTMLElement,
  instructions: HTMLElement,
  prompt: HTMLElement,
  controls: HTMLElement,
  focusButton: HTMLButtonElement,
  blurButton: HTMLButtonElement,
  textButton: HTMLButtonElement,
  state: TextureSurfaceAccessibilityState,
  activateControl: (control: TextureSurfaceAccessibilityControl) => void,
): void {
  const descriptor = state.descriptor
  section.setAttribute('role', descriptor.role ?? 'application')
  section.setAttribute('aria-label', descriptor.label)
  section.dataset.focused = String(state.focused)
  section.dataset.active = String(state.active)
  section.dataset.reducedMotion = String(state.reducedMotion)
  section.dataset.highContrast = String(state.highContrast || descriptor.contrast === 'high')
  title.textContent = descriptor.label
  setOptionalText(description, descriptor.description)
  setOptionalText(instructions, descriptor.instructions)
  setOptionalText(prompt, descriptor.prompt)
  focusButton.textContent = `Focus ${descriptor.label}`
  focusButton.hidden = state.focused
  focusButton.disabled = !state.active
  blurButton.textContent = `Leave ${descriptor.label}`
  blurButton.hidden = !state.focused
  textButton.textContent = descriptor.textInput?.label ?? `Enter text in ${descriptor.label}`
  textButton.hidden = !descriptor.textInput
  textButton.disabled = !state.active || !state.focused
  controls.replaceChildren(...(descriptor.controls ?? []).map(control => createControl(section.ownerDocument, control, activateControl)))
}

function createControl(
  documentRef: Document,
  control: TextureSurfaceAccessibilityControl,
  activate: (control: TextureSurfaceAccessibilityControl) => void,
): HTMLButtonElement {
  const button = documentRef.createElement('button')
  button.type = 'button'
  button.textContent = control.label
  button.disabled = control.disabled ?? false
  button.dataset.action = control.action
  if (control.description) button.title = control.description
  if (control.shortcut) button.setAttribute('aria-keyshortcuts', control.shortcut)
  if (control.pressed !== undefined) button.setAttribute('aria-pressed', String(control.pressed))
  button.addEventListener('click', () => activate(control))
  return button
}

function setOptionalText(element: HTMLElement, value: string | undefined): void {
  element.textContent = value ?? ''
  element.hidden = !value
}

function applyMode(section: HTMLElement, mode: 'screen-reader-only' | 'compact'): void {
  if (mode === 'compact') {
    Object.assign(section.style, {
      position: 'fixed', right: '1rem', bottom: '1rem', zIndex: '2147483646', maxWidth: '22rem',
      padding: '0.75rem', border: '1px solid currentColor', borderRadius: '0.5rem', background: 'Canvas', color: 'CanvasText',
    })
    return
  }
  Object.assign(section.style, {
    position: 'absolute', width: '1px', height: '1px', padding: '0', margin: '-1px', overflow: 'hidden',
    clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: '0',
  })
}
