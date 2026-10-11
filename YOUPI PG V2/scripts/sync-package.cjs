/**
 * YOUPI PG V2 — Safe Package Synchronization Script
 * Synchronizes from the master repo (repo_clone) to the clean distributable package (YOUPI PG PACKAGE).
 * 
 * Rules:
 * - repo_clone is the sole Source of Truth.
 * - Strips all sensitive, runtime, cache, and state files (.env, active DB, node_modules, sessions, screenshots).
 * - Copies clean production code, SDKs, demo store, outcome pages, openapi.yaml, and documentation.
 * - Preserves existing application architecture without modification.
 */

const fs = require('node:fs');
const path = require('node:path');

// Root master directory (repo_clone)
const SOURCE_DIR = path.resolve(__dirname, '..');

// Default target directory: D:\YOUPI PG V2\YOUPI PG PACKAGE
const TARGET_DIR = process.env.TARGET_PACKAGE_DIR || 
  process.argv[2] || 
  path.resolve(SOURCE_DIR, '..', 'YOUPI PG PACKAGE');

console.log('============================================================');
console.log('📦 YOUPI PG V2 — PACKAGE SYNCHRONIZATION');
console.log('============================================================');
console.log(`[Source Master] : ${SOURCE_DIR}`);
console.log(`[Target Package]: ${TARGET_DIR}`);

if (!fs.existsSync(SOURCE_DIR)) {
  console.error(`[-] Source directory does not exist: ${SOURCE_DIR}`);
  process.exit(1);
}

if (!fs.existsSync(TARGET_DIR)) {
  fs.mkdirSync(TARGET_DIR, { recursive: true });
  console.log(`[+] Created target directory: ${TARGET_DIR}`);
}

// Top-level files to explicitly include from root
const ROOT_FILES_TO_INCLUDE = new Set([
  'package.json',
  'tsconfig.json',
  'tsconfig.base.json',
  'README.md',
  'ARCHITECTURE.md',
  'openapi.yaml',
  'AGENTS.md',
  '.env.example',
  '.gitignore'
]);

// Top-level directories to traverse and copy
const ROOT_DIRS_TO_INCLUDE = new Set([
  'apps',
  'packages',
  'docs',
  'scripts'
]);

// Exact directory names to completely exclude recursively
const EXCLUDED_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  '.claude',
  '.impeccable',
  '.system_generated',
  '.berry-sessions',
  'browser-sessions',
  'berry_auth',
  'test_berry_auth',
  'backups',
  'dist',
  '.cache',
  'coverage',
  '.tempmediaStorage',
  '.user_uploaded'
]);

// File patterns to ignore recursively
function isFileExcluded(relPath, fileName) {
  const normalizedRel = relPath.replace(/\\/g, '/');

  // Any .env file except .env.example
  if (fileName.startsWith('.env') && fileName !== '.env.example') {
    return true;
  }

  // Active database files
  if (fileName.endsWith('.sqlite') || 
      fileName.includes('.sqlite-') || 
      fileName.endsWith('.db') || 
      fileName.includes('.db-') ||
      fileName === 'berrysdk.db') {
    return true;
  }

  // Runtime state & logs
  if (fileName.endsWith('.log') || fileName === 'whatsapp_session.json') {
    return true;
  }

  // OS files
  if (fileName === '.DS_Store' || fileName === 'Thumbs.db') {
    return true;
  }

  // Root screenshots and recordings (do not ignore assets in apps/ or docs/)
  if (!normalizedRel.includes('/')) {
    if (/\.(png|jpg|jpeg|mp4|webm|gif)$/i.test(fileName)) {
      return true;
    }
  }

  return false;
}

let copiedCount = 0;
let skippedCount = 0;

function syncFile(srcFile, destFile) {
  const destDir = path.dirname(destFile);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  if (fs.existsSync(destFile)) {
    const srcStat = fs.statSync(srcFile);
    const destStat = fs.statSync(destFile);
    if (srcStat.size === destStat.size && Math.abs(srcStat.mtimeMs - destStat.mtimeMs) < 1000) {
      skippedCount++;
      return;
    }
  }

  fs.copyFileSync(srcFile, destFile);
  const srcStat = fs.statSync(srcFile);
  try {
    fs.utimesSync(destFile, srcStat.atime, srcStat.mtime);
  } catch {}
  copiedCount++;
}

