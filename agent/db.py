"""
Database client for the Recon Python agent.
Connects to the same Turso (libSQL) database as the Next.js web app.
Used by scrapers, resume engine, and outreach modules to read/write
Job, Application, Recruiter, and RecruiterOutreach records.
"""

import os
from datetime import datetime, timedelta
from difflib import SequenceMatcher
from typing import TYPE_CHECKING
from uuid import uuid4

from dotenv import load_dotenv

if TYPE_CHECKING:
    import libsql_client

load_dotenv()

_client = None

_DEFAULT_CANDIDATE_PROFILE = {
    "firstName": "Amaan",
    "lastName": "Sayed",
    "email": "asayed7@asu.edu",
    "phone": "",
    "university": "Arizona State University",
    "major": "Computer Science and Finance",
    "gpa": "4.0",
    "graduationYear": "2028",
    "graduationMonth": "May",
    "linkedinUrl": "https://www.linkedin.com/in/amaansayed",
    "githubUrl": "https://github.com/Amaan729",
    "portfolioUrl": "",
    "location": "Tempe, Arizona",
    "workAuthorization": "Yes",
    "requiresSponsorship": "No",
}

_CANDIDATE_PROFILE_FIELDS = [
    "firstName",
    "lastName",
    "email",
    "phone",
    "university",
    "major",
    "gpa",
    "graduationYear",
    "graduationMonth",
    "linkedinUrl",
    "githubUrl",
    "portfolioUrl",
    "location",
    "workAuthorization",
    "requiresSponsorship",
]


def get_client():
    """Return a singleton libSQL client connected to Turso."""
    global _client
    if _client is None:
        try:
            import libsql_client
        except ModuleNotFoundError as e:
            raise ModuleNotFoundError(
                "libsql_client is required to use agent.db; install "
                "agent/requirements.txt before accessing the database."
            ) from e
        url = os.environ["TURSO_DATABASE_URL"]
        auth_token = os.environ.get("TURSO_AUTH_TOKEN")
        _client = libsql_client.create_client(
            url=url,
            auth_token=auth_token,
        )
    return _client


async def insert_job(
    title: str,
    company: str,
    job_board_url: str,
    source: str,
    location: str | None = None,
    jd_text: str | None = None,
    is_top_priority: bool = False,
) -> str:
    """
    Insert a new Job record with status='pending'.
    Returns the new job's cuid.
    Silently skips insert if jobBoardUrl already exists (dedup).
    """
    client = get_client()
    job_id = _cuid()

    existing = await client.execute(
        "SELECT id FROM Job WHERE jobBoardUrl = ?",
        [job_board_url],
    )
    if existing.rows:
        return existing.rows[0][0]

    try:
        if await is_fuzzy_duplicate(title, company):
            print(f"[db] fuzzy duplicate skipped: {title} @ {company}")
            return "fuzzy_duplicate"
    except Exception as e:
        print(f"[db] fuzzy duplicate check failed: {e}")

    await client.execute(
        """
        INSERT INTO Job
          (id, title, company, location, jobBoardUrl, source,
           status, isTopPriority, jdText, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?,
                datetime('now'), datetime('now'))
        """,
        [job_id, title, company, location, job_board_url,
         source, int(is_top_priority), jd_text],
    )
    return job_id


async def is_fuzzy_duplicate(title: str, company: str) -> bool:
    """Return True if a recent job from the same company has a similar title."""
    client = get_client()
    cutoff = (datetime.utcnow() - timedelta(days=7)).isoformat()
    result = await client.execute(
        "SELECT id, title FROM Job WHERE LOWER(company) = LOWER(?) AND createdAt >= ?",
        [company.strip(), cutoff],
    )

    title_lower = title.lower()
    for row in result.rows:
        row_title = row[1]
        if not row_title:
            continue
        similarity = SequenceMatcher(
            None,
            title_lower,
            str(row_title).lower(),
        ).ratio()
        if similarity >= 0.85:
            return True

    return False


async def get_pending_jobs() -> list[dict]:
    """Return all jobs with status='pending', ordered by
    isTopPriority DESC then createdAt ASC."""
    client = get_client()
    result = await client.execute(
        """
        SELECT id, title, company, location, jobBoardUrl, source,
               isTopPriority, jdText, matchScore
        FROM Job
        WHERE status = 'pending'
        ORDER BY isTopPriority DESC, createdAt ASC
        """
    )
    return [dict(zip([c.name for c in result.columns], row))
            for row in result.rows]


