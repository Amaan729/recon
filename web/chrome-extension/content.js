/**
 * MailSuite Tracker — Gmail Content Script
 *
 * Four responsibilities:
 * 1. Sync all user's sent trackingIds from server on load (covers dashboard emails too)
 * 2. Pre-register tracking pixel when compose opens → inject before send
 * 3. Update email record with actual subject/to on send (fire-and-forget)
 * 4. Detect when the sender views their own sent email → auto-mark as self-open
 */

let config = { apiKey: "", dashboardUrl: "http://localhost:3001" };
let observing = false;

// Map of trackingId → sentAt (ms) for every email we've sent
// Populated from chrome.storage.local AND synced from the server on load.
let sentEmails = {};

chrome.storage.local.get(["ms_sent"], (data) => {
  sentEmails = data.ms_sent || {};
  // Prune entries older than 30 days
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  let pruned = false;
  Object.keys(sentEmails).forEach((tid) => {
    if (sentEmails[tid] < cutoff) { delete sentEmails[tid]; pruned = true; }
  });
  if (pruned) chrome.storage.local.set({ ms_sent: sentEmails });
});

chrome.storage.sync.get(["apiKey", "dashboardUrl"], (data) => {
  if (data.apiKey)       config.apiKey       = data.apiKey;
  if (data.dashboardUrl) config.dashboardUrl = data.dashboardUrl.replace(/\/$/, "");
  if (config.apiKey) {
    // Sync ALL user's sent trackingIds so dashboard-sent emails are also
    // recognised as "mine" for self-open detection
    syncSentIds();
    setInterval(syncSentIds, 5 * 60 * 1000); // re-sync every 5 min
    startObserving();
    startSelfOpenDetection();
  }
});

// ── 0. Server-side sync of sent trackingIds ───────────────────────────────────

async function syncSentIds() {
  if (!config.apiKey) return;
  try {
    const res = await fetch(
      `${config.dashboardUrl}/api/extension/sent-ids?key=${encodeURIComponent(config.apiKey)}`
    );
    if (!res.ok) return;
    const { ids } = await res.json();
    // Merge server ids into local map (server is authoritative for dashboard emails)
    Object.assign(sentEmails, ids);
    chrome.storage.local.set({ ms_sent: sentEmails });
  } catch {
    // non-critical, will retry next interval
  }
}

// ── 1. Compose window detection ───────────────────────────────────────────────

function startObserving() {
  if (observing) return;
  observing = true;

  const observer = new MutationObserver(() => {
    document.querySelectorAll('[data-testid="compose-window"], .aDh, [role="dialog"]').forEach((compose) => {
      if (compose.dataset.msTracked) return;
      compose.dataset.msTracked = "1";
      attachToCompose(compose);
    });
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

function attachToCompose(compose) {
  let trackingId = null;
  let registered = false;

  // Badge
  const badge = document.createElement("div");
  badge.style.cssText = `
    position:absolute; bottom:8px; left:12px; z-index:9999;
    font-size:10px; color:rgba(255,255,255,0.5);
    background:rgba(37,99,235,0.7); border-radius:6px;
    padding:2px 7px; pointer-events:none; letter-spacing:0.3px;
    backdrop-filter:blur(4px);
  `;
  badge.textContent = "● Tracking ON";
  const footer = compose.querySelector(".btC, .gU.Up, [data-tooltip='More options']")?.parentElement;
  if (footer) { footer.style.position = "relative"; footer.appendChild(badge); }

  // Pre-register when compose opens → inject pixel immediately
  async function preRegister() {
    if (!config.apiKey || registered) return;
    registered = true;
    try {
      const res = await fetch(`${config.dashboardUrl}/api/extension`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ extensionKey: config.apiKey, to: "", subject: "" }),
      });
      if (res.ok) {
        const data = await res.json();
        trackingId = data.trackingId;
        // Remember this email as ours so we can detect self-opens
        sentEmails[trackingId] = Date.now();
        chrome.storage.local.set({ ms_sent: sentEmails });
        injectPixel(compose, data.pixelUrl);
      }
    } catch {
      registered = false;
    }
  }

  preRegister();

  // On send: update record with real subject/to (non-blocking, doesn't delay Gmail)
  const sendObserver = new MutationObserver(() => {
    const sendBtn = compose.querySelector('[data-tooltip*="Send"], [aria-label*="Send"]');
    if (sendBtn && !sendBtn.dataset.msHooked) {
      sendBtn.dataset.msHooked = "1";
      sendBtn.addEventListener("click", () => {
        if (!trackingId || !config.apiKey) return;
        const subject = extractSubject(compose);
        const to      = extractTo(compose);
        fetch(`${config.dashboardUrl}/api/extension`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ extensionKey: config.apiKey, trackingId, to, subject }),
        }).catch(() => {});
      });
    }
  });
  sendObserver.observe(compose, { childList: true, subtree: true });
}

