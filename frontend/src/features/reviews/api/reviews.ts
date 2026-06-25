import { api } from "../../../api/client";

export function getVehicleReviews(vehicleId: string) {
  return api(`/vehicles/${vehicleId}/reviews`, { cache: true });
}

export function createVehicleReview(vehicleId: string, body: unknown) {
  return api(`/vehicles/${vehicleId}/reviews`, { method: "POST", body });
}
