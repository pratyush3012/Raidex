describe("observability", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it("is a no-op without a DSN", () => {
    const Sentry = require("@sentry/react-native");
    const { captureError, initObservability, sentryConfig, wrapRoot } = require("./sentry");
    sentryConfig.dsn = "";
    const Component = () => null;

    initObservability();
    captureError(new Error("boom"));

    expect(Sentry.init).not.toHaveBeenCalled();
    expect(wrapRoot(Component)).toBe(Component);
  });

  it("initializes, wraps root, and captures scoped errors when configured", () => {
    // sentryConfig is a plain mutable object precisely so tests can override it
    // directly - process.env.EXPO_PUBLIC_* is inlined to a literal by babel-preset-expo
    // at transform time (even under Jest), so mutating process.env here would not
    // actually affect what the already-compiled module reads.
    const Sentry = require("@sentry/react-native");
    const { captureError, initObservability, sentryConfig, wrapRoot } = require("./sentry");
    sentryConfig.dsn = "https://example@sentry.test/1";
    sentryConfig.environment = "test";
    sentryConfig.tracesSampleRate = 0.5;

    initObservability();
    captureError(new Error("boom"), { path: "/bookings" });
    const Component = () => null;
    wrapRoot(Component);

    expect(Sentry.init).toHaveBeenCalledWith(expect.objectContaining({ dsn: "https://example@sentry.test/1" }));
    expect(Sentry.withScope).toHaveBeenCalled();
    expect(Sentry.wrap).toHaveBeenCalledWith(Component);
  });
});
