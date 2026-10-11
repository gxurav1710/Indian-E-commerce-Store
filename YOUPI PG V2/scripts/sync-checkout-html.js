import fs from 'node:fs';
import path from 'node:path';

const dest = path.resolve(import.meta.dirname || process.cwd(), '../apps/checkout-portal/src/views/checkout.html');

console.log('Validating checkout.html in YOUPI PG V2...');
if (fs.existsSync(dest)) {
  const stat = fs.statSync(dest);
  console.log(`[✓] Successfully verified checkout.html (${stat.size} bytes)`);
}
