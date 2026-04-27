"""Expose the agent outreach package from the repository root."""

from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
_AGENT_OUTREACH = _ROOT / "agent" / "outreach"

if _AGENT_OUTREACH.exists():
    __path__.append(str(_AGENT_OUTREACH))
