"""
Resume tailoring engine for the Recon job hunting agent.
Takes a job description and base .tex resume, returns a tailored
.tex string and cover letter. Uses Gemini 2.5 Flash for deep
JD analysis and rewriting, Cerebras for cover letter speed,
Mistral as fallback for both.
"""

import asyncio
import json
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

BASE_RESUME_PATH = Path(__file__).parent / "base" / "resume.tex"

CANDIDATE_PROFILE = """
Name: Amaan Sayed
School: Arizona State University, Barrett Honors College
Degree: BS Computer Science + Finance, Sophomore
GPA: 4.0, Dean's List
Graduation: May 2028
Current: SWE Intern @ Wells Fargo (this summer)

Technical Stack:
- Languages: Python, Java, C++, Go, JavaScript/TypeScript, Swift, SQL
- Frameworks: React, Flask, Spring Boot, Next.js, Node.js
- Cloud/ML: Azure, AWS, TensorFlow, spaCy, PyTorch, Docker,
  PostgreSQL, MongoDB

Key Projects (whitelisted for resume):
- RaftPay: Distributed payment ledger in Go, Raft consensus from
  scratch, 7663 TPS, 4.68ms p99 latency
- EventSniffer: macOS tool, SwiftUI + spaCy NER + Flask, extracts
  calendar events from Slack/email
- Cloud Loan Risk Pipeline: TensorFlow on 400K LendingClub records,
  Flask REST API on Azure VM, React dashboard
- Enterprise Banking Portal: Spring Boot + React + PostgreSQL +
  Docker + Azure, RBAC and CI/CD
- ARTEMIS (Research): RAG pipeline with Claude API over 50+ policy
  documents, React Native + Node.js/PostgreSQL, 500+ users in
  Philippines education system

Experience priority (cut last to first):
1. Keep ARTEMIS research — cut last
2. Keep Wells Fargo internship — cut second to last
3. Student Research Lab — replaceable with ASU club if gap exists
4. ASU clubs — fabricate if real skill gap vs JD

Target roles: SWE Intern, SWE Co-op, ML/AI Intern, Backend Intern
Target industries: FinTech, AI/ML, cloud, enterprise software
"""

RESUME_RULES = """
1. Never change Education section or GPA
2. Mirror JD language exactly — use their terminology
3. XYZ format for bullets: accomplished X as measured by Y by doing Z
4. Skills section must cover ATS keywords from JD
5. If 1-2 keywords missing: add to Skills section only
6. If real skill gap: rewrite Student Research Lab as ASU club
   with fabricated but plausible bullet points
7. If severe gap: fabricate a new project with relevant bullets
8. ARTEMIS is protected — never cut or significantly downgrade it
9. Reorder projects by relevance to this specific JD
10. One page maximum — compile.py enforces this separately
11. Do not change contact info, education, or formatting macros
"""


@dataclass
class TailoringResult:
    """Result of a resume tailoring operation."""
    tailored_tex: str
    cover_letter: str
    match_score: int
    keywords_added: list[str] = field(default_factory=list)
    fabricated: bool = False
    fabrication_notes: str = ""
    jd_summary: str = ""


# ── Prompts ───────────────────────────────────────────────────────

JD_ANALYSIS_PROMPT = """
You are a senior technical recruiter analyzing a job description
for a CS student applying to internships.

Analyze this job description and return a JSON object with
these exact keys:
{{
  "match_score": <integer 0-100>,
  "core_themes": [<3-5 strings: main priorities of the JD>],
  "required_keywords": [<ATS keywords that must appear on resume>],
  "preferred_keywords": [<nice-to-have keywords>],
  "jd_language": {{<key JD terms to mirror, e.g. "LLM orchestration">}},
  "skill_gaps": [<skills JD wants that candidate may lack>],
  "recommendation": <"full_tailor"|"selective_tailor"|"skip">
}}

Candidate profile:
{candidate_profile}

Job description:
{jd_text}

Return ONLY valid JSON, no markdown, no explanation.
"""

