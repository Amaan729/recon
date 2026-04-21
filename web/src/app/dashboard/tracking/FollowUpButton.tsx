"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

export default function FollowUpButton({
  emailId,
  recipientName,
  originalSubject,
}: {
  emailId: string;
  recipientName: string;
  originalSubject: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [form, setForm] = useState({
    subject: `Re: ${originalSubject}`,
    body: `Hi ${recipientName},\n\nJust wanted to follow up on my previous email. I'm still very interested and would love to connect.\n\nBest,\nAmaan`,
  });

  async function send() {
    setSending(true);
    try {
      const res = await fetch(`/api/emails/${emailId}/followup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Follow-up sent!");
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(`Failed: ${err}`);
    } finally {
      setSending(false);
    }
  }

  const inputClass = "w-full glass-input px-3 py-2.5 text-sm focus:outline-none rounded-xl";

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="px-4 py-2 rounded-xl text-xs font-semibold bg-blue-500/20 text-blue-300 border border-blue-400/30 hover:bg-blue-500/30 transition-all"
      >
        Send Follow-up →
      </button>
    );
  }

  return (
    <div className="glass p-4 rounded-2xl border border-white/10 space-y-3 mt-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-white/70 text-xs font-semibold uppercase tracking-wider">Follow-up to {recipientName}</span>
        <button onClick={() => setOpen(false)} className="text-white/30 hover:text-white/60 text-sm">✕</button>
      </div>
      <input
        className={inputClass}
        value={form.subject}
        onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
        placeholder="Subject"
      />
      <textarea
        className={`${inputClass} resize-none`}
        rows={5}
        value={form.body}
        onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
      />
      <div className="flex gap-2">
        <button
          onClick={send}
          disabled={sending}
          className="btn-primary px-5 py-2 text-sm disabled:opacity-50"
        >
          {sending ? "Sending..." : "Send →"}
        </button>
        <button onClick={() => setOpen(false)} className="btn-ghost px-5 py-2 text-sm">
          Cancel
        </button>
      </div>
    </div>
  );
}
