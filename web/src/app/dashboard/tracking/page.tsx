"use client";

import { useEffect, useState, useCallback } from "react";
import FollowUpButton from "./FollowUpButton";

const DEVICE_ICON: Record<string, string> = { mobile: "📱", desktop: "💻", tablet: "📟" };
const OS_ICON: Record<string, string> = { iOS: "🍎", macOS: "🍎", Windows: "🪟", Android: "🤖", Linux: "🐧" };

type EmailOpen = {
  id: string; ip?: string; city?: string; region?: string; country?: string;
  device?: string; os?: string; browser?: string; isSelf: boolean; openedAt: string;
};
type Email = {
  id: string; trackingId: string; subject: string; toEmail?: string; sentAt?: string;
  openedAt?: string; openCount: number; isFollowUp: boolean;
  followUpSent: boolean; followUpSentAt?: string;
  contact: { name?: string; email: string; company?: string } | null;
  resume?: { name: string; opens: { id: string; openedAt: string }[] } | null;
  opens: EmailOpen[];
};

function isGmailProxy(open: EmailOpen) {
  return open.browser === "Gmail" || open.browser === "Gmail Prefetch";
}

export default function TrackingPage() {
  const [emails, setEmails] = useState<Email[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [markingId, setMarkingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/emails");
      if (res.ok) { setEmails(await res.json()); setLastRefresh(new Date()); }
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);

  async function markSelf(openId: string) {
    setMarkingId(openId);
    try {
      await fetch(`/api/opens/${openId}`, { method: "PATCH" });
      await load();
    } finally { setMarkingId(null); }
  }

  const totalSent   = emails.length;
  const totalOpened = emails.filter((e) => e.opens.some((o) => !o.isSelf)).length;
  const openRate    = totalSent > 0 ? Math.round((totalOpened / totalSent) * 100) : 0;

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-7 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Tracking</h1>
          <p className="text-white/40 text-sm mt-1">Real-time opens, devices, and locations.</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-white/30">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          {lastRefresh
            ? `Live · ${lastRefresh.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
            : "Loading…"}
          <button onClick={load} className="ml-2 text-blue-400/60 hover:text-blue-400 transition-colors">↻</button>
        </div>
      </div>

      {/* Stats */}
      <div className="flex gap-4 mb-7">
        {[
          { label: "Sent",      val: totalSent },
          { label: "Opened",    val: totalOpened },
          { label: "Open Rate", val: `${openRate}%` },
        ].map(({ label, val }) => (
          <div key={label} className="glass-card px-5 py-4 flex-1 text-center">
            <div className="text-2xl font-bold text-white">{val}</div>
            <div className="text-white/40 text-xs mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* Gmail proxy notice */}
      <div className="mb-5 px-4 py-3 rounded-xl border border-white/8 bg-white/3 text-xs text-white/40 flex gap-2 items-start">
        <span className="text-base shrink-0 mt-0.5">ℹ️</span>
        <span>
          <span className="text-white/60 font-medium">About Gmail tracking: </span>
          Gmail routes all image loads through Google&apos;s proxy servers (Mountain View / Denver).
          Location and device info shown for Gmail opens reflects Google&apos;s servers, not your recipient&apos;s real location or device.
          If you see your own open, use <span className="text-white/70">"This was me"</span> to exclude it.
        </span>
      </div>

      {loading ? (
        <div className="glass-card p-12 text-center text-white/30 text-sm">Loading…</div>
      ) : emails.length === 0 ? (
        <div className="glass-card p-12 text-center text-white/35">
          No emails tracked yet.{" "}
          <a href="/dashboard/compose" className="text-blue-400 underline">Send your first one →</a>
        </div>
      ) : (
        <div className="space-y-3">
          {emails.map((email) => {
            const realOpens  = email.opens.filter((o) => !o.isSelf);
            const selfOpens  = email.opens.filter((o) => o.isSelf);
            const canFollowUp = !email.isFollowUp && !email.followUpSent && realOpens.length > 0;
            const allProxy = realOpens.length > 0 && realOpens.every((o) => isGmailProxy(o));
            const displayName = email.contact?.name ?? email.contact?.email ?? email.toEmail ?? "Unknown";

            return (
              <div key={email.id} className="glass-card p-5">
                {/* Header row */}
                <div className="flex items-start gap-4 mb-4">
                  <div className="w-9 h-9 rounded-xl bg-white/8 flex items-center justify-center text-sm font-bold text-white/60 shrink-0">
                    {displayName[0]?.toUpperCase() ?? "?"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-white font-semibold text-sm">{displayName}</span>
                      {email.contact?.company && <span className="text-white/35 text-xs">@ {email.contact.company}</span>}
                      {email.isFollowUp && <span className="stat-badge">Follow-up</span>}
                      {realOpens.length > 0 ? (
                        <span className="flex items-center gap-1 text-emerald-400 text-xs font-medium">
                          <span className="open-dot" /> Opened {realOpens.length}×
                        </span>
                      ) : (
                        <span className="text-white/30 text-xs">Not opened yet</span>
                      )}
                      {selfOpens.length > 0 && (
                        <span className="text-white/25 text-xs">({selfOpens.length} self-excluded)</span>
                      )}
                      {allProxy && (
                        <span
                          className="text-amber-400/70 text-xs font-medium"
                          title="All opens went through Gmail's proxy — real device/location can't be confirmed"
                        >
                          ⚠ Open status may be unreliable
                        </span>
                      )}
                    </div>
                    <div className="text-white/45 text-xs mt-0.5 truncate">{email.subject}</div>
                  </div>
                  <div className="text-right text-xs text-white/30 shrink-0">
                    {email.sentAt
                      ? new Date(email.sentAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
                      : "—"}
                  </div>
                </div>

                {/* Open events */}
                {email.opens.length > 0 && (
                  <div className="ml-13 space-y-1.5 mb-4">
                    {email.opens.slice(0, 6).map((open) => {
                      const viaProxy = isGmailProxy(open);
                      return (
                        <div
                          key={open.id}
                          className={`flex items-center gap-2 text-xs rounded-xl px-3 py-2 ${
                            open.isSelf
                              ? "bg-white/2 text-white/25 line-through"
                              : "bg-white/4 text-white/55"
                          }`}
                        >
                          {/* Device / OS */}
                          {viaProxy ? (
                            <span title="Opened via Gmail — device unknown">✉️</span>
                          ) : (
                            <span>{DEVICE_ICON[open.device ?? ""] ?? "💻"}</span>
                          )}

                          <span className={viaProxy ? "italic" : ""}>
                            {viaProxy
                              ? "Gmail"
                              : `${OS_ICON[open.os ?? ""] ?? ""} ${open.os ?? "Unknown"}`}
                          </span>

                          <span className="text-white/20">·</span>

                          {/* Location */}
                          {viaProxy ? (
                            <span className="italic text-white/35" title="Location is Google's proxy server, not your recipient">
                              {open.city && open.country ? `${open.city}, ${open.country}` : "via Google proxy"}
                              <span className="ml-1 text-white/20 not-italic">(proxy)</span>
                            </span>
                          ) : (
                            <span>
                              {open.city && open.country
                                ? `${open.city}, ${open.country}`
                                : open.country ?? "Location unknown"}
                            </span>
                          )}

                          <span className="text-white/20">·</span>

                          {/* Time */}
                          <span>
                            {new Date(open.openedAt).toLocaleString("en-US", {
                              month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                            })}
                          </span>

                          {/* "This was me" button — only on non-self opens */}
                          {!open.isSelf && (
                            <button
                              onClick={() => markSelf(open.id)}
                              disabled={markingId === open.id}
                              className="ml-auto shrink-0 text-white/20 hover:text-red-400/70 text-xs transition-colors disabled:opacity-40 whitespace-nowrap"
                              title="Mark this as your own open so it doesn't count"
                            >
                              {markingId === open.id ? "…" : "This was me ×"}
                            </button>
                          )}
                        </div>
                      );
                    })}
                    {email.opens.length > 6 && (
                      <div className="text-white/25 text-xs px-3">+{email.opens.length - 6} more</div>
                    )}
                  </div>
                )}

                {/* Resume opens */}
                {email.resume && (
                  <div className="ml-13 mb-4">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-white/40">📄 {email.resume.name}:</span>
                      {email.resume.opens.length > 0 ? (
                        <span className="text-amber-400 font-medium">Viewed {email.resume.opens.length}×</span>
                      ) : (
                        <span className="text-white/30">Not viewed yet</span>
                      )}
                    </div>
                  </div>
                )}

                {/* Follow-up */}
                {canFollowUp && (
                  <div className="ml-13">
                    <FollowUpButton
                      emailId={email.id}
                      recipientName={displayName}
                      originalSubject={email.subject}
                    />
                  </div>
                )}
                {email.followUpSent && (
                  <div className="ml-13 text-white/30 text-xs">
                    ✓ Follow-up sent{email.followUpSentAt ? ` ${new Date(email.followUpSentAt).toLocaleDateString()}` : ""}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
