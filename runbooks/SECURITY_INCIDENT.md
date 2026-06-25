# Security Incident Runbook

## Detect

- Suspicious auth activity.
- Secret leak.
- Unauthorized admin action.
- Dependency exploit alert.

## Triage

1. Preserve logs.
2. Identify scope: users, data, systems, secrets.
3. Rotate affected secrets.
4. Revoke suspicious sessions.
5. Disable compromised credentials.

## Mitigate

1. Patch or roll back vulnerable release.
2. Force logout for affected users if needed.
3. Notify legal/compliance owners.
4. Prepare customer communication if required.

## Recovery Criteria

- Attack path closed.
- Secrets rotated.
- Audit logs reviewed.
- Postmortem created with owners and deadlines.
