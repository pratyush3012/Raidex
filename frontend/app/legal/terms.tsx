// RAIDEX_LEGAL_TERMS
// Static Terms of Service screen. DRAFT product-authored copy pending real
// legal review (see the persistent footer in LegalScreen) - every factual
// claim here is meant to trace back to real behavior in backend/server.py
// and backend/features/booking/service.py, not invented policy.
import React from "react";
import { LegalScreen, LegalSection, LegalParagraph, LegalBullet, LegalSubheading } from "@/src/components/legal/LegalScreen";

export default function TermsOfService() {
  return (
    <LegalScreen title="Terms of Service" lastUpdated="14 September 2026" testID="terms-screen">
      <LegalParagraph>
        These Terms of Service ("Terms") govern your use of the Raidex mobile app and the vehicle-rental
        marketplace it provides ("Raidex", "we", "us"). Raidex connects riders who want to rent a car or bike
        with independent vehicle owners who list their vehicles on the platform. By creating an account or
        booking a vehicle, you agree to these Terms.
      </LegalParagraph>

      <LegalSection title="1. Eligibility and account registration">
        <LegalParagraph>
          You must be at least 18 years old and hold a valid government-issued ID and a valid driving licence
          for the vehicle category you intend to book. You can register with an email address and password, or
          with a phone number verified by a one-time passcode (OTP). You are responsible for keeping your
          login credentials confidential and for all activity under your account.
        </LegalParagraph>
      </LegalSection>

      <LegalSection title="2. KYC verification is required before booking">
        <LegalParagraph>
          Raidex is a KYC-gated marketplace: you cannot complete a booking until your identity has been
          verified. Verification requires submitting your Aadhaar card (front and back) and driving licence
          (front and back), plus a live selfie for face matching. Our system will not process a booking
          request unless your account's KYC status is "verified" — bookings are rejected outright otherwise,
          regardless of anything shown earlier in the app. See our Privacy Policy for what happens to these
          documents.
        </LegalParagraph>
      </LegalSection>

      <LegalSection title="3. Booking, lead time, and cancellation">
        <LegalParagraph>
          Every booking must start at least a minimum number of hours from the time you book (2 hours by
          default, configurable by Raidex) so the vehicle can be prepared for pickup; a booking request placed
          for an earlier pickup time will be declined. Bookings are also subject to real-time availability —
          two riders cannot be confirmed on the same vehicle for overlapping dates, and if a conflict is
          detected after payment, your booking will be cancelled and refunded automatically.
        </LegalParagraph>
        <LegalParagraph>
          You may cancel a booking that is awaiting payment or already confirmed, and you may request to
          extend a confirmed or active booking subject to the vehicle's continued availability and an
          additional charge for the extra time. Cancellation eligibility, refund amounts, and refund timing are
          governed by our separate Refund Policy, not by this document.
        </LegalParagraph>
      </LegalSection>

      <LegalSection title="4. Using the vehicle and your responsibilities">
        <LegalParagraph>
          You agree to operate the vehicle safely, lawfully, and only for its intended personal-transport
          purpose. Before and after your trip, the vehicle's condition and odometer reading are recorded
          through an in-app inspection step (photos plus odometer values) — keep this accurate, since it is the
          primary record used if a damage or mileage dispute is later raised. You are responsible for the
          vehicle, and for any fines, tolls, or violations incurred, during your booked rental period.
        </LegalParagraph>
      </LegalSection>

      <LegalSection title="5. Security deposit and damage liability">
        <LegalParagraph>
          Most vehicles carry a refundable security deposit, shown on your invoice and charged at booking. The
          deposit is intended to be returned after your trip once the vehicle has been checked in, subject to
          reasonable deduction for documented damage, missing fuel/charge, excessive cleaning, or unpaid
          fines/tolls identified from the before/after inspection. Any disagreement about a deduction is handled
          through the in-app dispute process described in Section 9.
        </LegalParagraph>
      </LegalSection>

      <LegalSection title="6. Prohibited use">
        <LegalBullet>Using the vehicle for racing, off-roading, towing, or any illegal activity</LegalBullet>
        <LegalBullet>Allowing anyone not listed on the booking to drive the vehicle</LegalBullet>
        <LegalBullet>Sub-renting, subletting, or reselling access to a booked vehicle</LegalBullet>
        <LegalBullet>Tampering with, disabling, or attempting to block the vehicle's GPS/location tracking during an active trip</LegalBullet>
        <LegalBullet>Exceeding the vehicle's rated seating or load capacity</LegalBullet>
        <LegalBullet>Submitting false, forged, or someone else's KYC documents</LegalBullet>
      </LegalSection>

      <LegalSection title="7. Vehicle owners and the marketplace model">
        <LegalParagraph>
          Raidex operates a marketplace: vehicles are owned and listed by independent owners, not by Raidex.
          Every vehicle listing is reviewed and must be approved by Raidex before it becomes bookable. Owners
          receive the rental amount net of Raidex's commission, calculated and locked in at the time each
          booking is created. Raidex facilitates the booking, payment, and dispute process between riders and
          owners but is not itself the owner of the vehicles listed.
        </LegalParagraph>
      </LegalSection>

      <LegalSection title="8. Limitation of liability">
        <LegalParagraph>
          Raidex provides the platform connecting riders and vehicle owners "as is." To the maximum extent
          permitted by law, Raidex is not liable for the roadworthiness, mechanical condition, or acts or
          omissions of vehicle owners or other riders, beyond what is verified through our listing-approval and
          inspection processes. Raidex's aggregate liability arising from your use of the platform is limited
          to the amount you paid for the booking giving rise to the claim. Nothing in this section limits
          liability that cannot be limited under applicable Indian law.
        </LegalParagraph>
      </LegalSection>

      <LegalSection title="9. Disputes">
        <LegalParagraph>
          If something goes wrong with a booking — a damage disagreement, a billing question, a service issue —
          you can raise a dispute against that specific booking directly from the app. Our operations team
          reviews disputes using the booking's inspection records, payment history, and your submitted details,
          and updates you on the outcome.
        </LegalParagraph>
      </LegalSection>

      <LegalSection title="10. Account suspension and termination">
        <LegalParagraph>
          Raidex may suspend or terminate your account for fraud, KYC rejection or falsification, repeated
          policy violations, non-payment, or misuse of a rented vehicle. You may stop using Raidex at any time;
          contact support to request account closure.
        </LegalParagraph>
      </LegalSection>

      <LegalSection title="11. Governing law and jurisdiction">
        <LegalParagraph>
          These Terms are governed by the laws of India. Subject to any dispute-resolution process Raidex
          later adopts, the courts of Mumbai, Maharashtra have exclusive jurisdiction over any dispute arising
          from these Terms or your use of Raidex.
        </LegalParagraph>
      </LegalSection>

      <LegalSection title="12. Changes to these Terms">
        <LegalParagraph>
          We may update these Terms as Raidex's product and legal review evolves. Material changes will update
          the "Last updated" date above. Continuing to use Raidex after a change takes effect means you accept
          the updated Terms.
        </LegalParagraph>
      </LegalSection>

      <LegalSubheading>Contact</LegalSubheading>
      <LegalParagraph>
        [Raidex Technologies Pvt. Ltd. — registered address to be added] · legal@raidex.example (placeholder
        contact — to be replaced with a real support/legal address before launch)
      </LegalParagraph>
    </LegalScreen>
  );
}
