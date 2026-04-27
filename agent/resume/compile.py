"""
LaTeX compile engine for the Recon resume tailoring pipeline.
Installs tectonic binary if not present, compiles .tex to PDF,
enforces one-page limit by iteratively trimming bullets.
"""

import asyncio
import io
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

MAX_COMPILE_ATTEMPTS = 8
TECTONIC_INSTALL_URL = (
    "https://github.com/tectonic-typesetting/tectonic/releases/download/"
    "tectonic%400.15.0/tectonic-0.15.0-x86_64-unknown-linux-musl.tar.gz"
)
TECTONIC_BREW_FORMULA = "tectonic"


# ── Tectonic installation ─────────────────────────────────────────

def ensure_tectonic() -> str:
    """
    Ensure tectonic binary is available. Returns path to binary.
    macOS: installs via homebrew. Linux: downloads binary directly.
    Raises RuntimeError if installation fails.
    """
    existing = shutil.which("tectonic")
    if existing:
        return existing

    import platform
    system = platform.system()

    if system == "Darwin":
        print("Installing tectonic via homebrew...")
        result = subprocess.run(
            ["brew", "install", TECTONIC_BREW_FORMULA],
            capture_output=True, text=True,
        )
        if result.returncode != 0:
            raise RuntimeError(f"brew install tectonic failed: {result.stderr}")
        path = shutil.which("tectonic")
        if not path:
            raise RuntimeError("tectonic not found after brew install")
        return path

    elif system == "Linux":
        print("Installing tectonic binary for Linux...")
        install_dir = Path.home() / ".local" / "bin"
        install_dir.mkdir(parents=True, exist_ok=True)
        tectonic_path = install_dir / "tectonic"

        import tarfile
        import urllib.request

        with tempfile.TemporaryDirectory() as tmp:
            archive = Path(tmp) / "tectonic.tar.gz"
            urllib.request.urlretrieve(TECTONIC_INSTALL_URL, archive)
            with tarfile.open(archive) as tar:
                tar.extractall(tmp)
            for f in Path(tmp).rglob("tectonic"):
                if f.is_file():
                    shutil.copy2(f, tectonic_path)
                    tectonic_path.chmod(0o755)
                    break

        if not tectonic_path.exists():
            raise RuntimeError("tectonic binary not found after extraction")

        os.environ["PATH"] = f"{install_dir}:{os.environ.get('PATH', '')}"
        return str(tectonic_path)

    else:
        raise RuntimeError(f"Unsupported platform: {system}")


# ── Compile ───────────────────────────────────────────────────────

async def compile_tex(tex_content: str) -> bytes:
    """
    Compile a LaTeX string to PDF bytes using tectonic.
    Raises RuntimeError if compilation fails.
    """
    tectonic_bin = await asyncio.to_thread(ensure_tectonic)

    def _compile() -> bytes:
        with tempfile.TemporaryDirectory() as tmp:
            tex_path = Path(tmp) / "resume.tex"
            pdf_path = Path(tmp) / "resume.pdf"
            tex_path.write_text(tex_content, encoding="utf-8")

            result = subprocess.run(
                [tectonic_bin, str(tex_path)],
                capture_output=True,
                text=True,
                cwd=tmp,
            )
            if result.returncode != 0:
                raise RuntimeError(f"tectonic compile failed:\n{result.stderr}")
            if not pdf_path.exists():
                raise RuntimeError("tectonic succeeded but PDF not found")
            return pdf_path.read_bytes()

    return await asyncio.to_thread(_compile)


def count_pages(pdf_bytes: bytes) -> int:
    """Count pages in a PDF using pypdf. Returns 1 on any parse error."""
    try:
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(pdf_bytes))
        return len(reader.pages)
    except Exception:
        return 1


# ── One-page enforcement ──────────────────────────────────────────

def _parse_sections(tex: str) -> list[tuple[str, int, int]]:
    """
    Parse .tex into (section_name, start_pos, end_pos) tuples.
    Detects \\resumeSubheading and \\section boundaries.
    """
    sections = []
    header_pattern = re.compile(
        r'\\(?:resumeSubheading|section)\{([^}]+)\}',
        re.IGNORECASE,
    )
    matches = list(header_pattern.finditer(tex))
    for i, match in enumerate(matches):
        name = match.group(1)
        start = match.start()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(tex)
        sections.append((name, start, end))
    return sections


