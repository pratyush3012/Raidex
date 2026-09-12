# RAIDEX_LEDGER_RECONCILIATION
# Read-only health checks comparing append-only ledgers (wallet_ledger,
# ride_miles_ledger) against the cached balance fields on the user document.
# Never auto-mutates a balance - only reports healthy/warning/mismatch with
# diagnostics, for admin review. Auto-"fixing" a financial balance without a
# human decision is exactly the kind of AI/automation overreach the platform
# explicitly avoids elsewhere (see providers/ai_provider.py), so the same
# principle applies here.
from typing import Any

EPSILON = 0.01  # float rounding tolerance for money/points comparisons


class LedgerReconciliationService:
    def __init__(self, db: Any):
        self.db = db

    async def reconcile_wallets(self, limit: int = 2000) -> dict:
        users = await self.db.users.find({}, {"_id": 0, "user_id": 1, "wallet_balance": 1}).to_list(limit)
        issues = []
        for u in users:
            cached = round(float(u.get("wallet_balance", 0)), 2)
            entries = await self.db.wallet_ledger.find({"user_id": u["user_id"]}, {"_id": 0, "delta": 1}).to_list(10000)
            ledger_sum = round(sum(float(e.get("delta", 0)) for e in entries), 2)
            if abs(ledger_sum - cached) > EPSILON:
                issues.append({
                    "user_id": u["user_id"], "issue": "balance_mismatch",
                    "ledger_sum": ledger_sum, "cached_balance": cached, "diff": round(cached - ledger_sum, 2),
                })
            if cached < 0:
                issues.append({"user_id": u["user_id"], "issue": "negative_balance", "cached_balance": cached})
        return self._report(len(users), issues)

    async def reconcile_ride_miles(self, limit: int = 2000) -> dict:
        users = await self.db.users.find({}, {"_id": 0, "user_id": 1, "ride_miles": 1}).to_list(limit)
        issues = []
        for u in users:
            cached = int(u.get("ride_miles", 0))
            entries = await self.db.ride_miles_ledger.find({"user_id": u["user_id"]}, {"_id": 0, "delta": 1}).to_list(10000)
            ledger_sum = sum(int(e.get("delta", 0)) for e in entries)
            if ledger_sum != cached:
                issues.append({
                    "user_id": u["user_id"], "issue": "balance_mismatch",
                    "ledger_sum": ledger_sum, "cached_balance": cached, "diff": cached - ledger_sum,
                })
            if cached < 0:
                issues.append({"user_id": u["user_id"], "issue": "negative_balance", "cached_balance": cached})
        return self._report(len(users), issues)

    async def full_report(self) -> dict:
        wallet = await self.reconcile_wallets()
        ride_miles = await self.reconcile_ride_miles()
        overall = "healthy"
        if wallet["status"] == "mismatch" or ride_miles["status"] == "mismatch":
            overall = "mismatch"
        elif wallet["status"] == "warning" or ride_miles["status"] == "warning":
            overall = "warning"
        return {"status": overall, "wallet": wallet, "ride_miles": ride_miles}

    @staticmethod
    def _report(checked: int, issues: list[dict]) -> dict:
        status = "healthy"
        if issues:
            status = "mismatch" if any(i["issue"] == "balance_mismatch" for i in issues) else "warning"
        return {"status": status, "checked": checked, "issue_count": len(issues), "issues": issues}
