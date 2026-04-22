"""
Browser-use application engine for the Recon job hunting agent.
Navigates job application portals autonomously using an LLM-driven
Playwright agent. Handles account creation, form filling, resume
upload, and email verification.
"""

import asyncio
import base64
import os
import re
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

CANDIDATE = {
    "first_name": "Amaan",
    "last_name": "Sayed",
    "email": "asayed7@asu.edu",
    "phone": "",
    "university": "Arizona State University",
    "major": "Computer Science and Finance",
    "gpa": "4.0",
    "graduation_year": "2028",
    "graduation_month": "May",
    "linkedin_url": "https://www.linkedin.com/in/amaansayed",
    "github_url": "https://github.com/Amaan729",
    "portfolio_url": "",
    "location": "Tempe, Arizona",
    "work_authorization": "Yes",
    "requires_sponsorship": "No",
}

PORTAL_PASSWORD_ENV = "PORTAL_PASSWORD"

UNKNOWN_FIELD_TRIGGERS = [
    "sat score", "act score", "gre score",
    "ssn", "social security",
    "emergency contact",
    "salary expectation",
    "cover letter",
    "diversity",
]

SKIP_IF_OPTIONAL = [
    "portfolio", "website", "personal website",
    "twitter", "gender", "ethnicity", "race",
    "veteran status", "disability",
]


@dataclass
class ApplicationResult:
    """Result of an application attempt."""
    job_id: str
    success: bool
    status: str     # applied | failed | needs_review | unknown_field
    error: str = ""
    unknown_fields: list[str] = field(default_factory=list)
    application_url: str = ""


# ── Gmail verification helper ─────────────────────────────────────

async def fetch_verification_email(
    sender_domain: str,
    timeout_seconds: int = 60,
) -> str | None:
    """
    Poll Gmail API for a verification email from sender_domain.
    Returns the verification URL found in the email body.
    Returns None if not found within timeout.

    Requires env vars:
      GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN
    """
    try:
        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build

        creds = Credentials(
            token=None,
            refresh_token=os.environ["GMAIL_REFRESH_TOKEN"],
            client_id=os.environ["GMAIL_CLIENT_ID"],
            client_secret=os.environ["GMAIL_CLIENT_SECRET"],
            token_uri="https://oauth2.googleapis.com/token",
            scopes=["https://www.googleapis.com/auth/gmail.readonly"],
        )

        service = await asyncio.to_thread(
            lambda: build("gmail", "v1", credentials=creds)
        )

        deadline = time.time() + timeout_seconds
        while time.time() < deadline:
            query = f"from:{sender_domain} newer_than:2m"
            results = await asyncio.to_thread(
                lambda: service.users().messages().list(
                    userId="me", q=query, maxResults=5
                ).execute()
            )

            for msg in results.get("messages", []):
                msg_id = msg["id"]
                msg_data = await asyncio.to_thread(
                    lambda: service.users().messages().get(
                        userId="me", id=msg_id, format="full"
                    ).execute()
                )
                body = _extract_gmail_body(msg_data)
                if body:
                    url = _extract_verification_url(body)
                    if url:
                        return url

            await asyncio.sleep(5)

        return None

    except Exception as e:
        print(f"Gmail verification fetch failed: {e}")
        return None


def _extract_gmail_body(msg_data: dict) -> str:
    """Extract plain text or HTML body from Gmail API message."""
    try:
        payload = msg_data.get("payload", {})
        parts = payload.get("parts", [])

        if not parts:
            data = payload.get("body", {}).get("data", "")
            if data:
                return base64.urlsafe_b64decode(data).decode("utf-8")
            return ""

        for part in parts:
            if part.get("mimeType", "") in ("text/plain", "text/html"):
                data = part.get("body", {}).get("data", "")
                if data:
                    return base64.urlsafe_b64decode(data).decode("utf-8")

        return ""
    except Exception:
        return ""


