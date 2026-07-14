// Site-wide health score + letter grade.
//
// Ported from modules/site_scoring.py (origin/venkataramana-work): an
// Ahrefs-style "Site Health Score" = the percentage of audited pages that have
// zero Critical-or-High severity issues. This is deliberately separate from the
// per-page weighted SEO score (lib/scoring.ts / modules/scoring.py): a site can
// average a decent per-page score yet still have many pages carrying at least
// one serious issue. Computed client-side because audit results live in the
// browser (IndexedDB), not on the stateless serverless backend.

import type { AuditResult } from "@/lib/types";

// A page is "unhealthy" if it carries at least one issue at these severities.
const CRITICAL_SEVERITIES = new Set(["critical", "high"]);

export type HealthGrade = "A" | "B" | "C" | "D" | "F";

export interface SiteScore {
  score: number; // 0..100, one decimal, % of pages with zero critical/high issues
  grade: HealthGrade;
  cleanPages: number;
  totalPages: number;
  criticalPages: number; // pages with >= 1 critical/high issue
}

function hasCriticalIssue(r: AuditResult): boolean {
  return (r.all_issues || []).some((i) =>
    CRITICAL_SEVERITIES.has((i.severity || "").trim().toLowerCase()),
  );
}

/** Ahrefs-style banding: A >=90, B >=80, C >=70, D >=60, else F. */
export function healthGrade(score: number): HealthGrade {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

/** Compute the site health score + letter grade across all audited pages. */
export function siteScore(results: AuditResult[]): SiteScore {
  const totalPages = results.length;
  if (totalPages === 0) {
    return { score: 0, grade: "F", cleanPages: 0, totalPages: 0, criticalPages: 0 };
  }
  let cleanPages = 0;
  for (const r of results) {
    if (!hasCriticalIssue(r)) cleanPages++;
  }
  const score = Math.round((1000 * cleanPages) / totalPages) / 10; // one decimal
  return {
    score,
    grade: healthGrade(score),
    cleanPages,
    totalPages,
    criticalPages: totalPages - cleanPages,
  };
}

/** Display color for a grade (CSS variable), for badges/rings. */
export function gradeColor(grade: HealthGrade): string {
  if (grade === "A" || grade === "B") return "var(--seo-success)";
  if (grade === "C" || grade === "D") return "var(--seo-warning)";
  return "var(--seo-error)";
}
