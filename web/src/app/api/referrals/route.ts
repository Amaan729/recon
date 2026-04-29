import { NextRequest, NextResponse } from "next/server"

function getAgentUrl() {
  return (process.env.AGENT_URL ?? "http://localhost:8000").replace(/\/+$/, "")
}

export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams.toString()
    const targetUrl = query
      ? `${getAgentUrl()}/referrals?${query}`
      : `${getAgentUrl()}/referrals`

    const res = await fetch(targetUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    })

    if (!res.ok) {
      throw new Error(`Agent referrals returned ${res.status}`)
    }

    return NextResponse.json(await res.json())
  } catch (error) {
    console.error("Failed to fetch referrals from agent:", error)
    return NextResponse.json(
      { error: "Failed to fetch referrals" },
      { status: 502 }
    )
  }
}
