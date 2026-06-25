import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { clearQueue, enqueueRequest, getCached, getQueue, isOnline, setCached } from "./offline";

describe("offline retry queue", () => {
  beforeEach(async () => {
    await clearQueue();
  });

  it("stores failed write requests for later replay", async () => {
    await enqueueRequest({ path: "/bookings/bkg_123/cancel", method: "POST", body: { reason: "network" } });
    const queue = await getQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].path).toBe("/bookings/bkg_123/cancel");
    expect(queue[0].method).toBe("POST");
  });

  it("returns cached values and tolerates corrupted cache entries", async () => {
    await setCached("GET:/vehicles", [{ vehicle_id: "veh_1" }]);
    const cached = await getCached<{ value: any[] }>("GET:/vehicles");
    expect(cached?.value[0].vehicle_id).toBe("veh_1");

    await AsyncStorage.setItem("raidex_cache:bad", "{");
    await expect(getCached("bad")).resolves.toBeNull();
  });

  it("detects offline state when internet is unreachable", async () => {
    (NetInfo.fetch as jest.Mock).mockResolvedValueOnce({ isConnected: true, isInternetReachable: false });
    await expect(isOnline()).resolves.toBe(false);
  });
});
