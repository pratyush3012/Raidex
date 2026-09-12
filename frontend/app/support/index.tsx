import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import Animated, { FadeInDown, useSharedValue, useAnimatedStyle, withDelay, withRepeat, withSequence, withTiming, Easing } from "react-native-reanimated";
import { useTheme, tokens } from "@/src/theme";
import { api } from "@/src/api/client";
import { RaidexInput, RaidexButton } from "@/src/components/ui";

type AgentKind = "support" | "operations" | "finance";

const AGENT_META: Record<AgentKind, { title: string; sub: string; icon: any; path: string; suggestions: string[] }> = {
  support: {
    title: "Raidex Support", sub: "Your AI assistant", icon: "headset", path: "/nexus/support/chat",
    suggestions: ["How do I get verified?", "Where is my refund?", "What is RideMiles?"],
  },
  operations: {
    title: "Operations Agent", sub: "Fleet & bookings analyst", icon: "analytics", path: "/nexus/ops/query",
    suggestions: ["How many active trips right now?", "Are there pending vehicle approvals?", "Any open geofence alerts?"],
  },
  finance: {
    title: "Finance Agent", sub: "Revenue & payouts analyst", icon: "cash", path: "/nexus/finance/query",
    suggestions: ["What is total gross revenue?", "How many failed payments?", "What's our refund exposure?"],
  },
};

type Msg = { role: "user" | "assistant"; content: string };

