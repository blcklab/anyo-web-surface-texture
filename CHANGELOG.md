# 1.0.1-rc.19

- Give a clicked/focused scroll-capable Web Surface exclusive wheel ownership while the pointer is over that same physical surface.
- Install wheel interception on the canvas owner document in capture phase so Player camera zoom listeners on the renderer canvas cannot run first.
- Stop propagation only for the focused hit surface; hovering an unfocused screen keeps normal host camera zoom behavior.
- Allow scroll-capable surfaces to participate in focus ownership even when they do not request keyboard input.
- Keep the package zero-dependency; the focused wheel ownership fix raises the explicit compressed JavaScript ceiling only from 34.5 kB to 34.75 kB (current build ~34.6 kB gzip).

# 1.0.1-rc.18

- Pass stable `primitiveId` identity into host-provided native browser surfaces so a host can safely replace/reclaim stale remote-browser sessions across Loader remounts and page reloads.
- No renderer, texture quality, input, or Web Surface world-schema behavior changes.

# 1.0.1-rc.17

- Add opt-in `texture.rasterScale` supersampling (1.0-2.0) for text-heavy physical Web Surfaces.
- Supersampling increases application framebuffer and uploaded texture density without changing authored world size, UV mapping, or logical layout resolution.
- Keep rasterScale opt-in; existing applications remain byte-for-byte sizing compatible at the default 1.0 scale.

# 1.0.1-rc.16

- Default physical Web Surface textures to sRGB + linear/trilinear mipmapped sampling for cleaner text at oblique angles.
- Add optional QHD (2560×1440) and Ultra (3840×2160) quality tiers while keeping Full HD as the normal high-quality baseline.
- Pair with Sekai64 dev.5 so live WebGPU dynamic textures regenerate mip levels after updates.

## 1.0.1-rc.15 — explicit browser-native overlay routing

- Recognize Anyo `presentation.type: "overlay"` as DOM/iframe-owned presentation and never claim it for texture rendering, even when the registered app also exposes a texture capability.
- Preserve physical `presentation.type: "texture"` ownership and all rc.14 remote-browser behavior unchanged.

## 1.0.1-rc.14 — Provider-backed browser navigation controls

- Add a stable `TextureSurfaceBrowserController` on the texture plugin with `canControl`, `navigate`, `back`, `forward`, and `reload` for mounted native/remote browser-backed physical surfaces.
- Extend the host browser-surface contract with optional navigation/history/reload methods while keeping the package browser-engine agnostic. The package still bundles no Chromium/Electron/CEF/Tauri/remote-browser runtime.
- Navigation failures degrade to bounded `ANYO_TEXTURE_BROWSER_ACTION_FAILED` diagnostics rather than destabilizing the world.
- Keep input, physical texture ownership, fixed logical viewport, GPU distance scaling, and rc.13 primary-click policy unchanged.

## 1.0.1-rc.13 — Normal primary-click host interaction policy

- Add optional `input.pointerButtons` so hosts can reserve secondary mouse buttons for camera/orbit controls while forwarding normal primary-click interaction to Web Surfaces.
- World Loader uses `[0]`: left click interacts with Web Surface content, wheel scroll and keyboard remain scoped to the focused surface, and right-drag stays available for the MMORPG camera.
- Default package behavior remains backward compatible: when `pointerButtons` is omitted, all pointer buttons are forwarded.
- Keep the package lightweight; the explicit compressed JavaScript ceiling moves only from 34.0 kB to 34.5 kB for this host-input policy (current build ~34.1 kB gzip).

## 1.0.1-rc.12 — Atomic GPU uploads and canvas orientation

- Sandboxed canvas texture companions now default to `flipY: true`, matching top-left browser canvas pixels to Sekai64 plane UVs on WebGL2 and WebGPU.
- Adaptive distance/resolution changes no longer install a blank dynamic-texture resize source before a real frame exists. The last good GPU frame remains presented until the next prepared frame is uploaded at the new size.
- Prevents transient black screens, WebGL invalid sub-upload state, and WebGPU `copyExternalImageToTexture` failures from blank context-less resize canvases.
- Explicit `flipY` overrides remain supported.

## 1.0.1-rc.11 — Sekai64 TextureMaterial physical-screen compatibility

- Accept Sekai64 `TextureMaterial` as a native Web Surface plane source in addition to `StandardMaterial`. Renderer-generated snapshot/image fallback planes therefore promote cleanly into live GPU Web Surface textures instead of failing with `ANYO_TEXTURE_MATERIAL_UNSUPPORTED`.
- Promote a `TextureMaterial` source to a live `StandardMaterial` that uses the dynamic Web Surface texture for base color/emissive presentation while preserving side/tint intent and restoring the exact original material when presentation stops.
- Physical screens promoted from `TextureMaterial` default to opaque depth writing unless transparency/opacity is explicitly authored, so VRMs and world geometry in front occlude the screen correctly.
- Add a Sekai64 bridge regression covering the exact renderer fallback-plane material used by the S24 Placement Lab.

