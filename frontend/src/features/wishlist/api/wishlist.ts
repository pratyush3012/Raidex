import { api } from "../../../api/client";

export function getWishlist() {
  return api("/wishlist", { cache: true });
}

export function addWishlist(vehicleId: string) {
  return api(`/wishlist/${vehicleId}`, { method: "POST", queueOnFailure: true });
}

export function removeWishlist(vehicleId: string) {
  return api(`/wishlist/${vehicleId}`, { method: "DELETE", queueOnFailure: true });
}
