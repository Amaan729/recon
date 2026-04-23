"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { toast } from "sonner"

type LogEntry = {
  id: number
  time: string
  message: string
  kind: "action" | "status" | "complete" | "error"
}

type AgentStatus = "running" | "idle" | "error"
type ConnStatus  = "connected" | "connecting" | "disconnected"

const WS_BASE =
  (typeof window !== "undefined" && (window as any).__NEXT_DATA__)
    ? undefined
    : undefined

function nowHMS(): string {
  return new Date().toTimeString().slice(0, 8)
}

export default function AgentPage() {
  const [agentStatus, setAgentStatus] = useState<AgentStatus>("idle")
  const [connStatus,  setConnStatus]  = useState<ConnStatus>("connecting")
  const [screenshot,  setScreenshot]  = useState<string | null>(null)
  const [log,         setLog]         = useState<LogEntry[]>([])
  const [lastRun, setLastRun]         = useState<{ applied: number; failed: number } | null>(null)

  const wsRef         = useRef<WebSocket | null>(null)
  const reconnectRef  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pingRef       = useRef<ReturnType<typeof setInterval> | null>(null)
  const logEndRef     = useRef<HTMLDivElement>(null)
  const logIdRef      = useRef(0)

  const addLog = useCallback((kind: LogEntry["kind"], message: string) => {
    setLog(prev => {
      const entry: LogEntry = { id: logIdRef.current++, time: nowHMS(), message, kind }
      const next = [...prev, entry]
      return next.length > 50 ? next.slice(next.length - 50) : next
    })
  }, [])

  const handleMessage = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (msg: any) => {
      if (msg.type === "screenshot") {
        setScreenshot(`data:image/jpeg;base64,${msg.data}`)
      } else if (msg.type === "action") {
        addLog("action", msg.message)
      } else if (msg.type === "status") {
        setAgentStatus(msg.status as AgentStatus)
        addLog("status", `Status: ${msg.status}`)
      } else if (msg.type === "complete") {
        setLastRun({ applied: msg.applied, failed: msg.failed })
        addLog("complete", `Batch complete — ${msg.applied} applied, ${msg.failed} failed`)
      } else if (msg.type === "error") {
        addLog("error", msg.message ?? "Unknown error")
      }
    },
    [addLog]
  )

  const connect = useCallback(() => {
    if (reconnectRef.current) clearTimeout(reconnectRef.current)
    if (pingRef.current)      clearInterval(pingRef.current)

    const wsUrl = process.env.NEXT_PUBLIC_AGENT_WS_URL ?? "ws://localhost:8000"
    setConnStatus("connecting")

    const ws = new WebSocket(`${wsUrl}/agent/stream`)
    wsRef.current = ws

    ws.onopen = () => {
      setConnStatus("connected")
      pingRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send("ping")
      }, 30_000)
    }

    ws.onmessage = e => {
      try {
        handleMessage(JSON.parse(e.data as string))
      } catch {}
    }

    ws.onclose = () => {
      setConnStatus("disconnected")
      if (pingRef.current) clearInterval(pingRef.current)
      reconnectRef.current = setTimeout(connect, 3_000)
    }

    ws.onerror = () => ws.close()
  }, [handleMessage])

  useEffect(() => {
    connect()
    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current)
      if (pingRef.current)      clearInterval(pingRef.current)
      wsRef.current?.close()
    }
  }, [connect])

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [log])

  const handleStart = async () => {
    try {
      const res = await fetch("/api/agent/start", { method: "POST" })
      if (!res.ok) throw new Error()
    } catch {
      toast.error("Failed to start agent")
    }
  }

  const handleStop = async () => {
    try {
      const res = await fetch("/api/agent/stop", { method: "POST" })
      if (!res.ok) throw new Error()
    } catch {
      toast.error("Failed to stop agent")
    }
  }

  const isRunning = agentStatus === "running"

  const connDot = {
    connected:    "bg-emerald-400",
    connecting:   "bg-amber-400 animate-pulse",
    disconnected: "bg-red-400",
  }[connStatus]

  const statusPill = {
    running: "bg-emerald-500/15 text-emerald-300 border-emerald-500/28",
    idle:    "bg-white/8 text-white/40 border-white/12",
    error:   "bg-red-500/15 text-red-300 border-red-500/28",
  }[agentStatus]

  const statusLabel = { running: "Running", idle: "Idle", error: "Error" }[agentStatus]

  return (
    <>
      <style>{`
        @keyframes liveGlow {
          0%, 100% { box-shadow: 0 0 0 1px rgba(16,185,129,0.4), 0 0 16px rgba(16,185,129,0.12); }
          50%       { box-shadow: 0 0 0 1px rgba(16,185,129,0.6), 0 0 28px rgba(16,185,129,0.22); }
        }
        @keyframes liveDot {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.4; }
        }
      `}</style>

      <div className="p-8 max-w-7xl flex flex-col gap-6 h-screen">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 flex-wrap shrink-0">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-white">Agent</h1>
            <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${statusPill}`}>
              {statusLabel}
            </span>
            <div className="flex items-center gap-1.5 ml-1">
              <div className={`w-2 h-2 rounded-full shrink-0 ${connDot}`} />
              <span className="text-white/30 text-xs">{connStatus}</span>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {lastRun && (
              <span className="text-white/35 text-xs">
                Last run: {lastRun.applied} applied, {lastRun.failed} failed
              </span>
            )}
            <button
              onClick={handleStart}
              disabled={isRunning || connStatus !== "connected"}
              className="text-sm px-4 py-2 font-semibold rounded-xl transition-all duration-150 disabled:opacity-40
                bg-emerald-500/18 text-emerald-300 border border-emerald-500/28
                hover:bg-emerald-500/28 hover:text-emerald-200 hover:-translate-y-px
                disabled:cursor-not-allowed"
            >
              ▶ Start Agent
            </button>
            <button
              onClick={handleStop}
              disabled={!isRunning || connStatus !== "connected"}
              className="text-sm px-4 py-2 font-semibold rounded-xl transition-all duration-150 disabled:opacity-40
                bg-red-500/18 text-red-300 border border-red-500/28
                hover:bg-red-500/28 hover:text-red-200 hover:-translate-y-px
                disabled:cursor-not-allowed"
            >
              ■ Stop Agent
            </button>
          </div>
        </div>

        {/* Two-column body */}
        <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-4 flex-1 min-h-0">
          {/* Left: Screenshot */}
          <div
            className="glass-card p-4 flex flex-col gap-3 overflow-hidden"
            style={isRunning ? { animation: "liveGlow 2s ease-in-out infinite" } : {}}
          >
            <div className="flex items-center justify-between shrink-0">
              <span className="text-white/50 text-xs font-medium uppercase tracking-widest">
                Live Browser View
              </span>
              {isRunning && (
                <span
                  className="text-xs font-bold px-2 py-0.5 rounded border bg-red-500/20 text-red-300 border-red-500/35 tracking-wider"
                  style={{ animation: "liveDot 1.4s ease-in-out infinite" }}
                >
                  ● LIVE
                </span>
              )}
            </div>

            <div className="flex-1 rounded-xl overflow-hidden bg-black/30 relative flex items-center justify-center min-h-0">
              {screenshot ? (
                <button
                  className="w-full h-full focus:outline-none"
                  onClick={() => window.open(screenshot, "_blank")}
                  title="Click to open full-size"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={screenshot}
                    alt="Agent screenshot"
                    className="w-full h-full object-contain"
                  />
                </button>
              ) : (
                <div className="text-center select-none">
                  <div className="text-5xl mb-4 opacity-15">◉</div>
                  <div className="text-white/30 text-sm">
                    {connStatus === "connected"
                      ? "Waiting for agent to start…"
                      : connStatus === "connecting"
                      ? "Connecting to agent…"
                      : "Agent offline"}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right: Action log */}
          <div className="glass-card p-4 flex flex-col gap-3 overflow-hidden">
            <div className="flex items-center justify-between shrink-0">
              <span className="text-white/50 text-xs font-medium uppercase tracking-widest">
                Action Log
              </span>
              {log.length > 0 && (
                <button
                  onClick={() => setLog([])}
                  className="text-xs text-white/25 hover:text-white/60 transition-colors px-2 py-1 rounded-lg hover:bg-white/5"
                >
                  Clear
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto min-h-0 font-mono">
              {log.length === 0 ? (
                <div className="h-full flex items-center justify-center">
                  <span className="text-white/20 text-xs">No activity yet.</span>
                </div>
              ) : (
                <div className="space-y-1 pb-1">
                  {log.map(entry => (
                    <LogLine key={entry.id} entry={entry} />
                  ))}
                  <div ref={logEndRef} />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

function LogLine({ entry }: { entry: LogEntry }) {
  const msgColor = {
    action:   "text-white/60",
    status:   "text-blue-300/80",
    complete: "text-emerald-300",
    error:    "text-red-300",
  }[entry.kind]

  return (
    <div className="flex gap-2 text-xs leading-relaxed">
      <span className="text-white/20 shrink-0 tabular-nums">{entry.time}</span>
      <span className={msgColor}>{entry.message}</span>
    </div>
  )
}
