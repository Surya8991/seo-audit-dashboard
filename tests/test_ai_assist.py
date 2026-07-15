"""Tests for modules/ai_assist.py's chatbot logic: message trimming and
chat_with_assistant's context-building / error handling. Network (_chat) is
mocked; nothing here hits the real Groq API."""

import json
from unittest.mock import MagicMock, patch

from modules.ai_assist import (
    _MAX_CHAT_CONTEXT_CHARS,
    _MAX_CHAT_TURNS,
    _aggregate_issues,
    _chat,
    _parse_summary_reply,
    _trim_chat_messages,
    chat_with_assistant,
    detect_fix_target,
    explain_audit,
    suggest_fix,
)


def _mk(issue, severity="Medium", category="Metadata"):
    return {"issue": issue, "severity": severity, "category": category,
            "recommendation": "fix", "impact_score": 5}


def test_aggregate_dedupes_by_title_with_page_counts():
    issues = [_mk("Missing meta description") for _ in range(180)]
    issues += [_mk("H1 too long", "Warning") for _ in range(120)]
    issues += [_mk("Blocked by robots.txt", "Critical", "Site Health") for _ in range(3)]
    agg, totals = _aggregate_issues(issues)
    assert len(agg) == 3  # 303 raw rows collapse to 3 distinct issues
    counts = {e["issue"]: e["count"] for e in agg}
    assert counts["Missing meta description"] == 180
    assert counts["Blocked by robots.txt"] == 3
    assert totals["Medium"] == 180 and totals["Critical"] == 3


def test_aggregate_sorts_severe_first_even_when_rare():
    # The rare Critical (3 pages) must sort ABOVE the frequent Medium (180 pages)
    # so it survives the character-budget truncation instead of dropping off.
    issues = [_mk("Missing meta description") for _ in range(180)]
    issues += [_mk("Blocked by robots.txt", "Critical", "Site Health") for _ in range(3)]
    agg, _ = _aggregate_issues(issues)
    assert agg[0]["issue"] == "Blocked by robots.txt"
    assert agg[0]["severity"] == "Critical"


def test_trim_keeps_only_most_recent_turns():
    messages = [{"role": "user", "content": f"msg {i}"} for i in range(_MAX_CHAT_TURNS + 10)]
    trimmed = _trim_chat_messages(messages)
    assert len(trimmed) <= _MAX_CHAT_TURNS
    assert trimmed[-1]["content"] == f"msg {_MAX_CHAT_TURNS + 9}"


