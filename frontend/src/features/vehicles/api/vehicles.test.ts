import { api } from "../../../api/client";
import { getVehicle, getVehicleAvailability, listVehicles } from "./vehicles";

jest.mock("../../../api/client", () => ({ api: jest.fn() }));

describe("vehicles feature api", () => {
  beforeEach(() => jest.clearAllMocks());

  it("routes discovery calls through the shared client", () => {
    listVehicles("?q=Nexon");
    getVehicle("veh_1");
    getVehicleAvailability("veh_1", "2026-07-01", "2026-07-02");

    expect(api).toHaveBeenNthCalledWith(1, "/vehicles?q=Nexon", { cache: true });
    expect(api).toHaveBeenNthCalledWith(2, "/vehicles/veh_1", { cache: true });
    expect(api).toHaveBeenNthCalledWith(3, "/vehicles/veh_1/availability?start_date=2026-07-01&end_date=2026-07-02");
  });
});
