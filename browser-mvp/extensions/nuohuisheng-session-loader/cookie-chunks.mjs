export const SESSION_COOKIE_CHUNK_SIZE = 3936;

export function isSessionCookieName(name, supportedNames) {
  return supportedNames.some((base) => name === base || name.startsWith(`${base}.`));
}

export function splitSessionCookie(name, value, chunkSize = SESSION_COOKIE_CHUNK_SIZE) {
  if (!Number.isInteger(chunkSize) || chunkSize < 1) throw new TypeError("chunkSize must be positive");
  if (value.length <= chunkSize) return [{ name, value }];
  const chunks = [];
  for (let offset = 0, index = 0; offset < value.length; offset += chunkSize, index += 1) {
    chunks.push({ name: `${name}.${index}`, value: value.slice(offset, offset + chunkSize) });
  }
  return chunks;
}

// Every existing session cookie (base name or .N chunk, any domain variant) that
// must be removed before a replacement is written; chrome.cookies.remove needs
// a URL that matches the cookie's own domain and path.
export function sessionCookieRemovals(cookies, supportedNames) {
  const targets = new Map();
  for (const cookie of cookies) {
    if (!isSessionCookieName(cookie.name, supportedNames)) continue;
    const host = String(cookie.domain || "chatgpt.com").replace(/^\./, "");
    const url = `https://${host}${cookie.path || "/"}`;
    targets.set(`${url}|${cookie.name}`, { url, name: cookie.name });
  }
  return [...targets.values()];
}
