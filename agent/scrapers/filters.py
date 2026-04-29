"""
Job filtering utilities shared across all scrapers.
Applies keyword-based pre-filter and AI match scoring.
Location validation uses rule-based checks first, then
Nominatim (OpenStreetMap) geocoding for ambiguous cases.
AI scoring uses Gemini 2.5 Flash → Groq fallback → Mistral fallback.
"""

import asyncio
import os
import re
import httpx

# ── Role filtering ───────────────────────────────────────────────

EXCLUDE_KEYWORDS_LOWER = [
    "data analyst",
    "it support",
    "it intern",
    "qa engineer",
    "quality assurance",
    "product intern",
    "product manager",
    "junior software engineer",
    "associate software engineer",
    "devops intern",
    "security intern",
    "hardware engineer",
    "marketing intern",
    "sales intern",
    "finance intern",
    "accounting intern",
    "hr intern",
    "recruiting intern",
    "operations intern",
    "business analyst",
    "business development",
    "ux intern",
    "ui intern",
    "graphic design",
    "content intern",
    "social media intern",
    "research analyst",
    "data entry",
    "embedded systems",
    "firmware",
    "fpga",
    "hardware",
    "mechanical",
    "electrical",
    "civil",
    "chemical",
    "supply chain",
    "logistics",
    "legal intern",
    "paralegal",
    "administrative",
    "customer success",
    "customer support",
    "technical support",
    "technical writer",
    "project manager",
    "program manager",
    "scrum master",
]

REQUIRED_INTERN_TERMS = [
    "intern",
    "co-op",
    "coop",
    "internship",
]

EXCLUDE_SENIORITY_TERMS = [
    "senior",
    "sr",
    "sr.",
    "staff",
    "principal",
    "lead",
    "manager",
    "director",
    "head",
    "vp",
    "architect",
]

ALLOWED_ROLE_TERMS = [
    "software engineer",
    "software developer",
    "swe",
    "ml",
    "ml engineer",
    "machine learning",
    "ml/ai",
    "ai",
    "ai engineer",
    "ai/ml",
    "artificial intelligence",
    "backend engineer",
    "backend developer",
    "full stack",
    "fullstack",
    "full-stack",
    "frontend engineer",
    "frontend developer",
    "quant developer",
    "quantitative developer",
    "quant trader",
    "quant trading",
    "quantitative trader",
    "quantitative trading",
    "quantitative researcher",
    "quant researcher",
    "quant",
    "software",
    "engineer",
    "developer",
]

_TERM_SEPARATOR_RE = r"[\s/,+:&()\-]+"


def _term_pattern(term: str) -> re.Pattern[str]:
    """Build a token-aware pattern so intern does not match internal."""
    pieces = [
        re.escape(piece)
        for piece in re.split(_TERM_SEPARATOR_RE, term.lower().strip().rstrip("."))
        if piece
    ]
    if not pieces:
        return re.compile(r"a^")
    return re.compile(
        r"(?<![a-z0-9])" + _TERM_SEPARATOR_RE.join(pieces) + r"(?![a-z0-9])",
        re.IGNORECASE,
    )


_REQUIRED_INTERN_PATTERNS = [_term_pattern(term) for term in REQUIRED_INTERN_TERMS]
_ALLOWED_ROLE_PATTERNS = [_term_pattern(term) for term in ALLOWED_ROLE_TERMS]
_EXCLUDE_KEYWORD_PATTERNS = [_term_pattern(term) for term in EXCLUDE_KEYWORDS_LOWER]
_EXCLUDE_SENIORITY_PATTERNS = [_term_pattern(term) for term in EXCLUDE_SENIORITY_TERMS]


def _contains_any_pattern(text: str, patterns: list[re.Pattern[str]]) -> bool:
    return any(pattern.search(text) for pattern in patterns)


# ── Location filtering ───────────────────────────────────────────

US_STATES = {
    "al", "ak", "az", "ar", "ca", "co", "ct", "de", "fl", "ga", "hi", "id",
    "il", "in", "ia", "ks", "ky", "la", "me", "md", "ma", "mi", "mn", "ms",
    "mo", "mt", "ne", "nv", "nh", "nj", "nm", "ny", "nc", "nd", "oh", "ok",
    "or", "pa", "ri", "sc", "sd", "tn", "tx", "ut", "vt", "va", "wa", "wv",
    "wi", "wy", "dc",
}

CANADA_PROVINCES = {
    "ab", "bc", "mb", "nb", "nl", "ns", "nt", "nu", "on", "pe", "qc", "sk", "yt",
}

US_CANADA_CODES = US_STATES | CANADA_PROVINCES

US_STATE_NAMES = {
    "alabama", "alaska", "arizona", "arkansas", "california", "colorado",
    "connecticut", "delaware", "florida", "georgia", "hawaii", "idaho",
    "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana",
    "maine", "maryland", "massachusetts", "michigan", "minnesota",
    "mississippi", "missouri", "montana", "nebraska", "nevada",
    "new hampshire", "new jersey", "new mexico", "new york",
    "north carolina", "north dakota", "ohio", "oklahoma", "oregon",
    "pennsylvania", "rhode island", "south carolina", "south dakota",
    "tennessee", "texas", "utah", "vermont", "virginia", "washington",
    "west virginia", "wisconsin", "wyoming", "district of columbia",
    "washington dc", "washington d.c.",
}

