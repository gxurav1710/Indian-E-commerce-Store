import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  Database,
  runMigrations,
  MerchantRepository,
  ReceivingAccountRepository,
  CustomerRepository,
  PaymentSessionRepository,
  ObservationRepository,
  SupportTicketRepository,
  AuditLogRepository
} from '../index.js';
import { PaymentStatus, ObserverSource, SenderType, TicketStatus } from '@youpi/common';

describe('@youpi/db Unit & Integration Tests', () => {
  let db;
  let merchantRepo;
  let accountRepo;
  let customerRepo;
  let sessionRepo;
  let obsRepo;
  let ticketRepo;
  let auditRepo;
  let testMerchant;
  let testAccount;

  beforeEach(() => {
    db = new Database({ inMemory: true });
    const { defaultMerchant } = runMigrations(db);
    testMerchant = defaultMerchant;

    merchantRepo = new MerchantRepository(db);
    accountRepo = new ReceivingAccountRepository(db);
    customerRepo = new CustomerRepository(db);
    sessionRepo = new PaymentSessionRepository(db);
    obsRepo = new ObservationRepository(db);
    ticketRepo = new SupportTicketRepository(db);
    auditRepo = new AuditLogRepository(db);

    testAccount = accountRepo.findActiveForMerchant(testMerchant.id);
  });

  afterEach(() => {
    db.close();
  });

  test('migrations seed default merchant and active UPI receiving account', () => {
    assert.ok(testMerchant);
    assert.equal(testMerchant.slug, 'demo-store');
    assert.ok(testAccount);
    assert.equal(testAccount.upiId, 'merchant@upi');
    assert.equal(testAccount.isActive, true);
    assert.equal(testAccount.isSlotBusy, false);
  });

  test('customer registration and password verification', () => {
    const customer = customerRepo.create({
      merchantId: testMerchant.id,
      phoneNumber: '9876543210',
      fullName: 'Gaurav Sharma',
      password: 'SecurePassword123!'
    });

    assert.ok(customer.id);
    assert.equal(customer.phoneNumber, '9876543210');
    assert.equal(customer.fullName, 'Gaurav Sharma');

    const verified = customerRepo.verifyCredentials(
      testMerchant.id,
      '9876543210',
      'SecurePassword123!'
    );
    assert.ok(verified);
    assert.equal(verified.id, customer.id);

    const failed = customerRepo.verifyCredentials(
      testMerchant.id,
      '9876543210',
      'WrongPassword'
    );
    assert.equal(failed, null);
  });

  describe('Queue Engine & Concurrency Slot Invariants', () => {
    test('enforces ONE active slot at one time and queues subsequent sessions', () => {
      // Create session A
      const sessionA = sessionRepo.create({
        merchantId: testMerchant.id,
        receivingAccountId: testAccount.id,
        orderId: 'ORDER-A',
        amountPaise: 20000n
      });

      // Create session B (same amount, same account)
      const sessionB = sessionRepo.create({
        merchantId: testMerchant.id,
        receivingAccountId: testAccount.id,
        orderId: 'ORDER-B',
        amountPaise: 20000n
      });

      // Create session C (same amount, same account)
      const sessionC = sessionRepo.create({
        merchantId: testMerchant.id,
        receivingAccountId: testAccount.id,
        orderId: 'ORDER-C',
        amountPaise: 20000n
      });

      // 1. Session A attempts to acquire slot
      const resA = sessionRepo.acquireSlotAtomic(sessionA.id, testAccount.id, 300000);
      assert.equal(resA.status, PaymentStatus.ACTIVE);
      assert.equal(resA.queuePosition, 0);
      assert.ok(resA.expiresAt instanceof Date);

      // Verify receiving account is marked busy
      const acctAfterA = accountRepo.findById(testAccount.id);
      assert.equal(acctAfterA.isSlotBusy, true);
      assert.equal(acctAfterA.currentActiveSessionId, sessionA.id);

      // 2. Session B attempts to acquire slot -> MUST BE QUEUED at position 1
      const resB = sessionRepo.acquireSlotAtomic(sessionB.id, testAccount.id, 300000);
      assert.equal(resB.status, PaymentStatus.QUEUED);
      assert.equal(resB.queuePosition, 1);
      assert.equal(resB.expiresAt, null);

      // 3. Session C attempts to acquire slot -> MUST BE QUEUED at position 2
      const resC = sessionRepo.acquireSlotAtomic(sessionC.id, testAccount.id, 300000);
      assert.equal(resC.status, PaymentStatus.QUEUED);
      assert.equal(resC.queuePosition, 2);

      // 4. Session A transitions to PROCESSING when customer clicks "Payment Done"
      const procA = sessionRepo.transitionToProcessing(sessionA.id, 30000);
      assert.equal(procA.status, PaymentStatus.PROCESSING);
      assert.ok(procA.processingStartedAt instanceof Date);
      assert.ok(procA.processingExpiresAt instanceof Date);

      // Slot MUST STILL BE BUSY during PROCESSING! Session B cannot steal it
      const acctDuringProc = accountRepo.findById(testAccount.id);
      assert.equal(acctDuringProc.isSlotBusy, true);
      assert.equal(acctDuringProc.currentActiveSessionId, sessionA.id);

      // 5. Session A finishes with SUCCESS
      const successA = sessionRepo.transitionToTerminal(sessionA.id, PaymentStatus.SUCCESS);
      assert.equal(successA.status, PaymentStatus.SUCCESS);
      assert.ok(successA.completedAt instanceof Date);

      // Slot is now released!
      const acctAfterSuccess = accountRepo.findById(testAccount.id);
      assert.equal(acctAfterSuccess.isSlotBusy, false);
      assert.equal(acctAfterSuccess.currentActiveSessionId, null);

      // 6. Promote next queued session (B)
      const nextQueued = sessionRepo.getNextQueuedSession(testAccount.id);
      assert.equal(nextQueued.id, sessionB.id);

      const resBAfterPromo = sessionRepo.acquireSlotAtomic(sessionB.id, testAccount.id, 300000);
      assert.equal(resBAfterPromo.status, PaymentStatus.ACTIVE);
      assert.equal(resBAfterPromo.queuePosition, 0);

      // Re-index remaining queue
      sessionRepo.reindexQueue(testAccount.id);
      const updatedC = sessionRepo.findById(sessionC.id);
      assert.equal(updatedC.queuePosition, 1); // C promoted from #2 to #1 in waiting line
    });

    test('transitions to CANCELLED and immediately releases slot', () => {
      const session = sessionRepo.create({
        merchantId: testMerchant.id,
        receivingAccountId: testAccount.id,
        orderId: 'ORDER-CANCEL',
        amountPaise: 50000n
      });

      sessionRepo.acquireSlotAtomic(session.id, testAccount.id, 300000);
      let acct = accountRepo.findById(testAccount.id);
      assert.equal(acct.isSlotBusy, true);

      sessionRepo.transitionToTerminal(session.id, PaymentStatus.CANCELLED);
      acct = accountRepo.findById(testAccount.id);
      assert.equal(acct.isSlotBusy, false);
      assert.equal(acct.currentActiveSessionId, null);
    });
  });

  describe('Observation Deduplication & Storage', () => {
    test('records observations and retrieves by fingerprint for deduplication', () => {
      const now = new Date();
      const obs = obsRepo.create({
        receivingAccountId: testAccount.id,
        source: ObserverSource.GOOGLE_MESSAGES,
        amountPaise: 20000n,
        observedAt: now,
        bankReferenceNumber: 'UTR998877',
        fingerprintHash: 'hash_abc_123',
        rawPayload: { text: 'Received Rs 200 via UPI' }
      });

      assert.ok(obs.id);
      assert.equal(obs.bankReferenceNumber, 'UTR998877');

      const found = obsRepo.findByFingerprint('hash_abc_123');
      assert.ok(found);
      assert.equal(found.id, obs.id);
    });
  });

  describe('Support Tickets & Live Messages', () => {
    test('creates tickets, links payments, and records bidirectional chat', () => {
      const customer = customerRepo.create({
        merchantId: testMerchant.id,
        phoneNumber: '9123456780',
        fullName: 'Anita Roy',
        password: 'PassWord123!'
      });

      const ticket = ticketRepo.createTicket({
        merchantId: testMerchant.id,
        customerId: customer.id,
        subject: 'Payment failed but money deducted',
        initialMessage: {
          senderType: SenderType.CUSTOMER,
          senderId: customer.id,
          message: 'I paid 200 rupees but the screen said failed.'
        }
      });

      assert.ok(ticket.id);
      assert.equal(ticket.status, TicketStatus.OPEN);

      // Admin replies
      const adminMsg = ticketRepo.addMessage({
        ticketId: ticket.id,
        senderType: SenderType.ADMIN,
        senderId: testMerchant.id,
        message: 'Hello Anita, we found your transaction and have credited your order.'
      });

      assert.ok(adminMsg.id);

      const messages = ticketRepo.findMessagesByTicket(ticket.id);
      assert.equal(messages.length, 2);
      assert.equal(messages[0].senderType, SenderType.CUSTOMER);
      assert.equal(messages[1].senderType, SenderType.ADMIN);
    });
  });

  describe('Audit Logging', () => {
    test('records and queries audit trail', () => {
      auditRepo.log({
        merchantId: testMerchant.id,
        entityType: 'PAYMENT_SESSION',
        entityId: 'pay_123',
        action: 'SLOT_ACQUIRED',
        details: { queuePosition: 0 }
      });

      const logs = auditRepo.findByEntity('PAYMENT_SESSION', 'pay_123');
      assert.equal(logs.length, 1);
      assert.equal(logs[0].action, 'SLOT_ACQUIRED');
      assert.equal(logs[0].details.queuePosition, 0);
    });
  });
});
