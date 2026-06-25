# Raidex Architecture

## Current Shape

Raidex is an Expo React Native app backed by a FastAPI service and MongoDB. The backend is being moved from a monolithic controller file toward feature services with thin HTTP route handlers.

```mermaid
flowchart LR
  App["Expo App"] --> API["FastAPI /api"]
  API --> Auth["Auth + Sessions"]
  API --> Booking["Booking Service"]
  API --> Payments["Payment Gateway"]
  API --> Vehicles["Vehicles + Discovery"]
  API --> Admin["Admin Operations"]
  Booking --> Mongo["MongoDB"]
  Payments --> Mongo
  Vehicles --> Mongo
  Admin --> Mongo
  API --> Realtime["WebSocket Events"]
  API --> Sentry["Sentry"]
```

## Backend Module Direction

```mermaid
flowchart TB
  Server["backend/server.py\nFastAPI composition"] --> BookingRouter["booking router"]
  BookingRouter --> BookingService["features/booking/service.py"]
  BookingService --> BookingRepo["booking repository boundary"]
  BookingRepo --> DB["Mongo collections"]

  Server --> Future["future feature routers"]
  Future --> Auth["auth"]
  Future --> Payments["payments"]
  Future --> Vehicles["vehicles"]
  Future --> Admin["admin"]
```

The first extracted module is booking. It is independently unit-tested at service level and still exercised through the existing API routes.

## Frontend Feature Direction

```mermaid
flowchart TB
  Routes["app/ Expo routes"] --> Features["src/features"]
  Features --> AuthFeature["authentication"]
  Features --> BookingFeature["booking"]
  Features --> PaymentFeature["payments"]
  Features --> VehicleFeature["vehicles"]
  Features --> AdminFeature["admin"]
  Features --> SharedClient["src/api/client.ts"]
  SharedClient --> Backend["FastAPI API"]
```

Frontend route files remain in place to avoid navigation churn. New feature API/hook boundaries live under `src/features/*` and can be migrated into screens incrementally.

## Realtime Architecture

```mermaid
sequenceDiagram
  participant API as FastAPI
  participant Hub as RealtimeHub
  participant App as Mobile App
  participant Admin as Admin Console
  API->>Hub: publish_event(user_id, type, payload)
  Hub->>App: user channel event
  Hub->>Admin: admin channel event
```

## Offline Sync Architecture

```mermaid
flowchart LR
  UserAction["User write action"] --> APIClient["api client"]
  APIClient -->|online| Backend["Backend"]
  APIClient -->|network failure + queueOnFailure| Queue["Offline request queue"]
  Discovery["GET discovery"] --> Cache["Offline cache"]
  Cache --> App["Non-blank fallback UI"]
```
