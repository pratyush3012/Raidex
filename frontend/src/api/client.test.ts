import { api, saveRefreshToken, saveToken } from "./client";
import { clearQueue, getQueue } from "../utils/offline";

describe("api client resilience", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await clearQueue();
    global.fetch = jest.fn();
  });

  it("saves tokens and sends authenticated requests", async () => {
    await saveToken("access_123");
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });

    await api("/bookings");

    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.raidex.test/api/bookings",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer access_123" }),
      }),
    );
  });

  it("refreshes an expired access token once and retries", async () => {
    await saveToken("expired");
    await saveRefreshToken("refresh_123");
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ detail: "expired" }) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ access_token: "fresh", refresh_token: "refresh_123" }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ user_id: "usr_1" }) });

    const result = await api("/auth/me");

    expect(result).toEqual({ user_id: "usr_1" });
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it("queues failed writes when queueOnFailure is enabled", async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("network down"));

    const result = await api("/bookings/bkg_1/cancel", {
      method: "POST",
      body: { reason: "offline" },
      queueOnFailure: true,
    });

    expect(result).toEqual({ queued: true });
    expect(await getQueue()).toHaveLength(1);
  });
});
