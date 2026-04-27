"""
LinkedIn outreach queue manager for Recon.
Generates personalized connection requests and InMails,
stores them in RecruiterOutreach table with status='queued'.
NEVER sends automatically — user approves from dashboard.
"""

import asyncio
import os
import sys
from dataclasses import dataclass, field

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import db

MAX_CONNECTION_NOTE_CHARS = 300


@dataclass
class LinkedInOutreach:
    """Queued LinkedIn outreach item."""
    recruiter_id: str
    recruiter_name: str
    company: str
    channel: str    # linkedin_connection | linkedin_inmail | linkedin_dm
    message: str
    outreach_id: str = ""


# ── Message generation ────────────────────────────────────────────

async def generate_connection_note(
    recruiter_name: str,
    company: str,
    role: str,
    relevant_stack: str = "Python, Go, distributed systems",
) -> str:
    """
    Generate a personalized 300-char connection request note.
    Uses Cerebras (fastest) → Gemini → Mistral fallback chain.
    Falls back to template if all AI calls fail.
    """
    first_name = recruiter_name.split()[0] if recruiter_name else "there"

    prompt = (
        f"Write a LinkedIn connection request note "
        f"(STRICT max {MAX_CONNECTION_NOTE_CHARS} characters including spaces).\n\n"
        f"Recipient: {first_name}, recruiter at {company}\n"
        f"Sender: Amaan Sayed, CS + Finance sophomore at ASU Barrett Honors, "
        f"4.0 GPA, SWE Intern at Wells Fargo\n"
        f"Applied for: {role} at {company}\n"
        f"Relevant tech: {relevant_stack}\n\n"
        f"Rules:\n"
        f"- Start with \"Hi {first_name},\"\n"
        f"- Mention the specific role they recruit for\n"
        f"- Mention ASU and one concrete achievement\n"
        f"- Sound human, not like a template\n"
        f"- MUST be under {MAX_CONNECTION_NOTE_CHARS} characters total\n"
        f"- Return ONLY the message text, nothing else"
    )

    message = await _call_cerebras(prompt, max_tokens=100)
    if not message or len(message) > MAX_CONNECTION_NOTE_CHARS:
        message = await _call_gemini(prompt, max_tokens=100)
    if not message or len(message) > MAX_CONNECTION_NOTE_CHARS:
        message = await _call_mistral(prompt, max_tokens=100)
    if not message or len(message) > MAX_CONNECTION_NOTE_CHARS:
        template = (
            f"Hi {first_name}, I applied to the {role} role at "
            f"{company} and wanted to connect — CS + Finance sophomore "
            f"at ASU (4.0 GPA), SWE intern at Wells Fargo. "
            f"Would love to be on your radar!"
        )
        message = template

    return message.strip()[:MAX_CONNECTION_NOTE_CHARS]


async def generate_inmail(
    recruiter_name: str,
    company: str,
    role: str,
    email_sent_date: str = "recently",
) -> tuple[str, str]:
    """
    Generate InMail subject and body (Day 2 follow-up).
    References the Day 0 email. Short — under 150 words.
    Returns (subject, body) tuple.
    """
    first_name = recruiter_name.split()[0] if recruiter_name else "there"
    subject = f"Re: {role} Application at {company}"

    prompt = (
        f"Write a LinkedIn InMail follow-up message (under 150 words).\n\n"
        f"Context: Amaan Sayed sent an email {email_sent_date} about "
        f"applying to {role} at {company}. This InMail follows up.\n\n"
        f"Recipient: {first_name}, recruiter at {company}\n"
        f"Sender profile: CS + Finance sophomore, ASU Barrett Honors, "
        f"4.0 GPA, SWE Intern @ Wells Fargo this summer, "
        f"built distributed payment system (Go, 7663 TPS) "
        f"and RAG pipeline serving 500+ users\n\n"
        f"Rules:\n"
        f"- Reference the email sent {email_sent_date}\n"
        f"- Mention one specific achievement relevant to {company}\n"
        f"- Short, direct, confident tone\n"
        f"- Under 150 words\n"
        f"- Return ONLY the message body, no subject line"
    )

    body = await _call_cerebras(prompt, max_tokens=200)
    if not body:
        body = await _call_gemini(prompt, max_tokens=200)
    if not body:
        body = (
            f"Hi {first_name}, I sent an email {email_sent_date} "
            f"regarding my application for the {role} role at {company}. "
            f"I'm a CS + Finance sophomore at ASU (4.0 GPA) interning at "
            f"Wells Fargo this summer — I'd love to be considered. "
            f"Happy to share more if helpful!"
        )

    return subject, body.strip()


# ── Queue operations ──────────────────────────────────────────────

async def queue_connection_request(
    recruiter_id: str,
    recruiter_name: str,
    company: str,
    role: str,
    relevant_stack: str = "Python, Go, distributed systems",
    application_id: str | None = None,
) -> str:
    """
    Generate and queue a LinkedIn connection request.
    Skips if LinkedIn outreach was already sent to this recruiter.
    Returns the RecruiterOutreach ID, or "" if skipped.
    """
    already_sent = await _check_linkedin_already_sent(recruiter_id)
    if already_sent:
        print(f"  Skipping LinkedIn for {recruiter_name} — already contacted")
        return ""

    message = await generate_connection_note(
        recruiter_name=recruiter_name,
        company=company,
        role=role,
        relevant_stack=relevant_stack,
    )

    outreach_id = await db.queue_outreach(
        recruiter_id=recruiter_id,
        channel="linkedin_connection",
        application_id=application_id,
        message_text=message,
    )
    print(f"  Queued connection request for {recruiter_name} at {company}")
    return outreach_id