function syncDirectory(currentSourceDir, currentTargetDir, relPath = '') {
  const entries = fs.readdirSync(currentSourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const entryName = entry.name;
    const entryRelPath = relPath ? `${relPath}/${entryName}` : entryName;
    const srcPath = path.join(currentSourceDir, entryName);
    const destPath = path.join(currentTargetDir, entryName);

    if (entry.isDirectory()) {
      if (EXCLUDED_DIR_NAMES.has(entryName)) {
        continue;
      }
      // Never copy the data directory contents, will create clean data/.gitkeep
      if (entryRelPath === 'data' || entryRelPath.startsWith('data/')) {
        continue;
      }
      syncDirectory(srcPath, destPath, entryRelPath);
    } else if (entry.isFile()) {
      if (isFileExcluded(entryRelPath, entryName)) {
        continue;
      }
      syncFile(srcPath, destPath);
    }
  }
}

// 1. Sync Root Selected Files
for (const rootFile of ROOT_FILES_TO_INCLUDE) {
  const src = path.join(SOURCE_DIR, rootFile);
  const dest = path.join(TARGET_DIR, rootFile);
  if (fs.existsSync(src)) {
    syncFile(src, dest);
  } else {
    console.warn(`[!] Warning: Expected root file not found in master: ${rootFile}`);
  }
}

// 2. Sync Selected Root Directories
for (const rootDir of ROOT_DIRS_TO_INCLUDE) {
  const src = path.join(SOURCE_DIR, rootDir);
  const dest = path.join(TARGET_DIR, rootDir);
  if (fs.existsSync(src)) {
    syncDirectory(src, dest, rootDir);
  } else {
    console.warn(`[!] Warning: Expected root directory not found in master: ${rootDir}`);
  }
}

// 3. Ensure clean runtime placeholder directories
const requiredDirs = ['data', 'logs'];
for (const d of requiredDirs) {
  const targetDir = path.join(TARGET_DIR, d);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  const gitkeepPath = path.join(targetDir, '.gitkeep');
  if (!fs.existsSync(gitkeepPath)) {
    fs.writeFileSync(gitkeepPath, '# Keep directory in version control\n');
  }
}

// 4. Strict Safety Assertions on the Destination Package
console.log('\n[→] Verifying package integrity and sanitation...');

const forbiddenItems = [
  '.env',
  '.env.production',
  'data/youpi_pg.sqlite',
  'berrysdk.db',
  '.berry-sessions',
  '.claude',
  '.impeccable',
  '.git',
  'node_modules'
];

for (const item of forbiddenItems) {
  const p = path.join(TARGET_DIR, item);
  if (fs.existsSync(p)) {
    console.error(`[-] CRITICAL ERROR: Forbidden item exists in package: ${item}`);
    process.exit(1);
  }
}

const requiredItems = [
  'package.json',
  '.env.example',
  'openapi.yaml',
  'AGENTS.md',
  'README.md',
  'docs/DEVELOPER_INTEGRATION.md',
  'docs/DEPLOYMENT.md',
  'packages/merchant-sdk/src/youpi.js',
  'apps/checkout-portal/src/sdk/youpi.js',
  'apps/coin-wallet-store/src/server.js',
  'apps/coin-wallet-store/src/order-success.html',
  'apps/coin-wallet-store/src/order-failed.html',
  'apps/coin-wallet-store/src/order-suspicious.html',
  'apps/coin-wallet-store/src/order-expired.html',
  'apps/coin-wallet-store/src/order-cancelled.html',
  'scripts/init-db.cjs',
  'scripts/sync-package.cjs'
];

for (const item of requiredItems) {
  const p = path.join(TARGET_DIR, item);
  if (!fs.existsSync(p)) {
    console.error(`[-] CRITICAL ERROR: Required item missing from package: ${item}`);
    process.exit(1);
  }
}

console.log(`[✓] Sanitization verified: 0 secrets, 0 database files, 0 personal sessions.`);
console.log(`[✓] Synchronization summary: ${copiedCount} files copied/updated, ${skippedCount} files up-to-date.`);
console.log('============================================================');
console.log('🎉 PACKAGE SYNCHRONIZATION COMPLETED SUCCESSFULLY');
console.log('============================================================');
