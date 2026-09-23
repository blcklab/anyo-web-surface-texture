# Web Surface Texture 1.0 Stability Contract

Version 1.0.0 freezes the optional trusted texture-surface API.

## Stable guarantees

- Trusted apps opt in with `createTextureSurface`; existing DOM-only apps remain valid.
- Plane, wall fallback, entity-slot, mesh/material-slot, UV-set, fit, transform, side, emissive, transparency, and glass intent remain additive.
- Pointer, focused wheel, touch, keyboard, gamepad snapshots, audio focus, text input, XR ray, and gaze remain scoped to one focused surface.
- Raw pixels are not declared accessible; semantic companion data remains explicit.
- One coordinated scheduler owns bounded uploads. Hidden, distant, occluded, thermally suspended, or memory-limited surfaces cannot upload without bounds.
- Dynamic textures, listeners, focus, audio, companion DOM, decorations, and materials are restored or disposed deterministically.
- Arbitrary cross-origin webpages are never promised as readable GPU textures. App-authored sandboxed canvas companions may opt into real texture presentation without turning arbitrary DOM capture into a guarantee.

Breaking application, input, accessibility, performance, bridge, or disposal contracts require a new major release.

- **Physical texture ownership:** `presentation.type: "texture"` never silently degrades to a managed DOM overlay. Unsupported hosts preserve renderer snapshot/plane presentation.
- **Logical viewport isolation:** performance scaling may resize the uploaded texture but must not resize the application framebuffer/logical layout viewport.

## S24 rc.12 GPU upload/orientation follow-up

- Sandboxed canvas texture companions default to `flipY: true`, matching top-left browser canvas pixels to Sekai64 plane UVs on both WebGL2 and WebGPU. Explicit `flipY` overrides remain supported.
- Distance/adaptive quality changes no longer call `DynamicTexture.resize()` before a real frame exists. The last valid GPU frame remains presented until the next prepared frame is uploaded at the new size, preventing black-frame flashes and invalid browser external-image/sub-upload races.
- The logical application framebuffer remains fixed; only the prepared GPU upload surface changes size.

- `TextureSurfaceInputOptions.pointerButtons` is an additive host policy. Omission preserves all-button forwarding; `[0]` is the recommended desktop game-host policy for primary-click web interaction plus right-drag camera control.


## rc.14 browser controller

- `TextureWebSurfacePlugin.browser` is a stable host-control facade for provider-backed physical browser surfaces.
- The package delegates navigation/history/reload to the provider and does not own URL allowlists, browser processes, cookies, or host network policy.
- Provider/action failure is isolated to the addressed surface and reported diagnostically.


- `TextureSurfaceRegistrationOptions.rasterScale` is additive and defaults to 1. Existing texture registrations preserve their previous physical dimensions.