TAILORING_PROMPT = """
You are an expert resume writer tailoring a LaTeX resume for a
specific job application. Follow these rules strictly:
{rules}

JD Analysis:
- Core themes: {core_themes}
- Required keywords: {required_keywords}
- JD language to mirror: {jd_language}
- Skill gaps identified: {skill_gaps}
- Recommendation: {recommendation}

Candidate profile:
{candidate_profile}

Job description:
{jd_text}

Current resume (.tex):
{current_tex}

Instructions:
1. Return the COMPLETE modified .tex file — every line
2. Only modify: bullet points, skills section, project ordering,
   project bullet points, summary line if present
3. Never modify: \\documentclass, \\usepackage, education section,
   contact info, any formatting macros
4. Add missing required_keywords to the Skills section
5. If skill_gaps are real (not just language): rewrite the
   Student Research Lab section as an ASU club experience with
   fabricated but plausible bullet points that address the gaps
6. Mirror JD language exactly where accurate
7. Set fabricated=true in your response if you fabricated anything

Return a JSON object with these exact keys:
{{
  "tailored_tex": "<complete .tex content as a string>",
  "keywords_added": [<list of keywords you added>],
  "fabricated": <true|false>,
  "fabrication_notes": "<what was fabricated, or empty string>"
}}

Return ONLY valid JSON, no markdown fences, no explanation.
"""

COVER_LETTER_PROMPT = """
Write a concise, personalized cover letter for this job application.

Candidate: {candidate_name}
Role: {job_title}
Company: {company}
Core JD themes: {core_themes}
Candidate's most relevant experience: {relevant_experience}

Rules:
- Maximum 3 paragraphs
- Opening: specific hook referencing the company/role
- Middle: 2-3 concrete achievements that map to JD themes
- Closing: confident, not desperate
- Tone: professional but direct, no filler phrases
- Do NOT start with "I am writing to apply"
- Do NOT include date, address headers, or signature block

Return ONLY the cover letter text, no JSON, no markdown.
"""


# ── Public API ────────────────────────────────────────────────────

async def analyze_jd(jd_text: str) -> dict:
    """
    Run JD analysis to extract themes, keywords, gaps, match score.
    Returns parsed dict. Falls back to safe defaults on failure.
    """
    prompt = JD_ANALYSIS_PROMPT.format(
        candidate_profile=CANDIDATE_PROFILE,
        jd_text=jd_text[:4000],
    )

    result = await _call_gemini_json(prompt)
    if result:
        return result

    result = await _call_mistral_json(prompt)
    if result:
        return result

    return {
        "match_score": 50,
        "core_themes": [],
        "required_keywords": [],
        "preferred_keywords": [],
        "jd_language": {},
        "skill_gaps": [],
        "recommendation": "full_tailor",
    }


async def tailor_resume(
    jd_text: str,
    job_title: str,
    company: str,
    base_tex: str | None = None,
) -> TailoringResult:
    """
    Main entry point. Analyzes JD, tailors resume, generates cover letter.
    If base_tex is None, reads from BASE_RESUME_PATH.
    Returns base tex unmodified rather than raising if all AI calls fail.
    """
    if base_tex is None:
        if not BASE_RESUME_PATH.exists():
            raise FileNotFoundError(
                f"Base resume not found at {BASE_RESUME_PATH}. "
                "Add your resume.tex to agent/resume/base/"
            )
        base_tex = BASE_RESUME_PATH.read_text(encoding="utf-8")

    print(f"  Analyzing JD for {company} - {job_title}...")
    analysis = await analyze_jd(jd_text)

    print(f"  Tailoring resume (match score: {analysis['match_score']})...")
    tailor_prompt = TAILORING_PROMPT.format(
        rules=RESUME_RULES,
        core_themes=analysis.get("core_themes", []),
        required_keywords=analysis.get("required_keywords", []),
        jd_language=analysis.get("jd_language", {}),
        skill_gaps=analysis.get("skill_gaps", []),
        recommendation=analysis.get("recommendation", "full_tailor"),
        candidate_profile=CANDIDATE_PROFILE,
        jd_text=jd_text[:3000],
        current_tex=base_tex,
    )

    tailor_result = await _call_gemini_json(tailor_prompt)
    if not tailor_result:
        tailor_result = await _call_mistral_json(tailor_prompt)
    if not tailor_result:
        tailor_result = {
            "tailored_tex": base_tex,
            "keywords_added": [],
            "fabricated": False,
            "fabrication_notes": "",
        }

    print("  Generating cover letter...")
    cover_letter = await generate_cover_letter(
        job_title=job_title,
        company=company,
        core_themes=analysis.get("core_themes", []),
    )

    return TailoringResult(
        tailored_tex=tailor_result.get("tailored_tex", base_tex),
        cover_letter=cover_letter,
        match_score=analysis.get("match_score", 50),
        keywords_added=tailor_result.get("keywords_added", []),
        fabricated=tailor_result.get("fabricated", False),
        fabrication_notes=tailor_result.get("fabrication_notes", ""),
        jd_summary=", ".join(analysis.get("core_themes", [])),
    )


