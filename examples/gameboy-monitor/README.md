# Game Boy monitor proof

This is the WS4 visual acceptance fixture:

- host-owned 160×144 RGBA framebuffer;
- one texture package scheduler;
- Sekai64 dynamic texture;
- named `DisplayPanel` monitor slot;
- depth-tested native scene presentation on desktop and immersive XR;
- snapshot/DOM fallback when texture presentation is unavailable;
- pause/resume when the room or world is inactive;
- nearest-neighbor filtering and explicit disposal.

The included `createDemoFrameSource()` is a deterministic framebuffer fixture, not an emulator. Replace it with a host-owned JavaScript Game Boy emulator through `createGameBoyFramebufferApp(() => emulatorAdapter)`. ROM bytes, save data, audio, and private state must remain in host code and must never be serialized into the world document.

This milestone intentionally has no keyboard, touch, gamepad, audio, pointer, UV, or XR-ray forwarding. Those begin in WS5 and WS6.

Run the example through a TypeScript-capable dev server such as Vite from the package root. The included `monitor.glb` is a small original fixture with a named `DisplayPanel` mesh.
