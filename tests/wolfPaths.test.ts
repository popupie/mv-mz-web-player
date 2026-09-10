import { describe, expect, it } from "vitest";
import { normalizeWolfPath, wolfPathKeys } from "../player-runtime/wolfPaths";

describe("WOLF asset paths", () => {
  it("normalizes separators and parent segments", () => {
    expect(normalizeWolfPath("./Data\\MapData/../Picture/title.png")).toBe(
      "Data/Picture/title.png",
    );
  });

  it("matches NFC and NFD Japanese filenames", () => {
    const composed = "Data/Picture/ジャック.png".normalize("NFC");
    const decomposed = composed.normalize("NFD");

    expect(wolfPathKeys(decomposed)).toContain(composed.toLowerCase());
    expect(wolfPathKeys(composed)).toContain(decomposed.toLowerCase());
  });

  it("matches paths with and without the Data root", () => {
    const keys = wolfPathKeys("/tmp/wolf/Data/Fog_BackGround/夜空.jpg");

    expect(keys).toContain("data/fog_background/夜空.jpg".toLowerCase());
  });
});