CANADA_PROVINCE_NAMES = {
    "alberta", "british columbia", "manitoba", "new brunswick",
    "newfoundland", "nova scotia", "northwest territories", "nunavut",
    "ontario", "prince edward island", "quebec", "saskatchewan", "yukon",
}

ALWAYS_PASS_TERMS = [
    "united states", "usa", "u.s.", "u.s.a",
    "canada", "remote", "hybrid", "anywhere", "worldwide",
    "work from home", "wfh", "distributed",
]

_nominatim_cache: dict[str, bool] = {}


def _rule_based_location_check(location: str) -> bool | None:
    """
    Fast rule-based location check. Returns:
    - True  → definitely US or Canada
    - False → definitely not US or Canada
    - None  → ambiguous, needs Nominatim
    """
    if not location:
        return True

    loc = location.lower().strip()

    if any(term in loc for term in ALWAYS_PASS_TERMS):
        return True

    if any(name in loc for name in US_STATE_NAMES | CANADA_PROVINCE_NAMES):
        return True

    parts = [p.strip() for p in loc.split(",")]
    if len(parts) >= 2:
        for part in parts[-2:]:
            tokens = part.strip().split()
            for token in tokens:
                clean = token.strip().rstrip(".").rstrip(",")
                if clean in US_CANADA_CODES:
                    return True

    if re.search(r"\b\d{5}\b", loc):
        return True

    return None


async def _nominatim_location_check(location: str) -> bool:
    """
    Use Nominatim (OpenStreetMap) geocoding to determine if a location
    is in the US or Canada. Results are cached to avoid duplicate calls.
    Returns True if US/Canada, False otherwise.
    Falls back to True (let through) on any error.
    """
    if location in _nominatim_cache:
        return _nominatim_cache[location]

    try:
        await asyncio.sleep(1.1)  # Nominatim rate limit: 1 req/sec
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                "https://nominatim.openstreetmap.org/search",
                params={
                    "q": location,
                    "format": "json",
                    "limit": 1,
                    "addressdetails": 1,
                },
                headers={"User-Agent": "recon-job-scraper/1.0"},
                timeout=5.0,
            )
            if resp.status_code != 200:
                _nominatim_cache[location] = True
                return True

            data = resp.json()
            if not data:
                _nominatim_cache[location] = True
                return True

            address = data[0].get("address", {})
            country_code = address.get("country_code", "").lower()
            result = country_code in ("us", "ca")
            _nominatim_cache[location] = result
            return result

    except Exception as e:
        print(f"Nominatim lookup failed for '{location}': {e}")
        _nominatim_cache[location] = True
        return True


async def is_us_or_canada(location: str) -> bool:
    """
    Hybrid location check:
    1. Fast rule-based check — handles 90%+ of cases instantly
    2. Nominatim geocoding for ambiguous cases (Greater X Area,
       Metro DC, unusual formats, foreign city names, etc.)
    """
    rule_result = _rule_based_location_check(location)
    if rule_result is not None:
        return rule_result
    return await _nominatim_location_check(location)


async def passes_basic_filter(job: dict) -> bool:
    """
    Returns True only if:
    1. Title contains at least one REQUIRED_INTERN_TERMS value
    2. Title contains at least one ALLOWED_ROLE_TERMS value
    3. Title does not contain any EXCLUDE_KEYWORDS_LOWER value
    4. Location is US or Canada (or unknown/remote)

    NOTE: This function is now async because of the Nominatim call.
    All scrapers must await it.
    """
    title_lower = (job.get("title") or "").lower()
    location = (job.get("location") or "")

    has_intern_term = _contains_any_pattern(title_lower, _REQUIRED_INTERN_PATTERNS)
    if not has_intern_term:
        return False

    has_role_term = _contains_any_pattern(title_lower, _ALLOWED_ROLE_PATTERNS)
    if not has_role_term:
        return False

    has_excluded = (
        _contains_any_pattern(title_lower, _EXCLUDE_KEYWORD_PATTERNS)
        or _contains_any_pattern(title_lower, _EXCLUDE_SENIORITY_PATTERNS)
    )
    if has_excluded:
        return False

    if not await is_us_or_canada(location):
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
        from langchain_google_genai import ChatGoogleGenerativeAI

        llm = ChatGoogleGenerativeAI(
            model="gemini-2.5-flash",
            google_api_key=os.environ["GOOGLE_AI_API_KEY"],
            temperature=0.1,
        )
        response = await llm.ainvoke(prompt)
        content = getattr(response, "content", str(response))
        if isinstance(content, list):
            content = "".join(
                part.get("text", "") if isinstance(part, dict) else str(part)
                for part in content
            )
        match = re.search(r"\d+", str(content))
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
