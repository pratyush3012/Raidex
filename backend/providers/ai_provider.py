"""AI provider abstraction for RAIDEX Nexus (Support / Operations / Finance agents).

Current default impl: `StubAIProvider` — a deterministic, non-hallucinating
fallback used whenever no real provider is configured. It never invents
product claims; it just acknowledges the message and says a human will follow
up. This is what runs in local/dev/test environments by default.

Switch to a real AI: set env `AI_PROVIDER=anthropic` and `ANTHROPIC_API_KEY`
(from https://console.anthropic.com). Uses Anthropic's official `anthropic`
Python SDK.

This replaces the previous `emergentintegrations` dependency, which was never
listed in any requirements file and is tied to a specific third-party vendor's
proxy service this app has no way to install or verify — every Nexus call
failed with an ImportError. Anthropic's SDK is a standard, publicly published
package, which is why it was chosen as the real-provider implementation
instead (the code already referenced `("anthropic", "claude-sonnet-4-6")` as
its intended model before this fix, so this keeps that intent).
"""

from __future__ import annotations

import os
from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class ChatTurn:
    role: str  # "user" | "assistant"
    content: str


class AIProvider(ABC):
    name: str = "abstract"

    @abstractmethod
    async def chat(self, *, system: str, history: list[ChatTurn], message: str) -> str: ...


# ── Stub (dev default / safe fallback) ────────────────────────────────────────

class StubAIProvider(AIProvider):
    name = "stub"

    async def chat(self, *, system: str, history: list[ChatTurn], message: str) -> str:
        return (
            "Raidex AI assistant is not configured in this environment right now "
            "(no AI provider/API key set), so I can't generate a live answer. "
            "A member of the Raidex team will follow up on your message directly: "
            f"\"{message.strip()[:300]}\""
        )


# ── Anthropic (Claude) ─────────────────────────────────────────────────────────

class AnthropicProvider(AIProvider):
    """
    Env vars:
        ANTHROPIC_API_KEY — from https://console.anthropic.com
        ANTHROPIC_MODEL   — default: claude-sonnet-4-5
    """

    name = "anthropic"

    def __init__(self) -> None:
        self.api_key = os.environ["ANTHROPIC_API_KEY"]
        self.model = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-5")

    async def chat(self, *, system: str, history: list[ChatTurn], message: str) -> str:
        import anthropic  # optional dependency - only imported when this provider is actually used

        client = anthropic.AsyncAnthropic(api_key=self.api_key)
        messages = [{"role": turn.role, "content": turn.content} for turn in history]
        messages.append({"role": "user", "content": message})
        response = await client.messages.create(
            model=self.model,
            system=system,
            max_tokens=1024,
            messages=messages,
        )
        return "".join(block.text for block in response.content if getattr(block, "type", None) == "text")


# ── Factory ──────────────────────────────────────────────────────────────────

_singleton: AIProvider | None = None


def get_ai_provider() -> AIProvider:
    global _singleton
    if _singleton is None:
        provider = os.getenv("AI_PROVIDER", "").lower()
        if provider == "anthropic" or (not provider and os.getenv("ANTHROPIC_API_KEY")):
            _singleton = AnthropicProvider()
        else:
            _singleton = StubAIProvider()
    return _singleton


def reset_ai_provider() -> None:
    """Test/dev helper to force re-selection (e.g. after changing env vars)."""
    global _singleton
    _singleton = None
