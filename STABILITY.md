# Web Surface Texture 1.0 Stability Contract

Version 1.0.0 freezes the optional trusted texture-surface API.

## Stable guarantees

- Trusted apps opt in with `createTextureSurface`; existing DOM-only apps remain valid.
- Plane, wall fallback, entity-slot, mesh/material-slot, UV-set, fit, transform, side, emissive, transparency, and glass intent remain additive.
- Pointer, touch, keyboard, gamepad snapshots, audio focus, text input, XR ray, and gaze remain scoped to one focused surface.
- Raw pixels are not declared accessible; semantic companion data remains explicit.
- One coordinated scheduler owns bounded uploads. Hidden, distant, occluded, thermally suspended, or memory-limited surfaces cannot upload without bounds.
- Dynamic textures, listeners, focus, audio, companion DOM, decorations, and materials are restored or disposed deterministically.
- Arbitrary cross-origin webpages are never promised as readable GPU textures.

Breaking application, input, accessibility, performance, bridge, or disposal contracts require a new major release.