## 1.0.1-rc.9 — physical presentation ownership + stable logical viewport

- `presentation.type: "texture"` is now treated as a physical-screen contract. If no texture capability/provider is available, the renderer snapshot/plane stays authoritative and managed DOM overlay fallback is intentionally suppressed so scene depth/occlusion is never faked.
- Explicit `renderMode: "dom-overlay"`, `"snapshot"`, and `"external"` keep their existing generic runtime behavior.
- Texture distance/thermal/memory scaling changes only uploaded GPU output resolution. The application framebuffer/logical viewport remains fixed.
- Added regressions proving unsupported/failed physical texture surfaces never mount DOM and 1920×1080 application framebuffers do not resize when GPU output scales to 960×540 at distance.

## 1.0.1-rc.8

- Add an opt-in sandboxed repository texture companion bridge. A repository app may render its own canvas frames inside an isolated iframe and return `ImageBitmap` frames to the existing Sekai64 dynamic-texture path, so physical screens participate in normal scene depth without granting repository code host-DOM privileges.
- Keep arbitrary HTML/DOM rasterization explicitly unsupported; ordinary pages still use the standards DOM/iframe fallback when no texture companion or native browser provider is available.
- Route companion rendering through the existing Web Surface scheduler and input lifecycle rather than creating a private upload loop.
- Keep zero runtime dependencies; the explicit compressed JavaScript ceiling moves from 32 kB to 34 kB for this isolated bridge (current build ~32.9 kB gzip).

## 1.0.1-rc.7 — S24 repository Web Surface quality + browser-provider boundary

- Add first-class `low` (640×360), `balanced` (960×540), `hd` (1280×720), and `full-hd` (1920×1080) physical quality tiers.
- Separate logical viewport sizing from physical framebuffer sizing and cap DPR so a 1080p request cannot silently become 4K.
- Add generic resolution hysteresis on the existing distance-tier scheduler to prevent 720p/1080p threshold thrashing without reloading applications.
- Add an optional host-provided native-browser provider contract for URL surfaces and host-registered apps carrying a resolved `browserSource.url`. The provider is integration glue only; this package still bundles no browser runtime.
- Forward pointer, wheel, keyboard, text, focus, suspend/resume, resize, and disposal through the provider adapter.
- Preserve standards DOM/iframe fallback when no provider exists or declines a URL; do not claim arbitrary DOM-to-texture rasterization.
- Keep zero runtime dependencies and raise the explicit compressed JavaScript budget from 28 kB to 32 kB for the bounded S24 capability increase; current build is about 30.2 kB gzip.
- Add focused regression coverage for all four quality tiers, bounded DPR, hysteresis, provider capability selection, lifecycle, 1080p sizing, and input forwarding.

## 1.0.1-rc.6

- Restored the complete editable TypeScript repository from the validated `1.0.1-rc.2` source line and the proven rc.3–rc.5 runtime contract.
- Preserved rc.5 replacement-safe world teardown and stable input/maintenance controllers.
- Preserved HD/mobile quality presets and the validated Anyo `0.10.0-rc.1` peer range.
- Added production CI/publish workflows and regression coverage for repeated world setup/teardown.
- Aligned development validation with Anyo `0.10.0-rc.1` and Sekai64 `0.8.0-rc.33`.

## 1.0.1-rc.2 — Sekai64 0.8 compatibility bridge

- Expanded the optional Sekai64 peer range to `>=0.7.0 <0.8.0 || >=0.8.0-0 <0.9.0`.
- Validated texture surfaces against Anyo `0.9.1-rc.2` and Sekai64 `0.8.0-rc.16`.
- Kept the core package free of decoder, animation, environment, and recovery imports.

## 1.0.0 — Stable complete texture-surface capability

- Froze the trusted canvas/framebuffer application, target, presentation, scheduling, input, device, accessibility, performance, recovery, and disposal contracts proven through WS4–WS10.
- Promoted stable Anyo 0.9 and Sekai64 0.7 peer ranges.
- Added an automated stable-contract gate covering runtime exports, public declarations, optional subpaths, peer boundaries, and zero runtime dependencies.
- Preserved the ordinary overlay/snapshot fallback and kept arbitrary cross-origin DOM or iframe capture unsupported.

# Changelog

## 0.6.0 — WS10 Large-world performance and reliability

