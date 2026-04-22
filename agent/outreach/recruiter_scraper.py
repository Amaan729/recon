"""
Recruiter scraper for the Recon outreach pipeline.
Finds recruiters at target companies via Google Custom Search API
(site:linkedin.com), scores them by title relevance, and enriches
with email via Apollo.io + Hunter.io.
Writes results to Turso DB via db.upsert_recruiter().
"""

import asyncio
import os
import re
import sys
from dataclasses import dataclass

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import db

# ── Title relevance scoring ───────────────────────────────────────

HIGH_RELEVANCE_TITLES = [
    "university recruiter", "campus recruiter",
    "early careers recruiter", "early career recruiter",
    "university recruiting", "campus recruiting",
]
MEDIUM_RELEVANCE_TITLES = [
    "technical recruiter", "tech recruiter",
    "engineering recruiter", "software recruiter",
    "talent acquisition", "recruiter",
]
LOW_RELEVANCE_TITLES = [
    "recruiting manager", "head of recruiting",
    "head of talent", "director of recruiting",
    "vp of talent",
]

GOOGLE_SEARCH_URL = "https://www.googleapis.com/customsearch/v1"
RESULTS_PER_QUERY = 10


@dataclass
class RecruiterCandidate:
    """Raw recruiter data before DB write."""
    name: str
    linkedin_url: str
    company: str
    title: str = ""
    snippet: str = ""
    relevance_score: int = 0
    email: str = ""
    email_source: str = ""


# ── Relevance scoring ─────────────────────────────────────────────

def score_recruiter(title: str) -> int:
    """
    Score a recruiter 0-100 based on title relevance.
    High = 90, Medium = 60, Low = 30, no match = 0.
    """
    title_lower = title.lower()
    for kw in HIGH_RELEVANCE_TITLES:
        if kw in title_lower:
            return 90
    for kw in MEDIUM_RELEVANCE_TITLES:
        if kw in title_lower:
            return 60
    for kw in LOW_RELEVANCE_TITLES:
        if kw in title_lower:
            return 30
    return 0


# ── Google Custom Search ──────────────────────────────────────────

async def search_recruiters_google(
    company: str,
    max_results: int = 10,
) -> list[RecruiterCandidate]:
    """
    Search Google Custom Search API for LinkedIn profiles of
    recruiters at the given company.
    Requires env vars: GOOGLE_SEARCH_API_KEY, GOOGLE_SEARCH_CX
    """
    api_key = os.environ.get("GOOGLE_SEARCH_API_KEY", "")
    cx = os.environ.get("GOOGLE_SEARCH_CX", "")

    if not api_key or not cx:
        print("Google Search API credentials not set — skipping")
        return []

    recruiter_terms = (
        '"university recruiter" OR "campus recruiter" OR '
        '"early careers" OR "technical recruiter" OR '
        '"talent acquisition" OR "recruiter"'
    )
    query = f'site:linkedin.com/in "{company}" ({recruiter_terms})'

    try:
        import httpx
        params = {
            "key": api_key,
            "cx": cx,
            "q": query,
            "num": min(max_results, RESULTS_PER_QUERY),
        }

        async with httpx.AsyncClient() as client:
            resp = await client.get(
                GOOGLE_SEARCH_URL,
                params=params,
                timeout=15,
            )

        if resp.status_code != 200:
            print(f"Google Search API error {resp.status_code}: "
                  f"{resp.text[:200]}")
            return []

        data = resp.json()
        items = data.get("items", [])
        print(f"  Google Search found {len(items)} results for {company}")
        return _parse_google_results(items, company)

    except Exception as e:
        print(f"Google Search failed for {company}: {e}")
        return []


