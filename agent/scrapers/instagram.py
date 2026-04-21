"""
Instagram story monitor for the Recon job hunting agent.
Watches zero2sudo's Instagram stories for job opportunity links.
Runs 3x/day via GitHub Actions and inserts found jobs into Turso
with isTopPriority=True so they surface first in the approval queue.
"""

import asyncio
import os
import re
import sys
from datetime import datetime, timedelta, timezone

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import db

INSTAGRAM_ACCOUNT = "zero2sudo"
APIFY_ACTOR_ID = "apify/instagram-scraper"
APIFY_TOKEN_ENV = "APIFY_API_KEY"

# Only process stories posted in the last 9 hours
# (workflow runs every 8 hrs; 1-hr overlap guards against clock skew)
MAX_STORY_AGE_HOURS = 9

# URL patterns that suggest a job posting link
JOB_URL_PATTERNS = [
    r"greenhouse\.io",
    r"lever\.co",
    r"ashbyhq\.com",
    r"workday\.com",
    r"linkedin\.com/jobs",
    r"jobs\.",
    r"careers\.",
    r"apply\.",
    r"handshake",
    r"simplify\.jobs",
]


# ── Apify fetch ──────────────────────────────────────────────────

async def fetch_stories() -> list[dict]:
    """
    Run the Apify Instagram scraper actor and return raw story items.
    Uses synchronous Apify client wrapped in asyncio.to_thread.
    Returns empty list on any failure so the caller never crashes.
    """
    try:
        from apify_client import ApifyClient
        token = os.environ[APIFY_TOKEN_ENV]
        client = ApifyClient(token)

        print(f"Running Apify actor for @{INSTAGRAM_ACCOUNT} stories...")

        run_input = {
            "directUrls": [f"https://www.instagram.com/{INSTAGRAM_ACCOUNT}/"],
            "resultsType": "stories",
            "resultsLimit": 20,
        }

        run = await asyncio.to_thread(
            lambda: client.actor(APIFY_ACTOR_ID).call(
                run_input=run_input,
                timeout_secs=120,
            )
        )

        if not run:
            print("Apify run returned None")
            return []

        items = await asyncio.to_thread(
            lambda: list(
                client.dataset(run["defaultDatasetId"]).iterate_items()
            )
        )

        print(f"Apify returned {len(items)} story items")
        return items

    except KeyError:
        # APIFY_API_KEY not set — expected in local dev without creds
        print(f"Skipping Apify fetch: {APIFY_TOKEN_ENV} not set")
        return []
    except Exception as e:
        print(f"Apify fetch failed: {e}")
        return []


# ── Story parsing ────────────────────────────────────────────────

def extract_urls_from_story(story: dict) -> list[str]:
    """
    Extract all URLs from a single story item.
    Checks externalUrl (link sticker) first, then scans caption text.
    Returns deduplicated list preserving discovery order.
    """
    urls: list[str] = []

    # Link sticker is the most reliable signal
    external = story.get("externalUrl", "")
    if external and isinstance(external, str) and external.startswith("http"):
        urls.append(external.strip())

    # Scan caption for bare URLs
    caption = story.get("caption") or ""
    urls.extend(re.findall(r"https?://[^\s\)\]\>\"']+", caption))

    # Deduplicate preserving order
    seen: set[str] = set()
    unique: list[str] = []
    for url in urls:
        if url not in seen:
            seen.add(url)
            unique.append(url)
    return unique


def is_job_url(url: str) -> bool:
    """
    Return True if a URL matches a known job-board pattern.
    Also returns True for any other URL — zero2sudo only posts
    job-relevant links, so unknown URLs are worth reviewing.
    """
    url_lower = url.lower()
    for pattern in JOB_URL_PATTERNS:
        if re.search(pattern, url_lower):
            return True
    return True  # treat all zero2sudo links as worth reviewing


def is_recent(story: dict) -> bool:
    """
    Return True if story was posted within MAX_STORY_AGE_HOURS.
    Handles missing and malformed timestamps without raising.
    """
    timestamp = story.get("timestamp")
    if not timestamp:
        return True  # no timestamp → assume recent

    try:
        if isinstance(timestamp, str):
            ts = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        elif isinstance(timestamp, (int, float)):
            ts = datetime.fromtimestamp(timestamp, tz=timezone.utc)
        else:
            return True

        cutoff = datetime.now(timezone.utc) - timedelta(hours=MAX_STORY_AGE_HOURS)
        return ts > cutoff
    except Exception:
        return True  # parse error → assume recent