- Added desktop, mobile, headset, and battery-saver performance presets.
- Added bounded initial and recurring upload scheduling with optional per-app priority.
- Added distance-based resolution and update-frequency scaling without hiding the last native frame.
- Added optional renderer-ray or host-provided occlusion suspension.
- Added host-provided thermal-state policy hooks with fair, serious, and critical degradation.
- Added explicit global/per-surface texture-memory limits and exact-key dynamic-texture pooling.
- Added bounded surface count, bounded diagnostic history, pool statistics, and maintenance controls.
- Added explicit renderer/device recovery and safe stale-resource disposal.
- Added repeated world-replacement and long-running pool tests proving bounded memory/resource creation.
- Preserved one coordinated scheduler, zero runtime dependencies, and the existing lightweight overlay/snapshot fallback.

## 0.5.0 — WS9 Accessibility and semantic companion UI

- Added explicit semantic accessibility descriptors for labels, descriptions, instructions, prompts, controls, and text input.
- Added an optional framework-free DOM companion provider with screen-reader-only and compact modes.
- Added keyboard-navigable non-XR controls that dispatch scoped semantic application actions.
- Added accessible virtual-keyboard labels, live announcements, focus state, reduced-motion, and high-contrast preference delivery.
- Kept raw GPU pixels outside the accessibility tree and preserved texture, input, and fallback behavior.

## 0.4.1

- Added an optional trusted native binding-decoration lifecycle for presentation packages.
- Decorations share the existing texture-surface scheduler through `update(deltaSeconds)`.
- Presentation activation, hiding, restoration, and disposal are forwarded without changing Web Surface input or app contracts.
- Added lifecycle tests proving no private scheduler ownership.


## 0.4.0 — WS7 Curved screens and advanced material targets

- Added output texture resolution independent from the logical application framebuffer.
- Added stretch, contain, and cover policies with shared visual and inverse-input transforms.
- Added normalized offset, scale, and rotation transforms without changing application code.
- Added arbitrary UV-mapped curved meshes, repeated material-slot selection, UV0/UV1 selection, and front/back/double-sided policies.
- Added emissive screen tuning, source-alpha transparency, explicit opacity, and optional named glass overlays.
- Added presentation-change remounting and exact authored-material restoration.
- Kept all advanced behavior optional and preserved the legacy cheapest path.

## 0.3.0 — WS6 Keyboard, gamepad, audio, and companion controls

- Added keyboard forwarding scoped to the focused renderer canvas or an explicit host target.
- Added synthetic key release and focus cleanup on blur, hiding, pause, replacement, and disposal.
- Added focused-surface gamepad snapshots with unchanged-state suppression.
- Added explicit audio focus state that stays muted until a valid user gesture.
- Added host-provided virtual keyboard and touch-control contracts without a UI-framework dependency.
- Preserved Player ownership of device acquisition and application ownership of control mapping.

## 0.2.0 — WS5 UV input and interactive XR surfaces

- Added UV-mapped pointer, touch, XR-controller, and gaze input.
- Added scoped focus, pointer capture, drag, wheel, pointer-lock cooperation, and hidden-surface suppression.

## 0.1.0 — WS4 Texture Surface visual foundation

- Added trusted canvas/framebuffer Web Surface applications.
- Added one coordinated fair scheduler with `on-change`, bounded `fixed-rate`, and bounded `continuous` modes.
- Added plane, named entity-slot, and mesh/material-slot presentation through Sekai64 dynamic textures.
- Added automatic DOM/iframe and snapshot fallback routing without duplicate application mounts.
- Added visibility suspension, pause/resume, first-frame fallback retention, failure isolation, recovery invalidation, and deterministic disposal.
- Added native immersive-XR visual presentation without DOM capture.
- Added the original 160×144 Game Boy monitor integration fixture.
- Preserved zero runtime dependencies and kept UV input, keyboard, gamepad, audio, curved screens, and virtual keyboards out of WS4.

## 1.0.1-rc.10 - S24 paused-world presentation hotfix

- Keep the last successfully uploaded physical GPU frame presented while world controls are paused.
- Pause only Web Surface updates/input; do not swap a physical monitor back to its renderer fallback.
- Allow a visible, not-yet-ready physical surface to render one initial frame even when the world begins paused, then idle until `world:start`.
- Keep `world:stop` as a true presentation teardown boundary.

## S24 rc.12 GPU upload/orientation follow-up

- Sandboxed canvas texture companions default to `flipY: true`, matching top-left browser canvas pixels to Sekai64 plane UVs on both WebGL2 and WebGPU. Explicit `flipY` overrides remain supported.
- Distance/adaptive quality changes no longer call `DynamicTexture.resize()` before a real frame exists. The last valid GPU frame remains presented until the next prepared frame is uploaded at the new size, preventing black-frame flashes and invalid browser external-image/sub-upload races.
- The logical application framebuffer remains fixed; only the prepared GPU upload surface changes size.
