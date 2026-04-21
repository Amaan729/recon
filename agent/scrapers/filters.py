"""
Job filtering utilities shared across all scrapers.
Applies keyword-based pre-filter and AI match scoring.
AI scoring uses Gemini 2.5 Flash → Groq fallback → Mistral fallback.
"""

import asyncio
import os
import re

# ── Basic filter (no AI, fast) ───────────────────────────────────

EXCLUDE_KEYWORDS_LOWER = [
    "data analyst",
    "it ",
    "qa engineer",
    "quality assurance",
    "product intern",
    "junior software engineer",
    "associate software engineer",
    "devops intern",
    "security intern",
    "hardware engineer",
]

REQUIRED_TERMS = [
    "intern",
    "co-op",
    "coop",
]


def passes_basic_filter(job: dict) -> bool:
    """
    Returns True if job title passes basic keyword filter.
    Checks:
    1. Title contains at least one REQUIRED_TERMS value
    2. Title does not contain any EXCLUDE_KEYWORDS_LOWER value
    """
    title_lower = job.get("title", "").lower()

    has_required = any(term in title_lower for term in REQUIRED_TERMS)
    if not has_required:
        return False

    has_excluded = any(kw in title_lower for kw in EXCLUDE_KEYWORDS_LOWER)
    if has_excluded:
        return False

    return True


# ── AI match scoring ─────────────────────────────────────────────

_SCORE_PROMPT_TEMPLATE = """Rate this job posting 0-100 for fit with this \
candidate profile. Return ONLY a single integer, nothing else.

Candidate: CS + Finance sophomore at ASU Barrett Honors (4.0 GPA).
Target roles: SWE Intern, SWE Co-op, ML/AI Intern, Backend Intern.
Target industries: FinTech, AI/ML, cloud infrastructure, enterprise \
software. Preferred companies: 500+ employees or Series B+ startups \
with structured internship programs.
Exclude: data analyst, IT, QA, product intern, full-time junior roles.

Job title: {title}
Company: {company}
Location: {location}

Score (0-100):"""


async def ai_match_score(job: dict) -> int:
    """
    Use AI to score job 0-100 for fit with Amaan's profile.
    Tries Gemini 2.5 Flash → Groq → Mistral in order.
    Returns integer score. Returns 50 on complete failure.
    """
    prompt = _SCORE_PROMPT_TEMPLATE.format(
        title=job.get("title", ""),
        company=job.get("company", ""),
        location=job.get("location", "Unknown"),
    )

    score = await _score_gemini(prompt)
    if score is not None:
        return score

    score = await _score_groq(prompt)
    if score is not None:
        return score

    score = await _score_mistral(prompt)
    if score is not None:
        return score

    return 50  # default if all providers fail


async def _score_gemini(prompt: str) -> int | None:
    try:
        import google.generativeai as genai
        genai.configure(api_key=os.environ["GOOGLE_AI_API_KEY"])
        model = genai.GenerativeModel("gemini-2.5-flash")
        response = await asyncio.to_thread(model.generate_content, prompt)
        match = re.search(r"\d+", response.text)
        if not match:
            return None
        return min(100, max(0, int(match.group())))
    except Exception as e:
        print(f"Gemini scoring failed: {e}")
        return None


async def _score_groq(prompt: str) -> int | None:
    try:
        from groq import Groq
        client = Groq(api_key=os.environ["GROQ_API_KEY"])
        response = await asyncio.to_thread(
            client.chat.completions.create,
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=5,
        )
        text = response.choices[0].message.content
        match = re.search(r"\d+", text)
        if not match:
            return None
        return min(100, max(0, int(match.group())))
    except Exception as e:
        print(f"Groq scoring failed: {e}")
        return None


async def _score_mistral(prompt: str) -> int | None:
    try:
        from mistralai import Mistral
        client = Mistral(api_key=os.environ["MISTRAL_API_KEY"])
        response = await asyncio.to_thread(
            client.chat.complete,
            model="mistral-small-latest",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=5,
        )
        text = response.choices[0].message.content
        match = re.search(r"\d+", text)
        if not match:
            return None
        return min(100, max(0, int(match.group())))
    except Exception as e:
        print(f"Mistral scoring failed: {e}")
        return None
