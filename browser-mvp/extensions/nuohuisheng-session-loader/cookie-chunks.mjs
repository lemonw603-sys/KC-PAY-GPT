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
