// Creates nexora-server/.env with freshly generated secrets (only if it does not exist). No dependencies.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const target = path.join(__dirname, '..', '.env');
if (fs.existsSync(target)) { console.log('.env already exists; leaving it untouched.'); process.exit(0); }
const secret = () => crypto.randomBytes(48).toString('base64url');
const content = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8')
  .replace(/^JWT_ACCESS_SECRET=.*$/m, `JWT_ACCESS_SECRET=${secret()}`)
  .replace(/^JWT_REFRESH_SECRET=.*$/m, `JWT_REFRESH_SECRET=${secret()}`);
fs.writeFileSync(target, content, { mode: 0o600 });
console.log('Created nexora-server/.env with new random JWT secrets. Check MONGODB_URI.');
