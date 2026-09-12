# Production use

`@blcklab/anyo-web-surface-texture` is an optional host integration for trusted canvas/framebuffer applications rendered onto Anyo world surfaces.

## Host ownership

The host owns Anyo, Sekai64, application registration, global input acquisition, and lifecycle. The package has no runtime dependencies of its own.

## World replacement

Use one plugin object per host. Anyo may call `teardown()` between worlds; the plugin creates a fresh texture runtime on the next `setup()` while keeping its public input and maintenance controllers stable. Call `dispose()` only when the host is permanently shutting down.

## Quality presets

Use `HD_UI_TEXTURE_SURFACE_OPTIONS` for text-heavy desktop surfaces and `MOBILE_UI_TEXTURE_SURFACE_OPTIONS` where a smaller texture budget is preferable.

## Security boundary

Only trusted host code registers texture-capable applications. World JSON does not contain executable application functions, and arbitrary cross-origin page capture is not promised.
