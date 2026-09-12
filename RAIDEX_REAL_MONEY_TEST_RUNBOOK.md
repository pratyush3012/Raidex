# RAIDEX Real-Money Test — Runbook

**This is a runbook, not a result.** Phases 5–8 of the launch plan (one real
vehicle, one real customer, one real Razorpay payment, full trip lifecycle,
reconciliation) require actions no automated coding session can perform:
registering a real vehicle owner, physically inspecting a real car, and
moving real money through a live payment gateway. This document is the exact
sequence for a human operator to follow. Once run, record the actual results
in `RAIDEX_FIRST_REAL_TRANSACTION.md` (template included at the bottom of
this file) — do not fill that document with placeholder or assumed data.

**Do not run this against production until every P0 item in
`RAIDEX_FINAL_PRODUCTION_AUDIT.md` is closed and `RAIDEX_LAUNCH_CHECKLIST.md`'s
Technical/Payments/KYC sections are green.** Running a real payment through a
system with an open payment-bypass or booking-race bug is not a safe way to
"test" — fix those first.

## Prerequisites (must all be true before starting)

- [ ] `RAIDEX_FINAL_PRODUCTION_AUDIT.md` P0 list is fully closed (verify by re-reading that file's status, not by memory).
- [ ] Razorpay account is in **Live** mode with real `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET`/`RAZORPAY_WEBHOOK_SECRET` configured, and the webhook URL is registered in the Razorpay dashboard pointing at the real deployed backend.
- [ ] A real KYC provider (Karza or IDfy) is configured with live credentials.
- [ ] SMS provider is configured with a real account (not mock) — OTPs must actually arrive by SMS, not in the API response.
- [ ] Backend is deployed to its real production/staging host with a real MongoDB Atlas cluster (not local/dev Mongo).
- [ ] An admin account exists with a real, non-default password.
- [ ] Someone is designated to manually approve the KYC submission and vehicle listing (the admin console cannot do this yet for KYC/disputes — see `RAIDEX_LAUNCH_CHECKLIST.md` — so this may require a direct API call via `POST /api/admin/kyc/{id}/approve` if the UI gap isn't closed yet).

## Step-by-step

### A. Owner side
1. A real person, using their own phone number and a real vehicle they own, signs up through the actual mobile app (not a test script).
2. They complete owner KYC through the real flow.
3. They upload real vehicle documents (RC, insurance, pollution certificate) and real photos through `POST /owner/vehicles`.
4. An admin reviews the actual documents and calls `POST /admin/vehicles/{vehicle_id}/approve` (or the console button, once it exists) — only after genuinely checking the documents, not as a formality.
5. Confirm in the database that `verification_status == "approved"` and the owner can now (and only now) set `available: true` via the app.

### B. Customer side
6. A real customer, on their own device, signs up.
7. They complete customer KYC through the real provider (not the stub).
8. They search, find the real listed vehicle, and open its detail page.
9. They create a booking for a **short, low-cost window** — pick the smallest real rental unit the pricing model supports (e.g. one hour) to minimize the real money at risk on this first test.
10. They pay via the real Razorpay checkout with a real card/UPI — **use a small controlled amount**, not a token ₹1 payment if that would distort the commission math you're about to verify; a realistic small booking (e.g. the actual 1-hour rate) is better than an artificial round number.

### C. Trip lifecycle
11. Before-trip inspection: real photos, real odometer reading.
12. Start trip: confirm GPS begins recording (real device GPS, not simulated — check the trip screen doesn't show a "sim" label).
13. Let the trip run for a real, short duration.
14. End trip: real photos, real odometer reading.
15. After-trip inspection: confirm the odometer delta matches what actually happened.
16. Confirm booking status reaches `completed`.

### D. Money and rewards
17. Confirm the customer's invoice reflects the actual amount charged.
18. Confirm RideMiles were credited exactly once (`GET /ride-miles/ledger`).
19. Confirm a payout record was created (`GET /admin/payouts` or DB) with the correct commission split.
20. An admin manually marks the payout paid (`POST /admin/payouts/{id}/mark-paid` or console) **only after actually transferring real money to the owner's real bank account outside the app** — RAIDEX's payout system today tracks state, it does not itself move bank funds.
21. Confirm the owner sees the correct gross/commission/net breakdown in the app.

## What to verify programmatically (don't just eyeball the UI)

Pull these records directly from the database (or via admin API) and cross-check them against each other — this is Phase 6 of the launch plan:

- `payments` — one record, `status: "succeeded"`, `amount` matches what was actually charged.
- `bookings` — one record, `status: "completed"`, `total_amount` matches the payment.
- The booking's commission snapshot (owner net vs. RAIDEX commission) — recompute by hand using the documented commission rate and confirm it matches what's stored.
- `payouts` — **exactly one** payout record for this booking (re-run the same webhook/confirm call a second time first, to prove idempotency, before checking).
- `wallet ledger` / `ride_miles_ledger` — exactly one entry each for this booking, not zero, not duplicated.
- `notifications` — confirm no duplicates (send the webhook twice deliberately, as above).
- `admin_audit` — the approval action is logged.

## After the test

Fill in `RAIDEX_FIRST_REAL_TRANSACTION.md` with the actual IDs, amounts, and
timestamps observed — every field, no placeholders. If any invariant above
did not hold, do not paper over it: record the discrepancy and treat it as a
launch blocker, not a rounding error.