async def update_job_status(job_id: str, status: str) -> None:
    """Update a job's status. Valid values: pending | approved |
    skipped | applied | failed."""
    client = get_client()
    await client.execute(
        "UPDATE Job SET status = ?, updatedAt = datetime('now') "
        "WHERE id = ?",
        [status, job_id],
    )


async def upsert_recruiter(
    name: str,
    linkedin_url: str,
    company: str,
    title: str | None = None,
    email: str | None = None,
    email_source: str | None = None,
    relevance_score: int | None = None,
) -> str:
    """Insert recruiter if not exists, update email/score if they do.
    Returns recruiter id."""
    client = get_client()
    existing = await client.execute(
        "SELECT id FROM Recruiter WHERE linkedinUrl = ?",
        [linkedin_url],
    )
    if existing.rows:
        rec_id = existing.rows[0][0]
        if email:
            await client.execute(
                "UPDATE Recruiter SET email=?, emailSource=?, "
                "relevanceScore=? WHERE id=?",
                [email, email_source, relevance_score, rec_id],
            )
        return rec_id

    rec_id = _cuid()
    await client.execute(
        """
        INSERT INTO Recruiter
          (id, name, title, company, linkedinUrl, email,
           emailSource, relevanceScore, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        """,
        [rec_id, name, title, company, linkedin_url,
         email, email_source, relevance_score],
    )
    return rec_id


async def queue_outreach(
    recruiter_id: str,
    channel: str,
    application_id: str | None = None,
    message_text: str | None = None,
) -> str:
    """Queue an outreach record with status='queued'."""
    client = get_client()
    out_id = _cuid()
    await client.execute(
        """
        INSERT INTO RecruiterOutreach
          (id, recruiterId, applicationId, channel, status,
           messageText, createdAt)
        VALUES (?, ?, ?, ?, 'queued', ?, datetime('now'))
        """,
        [out_id, recruiter_id, application_id, channel, message_text],
    )
    return out_id


async def get_approved_jobs() -> list[dict]:
    """Return all jobs with status='approved', ordered by
    isTopPriority DESC then createdAt ASC."""
    client = get_client()
    result = await client.execute(
        """
        SELECT id, title, company, location, jobBoardUrl,
               isTopPriority
        FROM Job
        WHERE status = 'approved'
        ORDER BY isTopPriority DESC, createdAt ASC
        """
    )
    return [dict(zip([c.name for c in result.columns], row))
            for row in result.rows]


async def get_queued_linkedin_outreach() -> list[dict]:
    """Return all queued LinkedIn outreach items joined with recruiter info,
    ordered by createdAt ASC."""
    client = get_client()
    result = await client.execute(
        """
        SELECT
            ro.id, ro.recruiterId, ro.channel, ro.messageText,
            ro.createdAt, ro.applicationId,
            r.name  AS recruiterName,
            r.company,
            r.linkedinUrl,
            r.title AS recruiterTitle
        FROM RecruiterOutreach ro
        JOIN Recruiter r ON ro.recruiterId = r.id
        WHERE ro.channel IN (
            'linkedin_connection','linkedin_inmail','linkedin_dm'
        )
          AND ro.status = 'queued'
        ORDER BY ro.createdAt ASC
        """
    )
    return [dict(zip([c.name for c in result.columns], row))
            for row in result.rows]


async def get_recruiters_for_company(company: str) -> list[dict]:
    """Return all recruiters for a company ordered by relevance score DESC."""
    client = get_client()
    result = await client.execute(
        """
        SELECT id, name, title, company, linkedinUrl, email,
               emailSource, relevanceScore, contactedAt,
               linkedinSentAt, createdAt
        FROM Recruiter
        WHERE LOWER(company) LIKE LOWER(?)
        ORDER BY relevanceScore DESC
        """,
        [f"%{company}%"],
    )
    return [dict(zip([c.name for c in result.columns], row))
            for row in result.rows]


async def get_active_ats_slugs(board: str | None = None) -> list[dict]:
    """Return all active ATS slugs, optionally scoped to one board."""
    client = get_client()
    if board is not None:
        result = await client.execute(
            """
            SELECT id, slug, atsBoard, company, lastScrapedAt, active
            FROM AtsSlugs
            WHERE active = 1 AND atsBoard = ?
            ORDER BY company ASC
            """,
            [board],
        )
    else:
        result = await client.execute(
            """
            SELECT id, slug, atsBoard, company, lastScrapedAt, active
            FROM AtsSlugs
            WHERE active = 1
            ORDER BY atsBoard ASC, company ASC
            """
        )
    columns = [
        c.name if hasattr(c, "name") else str(c)
        for c in result.columns
    ]
    return [dict(zip(columns, row))
            for row in result.rows]


