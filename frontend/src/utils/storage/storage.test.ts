import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

import { storage } from "./index";

describe("storage wrapper", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.removeItem("plain");
    await SecureStore.deleteItemAsync("secret");
  });

  it("round trips plain and secure values", async () => {
    await expect(storage.setItem("plain", 42)).resolves.toBe(true);
    await expect(storage.getItem("plain", 0)).resolves.toBe(42);

    await expect(storage.secureSet("secret", "token")).resolves.toBe(true);
    await expect(storage.secureGet("secret", "")).resolves.toBe("token");
  });

  it("returns fallbacks when values are missing or invalid", async () => {
    await AsyncStorage.setItem("plain", "{");

    await expect(storage.getItem("missing", "fallback")).resolves.toBe("fallback");
    await expect(storage.getItem("plain", "fallback")).resolves.toBe("fallback");
  });

  it("removes values safely", async () => {
    await storage.setItem("plain", true);
    await storage.secureSet("secret", "token");

    await expect(storage.removeItem("plain")).resolves.toBe(true);
    await expect(storage.secureRemove("secret")).resolves.toBe(true);
    await expect(storage.getItem("plain", false)).resolves.toBe(false);
    await expect(storage.secureGet("secret", null)).resolves.toBeNull();
  });
});
