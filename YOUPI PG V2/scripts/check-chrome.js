import fs from 'node:fs';

const paths = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Users\\gaura\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'
];

for (const p of paths) {
  if (fs.existsSync(p)) {
    console.log('Found Chrome at:', p);
  }
}
