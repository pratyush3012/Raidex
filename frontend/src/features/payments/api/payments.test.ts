import { api } from "../../../api/client";
import { confirmPayment, createPayment, getPayment } from "./payments";

jest.mock("../../../api/client", () => ({ api: jest.fn() }));

describe("payments feature api", () => {
  beforeEach(() => jest.clearAllMocks());

  it("routes payment calls through the shared client", () => {
    createPayment({ amount: 1180 });
    confirmPayment("pay_1", { force_outcome: "success" });
    getPayment("pay_1");

    expect(api).toHaveBeenNthCalledWith(1, "/payments/create", { method: "POST", body: { amount: 1180 }, queueOnFailure: true });
    expect(api).toHaveBeenNthCalledWith(2, "/payments/pay_1/confirm", { method: "POST", body: { force_outcome: "success" } });
    expect(api).toHaveBeenNthCalledWith(3, "/payments/pay_1");
  });
});