def _parse_google_results(
    items: list[dict],
    company: str,
) -> list[RecruiterCandidate]:
    """Parse Google Custom Search result items into RecruiterCandidate objects."""
    candidates = []
    seen_urls: set[str] = set()

    for item in items:
        url = item.get("link", "")
        title_text = item.get("title", "")
        snippet = item.get("snippet", "")

        if "linkedin.com/in/" not in url:
            continue

        clean_url = url.split("?")[0].rstrip("/")
        if clean_url in seen_urls:
            continue
        seen_urls.add(clean_url)

        name, title = _parse_linkedin_title(title_text)
        if not name:
            continue

        score = score_recruiter(title)
        if score == 0:
            snippet_lower = snippet.lower()
            if not any(
                kw in snippet_lower
                for kw in ["recruit", "talent", "hiring", "campus"]
            ):
                continue
            score = 10

        candidates.append(RecruiterCandidate(
            name=name,
            linkedin_url=clean_url,
            company=company,
            title=title,
            snippet=snippet,
            relevance_score=score,
        ))

    candidates.sort(key=lambda c: c.relevance_score, reverse=True)
    return candidates


def _parse_linkedin_title(title_text: str) -> tuple[str, str]:
    """
    Parse LinkedIn page title from Google result.
    "Jane Doe - Campus Recruiter - Stripe | LinkedIn" → ("Jane Doe", "Campus Recruiter")
    """
    clean = re.sub(r"\s*[|\-]\s*LinkedIn\s*$", "", title_text).strip()
    clean = re.sub(r"\s*[-–]\s*LinkedIn\s*$", "", clean).strip()

    parts = re.split(r"\s*[-–]\s*", clean)
    if len(parts) >= 2:
        return parts[0].strip(), parts[1].strip()
    elif len(parts) == 1 and parts[0]:
        return parts[0].strip(), ""
    return "", ""


# ── Email enrichment ──────────────────────────────────────────────

async def enrich_email_apollo(
    name: str,
    company: str,
    linkedin_url: str,
) -> str | None:
    """
    Find recruiter email via Apollo.io People API.
    Requires env var: APOLLO_API_KEY
    """
    api_key = os.environ.get("APOLLO_API_KEY", "")
    if not api_key:
        return None

    try:
        import httpx
        payload = {
            "api_key": api_key,
            "name": name,
            "organization_name": company,
            "linkedin_url": linkedin_url,
            "reveal_personal_emails": False,
        }

        async with httpx.AsyncClient() as client:
            resp = await client.post(
                "https://api.apollo.io/v1/people/match",
                json=payload,
                timeout=15,
            )

        if resp.status_code != 200:
            return None

        data = resp.json()
        email = data.get("person", {}).get("email", "")
        return email if email and "@" in email else None

    except Exception as e:
        print(f"Apollo enrichment failed for {name}: {e}")
        return None


async def enrich_email_hunter(
    first_name: str,
    last_name: str,
    company_domain: str,
) -> str | None:
    """
    Find recruiter email via Hunter.io Email Finder API.
    Only returns if confidence score >= 50.
    Requires env var: HUNTER_API_KEY
    """
    api_key = os.environ.get("HUNTER_API_KEY", "")
    if not api_key or not company_domain:
        return None

    try:
        import httpx
        params = {
            "first_name": first_name,
            "last_name": last_name,
            "domain": company_domain,
            "api_key": api_key,
        }

        async with httpx.AsyncClient() as client:
            resp = await client.get(
                "https://api.hunter.io/v2/email-finder",
                params=params,
                timeout=15,
            )

        if resp.status_code != 200:
            return None

        data = resp.json().get("data", {})
        email = data.get("email", "")
        score = data.get("score", 0)
        return email if email and "@" in email and score >= 50 else None

    except Exception as e:
        print(f"Hunter enrichment failed for {first_name} {last_name}: {e}")
        return None


