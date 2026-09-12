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