async def queue_inmail(
    recruiter_id: str,
    recruiter_name: str,
    company: str,
    role: str,
    application_id: str | None = None,
) -> str:
    """
    Generate and queue a LinkedIn InMail (Day 2 follow-up).
    Routes to DM instead if connection was already accepted.
    Returns the RecruiterOutreach ID or "" if skipped.
    """
    connection_pending = await _check_connection_pending(recruiter_id)
    if not connection_pending:
        print(
            f"  Skipping InMail for {recruiter_name} — connection accepted, "
            f"will send DM instead"
        )
        return await queue_linkedin_dm(
            recruiter_id=recruiter_id,
            recruiter_name=recruiter_name,
            company=company,
            role=role,
            application_id=application_id,
        )

    subject, body = await generate_inmail(
        recruiter_name=recruiter_name,
        company=company,
        role=role,
    )
    outreach_id = await db.queue_outreach(
        recruiter_id=recruiter_id,
        channel="linkedin_inmail",
        application_id=application_id,
        message_text=f"Subject: {subject}\n\n{body}",
    )
    print(f"  Queued InMail for {recruiter_name} at {company}")
    return outreach_id


async def queue_linkedin_dm(
    recruiter_id: str,
    recruiter_name: str,
    company: str,
    role: str,
    application_id: str | None = None,
) -> str:
    """Queue a LinkedIn DM for when connection was accepted."""
    _, body = await generate_inmail(
        recruiter_name=recruiter_name,
        company=company,
        role=role,
        email_sent_date="a couple days ago",
    )
    outreach_id = await db.queue_outreach(
        recruiter_id=recruiter_id,
        channel="linkedin_dm",
        application_id=application_id,
        message_text=body,
    )
    print(f"  Queued LinkedIn DM for {recruiter_name} at {company}")
    return outreach_id


# ── DB helpers ────────────────────────────────────────────────────

async def _check_linkedin_already_sent(recruiter_id: str) -> bool:
    """Return True if any LinkedIn outreach was already sent to this recruiter."""
    client = db.get_client()
    result = await client.execute(
        """
        SELECT id FROM RecruiterOutreach
        WHERE recruiterId = ?
          AND channel IN ('linkedin_connection','linkedin_inmail',
                          'linkedin_dm')
          AND status = 'sent'
        LIMIT 1
        """,
        [recruiter_id],
    )
    return len(result.rows) > 0


async def _check_connection_pending(recruiter_id: str) -> bool:
    """
    Return True if connection request was sent but not yet accepted.
    Defaults to True (assume pending) if no connection was sent yet.
    """
    client = db.get_client()
    conn_result = await client.execute(
        """
        SELECT id FROM RecruiterOutreach
        WHERE recruiterId = ?
          AND channel = 'linkedin_connection'
          AND status = 'sent'
        LIMIT 1
        """,
        [recruiter_id],
    )
    if not conn_result.rows:
        return True  # No connection sent yet — treat as pending

    dm_result = await client.execute(
        """
        SELECT id FROM RecruiterOutreach
        WHERE recruiterId = ?
          AND channel = 'linkedin_dm'
          AND status = 'sent'
        LIMIT 1
        """,
        [recruiter_id],
    )
    return len(dm_result.rows) == 0  # Pending if no DM sent yet


# ── AI helpers ────────────────────────────────────────────────────

async def _call_cerebras(prompt: str, max_tokens: int = 200) -> str | None:
    try:
        from cerebras.cloud.sdk import Cerebras
        client = Cerebras(api_key=os.environ["CEREBRAS_API_KEY"])
        response = await asyncio.to_thread(
            client.chat.completions.create,
            model="llama3.3-70b",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=max_tokens,
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        print(f"Cerebras call failed: {e}")
        return None


async def _call_gemini(prompt: str, max_tokens: int = 200) -> str | None:
    try:
        from langchain_google_genai import ChatGoogleGenerativeAI

        llm = ChatGoogleGenerativeAI(
            model="gemini-2.5-flash",
            google_api_key=os.environ["GOOGLE_AI_API_KEY"],
            temperature=0.2,
        )
        response = await llm.ainvoke(prompt)
        content = getattr(response, "content", str(response))
        if isinstance(content, list):
            content = "".join(
                part.get("text", "") if isinstance(part, dict) else str(part)
                for part in content
            )
        return str(content).strip()
    except Exception as e:
        print(f"Gemini call failed: {e}")
        return None


async def _call_mistral(prompt: str, max_tokens: int = 200) -> str | None:
    try:
        from mistralai import Mistral
        client = Mistral(api_key=os.environ["MISTRAL_API_KEY"])
        response = await asyncio.to_thread(
            client.chat.complete,
            model="mistral-small-latest",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=max_tokens,
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        print(f"Mistral call failed: {e}")
        return None


if __name__ == "__main__":
    print("linkedin_queue module loaded successfully")
