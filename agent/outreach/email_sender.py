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
import sys
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import db

SENDER_EMAIL = "asayed7@asu.edu"
SENDER_NAME = "Amaan Sayed"

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


# ── Email generation ──────────────────────────────────────────────

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
) -> bool:
    """
    Send a personalized email to a recruiter via Gmail API.
    Attaches resume PDF and injects MailSuite Pro tracking pixel.
    Records outreach in RecruiterOutreach as 'sent' on success.
    Returns True on success, False on failure.
    """
    try:
        subject, body_text = await generate_outreach_email(
            recruiter_name=recruiter_name,
            company=company,
            role=role,
            is_followup=is_followup,
            previous_email_date=previous_email_date,
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
        from cerebras.cloud.sdk import Cerebras
        client = Cerebras(api_key=os.environ["CEREBRAS_API_KEY"])
        response = await asyncio.to_thread(
            client.chat.completions.create,
            model="llama3.3-70b",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=400,
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        print(f"Cerebras email call failed: {e}")
        return None


async def _call_gemini_email(prompt: str) -> str | None:
    try:
        import google.generativeai as genai
        genai.configure(api_key=os.environ["GOOGLE_AI_API_KEY"])
        model = genai.GenerativeModel("gemini-2.5-flash")
        response = await asyncio.to_thread(model.generate_content, prompt)
        return response.text.strip()
    except Exception as e:
        print(f"Gemini email call failed: {e}")
        return None


if __name__ == "__main__":
    print("email_sender module loaded successfully")
