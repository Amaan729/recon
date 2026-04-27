"""
Email outreach sender for Recon.
Sends personalized cold emails to recruiters via Gmail API.
Integrates with MailSuite Pro tracking pixel for open/click tracking.
Handles both fresh outreach and follow-up emails.
"""

import asyncio
import base64
import os
import pathlib
import re
import sys
from datetime import datetime, timedelta
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import db

SENDER_EMAIL = "asayed7@asu.edu"
SENDER_NAME = "Amaan Sayed"
DAILY_EMAIL_CAP = 15

# MailSuite Pro tracking pixel — reuses /api/track/{id}/pixel.gif from web/
TRACKING_BASE_URL_ENV = "NEXT_PUBLIC_APP_URL"


# ── Tracking pixel ────────────────────────────────────────────────

def _get_tracking_pixel_html(tracking_id: str) -> str:
    """Generate invisible 1x1 tracking pixel HTML."""
    base_url = os.environ.get(TRACKING_BASE_URL_ENV, "")
    if not base_url:
        return ""
    pixel_url = f"{base_url}/api/track/{tracking_id}/pixel.gif"
    return (
        f'<img src="{pixel_url}" width="1" height="1" '
        f'style="display:none" alt="" />'
    )


# ── Outreach guardrails ───────────────────────────────────────────

async def _count_emails_sent_today() -> int:
    """Return the number of recruiter emails sent in the past 24 hours."""
    client = db.get_client()
    result = await client.execute(
        """
        SELECT COUNT(*)
        FROM RecruiterOutreach
        WHERE channel = 'email'
          AND status = 'sent'
          AND createdAt >= datetime('now', '-1 day')
        """
    )
    return int(result.rows[0][0]) if result.rows else 0


async def _was_contacted_recently(recruiter_id: str) -> bool:
    """Return True when this recruiter had email outreach in the last 30 days."""
    client = db.get_client()
    result = await client.execute(
        """
        SELECT id
        FROM RecruiterOutreach
        WHERE recruiterId = ?
          AND channel = 'email'
          AND createdAt >= datetime('now', '-30 days')
        LIMIT 1
        """,
        [recruiter_id],
    )
    return len(result.rows) > 0


def _infer_company_type(company: str) -> str:
    """Infer a coarse company type for outreach personalization."""
    company_lower = company.lower()

    if any(
        keyword in company_lower
        for keyword in ("bank", "capital", "financial", "payment", "fintech")
    ):
        return "fintech"

    if re.search(
        r"\b(ai|ml|intelligence|deep|neural|openai|anthropic|cohere|mistral|groq)\b",
        company_lower,
    ):
        return "AI/ML"

    if any(
        keyword in company_lower
        for keyword in (
            "cloud",
            "infra",
            "devops",
            "platform",
            "railway",
            "vercel",
            "render",
            "aws",
            "azure",
            "gcp",
        )
    ):
        return "cloud infrastructure"

    if any(
        keyword in company_lower
        for keyword in (
            "enterprise",
            "saas",
            "b2b",
            "salesforce",
            "workday",
            "servicenow",
        )
    ):
        return "enterprise software"

    return "tech"


def _project_for_company_type(company_type: str) -> str:
    """Pick the most relevant experience blurb for the target company type."""
    if company_type == "fintech":
        return "RaftPay, a distributed Go payment system that reached 7663 TPS"
    if company_type == "AI/ML":
        return "ARTEMIS, a RAG pipeline that served 500+ users"
    if company_type == "cloud infrastructure":
        return "RaftPay, where I built distributed systems infrastructure in Go"
    if company_type == "enterprise software":
        return "my SWE internship at Wells Fargo and experience building production-focused systems"
    return "RaftPay and ARTEMIS, where I built distributed and AI-powered systems"


def _fallback_email_body(
    recruiter_name: str,
    company: str,
    role_hint: str,
) -> str:
    """Return a safe plain-text fallback email when AI generation fails."""
    first_name = recruiter_name.split()[0] if recruiter_name else "there"
    company_type = _infer_company_type(company)
    project_blurb = _project_for_company_type(company_type)
    return (
        f"Hi {first_name}, {company}'s work in {company_type} is especially interesting to me, "
        f"so I wanted to reach out about {role_hint} opportunities.\n\n"
        f"I'm a CS + Finance sophomore at ASU with a 4.0 GPA, joining Wells Fargo as a SWE Intern "
        f"this summer, and I've built {project_blurb}.\n\n"
        f"Would you be open to a 15-minute call or pointing me to the hiring manager for this role?\n\n"
        f"Amaan Sayed | asayed7@asu.edu | linkedin.com/in/amaansayed"
    )


