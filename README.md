# @blcklab/anyo-web-surface-texture

Optional canvas and framebuffer presentation for trusted Anyo Web Surface applications.

The package connects Anyo's renderer-neutral Web Surface targets to Sekai64 dynamic textures without adding DOM, application, emulator, or GPU behavior to Anyo core. It is optional, tree-shakable, and has zero runtime dependencies.

## Install

```bash
npm install @blcklab/anyo-web-surface-texture @blcklab/anyo @blcklab/sekai64
```

Required release-candidate baseline:

```txt
@blcklab/anyo                       >=0.9.1-rc.16 <0.10.0 || >=0.10.0-rc.1 <1.0.0
@blcklab/sekai64                    >=0.7.0 <0.8.0 || >=0.8.0-0 <0.9.0
@blcklab/anyo-web-surface-texture   1.0.1-rc.6
```

## Register a trusted canvas application

```ts
import { createWebSurfaceAppRegistry } from '@blcklab/anyo/web-surface'
import { textureWebSurfacePlugin } from '@blcklab/anyo-web-surface-texture'
import { createSekai64TextureSurfaceBridge } from '@blcklab/anyo-web-surface-texture/sekai64'

const registry = createWebSurfaceAppRegistry()

registry.register('status-screen', {
  texture: {
    width: 320,
    height: 180,
    minFilter: 'nearest',
    magFilter: 'nearest',
  },

  mount(container) {
    container.textContent = 'This DOM presentation is the automatic fallback.'
    return { dispose() { container.replaceChildren() } }
  },

  createTextureSurface(canvas, props, context) {
    const drawing = canvas.getContext('2d')

    return {
      render(nextProps) {
        drawing?.clearRect(0, 0, canvas.width, canvas.height)
        drawing?.fillText(String(nextProps.label ?? 'Ready'), 16, 28)
      },
      update() {
        context.invalidate()
      },
      dispose() {},
    }
  },
})

const texturePlugin = textureWebSurfacePlugin({
  registry,
  createBridge: renderer => createSekai64TextureSurfaceBridge(renderer),
  maxUploadsPerFrame: 4,
  maxFps: 60,
})
```

Install `texturePlugin` in the same Anyo world that owns the target surfaces. The package uses one coordinated scheduler; applications must not create a permanent animation loop merely to upload frames.

## Player usage

Anyo Player `0.3.0-rc.12` accepts trusted host plugins:

```ts
import { createAnyoPlayer } from '@blcklab/anyo-player'

const player = createAnyoPlayer({
  container,
  source: '/world.anyo.json',
  webSurface: false,
  plugins: [texturePlugin],
})

await player.load()
```

Set `webSurface: false` because the texture plugin owns both native texture presentation and ordinary DOM/iframe fallback. This prevents two Web Surface runtimes from mounting the same trusted application.

## Update policies

World JSON can use the existing renderer-neutral frame policy:

```json
{
  "type": "web-surface",
  "source": { "type": "app", "app": "status-screen" },
  "presentation": {
    "frame": { "mode": "on-change" }
  },
  "target": { "type": "entity-slot", "entity": "$parent/body", "slot": "screen" }
}
```

Supported update policies:

- `on-change`: uploads after initial render and explicit invalidation.
- `fixed-rate`: bounded by the surface rate and global `maxFps`.
- `continuous`: bounded and fairly scheduled; it never receives an unlimited private loop.

## Large-world performance policy

WS10 keeps the last uploaded native frame visible while suspending expensive application work. Hosts can choose a compact preset and override only proven constraints:

```ts
const texturePlugin = textureWebSurfacePlugin({
  registry,
  createBridge: renderer => createSekai64TextureSurfaceBridge(renderer),
  performance: {
    preset: 'headset',
    maxSurfaces: 32,
    maxTextureBytes: 160 * 1024 * 1024,
    maxTextureBytesPerSurface: 20 * 1024 * 1024,
    distanceTiers: [
      { maxDistance: 4, resolutionScale: 1, fpsScale: 1 },
      { maxDistance: 10, resolutionScale: 0.7, fpsScale: 0.6 },
      { maxDistance: 22, resolutionScale: 0.45, fpsScale: 0.3 },
      { maxDistance: Infinity, resolutionScale: 0.3, fpsScale: 0.1, suspend: true },
    ],
    pool: { maxEntries: 6, maxBytes: 32 * 1024 * 1024 },
    occlusion: { mode: 'renderer-ray', intervalMs: 250 },
    thermal: { getState: () => headsetThermalState },
  },
})
```

