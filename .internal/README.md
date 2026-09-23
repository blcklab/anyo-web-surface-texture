# Maintainer notes

This repository continues the validated `1.0.1-rc.7` S24 Web Surface baseline.

Before release, run `npm install` and `npm run check` on supported Node versions. Keep `.internal/` source-only and excluded from npm publication. rc.8 adds only the explicit sandboxed canvas/ImageBitmap physical-screen companion; arbitrary DOM rasterization remains unsupported and normal HTML continues through the DOM fallback unless a texture companion or host browser provider is available.
