# Razorpay Payment Gateway Setup Guide

## Step 1: Create Razorpay Account

1. Go to [https://razorpay.com/](https://razorpay.com/)
2. Sign up for a new account or log in
3. Complete the KYC verification (required for live payments)

## Step 2: Get API Keys

### For Testing (Test Mode)
1. Log in to [Razorpay Dashboard](https://dashboard.razorpay.com/)
2. Switch to **Test Mode** (toggle in the top menu)
3. Go to **Settings** → **API Keys** → **Generate Test Key**
4. You'll get:
   - **Key ID**: `rzp_test_xxxxxxxxxxxx`
   - **Key Secret**: `xxxxxxxxxxxxxxxxxxxxxxxxxx`
5. Keep these secure - never commit to version control!

### For Production (Live Mode)
1. Complete KYC verification
2. Activate your account
3. Switch to **Live Mode**
4. Go to **Settings** → **API Keys** → **Generate Live Key**
5. You'll get:
   - **Key ID**: `rzp_live_xxxxxxxxxxxx`
   - **Key Secret**: `xxxxxxxxxxxxxxxxxxxxxxxxxx`

## Step 3: Configure Webhook (Optional but Recommended)

Webhooks allow Razorpay to notify your backend about payment events.

1. Go to **Settings** → **Webhooks**
2. Click **Create Webhook**
3. Enter your webhook URL: `https://your-domain.com/api/webhooks/razorpay`
4. Select events to track:
   - `payment.authorized`
   - `payment.captured`
   - `payment.failed`
   - `refund.created`
   - `refund.processed`
5. Copy the **Webhook Secret** (starts with `whsec_`)

## Step 4: Update Backend Configuration

Edit your `backend/.env` file:

```bash
# Switch from mock to razorpay
PAYMENT_PROVIDER=razorpay

# Add your Razorpay credentials
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxx
RAZORPAY_KEY_SECRET=your_razorpay_key_secret_here
RAZORPAY_WEBHOOK_SECRET=whsec_your_webhook_secret_here
```

**Security Notes:**
- ⚠️ **NEVER** commit `.env` file to git
- Use Test keys for development
- Use Live keys only in production
- Rotate keys periodically

## Step 5: Update Frontend Configuration

The frontend needs the Razorpay Key ID (public key) to initialize the checkout.

### For React Native (Expo)
Update `frontend/.env`:

```bash
EXPO_PUBLIC_RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxx
```

### For Web
The backend already exposes the key ID via `/api/config` endpoint.

## Step 6: Test the Integration

### Test with Razorpay Test Cards

Razorpay provides test card numbers for testing:

**Successful Payment:**
- Card Number: `4111 1111 1111 1111`
- CVV: Any 3 digits (e.g., `123`)
- Expiry: Any future date (e.g., `12/25`)
- Name: Any name

**Failed Payment:**
- Card Number: `4111 1111 1111 1234`
- This will simulate a payment failure

**UPI Test:**
- UPI ID: `success@razorpay` (success)
- UPI ID: `failure@razorpay` (failure)

### Test API Endpoints

```bash
# 1. Create a payment order
curl -X POST http://localhost:8000/api/payments/create \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "booking_id": "bkg_test123",
    "amount": 1000.00,
    "purpose": "booking"
  }'

# Response will include:
# - payment_id (your internal ID)
# - provider_order_id (Razorpay order ID)

# 2. After frontend payment, confirm it
curl -X POST http://localhost:8000/api/payments/{payment_id}/confirm \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "razorpay_payment_id": "pay_xxxxx",
    "razorpay_order_id": "order_xxxxx",
    "razorpay_signature": "signature_xxxxx"
  }'
```

## Step 7: Frontend Integration (React Native)

Install Razorpay SDK:

```bash
cd frontend
npm install react-native-razorpay
```

Or for Expo:

```bash
npx expo install react-native-razorpay
```

### Usage Example

```typescript
import RazorpayCheckout from 'react-native-razorpay';

// When user clicks "Pay Now"
const handlePayment = async (orderData: any) => {
  const options = {
    description: `Booking ${orderData.booking_id}`,
    image: 'https://your-logo-url.com/logo.png',
    currency: 'INR',
    key: process.env.EXPO_PUBLIC_RAZORPAY_KEY_ID,
    amount: orderData.amount * 100, // Amount in paise
    order_id: orderData.provider_order_id, // From create order API
    name: 'Raidex',
    prefill: {
      email: user.email,
      contact: user.phone,
      name: user.name,
    },
    theme: { color: '#6366F1' },
  };

  try {
    const data = await RazorpayCheckout.open(options);
    
    // Payment successful - send to backend for confirmation
    const confirmResponse = await fetch('/api/payments/${paymentId}/confirm', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        razorpay_payment_id: data.razorpay_payment_id,
        razorpay_order_id: data.razorpay_order_id,
        razorpay_signature: data.razorpay_signature,
      }),
    });
    
    if (confirmResponse.ok) {
      console.log('Payment confirmed!');
      // Navigate to success screen
    }
  } catch (error) {
    // Payment failed or cancelled
    console.error('Payment error:', error);
  }
};
```

## Step 8: Important Security Considerations

### Backend Signature Verification
The backend automatically verifies payment signatures using HMAC-SHA256:

```python
# This is already implemented in payment_gateway.py
body = f"{order_id}|{payment_id}"
expected_signature = hmac.new(
    key_secret.encode(),
    body.encode(),
    hashlib.sha256
).hexdigest()
```

### Never Trust Frontend
- Always verify payment status on the backend
- Never mark payment as successful based on frontend response alone
- Always verify the signature before confirming payment

## Step 9: Production Checklist

Before going live:

- [ ] Complete Razorpay KYC verification
- [ ] Switch to Live API keys
- [ ] Update `ENV=production` in `.env`
- [ ] Set up webhook endpoint for payment notifications
- [ ] Test with real card (small amount like ₹1)
- [ ] Set up proper error logging and monitoring
- [ ] Configure SSL/TLS for your domain
- [ ] Set up payment reconciliation
- [ ] Review Razorpay's compliance requirements
- [ ] Set up refund policy and workflow
- [ ] Configure payment alerts

## Troubleshooting

### "Key ID or Secret is incorrect"
- Verify you copied the correct keys from dashboard
- Check if using Test keys in Test mode
- Ensure no extra spaces in `.env` file

### "Payment signature verification failed"
- Check if order_id matches the one from create_order
- Verify key_secret is correct
- Frontend might be sending incorrect parameters

### "Amount mismatch"
- Razorpay expects amount in paise (₹1 = 100 paise)
- Backend multiplies by 100 automatically
- Ensure frontend doesn't multiply again

## Resources

- [Razorpay Documentation](https://razorpay.com/docs/)
- [Razorpay API Reference](https://razorpay.com/docs/api/)
- [Razorpay Test Cards](https://razorpay.com/docs/payments/payments/test-card-details/)
- [Razorpay Webhooks](https://razorpay.com/docs/webhooks/)
- [Razorpay React Native SDK](https://github.com/razorpay/react-native-razorpay)

## Support

If you encounter issues:
1. Check [Razorpay Status Page](https://status.razorpay.com/)
2. Review [Razorpay Community](https://community.razorpay.com/)
3. Contact Razorpay Support from dashboard
4. Check backend logs for detailed error messages