Available presets are `desktop`, `mobile`, `headset`, and `battery-saver`. Distance tiers scale only the uploaded texture and scheduler rate; the trusted application keeps its logical framebuffer dimensions. When a surface is distance-, occlusion-, or thermal-suspended, input, audio, and app rendering pause but its last valid native frame remains in the scene.

Applications can observe the resolved policy without owning global resource decisions:

```ts
createTextureSurface(canvas, props, context) {
  return {
    setPerformanceState(state) {
      // Optional: lower internal simulation cost or pause app-specific work.
      console.log(state.distance, state.resolutionScale, state.suspended)
    },
    dispose() {},
  }
}
```

Operational state and explicit recovery are available through `texturePlugin.maintenance.stats`, `trimPool()`, and `recover()`. Recovery disposes stale GPU resources rather than returning them to the pool. Occlusion and thermal checks are optional; the package never starts a background polling loop.

## Supported native targets

- legacy or explicit plane target;
- named `entity-slot` target through `anyo.surface-host`;
- named mesh target with a material-slot index;
- desktop and immersive-XR native scene presentation.

Semantic wall targets keep using overlay or snapshot fallback. Arbitrary UV-mapped curved geometry is supported through mesh and entity-slot targets.

## Interactive surfaces

WS5 maps desktop, touch, XR-controller, and gaze rays through Sekai64 hit UVs into logical application pixels. Input is delivered only to the nearest active surface and never exposes renderer meshes or DOM events to the app.

```ts
createTextureSurface(canvas, props, context) {
  return {
    handleInput(event) {
      if (event.type === 'pointer' && event.phase === 'down') {
        console.log(event.uv, event.pixel)
        context.input.capturePointer(event.pointerId)
      }
    },
    dispose() {},
  }
}
```

The host can forward XR controller or gaze rays through `runtime.input.dispatchRay(...)`. Focus, capture, pointer-lock cooperation, and hidden-surface suppression remain scoped to one surface.

## Accessibility companion UI

Raw framebuffer pixels are not exposed as accessible content. Trusted applications provide an explicit semantic companion contract instead:

```ts
registry.register('status-screen', {
  accessibility: props => ({
    label: String(props.label ?? 'Status screen'),
    description: 'Live system status rendered on the 3D monitor.',
    instructions: 'Focus the screen or use the companion controls.',
    prompt: 'Press Focus to interact.',
    contrast: 'high',
    controls: [
      { id: 'refresh', label: 'Refresh status', action: 'refresh' },
    ],
    textInput: { label: 'Status query', placeholder: 'Type a query' },
  }),
  createTextureSurface(canvas, props, context) {
    return {
      handleInput(event) {
        if (event.type === 'control' && event.source === 'accessibility') {
          // Map the semantic action inside the trusted application.
        }
      },
      setAccessibilityPreferences({ reducedMotion, highContrast }) {
        // Adjust application rendering without changing world JSON.
      },
      dispose() {},
    }
  },
})

const texturePlugin = textureWebSurfacePlugin({
  registry,
  createBridge: renderer => createSekai64TextureSurfaceBridge(renderer),
  accessibility: { mode: 'compact' },
})
```

The default DOM provider is framework-free and optional. Hosts may supply their own `TextureSurfaceAccessibilityCompanionProvider`, disable companion DOM with `accessibility: false`, or keep the default visually-hidden screen-reader representation.

## Keyboard, gamepad, audio, and companion controls

Applications opt into devices explicitly:

```ts
registry.register('emulator', {
  devices: { gamepad: true, audio: true, textInput: true },
  createTextureSurface(canvas, props, context) {
    context.input.setTouchControls([
      { id: 'a', label: 'A', action: 'button-a', position: 'right' },
    ])

    return {
      handleInput(event) {
        // Map keyboard, gamepad, text, pointer, or touch-control intent.
      },
      setAudioState({ muted }) {
        // The host app owns its audio graph; obey the scoped mute state.
      },
      dispose() {},
    }
  },
})
```

