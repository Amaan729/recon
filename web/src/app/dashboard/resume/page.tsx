"use client"

import { useState, useEffect, useCallback } from "react"

type ResumeVersion = {
  id: string
  status: string
  resumeVersion: string | null
  coverLetter: string | null
  createdAt: string
  job: {
    title: string
    company: string
    source: string
  }
}

type Project = {
  id: string
  name: string
  description: string
  tags: string[]
  githubUrl: string
  protected?: boolean
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (seconds < 60) return "just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

const PROJECTS: Project[] = [
  {
    id: "raftpay",
    name: "RaftPay",
    description: "Distributed payment ledger in Go, Raft consensus from scratch",
    tags: ["Go", "Distributed Systems", "7663 TPS"],
    githubUrl: "https://github.com/Amaan729/raftpay",
  },
  {
    id: "eventsniffer",
    name: "EventSniffer",
    description: "macOS productivity tool, SwiftUI + spaCy NER + Flask",
    tags: ["Swift", "NLP", "macOS"],
    githubUrl: "https://github.com/Amaan729/eventsniffer",
  },
  {
    id: "loan-risk",
    name: "Cloud Loan Risk Pipeline",
    description: "TensorFlow neural net on 400K+ records, Azure VM",
    tags: ["Python", "TensorFlow", "Azure"],
    githubUrl: "https://github.com/Amaan729",
  },
  {
    id: "banking-portal",
    name: "Enterprise Banking Portal",
    description: "Spring Boot + React + PostgreSQL + Docker + Azure",
    tags: ["Java", "React", "Docker"],
    githubUrl: "https://github.com/Amaan729",
  },
  {
    id: "artemis",
    name: "ARTEMIS (Research)",
    description: "RAG pipeline, Claude API, 500+ users in Philippines",
    tags: ["RAG", "Claude API", "Research"],
    githubUrl: "https://github.com/Amaan729",
    protected: true,
  },
]

const SOURCE_STYLE: Record<string, string> = {
  linkedin:   "bg-blue-500/15 text-blue-300 border-blue-500/25",
  instagram:  "bg-pink-500/15 text-pink-300 border-pink-500/25",
  jobspy:     "bg-purple-500/15 text-purple-300 border-purple-500/25",
  greenhouse: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
  lever:      "bg-cyan-500/15 text-cyan-300 border-cyan-500/25",
  handshake:  "bg-orange-500/15 text-orange-300 border-orange-500/25",
}

function sourceStyle(source: string) {
  return SOURCE_STYLE[source.toLowerCase()] ?? "bg-white/8 text-white/50 border-white/12"
}

const WHITELIST_KEY = "recon_project_whitelist"

const DEFAULT_WHITELIST = PROJECTS.reduce(
  (acc, p) => ({ ...acc, [p.id]: true }),
  {} as Record<string, boolean>
)

export default function ResumeManagerPage() {
  const [versions, setVersions]           = useState<ResumeVersion[]>([])
  const [loading, setLoading]             = useState(true)
  const [whitelist, setWhitelist]         = useState<Record<string, boolean>>(DEFAULT_WHITELIST)
  const [howItWorksOpen, setHowItWorksOpen] = useState(false)
  const [resumeLoaded, setResumeLoaded]   = useState<boolean | null>(null)

  // Load whitelist from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(WHITELIST_KEY)
      if (stored) {
        const parsed = JSON.parse(stored) as Record<string, boolean>
        const merged = { ...parsed }
        PROJECTS.forEach(p => { if (p.protected) merged[p.id] = true })
        setWhitelist(merged)
      }
    } catch {
      // ignore parse errors
    }
  }, [])

  // Persist whitelist to localStorage on change
  useEffect(() => {
    try {
      localStorage.setItem(WHITELIST_KEY, JSON.stringify(whitelist))
    } catch {
      // ignore storage errors
    }
  }, [whitelist])

  // Check if agent is reachable (proxy for base resume being loaded)
  useEffect(() => {
    fetch("/api/agent/status")
      .then(r => r.ok ? r.json() : null)
      .then(data => setResumeLoaded(data !== null))
      .catch(() => setResumeLoaded(false))
  }, [])

  const fetchVersions = useCallback(async () => {
    try {
      const res = await fetch("/api/resume/versions")
      if (res.ok) {
        const data = await res.json() as { applications: ResumeVersion[] }
        setVersions(data.applications)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchVersions()
    const t = setInterval(fetchVersions, 60_000)
    return () => clearInterval(t)
  }, [fetchVersions])

  const toggleProject = (id: string) => {
    const project = PROJECTS.find(p => p.id === id)
    if (project?.protected) return
    setWhitelist(prev => ({ ...prev, [id]: !prev[id] }))
  }

  return (
    <>
      <style>{`
        @keyframes sectionIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes rowIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div className="p-8 max-w-4xl space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-white">Resume Manager</h1>
          <p className="text-white/40 text-sm mt-1">
            Manage your base LaTeX resume and view AI-tailored versions per application.
          </p>
        </div>

        {/* ── Section 1: Base Resume Status ── */}
        <section style={{ animation: "sectionIn 0.35s ease forwards" }}>
          <SectionHeader label="Base Resume" />
          <div className="glass-card p-5 space-y-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/8 flex items-center justify-center text-base select-none">
                  📄
                </div>
                <div>
                  <div className="text-white font-semibold text-sm">resume.tex</div>
                  <div className="text-white/40 text-xs mt-0.5 font-mono">
                    agent/resume/base/resume.tex
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                {resumeLoaded === null ? (
                  <span className="text-white/30 text-xs">checking…</span>
                ) : resumeLoaded ? (
                  <span className="flex items-center gap-1.5 text-emerald-300 text-xs font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                    Base resume loaded ✓
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-amber-300 text-xs font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                    Agent offline
                  </span>
                )}
                <a
                  href="https://www.overleaf.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-ghost text-xs px-3 py-1.5 font-medium inline-flex items-center gap-1"
                >
                  Edit on Overleaf ↗
                </a>
              </div>
            </div>

            {/* How it works accordion */}
            <div className="border-t border-white/8 pt-4">
              <button
                onClick={() => setHowItWorksOpen(o => !o)}
                className="flex items-center gap-2 text-xs text-white/40 hover:text-white/65 transition-colors"
              >
                <span className="select-none">{howItWorksOpen ? "▲" : "▼"}</span>
                How it works
              </button>
              {howItWorksOpen && (
                <p
                  className="mt-3 text-white/35 text-xs leading-relaxed max-w-xl"
                  style={{ animation: "sectionIn 0.2s ease forwards" }}
                >
                  The agent pulls your base resume from{" "}
                  <code className="text-white/55 bg-white/8 px-1.5 py-0.5 rounded font-mono">
                    agent/resume/base/resume.tex
                  </code>
                  , tailors it per job using AI, compiles with tectonic, and enforces a one-page
                  limit automatically.
                </p>
              )}
            </div>
          </div>
        </section>

        {/* ── Section 2: Project Whitelist ── */}
        <section style={{ animation: "sectionIn 0.4s ease forwards", opacity: 0 }}>
          <SectionHeader label="Project Whitelist" />
          <div className="space-y-2.5">
            {PROJECTS.map((project, idx) => (
              <ProjectCard
                key={project.id}
                project={project}
                enabled={whitelist[project.id] ?? true}
                onToggle={() => toggleProject(project.id)}
                idx={idx}
              />
            ))}
          </div>
        </section>

        {/* ── Section 3: Tailored Resume Versions ── */}
        <section style={{ animation: "sectionIn 0.45s ease forwards", opacity: 0 }}>
          <div className="flex items-center gap-3 mb-4">
            <span className="text-white/60 text-xs uppercase tracking-widest font-medium">
              Tailored Resume Versions
            </span>
            {!loading && versions.length > 0 && (
              <span className="stat-badge">{versions.length}</span>
            )}
            <div className="flex-1 h-px bg-white/8" />
          </div>

          {loading ? (
            <div className="space-y-2.5">
              {[0, 1, 2].map(i => (
                <div key={i} className="glass-card p-4 animate-pulse">
                  <div className="flex gap-3 items-center">
                    <div className="w-10 h-10 rounded-xl bg-white/8 shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-white/8 rounded w-2/5" />
                      <div className="h-3 bg-white/5 rounded w-1/4" />
                    </div>
                    <div className="h-7 w-20 bg-white/5 rounded-lg" />
                  </div>
                </div>
              ))}
            </div>
          ) : versions.length === 0 ? (
            <div className="glass-card p-16 text-center">
              <div className="text-5xl mb-4 opacity-20 select-none">◎</div>
              <div className="text-white/40 text-sm">
                No tailored resumes yet. Approve jobs to start the tailoring pipeline.
              </div>
            </div>
          ) : (
            <div className="space-y-2.5">
              {versions.map((v, idx) => (
                <VersionRow key={v.id} version={v} idx={idx} />
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  )
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <span className="text-white/60 text-xs uppercase tracking-widest font-medium">{label}</span>
      <div className="flex-1 h-px bg-white/8" />
    </div>
  )
}

function ProjectCard({
  project,
  enabled,
  onToggle,
  idx,
}: {
  project: Project
  enabled: boolean
  onToggle: () => void
  idx: number
}) {
  return (
    <div
      className="glass-card p-4 flex items-start gap-4"
      style={{
        animation: "rowIn 0.3s ease forwards",
        animationDelay: `${idx * 50}ms`,
        opacity: 0,
        ...(project.protected
          ? { borderColor: "rgba(251,191,36,0.22)", backgroundColor: "rgba(251,191,36,0.03)" }
          : {}),
      }}
    >
      {/* Toggle switch */}
      <button
        onClick={onToggle}
        disabled={project.protected}
        aria-label={`${enabled ? "Disable" : "Enable"} ${project.name}`}
        className={`relative mt-0.5 shrink-0 w-9 h-5 rounded-full transition-colors duration-200 ${
          enabled ? "bg-blue-500" : "bg-white/15"
        } ${project.protected ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${
            enabled ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </button>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className="text-white text-sm font-semibold">{project.name}</span>
          {project.protected && (
            <span className="text-xs px-1.5 py-0.5 rounded-md border bg-amber-400/12 text-amber-300 border-amber-400/25 font-medium">
              Protected
            </span>
          )}
        </div>
        <p className="text-white/45 text-xs mb-2.5 leading-relaxed">{project.description}</p>
        <div className="flex items-center gap-1.5 flex-wrap">
          {project.tags.map(tag => (
            <span
              key={tag}
              className="text-xs px-2 py-0.5 rounded-md bg-white/8 text-white/50 border border-white/10"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>

      {/* GitHub link */}
      <a
        href={project.githubUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-blue-400/60 hover:text-blue-400 transition-colors px-2 py-1.5 rounded-lg hover:bg-white/5 shrink-0 mt-0.5"
      >
        GitHub ↗
      </a>
    </div>
  )
}

function VersionRow({ version, idx }: { version: ResumeVersion; idx: number }) {
  const isFabricated = version.coverLetter?.startsWith("FABRICATED:") ?? false
  const texPath = version.resumeVersion?.replace(/\.pdf$/, ".tex") ?? ""

  return (
    <div
      className="glass-card p-4 flex gap-3 items-center"
      style={{
        animation: "rowIn 0.3s ease forwards",
        animationDelay: `${idx * 40}ms`,
        opacity: 0,
      }}
    >
      {/* Company initial */}
      <div className="w-10 h-10 rounded-xl bg-white/8 flex items-center justify-center text-sm font-bold text-white/45 shrink-0 select-none">
        {version.job.company[0]?.toUpperCase() ?? "?"}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="text-white font-semibold text-sm mb-1 truncate">{version.job.title}</div>
        <div className="flex items-center gap-2 flex-wrap text-xs text-white/50">
          <span className="font-medium text-white/65">{version.job.company}</span>
          <span
            className={`px-2 py-0.5 rounded-md border font-medium ${sourceStyle(version.job.source)}`}
          >
            {version.job.source}
          </span>
          {isFabricated && (
            <span className="px-2 py-0.5 rounded-md border font-medium bg-red-500/15 text-red-300 border-red-500/25">
              ⚠ Fabricated
            </span>
          )}
          <span className="text-white/28">{timeAgo(version.createdAt)}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 shrink-0">
        {version.resumeVersion && (
          <a
            href={version.resumeVersion}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost text-xs px-3 py-1.5 font-medium inline-flex items-center gap-1"
          >
            View PDF ↗
          </a>
        )}
        {texPath && (
          <a
            href={texPath}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost text-xs px-3 py-1.5 font-medium inline-flex items-center gap-1"
          >
            View .tex ↗
          </a>
        )}
      </div>
    </div>
  )
}