def test_trim_enforces_character_budget():
    messages = [{"role": "user", "content": "x" * (_MAX_CHAT_CONTEXT_CHARS // 2)} for _ in range(10)]
    trimmed = _trim_chat_messages(messages)
    total_chars = sum(len(m["content"]) for m in trimmed)
    assert total_chars <= _MAX_CHAT_CONTEXT_CHARS


def test_trim_preserves_chronological_order():
    messages = [{"role": "user", "content": "first"}, {"role": "assistant", "content": "second"}]
    trimmed = _trim_chat_messages(messages)
    assert [m["content"] for m in trimmed] == ["first", "second"]


def test_trim_drops_empty_content():
    messages = [{"role": "user", "content": ""}, {"role": "user", "content": "real"}]
    trimmed = _trim_chat_messages(messages)
    assert trimmed == [{"role": "user", "content": "real"}]


def test_chat_without_api_key_returns_error():
    result = chat_with_assistant([{"role": "user", "content": "hi"}], api_key="")
    assert result == {"ok": False, "error": "Groq API key not configured"}


def test_chat_without_messages_returns_error():
    result = chat_with_assistant([], api_key="fake-key")
    assert result["ok"] is False


@patch("modules.ai_assist._chat")
def test_chat_returns_reply_on_success(mock_chat):
    mock_chat.return_value = "You're all set!"
    result = chat_with_assistant([{"role": "user", "content": "How do I run an audit?"}], api_key="fake-key")
    assert result["ok"] is True
    assert result["reply"] == "You're all set!"
    mock_chat.assert_called_once()


@patch("modules.ai_assist._chat")
def test_chat_includes_audit_context_in_system_prompt(mock_chat):
    mock_chat.return_value = "Your score is low because of X."
    chat_with_assistant(
        [{"role": "user", "content": "Why is my score low?"}],
        api_key="fake-key",
        audit_context={"url": "https://example.com", "seo_score": 42, "top_issues": ["Missing meta description"]},
    )
    sent_messages = mock_chat.call_args[0][0]
    system_content = sent_messages[0]["content"]
    assert "https://example.com" in system_content
    assert "42" in system_content
    assert "Missing meta description" in system_content


@patch("modules.ai_assist._chat")
def test_chat_includes_kb_notes_in_system_prompt(mock_chat):
    mock_chat.return_value = "Here's how to fix it."
    chat_with_assistant(
        [{"role": "user", "content": "How do I fix the meta description?"}],
        api_key="fake-key",
        audit_context={
            "url": "https://example.com",
            "seo_score": 55,
            "top_issues": ["Missing meta description"],
            "kb_notes": [
                {
                    "issue": "Missing meta description",
                    "whatIsIt": "The page has no meta description tag.",
                    "recommendedFix": "Write a unique 150-160 character description.",
                }
            ],
        },
    )
    system_content = mock_chat.call_args[0][0][0]["content"]
    assert "knowledge base" in system_content
    assert "The page has no meta description tag." in system_content
    assert "Write a unique 150-160 character description." in system_content


@patch("modules.ai_assist._chat")
def test_chat_without_kb_notes_omits_kb_section(mock_chat):
    mock_chat.return_value = "ok"
    chat_with_assistant(
        [{"role": "user", "content": "hi"}],
        api_key="fake-key",
        audit_context={"url": "https://example.com", "seo_score": 55, "top_issues": []},
    )
    system_content = mock_chat.call_args[0][0][0]["content"]
    assert "knowledge base" not in system_content


@patch("modules.ai_assist._chat", side_effect=RuntimeError("Groq API unavailable (HTTP 500)"))
def test_chat_returns_error_on_api_failure(mock_chat):
    result = chat_with_assistant([{"role": "user", "content": "hi"}], api_key="fake-key")
    assert result["ok"] is False
    assert "500" in result["error"]


# ── _parse_summary_reply / explain_audit JSON mode ──────────────────────────

def test_parse_summary_reply_handles_valid_json():
    reply = json.dumps({"explanation": "Site is healthy.", "top_actions": ["Fix X", "Fix Y"]})
    explanation, actions = _parse_summary_reply(reply)
    assert explanation == "Site is healthy."
    assert actions == ["Fix X", "Fix Y"]


def test_parse_summary_reply_caps_actions_at_five():
    reply = json.dumps({"explanation": "ok", "top_actions": [f"Fix {i}" for i in range(10)]})
    _, actions = _parse_summary_reply(reply)
    assert len(actions) == 5


def test_parse_summary_reply_falls_back_on_malformed_json():
    reply = "1. Fix the meta description because it's missing.\n2. Add an H1 heading.\nOverall the site needs work."
    explanation, actions = _parse_summary_reply(reply)
    assert len(actions) == 2
    assert actions[0] == "Fix the meta description because it's missing."
    assert "Overall the site needs work." in explanation


def test_parse_summary_reply_falls_back_on_empty_json_object():
    # Valid JSON but neither expected key present -> still use the fallback.
    reply = '{"unexpected": "shape"}'
    explanation, actions = _parse_summary_reply(reply)
    assert explanation == '{"unexpected": "shape"}'
    assert actions == []


@patch("modules.ai_assist._chat")
def test_explain_audit_requests_json_mode(mock_chat):
    mock_chat.return_value = json.dumps({"explanation": "Good.", "top_actions": ["Fix meta"]})
    result = explain_audit([], 80, "fake-key", url="https://example.com/")
    assert result["ok"] is True
    assert result["explanation"] == "Good."
    assert result["top_actions"] == ["Fix meta"]
    assert mock_chat.call_args.kwargs.get("json_mode") is True


@patch("modules.ai_assist._chat")
def test_explain_audit_context_label_overrides_url_phrasing(mock_chat):
    mock_chat.return_value = json.dumps({"explanation": "ok", "top_actions": []})
    explain_audit([], 50, "fake-key", url="https://example.com/", context_label="across 10 audited pages (sitewide)")
    user_msg = mock_chat.call_args[0][0][1]["content"]
    assert "across 10 audited pages (sitewide)" in user_msg
    assert "for https://example.com/" not in user_msg


@patch("modules.ai_assist.requests.post")
def test_chat_json_mode_falls_back_to_plain_on_400(mock_post):
    # `body` is mutated in place across retries, so snapshot each call's
    # json kwarg (a dict copy) at call time rather than reading it back from
    # mock_post.call_args_list afterward, which would all see the same
    # already-mutated dict.
    seen_bodies = []
    rejected = MagicMock(status_code=400)
    ok_resp = MagicMock(status_code=200)
    ok_resp.json.return_value = {"choices": [{"message": {"content": "plain text reply"}}]}
    responses = [rejected, ok_resp]

    def _side_effect(*args, **kwargs):
        seen_bodies.append(dict(kwargs["json"]))
        return responses.pop(0)

    mock_post.side_effect = _side_effect

    result = _chat([{"role": "user", "content": "hi"}], "fake-key", json_mode=True)

    assert result == "plain text reply"
    assert mock_post.call_count == 2
    assert "response_format" in seen_bodies[0]
    assert "response_format" not in seen_bodies[1]


# ── detect_fix_target / suggest_fix ─────────────────────────────────────────

def test_detect_fix_target_matches_meta_title():
    assert detect_fix_target("Missing Meta Title") == "title"
    assert detect_fix_target("Meta Title Too Short") == "title"
    assert detect_fix_target("Meta Title Too Long") == "title"


def test_detect_fix_target_matches_meta_description():
    assert detect_fix_target("Missing Meta Description") == "description"
    assert detect_fix_target("Meta Description Too Long") == "description"


def test_detect_fix_target_matches_h1():
    assert detect_fix_target("Missing H1 heading") == "h1"
    assert detect_fix_target("H1 heading is too short (12 chars)") == "h1"


def test_detect_fix_target_returns_none_for_unsupported_issue():
    assert detect_fix_target("Broken Internal Link") is None
    assert detect_fix_target("Missing Alt Text") is None


def test_suggest_fix_without_api_key_returns_error():
    result = suggest_fix("Missing Meta Description", {}, api_key="")
    assert result == {"ok": False, "error": "Groq API key not configured"}


def test_suggest_fix_returns_error_for_unsupported_issue():
    result = suggest_fix("Broken Internal Link", {}, api_key="fake-key")
    assert result["ok"] is False
    assert "No fix generator" in result["error"]


@patch("modules.ai_assist._chat")
def test_suggest_fix_returns_drafted_suggestion(mock_chat):
    mock_chat.return_value = json.dumps({
        "suggestion": "Buy Handmade Ceramic Mugs Online | Acme Pottery",
        "rationale": "Includes the product and brand within 60 characters.",
    })
    result = suggest_fix(
        "Missing Meta Title",
        {"url": "https://example.com/mugs", "content_snippet": "Handmade ceramic mugs, fired in our studio."},
        api_key="fake-key",
    )
    assert result["ok"] is True
    assert result["target"] == "title"
    assert "Ceramic Mugs" in result["suggestion"]
    assert mock_chat.call_args.kwargs.get("json_mode") is True


@patch("modules.ai_assist._chat")
def test_suggest_fix_falls_back_to_raw_text_on_malformed_json(mock_chat):
    mock_chat.return_value = "Just a plain suggestion with no JSON wrapper."
    result = suggest_fix("Missing H1 heading", {"url": "https://example.com/"}, api_key="fake-key")
    assert result["ok"] is True
    assert result["suggestion"] == "Just a plain suggestion with no JSON wrapper."
    assert result["rationale"] == ""


@patch("modules.ai_assist._chat")
def test_suggest_fix_returns_error_when_suggestion_empty(mock_chat):
    mock_chat.return_value = json.dumps({"suggestion": "", "rationale": "n/a"})
    result = suggest_fix("Missing Meta Description", {}, api_key="fake-key")
    assert result["ok"] is False


@patch("modules.ai_assist._chat", side_effect=RuntimeError("Groq API unavailable (HTTP 500)"))
def test_suggest_fix_returns_error_on_api_failure(mock_chat):
    result = suggest_fix("Missing Meta Description", {}, api_key="fake-key")
    assert result["ok"] is False
    assert "500" in result["error"]
