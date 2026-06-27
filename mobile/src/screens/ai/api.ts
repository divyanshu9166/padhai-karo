/**
 * AI Notes + Subscription API wrappers (task 21.7).
 *
 * Co-located with the Notes-stack screens (AI notes summarizer + paywall) rather than in the
 * shared `src/api` barrel: these calls are only consumed by the two screens in this folder, so
 * keeping them here keeps the change self-contained. They still go through the shared typed
 * client (`request` from `@/api`), so the bearer token from `AuthContext`/`setAuthToken` is
 * attached automatically and non-2xx responses throw a typed {@link ApiError} the screens
 * branch on (402 UPGRADE_REQUIRED, 429 QUOTA_EXCEEDED, 422 EMPTY_INPUT, 402 PAYMENT_FAILED, …).
 *
 * Contracts mirror the Backend_API (design "AI Notes Service (Req 8, 9)" and
 * "Monetization / Subscription Service"):
 *
 *   POST /ai/summaries     { inputType: TEXT|PHOTO, text?, imageUploadId? }
 *                          -> 201 { summary, remainingQuota }
 *   GET  /ai/summaries     -> 200 { summaries[] }
 *   POST /subscriptions/order   { plan }                                    -> 201 { razorpayOrderId, amount }
 *   POST /subscriptions/verify  { razorpayOrderId, razorpayPaymentId, signature } -> 200 { tier, aiQuota }
 *   GET  /subscriptions    -> 200 { tier, aiQuota, payments[] }
 */

import { request } from '@/api';

// ── AI notes DTOs ─────────────────────────────────────────────────────────────────────────

/** Discriminator for a summarization request (Req 8.1 text / Req 8.2 photo). */
export type AiInputType = 'TEXT' | 'PHOTO';

/**
 * The structured summary returned by the model and stored as `NoteSummary.summary`
 * (Req 8.1/8.2/8.6). `keyPoints` is the required structured payload; `title` is optional. The
 * shape is intentionally permissive because the stored value is opaque JSON.
 */
export interface AiSummaryContent {
  keyPoints: string[];
  title?: string;
  [key: string]: unknown;
}

/** A persisted note summary. `createdAt` is an ISO-8601 string as serialized over JSON. */
export interface NoteSummary {
  id: string;
  userId: string;
  inputType: AiInputType;
  summary: AiSummaryContent;
  createdAt: string;
}

/** Body of `POST /ai/summaries` for a TEXT request. */
export interface CreateSummaryTextInput {
  inputType: 'TEXT';
  text: string;
}

/** Body of `POST /ai/summaries` for a PHOTO request (references an already-uploaded image). */
export interface CreateSummaryPhotoInput {
  inputType: 'PHOTO';
  imageUploadId: string;
}

export type CreateSummaryInput = CreateSummaryTextInput | CreateSummaryPhotoInput;

/** Response of `POST /ai/summaries` on success (201). */
export interface CreateSummaryResponse {
  summary: NoteSummary;
  /** The user's remaining AI quota after this summary was produced (Req 8.6). */
  remainingQuota: number;
}

/** Response of `GET /ai/summaries`. */
export interface ListSummariesResponse {
  summaries: NoteSummary[];
}

// ── Subscription DTOs ───────────────────────────────────────────────────────────────────────

/** The user's subscription tier (mirrors the server `SubscriptionTier` enum). */
export type SubscriptionTier = 'FREE' | 'PAID';

/** Purchasable plan ids accepted by `POST /subscriptions/order`. */
export type SubscriptionPlanId = 'monthly' | 'quarterly' | 'annual';

/** Lifecycle of a payment row (Req 9.6). */
export type PaymentStatus = 'CREATED' | 'CAPTURED' | 'FAILED' | 'REFUNDED';

/** A persisted payment. `createdAt`/`updatedAt` are ISO-8601 strings. */
export interface Payment {
  id: string;
  userId: string;
  subscriptionId: string | null;
  razorpayOrderId: string;
  razorpayPaymentId: string | null;
  amount: number;
  status: PaymentStatus;
  createdAt: string;
  updatedAt: string;
}

/** Response of `POST /subscriptions/order`: the order to hand to Razorpay checkout. */
export interface CreateOrderResponse {
  razorpayOrderId: string;
  /** Charge amount in the smallest currency unit (paise for INR). */
  amount: number;
}

/** Body of `POST /subscriptions/verify`. */
export interface VerifyPaymentInput {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  signature: string;
}

