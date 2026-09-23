# MEMORY

## S24 rc.8 — sandboxed physical-screen companion
- Added `createSandboxedCanvasTextureCapability()` and protocol `anyo-sandboxed-texture@1`.
- Repository code stays inside an iframe sandbox; it returns app-authored `ImageBitmap` frames instead of executing as host code.
- This creates a true Sekai64 texture with normal depth/occlusion.
- Arbitrary DOM-to-texture rasterization remains intentionally unsupported.
- Ordinary repository HTML remains available as the DOM fallback; native browser providers remain the full-browser texture path.

## Validation status
- `npm run check` passes with 43/43 package tests, export/stability/boundary gates, 32.9 kB gzip size, and npm dry-run pack.
- Real Chromium validation could not complete in the container because ANGLE/EGL initialization fails; browser acceptance remains a normal-machine gate.

## S24 rc.9 — physical ownership freeze
- `presentation.type: "texture"` is now a hard physical-screen boundary for the optional texture plugin. If texture capability fails or is unavailable, preserve the renderer snapshot/plane; do not auto-mount DOM.
- Explicit `renderMode: "dom-overlay"` remains the opt-in browser overlay path.
- Camera distance/performance scaling is GPU-output-only. App logical framebuffer dimensions remain fixed.
- Regression coverage proves a 1920×1080 app does not resize when output adapts to 960×540.

### 2026-09-21 — rc.10 paused-world presentation ownership
- `world:pause` no longer hides an already-ready physical Web Surface texture. It only gates runtime work/input.
- A visible unready physical surface may render exactly one initial frame while paused so the Enter-world overlay never exposes the static fallback solely because controls are paused.
- `world:stop`, visibility changes, failures, and disposal still release presentation ownership normally.

### 2026-09-21 — rc.11 TextureMaterial physical-screen compatibility
- Real Chrome validation exposed `ANYO_TEXTURE_MATERIAL_UNSUPPORTED` because Anyo/Sekai64 renderer-generated snapshot planes use Sekai64 `TextureMaterial`, while the optional bridge accepted only `StandardMaterial`.
- The native bridge now accepts both. A `TextureMaterial` fallback plane is promoted to a live depth-writing `StandardMaterial` carrying the dynamic Web Surface texture; the exact authored `TextureMaterial` is restored on hide/dispose.
- TextureMaterial-derived physical screens default to opaque/depthWrite=true unless transparency or opacity is explicitly authored. This prevents the fallback material's default transparency from defeating scene occlusion.
- No Sekai64 source change is required.

## S24 rc.12 GPU upload/orientation follow-up

- Sandboxed canvas texture companions default to `flipY: true`, matching top-left browser canvas pixels to Sekai64 plane UVs on both WebGL2 and WebGPU. Explicit `flipY` overrides remain supported.
- Distance/adaptive quality changes no longer call `DynamicTexture.resize()` before a real frame exists. The last valid GPU frame remains presented until the next prepared frame is uploaded at the new size, preventing black-frame flashes and invalid browser external-image/sub-upload races.
- The logical application framebuffer remains fixed; only the prepared GPU upload surface changes size.


## S24 rc.13 — normal primary-click interaction
- Add `input.pointerButtons`; Loader uses `[0]` so left click belongs to Web Surface interaction while right-drag remains camera orbit.
- Wheel and keyboard stay routed to the focused Web Surface.
- Default package behavior stays compatible when the option is omitted: all buttons are forwarded.

## S24 rc.14 — provider browser controls
- Expose `plugin.browser` with `canControl`, `navigate`, `back`, `forward`, and `reload` for mounted provider-backed physical browser surfaces.
- The package remains browser-engine agnostic; World Loader dev.70 supplies the optional remote Chromium/CDP implementation.
- Network/site trust remains host-owned and does not enter world JSON or the package runtime.

## 2026-09-22 — rc.15 explicit overlay routing
- Anyo `presentation.type: "overlay"` is owned by the managed browser DOM/iframe runtime, not the physical texture runtime.
- Apps may expose both DOM and texture capabilities; explicit overlay always chooses DOM, explicit texture keeps physical scene-depth behavior.
- Remote Chromium/provider browser behavior from rc.14 is unchanged.

