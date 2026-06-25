import { api } from "../../../api/client";

export function createBooking(body: unknown) {
  return api("/bookings", { method: "POST", body });
}

export function extendBooking(bookingId: string, body: unknown) {
  return api(`/bookings/${bookingId}/extend`, { method: "POST", body });
}

export function cancelBooking(bookingId: string, body: unknown) {
  return api(`/bookings/${bookingId}/cancel`, { method: "POST", body, queueOnFailure: true });
}

export function getInvoice(bookingId: string, gst = false) {
  return api(`/bookings/${bookingId}/invoice${gst ? "?gst=true" : ""}`);
}
