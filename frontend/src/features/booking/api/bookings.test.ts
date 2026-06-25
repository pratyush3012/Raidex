import { api } from "../../../api/client";
import { cancelBooking, createBooking, extendBooking, getInvoice } from "./bookings";

jest.mock("../../../api/client", () => ({ api: jest.fn() }));

describe("booking feature api", () => {
  beforeEach(() => jest.clearAllMocks());

  it("routes booking lifecycle calls through the shared client", () => {
    createBooking({ vehicle_id: "veh_1" });
    extendBooking("bkg_1", { end_date: "2026-07-03" });
    cancelBooking("bkg_1", { reason: "Plan changed" });
    getInvoice("bkg_1", true);

    expect(api).toHaveBeenNthCalledWith(1, "/bookings", { method: "POST", body: { vehicle_id: "veh_1" } });
    expect(api).toHaveBeenNthCalledWith(2, "/bookings/bkg_1/extend", { method: "POST", body: { end_date: "2026-07-03" } });
    expect(api).toHaveBeenNthCalledWith(3, "/bookings/bkg_1/cancel", { method: "POST", body: { reason: "Plan changed" }, queueOnFailure: true });
    expect(api).toHaveBeenNthCalledWith(4, "/bookings/bkg_1/invoice?gst=true");
  });
});
