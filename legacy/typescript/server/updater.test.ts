import { describe, expect, test } from "bun:test";
import { compareVersions, parseVersion } from "./updater.ts";

describe("updater", () => {
  describe("compareVersions", () => {
    test("equal versions return 0", () => {
      expect(compareVersions("0.1.0", "0.1.0")).toBe(0);
    });

    test("newer major version returns positive", () => {
      expect(compareVersions("1.0.0", "0.1.0")).toBeGreaterThan(0);
    });

    test("newer minor version returns positive", () => {
      expect(compareVersions("0.2.0", "0.1.0")).toBeGreaterThan(0);
    });

    test("newer patch version returns positive", () => {
      expect(compareVersions("0.1.1", "0.1.0")).toBeGreaterThan(0);
    });

    test("older version returns negative", () => {
      expect(compareVersions("0.1.0", "0.2.0")).toBeLessThan(0);
    });

    test("handles different length versions", () => {
      expect(compareVersions("1.0", "1.0.0")).toBe(0);
      expect(compareVersions("1.0.1", "1.0")).toBeGreaterThan(0);
    });
  });

  describe("parseVersion", () => {
    test("strips v prefix", () => {
      expect(parseVersion("v0.2.0")).toBe("0.2.0");
    });

    test("handles version without prefix", () => {
      expect(parseVersion("0.2.0")).toBe("0.2.0");
    });
  });
});
