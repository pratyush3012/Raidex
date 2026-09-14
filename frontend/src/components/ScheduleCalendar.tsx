import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming, Easing } from "react-native-reanimated";
import {
  addDays, addMonths, subMonths, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, format, isSameDay, isSameMonth, isBefore, setHours, setMinutes,
} from "date-fns";
import { tokens, type Theme } from "@/src/theme";

// Reusable pickup/return date + time selection UI for the booking flow.
// Mirrors the visual language (calendarNavBtn / visibleMonth / calendarGrid /
// time-slot groups) already established on the home screen's trip-dates step
// (see frontend/app/(tabs)/index.tsx TripDatesScreen) rather than inventing a
// third calendar style.

// No next-minute pickups: gives owners/ops real time to prep the vehicle.
// This mirrors the backend's real source of truth,
// `BookingService.MIN_BOOKING_LEAD_HOURS` (backend/features/booking/service.py,
// exposed read-only via GET /config as `min_booking_lead_hours`) - the value
// is duplicated here the same way the home screen already does it (see its
// own MIN_LEAD_HOURS constant) rather than round-tripping a fetch for a
// number that rarely changes. The backend re-enforces this regardless of
// what the client sends.
export const MIN_BOOKING_LEAD_HOURS = 2;

// Grouped instead of one long scroll, so picking an evening slot doesn't mean
// hunting through the whole day - and a group with nothing bookable (e.g. all
// of "Night" before the lead-time cutoff) just disappears.
export const TIME_GROUPS: { label: string; icon: keyof typeof Ionicons.glyphMap; hours: number[] }[] = [
  { label: "Morning", icon: "sunny-outline", hours: [5, 6, 7, 8, 9, 10, 11] },
  { label: "Afternoon", icon: "partly-sunny-outline", hours: [12, 13, 14, 15, 16] },
  { label: "Evening", icon: "moon-outline", hours: [17, 18, 19, 20, 21, 22, 23] },
];

export function slotLabel(value: string): string {
  const hour = Number(value.split(":")[0]);
  return format(setMinutes(setHours(new Date(), hour), 0), "h:mm a");
}

export function mergeDateAndTime(date: Date, time: string): Date {
  const hour = Number(time.split(":")[0]);
  const minute = Number(time.split(":")[1] || 0);
  return setMinutes(setHours(date, hour), minute);
}

function stripLabel(day: Date, today: Date): string {
  if (isSameDay(day, today)) return "Today";
  if (isSameDay(day, addDays(today, 1))) return "Tomorrow";
  return format(day, "EEE d");
}

// Small "the number just moved" style bounce, reused for the selection
// moment (a date or time becoming selected) so it matches the price-card
// feedback already used elsewhere on this screen.
function useSelectBounce(active: boolean) {
  const scale = useSharedValue(1);
  const prev = React.useRef(active);
  if (prev.current !== active) {
    prev.current = active;
    if (active) {
      scale.value = withSequence(
        withTiming(1.12, { duration: tokens.motion.quick, easing: Easing.out(Easing.quad) }),
        withSpring(1, tokens.motion.springSnappy)
      );
    }
  }
  return useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
}

function DateChip({ c, label, active, disabled, testID, onPress }: { c: Theme; label: string; active: boolean; disabled?: boolean; testID?: string; onPress: () => void }) {
  const animatedStyle = useSelectBounce(active);
  return (
    <Animated.View style={animatedStyle}>
      <Pressable
        testID={testID}
        disabled={disabled}
        onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }}
        style={{
          paddingHorizontal: 14,
          paddingVertical: 10,
          borderRadius: tokens.radius.md,
          borderWidth: 1,
          backgroundColor: active ? c.accent : c.surface2,
          borderColor: active ? c.accent : c.border,
          opacity: disabled ? 0.35 : 1,
          alignItems: "center",
          minWidth: 64,
        }}
      >
        <Text style={{ color: active ? c.onInverse : c.onSurface, fontWeight: tokens.weight.bold, fontSize: 12.5 }}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