/** Response of `POST /subscriptions/verify` on a valid signature + applied upgrade (Req 9.5). */
export interface VerifyPaymentResponse {
  tier: SubscriptionTier;
  aiQuota: number;
}

/** Response of `GET /subscriptions`. */
export interface GetSubscriptionResponse {
  tier: SubscriptionTier;
  aiQuota: number;
  payments: Payment[];
}

/**
 * Client-side plan catalog mirroring the Backend_API plan catalog (amounts in paise, INR).
 * Used only to render the offer; the server remains the source of truth for the actual charge
 * and the quota allocated on a successful upgrade.
 */
export interface PlanDisplay {
  id: SubscriptionPlanId;
  label: string;
  /** Charge amount in paise (smallest INR unit). */
  amount: number;
  /** AI summaries granted on a successful upgrade. */
  aiQuota: number;
}

export const SUBSCRIPTION_PLANS: readonly PlanDisplay[] = [
  { id: 'monthly', label: 'Monthly', amount: 9900, aiQuota: 100 },
  { id: 'quarterly', label: 'Quarterly', amount: 24900, aiQuota: 350 },
  { id: 'annual', label: 'Annual', amount: 79900, aiQuota: 1500 },
];

// ── Calls ─────────────────────────────────────────────────────────────────────────────────

/** `POST /ai/summaries` — summarize note text or a photo (Req 8.1/8.2). */
export function createSummary(input: CreateSummaryInput): Promise<CreateSummaryResponse> {
  return request<CreateSummaryResponse>('/ai/summaries', { method: 'POST', body: input });
}

/** `GET /ai/summaries` — the authenticated user's prior summaries, newest first. */
export function listSummaries(): Promise<ListSummariesResponse> {
  return request<ListSummariesResponse>('/ai/summaries');
}

/** `POST /subscriptions/order` — create a Razorpay order for the chosen plan. */
export function createSubscriptionOrder(plan: SubscriptionPlanId): Promise<CreateOrderResponse> {
  return request<CreateOrderResponse>('/subscriptions/order', { method: 'POST', body: { plan } });
}

/** `POST /subscriptions/verify` — confirm a checkout payment and apply the upgrade (Req 9.5). */
export function verifySubscription(input: VerifyPaymentInput): Promise<VerifyPaymentResponse> {
  return request<VerifyPaymentResponse>('/subscriptions/verify', { method: 'POST', body: input });
}

/** `GET /subscriptions` — current tier, remaining AI quota, and payment history. */
export function getSubscription(): Promise<GetSubscriptionResponse> {
  return request<GetSubscriptionResponse>('/subscriptions');
}

// ── Placeholder integrations (documented assumptions) ───────────────────────────────────────

/**
 * PLACEHOLDER image picker/uploader.
 *
 * The upload backend is not specified by this task, and `POST /ai/summaries` for a PHOTO request
 * only needs an `imageUploadId` referencing an already-uploaded image. A production build would
 * (1) pick an image with `expo-image-picker`, (2) upload it to the image store, and (3) use the
 * returned id here. Until that flow exists this returns a synthetic id so the PHOTO → summarize
 * path can be exercised end to end against the API.
 */
export function pickAndUploadImagePlaceholder(): Promise<string> {
  return Promise.resolve(`placeholder-upload-${Date.now()}`);
}

/** The fields a Razorpay checkout returns to the client on a completed payment. */
export interface RazorpayCheckoutResult {
  razorpayPaymentId: string;
  signature: string;
}

/**
 * PLACEHOLDER for the native Razorpay checkout.
 *
 * Integrating the native Razorpay SDK (which launches the checkout UI and returns
 * `razorpay_payment_id` + `razorpay_signature`) is an operational concern outside this task's
 * scope. This stub returns synthetic values so the order → verify wiring runs end to end; a
 * production build replaces it with the real SDK call keyed off `orderId`. Because the synthetic
 * signature will not pass server-side HMAC verification, `verifySubscription` is expected to
 * return `402 PAYMENT_FAILED` against a real backend — the screen handles that outcome.
 */
export function runRazorpayCheckoutPlaceholder(orderId: string): Promise<RazorpayCheckoutResult> {
  return Promise.resolve({
    razorpayPaymentId: `pay_placeholder_${orderId}`,
    signature: 'placeholder_signature',
  });
}

/** Format a paise amount as a rough INR display string (e.g. 9900 → "₹99"). */
export function formatInrPaise(amountPaise: number): string {
  return `₹${Math.round(amountPaise / 100)}`;
}