Player or the host owns global device acquisition. Supply `getGamepads`, a virtual-keyboard provider, or touch-control provider through plugin `input` options; the texture package never calls `navigator.getGamepads()` by itself. Audio remains muted until a real pointer, touch, XR, keyboard, or companion-control gesture and mutes immediately on blur, hiding, pause, or disposal.

## Curved screens and presentation tuning

WS7 adds optional JSON-safe presentation intent without changing the registered application:

```json
{
  "type": "web-surface",
  "webSurface": {
    "source": { "type": "app", "app": "dashboard" },
    "target": {
      "type": "mesh",
      "entity": "$parent/body",
      "mesh": "CurvedPanel",
      "materialSlot": 0,
      "uvSet": 1
    },
    "presentation": {
      "type": "texture",
      "resolution": [640, 360],
      "fit": "contain",
      "transform": {
        "offset": [0, 0],
        "scale": [1, 1],
        "rotation": 0
      },
      "side": "double",
      "emissive": {
        "color": "#66ccff",
        "intensity": 2.5,
        "useTexture": true
      },
      "transparent": false,
      "opacity": 1,
      "glass": {
        "mesh": "ScreenGlass",
        "materialSlot": 0,
        "opacity": 0.2
      }
    }
  }
}
```

`resolution` controls the uploaded texture while the application keeps its own logical framebuffer dimensions. `contain`, `cover`, normalized offset/scale, and rotation use one invertible transform, so pointer, touch, and XR input still reaches the correct logical pixel. Empty contain bars do not intercept input.

Curved screens require ordinary UV-mapped geometry; no curved-screen application API exists. Repeated mesh primitives provide material-slot selection, `uvSet` selects UV0 or UV1, and the bridge restores the exact authored screen and glass materials when presentation stops.

## Fallback and lifecycle

- Texture-capable applications are claimed before DOM fallback can mount them.
- Applications without `createTextureSurface()` use the normal DOM/iframe path.
- Unsupported renderer targets and failed frame rendering release the texture claim and activate exactly one fallback.
- The snapshot remains visible until the first successful upload.
- Hidden rooms and paused worlds suspend rendering and uploads.
- Native textures remain in the scene during immersive XR.
- Disposal restores authored materials and visibility exactly once.

## Security boundary

Only trusted host code can register applications. World JSON never contains functions, executable HTML, ROM bytes, save data, authentication state, or private application state. Arbitrary cross-origin websites and ordinary iframes are not captured as GPU textures.

## Game Boy monitor proof

`examples/gameboy-monitor` contains an original monitor GLB with a named `DisplayPanel`, a 160×144 host framebuffer adapter, nearest-neighbor texture settings, snapshot fallback, and a deterministic visual fixture.

The fixture is not an emulator and contains no ROM. A real emulator remains host-owned and can implement the same framebuffer interface.

See [STABILITY.md](./STABILITY.md) for the frozen 1.0 contract.

## Compatibility

This release does not add a mandatory method to Anyo's renderer interface and does not modify Sekai64. The Sekai64 bridge uses an additive native-access method exposed only by Anyo's concrete Sekai64 adapter.

## Optional presentation decoration

Trusted optional presentation packages may extend a native Sekai64 binding through `decorateBinding`. The decoration receives the resolved mesh, original/live materials, dynamic texture, UV set, presentation intent, and narrow native access. Its `update` hook is called by the existing texture-surface scheduler only while presented; it must not create a private animation loop.

```ts
const bridge = createSekai64TextureSurfaceBridge(renderer, {
  decorateBinding(context) {
    return {
      setPresented(presented) {},
      update(deltaSeconds) {},
      dispose() {},
    }
  },
})
```


## Production lifecycle

The plugin is safe to reuse across Anyo world replacement. `teardown()` releases the current world generation while keeping the plugin object, input controller, and maintenance controller reusable. `dispose()` is terminal and should be called only when the host itself is being destroyed.

For text-heavy dashboards, start with `HD_UI_TEXTURE_SURFACE_OPTIONS`; for mobile-class devices use `MOBILE_UI_TEXTURE_SURFACE_OPTIONS`. Both presets keep one host-owned texture path with sRGB sampling, mipmaps, and the correct canvas orientation.

The package intentionally keeps zero runtime dependencies. Anyo and Sekai64 remain peer dependencies so the host owns the exact engine versions.
