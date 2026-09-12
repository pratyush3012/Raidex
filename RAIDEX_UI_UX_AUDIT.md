# RAIDEX — UI/UX Audit

Audited directly against the current code in `frontend/app/**` and `frontend/src/**` (not against memory or prior docs). This is the baseline the transformation in `RAIDEX_UI_UX_TRANSFORMATION_REPORT.md` works from.

## 1. What exists today

- **Theme**: `frontend/src/theme/index.ts` — a small, coherent token set (`spacing`, `radius`, `type`) and two complete palettes (`light`/`dark`) with matching semantic keys (`surface`, `onSurface`, `accent`, `border`, etc). This is a real foundation — both themes are genuinely built out, not one-real-one-placeholder. No typography *weights* scale, no elevation/shadow tokens, no motion tokens (durations/easings) exist yet.
- **Motion**: `react-native-reanimated` (3.10), `react-native-gesture-handler`, `expo-haptics`, `expo-blur`, `expo-linear-gradient`, `react-native-svg`, `expo-image` are all already installed. **Zero screens import Reanimated** (`grep -rl "react-native-reanimated" app/ src/` → no results). Every animation-shaped thing today is either absent or done with plain `Pressable`'s `opacity` prop on press. `expo-haptics` is used in exactly one screen (`app/inspection/[booking_id].tsx`).
- **Components**: there is no shared component library. Every screen defines its own `StyleSheet.create({...})` with its own button/card/chip/badge shapes. `EmptyState` is independently redefined (not imported from one place) in at least `app/owner/index.tsx` and `app/admin/index.tsx`. This is the single biggest structural gap — it's why spacing, radii, and font weights drift screen to screen even though the token file itself is consistent.
- **Loading states**: universally `ActivityIndicator` full-screen or inline. No skeleton/shimmer anywhere.
- **Landing/auth** (`app/index.tsx`): the strongest screen visually today — full-bleed hero image, gradient scrim, a real brand mark, hero stats row, dark auth panel. Google/Apple buttons are honestly labeled "Coming soon" and disabled rather than dead-clickable — correct, not a bug.
- **Active trip** (`app/trip/[booking_id].tsx`): a hand-rolled SVG "map" (grid lines + a route polyline), not a real map. It correctly falls back to a clearly-labeled `sim` mode when real GPS/expo-location isn't available (web/Expo Go) — this is an honest fallback, not a hidden fake; the fallback's presence and labeling should be preserved.
- **Inspection** (`app/inspection/[booking_id].tsx`): already has real camera capture, haptic feedback on capture, a photo grid with checkmark states, progress counter. Structurally solid; visually plain.
- **RideMiles / rewards**: no dedicated screen exists. The entire "loyalty system" today is a small badge and a static progress bar toward a hardcoded `1000` on the home screen (`app/(tabs)/index.tsx:236-238`) — no history, no redemption, no achievements. This needs to be built mostly from scratch (backed by the real, already-existing `ride_miles_ledger`), not just restyled.
- **Wallet**: a top-up card on the profile screen only; no transaction history view.
- **Owner/Admin/Subscriptions/Swap/Reviews/Payouts screens**: functionally complete and correct (verified in the prior implementation pass), visually consistent with the *rest* of the app's plain style, not yet touched by any design-system work.

## 2. Findings by category

### Inconsistent UI / duplicated components
- Button, card, chip, badge, and empty-state shapes are redefined per-screen with slightly different radii (`12`, `14`, `16`, `20` all used for "a card" depending on the file), weights (`"700"` vs `"800"` vs `"900"` for what is semantically the same "strong label"), and paddings. Nothing is objectively broken, but nothing is *shared*, so every future change means editing N places.
- Two different status-badge color-mapping functions exist independently (`payoutStatusColor` in `admin/index.tsx`, inline ternaries elsewhere) doing the same job with different color choices for the same semantic states (paid/failed/pending).

