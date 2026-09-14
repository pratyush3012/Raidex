// RAIDEX_LEGAL_REFUND_POLICY
// Static Refund Policy screen. DRAFT product-authored copy pending real
// legal review. Every mechanic described here (cancellation refunds, wallet
// crediting, disputes) is meant to trace back to real behavior in
// backend/features/booking/service.py's cancel_booking / create_dispute -
// not invented.
import React from "react";
import { LegalScreen, LegalSection, LegalParagraph, LegalBullet } from "@/src/components/legal/LegalScreen";

export default function RefundPolicy() {
  return (
    <LegalScreen title="Refund Policy" lastUpdated="14 September 2026" testID="refund-policy-screen">
      <LegalParagraph>
        This policy explains how refunds work for Raidex bookings. It works alongside, and does not replace,
        our Terms of Service.
      </LegalParagraph>

      <LegalSection title="1. Cancelling before pickup">
        <LegalParagraph>
          You can cancel a booking that is still awaiting payment or already confirmed, at any point before the
          rental period ends. When you cancel an eligible booking with a successful payment on it, Raidex
          automatically requests a refund from the same payment gateway used to pay for the booking, and
          records the outcome against that payment. Where the refund is processed, the refunded amount is also
          credited to your Raidex Wallet, visible in your Wallet transaction history, so you have a running
          record of it.
        </LegalParagraph>
        <LegalParagraph>
          Refund processing through the payment gateway is typically immediate on our side, but the time for
          the funds to actually reflect back with your bank, card issuer, or UPI app depends on that
          institution and is commonly 5–7 business days. If an automatic refund cannot be completed, it is
          marked as failed on your payment and our support team will follow up to resolve it manually.
        </LegalParagraph>
      </LegalSection>

      <LegalSection title="2. Security deposit refunds">
        <LegalParagraph>
          Where a booking carries a refundable security deposit, it is intended to be returned once your trip
          is complete and the vehicle has been checked in, following the same before/after inspection used to
          record the vehicle's condition and odometer reading. Reasonable deductions may be made for
          documented damage, missing fuel/charge, excessive cleaning, or unpaid fines/tolls identified from
          that inspection. If you cancel before pickup, any deposit already charged is refunded through the
          same process described in Section 1.
        </LegalParagraph>
      </LegalSection>

      <LegalSection title="3. If the vehicle owner cancels">
        <LegalParagraph>
          If a booking cannot proceed because the vehicle becomes unavailable on the owner's side — including
          the case where two riders' payments settle for overlapping dates and only one can be honoured — your
          booking is cancelled and any successful payment on it is refunded automatically, in full, using the
          same mechanism described in Section 1. You will not be charged a cancellation fee in this situation.
        </LegalParagraph>
      </LegalSection>

      <LegalSection title="4. Disputes">
        <LegalParagraph>
          If you disagree with a charge, a deposit deduction, or how a booking was handled, you can raise a
          dispute against that specific booking directly from the app. Our operations team reviews the
          booking's inspection records and payment history and follows up with an outcome; a dispute may result
          in an additional refund, a partial refund, or no refund, depending on what the review finds.
        </LegalParagraph>
      </LegalSection>

      <LegalSection title="5. What isn't refundable">
        <LegalParagraph>
          Raidex does not currently charge a separate non-refundable platform or convenience fee on top of your
          booking amount — the amount you paid for an eligible cancelled booking is what gets refunded, subject
          to the timing described in Section 1. Charges that fall outside your control as a platform — such as
          traffic fines, tolls, or damage confirmed through the inspection/dispute process — are handled as
          deductions against your deposit rather than as a "refund," and are explained to you individually when
          they apply.
        </LegalParagraph>
      </LegalSection>

      <LegalSection title="6. Changes to this policy">
        <LegalParagraph>
          We may update this Refund Policy as our processes evolve. Material changes will update the "Last
          updated" date above.
        </LegalParagraph>
      </LegalSection>
    </LegalScreen>
  );
}
