export const SUPPORTED_SESSION_COOKIE_NAMES = Object.freeze([
  "__Secure-next-auth.session-token",
  "__Secure-authjs.session-token"
]);

export const DEFAULT_SESSION_COOKIE_NAME = SUPPORTED_SESSION_COOKIE_NAMES[0];

function cleanCookieValue(value) {
  let normalized = value.trim();
  if (normalized.length >= 2 && normalized.startsWith('"') && normalized.endsWith('"')) {
    normalized = normalized.slice(1, -1);
  }
  return normalized
    .replace(/[\p{White_Space}\p{Cf}]+/gu, "")
    .replace(/\\+/g, "");
}

function findSupportedCookie(input) {
  const parts = input.split(";");

  for (const part of parts) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex < 1) continue;

    const name = part.slice(0, separatorIndex).trim();
    if (!SUPPORTED_SESSION_COOKIE_NAMES.includes(name)) continue;

    return {
      name,
      value: cleanCookieValue(part.slice(separatorIndex + 1))
    };
  }

  return null;
}

function findSessionTokenDeep(node, depth = 0) {
  if (!node || typeof node !== "object" || depth > 6) return null;
  for (const [key, value] of Object.entries(node)) {
    if (/^session[_-]?token$/i.test(key) && typeof value === "string" && value.trim()) return value;
  }
  for (const value of Object.values(node)) {
    const found = findSessionTokenDeep(value, depth + 1);
    if (found) return found;
  }
  return null;
}

function findSessionTokenInJson(input) {
  if (!input.startsWith("{") && !input.startsWith("[")) return null;

  let parsed;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new Error("粘贴的 JSON 格式不完整，请重新复制全部内容。");
  }

  const token = findSessionTokenDeep(parsed);
  if (!token) {
    throw new Error("JSON 中没有 sessionToken 字段。请改为粘贴 Cookie「__Secure-next-auth.session-token」的值；accessToken 不是 Session 令牌。");
  }

  return cleanCookieValue(token);
}

export function parseSessionInput(rawInput, selectedName = "auto") {
  const input = String(rawInput ?? "").trim();

  if (!input) {
    throw new Error("请先粘贴 Session 令牌。");
  }

  if (/^(bearer\s+|sk-[a-z0-9_-]+)/i.test(input)) {
    throw new Error("这看起来是 API Key 或 Bearer Token，不是 Session 令牌。");
  }

  const jsonSessionToken = findSessionTokenInJson(input);
  const namedCookie = jsonSessionToken ? null : findSupportedCookie(input);
  const chosenName = selectedName === "auto" ? null : selectedName;

  if (chosenName && !SUPPORTED_SESSION_COOKIE_NAMES.includes(chosenName)) {
    throw new Error("不支持所选的会话类型。");
  }

  let name = chosenName || namedCookie?.name || DEFAULT_SESSION_COOKIE_NAME;
  let value = namedCookie?.value || jsonSessionToken || input;

  if (!namedCookie && input.includes("=")) {
    const firstSeparator = input.indexOf("=");
    const possibleName = input.slice(0, firstSeparator).trim();
    const possibleValue = input.slice(firstSeparator + 1);

    if (SUPPORTED_SESSION_COOKIE_NAMES.includes(possibleName)) {
      name = chosenName || possibleName;
      value = cleanCookieValue(possibleValue);
    } else if (/^[A-Za-z0-9_.-]{1,80}$/.test(possibleName)) {
      throw new Error("未识别这个 Cookie 名称，请粘贴支持的 Session Cookie。");
    }
  }

  value = cleanCookieValue(value);

  if (value.length < 20) {
    throw new Error("令牌过短，请检查是否复制完整。");
  }

  if (value.startsWith("eyJ") && value.split(".").length === 3) {
    throw new Error("这是 accessToken（JWT），不是 Session 令牌；请粘贴 Cookie「__Secure-next-auth.session-token」的值。");
  }

  if (/[^\x21-\x7E]/.test(value) || /[",;\\]/.test(value)) {
    throw new Error("令牌中仍包含浏览器不接受的字符，请只复制 Session Cookie 的值。");
  }

  return { name, value };
}