def _find_trim_target(tex: str) -> tuple[str, bool]:
    """
    Find the lowest-priority bullet to remove.
    Returns (modified_tex, found) — found=False means nothing safe left.

    Trim order (first = cut first):
    1. ASU club / society / association (fabricated)
    2. Student Research Lab
    3. Projects (least relevant, i.e. last project block found)
    4. Wells Fargo (last resort)
    5. ARTEMIS — never trimmed; returns (tex, False) to signal error
    """
    item_pattern = re.compile(r'\\resumeItem\{[^}]*\}', re.DOTALL)
    sections = _parse_sections(tex)

    TRIM_ORDER = [
        ["club", "society", "association"],
        ["student research"],
        ["projects"],
        ["wells fargo"],
    ]
    PROTECTED = ["artemis"]

    for priority_group in TRIM_ORDER:
        for section_name, section_start, section_end in sections:
            name_lower = section_name.lower()
            if any(kw in name_lower for kw in PROTECTED):
                continue
            if any(kw in name_lower for kw in priority_group):
                section_tex = tex[section_start:section_end]
                matches = list(item_pattern.finditer(section_tex))
                if matches:
                    last = matches[-1]
                    abs_start = section_start + last.start()
                    abs_end = section_start + last.end()
                    # Strip trailing newline if present
                    if abs_end < len(tex) and tex[abs_end] == "\n":
                        abs_end += 1
                    return tex[:abs_start] + tex[abs_end:], True

    return tex, False


async def compile_one_page(tex_content: str) -> tuple[bytes, str]:
    """
    Compile .tex to PDF and enforce one-page limit.
    Iteratively trims lowest-priority bullets until PDF is 1 page
    or MAX_COMPILE_ATTEMPTS is reached.

    Returns (pdf_bytes, final_tex).
    Raises RuntimeError if 1-page target can't be reached safely.
    """
    current_tex = tex_content

    for attempt in range(1, MAX_COMPILE_ATTEMPTS + 1):
        print(f"  Compile attempt {attempt}/{MAX_COMPILE_ATTEMPTS}...")
        pdf_bytes = await compile_tex(current_tex)
        pages = count_pages(pdf_bytes)
        print(f"  Page count: {pages}")

        if pages == 1:
            print(f"  One page achieved on attempt {attempt}")
            return pdf_bytes, current_tex

        trimmed_tex, found = _find_trim_target(current_tex)
        if not found:
            raise RuntimeError(
                "Cannot reduce resume to 1 page without "
                "trimming ARTEMIS — manual review required"
            )
        current_tex = trimmed_tex

    raise RuntimeError(
        f"Could not achieve 1-page resume after {MAX_COMPILE_ATTEMPTS} attempts"
    )


# ── Save output ───────────────────────────────────────────────────

async def compile_resume(tex_content: str, output_dir: str) -> str:
    """
    Compile tailored .tex, enforce one-page output, and save artifacts.
    Returns the saved PDF path.
    """
    pdf_bytes, final_tex = await compile_one_page(tex_content)
    saved = await save_resume_version(
        job_id=Path(output_dir).name,
        pdf_bytes=pdf_bytes,
        final_tex=final_tex,
        output_dir=Path(output_dir),
    )
    return saved["pdf_path"]


async def save_resume_version(
    job_id: str,
    pdf_bytes: bytes,
    final_tex: str,
    output_dir: Path | None = None,
) -> dict[str, str]:
    """
    Save compiled PDF and final .tex to agent/resume/versions/{job_id}/.
    Returns dict with 'pdf_path' and 'tex_path' keys.
    """
    if output_dir is None:
        output_dir = Path(__file__).parent / "versions" / job_id

    def _save() -> dict[str, str]:
        output_dir.mkdir(parents=True, exist_ok=True)
        pdf_path = output_dir / "resume.pdf"
        tex_path = output_dir / "resume.tex"
        pdf_path.write_bytes(pdf_bytes)
        tex_path.write_text(final_tex, encoding="utf-8")
        return {"pdf_path": str(pdf_path), "tex_path": str(tex_path)}

    return await asyncio.to_thread(_save)
