import { auth, signOut } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";

const NAV = [
  { href: "/dashboard",          label: "Overview",    icon: "◈" },
  { href: "/dashboard/compose",  label: "Compose",     icon: "✦" },
  { href: "/dashboard/tracking", label: "Tracking",    icon: "◉" },
  { href: "/dashboard/resumes",  label: "Resumes",     icon: "◎" },
  { href: "/dashboard/contacts", label: "Contacts",    icon: "◌" },
  { href: "/dashboard/settings", label: "Settings",    icon: "◧" },
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="flex h-screen app-bg overflow-hidden">
      {/* Ambient glow orbs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] rounded-full bg-blue-600/10 blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] rounded-full bg-blue-500/8 blur-[100px]" />
      </div>

      {/* Sidebar */}
      <aside className="relative z-10 w-60 glass-sidebar flex flex-col shrink-0">
        {/* Logo */}
        <div className="px-5 py-6 border-b border-white/8">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-bold text-sm shadow-lg shadow-blue-500/30">
              M
            </div>
            <div>
              <div className="text-white font-semibold text-sm tracking-wide">MailSuite</div>
              <div className="text-white/40 text-xs">Pro</div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {NAV.map(({ href, label, icon }) => (
            <Link
              key={href}
              href={href}
              className="group flex items-center gap-3 px-3 py-2.5 rounded-xl text-white/55 hover:text-white hover:bg-white/8 transition-all duration-150 text-sm"
            >
              <span className="text-base w-5 text-center text-white/40 group-hover:text-blue-400 transition-colors">{icon}</span>
              <span className="font-medium">{label}</span>
            </Link>
          ))}
        </nav>

        {/* User */}
        <div className="p-3 border-t border-white/8">
          <div className="flex items-center gap-3 px-3 py-2 rounded-xl mb-1">
            {session.user.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={session.user.image} alt="" className="w-7 h-7 rounded-full ring-1 ring-white/20" />
            ) : (
              <div className="w-7 h-7 rounded-full bg-blue-500/30 flex items-center justify-center text-xs text-blue-300 font-bold">
                {session.user.name?.[0] ?? "?"}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-white/80 text-xs font-medium truncate">{session.user.name}</div>
              <div className="text-white/35 text-xs truncate">{session.user.email}</div>
            </div>
          </div>
          <form action={async () => { "use server"; await signOut({ redirectTo: "/login" }); }}>
            <button type="submit" className="w-full text-left px-3 py-2 text-xs text-white/35 hover:text-white/70 rounded-xl hover:bg-white/5 transition-all">
              Sign out
            </button>
          </form>
        </div>
      </aside>

      {/* Main content */}
      <main className="relative z-10 flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