/** Extract subject from Gmail compose */
function extractSubject(compose) {
  const el = compose.querySelector('input[name="subjectbox"], [name="subjectbox"], input[aria-label*="Subject"]');
  return el?.value?.trim() ?? "";
}

/**
 * Extract recipient email from Gmail compose.
 * Gmail renders confirmed recipients as chip spans with an [email] attribute.
 * We try several selectors in priority order, then fall back to the raw input value.
 */
function extractTo(compose) {
  // Confirmed chip — has an explicit email= attribute
  const chip = compose.querySelector('[email]');
  if (chip) return chip.getAttribute("email").trim();

  // data-hovercard-id often contains the email address directly
  const hovercard = compose.querySelector('[data-hovercard-id]');
  if (hovercard) {
    const v = hovercard.dataset.hovercardId;
    if (v && v.includes("@")) return v.trim();
  }

  // Raw "To" input (before the user tabs out to create a chip)
  const toInput = compose.querySelector(
    'input[aria-label="To"], textarea[aria-label="To"], ' +
    'input[aria-label*="recipients"], [placeholder*="recipients"]'
  );
  if (toInput && toInput.value && toInput.value.includes("@")) {
    return toInput.value.trim().split(/[\s,;]+/)[0]; // first address only
  }

  return "";
}

function injectPixel(compose, pixelUrl) {
  const body =
    compose.querySelector('[contenteditable="true"][aria-label*="Message"]') ||
    compose.querySelector('[contenteditable="true"][aria-label*="message"]') ||
    compose.querySelector('[g_editable="true"]') ||
    compose.querySelector('.Am.Al.editable') ||
    compose.querySelector('[contenteditable="true"]');
  if (!body) return;
  if (body.querySelector('[data-ms-pixel]')) return;

  const img = document.createElement("img");
  img.src = pixelUrl;
  img.setAttribute("width", "1");
  img.setAttribute("height", "1");
  img.setAttribute("data-ms-pixel", "1");
  img.setAttribute("alt", "");
  img.style.cssText = "width:1px!important;height:1px!important;opacity:0!important;border:0;overflow:hidden;";
  body.appendChild(img);
}

// ── 3. Self-open detection ────────────────────────────────────────────────────
// Watches Gmail's reading pane. When you open one of your own sent emails,
// it finds the tracking pixel (via data-ms-pixel attribute or decoded proxy URL),
// identifies the trackingId, and calls the API to mark that open as self.

function startSelfOpenDetection() {
  const seen = new Set(); // avoid duplicate API calls per session

  const detector = new MutationObserver(() => {
    // Look for our pixel marker — Gmail preserves data- attributes in the reading pane
    document.querySelectorAll('img[data-ms-pixel="1"]').forEach((img) => {
      if (seen.has(img)) return;
      seen.add(img);

      const src = img.getAttribute("src") || img.src || "";
      let tid = null;

      // Case 1: Gmail didn't rewrite the src (e.g. in some compose previews)
      const direct = src.match(/\/api\/track\/([^/]+)\/pixel\.gif/);
      if (direct) tid = direct[1];

      // Case 2: Gmail rewrote to Google proxy — try to decode
      if (!tid && src.includes("googleusercontent.com/proxy/")) {
        tid = decodeProxyUrl(src);
      }

      // Case 3: No src match — use the most recent sent email within 2 min
      // (covers the compose-preview case where the pixel fires immediately)
      if (!tid) {
        const recent = Object.entries(sentEmails)
          .filter(([, ts]) => Date.now() - Number(ts) < 2 * 60 * 1000)
          .map(([id]) => id);
        if (recent.length === 1) tid = recent[0];
      }

      // Only mark as self if this trackingId belongs to us
      if (tid && sentEmails[tid] && config.apiKey) {
        markSelfOpen(tid);
      }
    });
  });

  detector.observe(document.body, { childList: true, subtree: true });
}

function decodeProxyUrl(proxyUrl) {
  try {
    const match = proxyUrl.match(/\/proxy\/([A-Za-z0-9_\-]+)/);
    if (!match) return null;
    const encoded = match[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded  = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=");
    const decoded = atob(padded);
    const tid     = decoded.match(/\/api\/track\/([^/]+)\/pixel\.gif/);
    return tid ? tid[1] : null;
  } catch {
    return null;
  }
}

function markSelfOpen(trackingId) {
  if (!config.apiKey) return;
  fetch(`${config.dashboardUrl}/api/extension/self`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ extensionKey: config.apiKey, trackingId }),
  }).catch(() => {});
}
