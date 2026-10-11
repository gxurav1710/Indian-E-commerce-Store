import { PaymentStatus } from '@youpi/common';

export class QueueEngine {
  /**
   * @param {{
   *   sessionRepo: import('@youpi/db').PaymentSessionRepository,
   *   accountRepo: import('@youpi/db').ReceivingAccountRepository,
   *   eventEmitter?: { emit: (event: string, payload: any) => void },
   *   auditRepo?: import('@youpi/db').AuditLogRepository
   * }} options
   */
  constructor(options) {
    this.sessionRepo = options.sessionRepo;
    this.accountRepo = options.accountRepo;
    this.eventEmitter = options.eventEmitter || { emit: () => {} };
    this.auditRepo = options.auditRepo;
  }

  /**
   * Attempts to acquire an active slot or places the session into the queue.
   * @param {string} sessionId
   * @param {string} receivingAccountId
   * @param {number} [activeDurationMs=300000]
   * @returns {{ status: string, queuePosition: number, expiresAt: Date | null }}
   */
  enqueueOrActivate(sessionId, receivingAccountId, activeDurationMs = 300000) {
    const result = this.sessionRepo.acquireSlotAtomic(sessionId, receivingAccountId, activeDurationMs);

    if (result.status === PaymentStatus.ACTIVE) {
      this.eventEmitter.emit('SESSION.ACTIVATED', {
        sessionId,
        receivingAccountId,
        expiresAt: result.expiresAt
      });

      if (this.auditRepo) {
        this.auditRepo.log({
          entityType: 'PAYMENT_SESSION',
          entityId: sessionId,
          action: 'PAYMENT_SLOT_ACTIVATED',
          actorType: 'SYSTEM',
          details: { receivingAccountId, expiresAt: result.expiresAt?.toISOString() }
        });
      }
    } else {
      this.eventEmitter.emit('SESSION.QUEUED', {
        sessionId,
        receivingAccountId,
        queuePosition: result.queuePosition
      });

      if (this.auditRepo) {
        this.auditRepo.log({
          entityType: 'PAYMENT_SESSION',
          entityId: sessionId,
          action: 'PAYMENT_ENQUEUED',
          actorType: 'SYSTEM',
          details: { receivingAccountId, queuePosition: result.queuePosition }
        });
      }
    }

    return result;
  }

  /**
   * Promotes the next queued session for a receiving account if the slot is free.
   * @param {string} receivingAccountId
   * @param {number} [activeDurationMs=300000]
   * @returns {any | null} The newly activated session or null if queue is empty or slot is busy
   */
  promoteNext(receivingAccountId, activeDurationMs = 300000) {
    // Check if slot is currently occupied
    const active = this.sessionRepo.findCurrentActiveOrProcessing(receivingAccountId);
    if (active) {
      return null; // Slot is still owned
    }

    const nextQueued = this.sessionRepo.getNextQueuedSession(receivingAccountId);
    if (!nextQueued) {
      return null; // Queue is empty
    }

    // Atomically activate the queued session
    const res = this.sessionRepo.acquireSlotAtomic(nextQueued.id, receivingAccountId, activeDurationMs);
    if (res.status === PaymentStatus.ACTIVE) {
      // Re-index remaining queued sessions
      this.sessionRepo.reindexQueue(receivingAccountId);

      const activatedSession = this.sessionRepo.findById(nextQueued.id);

      this.eventEmitter.emit('SESSION.ACTIVATED', {
        sessionId: nextQueued.id,
        receivingAccountId,
        expiresAt: activatedSession.expiresAt
      });

      this.eventEmitter.emit('QUEUE.PROMOTED', {
        receivingAccountId,
        promotedSessionId: nextQueued.id
      });

      if (this.auditRepo) {
        this.auditRepo.log({
          merchantId: activatedSession.merchantId,
          entityType: 'PAYMENT_SESSION',
          entityId: nextQueued.id,
          action: 'QUEUE_PROMOTION_TO_ACTIVE',
          actorType: 'SYSTEM',
          details: { receivingAccountId, expiresAt: activatedSession.expiresAt?.toISOString() }
        });
      }

      return activatedSession;
    }

    return null;
  }

  /**
   * Calculates estimated wait time in seconds for a queued session.
   * @param {string} receivingAccountId
   * @param {number} queuePosition
   * @returns {number} Estimated seconds until activation
   */
  calculateEstimatedWaitSeconds(receivingAccountId, queuePosition) {
    if (queuePosition <= 0) return 0;

    let currentSlotRemaining = 0;
    const currentActive = this.sessionRepo.findCurrentActiveOrProcessing(receivingAccountId);

    if (currentActive) {
      const now = Date.now();
      if (currentActive.status === PaymentStatus.PROCESSING && currentActive.processingExpiresAt) {
        currentSlotRemaining = Math.max(0, Math.ceil((currentActive.processingExpiresAt.getTime() - now) / 1000));
      } else if (currentActive.status === PaymentStatus.ACTIVE && currentActive.expiresAt) {
        currentSlotRemaining = Math.max(0, Math.ceil((currentActive.expiresAt.getTime() - now) / 1000));
      }
    }

    // Average per queued cycle: 5-minute active window + 30-sec processing window
    const CYCLE_DURATION_SECONDS = 330;
    const precedingQueuedWait = (queuePosition - 1) * CYCLE_DURATION_SECONDS;

    return currentSlotRemaining + precedingQueuedWait;
  }
}
