"""
LaTeX resume compiler.

When implemented, this module will:
- Accept tailored LaTeX source from tailor.py
- Compile to PDF using a local or Docker-based pdflatex installation
- Write the output file to a versioned path (e.g. resumes/<job_id>.pdf)
- Update the Application record's resumeVersion field with the file path
- Raise a descriptive error if compilation fails so the agent can fall
  back to the base resume
"""
