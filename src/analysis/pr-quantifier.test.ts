import { describe, it, expect } from "vitest";
import { classifyPrSize } from "./pr-quantifier.js";
import type { SizeThreshold } from "../types.js";

describe("classifyPrSize", () => {
  it("classifies 0 changes as XS", () => {
    expect(classifyPrSize(0)).toBe("XS");
  });

  it("classifies exactly 10 changes as XS", () => {
    expect(classifyPrSize(10)).toBe("XS");
  });

  it("classifies 11 changes as S", () => {
    expect(classifyPrSize(11)).toBe("S");
  });

  it("classifies exactly 40 changes as S", () => {
    expect(classifyPrSize(40)).toBe("S");
  });

  it("classifies 41 changes as M", () => {
    expect(classifyPrSize(41)).toBe("M");
  });

  it("classifies exactly 100 changes as M", () => {
    expect(classifyPrSize(100)).toBe("M");
  });

  it("classifies 101 changes as L", () => {
    expect(classifyPrSize(101)).toBe("L");
  });

  it("classifies exactly 400 changes as L", () => {
    expect(classifyPrSize(400)).toBe("L");
  });

  it("classifies 401 changes as XL", () => {
    expect(classifyPrSize(401)).toBe("XL");
  });

  it("classifies exactly 1000 changes as XL", () => {
    expect(classifyPrSize(1000)).toBe("XL");
  });

  it("classifies changes exceeding all thresholds as last label", () => {
    expect(classifyPrSize(5000)).toBe("XL");
  });

  it("uses custom thresholds when provided", () => {
    const custom: SizeThreshold[] = [
      { label: "S", maxChanges: 50 },
      { label: "L", maxChanges: 200 },
    ];
    expect(classifyPrSize(25, custom)).toBe("S");
    expect(classifyPrSize(50, custom)).toBe("S");
    expect(classifyPrSize(51, custom)).toBe("L");
    expect(classifyPrSize(200, custom)).toBe("L");
    expect(classifyPrSize(201, custom)).toBe("L");
  });

  it("handles unsorted thresholds", () => {
    const unsorted: SizeThreshold[] = [
      { label: "L", maxChanges: 400 },
      { label: "XS", maxChanges: 10 },
      { label: "M", maxChanges: 100 },
    ];
    expect(classifyPrSize(5, unsorted)).toBe("XS");
    expect(classifyPrSize(50, unsorted)).toBe("M");
    expect(classifyPrSize(200, unsorted)).toBe("L");
  });
});
