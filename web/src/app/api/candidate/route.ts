import { NextRequest, NextResponse } from "next/server"

const DEFAULT_AGENT_URL = "http://localhost:8000"

function getAgentUrl() {
  return (process.env.AGENT_URL ?? DEFAULT_AGENT_URL).replace(/\/+$/, "")
}

async function readError(res: Response) {
  try {
    const data = await res.json() as { error?: unknown; message?: unknown }
    return String(data.error ?? data.message ?? `Agent returned ${res.status}`)
  } catch {
    return `Agent returned ${res.status}`
  }
}

function errorResponse(message: string, status: number, details?: unknown) {
  return NextResponse.json(
    {
      error: message,
      details,
    },
    { status }
  )
}

export async function GET() {
  try {
    const res = await fetch(`${getAgentUrl()}/candidate`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    })

    if (!res.ok) {
      return errorResponse("Failed to load candidate profile", res.status, await readError(res))
    }

    return NextResponse.json(await res.json())
  } catch (error) {
    console.error("Failed to proxy candidate profile:", error)
    return errorResponse("Failed to load candidate profile", 502)
  }
}

export async function PATCH(request: NextRequest) {
  let payload: unknown

  try {
    payload = await request.json()
  } catch {
    return errorResponse("Invalid candidate profile payload", 400)
  }

  try {
    const res = await fetch(`${getAgentUrl()}/candidate`, {
      method: "PATCH",
      signal: AbortSignal.timeout(8_000),
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      return errorResponse("Failed to save candidate profile", res.status, await readError(res))
    }

    return NextResponse.json(await res.json())
  } catch (error) {
    console.error("Failed to proxy candidate profile update:", error)
    return errorResponse("Failed to save candidate profile", 502)
  }
}
