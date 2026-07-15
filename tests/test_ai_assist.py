"""Tests for modules/ai_assist.py's chatbot logic: message trimming and
chat_with_assistant's context-building / error handling. Network (_chat) is
mocked; nothing here hits the real Groq API."""

from unittest.mock import patch

from modules.ai_assist import (
    _MAX_CHAT_CONTEXT_CHARS,
    _MAX_CHAT_TURNS,
    _trim_chat_messages,
    chat_with_assistant,
)


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


@patch("modules.ai_assist._chat", side_effect=RuntimeError("Groq API unavailable (HTTP 500)"))
def test_chat_returns_error_on_api_failure(mock_chat):
    result = chat_with_assistant([{"role": "user", "content": "hi"}], api_key="fake-key")
    assert result["ok"] is False
    assert "500" in result["error"]
