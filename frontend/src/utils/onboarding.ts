// RAIDEX_ONBOARDING_STATUS
// Device-level "has this app been onboarded" flag - deliberately separate
// from auth token storage (expo-secure-store, see src/api/client.ts): this is
// not a credential, it belongs to the *device/install*, not the account, so
// it must survive logout and must never be cleared by clearToken().
// Uses AsyncStorage directly, matching the existing pattern in
// src/utils/offline.ts (cache + retry queue) rather than SecureStore.
import AsyncStorage from "@react-native-async-storage/async-storage";

const ONBOARDING_COMPLETE_KEY = "raidex_onboarding_complete";

export async function hasCompletedOnboarding(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ONBOARDING_COMPLETE_KEY)) === "1";
  } catch {
    // Fail open to "seen" would risk hiding onboarding forever on a storage
    // error; fail toward "not seen" is safer, but a broken storage layer is
    // rare enough that showing onboarding once more is an acceptable cost.
    return false;
  }
}

export async function markOnboardingComplete(): Promise<void> {
  try {
    await AsyncStorage.setItem(ONBOARDING_COMPLETE_KEY, "1");
  } catch {
    // Best-effort - if this fails, onboarding may show again next launch,
    // which is annoying but never blocks the user from using the app.
  }
}
