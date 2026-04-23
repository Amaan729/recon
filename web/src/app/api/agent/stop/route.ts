import { NextResponse } from "next/server"

export async function POST() {
  try {
    const agentUrl = process.env.AGENT_URL ?? "http://localhost:8000"
    const res = await fetch(`${agentUrl}/agent/stop`, { method: "POST" })
    if (!res.ok) throw new Error(`Agent returned ${res.status}`)
    return NextResponse.json({ status: "ok" })
  } catch (error) {
    console.error("Failed to stop agent:", error)
    return NextResponse.json({ error: "Failed to stop agent" }, { status: 500 })
  }
}
