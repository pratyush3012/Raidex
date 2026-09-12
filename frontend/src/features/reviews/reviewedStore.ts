// Lightweight in-memory tracker for "have I already reviewed this booking"
// within the current app session. The backend has no "is this booking
// reviewed" flag on /bookings, so we track it client-side: mark a booking
// reviewed right after a successful submission (or after the backend tells
// us via a 409 that one already exists) and consult it when deciding whether
// to show the "Write a review" action.
const reviewedBookingIds = new Set<string>();

export function markBookingReviewed(bookingId: string) {
  reviewedBookingIds.add(bookingId);
}

export function isBookingReviewed(bookingId: string) {
  return reviewedBookingIds.has(bookingId);
}
