import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  toPaise,
  toRupeesString,
  formatINR,
  encrypt,
  decrypt,
  generateHmac,
  verifyHmac,
  hashPassword,
  verifyPassword,
  isValidVpa,
  buildUpiUri,
  calculateObservationFingerprint
} from '../index.js';

describe('@youpi/common Unit Tests', () => {
  describe('Money and Currency Utilities', () => {
    test('converts valid rupee strings and numbers to integer paise', () => {
      assert.equal(toPaise('200.00'), 20000n);
      assert.equal(toPaise('200'), 20000n);
      assert.equal(toPaise(200), 20000n);
      assert.equal(toPaise('0.50'), 50n);
      assert.equal(toPaise('0.05'), 5n);
      assert.equal(toPaise('199.99'), 19999n);
    });

    test('rejects negative, zero, and malformed currency inputs', () => {
      assert.throws(() => toPaise('0.00'), /greater than 0/);
      assert.throws(() => toPaise('-50.00'), /Invalid INR rupee format/);
      assert.throws(() => toPaise('12.345'), /Invalid INR rupee format/);
      assert.throws(() => toPaise('abc'), /Invalid INR rupee format/);
      assert.throws(() => toPaise(NaN), /Invalid monetary amount/);
    });

    test('formats paise into standard decimal string and INR symbol', () => {
      assert.equal(toRupeesString(20000n), '200.00');
      assert.equal(toRupeesString(50n), '0.50');
      assert.equal(toRupeesString(5n), '0.05');
      assert.equal(formatINR(20000n), '₹200.00');
      assert.equal(formatINR(19999n), '₹199.99');
    });
  });

  describe('Cryptographic Helpers', () => {
    const testMasterKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    test('encrypts and decrypts with AES-256-GCM successfully', () => {
      const original = 'super-secret-oauth-token-12345';
      const encrypted = encrypt(original, testMasterKey);
      assert.notEqual(encrypted, original);
      assert.equal(encrypted.split(':').length, 3);

      const decrypted = decrypt(encrypted, testMasterKey);
      assert.equal(decrypted, original);
    });

    test('fails decryption if ciphertext or auth tag is tampered', () => {
      const encrypted = encrypt('sensitive data', testMasterKey);
      const parts = encrypted.split(':');
      // Tamper with cipher part
      const tampered = `${parts[0]}:${parts[1]}:${parts[2]}ab`;
      assert.throws(() => decrypt(tampered, testMasterKey));
    });

    test('generates and verifies HMAC-SHA256 signatures with timing safety', () => {
      const secret = 'merchant_webhook_secret_xyz';
      const payload = JSON.stringify({ event: 'SUCCESS', paymentId: 'p123' });
      const signature = generateHmac(payload, secret);

      assert.equal(verifyHmac(payload, secret, signature), true);
      assert.equal(verifyHmac(payload, 'wrong_secret', signature), false);
      assert.equal(verifyHmac('altered payload', secret, signature), false);
    });

    test('hashes and verifies passwords securely', () => {
      const pass = 'CorrectHorseBatteryStaple!42';
      const hash = hashPassword(pass);
      assert.ok(hash.startsWith('100000:'));

      assert.equal(verifyPassword(pass, hash), true);
      assert.equal(verifyPassword('WrongPassword', hash), false);
    });
  });

  describe('UPI Utilities', () => {
    test('validates UPI VPAs correctly', () => {
      assert.equal(isValidVpa('merchant@icici'), true);
      assert.equal(isValidVpa('user.name-12@okhdfcbank'), true);
      assert.equal(isValidVpa('invalid-vpa-no-bank'), false);
      assert.equal(isValidVpa('@bank'), false);
      assert.equal(isValidVpa(''), false);
    });

    test('builds canonical upi://pay URI dynamically with server amount', () => {
      const uri = buildUpiUri({
        payeeVpa: 'store@upi',
        payeeName: 'Acme Store',
        amountPaise: 20000n,
        transactionRef: 'ORDER-99',
        transactionNote: 'Order payment'
      });

      assert.ok(uri.startsWith('upi://pay?'));
      const parsed = new URL(uri);
      assert.equal(parsed.searchParams.get('pa'), 'store@upi');
      assert.equal(parsed.searchParams.get('pn'), 'Acme Store');
      assert.equal(parsed.searchParams.get('am'), '200.00');
      assert.equal(parsed.searchParams.get('tn'), 'ORDER-99');
      assert.equal(parsed.searchParams.get('tr'), null);
      assert.equal(parsed.searchParams.get('cu'), null);
      assert.deepEqual([...parsed.searchParams.keys()], ['pa', 'pn', 'am', 'tn']);
    });
  });

  describe('Observation Fingerprinting', () => {
    test('generates consistent fingerprints with bank reference numbers', () => {
      const fp1 = calculateObservationFingerprint({
        receivingAccountId: 'acc_1',
        amountPaise: 20000n,
        bankReferenceNumber: 'UTR12345678',
        observedAt: new Date('2026-09-08T10:00:00Z')
      });

      const fp2 = calculateObservationFingerprint({
        receivingAccountId: 'acc_1',
        amountPaise: 20000n,
        bankReferenceNumber: 'UTR12345678',
        observedAt: new Date('2026-09-08T10:02:00Z') // even 2 mins later, same UTR = same fingerprint
      });

      assert.equal(fp1, fp2);
    });

    test('generates cluster fingerprints within same 60-second window when no reference', () => {
      const fp1 = calculateObservationFingerprint({
        receivingAccountId: 'acc_1',
        amountPaise: 20000n,
        observedAt: new Date('2026-09-08T10:00:10Z')
      });

      const fp2 = calculateObservationFingerprint({
        receivingAccountId: 'acc_1',
        amountPaise: 20000n,
        observedAt: new Date('2026-09-08T10:00:45Z') // within same minute
      });

      assert.equal(fp1, fp2);

      const fpDiffTime = calculateObservationFingerprint({
        receivingAccountId: 'acc_1',
        amountPaise: 20000n,
        observedAt: new Date('2026-09-08T10:05:00Z') // 5 minutes later
      });

      assert.notEqual(fp1, fpDiffTime);
    });
  });
});
