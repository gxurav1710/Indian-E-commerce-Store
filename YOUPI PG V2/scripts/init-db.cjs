const path = require('node:path');
const fs = require('node:fs');

async function main() {
  console.log('============================================================');
  console.log('📦 YOUPI PG — DATABASE INITIALIZATION / SETUP');
  console.log('============================================================');

  const rootDir = path.resolve(__dirname, '..');
  const dbDir = path.join(rootDir, 'data');
  const dbPath = process.env.SQLITE_DB_PATH || path.join(dbDir, 'youpi_pg.sqlite');

  console.log(`[+] Database target path: ${dbPath}`);

  if (!fs.existsSync(path.dirname(dbPath))) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    console.log(`[+] Created database directory: ${path.dirname(dbPath)}`);
  }

  // Ensure workspace packages in node_modules/@youpi are linked
  const youpiScopeDir = path.join(rootDir, 'node_modules', '@youpi');
  const packagesDir = path.join(rootDir, 'packages');
  if (fs.existsSync(packagesDir)) {
    if (!fs.existsSync(youpiScopeDir)) {
      fs.mkdirSync(youpiScopeDir, { recursive: true });
    }
    const pkgs = fs.readdirSync(packagesDir, { withFileTypes: true });
    for (const pkg of pkgs) {
      if (pkg.isDirectory()) {
        const targetPkg = path.join(packagesDir, pkg.name);
        const linkPath = path.join(youpiScopeDir, pkg.name);
        if (!fs.existsSync(linkPath)) {
          try {
            fs.symlinkSync(targetPkg, linkPath, 'junction');
          } catch {
            try {
              fs.cpSync(targetPkg, linkPath, { recursive: true });
            } catch {}
          }
        }
      }
    }
  }

  // Import packages/db dynamically
  const migratePath = path.join(rootDir, 'packages', 'db', 'src', 'migrate.js');
  const dbModulePath = path.join(rootDir, 'packages', 'db', 'src', 'database.js');
  
  const { Database } = await import('file://' + migratePath.replace(/\\/g, '/').replace('migrate.js', 'database.js'));
  const { runMigrations } = await import('file://' + migratePath.replace(/\\/g, '/'));

  console.log('[+] Connecting to SQLite database & applying schemas...');
  const db = new Database({ dbPath });
  const result = runMigrations(db);

  console.log(`[✓] Migrations applied successfully!`);
  console.log(`[✓] Default Merchant: ${result.defaultMerchant.businessName} (${result.defaultMerchant.id})`);
  
  // Verify counts
  const merchantCount = db.queryOne('SELECT COUNT(*) as count FROM merchants');
  const accountsCount = db.queryOne('SELECT COUNT(*) as count FROM payment_receiving_accounts');
  console.log(`[✓] Active Merchants: ${merchantCount.count}, Receiving Accounts: ${accountsCount.count}`);

  db.close();
  console.log('============================================================');
  console.log('✨ Database setup completed successfully.');
  console.log('============================================================');
}

main().catch((err) => {
  console.error('[-] Database initialization failed:', err);
  process.exit(1);
});