async def enrich_recruiter_email(
    candidate: RecruiterCandidate,
    company_domain: str = "",
) -> RecruiterCandidate:
    """
    Try Apollo then Hunter concurrently to find recruiter email.
    Prefers Apollo when both return results.
    """
    name_parts = candidate.name.strip().split()
    first = name_parts[0] if name_parts else ""
    last = name_parts[-1] if len(name_parts) > 1 else ""

    apollo_result, hunter_result = await asyncio.gather(
        enrich_email_apollo(
            name=candidate.name,
            company=candidate.company,
            linkedin_url=candidate.linkedin_url,
        ),
        enrich_email_hunter(
            first_name=first,
            last_name=last,
            company_domain=company_domain,
        ),
        return_exceptions=True,
    )

    apollo_email = apollo_result if isinstance(apollo_result, str) else None
    hunter_email = hunter_result if isinstance(hunter_result, str) else None

    if apollo_email and hunter_email:
        candidate.email = apollo_email
        candidate.email_source = "both"
    elif apollo_email:
        candidate.email = apollo_email
        candidate.email_source = "apollo"
    elif hunter_email:
        candidate.email = hunter_email
        candidate.email_source = "hunter"

    return candidate


# ── Domain inference ──────────────────────────────────────────────

def infer_company_domain(company: str) -> str:
    """
    Infer company email domain from company name.
    Returns empty string if unknown so Hunter skips gracefully.
    """
    KNOWN_DOMAINS = {
        "stripe": "stripe.com",
        "ramp": "ramp.com",
        "plaid": "plaid.com",
        "robinhood": "robinhood.com",
        "coinbase": "coinbase.com",
        "brex": "brex.com",
        "chime": "chime.com",
        "affirm": "affirm.com",
        "databricks": "databricks.com",
        "snowflake": "snowflake.com",
        "figma": "figma.com",
        "discord": "discord.com",
        "notion": "notion.so",
        "linear": "linear.app",
        "openai": "openai.com",
        "anthropic": "anthropic.com",
        "google": "google.com",
        "meta": "meta.com",
        "amazon": "amazon.com",
        "apple": "apple.com",
        "microsoft": "microsoft.com",
        "netflix": "netflix.com",
        "uber": "uber.com",
        "airbnb": "airbnb.com",
        "goldman sachs": "gs.com",
        "goldman": "gs.com",
        "jpmorgan": "jpmorgan.com",
        "morgan stanley": "morganstanley.com",
        "wells fargo": "wellsfargo.com",
        "citadel": "citadel.com",
        "jane street": "janestreet.com",
        "two sigma": "twosigma.com",
    }
    company_lower = company.lower().strip()
    for key, domain in KNOWN_DOMAINS.items():
        if key in company_lower:
            return domain
    slug = re.sub(r"[^a-z0-9]", "", company_lower)
    return f"{slug}.com" if slug else ""


# ── Main pipeline ─────────────────────────────────────────────────

async def find_and_store_recruiters(
    company: str,
    max_recruiters: int = 10,
) -> list[str]:
    """
    Full pipeline: search → enrich → store.
    Returns list of recruiter IDs written to DB.
    Called after a job application is approved or submitted.
    """
    print(f"\nFinding recruiters at {company}...")

    candidates = await search_recruiters_google(company, max_recruiters)
    if not candidates:
        print(f"  No recruiters found for {company}")
        return []

    print(f"  Found {len(candidates)} recruiter candidates")

    domain = infer_company_domain(company)
    semaphore = asyncio.Semaphore(3)

    async def enrich_with_limit(c: RecruiterCandidate) -> RecruiterCandidate:
        async with semaphore:
            return await enrich_recruiter_email(c, domain)

    enriched = await asyncio.gather(*[enrich_with_limit(c) for c in candidates])

    recruiter_ids = []
    for candidate in enriched:
        rec_id = await db.upsert_recruiter(
            name=candidate.name,
            linkedin_url=candidate.linkedin_url,
            company=candidate.company,
            title=candidate.title,
            email=candidate.email or None,
            email_source=candidate.email_source or None,
            relevance_score=candidate.relevance_score,
        )
        recruiter_ids.append(rec_id)
        status = f"email: {candidate.email}" if candidate.email else "no email"
        print(f"  Stored: {candidate.name} ({candidate.title}) — {status}")

    print(f"  Stored {len(recruiter_ids)} recruiters for {company}")
    return recruiter_ids


if __name__ == "__main__":
    import sys
    company = sys.argv[1] if len(sys.argv) > 1 else "Stripe"
    asyncio.run(find_and_store_recruiters(company))
