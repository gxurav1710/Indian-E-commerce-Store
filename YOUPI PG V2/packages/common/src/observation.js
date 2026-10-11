import crypto from 'node:crypto';

/**
 * Calculates a deterministic fingerprint for an observation to prevent duplicate processing.
 * If bankReferenceNumber exists, it hashes receivingAccount + amount + referenceNumber.
 * Otherwise, it hashes receivingAccount + amount + 60-second time bucket.
 * @param {{
 *   receivingAccountId: string,
 *   amountPaise: bigint,
 *   bankReferenceNumber?: string,
 *   observedAt: Date
 * }} input
 * @returns {string}
 */
export function calculateObservationFingerprint(input) {
  let entropy;
  if (input.bankReferenceNumber && input.bankReferenceNumber.trim().length > 0) {
    entropy = `REF:${input.bankReferenceNumber.trim().toUpperCase()}`;
  } else {
    // 60-second temporal cluster bucket partitioned by channel source
    const bucket = Math.floor(input.observedAt.getTime() / 60000);
    entropy = `TIME_BUCKET:${bucket}:${input.source || ''}`;
  }

  const raw = `${input.receivingAccountId}:${input.amountPaise.toString()}:${entropy}`;
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}
