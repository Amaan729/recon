"use client"

import { useCallback, useEffect, useState } from "react"

type InstagramPost = {
  id: string
  postUrl: string
  caption: string | null
  companyMentioned: string | null
  postedAt: string | null
  scrapedAt: string
  imageUrl: string | null
}

type ReferralsResponse = {
  posts: InstagramPost[]
  nextCursor: string | null
}

const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
})

function formatPostedDate(value: string | null) {
  if (!value) return "Unknown date"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Unknown date"
  return DATE_FORMATTER.format(date)
}

function captionSnippet(caption: string | null) {
  if (!caption) return "No caption available."
  return caption.length > 120 ? `${caption.slice(0, 120)}…` : caption
}

export default function ReferralsPage() {
  const [posts, setPosts] = useState<InstagramPost[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)

  const fetchPosts = useCallback(async (cursor?: string | null) => {
    const params = new URLSearchParams({ limit: "20" })
    if (cursor) {
      params.set("cursor", cursor)
    }

    const response = await fetch(`/api/referrals?${params.toString()}`, {
      cache: "no-store",
    })
    if (!response.ok) {
      throw new Error("Failed to fetch referrals")
    }
    return await response.json() as ReferralsResponse
  }, [])

  useEffect(() => {
    let cancelled = false

    const loadInitial = async () => {
      try {
        const data = await fetchPosts()
        if (cancelled) return
        setPosts(data.posts)
        setNextCursor(data.nextCursor)
      } catch {
        if (cancelled) return
        setPosts([])
        setNextCursor(null)
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void loadInitial()

    return () => {
      cancelled = true
    }
  }, [fetchPosts])

  const handleLoadMore = async () => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const data = await fetchPosts(nextCursor)
      setPosts(prev => [...prev, ...data.posts])
      setNextCursor(data.nextCursor)
    } catch {
      setNextCursor(null)
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <div className="p-8 max-w-7xl space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-white">Referrals</h1>
          </div>
          <p className="text-white/40 text-sm mt-1">
            Companies hiring from Instagram
          </p>
        </div>

        <div className="stat-badge">
          {posts.length}
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }, (_, index) => (
            <div
              key={index}
              className="relative min-h-[220px] overflow-hidden rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl animate-pulse"
            >
              <div className="absolute -right-10 top-4 h-28 w-28 rounded-full bg-white/8 blur-3xl" />
              <div className="relative flex h-full flex-col justify-end gap-3 p-5">
                <div className="h-5 w-1/2 rounded-md bg-white/10" />
                <div className="space-y-2">
                  <div className="h-3 w-full rounded-md bg-white/8" />
                  <div className="h-3 w-4/5 rounded-md bg-white/8" />
                </div>
                <div className="h-3 w-1/3 rounded-md bg-white/8" />
                <div className="h-8 w-24 rounded-lg border border-white/10 bg-white/5" />
              </div>
            </div>
          ))}
        </div>
      ) : posts.length === 0 ? (
        <div className="glass-card p-16 text-center">
          <div className="text-5xl mb-4 opacity-20 select-none">◎</div>
          <div className="text-white/40 text-sm">
            No referral posts scraped yet. Run the Instagram scraper to populate.
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {posts.map(post => (
              <ReferralCard key={post.id} post={post} />
            ))}
          </div>

          {nextCursor !== null && (
            <div className="flex justify-center pt-2">
              <button
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="inline-flex items-center gap-2 rounded-xl border border-white/12 bg-white/6 px-4 py-2 text-sm font-medium text-white/75 backdrop-blur-xl transition-all hover:border-white/24 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loadingMore && (
                  <span className="h-4 w-4 rounded-full border-2 border-white/25 border-t-white/80 animate-spin" />
                )}
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function ReferralCard({ post }: { post: InstagramPost }) {
  return (
    <div className="relative min-h-[240px] overflow-hidden rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl">
      {post.imageUrl && (
        <>
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${post.imageUrl})` }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
        </>
      )}

      <div className="absolute -right-10 top-3 h-32 w-32 rounded-full bg-blue-400/12 blur-3xl" />

      <div className="relative flex h-full min-h-[240px] flex-col justify-end gap-3 p-5">
        <div className="text-white text-xl font-semibold leading-tight">
          {post.companyMentioned ?? "Unknown"}
        </div>

        <p className="text-sm leading-relaxed text-white/50">
          {captionSnippet(post.caption)}
        </p>

        <div className="text-xs text-white/35">
          {formatPostedDate(post.postedAt)}
        </div>

        <div>
          <a
            href={post.postUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/60 transition-all hover:border-white/30 hover:text-white/80"
          >
            View Post
          </a>
        </div>
      </div>
    </div>
  )
}
