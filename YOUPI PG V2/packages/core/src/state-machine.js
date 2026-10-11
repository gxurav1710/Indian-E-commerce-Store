import { PaymentStatus, PublicPaymentOutcome } from '@youpi/common';

/**
 * Valid transitions graph for Payment Sessions:
 * Key: Source State
 * Value: Array of allowed Target States
 */
export const VALID_TRANSITIONS = Object.freeze({
  [PaymentStatus.INITIATED]: [
    PaymentStatus.ACTIVE,
    PaymentStatus.QUEUED,
    PaymentStatus.CANCELLED
  ],
  [PaymentStatus.QUEUED]: [
    PaymentStatus.ACTIVE,
    PaymentStatus.CANCELLED
  ],
  [PaymentStatus.ACTIVE]: [
    PaymentStatus.PROCESSING,
    PaymentStatus.EXPIRED,
    PaymentStatus.CANCELLED
  ],
  [PaymentStatus.PROCESSING]: [
    PaymentStatus.SUCCESS,
    PaymentStatus.FAILED
  ],
  [PaymentStatus.SUCCESS]: [],
  [PaymentStatus.FAILED]: [],
  [PaymentStatus.EXPIRED]: [],
  [PaymentStatus.CANCELLED]: []
});

/**
 * Validates whether a state transition is permitted by the core state machine.
 * @param {string} currentState
 * @param {string} nextState
 * @returns {boolean}
 */
export function isValidTransition(currentState, nextState) {
  const allowed = VALID_TRANSITIONS[currentState];
  if (!allowed) return false;
  return allowed.includes(nextState);
}

/**
 * Asserts a valid transition, throwing a detailed domain error if violated.
 * @param {string} currentState
 * @param {string} nextState
 */
export function assertValidTransition(currentState, nextState) {
  if (!isValidTransition(currentState, nextState)) {
    throw new Error(
      `Illegal payment state transition: Cannot move from '${currentState}' to '${nextState}'.`
    );
  }
}

/**
 * Checks whether a payment status is a final, terminal outcome.
 * @param {string} status
 * @returns {boolean}
 */
export function isTerminalStatus(status) {
  return [
    PaymentStatus.SUCCESS,
    PaymentStatus.FAILED,
    PaymentStatus.EXPIRED,
    PaymentStatus.CANCELLED
  ].includes(status);
}

/**
 * Converts internal payment status to the public contract outcome.
 * Throws if the status is not terminal.
 * @param {string} status
 * @returns {string}
 */
export function toPublicOutcome(status) {
  switch (status) {
    case PaymentStatus.SUCCESS:
      return PublicPaymentOutcome.SUCCESS;
    case PaymentStatus.FAILED:
      return PublicPaymentOutcome.FAILED;
    case PaymentStatus.EXPIRED:
      return PublicPaymentOutcome.EXPIRED;
    case PaymentStatus.CANCELLED:
      return PublicPaymentOutcome.CANCELLED;
    default:
      throw new Error(`Status '${status}' is an internal non-terminal state and cannot be mapped to a public outcome.`);
  }
}