# ── URL inference helpers ────────────────────────────────────────

def infer_title_from_url(url: str) -> str:
    """Return a generic job title; the approver will see the real URL."""
    return f"Job Opportunity (via @{INSTAGRAM_ACCOUNT})"


def infer_company_from_url(url: str) -> str:
    """
    Extract a company name hint from the URL domain and path.
    Handles three patterns:
      stripe.greenhouse.io/...       → "Stripe"   (company as subdomain)
      boards.greenhouse.io/ramp/...  → "Ramp"     (company in path)
      jobs.ramp.com/...              → "Ramp"     (company-owned domain)
    Falls back to "Unknown" on any parse error.
    """
    try:
        from urllib.parse import urlparse
        parsed = urlparse(url)
        domain = parsed.netloc.lower()
        domain = re.sub(r"^www\.", "", domain)
        path_parts = [p for p in parsed.path.split("/") if p]

        # Domains where the company appears in the URL path, not the subdomain.
        # e.g. boards.greenhouse.io/COMPANY, jobs.lever.co/COMPANY
        PATH_BASED_BOARDS = {
            "boards.greenhouse.io",
            "app.greenhouse.io",
            "lever.co",
            "jobs.lever.co",
            "workable.com",
            "apply.workable.com",
            "job-boards.greenhouse.io",
        }
        if domain in PATH_BASED_BOARDS:
            if path_parts:
                return path_parts[0].replace("-", " ").title()
            return "Unknown"

        # Domains where the company appears as a subdomain before the board.
        # e.g. stripe.greenhouse.io, ramp.ashbyhq.com
        # Some boards are also accessed as jobs.COMPANY.board — those subdomains
        # are non-company prefixes and we fall through to path extraction.
        NON_COMPANY_SUBDOMAIN = {
            "jobs", "boards", "careers", "apply", "hire", "work", "app",
        }
        SUBDOMAIN_BOARDS = [
            r"\.greenhouse\.io$",
            r"\.lever\.co$",
            r"\.ashbyhq\.com$",
            r"\.workday\.com$",
            r"\.simplify\.jobs$",
        ]
        for pattern in SUBDOMAIN_BOARDS:
            stripped = re.sub(pattern, "", domain)
            if stripped == domain:
                continue
            # stripped is e.g. "stripe" or "jobs" (when domain was jobs.lever.co)
            candidate = stripped.split(".")[-1]
            if candidate not in NON_COMPANY_SUBDOMAIN:
                return candidate.capitalize()
            # Generic prefix (e.g. "jobs") — company is in the path instead
            if path_parts:
                return path_parts[0].replace("-", " ").title()
            return "Unknown"

        # Company-owned job pages: strip job-specific subdomain prefix.
        # e.g. jobs.ramp.com → "Ramp",  careers.databricks.com → "Databricks"
        SKIP_PREFIXES = {
            "jobs", "careers", "apply", "boards", "hire", "work", "recruiting",
        }
        SKIP_TLDS = {"com", "io", "co", "net", "org", "edu", "ai"}
        for part in domain.split("."):
            if part not in SKIP_PREFIXES and part not in SKIP_TLDS and len(part) > 2:
                return part.capitalize()

        return "Unknown"
    except Exception:
        return "Unknown"


# ── Entry point ──────────────────────────────────────────────────

async def main() -> None:
    """
    Main entry point for GitHub Actions.
    1. Fetch recent stories via Apify
    2. Extract and deduplicate URLs
    3. Insert each URL as a top-priority Job in Turso
    4. Print summary
    """
    print(f"Starting Instagram monitor for @{INSTAGRAM_ACCOUNT}...")

    stories = await fetch_stories()
    recent = [s for s in stories if is_recent(s)]
    print(f"{len(stories)} stories fetched, {len(recent)} are recent")

    inserted = 0
    seen_urls: set[str] = set()

    for story in recent:
        for url in extract_urls_from_story(story):
            if url in seen_urls:
                continue
            seen_urls.add(url)

            if not is_job_url(url):
                continue

            title = infer_title_from_url(url)
            company = infer_company_from_url(url)

            await db.insert_job(
                title=title,
                company=company,
                job_board_url=url,
                source="instagram",
                location=None,
                jd_text=story.get("caption"),
                is_top_priority=True,  # zero2sudo links jump the queue
            )
            print(f"  Inserted priority job: {company} — {url}")
            inserted += 1

    print(f"Done — inserted {inserted} priority jobs from Instagram")


if __name__ == "__main__":
    asyncio.run(main())
