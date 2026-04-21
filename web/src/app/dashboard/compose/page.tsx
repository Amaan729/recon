"use client";

import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

type Contact = { id: string; email: string; name: string | null; company: string | null };
type Resume = { id: string; name: string; isDefault: boolean };

export default function ComposePage() {
  const router = useRouter();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [suggestions, setSuggestions] = useState<Contact[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [sending, setSending] = useState(false);
  const suggestRef = useRef<HTMLDivElement>(null);

  const [form, setForm] = useState({
    to: "",
    name: "",
    company: "",
    subject: "",
    body: "",
    resumeId: "",
    followUpMode: "none" as "none" | "auto" | "manual",
    followUpDays: "3",
  });

  useEffect(() => {
    fetch("/api/contacts").then((r) => r.json()).then(setContacts);
    fetch("/api/resumes").then((r) => r.json()).then((data: Resume[]) => {
      setResumes(data);
      const def = data.find((r) => r.isDefault);
      if (def) setForm((f) => ({ ...f, resumeId: def.id }));
    });
  }, []);

  // Contact autocomplete
  useEffect(() => {
    if (form.to.length < 2) { setSuggestions([]); return; }
    const filtered = contacts.filter(
      (c) => c.email.toLowerCase().includes(form.to.toLowerCase()) ||
             c.name?.toLowerCase().includes(form.to.toLowerCase()) ||
             c.company?.toLowerCase().includes(form.to.toLowerCase())
    );
    setSuggestions(filtered.slice(0, 6));
    setShowSuggestions(filtered.length > 0);
  }, [form.to, contacts]);

  function pickContact(c: Contact) {
    setForm((f) => ({ ...f, to: c.email, name: c.name ?? f.name, company: c.company ?? f.company }));
    setShowSuggestions(false);
  }

  async function send() {
    if (!form.to || !form.subject || !form.body) {
      toast.error("Please fill in recipient, subject, and body");
      return;
    }
    setSending(true);
    try {
      const res = await fetch("/api/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: form.to,
          name: form.name || undefined,
          company: form.company || undefined,
          subject: form.subject,
          body: form.body,
          resumeId: form.resumeId || undefined,
          followUpMode: form.followUpMode,
          followUpDays: form.followUpMode === "auto" ? Number(form.followUpDays) : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Email sent! Tracking is active.");
      router.push("/dashboard/tracking");
    } catch (err) {
      toast.error(`Failed: ${err}`);
    } finally {
      setSending(false);
    }
  }

  const inputClass = "w-full glass-input px-4 py-3 text-sm focus:outline-none transition-all";
  const labelClass = "text-white/50 text-xs font-semibold uppercase tracking-wider mb-1.5 block";

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-7">
        <h1 className="text-2xl font-bold text-white">Compose Email</h1>
        <p className="text-white/40 text-sm mt-1">Tracked automatically — no watermarks.</p>
      </div>

      <div className="glass-card p-6 space-y-5">
        {/* To */}
        <div className="relative">
          <label className={labelClass}>To</label>
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <input
                className={inputClass}
                placeholder="recruiter@company.com"
                value={form.to}
                onChange={(e) => setForm((f) => ({ ...f, to: e.target.value }))}
                onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                autoComplete="off"
              />
              {showSuggestions && (
                <div
                  ref={suggestRef}
                  className="absolute top-full left-0 right-0 mt-1 z-[999] rounded-xl border border-white/10 shadow-2xl overflow-hidden"
                  style={{ background: "rgba(13, 20, 40, 0.98)", backdropFilter: "blur(24px)" }}
                >
                  {suggestions.map((c) => (
                    <button
                      key={c.id}
                      onMouseDown={() => pickContact(c)}
                      className="w-full text-left px-4 py-2.5 hover:bg-white/8 transition-colors border-b border-white/5 last:border-0"
                    >
                      <div className="text-white/90 text-sm font-medium">{c.name ?? c.email}</div>
                      <div className="text-white/40 text-xs">{c.email}{c.company ? ` · ${c.company}` : ""}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Name + Company */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Their Name</label>
            <input className={inputClass} placeholder="Jane Smith" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div>
            <label className={labelClass}>Company</label>
            <input className={inputClass} placeholder="Google" value={form.company} onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))} />
          </div>
        </div>

        {/* Subject */}
        <div>
          <label className={labelClass}>Subject</label>
          <input className={inputClass} placeholder="Interested in SWE opportunities at Google" value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} />
        </div>

        {/* Body */}
        <div>
          <label className={labelClass}>Message</label>
          <textarea
            className={`${inputClass} resize-none`}
            rows={9}
            placeholder={`Hi Jane,\n\nI came across your profile and I'm very interested in opportunities at Google...\n\nBest,\nAmaan`}
            value={form.body}
            onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
          />
        </div>

        {/* Divider */}
        <div className="border-t border-white/8" />

        {/* Resume */}
        <div>
          <label className={labelClass}>Attach Resume</label>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setForm((f) => ({ ...f, resumeId: "" }))}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all border ${
                !form.resumeId
                  ? "bg-white/12 text-white border-white/25"
                  : "text-white/45 border-white/8 hover:border-white/18"
              }`}
            >
              No Resume
            </button>
            {resumes.map((r) => (
              <button
                key={r.id}
                onClick={() => setForm((f) => ({ ...f, resumeId: r.id }))}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-all border ${
                  form.resumeId === r.id
                    ? "bg-blue-500/25 text-blue-300 border-blue-400/40"
                    : "text-white/45 border-white/8 hover:border-white/18 hover:text-white/70"
                }`}
              >
                {r.name} {r.isDefault && <span className="text-xs opacity-60 ml-1">(default)</span>}
              </button>
            ))}
            <a
              href="/dashboard/resumes"
              className="px-4 py-2 rounded-xl text-sm font-medium text-white/35 border border-dashed border-white/15 hover:border-white/25 hover:text-white/55 transition-all"
            >
              + Upload
            </a>
          </div>
          {form.resumeId && (
            <p className="text-white/35 text-xs mt-2">
              ✦ A "View Resume" button will be embedded in the email + PDF opens are tracked separately.
            </p>
          )}
        </div>

        {/* Follow-up */}
        <div>
          <label className={labelClass}>Follow-up</label>
          <div className="flex gap-2 mb-3">
            {(["none", "auto", "manual"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setForm((f) => ({ ...f, followUpMode: mode }))}
                className={`px-4 py-2 rounded-xl text-sm font-medium capitalize transition-all border ${
                  form.followUpMode === mode
                    ? "bg-blue-500/25 text-blue-300 border-blue-400/40"
                    : "text-white/45 border-white/8 hover:border-white/18 hover:text-white/70"
                }`}
              >
                {mode === "none" ? "Off" : mode === "auto" ? "Auto" : "Remind Me"}
              </button>
            ))}
          </div>
          {form.followUpMode === "auto" && (
            <div className="flex items-center gap-3 glass-input px-4 py-3 rounded-xl">
              <span className="text-white/50 text-sm">If opened but no reply, follow up after</span>
              <input
                type="number"
                value={form.followUpDays}
                onChange={(e) => setForm((f) => ({ ...f, followUpDays: e.target.value }))}
                className="w-12 text-center bg-white/10 rounded-lg text-white text-sm py-1 border border-white/15"
                min={1}
                max={30}
              />
              <span className="text-white/50 text-sm">days</span>
            </div>
          )}
          {form.followUpMode === "manual" && (
            <p className="text-white/40 text-xs">You'll see a "Send Follow-up" button in the tracking view when they've opened but not replied.</p>
          )}
        </div>

        {/* Send */}
        <button
          onClick={send}
          disabled={sending}
          className="w-full btn-primary py-3.5 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {sending ? "Sending..." : "Send Email  →"}
        </button>
      </div>
    </div>
  );
}
