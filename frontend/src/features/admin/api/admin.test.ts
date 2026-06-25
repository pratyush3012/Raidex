import { api } from "../../../api/client";
import { approveKyc, approveVehicle, updateDispute } from "./admin";

jest.mock("../../../api/client", () => ({ api: jest.fn() }));

describe("admin feature api", () => {
  beforeEach(() => jest.clearAllMocks());

  it("routes approval operations through the shared client", () => {
    approveVehicle("veh_1");
    approveKyc("kyc_1");
    updateDispute("dsp_1", { status: "resolved" });

    expect(api).toHaveBeenNthCalledWith(1, "/admin/vehicles/veh_1/approve", { method: "POST" });
    expect(api).toHaveBeenNthCalledWith(2, "/admin/kyc/kyc_1/approve", { method: "POST" });
    expect(api).toHaveBeenNthCalledWith(3, "/admin/disputes/dsp_1", { method: "PATCH", body: { status: "resolved" } });
  });
});
