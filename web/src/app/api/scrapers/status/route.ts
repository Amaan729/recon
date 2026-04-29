import { NextResponse } from "next/server"

function getAgentUrl() {
  return (process.env.AGENT_URL ?? "http://localhost:8000").replace(/\/+$/, "")
}

export async function GET() {
  try {
    const res = await fetch(`${getAgentUrl()}/scheduler/status`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    })

    if (!res.ok) {
      throw new Error(`Agent scheduler returned ${res.status}`)
    }

    return NextResponse.json(await res.json())
  } catch (error) {
    console.error("Failed to fetch scraper status:", error)
    return NextResponse.json(
      { error: "Failed to fetch scraper status", jobs: [] },
      { status: 502 }
    )
  }
}