def _extract_response_text(response: object) -> str:
    """Coerce a model response into plain string content."""
    content = getattr(response, "content", response)
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
                continue
            if isinstance(item, dict):
                text = item.get("text") or item.get("content")
                if text:
                    parts.append(str(text))
                continue
            text = getattr(item, "text", None) or getattr(item, "content", None)
            if text:
                parts.append(str(text))
        return "\n".join(part.strip() for part in parts if part)
    return str(content)


def _sanitize_generated_email_body(body: str) -> str:
    """Normalize model output to plain text and enforce the required signature."""
    cleaned = body.replace("\r\n", "\n").strip()
    cleaned = re.sub(r"```(?:text)?", "", cleaned, flags=re.IGNORECASE)
    cleaned = cleaned.replace("```", "")
    cleaned = re.sub(r"<[^>]+>", "", cleaned)
    cleaned = re.sub(r"^\s*[-*#]+\s*", "", cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()

    cleaned = re.split(
        r"\n(?:Best|Thanks|Regards|Sincerely|Warmly)[^\n]*\n",
        cleaned,
        maxsplit=1,
        flags=re.IGNORECASE,
    )[0].strip()

    sentence_chunks = re.split(r"(?<=[.!?])\s+", cleaned.replace("\n", " ").strip())
    sentence_chunks = [chunk.strip() for chunk in sentence_chunks if chunk.strip()]
    if len(sentence_chunks) > 5:
        cleaned = " ".join(sentence_chunks[:5]).strip()
    elif sentence_chunks:
        cleaned = " ".join(sentence_chunks).strip()

    cleaned = cleaned.rstrip("| ").strip()
    signature = "Amaan Sayed | asayed7@asu.edu | linkedin.com/in/amaansayed"
    if signature in cleaned:
        cleaned = cleaned.split(signature)[0].strip()

    return f"{cleaned}\n\n{signature}".strip()


# ── Email generation ──────────────────────────────────────────────

async def generate_email_body(
    recruiter_name: str,
    company: str,
    role_hint: str = "software engineering internship",
) -> str:
    """
    Generate a short plain-text recruiter outreach email.
    Falls back to a safe hardcoded email if the model call fails.
    """
    first_name = recruiter_name.split()[0] if recruiter_name else "there"
    company_type = _infer_company_type(company)

    prompt = (
        "Generate a short cold outreach email from Amaan Sayed to a recruiter.\n\n"
        "Candidate: Amaan Sayed, ASU CS + Finance sophomore, GPA 4.0, graduating May 2028\n"
        "Current: SWE Intern @ Wells Fargo (this summer)\n"
        "Key projects: RaftPay (distributed Go system, 7663 TPS), ARTEMIS (RAG pipeline, 500+ users)\n"
        "Email: asayed7@asu.edu\n"
        "LinkedIn: https://www.linkedin.com/in/amaansayed\n"
        "GitHub: https://github.com/Amaan729\n\n"
        "Rules:\n"
        "- Maximum 5 sentences total\n"
        f"- Opening must reference the company specifically (use {company})\n"
        f"- Mention one relevant project or experience that maps to {company_type}\n"
        "- Close with a specific ask: 15-minute call or referral to hiring manager\n"
        "- Plain text only — no HTML, no markdown, no bullet points\n"
        '- No "I hope this email finds you well" or similar filler\n'
        "- Sign off as: Amaan Sayed | asayed7@asu.edu | linkedin.com/in/amaansayed\n\n"
        "Personalization tokens available:\n"
        f"- recruiter_name: {first_name}\n"
        f"- company: {company}\n"
        f"- role_hint: {role_hint}\n"
        f"- company_type: {company_type}\n\n"
        "Return only the finished email body."
    )

    try:
        from llm_router import get_email_llm

        llm = get_email_llm()
        response = await llm.ainvoke(prompt)
        body = _extract_response_text(response).strip()
        if not body:
            raise ValueError("empty email body from LLM")
        return _sanitize_generated_email_body(body)
    except Exception as e:
        print(f"AI email generation failed for {company}: {e}")
        return _fallback_email_body(recruiter_name, company, role_hint)


async def generate_outreach_email(
    recruiter_name: str,
    company: str,
    role: str,
    is_followup: bool = False,
    previous_email_date: str = "",
) -> tuple[str, str]:
    """
    Generate personalized email subject and plain-text body.
    Uses Cerebras → Gemini fallback chain.
    Returns (subject, body) tuple.
    """
    first_name = recruiter_name.split()[0] if recruiter_name else "there"

    if is_followup:
        subject = f"Following Up — {role} at {company} | Amaan Sayed"
        prompt = (
            f"Write a short follow-up cold email (3 short paragraphs).\n\n"
            f"Context: Amaan sent an initial email on {previous_email_date} "
            f"about applying to {role} at {company}. This is a polite follow-up.\n\n"
            f"Rules:\n"
            f"- Address {first_name} by name\n"
            f"- Reference the previous email briefly\n"
            f"- Add one new data point (mention RaftPay: 7663 TPS in Go, or "
            f"ARTEMIS RAG pipeline: 500+ users)\n"
            f"- Confident but not pushy\n"
            f"- End with a simple ask\n"
            f"- Plain professional tone\n"
            f"- Return ONLY the email body text (no subject, no signature block)"
        )
    else:
        subject = (
            f"{role} Application — Amaan Sayed "
            f"(ASU Barrett Honors, 4.0 GPA)"
        )
        prompt = (
            f"Write a personalized cold outreach email (3 paragraphs).\n\n"
            f"Sender: Amaan Sayed, CS + Finance sophomore at ASU Barrett Honors "
            f"(4.0 GPA, Dean's List), SWE Intern at Wells Fargo this summer\n"
            f"Recipient: {first_name}, recruiter at {company}\n"
            f"Applied for: {role} at {company}\n\n"
            f"Key achievements to pick 1-2 from:\n"
            f"- RaftPay: distributed payment ledger in Go, Raft consensus from "
            f"scratch, 7663 TPS, 4.68ms p99 latency\n"
            f"- ARTEMIS: RAG pipeline with Claude API, 500+ users in Philippines\n"
            f"- Wells Fargo SWE internship (current)\n"
            f"- ASU Barrett Honors, 4.0 GPA\n\n"
            f"Rules:\n"
            f"- Paragraph 1: hook specific to {company}'s work/mission\n"
            f"- Paragraph 2: 1-2 concrete achievements most relevant to {company}\n"
            f"- Paragraph 3: clear ask — review application, short call\n"
            f"- Professional but direct, no filler phrases\n"
            f"- Do NOT start with \"I am writing to apply\"\n"
            f"- Do NOT include date, address, or signature block\n"
            f"- Return ONLY the email body text"
        )

    body = await _call_cerebras_email(prompt)
    if not body:
        body = await _call_gemini_email(prompt)
    if not body:
        body = (
            f"Hi {first_name},\n\n"
            f"I recently applied to the {role} role at {company} and wanted "
            f"to reach out directly. I'm a CS + Finance sophomore at ASU "
            f"Barrett Honors (4.0 GPA) interning at Wells Fargo this summer.\n\n"
            f"I'd love for you to have a look at my application. "
            f"Happy to connect if you have any questions!\n\n"
            f"Best,\nAmaan Sayed"
        )

    return subject, body.strip()


# ── Send pipeline ─────────────────────────────────────────────────

async def send_recruiter_email(
    recruiter_id: str,
    recruiter_name: str,
    recruiter_email: str,
    company: str,
    role: str,
    resume_pdf_path: str,
    application_id: str | None = None,
    is_followup: bool = False,
    previous_email_date: str = "",
    hunter_confidence: int = 100,
) -> bool:
    """
    Send a personalized email to a recruiter via Gmail API.
    Attaches resume PDF and injects MailSuite Pro tracking pixel.
    Records outreach in RecruiterOutreach as 'sent' on success.
    Returns True on success, False on failure.
    """
    try:
        if hunter_confidence < 70:
            print(
                f"  Skipping email for {recruiter_name} — Hunter confidence "
                f"{hunter_confidence} < 70"
            )
            return False

        sent_today = await _count_emails_sent_today()
        if sent_today >= DAILY_EMAIL_CAP:
            print(
                f"  Skipping email for {recruiter_name} — daily email cap "
                f"reached ({sent_today}/{DAILY_EMAIL_CAP})"
            )
            return False

        if not is_followup and await _was_contacted_recently(recruiter_id):
            recent_cutoff = (datetime.utcnow() - timedelta(days=30)).date().isoformat()
            print(
                f"  Skipping email for {recruiter_name} — emailed within the "
                f"last 30 days (since {recent_cutoff})"
            )
            return False

        if is_followup:
            subject, body_text = await generate_outreach_email(
                recruiter_name=recruiter_name,
                company=company,
                role=role,
                is_followup=is_followup,
                previous_email_date=previous_email_date,
            )
        else:
            subject = (
                f"{role} Application — Amaan Sayed "
                f"(ASU Barrett Honors, 4.0 GPA)"
            )
            body_text = await generate_email_body(
                recruiter_name=recruiter_name,
                company=company,
                role_hint=role,
            )

        tracking_id = db._cuid()
        pixel_html = _get_tracking_pixel_html(tracking_id)

        html_body = _build_html_email(
            body_text=body_text,
            sender_name=SENDER_NAME,
            pixel_html=pixel_html,
        )

        success = await _send_via_gmail(
            to_email=recruiter_email,
            subject=subject,
            html_body=html_body,
            resume_pdf_path=resume_pdf_path,
        )

        if success:
            out_id = await db.queue_outreach(
                recruiter_id=recruiter_id,
                channel="email",
                application_id=application_id,
                message_text=f"Subject: {subject}\n\n{body_text}",
            )
            # Email is sent immediately — mark it now rather than awaiting approval
            client = db.get_client()
            await client.execute(
                """
                UPDATE RecruiterOutreach
                SET status = 'sent', sentAt = datetime('now')
                WHERE id = ?
                """,
                [out_id],
            )
            print(f"  Email sent to {recruiter_name} at {company}")

        return success

    except Exception as e:
        print(f"  Email send failed for {recruiter_name}: {e}")
        return False


def _build_html_email(
    body_text: str,
    sender_name: str,
    pixel_html: str = "",
) -> str:
    """Convert plain text email body to simple HTML with signature and tracking pixel."""
    paragraphs = body_text.strip().split("\n\n")
    html_paragraphs = "".join(
        f"<p style='margin:0 0 16px 0;line-height:1.6'>{p.strip()}</p>"
        for p in paragraphs
        if p.strip()
    )
    signature = (
        f"<p style='margin:16px 0 0 0;color:#666;font-size:13px'>"
        f"{sender_name}<br>"
        f"Computer Science + Finance | ASU Barrett Honors<br>"
        f"<a href='https://www.linkedin.com/in/amaansayed'>LinkedIn</a> · "
        f"<a href='https://github.com/Amaan729'>GitHub</a>"
        f"</p>"
    )
    return (
        f"<html><body style='font-family:Arial,sans-serif;font-size:15px;"
        f"color:#222;max-width:600px'>"
        f"{html_paragraphs}{signature}{pixel_html}"
        f"</body></html>"
    )


async def _send_via_gmail(
    to_email: str,
    subject: str,
    html_body: str,
    resume_pdf_path: str,
) -> bool:
    """
    Send email via Gmail API with resume PDF attached.
    Requires env vars: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET,
                       GMAIL_REFRESH_TOKEN
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
            scopes=["https://www.googleapis.com/auth/gmail.send"],
        )

        msg = MIMEMultipart("mixed")
        msg["To"] = to_email
        msg["From"] = f"{SENDER_NAME} <{SENDER_EMAIL}>"
        msg["Subject"] = subject
        msg.attach(MIMEText(html_body, "html"))

        pdf_path = pathlib.Path(resume_pdf_path)
        if pdf_path.exists():
            with open(pdf_path, "rb") as f:
                pdf_data = f.read()
            attachment = MIMEApplication(pdf_data, _subtype="pdf")
            attachment.add_header(
                "Content-Disposition",
                "attachment",
                filename="Amaan_Sayed_Resume.pdf",
            )
            msg.attach(attachment)

        raw = base64.urlsafe_b64encode(msg.as_bytes()).decode("utf-8")

        service = await asyncio.to_thread(
            lambda: build("gmail", "v1", credentials=creds)
        )
        await asyncio.to_thread(
            lambda: service.users().messages().send(
                userId="me", body={"raw": raw}
            ).execute()
        )
        return True

    except Exception as e:
        print(f"Gmail send failed: {e}")
        return False


# ── AI helpers ────────────────────────────────────────────────────

async def _call_cerebras_email(prompt: str) -> str | None:
    try:
        from llm_router import get_email_llm

        llm = get_email_llm()
        response = await llm.ainvoke(prompt)
        return getattr(response, "content", str(response)).strip()
    except Exception as e:
        print(f"Cerebras email call failed: {e}")
        return None


async def _call_gemini_email(prompt: str) -> str | None:
    try:
        from llm_router import get_email_llm

        llm = get_email_llm()
        response = await llm.ainvoke(prompt)
        return getattr(response, "content", str(response)).strip()
    except Exception as e:
        print(f"Gemini email call failed: {e}")
        return None


if __name__ == "__main__":
    print("email_sender module loaded successfully")
