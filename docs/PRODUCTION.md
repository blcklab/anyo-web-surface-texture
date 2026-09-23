# Production use

`@blcklab/anyo-web-surface-texture` is an optional host integration for trusted canvas/framebuffer applications rendered onto Anyo world surfaces.

## Host ownership

The host owns Anyo, Sekai64, application registration, global input acquisition, and lifecycle. The package has no runtime dependencies of its own.

## World replacement

Use one plugin object per host. Anyo may call `teardown()` between worlds; the plugin creates a fresh texture runtime on the next `setup()` while keeping its public input and maintenance controllers stable. Call `dispose()` only when the host is permanently shutting down.

## Quality presets

Use the S24 quality presets for bounded physical allocations: `low` 640×360, `balanced` 960×540, `hd` 1280×720, and `full-hd` 1920×1080. The legacy `HD_UI_TEXTURE_SURFACE_OPTIONS` and `MOBILE_UI_TEXTURE_SURFACE_OPTIONS` exports remain compatible. Device-pixel ratio changes logical viewport sizing only and cannot automatically turn Full HD into 4K. Distance tiers and `resolutionHysteresis` control presentation scaling without recreating application instances.

## Security boundary

Only trusted host code registers texture-capable applications. World JSON does not contain executable application functions, and arbitrary cross-origin page capture is not promised.

For URL surfaces, a host may inject the generic native-browser provider. The provider is optional and owns its browser engine outside this package. Without it, normal DOM/iframe policy applies; embedding headers and browser security are not bypassed. Repository-hosted pages remain ordinary web applications and are not treated as privileged host code.