## 2026-09-22 — rc.16 physical texture quality pass
- Physical Web Surface defaults are now sRGB, linear magnification, trilinear minification, and generated mipmaps unless an app explicitly overrides sampling.
- Add opt-in `qhd` (2560×1440) and `ultra` (3840×2160) quality tiers. Full HD remains the recommended/default high-quality target; 4K is for large hero displays only.
- Sekai64 dev.5 removes the stale WebGPU dynamic-mipmap downgrade and regenerates the mip chain after live updates. Renderer anisotropy remains global policy and reaches 16x under the Loader character visual profile.


## 2026-09-22 rc.17 supersampled physical raster
- Add opt-in `texture.rasterScale` (1-2) for physical Web Surface applications.
- Raster scale multiplies application framebuffer and authored texture-presentation output only; world geometry, target size, UV semantics, and base logical layout stay unchanged.
- Existing apps remain at 1x unless they opt in. Performance/memory policies remain authoritative and may reduce uploaded output.

## 2026-09-22 rc.18 remote-browser session identity
- Native browser provider requests now include the mounted Anyo `primitiveId`. Host implementations may use it with their own per-tab/page identity to replace stale sessions safely across remounts/reloads.
- Session limits/lifecycle remain host infrastructure; this package still does not own Chromium or remote-browser policy.


## 2026-09-22 rc.19 focused wheel ownership
- Wheel input is now click/focus-gated: an unfocused Web Surface never steals camera zoom merely because the pointer crosses it.
- When the pointer is over the currently focused scroll-capable physical surface, the package intercepts the wheel at document capture phase, forwards it to that surface, prevents default behavior, and stops propagation before Player camera listeners on the renderer canvas.
- Scroll capability now counts as focus-capable even without keyboard intent. `preventWheelDefault: false` remains the explicit opt-out for hosts that want shared wheel behavior.
- Anyo, Sekai64 and Player remain unchanged; this is a Web Surface input-ownership boundary fix.
- Size ceiling moves narrowly from 34.5 kB to 34.75 kB gzip for the document-capture ownership path; zero runtime dependencies remain.

## 2026-09-23 — published baseline → frozen S24 reconciliation
- Supplied published baseline: `1.0.1-rc.6`.
- Frozen S24 implementation baseline: `1.0.1-rc.19`.
- Runtime/source behavior follows the frozen S24 handoff; target-only useful docs/examples/tests and repository release identity were preserved where a target baseline was supplied.
- No post-S24 Web Surface/browser features were added.
- Development pins between BLCKLAB packages were aligned to the reconciled S24 versions; release packages remain peer-dependency based.
- `.internal/` is repository-only and must remain excluded from npm package contents.
- Validation status for this reconciliation is recorded in the final validation report; real GPU/browser/VRM checks remain a separate real-machine gate.
## 2026-09-23 — S24 published-baseline reconciliation validation
- Published baseline supplied: `1.0.1-rc.6`; reconciled frozen S24 version: `1.0.1-rc.19`.
- Runtime `src/` remains byte-identical to frozen S24; no post-S24 Web Surface functionality was introduced.
- Automated validation: full `npm run check` PASS; 57/57 tests PASS; export/stability/boundary/size/package gates PASS; final `npm pack --dry-run` PASS.
- Focused wheel ownership, borderless presentation contracts, browser-provider boundary, and quality policy stay frozen at rc.19.
- Real Chromium/video/fullscreen and WebGPU/WebGL2 presentation validation remains a real-machine gate.


## S24 release-version normalization — 2026-09-23

- Final release-clean S24 version: `1.0.1-rc.19`.
- Runtime/source architecture remains the frozen S24 implementation; this step only normalizes publishable version metadata and cross-package pins.
- Do not reintroduce internal development suffixes into the public release line.
- Re-run the package's normal release checks and real-machine integration gates before npm publication.
