import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTheme, tokens } from "@/src/theme";
import { api } from "@/src/api/client";

type Notification = {
  notification_id: string;
  title: string;
  body: string;
  type?: string;
  read: boolean;
  created_at: string;
};

export default function NotificationsScreen() {
  const c = useTheme();
  const router = useRouter();
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<Notification[]>("/notifications");
      setItems(data);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const markRead = async (id: string) => {
    try {
      await api(`/notifications/${id}/read`, { method: "POST" });
      setItems((prev) => prev.map((n) => (n.notification_id === id ? { ...n, read: true } : n)));
    } catch {}
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <SafeAreaView edges={["top"]} style={{ backgroundColor: c.surface }}>
        <View style={{ flexDirection: "row", alignItems: "center", padding: tokens.spacing.lg, gap: 12 }}>
          <Pressable testID="back-btn" onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={26} color={c.onSurface} />
          </Pressable>
          <Text style={{ color: c.onSurface, fontSize: tokens.type.xl, fontWeight: "800" }}>Notifications</Text>
        </View>
      </SafeAreaView>

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={c.accent} size="large" />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.notification_id}
          contentContainerStyle={{ padding: tokens.spacing.xl, paddingBottom: 100 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={c.accent} />}
          ListEmptyComponent={
            <View style={{ alignItems: "center", padding: 48 }}>
              <Ionicons name="notifications-off-outline" size={48} color={c.onSurface3} />
              <Text style={{ color: c.onSurface2, marginTop: 12 }}>No notifications yet</Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => !item.read && markRead(item.notification_id)}
              style={[styles.card, { backgroundColor: item.read ? c.surface2 : c.accentBg, borderColor: c.border }]}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.onSurface, fontWeight: "700", fontSize: 15 }}>{item.title}</Text>
                <Text style={{ color: c.onSurface2, marginTop: 4, fontSize: 13 }}>{item.body}</Text>
                <Text style={{ color: c.onSurface3, marginTop: 8, fontSize: 11 }}>
                  {new Date(item.created_at).toLocaleString()}
                </Text>
              </View>
              {!item.read && <View style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: c.accent }} />}
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 14, borderRadius: 14, borderWidth: 1, marginBottom: 10 },
});
