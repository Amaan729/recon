// Geo + device detection for email opens

export interface OpenMeta {
  ip: string;
  city?: string;
  region?: string;
  country?: string;
  device?: string;
  os?: string;
  browser?: string;
  isSelf: boolean;
}

export async function getOpenMeta(
  request: Request,
  senderIp?: string | null
): Promise<OpenMeta> {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0].trim() ?? "unknown";

  // Parse user agent
  const ua = request.headers.get("user-agent") ?? "";
  const { device, os, browser } = parseUserAgent(ua);

  // Geo lookup (free tier, no key needed)
  let city: string | undefined;
  let region: string | undefined;
  let country: string | undefined;

  if (ip !== "unknown" && ip !== "::1" && ip !== "127.0.0.1") {
    try {
      const geo = await fetch(`http://ip-api.com/json/${ip}?fields=city,regionName,country`, {
        signal: AbortSignal.timeout(2000),
      });
      if (geo.ok) {
        const data = await geo.json() as { city?: string; regionName?: string; country?: string };
        city = data.city;
        region = data.regionName;
        country = data.country;
      }
    } catch {
      // geo lookup failed — not critical
    }
  }

  // Self-open detection: same IP as sender
  const isSelf = !!senderIp && (ip === senderIp || ip === "::1" || ip === "127.0.0.1");

  return { ip, city, region, country, device, os, browser, isSelf };
}

function parseUserAgent(ua: string): { device: string; os: string; browser: string } {
  const uaLower = ua.toLowerCase();

  let device = "desktop";
  if (/iphone|android.*mobile|mobile/i.test(ua)) device = "mobile";
  else if (/ipad|tablet/i.test(ua)) device = "tablet";

  let os = "Unknown";
  if (/iphone|ipad/i.test(ua)) os = "iOS";
  else if (/mac os x/i.test(ua)) os = "macOS";
  else if (/windows/i.test(ua)) os = "Windows";
  else if (/android/i.test(ua)) os = "Android";
  else if (/linux/i.test(ua)) os = "Linux";

  let browser = "Unknown";
  if (/edg\//i.test(ua)) browser = "Edge";
  else if (/chrome/i.test(ua)) browser = "Chrome";
  else if (/safari/i.test(ua) && !/chrome/i.test(ua)) browser = "Safari";
  else if (/firefox/i.test(ua)) browser = "Firefox";

  // Gmail image proxy — counts as a real open (Google caches the pixel,
  // so this fires once per recipient when they first open the email).
  if (uaLower.includes("googleimageproxy")) {
    browser = "Gmail";
    // device/OS are unknown through the proxy — leave as-is from UA parsing
  }

  return { device, os, browser };
}
