"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useAudit } from "@/lib/state/AuditContext";
import { allIssuesOf, avgScore, getTopIssuesByImpact } from "@/lib/aggregate";
import { explainCommonIssue } from "@/lib/commonIssuesKB";
import { BotIcon, MessageIcon, XIcon } from "@/components/icons";
import type { AuditResult, Issue } from "@/lib/types";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface KbNote {
  issue: string;
  whatIsIt: string;
  recommendedFix: string;
}

interface AuditContextPayload {
  url?: string;
  seo_score?: number;
  top_issues?: string[];
  kb_notes?: KbNote[];
}

const MAX_MESSAGE_CHARS = 4000;

// Vercel's Python serverless runtime (api/chat.py's BaseHTTPRequestHandler
// model) doesn't reliably support true token-by-token streaming, so this
// reveals the already-complete reply progressively client-side instead —
// same "it's typing" feel without a streaming backend rewrite.
const REVEAL_CHARS_PER_TICK = 3;
const REVEAL_INTERVAL_MS = 15;

/** Looks up each of the given issues in the curated Common Issues KB
 * (lib/commonIssuesKB.ts — the same source that powers the "Learn more"
 * expansion on issue rows) so the assistant answers from the app's own
 * grounded explanations instead of the model's general knowledge, which
 * won't know this app's specific fix guidance/thresholds. */
function buildKbNotes(issues: Issue[]): KbNote[] {
  const notes: KbNote[] = [];
  for (const issue of issues) {
    const explanation = explainCommonIssue(issue);
    if (explanation) {
      notes.push({ issue: issue.issue, whatIsIt: explanation.whatIsIt, recommendedFix: explanation.recommendedFix });
    }
  }
  return notes;
}

/** Small audit summary for the assistant's system prompt: the single result
 * on Detail, or a sitewide rollup on Results, so it can answer questions
 * about what's actually in front of the user, not just app help. */
function buildAuditContext(pathname: string, results: AuditResult[], selectedUrlIndex: number): AuditContextPayload | null {
  if (results.length === 0) return null;

  if (pathname === "/detail") {
    const r = results[Math.min(selectedUrlIndex, results.length - 1)];
    const topIssues = getTopIssuesByImpact(r.all_issues || [], 5);
    return {
      url: r.url,
      seo_score: r.seo_score,
      top_issues: topIssues.map((i) => i.issue),
      kb_notes: buildKbNotes(topIssues),
    };
  }

  if (pathname === "/results") {
    if (results.length === 1) {
      const r = results[0];
      const topIssues = getTopIssuesByImpact(r.all_issues || [], 5);
      return {
        url: r.url,
        seo_score: r.seo_score,
        top_issues: topIssues.map((i) => i.issue),
        kb_notes: buildKbNotes(topIssues),
      };
    }
    const topIssues = getTopIssuesByImpact(allIssuesOf(results), 5);
    return {
      url: `${results.length} audited URLs (sitewide)`,
      seo_score: Math.round(avgScore(results)),
      top_issues: topIssues.map((i) => i.issue),
      kb_notes: buildKbNotes(topIssues),
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
  const [revealState, setRevealState] = useState<{ index: number; count: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const revealIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, open, revealState]);

  // Cleanup only (no setState here) — clears a still-running reveal interval
  // if the widget unmounts mid-animation.
  useEffect(() => {
    return () => {
      if (revealIntervalRef.current) clearInterval(revealIntervalRef.current);
    };
  }, []);

  const auditContext = buildAuditContext(pathname, results, selectedUrlIndex);

  /** Progressively reveals a just-added assistant reply instead of dropping
   * it in fully-formed all at once. Triggered from the send() handler (an
   * event callback), not a useEffect keyed on `messages`, so the reveal
   * starts in the same render pass the message is added — no flash of the
   * full text before the animation kicks in. */
  function startReveal(index: number, fullText: string) {
    if (revealIntervalRef.current) clearInterval(revealIntervalRef.current);
    setRevealState({ index, count: 0 });
    let count = 0;
    revealIntervalRef.current = setInterval(() => {
      count = Math.min(count + REVEAL_CHARS_PER_TICK, fullText.length);
      setRevealState({ index, count });
      if (count >= fullText.length && revealIntervalRef.current) {
        clearInterval(revealIntervalRef.current);
        revealIntervalRef.current = null;
      }
    }, REVEAL_INTERVAL_MS);
  }

  async function send() {
    const text = input.trim().slice(0, MAX_MESSAGE_CHARS);
    if (!text || loading) return;
    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);
    setInput("");
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "chat",
          messages: nextMessages,
          apiKey: groqApiKey || undefined,
          auditContext: auditContext || undefined,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        const replyText = String(data.reply ?? "");
        const assistantIndex = nextMessages.length;
        setMessages((prev) => [...prev, { role: "assistant", content: replyText }]);
        startReveal(assistantIndex, replyText);
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
              <div className="flex items-center gap-1.5 text-sm font-semibold text-[var(--seo-subheading)]">
                <BotIcon size={16} className="text-[var(--seo-accent)]" />
                AI Assistant
              </div>
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
              className="rounded-lg p-1 text-[var(--seo-muted)] transition-colors hover:bg-[var(--seo-card-hover)] hover:text-[var(--seo-heading)]"
            >
              <XIcon size={16} />
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {messages.length === 0 ? (
              <p className="text-sm text-[var(--seo-muted)]">
                Ask me how to use the dashboard, or what an audit finding means
                {auditContext ? " for the results you're viewing" : ""}.
              </p>
            ) : (
              messages.map((m, i) => {
                const isRevealing = m.role === "assistant" && revealState?.index === i;
                const content = isRevealing ? m.content.slice(0, revealState!.count) : m.content;
                return (
                  <div
                    key={i}
                    className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                      m.role === "user"
                        ? "ml-auto bg-[var(--seo-accent)] text-white"
                        : "bg-[var(--seo-card-hover)] text-[var(--seo-text)]"
                    }`}
                  >
                    {content}
                    {isRevealing && revealState!.count < m.content.length ? (
                      <span className="animate-pulse">▍</span>
                    ) : null}
                  </div>
                );
              })
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
        className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--seo-accent)] text-white shadow-lg transition-transform hover:scale-105"
      >
        {open ? <XIcon size={20} /> : <MessageIcon size={20} />}
      </button>
    </div>
  );
}
