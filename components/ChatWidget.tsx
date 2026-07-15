"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useAudit } from "@/lib/state/AuditContext";
import { allIssuesOf, avgScore, getTopIssuesByImpact } from "@/lib/aggregate";
import type { AuditResult } from "@/lib/types";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface AuditContextPayload {
  url?: string;
  seo_score?: number;
  top_issues?: string[];
}

const MAX_MESSAGE_CHARS = 4000;

/** Small audit summary for the assistant's system prompt: the single result
 * on Detail, or a sitewide rollup on Results, so it can answer questions
 * about what's actually in front of the user, not just app help. */
function buildAuditContext(pathname: string, results: AuditResult[], selectedUrlIndex: number): AuditContextPayload | null {
  if (results.length === 0) return null;

  if (pathname === "/detail") {
    const r = results[Math.min(selectedUrlIndex, results.length - 1)];
    return {
      url: r.url,
      seo_score: r.seo_score,
      top_issues: getTopIssuesByImpact(r.all_issues || [], 5).map((i) => i.issue),
    };
  }

  if (pathname === "/results") {
    if (results.length === 1) {
      const r = results[0];
      return {
        url: r.url,
        seo_score: r.seo_score,
        top_issues: getTopIssuesByImpact(r.all_issues || [], 5).map((i) => i.issue),
      };
    }
    return {
      url: `${results.length} audited URLs (sitewide)`,
      seo_score: Math.round(avgScore(results)),
      top_issues: getTopIssuesByImpact(allIssuesOf(results), 5).map((i) => i.issue),
    };
  }

  return null;
}

export function ChatWidget() {
  const pathname = usePathname();
  const { results, selectedUrlIndex, groqApiKey } = useAudit();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, open]);

  const auditContext = buildAuditContext(pathname, results, selectedUrlIndex);

  async function send() {
    const text = input.trim().slice(0, MAX_MESSAGE_CHARS);
    if (!text || loading) return;
    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);
    setInput("");
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages,
          apiKey: groqApiKey || undefined,
          auditContext: auditContext || undefined,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
      } else {
        setError(data.error || "The assistant couldn't respond.");
      }
    } catch {
      setError("Request failed. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3">
      {open ? (
        <div className="flex h-[28rem] w-[22rem] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-xl border border-[var(--seo-border)] bg-[var(--seo-card-bg)] shadow-xl">
          <div className="flex items-center justify-between border-b border-[var(--seo-border)] bg-[var(--table-header-bg)] px-4 py-2.5">
            <div>
              <div className="text-sm font-semibold text-[var(--seo-subheading)]">🤖 AI Assistant</div>
              {auditContext ? (
                <div className="truncate text-xs text-[var(--seo-muted)]" title={auditContext.url}>
                  Context: {auditContext.url}
                </div>
              ) : (
                <div className="text-xs text-[var(--seo-muted)]">App help</div>
              )}
            </div>
            <button
              type="button"
              aria-label="Close chat"
              onClick={() => setOpen(false)}
              className="rounded-lg px-2 py-1 text-[var(--seo-muted)] hover:bg-[var(--seo-card-hover)]"
            >
              ✕
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {messages.length === 0 ? (
              <p className="text-sm text-[var(--seo-muted)]">
                Ask me how to use the dashboard, or what an audit finding means
                {auditContext ? " for the results you're viewing" : ""}.
              </p>
            ) : (
              messages.map((m, i) => (
                <div
                  key={i}
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                    m.role === "user"
                      ? "ml-auto bg-[var(--seo-accent)] text-white"
                      : "bg-[var(--seo-card-hover)] text-[var(--seo-text)]"
                  }`}
                >
                  {m.content}
                </div>
              ))
            )}
            {loading ? (
              <div className="max-w-[85%] rounded-lg bg-[var(--seo-card-hover)] px-3 py-2 text-sm text-[var(--seo-muted)]">
                Thinking…
              </div>
            ) : null}
            {error ? (
              <div className="rounded-lg border border-[var(--seo-error-border)] bg-[var(--seo-error-bg)] px-3 py-2 text-xs text-[var(--seo-error)]">
                {error}
                {!groqApiKey ? " Add a Groq API key in Settings, or it'll use the server default if configured." : ""}
              </div>
            ) : null}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
            className="flex items-center gap-2 border-t border-[var(--seo-border)] p-3"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a question…"
              className="min-w-0 flex-1 rounded-lg border border-[var(--seo-border)] bg-[var(--seo-card)] px-3 py-1.5 text-sm text-[var(--seo-text)] placeholder:text-[var(--seo-muted)]"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="shrink-0 rounded-lg bg-[var(--seo-accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              Send
            </button>
          </form>
        </div>
      ) : null}

      <button
        type="button"
        aria-label={open ? "Close AI assistant" : "Open AI assistant"}
        onClick={() => setOpen((v) => !v)}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--seo-accent)] text-2xl text-white shadow-lg transition-transform hover:scale-105"
      >
        {open ? "✕" : "💬"}
      </button>
    </div>
  );
}