async def upsert_ats_slug(slug: str, ats_board: str, company: str) -> None:
    """Insert an ATS slug row if it does not already exist."""
    client = get_client()
    await client.execute(
        """
        INSERT OR IGNORE INTO AtsSlugs
          (id, slug, atsBoard, company, active, createdAt)
        VALUES (?, ?, ?, ?, 1, ?)
        """,
        [str(uuid4()), slug, ats_board, company, datetime.utcnow().isoformat()],
    )


async def update_ats_slug_scraped(slug: str, ats_board: str) -> None:
    """Update the last scrape timestamp for one ATS slug row."""
    client = get_client()
    await client.execute(
        "UPDATE AtsSlugs SET lastScrapedAt = ? WHERE slug = ? AND atsBoard = ?",
        [datetime.utcnow().isoformat(), slug, ats_board],
    )


async def _seed_candidate_profile() -> None:
    """Insert the singleton candidate profile row if missing."""
    client = get_client()
    candidate_id = _cuid()
    await client.execute(
        """
        INSERT INTO CandidateProfile
          (id, firstName, lastName, email, phone, university, major,
           gpa, graduationYear, graduationMonth, linkedinUrl, githubUrl,
           portfolioUrl, location, workAuthorization,
           requiresSponsorship, updatedAt, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                datetime('now'), datetime('now'))
        """,
        [
            candidate_id,
            _DEFAULT_CANDIDATE_PROFILE["firstName"],
            _DEFAULT_CANDIDATE_PROFILE["lastName"],
            _DEFAULT_CANDIDATE_PROFILE["email"],
            _DEFAULT_CANDIDATE_PROFILE["phone"],
            _DEFAULT_CANDIDATE_PROFILE["university"],
            _DEFAULT_CANDIDATE_PROFILE["major"],
            _DEFAULT_CANDIDATE_PROFILE["gpa"],
            _DEFAULT_CANDIDATE_PROFILE["graduationYear"],
            _DEFAULT_CANDIDATE_PROFILE["graduationMonth"],
            _DEFAULT_CANDIDATE_PROFILE["linkedinUrl"],
            _DEFAULT_CANDIDATE_PROFILE["githubUrl"],
            _DEFAULT_CANDIDATE_PROFILE["portfolioUrl"],
            _DEFAULT_CANDIDATE_PROFILE["location"],
            _DEFAULT_CANDIDATE_PROFILE["workAuthorization"],
            _DEFAULT_CANDIDATE_PROFILE["requiresSponsorship"],
        ],
    )


async def get_candidate_profile() -> dict:
    """Return the singleton candidate profile, seeding it if missing."""
    client = get_client()
    result = await client.execute(
        "SELECT * FROM CandidateProfile LIMIT 1"
    )
    if not result.rows:
        await _seed_candidate_profile()
        result = await client.execute(
            "SELECT * FROM CandidateProfile LIMIT 1"
        )
    columns = [
        c.name if hasattr(c, "name") else str(c)
        for c in result.columns
    ]
    return dict(zip(columns, result.rows[0]))


async def update_candidate_profile(fields: dict) -> dict:
    """Update allowed candidate profile fields and return the new row."""
    profile = await get_candidate_profile()
    valid_updates = {
        key: value
        for key, value in fields.items()
        if key in _CANDIDATE_PROFILE_FIELDS
    }

    assignments = [f"{key} = ?" for key in valid_updates]
    values = [valid_updates[key] for key in valid_updates]
    assignments.append("updatedAt = datetime('now')")

    client = get_client()
    await client.execute(
        f"UPDATE CandidateProfile SET {', '.join(assignments)} WHERE id = ?",
        [*values, profile["id"]],
    )
    return await get_candidate_profile()


def _cuid() -> str:
    """Generate a cuid-compatible unique ID using Python."""
    import time
    import random
    import string
    timestamp = format(int(time.time() * 1000), 'x')
    random_part = ''.join(
        random.choices(string.ascii_lowercase + string.digits, k=16)
    )
    return f"c{timestamp}{random_part}"
