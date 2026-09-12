import { api } from "../../../api/client";

export function approveVehicle(vehicleId: string) {
  return api(`/admin/vehicles/${vehicleId}/approve`, { method: "POST" });
}

export function approveKyc(kycId: string) {
  return api(`/admin/kyc/${kycId}/approve`, { method: "POST" });
}

export function rejectKyc(kycId: string, reason: string) {
  return api(`/admin/kyc/${kycId}/reject`, { method: "POST", body: { reason } });
}

export function updateDispute(disputeId: string, body: unknown) {
  return api(`/admin/disputes/${disputeId}`, { method: "PATCH", body });
}

export function approveVehicleSwap(swapId: string) {
  return api(`/admin/vehicle-swaps/${swapId}/approve`, { method: "POST" });
}

export function rejectVehicleSwap(swapId: string, notes?: string) {
  return api(`/admin/vehicle-swaps/${swapId}/reject`, { method: "POST", body: { notes } });
}
