import { useState, type CSSProperties, type ReactNode } from "react";
import { scoreColor, severityColor } from "@/lib/format";
import type { Issue } from "@/lib/types";
import { fixDifficulty, type Difficulty } from "@/lib/difficulty";
import { explainCommonIssue } from "@/lib/commonIssuesKB";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`card p-5 ${className}`}>{children}</div>;
}

export function MetricCard({
  label,
  value,
  sub,
  onClick,
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  onClick?: () => void;
}) {
  return (
    <Card
      className={onClick ? "cursor-pointer transition-shadow hover:shadow-md" : ""}
    >
      <button
        type="button"
        onClick={onClick}
        disabled={!onClick}
        className="w-full text-left disabled:cursor-default"
      >
        <div className="text-xs font-medium uppercase tracking-wide text-[var(--seo-muted)]">
          {label}
        </div>
        <div className="mt-1 text-2xl font-bold text-[var(--seo-heading)]">{value}</div>
        {sub ? <div className="mt-1 text-xs text-[var(--seo-text-light)]">{sub}</div> : null}
      </button>
    </Card>
  );
}

export function ScoreBadge({ score }: { score: number }) {
  const color = scoreColor(score);
  return (
    <span
      className="pill"
      style={{ color, backgroundColor: `${color}18` }}
    >
      {Math.round(score)}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: string }) {
  const { text, bg } = severityColor(severity);
  return (
    <span className="pill capitalize" style={{ color: text, backgroundColor: bg }}>
      {severity}
    </span>
  );
}

/** CSS conic-gradient score circle, replaces flat score badges on results/overview pages. */
export function ScoreCircle({
  score,
  size = 72,
  label,
}: {
  score: number;
  size?: number;
  label?: string;
}) {
  const color = scoreColor(score);
  const deg = `${Math.max(0, Math.min(100, score)) * 3.6}deg`;
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className="score-circle"
        style={
          {
            "--score-size": `${size}px`,
            "--score-color": color,
            "--score-deg": deg,
          } as CSSProperties
        }
      >
        <span>{Math.round(score)}</span>
      </div>
      {label ? <span className="text-xs text-[var(--seo-muted)]">{label}</span> : null}
    </div>
  );
}

const DIFFICULTY_STYLE: Record<Difficulty, { color: string; bg: string }> = {
  Easy: { color: "var(--seo-success)", bg: "var(--seo-success-bg)" },
  Medium: { color: "var(--seo-warning)", bg: "var(--seo-warning-bg)" },
  Hard: { color: "var(--seo-error)", bg: "var(--seo-error-bg)" },
};

/** "Effort to fix" pill (Easy / Medium / Hard), derived from an issue's effort. */
export function DifficultyBadge({ difficulty }: { difficulty: Difficulty }) {
  const s = DIFFICULTY_STYLE[difficulty];
  return (
    <span className="pill" style={{ color: s.color, backgroundColor: s.bg }} title="Estimated effort to fix">
      {difficulty} fix
    </span>
  );
}

export function IssueRow({ issue }: { issue: Issue }) {
  const [expanded, setExpanded] = useState(false);
  const explanation = explainCommonIssue(issue);

  return (
    <div className="border-b border-[var(--seo-border)] py-3 last:border-0">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={issue.severity} />
            <DifficultyBadge difficulty={fixDifficulty(issue)} />
            <span className="text-xs text-[var(--seo-muted)]">{issue.category}</span>
          </div>
          <div className="mt-1 text-sm font-medium text-[var(--seo-subheading)]">
            {issue.issue}
          </div>
          <div className="mt-0.5 text-xs text-[var(--seo-text-light)]">
            {issue.recommendation}
          </div>
          {explanation ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-1 text-xs font-medium text-[var(--seo-accent)] hover:underline"
            >
              {expanded ? "Hide details" : "Learn more →"}
            </button>
          ) : null}
        </div>
        <span className="shrink-0 text-xs text-[var(--seo-muted)]">
          Impact {issue.impact_score}
        </span>
      </div>
      {expanded && explanation ? <CommonIssueDetail explanation={explanation} /> : null}
    </div>
  );
}

function CommonIssueDetail({ explanation }: { explanation: NonNullable<ReturnType<typeof explainCommonIssue>> }) {
  return (
    <div className="mt-3 grid grid-cols-1 gap-3 rounded-lg bg-[var(--seo-card-hover)] p-3 sm:grid-cols-2">
      <div>
        <h5 className="text-xs font-semibold uppercase tracking-wide text-[var(--seo-muted)]">What is it?</h5>
        <p className="text-sm text-[var(--seo-text)]">{explanation.whatIsIt}</p>
      </div>
      <div>
        <h5 className="text-xs font-semibold uppercase tracking-wide text-[var(--seo-muted)]">Why it matters</h5>
        <p className="text-sm text-[var(--seo-text)]">{explanation.whyItMatters}</p>
      </div>
      <div>
        <h5 className="text-xs font-semibold uppercase tracking-wide text-[var(--seo-muted)]">SEO impact</h5>
        <p className="text-sm text-[var(--seo-text)]">{explanation.seoImpact}</p>
      </div>
      <div>
        <h5 className="text-xs font-semibold uppercase tracking-wide text-[var(--seo-muted)]">User impact</h5>
        <p className="text-sm text-[var(--seo-text)]">{explanation.userImpact}</p>
      </div>
      <div className="sm:col-span-2">
        <h5 className="text-xs font-semibold uppercase tracking-wide text-[var(--seo-muted)]">Recommended fix</h5>
        <p className="text-sm text-[var(--seo-text)]">{explanation.recommendedFix}</p>
        {explanation.source ? (
          <p className="mt-1 text-xs text-[var(--seo-muted)]">Source: {explanation.source}</p>
        ) : null}
      </div>
    </div>
  );
}

const CHECK_STATUS_STYLE: Record<string, { color: string; bg: string; label: string }> = {
  pass: { color: "var(--seo-success)", bg: "var(--seo-success-bg)", label: "Pass" },
  warning: { color: "var(--seo-warning)", bg: "var(--seo-warning-bg)", label: "Warning" },
  fail: { color: "var(--seo-error)", bg: "var(--seo-error-bg)", label: "Fail" },
  info: { color: "var(--seo-muted)", bg: "var(--seo-card-hover)", label: "Info" },
};

/** Pass/Warning/Fail pill, used by the Technical SEO Audit checklist view. */
export function StatusPill({ status }: { status: string }) {
  const s = CHECK_STATUS_STYLE[status] ?? CHECK_STATUS_STYLE.warning;
  return (
    <span className="pill" style={{ color: s.color, backgroundColor: s.bg }}>
      {s.label}
    </span>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <Card className="flex flex-col items-center justify-center py-16 text-center">
      <div className="text-lg font-semibold text-[var(--seo-heading)]">{title}</div>
      {hint ? <div className="mt-1 text-sm text-[var(--seo-muted)]">{hint}</div> : null}
    </Card>
  );
}

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-bold tracking-tight text-[var(--seo-heading)]">{title}</h1>
      {subtitle ? <p className="mt-1 text-sm text-[var(--seo-text-light)]">{subtitle}</p> : null}
    </div>
  );
}
