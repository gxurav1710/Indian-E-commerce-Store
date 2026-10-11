import { PaymentStatus, PublicPaymentOutcome, PaymentMethod, ObserverSource, TicketStatus, SenderType } from './enums.js';

// --- Merchant API Contracts ---
export interface CreatePaymentRequest {
  orderId: string;
  amount: string | number; // e.g. "200.00" or 200
  currency?: string;
  returnUrl?: string;
  method?: PaymentMethod;
  customer?: {
    phoneNumber: string;
    fullName?: string;
  };
  metadata?: Record<string, unknown>;
}

export interface CreatePaymentResponse {
  paymentId: string;
  orderId: string;
  amount: string;
  amountPaise: string;
  currency: string;
  status: PaymentStatus;
  checkoutUrl: string;
}

export interface QueryPaymentResponse {
  paymentId: string;
  orderId: string;
  amount: string;
  currency: string;
  status: PublicPaymentOutcome | PaymentStatus;
  method: PaymentMethod;
  completedAt?: string;
  metadata?: Record<string, unknown>;
}

// --- Checkout Portal Contracts ---
export interface CheckoutStateResponse {
  paymentId: string;
  orderId: string;
  merchantName: string;
  amount: string;
  amountPaise: string;
  currency: string;
  status: PaymentStatus;
  method: PaymentMethod;
  queuePosition: number;
  timeRemainingSeconds: number;
  upiUri?: string;
  payeeVpa?: string;
  payeeName?: string;
  canClickPaymentDone: boolean;
  branding: {
    appName: string;
    primaryColor: string;
    logoUrl?: string;
  };
}

// --- Webhook Payload Contract ---
export interface WebhookEventPayload {
  event: PublicPaymentOutcome;
  paymentId: string;
  orderId: string;
  amount: string;
  amountPaise: number;
  currency: string;
  method: PaymentMethod;
  completedAt?: string;
  metadata?: Record<string, unknown>;
}

// --- Observer Payload Contracts ---
export interface AndroidObservationPayload {
  deviceId: string;
  source: ObserverSource.ANDROID;
  amountPaise: number;
  observedAt: string;
  observationId?: string;
  senderVpa?: string;
  bankReferenceNumber?: string;
  rawNotification?: Record<string, unknown>;
}

export interface AndroidHeartbeatPayload {
  deviceId: string;
  timestamp: string;
  batteryLevel?: number;
  appVersion?: string;
}

// --- Customer & Support Contracts ---
export interface CustomerProfile {
  id: string;
  name: string;
  email: string;
  mobileNumber: string;
  status: string;
  lastLoginAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerRegisterRequest {
  name: string;
  email: string;
  mobileNumber: string;
  password: string;
}

export interface CustomerLoginRequest {
  identifier?: string;
  email?: string;
  mobileNumber?: string;
  password: string;
}

export interface CustomerSessionDto {
  id: string;
  customerId: string;
  token: string;
  expiresAt: string;
  isActive: boolean;
  createdAt: string;
}

/**
 * Normalizes an email address to trimmed lowercase.
 */
export function normalizeEmail(email: string | null | undefined): string {
  if (!email || typeof email !== 'string') return '';
  return email.trim().toLowerCase();
}

/**
 * Validates email format with standard requirements.
 */
export function isValidEmail(email: string | null | undefined): boolean {
  const norm = normalizeEmail(email);
  if (!norm) return false;
  return /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(norm);
}

/**
 * Normalizes a mobile number to canonical 10 digits (stripping prefixes and country codes).
 */
export function normalizeMobile(mobile: string | null | undefined): string {
  if (!mobile) return '';
  const cleaned = String(mobile).replace(/\D/g, '');
  if (cleaned.length >= 10) {
    return cleaned.slice(-10);
  }
  return cleaned;
}

/**
 * Validates canonical Indian 10-digit mobile number format.
 */
export function isValidMobile(mobile: string | null | undefined): boolean {
  const norm = normalizeMobile(mobile);
  return /^[6-9]\d{9}$/.test(norm);
}

/**
 * Validates password strength (minimum 6 characters).
 */
export function isValidPassword(password: string | null | undefined): boolean {
  return typeof password === 'string' && password.length >= 6;
}

export interface SupportTicketSummary {
  id: string;
  subject: string;
  status: TicketStatus;
  paymentId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TicketMessageDto {
  id: string;
  ticketId: string;
  senderType: SenderType;
  senderId: string;
  message: string;
  createdAt: string;
}
