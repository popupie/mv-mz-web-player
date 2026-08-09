import { describe, expect, it } from "vitest";
import { detectNativeGameSize } from "../player-runtime/bridge/viewport";

describe("game viewport size detection", () => {
  it("prefers RPG Maker Graphics dimensions", () => {
    expect(
      detectNativeGameSize({
        graphics: { width: 816, height: 624 },
        tyranoConfig: { scWidth: "1280", scHeight: "720" },
        canvas: { width: 640, height: 480 },
      }),
    ).toEqual({ width: 816, height: 624 });
  });

  it("detects Tyrano dimensions from its loaded config", () => {
    expect(
      detectNativeGameSize({
        graphics: undefined,
        tyranoConfig: { scWidth: "1280", scHeight: "720" },
        canvas: undefined,
      }),
    ).toEqual({ width: 1280, height: 720 });
  });

  it("uses an actual canvas size for other browser games", () => {
    expect(
      detectNativeGameSize({
        graphics: undefined,
        tyranoConfig: undefined,
        canvas: { width: 960, height: 540 },
      }),
    ).toEqual({ width: 960, height: 540 });
  });

  it("does not invent a viewport size before the game exposes one", () => {
    expect(
      detectNativeGameSize({
        graphics: undefined,
        tyranoConfig: undefined,
        canvas: undefined,
      }),
    ).toBeNull();
  });
});
