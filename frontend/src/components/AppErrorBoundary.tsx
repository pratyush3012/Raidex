import React from "react";
import { Pressable, Text, View } from "react-native";
import { captureError } from "@/src/observability/sentry";
import { useTheme } from "@/src/theme";

type State = { error: Error | null };

class Boundary extends React.Component<{ children: React.ReactNode; c: any }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    captureError(error, { componentStack: info.componentStack });
  }

  render() {
    if (!this.state.error) return this.props.children;
    const c = this.props.c;
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 28, backgroundColor: c.surface }}>
        <Text style={{ color: c.onSurface, fontSize: 22, fontWeight: "800", textAlign: "center" }}>Something went wrong</Text>
        <Text style={{ color: c.onSurface3, marginTop: 8, textAlign: "center" }}>
          Raidex recovered the screen. Please retry.
        </Text>
        <Pressable
          onPress={() => this.setState({ error: null })}
          style={{ marginTop: 20, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, backgroundColor: c.inverse }}
        >
          <Text style={{ color: c.onInverse, fontWeight: "800" }}>Retry</Text>
        </Pressable>
      </View>
    );
  }
}

export function AppErrorBoundary({ children }: { children: React.ReactNode }) {
  const c = useTheme();
  return <Boundary c={c}>{children}</Boundary>;
}
