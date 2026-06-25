import { api } from "../../../api/client";

export function approveVehicle(vehicleId: string) {
  return api(`/admin/vehicles/${vehicleId}/approve`, { method: "POST" });
}

export function approveKyc(kycId: string) {
  return api(`/admin/kyc/${kycId}/approve`, { method: "POST" });
}

export function updateDispute(disputeId: string, body: unknown) {
  return api(`/admin/disputes/${disputeId}`, { method: "PATCH", body });
}
