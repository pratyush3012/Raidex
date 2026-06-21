import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTheme, tokens } from "@/src/theme";
import { api } from "@/src/api/client";

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

  useEffect(() => { setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100); }, [msgs]);

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
            <Text style={{ color: c.onSurface, fontSize: 16, fontWeight: "800" }}>{meta.title}</Text>
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
                <Text style={{ color: c.onSurface, fontSize: 22, fontWeight: "800", marginTop: 16, textAlign: "center" }}>How can I help?</Text>
                <Text style={{ color: c.onSurface3, fontSize: 13, marginTop: 6, textAlign: "center" }}>Ask me anything about your {agent === "support" ? "Raidex account, bookings, or rewards" : agent === "operations" ? "fleet, bookings, and operations" : "revenue, payouts, and refunds"}.</Text>
              </View>
              <Text style={{ color: c.onSurface3, fontSize: 11, fontWeight: "800", letterSpacing: 1, marginTop: 16 }}>SUGGESTIONS</Text>
              {meta.suggestions.map((s) => (
                <Pressable key={s} testID={`sugg-${s.slice(0, 8)}`} onPress={() => send(s)} style={[styles.sugg, { backgroundColor: c.surface2, borderColor: c.border }]}>
                  <Text style={{ color: c.onSurface, fontWeight: "600" }}>{s}</Text>
                  <Ionicons name="arrow-forward" size={14} color={c.onSurface3} />
                </Pressable>
              ))}
            </View>
          )}
          {msgs.map((m, i) => (
            <View key={i} style={{ flexDirection: m.role === "user" ? "row-reverse" : "row", marginVertical: 2 }}>
              <View style={[styles.bubble, m.role === "user"
                ? { backgroundColor: c.inverse, borderBottomRightRadius: 4 }
                : { backgroundColor: c.surface2, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: c.border }]}>
                <Text style={{ color: m.role === "user" ? c.onInverse : c.onSurface, fontSize: 14, lineHeight: 20 }}>{m.content}</Text>
              </View>
            </View>
          ))}
          {busy && (
            <View style={{ flexDirection: "row" }}>
              <View style={[styles.bubble, { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.border }]}>
                <ActivityIndicator color={c.accent} size="small" />
              </View>
            </View>
          )}
        </ScrollView>

        <View style={{ padding: 12, borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.surface }}>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
            <TextInput
              testID="chat-input"
              value={input}
              onChangeText={setInput}
              placeholder="Type your message…"
              placeholderTextColor={c.onSurface3}
              multiline
              style={{ flex: 1, backgroundColor: c.surface2, borderRadius: 20, borderWidth: 1, borderColor: c.border, paddingHorizontal: 16, paddingVertical: 12, color: c.onSurface, maxHeight: 100 }}
              onSubmitEditing={() => send()}
            />
            <Pressable
              testID="send-btn"
              disabled={!input.trim() || busy}
              onPress={() => send()}
              style={[styles.sendBtn, { backgroundColor: c.inverse, opacity: !input.trim() || busy ? 0.4 : 1 }]}
            >
              <Ionicons name="arrow-up" size={20} color={c.onInverse} />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  iconRound: { width: 40, height: 40, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  heroIcon: { width: 72, height: 72, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  sugg: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 14, borderRadius: 14, borderWidth: 1, marginTop: 8 },
  bubble: { maxWidth: "82%", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 },
  sendBtn: { width: 44, height: 44, borderRadius: 999, alignItems: "center", justifyContent: "center" },
});
