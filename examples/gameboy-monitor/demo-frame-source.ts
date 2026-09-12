import {
  GAME_BOY_HEIGHT,
  GAME_BOY_WIDTH,
  type GameBoyFrameSource,
} from './gameboy-app.js'

/** Deterministic visual fixture only. Replace this factory with a real host-owned JavaScript emulator. */
export function createDemoFrameSource(): GameBoyFrameSource {
  const rgba = new Uint8ClampedArray(GAME_BOY_WIDTH * GAME_BOY_HEIGHT * 4)
  let frame = 0
  let paused = false

  function runFrame(): void {
    if (paused) return
    frame += 1
    for (let y = 0; y < GAME_BOY_HEIGHT; y += 1) {
      for (let x = 0; x < GAME_BOY_WIDTH; x += 1) {
        const index = (y * GAME_BOY_WIDTH + x) * 4
        const band = (x + Math.floor(frame / 2)) % GAME_BOY_WIDTH
        const sprite = Math.abs(x - (frame % GAME_BOY_WIDTH)) < 10 && Math.abs(y - 72) < 10
        const shade = sprite ? 248 : band < 40 ? 224 : band < 80 ? 160 : band < 120 ? 96 : 40
        rgba[index] = Math.round(shade * 0.64)
        rgba[index + 1] = shade
        rgba[index + 2] = Math.round(shade * 0.58)
        rgba[index + 3] = 255
      }
    }
  }

  return {
    rgba,
    runFrame,
    pause() { paused = true },
    resume() { paused = false },
    dispose() { rgba.fill(0) },
  }
}
