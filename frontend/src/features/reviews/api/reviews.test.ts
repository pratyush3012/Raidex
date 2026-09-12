import { api } from "../../../api/client";
import { createVehicleReview, getVehicleReviews } from "./reviews";

jest.mock("../../../api/client", () => ({ api: jest.fn() }));

describe("reviews feature api", () => {
  beforeEach(() => jest.clearAllMocks());

  it("routes review reads through the shared client with caching", () => {
    getVehicleReviews("veh_1");
    expect(api).toHaveBeenCalledWith("/vehicles/veh_1/reviews", { cache: true });
  });

  it("routes review submission through the shared client", () => {
    const body = { booking_id: "bkg_1", rating: 5, comment: "Great trip" };
    createVehicleReview("veh_1", body);
    expect(api).toHaveBeenCalledWith("/vehicles/veh_1/reviews", { method: "POST", body });
  });
});