export function QuickDatePicker({
  c,
  label,
  selectedDate,
  minDate,
  onSelect,
  testIDPrefix,
}: {
  c: Theme;
  label: string;
  selectedDate: Date;
  minDate: Date;
  onSelect: (day: Date) => void;
  testIDPrefix: string;
}) {
  const today = useMemo(() => new Date(), []);
  const [expanded, setExpanded] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(selectedDate));

  const quickDays = useMemo(() => eachDayOfInterval({ start: minDate, end: addDays(minDate, 6) }), [minDate.getTime()]);
  const selectedIsBeyondStrip = !quickDays.some((d) => isSameDay(d, selectedDate));

  return (
    <View>
      <Text style={{ color: c.onSurface3, fontSize: 11, fontWeight: tokens.weight.bold, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {quickDays.map((day) => (
          <DateChip
            key={day.toISOString()}
            c={c}
            testID={`${testIDPrefix}-quick-${format(day, "yyyy-MM-dd")}`}
            label={stripLabel(day, today)}
            active={!selectedIsBeyondStrip && isSameDay(day, selectedDate)}
            onPress={() => onSelect(day)}
          />
        ))}
        <Pressable
          testID={`${testIDPrefix}-toggle-calendar`}
          onPress={() => { Haptics.selectionAsync().catch(() => {}); setVisibleMonth(startOfMonth(selectedDate)); setExpanded((e) => !e); }}
          style={{
            paddingHorizontal: 14,
            paddingVertical: 10,
            borderRadius: tokens.radius.md,
            borderWidth: 1,
            backgroundColor: expanded || selectedIsBeyondStrip ? c.accentBg : c.surface2,
            borderColor: expanded || selectedIsBeyondStrip ? c.accent : c.border,
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            minWidth: 64,
            justifyContent: "center",
          }}
        >
          <Ionicons name="calendar-outline" size={14} color={expanded || selectedIsBeyondStrip ? c.onAccentBg : c.onSurface} />
          <Text style={{ color: expanded || selectedIsBeyondStrip ? c.onAccentBg : c.onSurface, fontWeight: tokens.weight.bold, fontSize: 12.5 }}>
            {selectedIsBeyondStrip ? format(selectedDate, "d MMM") : "More"}
          </Text>
        </Pressable>
      </ScrollView>

      {expanded && (
        <View style={{ borderRadius: tokens.radius.lg, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface2, padding: 14, marginTop: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Pressable
              testID={`${testIDPrefix}-cal-prev-month`}
              onPress={() => setVisibleMonth((m) => subMonths(m, 1))}
              disabled={isSameMonth(visibleMonth, today)}
              style={{ width: 34, height: 34, borderRadius: 999, alignItems: "center", justifyContent: "center", opacity: isSameMonth(visibleMonth, today) ? 0.3 : 1 }}
            >
              <Ionicons name="chevron-back" size={18} color={c.onSurface} />
            </Pressable>
            <Text style={{ color: c.onSurface, fontWeight: tokens.weight.bold, fontSize: 14 }}>{format(visibleMonth, "MMMM yyyy")}</Text>
            <Pressable
              testID={`${testIDPrefix}-cal-next-month`}
              onPress={() => setVisibleMonth((m) => addMonths(m, 1))}
              style={{ width: 34, height: 34, borderRadius: 999, alignItems: "center", justifyContent: "center" }}
            >
              <Ionicons name="chevron-forward" size={18} color={c.onSurface} />
            </Pressable>
          </View>
          <View style={{ flexDirection: "row", marginTop: 10 }}>
            {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
              <Text key={i} style={{ flex: 1, textAlign: "center", fontSize: 11, fontWeight: tokens.weight.bold, color: c.onSurface3 }}>{d}</Text>
            ))}
          </View>
          <MonthGrid
            c={c}
            visibleMonth={visibleMonth}
            minDate={minDate}
            selectedDate={selectedDate}
            onDayPress={(day) => { onSelect(day); setExpanded(false); }}
            testIDPrefix={testIDPrefix}
          />
        </View>
      )}
    </View>
  );
}

function MonthGrid({ c, visibleMonth, minDate, selectedDate, onDayPress, testIDPrefix }: {
  c: Theme; visibleMonth: Date; minDate: Date; selectedDate: Date; onDayPress: (d: Date) => void; testIDPrefix: string;
}) {
  const gridDays = useMemo(() => {
    const monthStart = startOfMonth(visibleMonth);
    const monthEnd = endOfMonth(visibleMonth);
    return eachDayOfInterval({ start: startOfWeek(monthStart), end: endOfWeek(monthEnd) });
  }, [visibleMonth.getTime()]);

  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 4 }}>
      {gridDays.map((day) => {
        const inMonth = isSameMonth(day, visibleMonth);
        const isDisabled = !inMonth || isBefore(day, minDate);
        const isSelected = isSameDay(day, selectedDate);
        return (
          <Pressable
            key={day.toISOString()}
            testID={`${testIDPrefix}-cal-day-${format(day, "yyyy-MM-dd")}`}
            disabled={isDisabled}
            onPress={() => onDayPress(day)}
            style={{ width: `${100 / 7}%`, aspectRatio: 1, alignItems: "center", justifyContent: "center" }}
          >
            <View style={{ width: 32, height: 32, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: isSelected ? c.accent : "transparent" }}>
              <Text style={{ color: isDisabled ? c.onSurface3 : isSelected ? c.onInverse : c.onSurface, fontWeight: isSelected ? tokens.weight.bold : tokens.weight.medium, fontSize: 13, opacity: isDisabled ? 0.35 : 1 }}>
                {day.getDate()}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

export function TimeSlotPicker({
  c,
  selected,
  isDisabled,
  onSelect,
  testIDPrefix,
  emptyLabel,
}: {
  c: Theme;
  selected: string | null;
  isDisabled: (hour: number) => boolean;
  onSelect: (value: string) => void;
  testIDPrefix: string;
  emptyLabel?: string;
}) {
  const anyGroupEnabled = TIME_GROUPS.some((g) => g.hours.some((h) => !isDisabled(h)));
  if (!anyGroupEnabled) {
    return <Text style={{ color: c.onSurface3, fontSize: 12.5, fontStyle: "italic" }}>{emptyLabel || "No slots available"}</Text>;
  }
  return (
    <View style={{ gap: 14 }}>
      {TIME_GROUPS.map((group) => {
        const anyEnabled = group.hours.some((h) => !isDisabled(h));
        if (!anyEnabled) return null; // whole group is in the past / invalid - don't show a dead-end row
        return (
          <View key={group.label}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 }}>
              <Ionicons name={group.icon} size={13} color={c.onSurface3} />
              <Text style={{ color: c.onSurface3, fontWeight: tokens.weight.bold, fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.6 }}>{group.label}</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {group.hours.map((h) => {
                const value = `${String(h).padStart(2, "0")}:00`;
                const disabled = isDisabled(h);
                const active = selected === value;
                return <TimeSlotChip key={h} c={c} testID={`${testIDPrefix}-slot-${value}`} value={value} active={active} disabled={disabled} onPress={() => onSelect(value)} />;
              })}
            </ScrollView>
          </View>
        );
      })}
    </View>
  );
}

function TimeSlotChip({ c, testID, value, active, disabled, onPress }: { c: Theme; testID: string; value: string; active: boolean; disabled: boolean; onPress: () => void }) {
  const animatedStyle = useSelectBounce(active);
  return (
    <Animated.View style={animatedStyle}>
      <Pressable
        testID={testID}
        disabled={disabled}
        onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }}
        style={{
          paddingHorizontal: 15,
          paddingVertical: 11,
          borderRadius: tokens.radius.md,
          borderWidth: 1,
          backgroundColor: active ? c.accent : c.surface2,
          borderColor: active ? c.accent : c.border,
          opacity: disabled ? 0.32 : 1,
        }}
      >
        <Text style={{ color: active ? c.onInverse : c.onSurface, fontWeight: tokens.weight.bold, fontSize: 12.5 }}>{slotLabel(value)}</Text>
      </Pressable>
    </Animated.View>
  );
}
