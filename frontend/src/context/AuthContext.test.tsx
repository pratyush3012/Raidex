import React from "react";
import { Button, Text, View } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

import { AuthProvider, useAuth } from "./AuthContext";
import { api, clearToken, getToken, saveRefreshToken, saveToken } from "../api/client";

jest.mock("../api/client", () => ({
  api: jest.fn(),
  saveToken: jest.fn(async () => undefined),
  saveRefreshToken: jest.fn(async () => undefined),
  clearToken: jest.fn(async () => undefined),
  getToken: jest.fn(async () => null),
}));

const user = {
  user_id: "usr_1",
  email: "rider@example.com",
  name: "Rider",
  role: "customer",
  kyc_status: "verified",
  wallet_balance: 500,
  ride_miles: 250,
  tier: "Silver",
};

let latestAuth: ReturnType<typeof useAuth> | null = null;

function Consumer() {
  const auth = useAuth();
  latestAuth = auth;
  return (
    <View>
      <Text testID="status">{auth.loading ? "loading" : auth.user?.email ?? "signed-out"}</Text>
      <Button title="login" onPress={() => auth.login("rider@example.com", "secret1")} />
      <Button title="register" onPress={() => auth.register("new@example.com", "secret1", "New User")} />
      <Button title="logout" onPress={() => auth.logout()} />
    </View>
  );
}

async function renderAuth() {
  let tree: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<AuthProvider><Consumer /></AuthProvider>);
    await Promise.resolve();
  });
  return tree!;
}

function statusText(tree: TestRenderer.ReactTestRenderer) {
  return tree.root.findByProps({ testID: "status" }).props.children;
}

describe("AuthProvider critical hook/component behavior", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    latestAuth = null;
    (getToken as jest.Mock).mockResolvedValue(null);
  });

  it("renders signed-out state when no stored token exists", async () => {
    const tree = await renderAuth();

    expect(statusText(tree)).toBe("signed-out");
    expect(api).not.toHaveBeenCalledWith("/auth/me");
    expect(latestAuth?.user).toBeNull();
  });

  it("restores authenticated sessions from token", async () => {
    (getToken as jest.Mock).mockResolvedValue("access_123");
    (api as jest.Mock).mockResolvedValueOnce(user);

    const tree = await renderAuth();

    expect(statusText(tree)).toBe("rider@example.com");
    expect(latestAuth?.user?.email).toBe("rider@example.com");
    expect(api).toHaveBeenCalledWith("/auth/me");
  });

  it("logs in, persists tokens, and updates component state", async () => {
    (api as jest.Mock).mockResolvedValueOnce({ access_token: "access_123", refresh_token: "refresh_123", user });
    const tree = await renderAuth();

    await act(async () => {
      await latestAuth?.login("rider@example.com", "secret1");
    });

    expect(statusText(tree)).toBe("rider@example.com");
    expect(api).toHaveBeenCalledWith("/auth/login", {
      method: "POST",
      body: { email: "rider@example.com", password: "secret1" },
      auth: false,
    });
    expect(saveToken).toHaveBeenCalledWith("access_123");
    expect(saveRefreshToken).toHaveBeenCalledWith("refresh_123");
  });

  it("clears tokens and user state when refresh fails", async () => {
    (getToken as jest.Mock).mockResolvedValue("expired");
    (api as jest.Mock).mockRejectedValueOnce(new Error("Unauthorized"));

    const tree = await renderAuth();

    expect(statusText(tree)).toBe("signed-out");
    expect(latestAuth?.user).toBeNull();
    expect(clearToken).toHaveBeenCalled();
  });

  it("logs out even if server logout request fails", async () => {
    (api as jest.Mock)
      .mockResolvedValueOnce({ access_token: "access_123", refresh_token: "refresh_123", user })
      .mockRejectedValueOnce(new Error("network down"));
    const tree = await renderAuth();

    await act(async () => {
      await latestAuth?.login("rider@example.com", "secret1");
    });
    expect(statusText(tree)).toBe("rider@example.com");

    await act(async () => {
      await latestAuth?.logout();
    });

    expect(statusText(tree)).toBe("signed-out");
    expect(clearToken).toHaveBeenCalled();
  });
});
