import { api } from "../../../api/client";

export function createPayment(body: unknown) {
  return api("/payments/create", { method: "POST", body, queueOnFailure: true });
}

export function confirmPayment(paymentId: string, body: unknown) {
  return api(`/payments/${paymentId}/confirm`, { method: "POST", body });
}

export function getPayment(paymentId: string) {
  return api(`/payments/${paymentId}`);
}
