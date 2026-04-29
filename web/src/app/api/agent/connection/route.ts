import { NextResponse } from "next/server"
import { normalizeAgentWebSocketBaseUrl } from "@/lib/agent-connection"

function isLocalHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
}

function productionSafeWsUrl(value: string | null | undefined): string | null {
  const normalized = normalizeAgentWebSocketBaseUrl(value)
  if (!normalized) return null

  const url = new URL(normalized)
  const isProduction =
    process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production"

  if (isProduction && url.protocol === "ws:" && !isLocalHost(url.hostname)) {
    url.protocol = "wss:"
  }

  return url.toString().replace(/\/+$/, "")
}

export async function GET() {
  const wsUrl =
    productionSafeWsUrl(process.env.NEXT_PUBLIC_AGENT_WS_URL) ??
    productionSafeWsUrl(process.env.AGENT_URL) ??
    productionSafeWsUrl(process.env.NEXT_PUBLIC_AGENT_URL)

  if (!wsUrl) {
    return NextResponse.json(
      {
        wsUrl: null,
        error: "Agent websocket URL is not configured",
      },
      { status: 503 }
    )
  }

  return NextResponse.json({ wsUrl })
}