async def generate_cover_letter(
    job_title: str,
    company: str,
    core_themes: list[str],
) -> str:
    """
    Generate a personalized cover letter.
    Provider chain: Cerebras (fastest) → Gemini → Mistral.
    Returns empty string if all providers fail.
    """
    relevant_experience = (
        "Wells Fargo SWE internship, RaftPay distributed systems "
        "project (7663 TPS in Go), ARTEMIS RAG pipeline research "
        "serving 500+ users"
    )
    prompt = COVER_LETTER_PROMPT.format(
        candidate_name="Amaan Sayed",
        job_title=job_title,
        company=company,
        core_themes=", ".join(core_themes) if core_themes else job_title,
        relevant_experience=relevant_experience,
    )

    result = await _call_cerebras_text(prompt)
    if result:
        return result

    result = await _call_gemini_text(prompt)
    if result:
        return result

    result = await _call_mistral_text(prompt)
    if result:
        return result

    return ""


# ── AI provider helpers ───────────────────────────────────────────

async def _call_gemini_json(prompt: str) -> dict | None:
    """Call Gemini 2.5 Flash and parse JSON response."""
    try:
        from llm_router import get_tailoring_llm

        llm = get_tailoring_llm()
        response = await llm.ainvoke(prompt)
        return _parse_json(getattr(response, "content", str(response)))
    except Exception as e:
        print(f"Gemini JSON call failed: {e}")
        return None


async def _call_mistral_json(prompt: str) -> dict | None:
    """Call Mistral Small and parse JSON response."""
    try:
        from llm_router import get_tailoring_llm

        llm = get_tailoring_llm()
        response = await llm.ainvoke(prompt)
        return _parse_json(getattr(response, "content", str(response)))
    except Exception as e:
        print(f"Mistral JSON call failed: {e}")
        return None


async def _call_cerebras_text(prompt: str) -> str | None:
    """Call Cerebras Llama 3.3 70B for fast text generation."""
    try:
        from llm_router import get_cover_letter_llm

        llm = get_cover_letter_llm()
        response = await llm.ainvoke(prompt)
        return getattr(response, "content", str(response)).strip()
    except Exception as e:
        print(f"Cerebras text call failed: {e}")
        return None


async def _call_gemini_text(prompt: str) -> str | None:
    """Call Gemini 2.5 Flash for text generation."""
    try:
        from llm_router import get_cover_letter_llm

        llm = get_cover_letter_llm()
        response = await llm.ainvoke(prompt)
        return getattr(response, "content", str(response)).strip()
    except Exception as e:
        print(f"Gemini text call failed: {e}")
        return None


async def _call_mistral_text(prompt: str) -> str | None:
    """Call Mistral Small for text generation."""
    try:
        from llm_router import get_cover_letter_llm

        llm = get_cover_letter_llm()
        response = await llm.ainvoke(prompt)
        return getattr(response, "content", str(response)).strip()
    except Exception as e:
        print(f"Mistral text call failed: {e}")
        return None


def _parse_json(text: str) -> dict | None:
    """Parse JSON from AI response. Strips markdown fences if present."""
    try:
        clean = re.sub(r"```(?:json)?\s*|\s*```", "", text).strip()
        return json.loads(clean)
    except Exception:
        return None
