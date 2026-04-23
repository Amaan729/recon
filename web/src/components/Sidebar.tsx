"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useSession, signOut } from "next-auth/react"
import { useState } from "react"

type NavItem = {
  href: string
  label: string
  icon: string
  description?: string
}

const NAV_ITEMS: NavItem[] = [
  {
    href: "/dashboard/jobs",
    label: "Jobs Queue",
    icon: "◈",
    description: "Review and approve jobs",
  },
  {
    href: "/dashboard/applications",
    label: "Applications",
    icon: "◉",
    description: "Track submitted applications",
  },
  {
    href: "/dashboard/recruiters",
    label: "Recruiters",
    icon: "◎",
    description: "Manage outreach queue",
  },
  {
    href: "/dashboard/tracking",
    label: "Email Tracking",
    icon: "◌",
    description: "Open and click tracking",
  },
  {
    href: "/dashboard/agent",
    label: "Agent",
    icon: "◍",
    description: "Live browser view",
  },
  {
    href: "/dashboard/resume",
    label: "Resume",
    icon: "◑",
    description: "Manage resume versions",
  },
]

const SETTINGS_ITEM: NavItem = {
  href: "/dashboard/settings",
  label: "Settings",
  icon: "◐",
}

export default function Sidebar() {
  const pathname = usePathname()
  const { data: session } = useSession()
  const [mobileOpen, setMobileOpen] = useState(false)

  const isActive = (href: string) => {
    if (href === "/dashboard/jobs") return pathname === href
    return pathname.startsWith(href)
  }

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-white/8 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-white/10 border border-white/15 flex items-center justify-center text-white/80 font-bold text-xs select-none">
            ⬡
          </div>
          <div>
            <div className="text-white font-semibold text-sm tracking-[0.08em] uppercase">
              Recon
            </div>
            <div className="text-white/30 text-xs">job search engine</div>
          </div>
        </div>
      </div>

      {/* Main nav */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map(({ href, label, icon }) => {
          const active = isActive(href)
          return (
            <Link
              key={href}
              href={href}
              onClick={() => setMobileOpen(false)}
              className={`relative group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-150 ${
                active
                  ? "bg-white/10 text-white"
                  : "text-white/45 hover:text-white/70 hover:bg-white/5"
              }`}
            >
              {active && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-white/60 rounded-full" />
              )}
              <span
                className={`w-4 text-center shrink-0 transition-colors duration-150 ${
                  active ? "text-white/80" : "text-white/35 group-hover:text-white/55"
                }`}
              >
                {icon}
              </span>
              <span className="font-medium truncate">{label}</span>
            </Link>
          )
        })}
      </nav>

      {/* Bottom: settings + user */}
      <div className="shrink-0 border-t border-white/8">
        {/* Settings */}
        <div className="px-2 py-2">
          {(() => {
            const active = isActive(SETTINGS_ITEM.href)
            return (
              <Link
                href={SETTINGS_ITEM.href}
                onClick={() => setMobileOpen(false)}
                className={`relative group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-150 ${
                  active
                    ? "bg-white/10 text-white"
                    : "text-white/45 hover:text-white/70 hover:bg-white/5"
                }`}
              >
                {active && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-white/60 rounded-full" />
                )}
                <span
                  className={`w-4 text-center shrink-0 transition-colors duration-150 ${
                    active ? "text-white/80" : "text-white/35 group-hover:text-white/55"
                  }`}
                >
                  {SETTINGS_ITEM.icon}
                </span>
                <span className="font-medium">{SETTINGS_ITEM.label}</span>
              </Link>
            )
          })()}
        </div>

        {/* User */}
        <div className="px-3 py-3 border-t border-white/6">
          <div className="flex items-center gap-2.5 px-1 mb-2">
            {session?.user?.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={session.user.image}
                alt=""
                className="w-6 h-6 rounded-full ring-1 ring-white/20 shrink-0"
              />
            ) : (
              <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-xs text-white/50 font-bold shrink-0">
                {session?.user?.name?.[0] ?? "?"}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-white/60 text-xs truncate">
                {session?.user?.email ?? "—"}
              </div>
            </div>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="w-full text-left px-2 py-1.5 text-xs text-white/30 hover:text-white/60 rounded-lg hover:bg-white/5 transition-all duration-150"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className="hidden lg:flex flex-col w-[220px] shrink-0 h-screen glass-sidebar"
        style={{ position: "sticky", top: 0 }}
      >
        {sidebarContent}
      </aside>

      {/* Mobile: hamburger button */}
      <button
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed top-4 left-4 z-50 w-9 h-9 rounded-xl glass flex items-center justify-center text-white/70 hover:text-white transition-colors"
        aria-label="Open navigation"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      {/* Mobile: overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile: slide-in sidebar */}
      <aside
        className={`lg:hidden fixed top-0 left-0 z-50 w-[220px] h-full glass-sidebar transition-transform duration-250 ease-out ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Close button */}
        <button
          onClick={() => setMobileOpen(false)}
          className="absolute top-4 right-3 w-7 h-7 rounded-lg glass flex items-center justify-center text-white/50 hover:text-white transition-colors"
          aria-label="Close navigation"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
        {sidebarContent}
      </aside>
    </>
  )
}
