import type { CSSProperties, ReactNode } from "react";
import { scoreColor, severityColor } from "@/lib/format";
import type { Issue } from "@/lib/types";

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

export function IssueRow({ issue }: { issue: Issue }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[var(--seo-border)] py-3 last:border-0">
      <div>
        <div className="flex items-center gap-2">
          <SeverityBadge severity={issue.severity} />
          <span className="text-xs text-[var(--seo-muted)]">{issue.category}</span>
        </div>
        <div className="mt-1 text-sm font-medium text-[var(--seo-subheading)]">
          {issue.issue}
        </div>
        <div className="mt-0.5 text-xs text-[var(--seo-text-light)]">
          {issue.recommendation}
        </div>
      </div>
      <span className="shrink-0 text-xs text-[var(--seo-muted)]">
        Impact {issue.impact_score}
      </span>
    </div>
  );
}

const CHECK_STATUS_STYLE: Record<string, { color: string; bg: string; label: string }> = {
  pass: { color: "var(--seo-success)", bg: "var(--seo-success-bg)", label: "Pass" },
  warning: { color: "var(--seo-warning)", bg: "var(--seo-warning-bg)", label: "Warning" },
  fail: { color: "var(--seo-error)", bg: "var(--seo-error-bg)", label: "Fail" },
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
