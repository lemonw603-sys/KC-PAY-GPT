import { hashAdminPassword } from '../src/security/admin-session.js';

const password = process.env.ADMIN_PASSWORD;
if (!password) {
  console.error('Set ADMIN_PASSWORD in the command environment; the password itself is never printed.');
  process.exitCode = 1;
} else {
  console.log(await hashAdminPassword(password));
}
