# KYC Vendor Failure Runbook

## Detect

- KYC approval rate drops.
- KYC provider timeouts/errors increase.
- Submissions remain in processing longer than SLA.

## Triage

1. Check KYC vendor status.
2. Inspect rejected/processing KYC submissions.
3. Verify credentials and provider configuration.

## Mitigate

1. Temporarily queue new KYC submissions.
2. Switch to backup provider if configured.
3. Notify support that KYC decisions may be delayed.
4. Do not auto-approve KYC.

## Recovery Criteria

- Provider API is healthy.
- Processing backlog is below SLA.
- Failed submissions have been retried or manually reviewed.
