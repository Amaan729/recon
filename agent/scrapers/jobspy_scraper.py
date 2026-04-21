"""
Multi-board job scraper using the JobSpy library.
Scrapes ZipRecruiter, Glassdoor, and LinkedIn (backup) for
internship/co-op listings and writes qualifying jobs to Turso.
Complements the LinkedIn guest API scraper in linkedin.py.
"""

import asyncio
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import db
from scrapers.filters import passes_basic_filter

# ── Search parameters ────────────────────────────────────────────

SEARCH_TERMS = [
    "software engineering intern",
    "software engineer intern",
    "SWE intern",
    "SWE co-op",
    "machine learning engineer intern",
    "AI engineer intern",
    "backend engineer intern",
    "full stack engineer intern",
]

SITES = [
    "linkedin",       # backup coverage — different result set from guest API
    "zip_recruiter",
    "glassdoor",
]
# Note: Greenhouse, Lever, Ashby, Workday are scraped by JobSpy when
# using "google" as site with company-specific searches. For direct
# board scraping, JobSpy hits linkedin + zip_recruiter + glassdoor,
# which complements our LinkedIn guest API scraper.

LOCATION = "United States"
RESULTS_WANTED = 50   # per search term
HOURS_OLD = 24        # only jobs posted in last 24 hours
COUNTRY_INDEED = "USA"

TIER_1_COMPANIES = [
    "jane street", "hrt", "citadel", "two sigma", "drw",
    "jump trading", "akuna", "imc", "optiver", "sig",
    "google", "meta", "amazon", "apple", "microsoft",
    "netflix", "uber", "airbnb", "stripe", "databricks",
]


# ── Scraper ──────────────────────────────────────────────────────

def scrape_jobs_for_term(search_term: str) -> list[dict]:
    """
    Use JobSpy to scrape all SITES for a single search term.
    Returns list of normalized job dicts with keys:
      title, company, location, job_board_url, source
    JobSpy returns a pandas DataFrame — converted to list of dicts.
    Handles import errors and empty results gracefully.
    """
    try:
        from jobspy import scrape_jobs

        df = scrape_jobs(
            site_name=SITES,
            search_term=search_term,
            location=LOCATION,
            results_wanted=RESULTS_WANTED,
            hours_old=HOURS_OLD,
            country_indeed=COUNTRY_INDEED,
            linkedin_fetch_description=False,  # faster, skips extra requests
        )

        if df is None or df.empty:
            return []

        jobs = []
        for _, row in df.iterrows():
            url = str(row.get("job_url", "")).strip()
            if not url or url == "nan":
                continue

            title = str(row.get("title", "")).strip()
            company = str(row.get("company", "")).strip()
            if not title or not company or title == "nan" or company == "nan":
                continue

            raw_location = str(row.get("location", "")).strip()
            location = None if raw_location in ("", "nan") else raw_location

            site = str(row.get("site", "")).strip()
            source = site if site and site != "nan" else "jobspy"

            jobs.append({
                "title": title,
                "company": company,
                "location": location,
                "job_board_url": url,
                "source": source,
            })

        return jobs

    except Exception as e:
        print(f"JobSpy error for '{search_term}': {e}")
        return []


async def scrape_all_terms() -> list[dict]:
    """
    Run scrape_jobs_for_term for all SEARCH_TERMS.
    Deduplicates by job_board_url across all terms.
    Runs each term in a thread (JobSpy is synchronous).
    """
    seen: dict[str, dict] = {}

    for term in SEARCH_TERMS:
        print(f"JobSpy scraping: {term}")
        jobs = await asyncio.to_thread(scrape_jobs_for_term, term)
        new = 0
        for job in jobs:
            url = job["job_board_url"]
            if url not in seen:
                seen[url] = job
                new += 1
        print(f"  found {len(jobs)} results, {new} new unique")
        await asyncio.sleep(3)  # polite delay between terms

    return list(seen.values())


# ── Entry point ──────────────────────────────────────────────────

async def main() -> None:
    """
    Main entry point for GitHub Actions.
    1. Scrape all search terms across all boards
    2. Apply basic keyword filter
    3. Insert passing jobs into Turso (dedup handled by db.insert_job)
    4. Print summary
    """
    print("Starting JobSpy scraper...")
    jobs = await scrape_all_terms()
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

        await db.insert_job(
            title=job["title"],
            company=job["company"],
            job_board_url=job["job_board_url"],
            source=job["source"],
            location=job.get("location"),
            is_top_priority=False,
        )
        inserted += 1

    print(
        f"Done — inserted: {inserted} | "
        f"skipped: {skipped} | tier-1 hits: {tier1}"
    )


if __name__ == "__main__":
    asyncio.run(main())
