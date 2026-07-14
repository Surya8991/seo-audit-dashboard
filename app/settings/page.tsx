"use client";

import { useEffect, useState } from "react";
import { useAudit } from "@/lib/state/AuditContext";
import { Card, PageHeader } from "@/components/ui";

export default function SettingsPage() {
  const { results, clearAll, groqApiKey, setGroqApiKey } = useAudit();
  const [psiConfigured, setPsiConfigured] = useState<boolean | null>(null);
  const [groqConfigured, setGroqConfigured] = useState<boolean | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    fetch("/api/config-status")
      .then((r) => r.json())
      .then((d) => {
        setPsiConfigured(Boolean(d.psiConfigured));
        setGroqConfigured(Boolean(d.groqConfigured));
      })
      .catch(() => {
        setPsiConfigured(false);
        setGroqConfigured(false);
      });
  }, []);

  return (
    <div className="max-w-2xl">
      <PageHeader title="⚙️ Settings" />

      <Card className="mb-4">
        <h3 className="mb-2 text-sm font-semibold text-[var(--seo-subheading)]">
          PageSpeed Insights API Key
        </h3>
        <p className="mb-3 text-sm text-[var(--seo-text-light)]">
          Used for live Core Web Vitals data on the Performance Audit page. Without
          a key, PageSpeed still works via Google&apos;s anonymous quota (100
          requests/day per IP). A key raises that to 25,000/day.
        </p>
        <div className="flex items-center gap-2 text-sm">
          <span
            className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold"
            style={{
              color: psiConfigured ? "var(--seo-success)" : "var(--seo-warning)",
              backgroundColor: psiConfigured ? "var(--seo-success-bg)" : "var(--seo-warning-bg)",
            }}
          >
            {psiConfigured === null ? "Checking…" : psiConfigured ? "Configured" : "Not configured"}
          </span>
        </div>
        <p className="mt-3 text-xs text-[var(--seo-muted)]">
          To set it: open this project in the Vercel dashboard → Settings →
          Environment Variables → add <code>PSI_API_KEY</code> → redeploy.
        </p>
      </Card>

      <Card className="mb-4">
        <h3 className="mb-2 text-sm font-semibold text-[var(--seo-subheading)]">
          Groq AI Summary API Key
        </h3>
        <p className="mb-3 text-sm text-[var(--seo-text-light)]">
          Powers the plain-English AI summary on the URL Detail page (free tier at{" "}
          <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" className="underline">
            console.groq.com/keys
          </a>
          ). Without a key, audits still run fully. Only the AI summary is unavailable.
        </p>
        <div className="mb-3 flex items-center gap-2 text-sm">
          <span
            className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold"
            style={{
              color: groqConfigured || groqApiKey ? "var(--seo-success)" : "var(--seo-warning)",
              backgroundColor: groqConfigured || groqApiKey ? "var(--seo-success-bg)" : "var(--seo-warning-bg)",
            }}
          >
            {groqConfigured === null
              ? "Checking…"
              : groqApiKey
                ? "Using key from this browser"
                : groqConfigured
                  ? "Configured (server default)"
                  : "Not configured"}
          </span>
        </div>
        <input
          type="password"
          value={groqApiKey}
          onChange={(e) => setGroqApiKey(e.target.value)}
          placeholder="gsk_..."
          className="w-full rounded-lg border border-[var(--seo-border-strong)] bg-[var(--seo-card-bg)] px-3 py-2 text-sm text-[var(--seo-text)] outline-none focus:border-[var(--seo-accent)]"
        />
        <p className="mt-2 text-xs text-[var(--seo-muted)]">
          Stored only in this browser&apos;s localStorage and sent directly to the audit
          summary endpoint, never saved server-side.
        </p>
      </Card>

      <Card>
        <h3 className="mb-2 text-sm font-semibold text-[var(--seo-subheading)]">
          Session Data
        </h3>
        <p className="mb-3 text-sm text-[var(--seo-text-light)]">
          {results.length} audit result(s) stored in this browser (localStorage).
        </p>
        <button
          type="button"
          onClick={() => {
            if (!confirmClear) {
              setConfirmClear(true);
              return;
            }
            clearAll();
            setConfirmClear(false);
          }}
          className="rounded-lg border border-[var(--seo-error-border)] px-3 py-1.5 text-sm font-medium text-[var(--seo-error)] hover:bg-[var(--seo-error-bg)]"
        >
          {confirmClear ? "Confirm clear all audit data?" : "Clear all audit data"}
        </button>
      </Card>
    </div>
  );
}
