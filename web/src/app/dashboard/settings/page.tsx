"use client"

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"

type CandidateProfile = {
  firstName: string
  lastName: string
  email: string
  phone: string
  university: string
  major: string
  gpa: string
  graduationYear: string
  graduationMonth: string
  linkedinUrl: string
  githubUrl: string
  portfolioUrl: string
  location: string
  workAuthorization: string
  requiresSponsorship: string
}

const EMPTY_PROFILE: CandidateProfile = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  university: "",
  major: "",
  gpa: "",
  graduationYear: "",
  graduationMonth: "",
  linkedinUrl: "",
  githubUrl: "",
  portfolioUrl: "",
  location: "",
  workAuthorization: "Yes",
  requiresSponsorship: "No",
}

const INPUT_CLASS =
  "w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder:text-white/25 focus:outline-none focus:border-white/25 focus:bg-white/8 transition-all disabled:opacity-50 disabled:cursor-not-allowed"

function normalizeProfile(data: Partial<CandidateProfile>): CandidateProfile {
  return {
    firstName: data.firstName ?? "",
    lastName: data.lastName ?? "",
    email: data.email ?? "",
    phone: data.phone ?? "",
    university: data.university ?? "",
    major: data.major ?? "",
    gpa: data.gpa ?? "",
    graduationYear: data.graduationYear ?? "",
    graduationMonth: data.graduationMonth ?? "",
    linkedinUrl: data.linkedinUrl ?? "",
    githubUrl: data.githubUrl ?? "",
    portfolioUrl: data.portfolioUrl ?? "",
    location: data.location ?? "",
    workAuthorization: data.workAuthorization ?? "Yes",
    requiresSponsorship: data.requiresSponsorship ?? "No",
  }
}

async function fetchCandidateProfile(init?: RequestInit): Promise<CandidateProfile> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 8_000)

  try {
    const res = await fetch("/api/candidate", {
      cache: "no-store",
      ...init,
      signal: controller.signal,
    })

    if (!res.ok) {
      const data = await res.json().catch(() => null) as { error?: string } | null
      throw new Error(data?.error ?? "Candidate profile request failed")
    }

    return normalizeProfile(await res.json() as Partial<CandidateProfile>)
  } finally {
    window.clearTimeout(timeout)
  }
}

export default function SettingsPage() {
  const [profile, setProfile] = useState<CandidateProfile>(EMPTY_PROFILE)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const fetchProfile = useCallback(async () => {
    try {
      setProfile(await fetchCandidateProfile())
    } catch (error) {
      toast.error("Failed to load profile", {
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const t = window.setTimeout(() => {
      void fetchProfile()
    }, 0)
    return () => clearTimeout(t)
  }, [fetchProfile])

  const updateField = (field: keyof CandidateProfile, value: string) => {
    setProfile(prev => ({ ...prev, [field]: value }))
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const data = await fetchCandidateProfile({
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(profile),
      })
      setProfile(data)
      toast.success("Profile saved")
    } catch (error) {
      toast.error("Failed to save profile", {
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-7">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-white">Settings</h1>
          {!loading && <span className="stat-badge">Candidate</span>}
        </div>
        <p className="text-white/40 text-sm mt-1">
          Manage your candidate profile and application preferences.
        </p>
      </div>

      <div className="glass-card p-6">
        <div className="flex items-center justify-between gap-4 flex-wrap mb-6">
          <div>
            <h2 className="text-white font-semibold text-lg">Candidate Profile</h2>
            <p className="text-white/35 text-sm mt-1">
              This profile is used to fill applications and outreach automatically.
            </p>
          </div>

          <button
            onClick={handleSave}
            disabled={loading || saving}
            className="btn-primary px-4 py-2 text-sm shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>

        {loading ? (
          <div className="space-y-4">
            {Array.from({ length: 7 }, (_, idx) => (
              <div key={idx} className="space-y-2">
                <div className="h-4 w-28 rounded-md bg-white/8 animate-pulse" />
                <div className="h-11 rounded-xl bg-white/6 animate-pulse" />
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field
                label="First Name"
                value={profile.firstName}
                onChange={value => updateField("firstName", value)}
                disabled={saving}
              />
              <Field
                label="Last Name"
                value={profile.lastName}
                onChange={value => updateField("lastName", value)}
                disabled={saving}
              />
            </div>

            <Field
              label="Email"
              value={profile.email}
              onChange={value => updateField("email", value)}
              disabled={saving}
            />

            <Field
              label="Phone"
              value={profile.phone}
              onChange={value => updateField("phone", value)}
              disabled={saving}
            />

            <Field
              label="University"
              value={profile.university}
              onChange={value => updateField("university", value)}
              disabled={saving}
            />

            <Field
              label="Major"
              value={profile.major}
              onChange={value => updateField("major", value)}
              disabled={saving}
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field
                label="GPA"
                value={profile.gpa}
                onChange={value => updateField("gpa", value)}
                disabled={saving}
              />
              <Field
                label="Graduation Month"
                value={profile.graduationMonth}
                onChange={value => updateField("graduationMonth", value)}
                disabled={saving}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field
                label="Graduation Year"
                value={profile.graduationYear}
                onChange={value => updateField("graduationYear", value)}
                disabled={saving}
              />
              <Field
                label="Location"
                value={profile.location}
                onChange={value => updateField("location", value)}
                disabled={saving}
              />
            </div>

            <Field
              label="LinkedIn URL"
              value={profile.linkedinUrl}
              onChange={value => updateField("linkedinUrl", value)}
              disabled={saving}
            />

            <Field
              label="GitHub URL"
              value={profile.githubUrl}
              onChange={value => updateField("githubUrl", value)}
              disabled={saving}
            />

            <Field
              label="Portfolio URL"
              value={profile.portfolioUrl}
              onChange={value => updateField("portfolioUrl", value)}
              disabled={saving}
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <SelectField
                label="Work Authorization"
                value={profile.workAuthorization}
                onChange={value => updateField("workAuthorization", value)}
                disabled={saving}
              />
              <SelectField
                label="Requires Sponsorship"
                value={profile.requiresSponsorship}
                onChange={value => updateField("requiresSponsorship", value)}
                disabled={saving}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  disabled: boolean
}) {
  return (
    <label className="block">
      <span className="block text-white/50 text-sm mb-1.5">{label}</span>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        className={INPUT_CLASS}
      />
    </label>
  )
}

function SelectField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  disabled: boolean
}) {
  return (
    <label className="block">
      <span className="block text-white/50 text-sm mb-1.5">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        className={INPUT_CLASS}
      >
        <option value="Yes" className="bg-[#0a0a0f]">Yes</option>
        <option value="No" className="bg-[#0a0a0f]">No</option>
      </select>
    </label>
  )
}
