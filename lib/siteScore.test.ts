import { describe, expect, it } from "vitest";
import { gradeColor, healthGrade, siteScore } from "./siteScore";
import type { AuditResult } from "@/lib/types";

const page = (severities: string[]): AuditResult =>
  ({
    url: "https://example.com/",
    all_issues: severities.map((severity) => ({
      issue: "x",
      category: "On-Page",
      severity,
      recommendation: "",
      impact_score: 5,
      effort: "Low",
    })),
  }) as unknown as AuditResult;

describe("siteScore", () => {
  it("returns a zeroed F for no pages", () => {
    expect(siteScore([])).toEqual({ score: 0, grade: "F", cleanPages: 0, totalPages: 0, criticalPages: 0 });
  });

  it("scores 100 (A) when every page is free of critical/high issues", () => {
    const s = siteScore([page([]), page(["Medium", "Warning", "Low"])]);
    expect(s.score).toBe(100);
    expect(s.grade).toBe("A");
    expect(s.cleanPages).toBe(2);
    expect(s.criticalPages).toBe(0);
  });

  it("counts a page with any Critical OR High issue as unhealthy", () => {
    const s = siteScore([page(["Critical"]), page(["High"]), page([]), page([])]);
    expect(s.score).toBe(50);
    expect(s.cleanPages).toBe(2);
    expect(s.criticalPages).toBe(2);
  });

  it("is case-insensitive on severity", () => {
    expect(siteScore([page(["critical"]), page([])]).score).toBe(50);
  });

  it("rounds to one decimal", () => {
    // 2 clean of 3 -> 66.666... -> 66.7
    expect(siteScore([page([]), page([]), page(["High"])]).score).toBe(66.7);
  });
});

describe("healthGrade", () => {
  it("bands A/B/C/D/F on Ahrefs-style thresholds", () => {
    expect(healthGrade(95)).toBe("A");
    expect(healthGrade(90)).toBe("A");
    expect(healthGrade(85)).toBe("B");
    expect(healthGrade(72)).toBe("C");
    expect(healthGrade(60)).toBe("D");
    expect(healthGrade(59.9)).toBe("F");
    expect(healthGrade(0)).toBe("F");
  });
});

describe("gradeColor", () => {
  it("maps grades to success/warning/error", () => {
    expect(gradeColor("A")).toContain("success");
    expect(gradeColor("C")).toContain("warning");
    expect(gradeColor("F")).toContain("error");
  });
});
