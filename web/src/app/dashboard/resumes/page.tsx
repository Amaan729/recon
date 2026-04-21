"use client";

import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";

type Resume = { id: string; name: string; filename: string; isDefault: boolean; openCount: number; createdAt: string };

export default function ResumesPage() {
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [uploading, setUploading] = useState(false);
  const [name, setName] = useState("");
  const [setDefault, setSetDefault] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    const res = await fetch("/api/resumes");
    setResumes(await res.json());
  }

  useEffect(() => { load(); }, []);

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file || !name.trim()) return toast.error("Please choose a file and enter a name");
    if (!file.name.endsWith(".pdf")) return toast.error("Only PDF files supported");

    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("name", name.trim());
      fd.append("isDefault", String(setDefault));

      const res = await fetch("/api/resumes", { method: "POST", body: fd });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("Resume uploaded!");
      setName("");
      setSetDefault(false);
      if (fileRef.current) fileRef.current.value = "";
      load();
    } catch (err) {
      toast.error(`Upload failed: ${err}`);
    } finally {
      setUploading(false);
    }
  }

  async function setAsDefault(id: string) {
    await fetch("/api/resumes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, isDefault: true }),
    });
    load();
  }

  async function deleteResume(id: string) {
    await fetch("/api/resumes", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    toast.success("Deleted");
    load();
  }

  const inputClass = "w-full glass-input px-4 py-3 text-sm focus:outline-none";

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-7">
        <h1 className="text-2xl font-bold text-white">Resumes</h1>
        <p className="text-white/40 text-sm mt-1">Upload PDFs and track when recruiters view them.</p>
      </div>

      {/* Upload */}
      <div className="glass-card p-6 mb-6 space-y-4">
        <h2 className="text-white/80 font-semibold text-sm">Upload New Resume</h2>
        <div>
          <label className="text-white/45 text-xs font-semibold uppercase tracking-wider mb-1.5 block">Display Name</label>
          <input
            className={inputClass}
            placeholder='e.g. "SWE Resume — Google"'
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label className="text-white/45 text-xs font-semibold uppercase tracking-wider mb-1.5 block">PDF File</label>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf"
            className="w-full text-white/60 text-sm file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-white/10 file:text-white/70 file:text-sm file:cursor-pointer hover:file:bg-white/15 transition-all cursor-pointer"
          />
        </div>
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={setDefault}
            onChange={(e) => setSetDefault(e.target.checked)}
            className="w-4 h-4 rounded accent-blue-500"
          />
          <span className="text-white/55 text-sm">Set as default (auto-selected in Compose)</span>
        </label>
        <button
          onClick={upload}
          disabled={uploading}
          className="btn-primary px-6 py-2.5 text-sm disabled:opacity-50 w-full"
        >
          {uploading ? "Uploading..." : "Upload Resume"}
        </button>
      </div>

      {/* List */}
      <div className="space-y-3">
        {resumes.length === 0 ? (
          <div className="glass-card p-10 text-center text-white/30 text-sm">
            No resumes yet. Upload your first one above.
          </div>
        ) : (
          resumes.map((r) => (
            <div key={r.id} className="glass-card p-5 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-red-500/15 flex items-center justify-center text-red-400 text-lg shrink-0">
                📄
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-white font-medium text-sm">{r.name}</span>
                  {r.isDefault && (
                    <span className="stat-badge text-xs">Default</span>
                  )}
                </div>
                <div className="text-white/35 text-xs">
                  {r.openCount > 0 ? (
                    <span className="text-amber-400">Viewed {r.openCount}× by recruiters</span>
                  ) : (
                    "Not viewed yet"
                  )}
                  {" · "}
                  {new Date(r.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                {!r.isDefault && (
                  <button
                    onClick={() => setAsDefault(r.id)}
                    className="btn-ghost px-3 py-1.5 text-xs"
                  >
                    Set Default
                  </button>
                )}
                <button
                  onClick={() => deleteResume(r.id)}
                  className="px-3 py-1.5 rounded-xl text-xs text-red-400/70 border border-red-400/15 hover:bg-red-400/10 hover:text-red-400 transition-all"
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
