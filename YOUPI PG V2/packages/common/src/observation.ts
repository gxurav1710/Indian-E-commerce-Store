import crypto from 'node:crypto';
import { ObserverSource, ObservationAttributionStatus } from './enums.js';

export interface CanonicalObservation {
  id: string;
  receivingAccountId: string;
  source: ObserverSource;
  amountPaise: bigint;
  observedAt: Date;
  ingestedAt: Date;
  senderVpa?: string;
  bankReferenceNumber?: string;
  fingerprintHash: string;
  attributionStatus: ObservationAttributionStatus;
  attributedPaymentId?: string;
  rawPayload: Record<string, unknown>;
}

export interface IngestObservationInput {
  receivingAccountId: string;
  source: ObserverSource;
  amountPaise: bigint;
  observedAt: Date;
  senderVpa?: string;
  bankReferenceNumber?: string;
  rawPayload?: Record<string, unknown>;
}

/**
 * Calculates a deterministic fingerprint for an observation to prevent duplicate processing.
 * If bankReferenceNumber exists, it hashes receivingAccount + amount + referenceNumber.
 * Otherwise, it hashes receivingAccount + amount + 60-second time bucket.
 */
export function calculateObservationFingerprint(input: {
  receivingAccountId: string;
  amountPaise: bigint;
  source?: string;
  bankReferenceNumber?: string;
  observedAt: Date;
}): string {
  let entropy: string;
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
