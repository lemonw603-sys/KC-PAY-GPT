import { randomBytes } from 'node:crypto';
import { chmod, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashAdminPassword } from '../src/security/admin-session.js';

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
let password = Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');

if (password.includes('\n') || password.includes('\r')) {
  throw new Error('Admin password must be a single line');
}
if (password.length < 12 || password.length > 256) {
  throw new Error('Admin password must contain 12 to 256 characters');
}

const passwordHash = await hashAdminPassword(password);
password = '';
const sessionSecret = randomBytes(32).toString('base64');
const v1Root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.join(v1Root, '.env.admin.local');
const content = [
  `ADMIN_PASSWORD_HASH=${passwordHash}`,
  `ADMIN_SESSION_SECRET_BASE64=${sessionSecret}`,
  ''
].join('\n');

await writeFile(outputPath, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
await chmod(outputPath, 0o600);
console.log('Admin credentials configured in v1/.env.admin.local');
