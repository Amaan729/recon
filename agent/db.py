"""
Database client for the Recon Python agent.
Connects to the same Turso (libSQL) database as the Next.js web app.
Used by scrapers, resume engine, and outreach modules to read/write
Job, Application, Recruiter, and RecruiterOutreach records.
"""

import os
import libsql_client
from dotenv import load_dotenv

load_dotenv()

_client: libsql_client.Client | None = None


def get_client() -> libsql_client.Client:
    """Return a singleton libSQL client connected to Turso."""
    global _client
    if _client is None:
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
