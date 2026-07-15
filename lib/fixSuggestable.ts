// Mirrors modules/ai_assist.py::_FIX_TARGET_PATTERNS / detect_fix_target.
// The client needs this too (not just the backend) so the UI can decide
// whether to show the "Suggest a fix" action without spending an API call
// just to find out it isn't supported for this issue.
export type FixTarget = "title" | "description" | "h1";

const FIX_TARGET_PATTERNS: [RegExp, FixTarget][] = [
  [/missing meta title|meta title too (short|long)/i, "title"],
  [/missing meta description|meta description too (short|long)/i, "description"],
  [/missing h1|h1 heading is too (short|long)/i, "h1"],
];

export function detectFixTarget(issueTitle: string): FixTarget | null {
  for (const [pattern, target] of FIX_TARGET_PATTERNS) {
    if (pattern.test(issueTitle)) return target;
  }
  return null;
}

export interface FixPageContext {
  url?: string;
  title?: string;
  description?: string;
  h1?: string;
  content_snippet?: string;
}

export interface FixSuggestion {
  ok: boolean;
  suggestion?: string;
  rationale?: string;
  target?: FixTarget;
  error?: string;
}
