# Raidex — User Flows

> Mermaid `flowchart` notation. Each block can be rendered independently.

## Actors
- **C** — Customer (renter / subscriber)
- **O** — Vehicle Owner (host)
- **A** — Admin (Raidex ops)
- **AI** — Raidex Nexus (Support / Operations / Finance agents)

---

## F1 · Customer Onboarding & KYC

```mermaid
flowchart TD
  S[Open app] --> A1{Has session?}
  A1 -- Yes --> H[Home]
  A1 -- No --> L[Landing screen]
  L --> AUTH{Pick method}
  AUTH -- Email/pwd --> R[Signup/Login form]
  AUTH -- Google --> G[Emergent Google OAuth]
  R --> T[JWT issued]
  G --> T
  T --> H
  H --> KYC1[Tap Complete KYC]
  KYC1 --> ST1[Step 1: Aadhaar front+back]
  ST1 --> ST2[Step 2: DL front+back + number]
  ST2 --> ST3[Step 3: Face selfie + liveness]
  ST3 --> SUB[POST /kyc/submit]
  SUB --> PROC[Status: processing]
  PROC --> STUB[Stub verifier runs<br/>~5s delay]
  STUB --> V{Match score > 0.7?}
  V -- Yes --> VER[Status: verified]
  V -- No --> REJ[Status: rejected w/ reason]
  VER --> NOTIF[Notification + profile badge]
  REJ --> RETRY[Retry KYC]
```

---

## F2 · Booking + Payment Lifecycle

```mermaid
flowchart TD
  D[Discovery / Vehicle Detail] --> B1[Tap Book Now]
  B1 --> KYCCHK{KYC verified?}
  KYCCHK -- No --> KYCGATE[Show KYC gate modal]
  KYCCHK -- Yes --> BF[Booking form: plan, dates, addons]
  BF --> SUM[Order Summary screen]
  SUM --> APPLY[Optional: Apply Coupon / Use RideMiles]
  APPLY --> CHK[Checkout screen]
  CHK --> CRBK[POST /bookings → status=pending_payment]
  CRBK --> CRPAY[POST /payments/create → provider=mock]
  CRPAY --> PROC[Payment Processing screen w/ spinner]
  PROC --> SIM{Stub: 95% success}
  SIM -- success --> CONF[POST /payments/{id}/confirm<br/>booking.status=confirmed]
  SIM -- failure --> FAIL[Payment Failure screen<br/>Retry CTA]
  CONF --> SUCC[Success screen: animation + booking summary]
  SUCC --> NOTIF[Push: 'Booking confirmed' + miles credit]
  FAIL --> CHK
  CONF --> LEDG[wallet_ledger + ride_miles_ledger insert]
```

---

## F3 · Trip Lifecycle (with GPS + Inspection)

```mermaid
flowchart TD
  CONF[Booking confirmed] --> TRIP[Trips tab → Tap booking]
  TRIP --> START[Tap Start Trip]
  START --> BEFORE[Mandatory Before-Trip Inspection]
  BEFORE --> P1[Capture 6 angle photos]
  P1 --> P2[Capture 360 video<br/>optional]
  P2 --> ODO1[Enter odometer]
  ODO1 --> SUBI1[POST /inspections phase=before]
  SUBI1 --> AISTUB[AI stub: ai_score, findings]
  AISTUB --> ACT[booking.status = active]
  ACT --> LIVE[Live Trip dashboard]
  LIVE --> GPS[Vehicle pings /gps/track every 30s<br/>during active trip]
  GPS --> FENCE{Outside home geofence?}
  FENCE -- Yes & no booking active --> ALERT[geofence_events: exit_home]
  FENCE -- No --> LIVE
  LIVE --> END[Tap End Trip]
  END --> AFTER[Mandatory After-Trip Inspection]
  AFTER --> P3[Photos + video + odometer_end]
  P3 --> SUBI2[POST /inspections phase=after]
  SUBI2 --> DIFF[AI compares before vs after]
  DIFF -->|damage detected| DISP[booking.status=disputed<br/>open Support thread]
  DIFF -->|clean| COMP[booking.status=completed]
  COMP --> MILES[Award km-based RideMiles]
  COMP --> REVIEW[Prompt review + rating]
  COMP --> RFD{Deposit refund}
  RFD --> REFUND[POST /payments/refund<br/>wallet_ledger credit]
```

