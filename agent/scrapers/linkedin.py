"""
LinkedIn job scraper using the guest API (no login required).
Fetches internship/co-op listings every 4 hours and writes
qualifying jobs to the Turso DB via agent/db.py.
"""

import asyncio
import os
import re
import sys
import time

import httpx

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import db
from scrapers.filters import ai_match_score, passes_basic_filter

# ── Criteria constants ────────────────────────────────────────────

ROLES = [
    "software engineering intern",
    "swe intern",
    "swe co-op",
    "software engineer intern",
    "software engineer co-op",
    "ml engineer intern",
    "ai engineer intern",
    "backend engineer intern",
    "full stack engineer intern",
]

EXCLUDE_KEYWORDS = [
    "data analyst",
    "IT ",
    "qa engineer",
    "product intern",
    "junior software engineer",
    "associate software engineer",
]

INDUSTRIES = [
    "fintech",
    "financial technology",
    "ai",
    "machine learning",
    "cloud",
    "infrastructure",
    "enterprise software",
]

MIN_COMPANY_SIZE = "mid"  # filter hint for AI, not enforced by API

SEARCH_QUERIES = [
    "software engineering intern fintech",
    "swe intern AI machine learning",
    "backend engineer intern cloud infrastructure",
    "software engineer co-op enterprise",
    "ml engineer intern",
    "full stack engineer intern fintech",
]

TIER_1_COMPANIES = [
    "jane street", "hrt", "citadel", "two sigma", "drw",
    "jump trading", "akuna", "imc", "optiver", "sig",
    "google", "meta", "amazon", "apple", "microsoft",
    "netflix", "uber", "airbnb", "stripe", "databricks",
]

# ── LinkedIn guest API config ────────────────────────────────────

LINKEDIN_GUEST_URL = (
    "https://www.linkedin.com/jobs-guest/jobs/api/"
    "seeMoreJobPostings/search"
)
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}
RESULTS_PER_PAGE = 25
MAX_PAGES = 4         # 100 results per query max
REQUEST_DELAY = 2.5   # seconds between requests (be polite)


# ── Scraper ──────────────────────────────────────────────────────

async def fetch_jobs_for_query(
    client: httpx.AsyncClient,
    query: str,
    page: int = 0,
) -> list[dict]:
    """
    Fetch one page of LinkedIn guest API results for a query.
    Returns list of raw job dicts. Returns empty list on error.

    LinkedIn guest API returns HTML fragments — parsed with regex,
    no BeautifulSoup dependency required.
    """
    params = {
        "keywords": query,
        "location": "United States",
        "f_E": "1",         # experience level: internship
        "f_JT": "I",        # job type: internship
        "f_TPR": "r86400",  # posted within last 24 hours
        "start": page * RESULTS_PER_PAGE,
        "count": RESULTS_PER_PAGE,
    }
    try:
        resp = await client.get(
            LINKEDIN_GUEST_URL,
            params=params,
            headers=HEADERS,
            timeout=15,
        )
        if resp.status_code == 429:
            print(f"Rate limited on query '{query}', sleeping 30s")
            await asyncio.sleep(30)
            return []
        if resp.status_code != 200:
            print(f"LinkedIn guest API returned {resp.status_code} for '{query}'")
            return []
        return parse_linkedin_html(resp.text)
    except Exception as e:
        print(f"Error fetching LinkedIn jobs for '{query}': {e}")
        return []


def parse_linkedin_html(html: str) -> list[dict]:
    """
    Parse LinkedIn guest API HTML response.
    Extracts title, company, location, job_board_url from each
    <li> job card using regex — no external HTML parser needed.
    Returns list of dicts with keys:
      title, company, location, job_board_url, source
    """
    jobs = []
    job_cards = re.findall(r"<li>(.*?)</li>", html, re.DOTALL)

    for card in job_cards:
        url_match = re.search(
            r'href="(https://www\.linkedin\.com/jobs/view/[^"?]+)',
            card,
        )
        title_match = re.search(
            r'class="[^"]*base-search-card__title[^"]*"[^>]*>\s*([^<]+)',
            card,
        )
        company_match = re.search(
            r'class="[^"]*base-search-card__subtitle[^"]*"[^>]*>\s*([^<]+)',
            card,
        )
        location_match = re.search(
            r'class="[^"]*job-search-card__location[^"]*"[^>]*>\s*([^<]+)',
            card,
        )

        if not (url_match and title_match and company_match):
            continue

        jobs.append({
            "title": title_match.group(1).strip(),
            "company": company_match.group(1).strip(),
            "location": location_match.group(1).strip() if location_match else None,
            "job_board_url": url_match.group(1).strip(),
            "source": "linkedin",
        })

    return jobs


async def scrape_all_queries() -> list[dict]:
    """Run all SEARCH_QUERIES and collect deduplicated results."""
    seen: dict[str, dict] = {}  # keyed by job_board_url

    async with httpx.AsyncClient() as client:
        for query in SEARCH_QUERIES:
            print(f"Scraping: {query}")
            for page in range(MAX_PAGES):
                jobs = await fetch_jobs_for_query(client, query, page)
                if not jobs:
                    break
                new_on_page = 0
                for job in jobs:
                    url = job["job_board_url"]
                    if url not in seen:
                        seen[url] = job
                        new_on_page += 1
                print(f"  page {page}: {len(jobs)} results, {new_on_page} new")
                # Stop paging early if nothing new on this page
                if new_on_page == 0:
                    break
                await asyncio.sleep(REQUEST_DELAY)

    return list(seen.values())


# ── Entry point ──────────────────────────────────────────────────

async def main() -> None:
    """
    Main entry point for GitHub Actions.
    1. Scrape all queries
    2. Apply basic keyword filter
    3. Insert passing jobs into Turso DB (dedup handled by db.insert_job)
    4. Print summary
    """
    print("Starting LinkedIn scraper...")
    jobs = await scrape_all_queries()
    print(f"Found {len(jobs)} unique jobs before filtering")

    inserted = 0
    skipped = 0
    tier1 = 0

    for job in jobs:
        if not passes_basic_filter(job):
            skipped += 1
            continue

        is_tier1 = any(
            t1.lower() in job["company"].lower()
            for t1 in TIER_1_COMPANIES
        )
        if is_tier1:
            tier1 += 1

        job_id = await db.insert_job(
            title=job["title"],
            company=job["company"],
            job_board_url=job["job_board_url"],
            source=job["source"],
            location=job.get("location"),
            is_top_priority=False,  # LinkedIn jobs are not zero2sudo referrals
        )
        inserted += 1

    print(
        f"Done — inserted: {inserted} | skipped: {skipped} | tier-1 hits: {tier1}"
    )


if __name__ == "__main__":
    asyncio.run(main())
