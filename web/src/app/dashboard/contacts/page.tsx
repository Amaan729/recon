"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";

type Contact = { id: string; email: string; name: string | null; company: string | null; createdAt: string };

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  async function load(q = "") {
    setLoading(true);
    const res = await fetch(`/api/contacts?q=${encodeURIComponent(q)}`);
    setContacts(await res.json());
    setLoading(false);
  }

  useEffect(() => { load(); }, []);
  useEffect(() => {
    const t = setTimeout(() => load(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  async function remove(id: string) {
    await fetch("/api/contacts", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    setContacts((c) => c.filter((x) => x.id !== id));
    toast.success("Removed");
  }

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-7">
        <h1 className="text-2xl font-bold text-white">Contacts</h1>
        <p className="text-white/40 text-sm mt-1">Auto-saved whenever you send an email.</p>
      </div>

      <div className="mb-4">
        <input
          className="w-full glass-input px-4 py-3 text-sm focus:outline-none"
          placeholder="Search by name, email, or company..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="glass-card overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-white/30 text-sm">Loading...</div>
        ) : contacts.length === 0 ? (
          <div className="p-10 text-center text-white/30 text-sm">
            No contacts yet — they appear automatically when you send emails.
          </div>
        ) : (
          <div className="divide-y divide-white/6">
            {contacts.map((c) => (
              <div key={c.id} className="flex items-center gap-4 px-5 py-4 hover:bg-white/4 transition-all">
                <div className="w-9 h-9 rounded-xl bg-white/8 flex items-center justify-center text-sm font-bold text-white/60 shrink-0">
                  {(c.name ?? c.email)[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-white/85 text-sm font-medium">{c.name ?? c.email}</div>
                  <div className="text-white/35 text-xs">
                    {c.name ? c.email : ""}
                    {c.company ? ` · ${c.company}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-white/25 text-xs">
                    {new Date(c.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                  <button
                    onClick={() => remove(c.id)}
                    className="text-white/20 hover:text-red-400 text-sm transition-colors px-2 py-1 rounded-lg hover:bg-red-400/10"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
