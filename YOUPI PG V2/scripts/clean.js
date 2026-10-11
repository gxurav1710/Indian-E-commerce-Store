import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

const targets = ['dist', 'node_modules/.cache', 'tsconfig.tsbuildinfo'];

function cleanDir(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'dist' || entry.name === '.cache') {
        fs.rmSync(fullPath, { recursive: true, force: true });
        console.log(`Removed: ${fullPath}`);
      } else if (entry.name !== 'node_modules') {
        cleanDir(fullPath);
      }
    } else if (entry.name.endsWith('.tsbuildinfo')) {
      fs.rmSync(fullPath, { force: true });
      console.log(`Removed: ${fullPath}`);
    }
  }
}

console.log('Cleaning build artifacts and caches across workspace...');
cleanDir(root);

// Also clean Chrome browser session caches (preserves login sessions and cookies)
const browserSessionsDir = path.join(root, 'data', 'browser-sessions');
if (fs.existsSync(browserSessionsDir)) {
  const sessions = fs.readdirSync(browserSessionsDir);
  for (const session of sessions) {
    const defaultDir = path.join(browserSessionsDir, session, 'Default');
    if (fs.existsSync(defaultDir)) {
      const cacheFolders = ['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'AutofillAiModelCache'];
      for (const cf of cacheFolders) {
        const p = path.join(defaultDir, cf);
        if (fs.existsSync(p)) {
          try {
            fs.rmSync(p, { recursive: true, force: true });
            console.log(`Cleared browser cache: ${p}`);
          } catch (e) {
            console.log(`Could not clear ${p}: ${e.message}`);
          }
        }
      }
    }
  }
}

console.log('Clean complete.');
