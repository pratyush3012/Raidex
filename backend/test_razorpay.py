#!/usr/bin/env python3
"""
Razorpay Integration Test Script
Tests the Razorpay payment gateway connection and API
"""

import os
import asyncio
from dotenv import load_dotenv
from pathlib import Path

# Load environment variables
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')


async def test_razorpay():
    """Test Razorpay integration"""
    
    print("="*60)
    print("Razorpay Integration Test")
    print("="*60 + "\n")
    
    # Check configuration
    provider = os.getenv("PAYMENT_PROVIDER", "mock")
    print(f"Current Payment Provider: {provider}\n")
    
    if provider.lower() != "razorpay":
        print("⚠️  Payment provider is not set to 'razorpay'")
        print("   Update your .env file:")
        print("   PAYMENT_PROVIDER=razorpay\n")
        return False
    
    # Check for Razorpay credentials
    key_id = os.getenv("RAZORPAY_KEY_ID")
    key_secret = os.getenv("RAZORPAY_KEY_SECRET")
    
    if not key_id:
        print("✗ RAZORPAY_KEY_ID not found in .env")
        print("  Get your key from: https://dashboard.razorpay.com/app/keys\n")
        return False
    
    if not key_secret:
        print("✗ RAZORPAY_KEY_SECRET not found in .env")
        print("  Get your secret from: https://dashboard.razorpay.com/app/keys\n")
        return False
    
    print(f"✓ Key ID: {key_id[:15]}...")
    print(f"✓ Key Secret: {'*' * 20} (hidden)\n")
    
    # Determine if test or live mode
    mode = "TEST" if key_id.startswith("rzp_test_") else "LIVE"
    print(f"Mode: {mode} Mode\n")
    
    if mode == "LIVE":
        print("⚠️  WARNING: Using LIVE credentials!")
        print("   Make sure this is intentional.\n")
    
    # Test the gateway
    print("Testing Razorpay Gateway...")
    print("-" * 60 + "\n")
    
    try:
        from providers.payment_gateway import get_payment_gateway
        
        gateway = get_payment_gateway()
        print(f"✓ Gateway initialized: {gateway.name}\n")
        
        # Test 1: Create Order
        print("Test 1: Creating a test order...")
        test_amount = 100.00  # ₹100
        
        order = await gateway.create_order(
            amount=test_amount,
            currency="INR",
            meta={"test": "true", "purpose": "integration_test"}
        )
        
        print(f"✓ Order created successfully!")
        print(f"  Order ID: {order.order_id}")
        print(f"  Amount: ₹{order.amount}")
        print(f"  Currency: {order.currency}")
        print(f"  Provider: {order.provider}\n")
        
        # Test 2: Signature Verification (simulate)
        print("Test 2: Testing signature verification...")
        import hmac
        import hashlib
        
        # Simulate a payment response
        test_payment_id = "pay_test123456789"
        
        # Generate valid signature
        body = f"{order.order_id}|{test_payment_id}"
        valid_signature = hmac.new(
            key_secret.encode(),
            body.encode(),
            hashlib.sha256
        ).hexdigest()
        
        result = await gateway.confirm(
            order_id=order.order_id,
            provider_payment_id=test_payment_id,
            provider_signature=valid_signature
        )
        
        if result.success:
            print(f"✓ Signature verification passed!")
            print(f"  Payment ID: {result.provider_payment_id}")
            print(f"  Signature: {result.provider_signature[:20]}...\n")
        else:
            print(f"✗ Signature verification failed: {result.failure_reason}\n")
            return False
        
        # Test 3: Invalid Signature
        print("Test 3: Testing invalid signature detection...")
        invalid_result = await gateway.confirm(
            order_id=order.order_id,
            provider_payment_id=test_payment_id,
            provider_signature="invalid_signature_123"
        )
        
        if not invalid_result.success:
            print(f"✓ Invalid signature correctly rejected!")
            print(f"  Reason: {invalid_result.failure_reason}\n")
        else:
            print(f"✗ Invalid signature was accepted (security issue!)\n")
            return False
        
        print("="*60)
        print("✓ All Razorpay integration tests passed!")
        print("="*60 + "\n")
        
        print("Next Steps:")
        print("1. Test with Razorpay checkout in your frontend")
        print("2. Use test card: 4111 1111 1111 1111")
        print("3. Monitor payments in Razorpay Dashboard")
        print("4. Set up webhooks for payment notifications\n")
        
        return True
        
    except Exception as e:
        print(f"\n✗ Error: {e}\n")
        import traceback
        traceback.print_exc()
        return False


async def test_api_connectivity():
    """Test connectivity to Razorpay API"""
    print("\nTesting Razorpay API connectivity...")
    
    try:
        import httpx
        
        key_id = os.getenv("RAZORPAY_KEY_ID")
        key_secret = os.getenv("RAZORPAY_KEY_SECRET")
        
        if not key_id or not key_secret:
            print("✗ Missing credentials\n")
            return False
        
        # Test API with a simple request
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(
                "https://api.razorpay.com/v1/payments",
                auth=(key_id, key_secret),
                params={"count": 1}
            )
        
        if response.status_code == 200:
            print("✓ Successfully connected to Razorpay API")
            data = response.json()
            print(f"  API is responding correctly")
            print(f"  Account is active\n")
            return True
        elif response.status_code == 401:
            print("✗ Authentication failed - check your credentials")
            print("  Verify Key ID and Secret in .env file\n")
            return False
        else:
            print(f"✗ API returned status code: {response.status_code}")
            print(f"  Response: {response.text}\n")
            return False
            
    except Exception as e:
        print(f"✗ Connection error: {e}\n")
        return False


async def main():
    """Run all tests"""
    
    # Test API connectivity first
    connectivity_ok = await test_api_connectivity()
    
    if not connectivity_ok:
        print("Fix connectivity issues before proceeding.\n")
        return
    
    # Test the gateway
    await test_razorpay()


if __name__ == "__main__":
    asyncio.run(main())