def _extract_verification_url(body: str) -> str | None:
    """
    Extract verification/confirmation URL from email body.
    Returns first matching URL or None.
    """
    patterns = [
        r'https?://[^\s"\'<>]+(?:verify|confirm|activate|'
        r'validation|email-confirm)[^\s"\'<>]*',
        r'href=["\']?(https?://[^\s"\'<>]+)["\']?',
    ]
    for pattern in patterns:
        matches = re.findall(pattern, body, re.IGNORECASE)
        if matches:
            return matches[0]
    return None


# ── LLM provider for browser-use ─────────────────────────────────

def _get_llm():
    """
    Return the LLM instance for browser-use.
    Uses Gemini 2.5 Flash via langchain-google-genai.
    """
    try:
        from langchain_google_genai import ChatGoogleGenerativeAI
        return ChatGoogleGenerativeAI(
            model="gemini-2.5-flash",
            google_api_key=os.environ["GOOGLE_AI_API_KEY"],
            temperature=0.1,
        )
    except Exception as e:
        raise RuntimeError(
            f"Could not initialize LLM for browser-use: {e}. "
            "Ensure GOOGLE_AI_API_KEY is set and "
            "langchain-google-genai is installed."
        )


# ── Screenshot streaming ──────────────────────────────────────────

class ScreenshotStreamer:
    """
    Captures Playwright page screenshots and streams them via callback.
    Used to push live view to the WebSocket endpoint in main.py.
    """

    def __init__(self, callback: Callable[[bytes], None] | None = None):
        self.callback = callback
        self._running = False

    async def start(self, page) -> None:
        """Start streaming screenshots from a Playwright page at ~2fps."""
        self._running = True
        while self._running:
            try:
                screenshot = await page.screenshot(type="jpeg", quality=60)
                if self.callback:
                    self.callback(screenshot)
            except Exception:
                pass
            await asyncio.sleep(0.5)

    def stop(self) -> None:
        self._running = False


# ── Main application agent ────────────────────────────────────────

async def apply_to_job(
    job_id: str,
    job_url: str,
    company: str,
    job_title: str,
    resume_pdf_path: str,
    cover_letter: str = "",
    screenshot_callback: Callable[[bytes], None] | None = None,
    ask_user_callback: Callable[[str], str] | None = None,
) -> ApplicationResult:
    """
    Navigate to job_url and complete the application autonomously.

    Args:
        job_id: Turso Job record ID
        job_url: URL of the job posting / application page
        company: Company name (for logging and email search)
        job_title: Role title
        resume_pdf_path: Path to compiled resume PDF
        cover_letter: Generated cover letter text
        screenshot_callback: Called with JPEG bytes every 500ms
        ask_user_callback: Called when unknown field encountered

    Returns ApplicationResult with success/failure details.
    """
    try:
        from browser_use import Agent
        from browser_use.browser.browser import Browser, BrowserConfig

        llm = _get_llm()
        password = os.environ.get(PORTAL_PASSWORD_ENV, "")

        task = _build_task_prompt(
            job_url=job_url,
            company=company,
            job_title=job_title,
            resume_pdf_path=resume_pdf_path,
            cover_letter=cover_letter,
            password=password,
        )

        browser = Browser(
            config=BrowserConfig(
                headless=True,
                disable_security=False,
            )
        )

        agent = Agent(
            task=task,
            llm=llm,
            browser=browser,
            max_actions_per_step=10,
        )

        print(f"  Applying to {company} - {job_title}")
        print(f"  URL: {job_url}")

        result = await agent.run(max_steps=50)

        final_result = result.final_result() if result else None
        success = (
            final_result is not None
            and "success" in str(final_result).lower()
        )

        if success:
            import db
            await db.update_job_status(job_id, "applied")
            app_id = await _create_application_record(
                job_id=job_id,
                resume_pdf_path=resume_pdf_path,
                cover_letter=cover_letter,
            )
            print(f"  Applied successfully — app_id: {app_id}")
            return ApplicationResult(
                job_id=job_id,
                success=True,
                status="applied",
                application_url=job_url,
            )
        else:
            import db
            await db.update_job_status(job_id, "failed")
            return ApplicationResult(
                job_id=job_id,
                success=False,
                status="failed",
                error=str(final_result) if final_result else "Agent did not confirm success",
            )

    except Exception as e:
        print(f"  Application failed: {e}")
        import db
        await db.update_job_status(job_id, "failed")
        return ApplicationResult(
            job_id=job_id,
            success=False,
            status="failed",
            error=str(e),
        )


