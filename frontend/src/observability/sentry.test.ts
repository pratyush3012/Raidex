describe("observability", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it("is a no-op without a DSN", () => {
    process.env.EXPO_PUBLIC_SENTRY_DSN = "";
    const Sentry = require("@sentry/react-native");
    const { captureError, initObservability, wrapRoot } = require("./sentry");
    const Component = () => null;

    initObservability();
    captureError(new Error("boom"));

    expect(Sentry.init).not.toHaveBeenCalled();
    expect(wrapRoot(Component)).toBe(Component);
  });

  it("initializes, wraps root, and captures scoped errors when configured", () => {
    process.env.EXPO_PUBLIC_SENTRY_DSN = "https://example@sentry.test/1";
    process.env.EXPO_PUBLIC_ENV = "test";
    process.env.EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE = "0.5";
    const Sentry = require("@sentry/react-native");
    const { captureError, initObservability, wrapRoot } = require("./sentry");

    initObservability();
    captureError(new Error("boom"), { path: "/bookings" });
    const Component = () => null;
    wrapRoot(Component);

    expect(Sentry.init).toHaveBeenCalledWith(expect.objectContaining({ dsn: "https://example@sentry.test/1" }));
    expect(Sentry.withScope).toHaveBeenCalled();
    expect(Sentry.wrap).toHaveBeenCalledWith(Component);
  });
});
