"""
AI resume tailoring module.

When implemented, this module will:
- Accept a Job record (containing the full jdText) and the base LaTeX
  resume template
- Use an AI provider (Gemini / Groq / Mistral via OPENROUTER_API_KEY)
  to rewrite bullet points and the summary section to match the JD's
  keywords and priorities
- Return the tailored LaTeX source as a string for compile.py to render
- Cache tailored versions so the same JD doesn't trigger redundant AI calls
"""
