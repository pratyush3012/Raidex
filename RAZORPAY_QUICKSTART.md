# Razorpay Integration - Quick Start

## 🚀 Quick Setup (5 minutes)

### Option 1: Interactive Configuration (Recommended)
```bash
cd backend
python3 configure_razorpay.py
```

This interactive script will:
- Guide you through the setup process
- Update your `.env` file automatically
- Validate your configuration

### Option 2: Manual Configuration

1. **Get Razorpay Keys**
   - Go to https://dashboard.razorpay.com/
   - Switch to **Test Mode**
   - Navigate to: Settings → API Keys → Generate Test Key

2. **Update `.env` file**
   ```bash
   cd backend
   nano .env  # or use your preferred editor
   ```

3. **Add these lines:**
   ```bash
   PAYMENT_PROVIDER=razorpay
   RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxx
   RAZORPAY_KEY_SECRET=your_secret_key_here
   ```

## ✅ Test Your Setup

Run the test script:
```bash
cd backend
python3 test_razorpay.py
```

Expected output:
```
✓ Key ID: rzp_test_xxxxx...
✓ Key Secret: ******************** (hidden)
✓ Order created successfully!
✓ Signature verification passed!
✓ All Razorpay integration tests passed!
```

## 🎯 Test Card Details

Use these for testing payments:

**Success:**
- Card: `4111 1111 1111 1111`
- CVV: `123`
- Expiry: `12/25` (any future date)
- Name: Any name

**Failure:**
- Card: `4111 1111 1111 1234`

**UPI Success:**
- UPI ID: `success@razorpay`

## 📱 Frontend Integration

### Install Razorpay SDK
```bash
cd frontend
npm install react-native-razorpay
# or
npx expo install react-native-razorpay
```

### Update Frontend Environment
Create/update `frontend/.env`:
```bash
EXPO_PUBLIC_RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxx
```

### Basic Payment Flow

```typescript
import RazorpayCheckout from 'react-native-razorpay';

// 1. Create order from backend
const createOrder = async () => {
  const response = await fetch('http://your-backend/api/payments/create', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      booking_id: 'bkg_123',
      amount: 1000.00,
      purpose: 'booking'
    })
  });
  return await response.json();
};

// 2. Open Razorpay checkout
const openRazorpay = async () => {
  const order = await createOrder();
  
  const options = {
    description: 'Vehicle Booking',
    currency: 'INR',
    key: process.env.EXPO_PUBLIC_RAZORPAY_KEY_ID,
    amount: order.amount * 100, // paise
    order_id: order.provider_order_id,
    name: 'Raidex',
    prefill: {
      email: 'user@example.com',
      contact: '9999999999',
      name: 'John Doe'
    },
    theme: { color: '#6366F1' }
  };

  try {
    const data = await RazorpayCheckout.open(options);
    
    // 3. Confirm payment on backend
    await fetch(`http://your-backend/api/payments/${order.payment_id}/confirm`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        razorpay_payment_id: data.razorpay_payment_id,
        razorpay_order_id: data.razorpay_order_id,
        razorpay_signature: data.razorpay_signature,
      })
    });
    
    console.log('Payment successful!');
  } catch (error) {
    console.error('Payment failed:', error);
  }
};
```

## 🔍 API Endpoints

### 1. Create Payment Order
```bash
POST /api/payments/create
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json

{
  "booking_id": "bkg_abc123",
  "amount": 1000.00,
  "purpose": "booking"
}

Response:
{
  "payment_id": "pay_internal123",
  "provider_order_id": "order_razorpay123",
  "amount": 1000.00,
  "currency": "INR",
  "status": "created"
}
```

### 2. Confirm Payment
```bash
POST /api/payments/{payment_id}/confirm
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json

{
  "razorpay_payment_id": "pay_xxxxx",
  "razorpay_order_id": "order_xxxxx",
  "razorpay_signature": "signature_xxxxx"
}

Response:
{
  "payment_id": "pay_internal123",
  "status": "succeeded",
  "amount": 1000.00
}
```

### 3. Get Public Config
```bash
GET /api/config

Response:
{
  "payment_provider": "razorpay",
  "razorpay_key_id": "rzp_test_xxxxx"
}
```

## 🛡️ Security Features

The backend automatically:
- ✅ Verifies payment signatures using HMAC-SHA256
- ✅ Validates order IDs match
- ✅ Prevents payment replay attacks
- ✅ Hides Key Secret from frontend
- ✅ Logs all payment attempts

## 🐛 Troubleshooting

### "Key ID or Secret is incorrect"
```bash
# Verify your keys
python3 test_razorpay.py

# Check .env file
cat .env | grep RAZORPAY
```

### "Signature verification failed"
- Ensure you're passing all three parameters from frontend:
  - `razorpay_payment_id`
  - `razorpay_order_id`
  - `razorpay_signature`

### "Order not found"
- Make sure to create order first using `/api/payments/create`
- Use the `provider_order_id` from the response

## 📚 Full Documentation

For detailed information, see:
- **Complete Setup Guide:** `RAZORPAY_SETUP.md`
- **Razorpay Docs:** https://razorpay.com/docs/
- **Test Cards:** https://razorpay.com/docs/payments/payments/test-card-details/

## 🚦 Production Checklist

Before going live:
- [ ] Complete KYC verification on Razorpay
- [ ] Get Live API keys
- [ ] Update `PAYMENT_PROVIDER=razorpay` with live keys
- [ ] Set `ENV=production` in `.env`
- [ ] Test with small real amount (₹1)
- [ ] Set up webhooks for payment notifications
- [ ] Configure SSL/TLS for your domain
- [ ] Review refund policy
- [ ] Set up payment monitoring

## 💡 Tips

1. **Always test in Test Mode first**
2. **Never commit `.env` file**
3. **Use webhooks for reliable payment status**
4. **Keep logs of all transactions**
5. **Set up alerts for failed payments**

## 🆘 Need Help?

- Check backend logs: `tail -f backend/logs/app.log`
- Razorpay Dashboard: https://dashboard.razorpay.com/
- Razorpay Status: https://status.razorpay.com/
- Support: support@razorpay.com