---

## F4 · Vehicle Owner Onboarding & Listing

```mermaid
flowchart TD
  CUST[Customer in Profile] --> BECOME[Tap 'Become a Host']
  BECOME --> AGREE[T&C + payout setup screen]
  AGREE --> ADDROLE[POST /owner/onboard<br/>users.roles += 'owner']
  ADDROLE --> ODASH[Owner Dashboard tab unlocks]
  ODASH --> ADDVEH[Tap Add Vehicle]
  ADDVEH --> ST1[Step 1: type, brand, model, year]
  ST1 --> ST2[Step 2: photos 1-6]
  ST2 --> ST3[Step 3: RC, insurance, pollution upload]
  ST3 --> ST4[Step 4: pricing matrix + deposit]
  ST4 --> ST5[Step 5: pickup location + geofence radius]
  ST5 --> ST6[Step 6: availability calendar]
  ST6 --> PUB[POST /owner/vehicles → verification_status=pending]
  PUB --> ADM[Admin review queue]
  ADM --> ADMA{Admin decision}
  ADMA -- approve --> LIVE[available=true, listed in discovery]
  ADMA -- reject --> NOTE[Notification with reason]
```

---

## F5 · Owner Daily Operations

```mermaid
flowchart TD
  ODASH[Owner Dashboard] --> TABS{Tab}
  TABS --> EARN[Earnings: today/week/month + chart]
  TABS --> UTIL[Utilization: % per vehicle]
  TABS --> LIST[My Listings → vehicle row]
  TABS --> BOOK[Bookings: future, active, past]
  TABS --> CAL[Calendar: drag to block dates]
  TABS --> PAY[Payouts: weekly cycle, bank acct]
  LIST --> VED[Edit pricing / pause vehicle]
  BOOK --> ROW[Booking detail → contact renter]
  PAY --> BANK[Add/Edit bank account masked]
```

---

## F6 · Admin Workflow

```mermaid
flowchart TD
  AL[Admin login - elevated role] --> AD[Admin home: KPI grid]
  AD --> TABS{Section}
  TABS --> USR[Users: search, KYC override, ban]
  TABS --> VER[Vehicle approval queue]
  TABS --> BKG[All bookings: filter by status]
  TABS --> PAYS[Payments: refunds, disputes]
  TABS --> GEO[Geofence alerts feed]
  TABS --> CMP[Coupons / promotions]
  TABS --> ANL[Analytics dashboards]
  TABS --> AGT[AI Nexus runs viewer]
  AD -.audit.-> AUD[admin_audit collection]
```

---

## F7 · AI Nexus Triggers

```mermaid
flowchart TD
  EV[Event source] --> ROUTE{Type}
  ROUTE -- 'user chat' --> SUP[Support Agent]
  ROUTE -- 'ops question' --> OPS[Operations Agent]
  ROUTE -- 'finance query' --> FIN[Finance Agent]
  SUP --> LLM[(Emergent LLM key<br/>Claude Haiku)]
  OPS --> TOOL1[Tool: stats, vehicles, bookings]
  FIN --> TOOL2[Tool: revenue, payouts]
  TOOL1 --> LLM
  TOOL2 --> LLM
  LLM --> RESP[Response to user/admin]
  RESP --> LOG[agent_runs telemetry insert]
```

---

## F8 · Geofence Alert Flow (security)

```mermaid
flowchart TD
  PING[GPS ping arrives] --> CHKB{Active booking?}
  CHKB -- No --> CHKG{Outside home radius?}
  CHKG -- Yes --> CREATE[geofence_events kind=exit_home]
  CREATE --> NOWN[Notify owner + admin]
  CHKG -- No --> END[skip]
  CHKB -- Yes --> SPD{Speed > 100?}
  SPD -- Yes --> EXCESS[event kind=excess_speed]
  EXCESS --> NREN[Notify renter + owner]
  SPD -- No --> END
```
