import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Alert } from "react-native";
import { Image } from "expo-image";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import Animated, { useSharedValue, useAnimatedStyle, withSequence, withTiming } from "react-native-reanimated";
import { useTheme, tokens } from "@/src/theme";
import { createVehicleReview } from "@/src/features/reviews/api/reviews";
import { markBookingReviewed } from "@/src/features/reviews/reviewedStore";
import { RaidexCard, RaidexInput, RaidexButton } from "@/src/components/ui";

const RATING_LABELS: Record<number, string> = {
  1: "Poor",
  2: "Fair",
  3: "Good",
  4: "Great",
  5: "Excellent",
};

export default function WriteReviewScreen() {
  const c = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { booking_id, vehicle_id, vehicle_name, vehicle_image } = useLocalSearchParams<{
    booking_id: string;
    vehicle_id?: string;
    vehicle_name?: string;
    vehicle_image?: string;
  }>();

  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async () => {
    if (!vehicle_id) {
      Alert.alert("Error", "Missing vehicle for this booking.");
      return;
    }
    if (rating < 1) {
      Alert.alert("Add a rating", "Tap a star to rate your trip before submitting.");
      return;
    }
    setSubmitting(true);
    try {
      await createVehicleReview(vehicle_id, {
        booking_id,
        rating,
        comment: comment.trim(),
      });
      markBookingReviewed(booking_id);
      Alert.alert("Thank you!", "Your review has been submitted.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (e: any) {
      if (String(e.message || "").toLowerCase().includes("already submitted")) {
        markBookingReviewed(booking_id);
        Alert.alert("Already reviewed", "You've already reviewed this trip.", [
          { text: "OK", onPress: () => router.back() },
        ]);
      } else {
        Alert.alert("Error", e.message || "Could not submit review.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <SafeAreaView edges={["top"]} style={{ backgroundColor: c.surface }}>
        <View style={{ paddingHorizontal: tokens.spacing.xl, paddingTop: tokens.spacing.md, paddingBottom: tokens.spacing.md, flexDirection: "row", alignItems: "center" }}>
          <Pressable testID="review-back-btn" onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={26} color={c.onSurface} />
          </Pressable>
          <Text style={{ color: c.onSurface, fontSize: 18, fontWeight: tokens.weight.bold, marginLeft: 8 }}>Rate your trip</Text>
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={{ padding: tokens.spacing.xl, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
        {!!vehicle_name && (
          <RaidexCard variant="flat" style={{ flexDirection: "row", alignItems: "center", gap: 12 } as any}>
            {!!vehicle_image && <Image source={vehicle_image} style={{ width: 56, height: 56, borderRadius: 12 }} contentFit="cover" />}
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.onSurface3, fontSize: 11, fontWeight: tokens.weight.semibold }}>YOUR TRIP</Text>
              <Text style={{ color: c.onSurface, fontSize: 16, fontWeight: tokens.weight.bold, marginTop: 2 }}>{vehicle_name}</Text>
            </View>
          </RaidexCard>
        )}

        <Text style={{ color: c.onSurface, fontSize: 22, fontWeight: tokens.weight.bold, marginTop: 24, textAlign: "center" }}>
          How was your experience?
        </Text>

        <View style={{ flexDirection: "row", justifyContent: "center", gap: 10, marginTop: 20 }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <StarButton key={n} n={n} rating={rating} onSelect={setRating} c={c} />
          ))}
        </View>
        <Text style={{ color: c.onSurface3, fontSize: 13, fontWeight: tokens.weight.semibold, textAlign: "center", marginTop: 10 }}>
          {rating > 0 ? RATING_LABELS[rating] : "Tap a star to rate"}
        </Text>

        <Text style={[styles.label, { color: c.onSurface2 }]}>Add a comment (optional)</Text>
        <RaidexInput
          testID="review-comment-input"
          value={comment}
          onChangeText={setComment}
          placeholder="Tell other riders about the vehicle, host, or trip experience…"
          multiline
          numberOfLines={5}
          maxLength={1000}
          textAlignVertical="top"
        />

        <RaidexButton
          testID="submit-review-btn"
          label="Submit review"
          icon="checkmark-circle"
          iconPosition="leading"
          onPress={onSubmit}
          loading={submitting}
          disabled={submitting || rating < 1}
          style={{ marginTop: 12 }}
        />
      </ScrollView>
    </View>
  );
}

function StarButton({ n, rating, onSelect, c }: { n: number; rating: number; onSelect: (n: number) => void; c: any }) {
  const scale = useSharedValue(1);
  const filled = n <= rating;

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    scale.value = withSequence(
      withTiming(1.3, { duration: tokens.motion.quick }),
      withTiming(1, { duration: tokens.motion.quick })
    );
    onSelect(n);
  };

  return (
    <Pressable testID={`star-rating-${n}`} onPress={handlePress} hitSlop={8} style={{ padding: 4 }}>
      <Animated.View style={animatedStyle}>
        <Ionicons name={filled ? "star" : "star-outline"} size={38} color={filled ? c.warning : c.onSurface3} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 12, fontWeight: "600", marginTop: 28, marginBottom: 8 },
});
