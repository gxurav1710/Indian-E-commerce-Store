import { HttpServer } from '../server.js';
import { generateFingerprintHash, normalizeDeviceSignals, verifyDeviceSignature } from '@youpi/core';

/**
 * Registers device identity and cryptographic binding routes.
 * @param {HttpServer} server
 * @param {{
 *   deviceRepo: import('@youpi/db').DeviceRepository,
 *   customerRepo: import('@youpi/db').CustomerRepository,
 *   auditRepo?: import('@youpi/db').AuditLogRepository
 * }} ctx
 */
export function registerDeviceRoutes(server, ctx) {
  // 1. POST /api/v1/devices/register
  server.post('/api/v1/devices/register', async (req, res) => {
    const body = await HttpServer.parseBody(req).catch(() => ({}));
    const { publicKey, signals } = body;

    if (!publicKey) {
      HttpServer.json(res, 400, { error: 'Device public key is required for registration.' });
      return;
    }

    // Resolve or generate fingerprint hash
    const clientSignals = signals || {};
    // Extract server-visible headers if client didn't supply them
    if (!clientSignals.userAgent && req.headers['user-agent']) {
      clientSignals.userAgent = req.headers['user-agent'];
    }
    if (!clientSignals.language && req.headers['accept-language']) {
      clientSignals.language = req.headers['accept-language'].split(',')[0];
    }

    const fingerprintHash = body.fingerprintHash || generateFingerprintHash(clientSignals);
    const normalized = normalizeDeviceSignals(clientSignals);

    // Optional customer association from body or authorization token
    let customerId = body.customerId || null;
    if (!customerId) {
      const authHeader = req.headers['authorization'] || '';
      if (authHeader.startsWith('Bearer ') && ctx.customerSessionRepo) {
        const token = authHeader.slice(7).trim();
        const authCtx = ctx.customerSessionRepo.findByToken(token);
        if (authCtx?.customer) {
          customerId = authCtx.customer.id;
        }
      }
    }

    // Check if device with this exact public key already exists
    const existing = ctx.deviceRepo.findByPublicKey(publicKey);
    if (existing) {
      if (customerId && !existing.customerId) {
        ctx.deviceRepo.associateCustomer(existing.id, customerId);
      }
      ctx.deviceRepo.touch(existing.id);

      HttpServer.json(res, 200, {
        success: true,
        deviceId: existing.id,
        deviceToken: existing.deviceToken,
        fingerprintHash: existing.fingerprintHash,
        status: existing.status,
        isExisting: true
      });
      return;
    }

    // Register new device
    const device = ctx.deviceRepo.create({
      customerId,
      publicKey,
      fingerprintHash,
      userAgent: normalized.userAgent,
      platform: normalized.platform,
      browser: normalized.webglRenderer ? 'WebBrowser' : null,
      timezone: normalized.timezone,
      language: normalized.language,
      screenSignature: normalized.screenSignature
    });

    if (ctx.auditRepo) {
      ctx.auditRepo.log({
        entityType: 'DEVICE',
        entityId: device.id,
        action: 'DEVICE_REGISTERED',
        actorType: customerId ? 'CUSTOMER' : 'SYSTEM',
        actorId: customerId || 'ANONYMOUS',
        details: {
          fingerprintHash: device.fingerprintHash,
          platform: normalized.platform,
          screenSignature: normalized.screenSignature
        }
      });
    }

    HttpServer.json(res, 201, {
      success: true,
      deviceId: device.id,
      deviceToken: device.deviceToken,
      fingerprintHash: device.fingerprintHash,
      status: device.status,
      isExisting: false
    });
  });

  // 2. POST /api/v1/devices/verify
  server.post('/api/v1/devices/verify', async (req, res) => {
    const body = await HttpServer.parseBody(req).catch(() => ({}));
    const { deviceId, payload, signature, deviceToken } = body;

    if (!deviceId) {
      HttpServer.json(res, 400, { error: 'deviceId is required' });
      return;
    }

    const device = ctx.deviceRepo.findById(deviceId);
    if (!device || device.status !== 'ACTIVE') {
      HttpServer.json(res, 404, { valid: false, error: 'Device not found or inactive' });
      return;
    }

    let tokenValid = true;
    if (deviceToken && device.deviceToken !== deviceToken) {
      tokenValid = false;
    }

    let signatureValid = true;
    if (signature && payload) {
      signatureValid = verifyDeviceSignature(device.publicKey, payload, signature);
    }

    const isValid = tokenValid && signatureValid;

    HttpServer.json(res, isValid ? 200 : 401, {
      valid: isValid,
      deviceId: device.id,
      customerId: device.customerId,
      tokenValid,
      signatureValid
    });
  });

  // 3. GET /api/v1/devices/:id
  server.get('/api/v1/devices/:id', async (req, res, params) => {
    const device = ctx.deviceRepo.findById(params.id);
    if (!device) {
      HttpServer.json(res, 404, { error: 'Device not found' });
      return;
    }

    HttpServer.json(res, 200, {
      id: device.id,
      customerId: device.customerId,
      fingerprintHash: device.fingerprintHash,
      platform: device.platform,
      timezone: device.timezone,
      language: device.language,
      status: device.status,
      createdAt: device.createdAt,
      lastSeenAt: device.lastSeenAt
    });
  });

  // 4. GET /api/v1/devices/customer/:customerId
  server.get('/api/v1/devices/customer/:customerId', async (req, res, params) => {
    const devices = ctx.deviceRepo.findByCustomerId(params.customerId);
    HttpServer.json(res, 200, {
      customerId: params.customerId,
      count: devices.length,
      devices: devices.map(d => ({
        id: d.id,
        fingerprintHash: d.fingerprintHash,
        platform: d.platform,
        timezone: d.timezone,
        status: d.status,
        createdAt: d.createdAt,
        lastSeenAt: d.lastSeenAt
      }))
    });
  });
}
