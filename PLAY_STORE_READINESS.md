# Raidex Play Store Readiness

## Privacy Policy Checklist

- Explain account creation and authentication data.
- Explain KYC document handling and storage provider.
- Explain location usage for nearby vehicles, trip tracking, and geofencing.
- Explain payment processing and third-party payment provider role.
- Explain push notifications.
- Explain analytics and crash reporting.
- Explain deletion/export request process.

## Terms Of Service Checklist

- Rental eligibility and KYC requirements.
- Driver license responsibility.
- Payment, deposit, refund, cancellation, and dispute rules.
- Vehicle damage and inspection responsibilities.
- Owner listing responsibilities.
- Prohibited usage and account suspension.
- Liability limits and emergency handling.

## Permissions Audit

| Permission | Purpose | Required At Launch |
|---|---|---|
| Location | Nearby vehicles, route/trip tracking, geofencing | Yes |
| Camera | KYC and vehicle inspection photos | Yes |
| Photo Library | Upload KYC/inspection/vehicle photos | Yes |
| Notifications | Booking, payment, KYC, trip, reminder alerts | Optional but recommended |

## Accessibility Audit

- Verify readable text scaling.
- Verify screen-reader labels for primary actions.
- Verify tap targets on booking/payment/KYC flows.
- Verify error states announce actionable recovery.
- Verify color contrast in light and dark mode.

## Release Checklist

- Production API URL configured.
- Sentry DSNs configured.
- Payment provider in live mode.
- KYC provider in live mode.
- Push notification credentials configured.
- App signing configured.
- Store screenshots and icon assets finalized.
- Final regression on Android physical device.

## Store Asset Checklist

- App icon.
- Feature graphic.
- Phone screenshots.
- Tablet screenshots if supported.
- Short description.
- Full description.
- Privacy policy URL.
- Support contact.
