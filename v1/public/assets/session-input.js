export class SessionInputError extends Error {
  constructor(code) {
    super(code);
    this.name = 'SessionInputError';
    this.code = code;
  }
}

function stripOpeningFence(value) {
  if (!value.startsWith('```')) return value;
  const lineEnd = value.indexOf('\n');
  if (lineEnd < 0) throw new SessionInputError('invalid_session_json');
  const language = value.slice(3, lineEnd).trim().toLowerCase();
  if (language && language !== 'json') throw new SessionInputError('invalid_session_json');
  return value.slice(lineEnd + 1).trimStart();
}

// Accept one complete top-level JSON object. Text copied after that object (for
// example an extension label or a closing Markdown fence) is ignored, while
// leading labels and partial JSON fail closed so we never guess where secrets
// begin.
export function parseSessionInput(raw) {
  let text = String(raw ?? '').replace(/^\uFEFF/, '').trim();
  text = stripOpeningFence(text);
  if (!text.startsWith('{')) throw new SessionInputError('invalid_session_json');

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth < 0) throw new SessionInputError('invalid_session_json');
      if (depth === 0) {
        let value;
        try {
          value = JSON.parse(text.slice(0, index + 1));
        } catch {
          throw new SessionInputError('invalid_session_json');
        }
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          throw new SessionInputError('invalid_session_json');
        }
        return {
          value,
          canonical: JSON.stringify(value),
          hadTrailingText: Boolean(text.slice(index + 1).trim())
        };
      }
    }
  }
  throw new SessionInputError('invalid_session_json');
}
