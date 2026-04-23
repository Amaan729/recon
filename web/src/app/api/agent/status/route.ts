import { NextResponse } from "next/server"

export async function GET() {
  try {
    const agentUrl = process.env.AGENT_URL ?? "http://localhost:8000"
    const res = await fetch(`${agentUrl}/agent/status`)
    if (!res.ok) throw new Error(`Agent returned ${res.status}`)
    const data = await res.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error("Failed to fetch agent status:", error)
    return NextResponse.json({ error: "Failed to fetch agent status" }, { status: 500 })
  }
}
