# Raidex Security

## Authentication

- Access tokens use JWT with `jti`.
- Refresh tokens are stored as device sessions.
- Token revocation is supported through revoked token/session collections.

## API Protection

- Authenticated routes use `get_current_user`.
- Admin routes must call role checks.
- Security headers are applied by middleware.
- Auth endpoints are rate-limited.

## Data Handling

- KYC request validation now rejects missing document fields, invalid Aadhaar last4, and too-short driver license numbers.
- Media should remain in signed external storage instead of base64 documents.

## Dependency Risk

Frontend advisories remain tied to Expo/React Native major upgrades and should be handled on a dedicated upgrade branch with full device regression testing.