### Spacing & typography
- `tokens.spacing`/`tokens.type` exist but are inconsistently *used* — many screens hardcode raw numbers (`padding: 20`, `fontSize: 22`) instead of referencing the scale, which is how the radius/weight drift above happens.
- No named type scale for weight (only ad hoc `"700"`/`"800"`/`"900"` strings) — a `RaidexText` primitive would remove this class of inconsistency entirely.

### Navigation
- Structurally sound (Expo Router file-based routing, a working protected-route gate in `_layout.tsx`), no dead routes or duplicate screens found. Screen-to-screen transitions use the router defaults (native stack push/replace) with no custom transition — functional but generic, a missed opportunity for a "signature moment" per the brief (e.g. booking confirmation, trip start).

### Motion — the largest gap
- No app has zero purposeful motion today: no screen-entrance animation, no list-item stagger, no button press feedback beyond opacity, no success/failure choreography on payment, no counter animation for RideMiles, no milestone celebration, no map marker interpolation (the active-trip marker jumps discretely on each GPS tick rather than easing between points). This is the highest-leverage area for the "premium/alive" feeling the brief asks for, and the libraries to do it (Reanimated, Haptics) are already installed and unused.

### Loading / empty / error states
- Loading: almost every screen uses `ActivityIndicator` only. One exception: `app/(tabs)/index.tsx`'s `DiscoverySkeleton` — a static gray-block placeholder shape for the map/card layout, but it doesn't animate (no shimmer/pulse, no Reanimated). Everywhere else there is no skeleton at all.
- Empty states: present in several screens (owner vehicles/bookings, admin lists, subscriptions) but each is its own tiny inline component, not shared, and none have a specific CTA beyond generic copy in some cases.
- Error states: mostly `Alert.alert("Error", e.message)` — functional, never leaks raw exceptions (backend already returns safe messages), but jarring as a native OS alert rather than an in-context, dismissable, on-brand error state.

### Accessibility
- `testID`s are consistently present (good — this is what Maestro/Jest rely on), but no explicit `accessibilityLabel`/`accessibilityRole` found on custom `Pressable`-based buttons (icon-only buttons like the back chevron rely on default RN behavior only). Color contrast in the light theme is generally fine (dark text on white/near-white surfaces); a few white-text-on-light-gradient combinations in gradient headers should be spot-checked once real content is dropped in.
- No `prefers-reduced-motion`/`AccessibilityInfo.isReduceMotionEnabled()` check exists anywhere — expected, since there's no motion yet to gate.

### Performance risks
- `app/(tabs)/index.tsx`'s main vehicle list correctly uses a virtualized `FlatList` (with `keyExtractor`, `RefreshControl`, header/empty components) — no issue there. Other, shorter admin/owner list screens (subscriptions, payouts, disputes, users) use plain `ScrollView` + `.map()`, which is fine at the list lengths those screens actually show (paginated to 50-200 server-side) but worth keeping an eye on if any of those lists grow unbounded.
- Images are loaded via `expo-image` (already the right choice — built-in caching/placeholder support), no obviously oversized unoptimized assets found.
- No obvious re-render storms (no context misuse spotted), but no `React.memo`/`useMemo` around list row components either — acceptable today, worth revisiting once list virtualization is added.

### Product copy / personality
- Landing copy ("Move smarter. Book faster.") and the owner-onboarding copy (already fixed to drop the stale "You keep 85%"/"Weekly payouts" claims in the prior pass) are on-brand and honest. No fake urgency or spammy language found anywhere in the current copy.

## 3. What this means for the transformation

The codebase's problem is **not** broken functionality or dishonest UI (that was the subject of the prior pass and is in good shape) — it's the **absence of a shared visual/motion system**. The highest-leverage, lowest-risk path is:
1. Build the design system + primitive component library once, centrally.
2. Retrofit screens onto it (behavior unchanged, call sites unchanged, only presentation layers replaced).
3. Add real, purposeful Reanimated-driven motion at the specific moments the brief calls "signature" (booking confirmation, payment success, trip start/end, RideMiles reward, milestone, subscription activation, swap) rather than animating everything.

See `RAIDEX_UI_UX_TRANSFORMATION_REPORT.md` for what was actually implemented against this audit, and what was deliberately deferred.
