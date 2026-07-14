import { Card } from "@/components/ui";
import { CHECK_DEFS } from "@/lib/checklistDefs";

/**
 * "What Technical SEO checks" explainer — mirrors the reference tool's
 * plain-English use-case card: description, every check as a pill, and a
 * "when to use" callout.
 */
export function ChecklistExplainer() {
  return (
    <Card className="mb-4 border-l-4 border-l-[var(--seo-accent)]">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-lg">⚙️</span>
        <h3 className="text-sm font-semibold text-[var(--seo-accent)]">What Technical SEO checks</h3>
      </div>
      <p className="mb-3 text-sm text-[var(--seo-text-light)]">
        Comprehensive technical audit combining crawlability (12), on-page (11), and site health (12)
        into a single 35-check run — the fastest way to get a complete technical picture of any URL,
        no API key required.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {CHECK_DEFS.map((c) => (
          <span
            key={c.id}
            title={c.description}
            className="pill cursor-default"
            style={{ color: "var(--seo-accent)", backgroundColor: "var(--seo-accent-light)" }}
          >
            {c.label}
          </span>
        ))}
      </div>
      <div className="mt-3 rounded-lg border-l-2 border-l-[var(--seo-accent)] bg-[var(--seo-card-alt)] px-3 py-2 text-xs text-[var(--seo-text-light)]">
        <strong className="text-[var(--seo-subheading)]">When to use:</strong> run this as your default
        first audit on any new URL or client site — it covers everything you need before publishing,
        after a site migration, or for a technical SEO proposal.
      </div>
    </Card>
  );
}
