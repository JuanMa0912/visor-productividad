export type ParsedUserAgent = {
  browser: string;
  browserVersion: string | null;
  os: string;
  device: "Escritorio" | "Móvil" | "Tablet";
};

const versionFrom = (ua: string, pattern: RegExp): string | null => {
  const match = ua.match(pattern);
  return match?.[1] ?? null;
};

export const parseUserAgent = (
  ua: string | null | undefined,
): ParsedUserAgent | null => {
  const raw = ua?.trim();
  if (!raw) return null;

  let browser = "Desconocido";
  let browserVersion: string | null = null;

  if (/EdgA?\/(\d+)/i.test(raw)) {
    browser = "Edge";
    browserVersion = versionFrom(raw, /EdgA?\/(\d+)/i);
  } else if (/OPR\/(\d+)/i.test(raw)) {
    browser = "Opera";
    browserVersion = versionFrom(raw, /OPR\/(\d+)/i);
  } else if (/Firefox\/(\d+)/i.test(raw)) {
    browser = "Firefox";
    browserVersion = versionFrom(raw, /Firefox\/(\d+)/i);
  } else if (/CriOS\/(\d+)/i.test(raw)) {
    browser = "Chrome";
    browserVersion = versionFrom(raw, /CriOS\/(\d+)/i);
  } else if (/Chrome\/(\d+)/i.test(raw) && !/Chromium/i.test(raw)) {
    browser = "Chrome";
    browserVersion = versionFrom(raw, /Chrome\/(\d+)/i);
  } else if (/Version\/(\d+)/i.test(raw) && /Safari/i.test(raw)) {
    browser = "Safari";
    browserVersion = versionFrom(raw, /Version\/(\d+)/i);
  } else if (/MSIE (\d+)/i.test(raw) || /Trident/i.test(raw)) {
    browser = "Internet Explorer";
    browserVersion = versionFrom(raw, /MSIE (\d+)/i);
  }

  let os = "Desconocido";
  if (/Windows NT 10\.0/i.test(raw)) os = "Windows 10/11";
  else if (/Windows NT 6\.3/i.test(raw)) os = "Windows 8.1";
  else if (/Windows NT 6\.2/i.test(raw)) os = "Windows 8";
  else if (/Windows NT 6\.1/i.test(raw)) os = "Windows 7";
  else if (/Windows/i.test(raw)) os = "Windows";
  else if (/iPhone|iPad|iPod/i.test(raw)) {
    const iosVer = versionFrom(raw, /OS (\d+(?:_\d+)?)/i);
    os = iosVer ? `iOS ${iosVer.replace(/_/g, ".")}` : "iOS";
  } else if (/Android/i.test(raw)) {
    const androidVer = versionFrom(raw, /Android (\d+(?:\.\d+)?)/i);
    os = androidVer ? `Android ${androidVer}` : "Android";
  } else if (/CrOS/i.test(raw)) os = "ChromeOS";
  else if (/Mac OS X|Macintosh/i.test(raw)) os = "macOS";
  else if (/Linux/i.test(raw)) os = "Linux";

  let device: ParsedUserAgent["device"] = "Escritorio";
  if (/iPad|Tablet|PlayBook/i.test(raw)) device = "Tablet";
  else if (/Mobile|iPhone|Android.*Mobile/i.test(raw)) device = "Móvil";

  return { browser, browserVersion, os, device };
};

/** Etiqueta corta para tablas: p. ej. "Chrome 131 · Windows 10/11". */
export const formatUserAgentLabel = (
  ua: string | null | undefined,
): string => {
  const parsed = parseUserAgent(ua);
  if (!parsed) return "—";

  const browserPart = parsed.browserVersion
    ? `${parsed.browser} ${parsed.browserVersion}`
    : parsed.browser;
  const parts = [browserPart, parsed.os];
  if (parsed.device !== "Escritorio") parts.push(parsed.device);
  return parts.join(" · ");
};
