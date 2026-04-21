const apiKeyEl     = document.getElementById("apiKey");
const dashUrlEl    = document.getElementById("dashboardUrl");
const saveBtn      = document.getElementById("saveBtn");
const statusBar    = document.getElementById("statusBar");
const statusDot    = document.getElementById("statusDot");
const statusText   = document.getElementById("statusText");
const savedMsg     = document.getElementById("savedMsg");
const dashLink     = document.getElementById("dashboardLink");

// ─── Load saved config ───────────────────────────────────────────────────────
chrome.storage.sync.get(["apiKey", "dashboardUrl"], (data) => {
  if (data.apiKey)       apiKeyEl.value  = data.apiKey;
  if (data.dashboardUrl) dashUrlEl.value = data.dashboardUrl;

  const url = data.dashboardUrl?.replace(/\/$/, "") || "http://localhost:3001";
  dashLink.href = url;
  dashLink.onclick = (e) => { e.preventDefault(); chrome.tabs.create({ url }); };

  if (data.apiKey) {
    verifyKey(data.apiKey, url);
  } else {
    setStatus("empty", "Enter your API key to activate tracking");
  }
});

// ─── Save button ─────────────────────────────────────────────────────────────
saveBtn.addEventListener("click", async () => {
  const key = apiKeyEl.value.trim();
  const url = dashUrlEl.value.trim().replace(/\/$/, "") || "http://localhost:3001";

  if (!key) {
    setStatus("disconnected", "API key is required");
    return;
  }

  setStatus("empty", "Verifying…");
  saveBtn.disabled = true;

  const ok = await verifyKey(key, url);

  if (ok) {
    chrome.storage.sync.set({ apiKey: key, dashboardUrl: url });
    dashLink.href = url;
    dashLink.onclick = (e) => { e.preventDefault(); chrome.tabs.create({ url }); };
    flash("✓ Saved & activated");
  }

  saveBtn.disabled = false;
});

// ─── Verify key against dashboard ────────────────────────────────────────────
async function verifyKey(key, baseUrl) {
  try {
    const res = await fetch(`${baseUrl}/api/extension`, {
      method: "GET",
      headers: { "x-extension-key": key },
    });
    if (res.ok) {
      setStatus("connected", "Tracking active — opens tracked silently");
      return true;
    } else {
      setStatus("disconnected", "Invalid API key — check Dashboard → Settings");
      return false;
    }
  } catch {
    setStatus("disconnected", "Cannot reach dashboard — is it running?");
    return false;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function setStatus(type, text) {
  statusBar.className = `status-bar ${type}`;
  statusText.textContent = text;

  statusDot.className = "dot";
  if (type === "connected")    statusDot.classList.add("green");
  else if (type === "disconnected") statusDot.classList.add("red");
  else statusDot.classList.add("grey");
}

function flash(msg) {
  savedMsg.textContent = msg;
  savedMsg.style.opacity = "1";
  setTimeout(() => { savedMsg.style.opacity = "0"; }, 2500);
}
