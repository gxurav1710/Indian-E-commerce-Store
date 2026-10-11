import assert from 'node:assert/strict';
import { Database } from '../packages/db/src/database.js';
import { ReceivingAccountRepository } from '../packages/db/src/repositories/receiving-account.repository.js';
import {
  buildUpiUri,
  buildUpiIntentUri,
  getUpiProviders,
  findUpiProviderByPackage,
  findUpiProviderById,
  isValidVpa
} from '../packages/common/src/index.js';

async function verifyProductionExtensions() {
  console.log('============================================================');
  console.log('🔍 VERIFYING PRODUCTION EXTENSIONS (YOUPI PG V2)');
  console.log('============================================================');

  // 1. Check 30 Providers Registry
  const providers = getUpiProviders();
  assert.equal(providers.length, 30, 'Must have exactly 30 registered UPI providers');
  console.log(`[✓] 30 UPI Providers verified in Production`);

  // Verify PhonePe intent format
  const phonepe = findUpiProviderById('phonepe');
  assert.ok(phonepe);
  assert.equal(phonepe.packageName, 'com.phonepe.app');

  const testIntent = buildUpiIntentUri({
    payeeVpa: '9876543210@axl',
    payeeName: 'Demo Store Merchant',
    amountPaise: 100n,
    transactionRef: 'COIN-ORD-1788969252735',
    currency: 'INR',
    packageName: phonepe.packageName
  });
  console.log('[✓] Dynamic Android Intent URI generated:');
  console.log('   ', testIntent);
  assert.ok(testIntent.startsWith('intent://pay?'));
  assert.ok(testIntent.includes('package=com.phonepe.app'));
  assert.ok(testIntent.endsWith('#Intent;scheme=upi;package=com.phonepe.app;end'));

  // 2. Check Production Database
  const prodDb = new Database({ dbPath: path.resolve('data/youpi_pg.sqlite') });

  // Apply migration column if not yet present
  try { prodDb.exec('ALTER TABLE payment_receiving_accounts ADD COLUMN is_merchant_enabled INTEGER NOT NULL DEFAULT 1;'); } catch {}
  try { prodDb.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_single_active_vpa_per_merchant ON payment_receiving_accounts (merchant_id) WHERE is_active = 1;'); } catch {}

  const accountRepo = new ReceivingAccountRepository(prodDb);
  const merchant = prodDb.queryOne('SELECT id, business_name FROM merchants');
  assert.ok(merchant, 'Production merchant must exist');

  const activeAccount = accountRepo.findActiveForMerchant(merchant.id);
  assert.ok(activeAccount, 'Production active receiving account must exist');
  assert.equal(activeAccount.upiId, '9876543210@axl');
  assert.equal(activeAccount.payeeName, 'Demo Store Merchant');
  assert.equal(activeAccount.isMerchantEnabled, true, 'Preserved production account must be merchant-enabled by default');
  assert.equal(activeAccount.isActive, true);

  console.log('\n[✓] Preserved Production Merchant & Receiving Account:');
  console.log('   Merchant:         ', merchant.business_name, `(${merchant.id})`);
  console.log('   Active VPA:       ', activeAccount.upiId);
  console.log('   Payee Name:       ', activeAccount.payeeName);
  console.log('   Merchant-Enabled: ', activeAccount.isMerchantEnabled);
  console.log('   Is Active:        ', activeAccount.isActive);

  // 3. Test Multi-VPA and Single Active Enforcement on in-memory DB
  console.log('\n[✓] Testing Atomic Single-Active VPA Enforcement on In-Memory DB...');
  const memDb = new Database({ inMemory: true });
  memDb.exec(`
    CREATE TABLE merchants (id TEXT PRIMARY KEY, business_name TEXT);
    CREATE TABLE payment_receiving_accounts (
      id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL,
      upi_id TEXT NOT NULL,
      payee_name TEXT NOT NULL,
      is_merchant_enabled INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_slot_busy INTEGER NOT NULL DEFAULT 0,
      current_active_session_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX idx_single_active_vpa ON payment_receiving_accounts (merchant_id) WHERE is_active = 1;
  `);

  const memRepo = new ReceivingAccountRepository(memDb);
  const mId = merchant.id;

  // Add VPA 1 (Merchant Mode)
  const acc1 = memRepo.create({
    merchantId: mId,
    upiId: 'merchant@axl',
    payeeName: 'Merchant Store',
    isMerchantEnabled: true,
    isActive: true
  });
  assert.equal(memRepo.findActiveForMerchant(mId).id, acc1.id);
  assert.equal(memRepo.findActiveForMerchant(mId).isMerchantEnabled, true);

  // Add VPA 2 (Non-Merchant Mode, Active) -> acc1 must automatically deactivate!
  const acc2 = memRepo.create({
    merchantId: mId,
    upiId: 'personal@paytm',
    payeeName: 'Personal Account',
    isMerchantEnabled: false,
    isActive: true
  });
  assert.equal(memRepo.findActiveForMerchant(mId).id, acc2.id);
  assert.equal(memRepo.findActiveForMerchant(mId).isMerchantEnabled, false);
  assert.equal(memRepo.findById(acc1.id).isActive, false);

  // Switch back to acc1
  memRepo.activateAccount(mId, acc1.id);
  assert.equal(memRepo.findActiveForMerchant(mId).id, acc1.id);
  assert.equal(memRepo.findById(acc2.id).isActive, false);
  console.log('   [✓] Verified: Activating VPA B automatically deactivates VPA A');
  console.log('   [✓] Verified: Non-merchant vs Merchant mode flag persisted per VPA');

  memDb.close();
  prodDb.close();

  console.log('============================================================');
  console.log('🎉 PRODUCTION EXTENSIONS VERIFIED 100% SUCCESSFUL');
  console.log('============================================================');
}

verifyProductionExtensions().catch(err => {
  console.error('PRODUCTION VERIFICATION FAILED:', err);
  process.exit(1);
});