export default function SupportChat() {
  const { agent: agentParam } = useLocalSearchParams<{ agent?: AgentKind }>();
  const agent: AgentKind = (agentParam as AgentKind) || "support";
  const meta = AGENT_META[agent];
  const c = useTheme();
  const router = useRouter();
  const [thread, setThread] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => { setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100); }, [msgs, busy]);

  const send = async (text?: string) => {
    const message = (text ?? input).trim();
    if (!message || busy) return;
    setInput("");
    setMsgs((m) => [...m, { role: "user", content: message }]);
    setBusy(true);
    try {
      const res = await api<any>(meta.path, { method: "POST", body: { thread_id: thread, message } });
      setThread(res.thread_id);
      setMsgs((m) => [...m, { role: "assistant", content: res.reply }]);
    } catch (e: any) {
      setMsgs((m) => [...m, { role: "assistant", content: "Sorry — I hit an error: " + e.message }]);
    } finally { setBusy(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <SafeAreaView edges={["top"]} style={{ backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.border }}>
        <View style={{ flexDirection: "row", alignItems: "center", padding: 16, gap: 12 }}>
          <Pressable onPress={() => router.back()} testID="back-btn"><Ionicons name="chevron-back" size={26} color={c.onSurface} /></Pressable>
          <View style={[styles.iconRound, { backgroundColor: c.accentBg }]}><Ionicons name={meta.icon} size={20} color={c.onAccentBg} /></View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.onSurface, fontSize: 16, fontWeight: tokens.weight.bold }}>{meta.title}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: c.accent }} />
              <Text style={{ color: c.onSurface3, fontSize: 11 }}>{meta.sub} · Powered by Claude Sonnet</Text>
            </View>
          </View>
        </View>
      </SafeAreaView>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={20}>
        <ScrollView ref={scrollRef} contentContainerStyle={{ padding: 16, gap: 12 }}>
          {msgs.length === 0 && (
            <View>
              <View style={{ alignItems: "center", padding: 24 }}>
                <View style={[styles.heroIcon, { backgroundColor: c.accentBg }]}>
                  <Ionicons name="sparkles" size={32} color={c.onAccentBg} />
                </View>
                <Text style={{ color: c.onSurface, fontSize: 22, fontWeight: tokens.weight.bold, marginTop: 16, textAlign: "center" }}>How can I help?</Text>
                <Text style={{ color: c.onSurface3, fontSize: 13, marginTop: 6, textAlign: "center" }}>Ask me anything about your {agent === "support" ? "Raidex account, bookings, or rewards" : agent === "operations" ? "fleet, bookings, and operations" : "revenue, payouts, and refunds"}.</Text>
              </View>
              <Text style={{ color: c.onSurface3, fontSize: 11, fontWeight: tokens.weight.bold, letterSpacing: 1, marginTop: 16 }}>SUGGESTIONS</Text>
              {meta.suggestions.map((s) => (
                <Pressable key={s} testID={`sugg-${s.slice(0, 8)}`} onPress={() => send(s)} style={[styles.sugg, { backgroundColor: c.surface2, borderColor: c.border }]}>
                  <Text style={{ color: c.onSurface, fontWeight: tokens.weight.semibold }}>{s}</Text>
                  <Ionicons name="arrow-forward" size={14} color={c.onSurface3} />
                </Pressable>
              ))}
            </View>
          )}
          {msgs.map((m, i) => (
            <Animated.View key={i} entering={FadeInDown.duration(tokens.motion.base).easing(Easing.out(Easing.cubic))} style={{ flexDirection: m.role === "user" ? "row-reverse" : "row", marginVertical: 2 }}>
              {m.role === "assistant" && (
                <View style={[styles.avatarDot, { backgroundColor: c.accentBg }]}>
                  <Ionicons name="sparkles" size={12} color={c.onAccentBg} />
                </View>
              )}
              <View style={[styles.bubble, m.role === "user"
                ? { backgroundColor: c.inverse, borderBottomRightRadius: 4 }
                : { backgroundColor: c.surface2, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: c.border }]}>
                <Text style={{ color: m.role === "user" ? c.onInverse : c.onSurface, fontSize: 14, lineHeight: 20 }}>{m.content}</Text>
              </View>
            </Animated.View>
          ))}
          {busy && (
            <Animated.View entering={FadeInDown.duration(tokens.motion.quick)} style={{ flexDirection: "row" }}>
              <View style={[styles.avatarDot, { backgroundColor: c.accentBg }]}>
                <Ionicons name="sparkles" size={12} color={c.onAccentBg} />
              </View>
              <View style={[styles.bubble, { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.border, borderBottomLeftRadius: 4 }]}>
                <TypingDots color={c.onSurface3} />
              </View>
            </Animated.View>
          )}
        </ScrollView>

        <View style={{ padding: 12, borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.surface }}>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <View style={{ flex: 1, marginBottom: -tokens.spacing.md }}>
              <RaidexInput
                testID="chat-input"
                value={input}
                onChangeText={setInput}
                placeholder="Type your message…"
                multiline
                onSubmitEditing={() => send()}
              />
            </View>
            <RaidexButton
              testID="send-btn"
              label=""
              icon="arrow-up"
              fullWidth={false}
              disabled={!input.trim() || busy}
              onPress={() => send()}
              style={{ width: 44, height: 44, minWidth: 0, borderRadius: tokens.radius.pill }}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function TypingDots({ color }: { color: string }) {
  const d1 = useSharedValue(0.3);
  const d2 = useSharedValue(0.3);
  const d3 = useSharedValue(0.3);

  useEffect(() => {
    const pulse = (delay: number) =>
      withDelay(delay, withRepeat(withSequence(
        withTiming(1, { duration: 320, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.3, { duration: 320, easing: Easing.inOut(Easing.ease) })
      ), -1, false));
    d1.value = pulse(0);
    d2.value = pulse(120);
    d3.value = pulse(240);
  }, [d1, d2, d3]);

  const s1 = useAnimatedStyle(() => ({ opacity: d1.value, transform: [{ scale: 0.6 + d1.value * 0.4 }] }));
  const s2 = useAnimatedStyle(() => ({ opacity: d2.value, transform: [{ scale: 0.6 + d2.value * 0.4 }] }));
  const s3 = useAnimatedStyle(() => ({ opacity: d3.value, transform: [{ scale: 0.6 + d3.value * 0.4 }] }));

  return (
    <View style={{ flexDirection: "row", gap: 5, paddingVertical: 3, paddingHorizontal: 2 }}>
      <Animated.View style={[styles.dot, { backgroundColor: color }, s1]} />
      <Animated.View style={[styles.dot, { backgroundColor: color }, s2]} />
      <Animated.View style={[styles.dot, { backgroundColor: color }, s3]} />
    </View>
  );
}

const styles = StyleSheet.create({
  iconRound: { width: 40, height: 40, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  heroIcon: { width: 72, height: 72, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  sugg: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 14, borderRadius: 14, borderWidth: 1, marginTop: 8 },
  bubble: { maxWidth: "82%", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 },
  avatarDot: { width: 22, height: 22, borderRadius: 999, alignItems: "center", justifyContent: "center", marginRight: 6, marginTop: 4 },
  dot: { width: 6, height: 6, borderRadius: 999 },
});
