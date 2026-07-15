import { describe, expect, it } from "vitest";
import { detectFixTarget } from "@/lib/fixSuggestable";

describe("detectFixTarget", () => {
  it("matches meta title issues", () => {
    expect(detectFixTarget("Missing Meta Title")).toBe("title");
    expect(detectFixTarget("Meta Title Too Short")).toBe("title");
    expect(detectFixTarget("Meta Title Too Long")).toBe("title");
  });

  it("matches meta description issues", () => {
    expect(detectFixTarget("Missing Meta Description")).toBe("description");
    expect(detectFixTarget("Meta Description Too Long")).toBe("description");
  });

  it("matches H1 issues", () => {
    expect(detectFixTarget("Missing H1 heading")).toBe("h1");
    expect(detectFixTarget("H1 heading is too short (12 chars)")).toBe("h1");
  });

  it("returns null for unsupported issues", () => {
    expect(detectFixTarget("Broken Internal Link")).toBeNull();
    expect(detectFixTarget("Missing Alt Text")).toBeNull();
  });
});
