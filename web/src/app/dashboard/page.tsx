import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";

export default async function DashboardPage() {
  const session = await auth();
  const userId = session!.user!.id!;

  const [contacts, emails, recentEmails] = await Promise.all([
    prisma.contact.count({ where: { userId } }),
    prisma.email.findMany({
      where: { userId, status: "sent" },
      select: { openedAt: true, openCount: true, sentAt: true },
    }),
    prisma.email.findMany({
      where: { userId, status: "sent" },
      include: {
        contact: { select: { name: true, email: true, company: true } },
        opens: { where: { isSelf: false }, orderBy: { openedAt: "desc" }, take: 1 },
      },
      orderBy: { sentAt: "desc" },
      take: 5,
    }),
  ]);

  const sent = emails.length;
  const opened = emails.filter((e) => e.openedAt !== null).length;
  const openRate = sent > 0 ? Math.round((opened / sent) * 100) : 0;
  const totalOpens = emails.reduce((s, e) => s + e.openCount, 0);

  const firstName = session!.user!.name?.split(" ")[0] ?? "there";

  return (
    <div className="p-8 max-w-5xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-1">Good day, {firstName} 👋</h1>
        <p className="text-white/45 text-sm">Here's what's happening with your emails.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { label: "Sent", value: sent, icon: "✉️", color: "from-blue-500/20 to-blue-600/10" },
          { label: "Opened", value: opened, icon: "👁️", color: "from-emerald-500/20 to-emerald-600/10" },
          { label: "Open Rate", value: `${openRate}%`, icon: "📈", color: "from-violet-500/20 to-violet-600/10" },
          { label: "Contacts", value: contacts, icon: "👤", color: "from-amber-500/20 to-amber-600/10" },
        ].map(({ label, value, icon, color }) => (
          <div key={label} className={`glass-card p-5 bg-gradient-to-br ${color}`}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-white/40 text-xs font-semibold uppercase tracking-wider">{label}</span>
              <span className="text-lg">{icon}</span>
            </div>
            <div className="text-3xl font-bold text-white">{value}</div>
            <div className="text-white/30 text-xs mt-1">{totalOpens} total opens</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Recent emails */}
        <div className="lg:col-span-3 glass-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-white font-semibold text-sm">Recent Emails</h2>
            <Link href="/dashboard/tracking" className="text-blue-400 text-xs hover:text-blue-300 transition-colors">
              View all →
            </Link>
          </div>
          {recentEmails.length === 0 ? (
            <div className="text-center py-10 text-white/30 text-sm">
              No emails sent yet.<br />
              <Link href="/dashboard/compose" className="text-blue-400 hover:text-blue-300 mt-2 inline-block">
                Send your first email →
              </Link>
            </div>
          ) : (
            <div className="space-y-1">
              {recentEmails.map((email) => (
                <div key={email.id} className="flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 transition-all cursor-default">
                  <div className="w-8 h-8 rounded-xl bg-white/8 flex items-center justify-center text-sm font-bold text-white/60 shrink-0">
                    {(email.contact?.name ?? email.contact?.email ?? "?")[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-white/85 text-sm font-medium truncate">
                        {email.contact?.name ?? email.contact?.email ?? "Unknown"}
                      </span>
                      {email.opens.length > 0 && <span className="open-dot" />}
                    </div>
                    <div className="text-white/35 text-xs truncate">{email.subject}</div>
                  </div>
                  <div className="text-right text-xs text-white/30 shrink-0">
                    {email.sentAt
                      ? new Date(email.sentAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                      : "—"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quick actions */}
        <div className="lg:col-span-2 space-y-4">
          <div className="glass-card p-5">
            <h2 className="text-white font-semibold text-sm mb-3">Quick Actions</h2>
            <div className="space-y-2">
              {[
                { href: "/dashboard/compose", label: "Send an email", icon: "✦", desc: "Track opens + follow-ups" },
                { href: "/dashboard/resumes", label: "Manage resumes", icon: "◎", desc: "Upload & track PDFs" },
                { href: "/dashboard/tracking", label: "View tracking", icon: "◉", desc: "Opens, devices, location" },
              ].map(({ href, label, icon, desc }) => (
                <Link
                  key={href}
                  href={href}
                  className="flex items-center gap-3 p-3 rounded-xl hover:bg-white/7 border border-white/6 hover:border-white/12 transition-all group"
                >
                  <div className="w-8 h-8 rounded-lg bg-blue-500/15 flex items-center justify-center text-blue-400 text-sm group-hover:bg-blue-500/25 transition-all">
                    {icon}
                  </div>
                  <div className="min-w-0">
                    <div className="text-white/80 text-sm font-medium">{label}</div>
                    <div className="text-white/35 text-xs">{desc}</div>
                  </div>
                  <span className="ml-auto text-white/25 group-hover:text-white/50 transition-colors text-sm">→</span>
                </Link>
              ))}
            </div>
          </div>

          <div className="glass-card p-5 bg-gradient-to-br from-blue-500/10 to-transparent">
            <div className="text-blue-300 text-xs font-semibold uppercase tracking-wider mb-1">Chrome Extension</div>
            <div className="text-white/70 text-sm">Auto-track emails sent from Gmail. No watermarks.</div>
            <Link href="/dashboard/settings" className="text-blue-400 text-xs mt-2 inline-block hover:text-blue-300">
              Get your API key →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
