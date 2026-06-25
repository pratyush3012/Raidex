import { api, clearToken, saveToken } from "./client";
import { clearQueue, getQueue, setCached } from "../utils/offline";

const ok = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

describe("critical flow API integration mocks", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await clearToken();
    await clearQueue();
    await saveToken("access_critical");
    global.fetch = jest.fn();
  });

  it.each([
    ["Authentication", "/auth/login", "POST", { email: "rider@example.com", password: "secret1" }, false],
    ["KYC", "/kyc/submit", "POST", { aadhaar_last4: "1234", dl_number: "DL1234567" }, true],
    ["Vehicle Discovery", "/vehicles?q=Nexon&max_price=1200", "GET", undefined, true],
    ["Booking Creation", "/bookings", "POST", { vehicle_id: "veh_1", plan: "daily" }, true],
    ["Payment Flow", "/payments/create", "POST", { booking_id: "bkg_1", amount: 1180, idempotency_key: "idem_1" }, true],
    ["Booking Extension", "/bookings/bkg_1/extend", "POST", { end_date: "2026-07-03T00:00:00+00:00" }, true],
    ["Booking Cancellation", "/bookings/bkg_1/cancel", "POST", { reason: "Plan changed" }, true],
    ["Invoice Generation", "/bookings/bkg_1/invoice", "GET", undefined, true],
    ["GST Invoice", "/bookings/bkg_1/invoice?gst=true", "GET", undefined, true],
    ["Reviews", "/vehicles/veh_1/reviews", "POST", { booking_id: "bkg_1", rating: 5, comment: "Great" }, true],
    ["Wishlist", "/wishlist/veh_1", "POST", undefined, true],
    ["Referrals", "/referrals", "POST", { referred_email: "friend@example.com" }, true],
    ["Coupons", "/coupons/validate", "POST", { code: "FIRST100", amount: 250 }, true],
    ["Disputes", "/bookings/bkg_1/disputes", "POST", { booking_id: "bkg_1", category: "refund", message: "Refund pending" }, true],
    ["Admin Approval Actions", "/admin/kyc/kyc_1/approve", "POST", undefined, true],
  ])("sends %s request with correct auth, method, and payload", async (_name, path, method, body, shouldAuth) => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(ok({ ok: true }));

    await api(path, { method, body, auth: shouldAuth });

    expect(global.fetch).toHaveBeenCalledWith(
      `https://api.raidex.test/api${path}`,
      expect.objectContaining({
        method,
        headers: expect.objectContaining(
          shouldAuth ? { Authorization: "Bearer access_critical" } : { "Content-Type": "application/json" },
        ),
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
  });

  it("surfaces validation failures from critical endpoints", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(ok({ detail: "End date must be after start date" }, 400));

    await expect(api("/bookings", {
      method: "POST",
      body: { vehicle_id: "veh_1", plan: "daily", start_date: "2026-07-03", end_date: "2026-07-01" },
    })).rejects.toThrow("End date must be after start date");
  });

  it("surfaces unauthorized access when refresh is unavailable", async () => {
    await clearToken();
    (global.fetch as jest.Mock).mockResolvedValueOnce(ok({ detail: "Missing or invalid auth header" }, 401));

    await expect(api("/admin/vehicles/veh_1/approve", { method: "POST" })).rejects.toThrow("Missing or invalid auth header");
  });

  it("queues write operations during network failure", async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("network down"));

    const result = await api("/payments/create", {
      method: "POST",
      body: { amount: 1180, booking_id: "bkg_1" },
      queueOnFailure: true,
    });

    expect(result).toEqual({ queued: true });
    expect(await getQueue()).toHaveLength(1);
  });

  it("returns cached discovery data when network fails", async () => {
    await setCached("GET:/vehicles?q=Nexon", [{ vehicle_id: "veh_1" }]);
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("api down"));

    await expect(api("/vehicles?q=Nexon", { cache: true })).resolves.toEqual([{ vehicle_id: "veh_1" }]);
  });
});
