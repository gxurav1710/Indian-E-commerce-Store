import { HttpServer } from '../server.js';
import { toPaise, toRupeesString, resolveRuntimeUrls, PaymentStatus } from '@youpi/common';
import { isTerminalStatus, toPublicOutcome } from '@youpi/core';

/**
 * Registers merchant-facing payment routes.
 * @param {HttpServer} server
 * @param {{
 *   merchantRepo: import('@youpi/db').MerchantRepository,
 *   accountRepo: import('@youpi/db').ReceivingAccountRepository,
 *   sessionRepo: import('@youpi/db').PaymentSessionRepository,
 *   queueEngine: import('@youpi/core').QueueEngine,
 *   timingEngine: import('@youpi/core').TimingEngine,
 *   auditRepo: import('@youpi/db').AuditLogRepository,
 *   checkoutBaseUrl: string
 * }} ctx
 */
export function registerPaymentRoutes(server, ctx) {
  function resolveCheckoutBaseUrl(merchant) {
    if (merchant?.branding) {
      try {
        const urls = resolveRuntimeUrls(merchant.branding);
        if (urls && urls.checkoutUrl) return urls.checkoutUrl;
      } catch {}
    }
    return ctx.checkoutBaseUrl || 'http://localhost:7000';
  }

  // POST /api/v1/payments
  server.post('/api/v1/payments', async (req, res) => {
    const body = await HttpServer.parseBody(req);
    const idempotencyKey = req.headers['idempotency-key'] || body.idempotencyKey;

    // Resolve merchant (default to first/demo merchant if none passed in header)
    const merchantId = req.headers['x-merchant-id'] || body.merchantId;
    let merchant;
    if (merchantId) {
      merchant = ctx.merchantRepo.findById(merchantId);
    } else {
      merchant = ctx.merchantRepo.getDefault ? ctx.merchantRepo.getDefault() : (ctx.merchantRepo.findById('00000000-0000-0000-0000-000000000001') || ctx.merchantRepo.findAll()[0]);
    }

    if (!merchant) {
      HttpServer.json(res, 400, { error: 'Merchant not found or not configured.' });
      return;
    }

    if (!body.orderId || !body.amount) {
      HttpServer.json(res, 400, { error: 'Missing required fields: orderId and amount.' });
      return;
    }

    const deviceId = body.deviceId || req.headers['x-device-id'] || null;
    if (deviceId && ctx.deviceRepo) {
      let dev = ctx.deviceRepo.findById(deviceId);
      if (!dev) {
        try {
          ctx.deviceRepo.create({
            id: deviceId,
            publicKey: `adhoc_${deviceId}`,
            fingerprintHash: `fp_${deviceId}`
          });
        } catch {}
      }
    }

    // Check idempotency & active session state
    const existing = ctx.sessionRepo.findByOrderId(merchant.id, body.orderId);
    if (existing) {
      // If SUCCESS: order is already paid, return existing completed session
      if (existing.status === PaymentStatus.SUCCESS) {
        HttpServer.json(res, 200, {
          paymentId: existing.id,
          orderId: existing.orderId,
          amount: toRupeesString(existing.amountPaise),
          amountPaise: existing.amountPaise.toString(),
          currency: existing.currency,
          status: existing.status,
          checkoutUrl: `${resolveCheckoutBaseUrl(merchant)}/checkout/${existing.id}`
        });
        return;
      }

      // Check if existing session is stale
      const now = Date.now();
      const isStale = (existing.status === PaymentStatus.ACTIVE && existing.expiresAt && existing.expiresAt.getTime() <= now) ||
        (existing.status === PaymentStatus.PROCESSING && existing.processingExpiresAt && existing.processingExpiresAt.getTime() <= now);
      if (isStale) {
        ctx.sessionRepo.transitionToTerminal(existing.id, PaymentStatus.EXPIRED);
        if (existing.receivingAccountId) {
          ctx.queueEngine.promoteNext(existing.receivingAccountId);
        }
        existing.status = PaymentStatus.EXPIRED;
      }

      // If existing is non-terminal (ACTIVE, PROCESSING, QUEUED, INITIATED):
      if ([PaymentStatus.ACTIVE, PaymentStatus.PROCESSING, PaymentStatus.QUEUED, PaymentStatus.INITIATED].includes(existing.status)) {
        // CASE 3: Active session + Different device -> DUPLICATE_SESSION_DETECTED
        if (deviceId && existing.deviceId && deviceId !== existing.deviceId) {
          HttpServer.json(res, 409, {
            error: 'DUPLICATE_SESSION_DETECTED',
            code: 'DEVICE_SESSION_MISMATCH',
            session_id: existing.id,
            activeSession: {
              paymentId: existing.id,
              orderId: existing.orderId,
              amount: toRupeesString(existing.amountPaise)
            },
            action: 'END_SESSION_AND_CREATE_NEW',
            message: 'This payment session was created on another device. For security reasons, this session cannot be continued from this device.'
          });
          return;
        }

        // CASE 2: Active session + Same device -> CONTINUE ACTIVE SESSION
        HttpServer.json(res, 200, {
          paymentId: existing.id,
          orderId: existing.orderId,
          amount: toRupeesString(existing.amountPaise),
          amountPaise: existing.amountPaise.toString(),
          currency: existing.currency,
          status: existing.status,
          activeSessionDetected: true,
          checkoutUrl: `${resolveCheckoutBaseUrl(merchant)}/checkout/${existing.id}`
        });
        return;
      }

      // CASE 4: Previous session is TERMINAL (FAILED, EXPIRED, CANCELLED) -> RETRY / NEW PAYMENT!
      const cleanOrderId = body.orderId.replace(/-R\d+$/, '');
      const randSuffix = Math.floor(1000 + Math.random() * 9000);
      body.orderId = `${cleanOrderId}-R${randSuffix}`;
    }

    let amountPaise;
    try {
      amountPaise = toPaise(body.amount);
    } catch (err) {
      HttpServer.json(res, 400, { error: err.message });
      return;
    }

    const isCounterPayment = body.method === 'CASH_COUNTER' || body.method === 'CARD_COUNTER';

    let receivingAccountId = null;
    let receivingAccountSnapshot = null;
    if (!isCounterPayment) {
      // Resolve active receiving account for UPI
      const receivingAccount = ctx.accountRepo.findActiveForMerchant(merchant.id);
      if (!receivingAccount) {
        HttpServer.json(res, 500, { error: 'No active UPI receiving account configured for merchant.' });
        return;
      }
      receivingAccountId = receivingAccount.id;
      receivingAccountSnapshot = {
        id: receivingAccount.id,
        upiId: receivingAccount.upiId,
        payeeName: receivingAccount.payeeName,
        isMerchantEnabled: receivingAccount.isMerchantEnabled
      };
    }

    // Resolve customer if provided (optional pre-existing customer)
    let customerId = body.customerId || null;
    if (!customerId && (body.customer?.mobileNumber || body.customer?.phoneNumber || body.customer?.email) && ctx.customerRepo) {
      const ident = body.customer.email || body.customer.mobileNumber || body.customer.phoneNumber;
      const existingCust = ctx.customerRepo.findByIdentifier(ident);
      if (existingCust) {
        customerId = existingCust.id;
      }
    }

    // Server-side Ban Enforcement (Section 3)
    if (customerId && ctx.customerRepo && ctx.customerRepo.isBanned(customerId)) {
      HttpServer.json(res, 403, {
        status: 'BLOCKED',
        error: 'ACCESS BLOCKED: Your account has been temporarily blocked because suspicious payment activity was detected. Our team will review the activity before access can be restored.',
        message: 'Your account has been temporarily blocked because suspicious payment activity was detected. Our team will review the activity before access can be restored.',
        isBanned: true
      });
      return;
    }

    // Check if customer already has an active payment session on another device (CASE 3)
    if (customerId && ctx.sessionRepo) {
      const activeForCust = ctx.sessionRepo.findActiveForCustomer ? ctx.sessionRepo.findActiveForCustomer(customerId) : null;
      if (activeForCust) {
        if (deviceId && activeForCust.deviceId && deviceId !== activeForCust.deviceId) {
          HttpServer.json(res, 409, {
            error: 'DUPLICATE_SESSION_DETECTED',
            code: 'DEVICE_SESSION_MISMATCH',
            session_id: activeForCust.id,
            activeSession: {
              paymentId: activeForCust.id,
              orderId: activeForCust.orderId,
              amount: toRupeesString(activeForCust.amountPaise)
            },
            action: 'END_SESSION_AND_CREATE_NEW',
            message: 'This customer already has an active payment session on another device. For security reasons, this session cannot be continued from this device.'
          });
          return;
        }
      }
    }

    // Invariant: Do NOT start payment session timer until customer is authenticated/logged in!
    // Customer sign in or sign up in the checkout portal is mandatory before slot activation or timer start.
    // Digital UPI payments MUST ALWAYS start in status INITIATED without acquiring a concurrency slot or timer.
    // Only physical counter payments (CASH_COUNTER, CARD_COUNTER) start as ACTIVE (they do not use UPI slots).
    // The only exception for UPI auto-activation is explicit developer test suite flag: body.autoActivate === true.
    const isExplicitTestAutoActivate = body.autoActivate === true || body.autoActivate === 'true';
    const shouldActivateNow = isCounterPayment || isExplicitTestAutoActivate;
    const initialStatus = isCounterPayment ? PaymentStatus.ACTIVE : PaymentStatus.INITIATED;

    const sessionMetadata = {
      ...(body.metadata || {}),
      ...(receivingAccountSnapshot ? { receivingAccountSnapshot } : {})
    };

    if (deviceId && customerId && ctx.deviceRepo) {
      try { ctx.deviceRepo.associateCustomer(deviceId, customerId); } catch {}
    }

    // Create session in DB
    const session = ctx.sessionRepo.create({
      merchantId: merchant.id,
      customerId,
      receivingAccountId,
      orderId: body.orderId,
      amountPaise,
      currency: body.currency || 'INR',
      method: body.method || 'UPI',
      status: initialStatus,
      returnUrl: body.returnUrl || null,
      idempotencyKey: idempotencyKey || null,
      deviceId,
      metadata: sessionMetadata
    });

    // Enqueue or Activate slot via QueueEngine ONLY when counter payment or explicitly requested by automated test runner
    let queueResult = { status: initialStatus, queuePosition: 0, expiresAt: null };
    if (!isCounterPayment && receivingAccountId && shouldActivateNow) {
      queueResult = ctx.queueEngine.enqueueOrActivate(session.id, receivingAccountId);

      // If activated immediately, start Timer 1 (5 minutes)
      if (queueResult.expiresAt) {
        ctx.timingEngine.startActiveTimer(session.id, queueResult.expiresAt);
      }
      server.broadcastSse('admin_counter_events', 'status_change', {
        status: queueResult.status,
        sessionId: session.id,
        orderId: session.orderId,
        amountPaise: session.amountPaise ? session.amountPaise.toString() : '0'
      });
    }

    HttpServer.json(res, 201, {
      paymentId: session.id,
      orderId: session.orderId,
      amount: toRupeesString(amountPaise),
      amountPaise: amountPaise.toString(),
      currency: session.currency,
      status: queueResult.status,
      queuePosition: queueResult.queuePosition,
      checkoutUrl: `${resolveCheckoutBaseUrl(merchant)}/checkout/${session.id}`
    });
  });

  // GET /api/v1/payments/:id
  server.get('/api/v1/payments/:id', async (req, res, params) => {
    const session = ctx.sessionRepo.findById(params.id);
    if (!session) {
      HttpServer.json(res, 404, { error: `Payment session not found: ${params.id}` });
      return;
    }

    const publicStatus = isTerminalStatus(session.status)
      ? toPublicOutcome(session.status)
      : session.status;

    HttpServer.json(res, 200, {
      paymentId: session.id,
      orderId: session.orderId,
      amount: toRupeesString(session.amountPaise),
      amountPaise: session.amountPaise.toString(),
      currency: session.currency,
      status: publicStatus,
      internalStatus: session.status,
      method: session.method,
      verificationLevel: session.verificationLevel || 0,
      verificationSources: session.verificationSources || [],
      verificationTag: session.verificationTag || 'UNVERIFIED',
      completedAt: session.completedAt ? session.completedAt.toISOString() : null,
      returnUrl: session.returnUrl,
      metadata: session.metadata
    });
  });

  // GET /api/v1/payments/:id/cod (Developer COD Info Endpoint)
  server.get('/api/v1/payments/:id/cod', async (req, res, params) => {
    const session = ctx.sessionRepo.findById(params.id);
    if (!session) {
      HttpServer.json(res, 404, { error: `Payment session not found: ${params.id}` });
      return;
    }

    let customer = null;
    if (session.customerId && ctx.customerRepo) {
      const c = ctx.customerRepo.findById(session.customerId);
      if (c) {
        customer = {
          id: c.id,
          name: c.name,
          email: c.email,
          mobileNumber: c.mobileNumber
        };
      }
    }

    HttpServer.json(res, 200, {
      paymentId: session.id,
      orderId: session.orderId,
      amount: toRupeesString(session.amountPaise),
      amountPaise: session.amountPaise.toString(),
      currency: session.currency,
      method: session.method,
      status: session.status,
      verificationTag: session.verificationTag,
      isCod: session.method === 'COD',
      customer,
      placedAt: session.completedAt ? (session.completedAt.toISOString ? session.completedAt.toISOString() : session.completedAt) : (session.createdAt?.toISOString ? session.createdAt.toISOString() : session.createdAt),
      metadata: session.metadata
    });
  });

  // GET /api/v1/orders/:orderId/cod (Developer COD Info by Merchant Order ID)
  server.get('/api/v1/orders/:orderId/cod', async (req, res, params) => {
    const merchantId = req.headers['x-merchant-id'] || req.query.merchantId;
    let merchant;
    if (merchantId) {
      merchant = ctx.merchantRepo.findById(merchantId);
    } else {
      merchant = ctx.merchantRepo.getDefault ? ctx.merchantRepo.getDefault() : (ctx.merchantRepo.findById('00000000-0000-0000-0000-000000000001') || ctx.merchantRepo.findAll()[0]);
    }

    if (!merchant) {
      HttpServer.json(res, 404, { error: 'Merchant not found.' });
      return;
    }

    const session = ctx.sessionRepo.findByOrderId(merchant.id, params.orderId);
    if (!session) {
      HttpServer.json(res, 404, { error: `Order not found: ${params.orderId}` });
      return;
    }

    let customer = null;
    if (session.customerId && ctx.customerRepo) {
      const c = ctx.customerRepo.findById(session.customerId);
      if (c) {
        customer = {
          id: c.id,
          name: c.name,
          email: c.email,
          mobileNumber: c.mobileNumber
        };
      }
    }

    HttpServer.json(res, 200, {
      paymentId: session.id,
      orderId: session.orderId,
      amount: toRupeesString(session.amountPaise),
      amountPaise: session.amountPaise.toString(),
      currency: session.currency,
      method: session.method,
      status: session.status,
      verificationTag: session.verificationTag,
      isCod: session.method === 'COD',
      customer,
      placedAt: session.completedAt ? (session.completedAt.toISOString ? session.completedAt.toISOString() : session.completedAt) : (session.createdAt?.toISOString ? session.createdAt.toISOString() : session.createdAt),
      metadata: session.metadata
    });
  });
}
