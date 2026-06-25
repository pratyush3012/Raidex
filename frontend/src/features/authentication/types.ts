export type UserRole = "customer" | "owner" | "admin";

export type AuthUser = {
  user_id: string;
  email: string;
  name: string;
  avatar?: string | null;
  role: UserRole | string;
  kyc_status: string;
  wallet_balance: number;
  ride_miles: number;
  tier: string;
};
