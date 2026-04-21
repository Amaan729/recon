"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";

export default function SettingsPage() {
  const [key, setKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";

  useEffect(() => {
    fetch("/api/extension")
      .then((r) => r.json())
      .then((d) => { setKey(d.key ?? ""); setLoading(false); });
  }, []);

  function copy(text: string) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success("Copied!");
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-7">
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-white/40 text-sm mt-1">Configure your Chrome extension and preferences.</p>
      </div>

      {/* Extension setup */}
      <div className="glass-card p-6 mb-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center text-xl">🧩</div>
          <div>
            <h2 className="text-white font-semibold text-sm">Chrome Extension Setup</h2>
            <p className="text-white/40 text-xs">Auto-tracks emails sent from Gmail with no watermarks.</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-white/45 text-xs font-semibold uppercase tracking-wider mb-2 block">Your API Key</label>
            <div className="flex gap-2">
              <input
                readOnly
                value={loading ? "Loading..." : key}
                className="flex-1 glass-input px-4 py-3 text-sm font-mono focus:outline-none"
              />
              <button onClick={() => copy(key)} className="btn-ghost px-4 py-3 text-sm shrink-0">
                {copied ? "✓" : "Copy"}
              </button>
            </div>
          </div>

          <div>
            <label className="text-white/45 text-xs font-semibold uppercase tracking-wider mb-2 block">Dashboard URL</label>
            <div className="flex gap-2">
              <input readOnly value={appUrl} className="flex-1 glass-input px-4 py-3 text-sm font-mono focus:outline-none" />
              <button onClick={() => copy(appUrl)} className="btn-ghost px-4 py-3 text-sm shrink-0">Copy</button>
            </div>
          </div>
        </div>

        <div className="mt-5 p-4 rounded-xl bg-white/4 border border-white/8 space-y-2.5 text-xs text-white/55">
          <p className="text-white/75 font-semibold text-sm mb-1">How to install the extension:</p>
          <p>1. Open Chrome → go to <span className="text-blue-400 font-mono">chrome://extensions</span></p>
          <p>2. Enable <span className="text-white/80">Developer mode</span> (top right toggle)</p>
          <p>3. Click <span className="text-white/80">Load unpacked</span> → select the <span className="text-blue-400 font-mono">chrome-extension/</span> folder from the project</p>
          <p>4. Click the extension icon → paste your API Key and Dashboard URL → Save</p>
          <p>5. Open Gmail and compose an email — tracking activates automatically 🎯</p>
        </div>
      </div>

      {/* Tracking behavior */}
      <div className="glass-card p-6">
        <h2 className="text-white font-semibold text-sm mb-4">Tracking Behavior</h2>
        <div className="space-y-3 text-sm text-white/60">
          {[
            { icon: "🛡️", label: "Self-open filtering", desc: "Opens from your own IP are detected and excluded from counts." },
            { icon: "🤖", label: "Gmail prefetch blocking", desc: "Gmail's image proxy is detected and ignored — only real opens count." },
            { icon: "📍", label: "Location tracking", desc: "City, region, and country are resolved from the opener's IP address." },
            { icon: "📱", label: "Device detection", desc: "Device type and OS are parsed from the browser user-agent." },
          ].map(({ icon, label, desc }) => (
            <div key={label} className="flex items-start gap-3 p-3 rounded-xl bg-white/4">
              <span className="text-lg shrink-0">{icon}</span>
              <div>
                <div className="text-white/80 font-medium text-xs mb-0.5">{label}</div>
                <div className="text-white/40 text-xs">{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
