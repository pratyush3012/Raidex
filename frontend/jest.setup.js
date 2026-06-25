import "@testing-library/jest-native/extend-expect";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (key) => mockSecureStorage.get(key) ?? null),
  setItemAsync: jest.fn(async (key, value) => mockSecureStorage.set(key, value)),
  deleteItemAsync: jest.fn(async (key) => mockSecureStorage.delete(key)),
}));

jest.mock("expo-font", () => ({
  isLoaded: jest.fn(() => true),
  loadAsync: jest.fn(async () => undefined),
}));

jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn(async () => ({ status: "denied" })),
  requestPermissionsAsync: jest.fn(async () => ({ status: "denied" })),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: "ExponentPushToken[test]" })),
}));

jest.mock("expo-constants", () => ({
  expoConfig: { extra: { eas: { projectId: "test-project" } } },
}));

jest.mock("expo-web-browser", () => ({
  openAuthSessionAsync: jest.fn(async () => ({ type: "cancel" })),
}));

jest.mock("expo-linking", () => ({
  createURL: jest.fn(() => "raidex://auth"),
}));

const mockSecureStorage = new Map();
const mockStorage = new Map();
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(async (key) => mockStorage.get(key) ?? null),
  setItem: jest.fn(async (key, value) => mockStorage.set(key, value)),
  removeItem: jest.fn(async (key) => mockStorage.delete(key)),
}));

jest.mock("@react-native-community/netinfo", () => ({
  fetch: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })),
  addEventListener: jest.fn(() => jest.fn()),
}));

jest.mock("@sentry/react-native", () => ({
  init: jest.fn(),
  captureException: jest.fn(),
  withScope: jest.fn((cb) => cb({ setExtra: jest.fn() })),
  wrap: jest.fn((component) => component),
}));

jest.mock("@expo/vector-icons", () => {
  const React = require("react");
  const { Text } = require("react-native");
  return {
    Ionicons: ({ name }) => React.createElement(Text, null, name),
  };
});
