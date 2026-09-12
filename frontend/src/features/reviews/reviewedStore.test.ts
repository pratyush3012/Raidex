import { isBookingReviewed, markBookingReviewed } from "./reviewedStore";

describe("reviewedStore", () => {
  it("reports a booking as not reviewed until it's explicitly marked", () => {
    expect(isBookingReviewed("bkg_unmarked")).toBe(false);
  });

  it("remembers a booking once marked reviewed", () => {
    markBookingReviewed("bkg_marked");
    expect(isBookingReviewed("bkg_marked")).toBe(true);
  });

  it("tracks bookings independently of each other", () => {
    markBookingReviewed("bkg_a");
    expect(isBookingReviewed("bkg_a")).toBe(true);
    expect(isBookingReviewed("bkg_b")).toBe(false);
  });
});