def _build_task_prompt(
    job_url: str,
    company: str,
    job_title: str,
    resume_pdf_path: str,
    cover_letter: str,
    password: str,
) -> str:
    """Build the natural language task prompt for browser-use."""
    candidate_info = "\n".join(
        f"- {k}: {v}" for k, v in CANDIDATE.items() if v
    )

    return f"""
You are applying for a job on behalf of a candidate. Complete
the entire application at this URL: {job_url}

CANDIDATE INFORMATION (use exactly as provided):
{candidate_info}
- Password for new accounts: {password}

RESUME: Upload the PDF file at this path: {resume_pdf_path}

COVER LETTER (paste if field exists, skip if not required):
{cover_letter[:500] if cover_letter else 'No cover letter provided'}

INSTRUCTIONS:
1. Navigate to {job_url}
2. If a "Sign in with Google" or "Continue with Google" button
   exists, click it and sign in with asayed7@asu.edu
3. If no Google sign-in, create a new account with:
   email: asayed7@asu.edu, password: {password}
4. Fill all required fields using the candidate information above
5. For the resume field, upload the file at: {resume_pdf_path}
6. For work authorization questions, answer "Yes"
7. For sponsorship questions, answer "No"
8. For GPA fields, enter: 4.0
9. For graduation date, enter: May 2028
10. Skip optional diversity, gender, ethnicity fields
11. If asked for SAT/ACT scores or SSN, stop and report:
    "UNKNOWN_FIELD: <field name>"
12. Review the application before submitting
13. Submit the application
14. After submission, report "SUCCESS: application submitted"
    or "FAILED: <reason>"

IMPORTANT:
- Never skip required fields
- If a required field is unclear, make your best judgment
- If the application is already submitted for this job, report
  "SUCCESS: already applied"
- Do not close the browser until you have confirmed submission
"""


async def _create_application_record(
    job_id: str,
    resume_pdf_path: str,
    cover_letter: str,
) -> str:
    """Create an Application record in Turso after successful apply."""
    import db
    client = db.get_client()
    app_id = db._cuid()
    await client.execute(
        """
        INSERT INTO Application
          (id, jobId, status, portalEmail, resumeVersion,
           coverLetter, submittedAt, createdAt)
        VALUES (?, ?, 'submitted', ?, ?, ?,
                datetime('now'), datetime('now'))
        """,
        [
            app_id,
            job_id,
            CANDIDATE["email"],
            resume_pdf_path,
            cover_letter[:2000] if cover_letter else None,
        ],
    )
    return app_id


# ── Batch runner ──────────────────────────────────────────────────

async def run_application_batch(
    jobs: list[dict],
    screenshot_callback: Callable[[bytes], None] | None = None,
) -> list[ApplicationResult]:
    """
    Process a list of approved jobs sequentially.
    Each job dict must have: id, jobBoardUrl, company, title,
    resumePdfPath, coverLetter fields.
    Runs jobs one at a time to avoid detection.
    """
    results = []
    for job in jobs:
        print(f"\nProcessing: {job.get('company')} - {job.get('title')}")
        result = await apply_to_job(
            job_id=job["id"],
            job_url=job["jobBoardUrl"],
            company=job.get("company", "Unknown"),
            job_title=job.get("title", "Unknown"),
            resume_pdf_path=job.get("resumePdfPath", ""),
            cover_letter=job.get("coverLetter", ""),
            screenshot_callback=screenshot_callback,
        )
        results.append(result)
        await asyncio.sleep(5)

    return results
