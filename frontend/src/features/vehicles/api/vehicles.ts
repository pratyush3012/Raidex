import { api } from "../../../api/client";

export function listVehicles(query = "") {
  return api(`/vehicles${query}`, { cache: true });
}

export function getVehicle(vehicleId: string) {
  return api(`/vehicles/${vehicleId}`, { cache: true });
}

export function getVehicleAvailability(vehicleId: string, startDate: string, endDate: string) {
  return api(`/vehicles/${vehicleId}/availability?start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}`);
}
