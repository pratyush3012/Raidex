#!/usr/bin/env python3
"""
Interactive Razorpay Configuration Script
Helps you set up Razorpay payment gateway
"""

import os
from pathlib import Path


def main():
    """Interactive Razorpay setup"""
    
    print("="*60)
    print("Razorpay Payment Gateway Configuration")
    print("="*60 + "\n")
    
    print("This script will help you configure Razorpay for Raidex.\n")
    
    # Step 1: Get account status
    print("Step 1: Razorpay Account")
    print("-" * 60)
    has_account = input("Do you have a Razorpay account? (y/n): ").lower().strip()
    
    if has_account != 'y':
        print("\nPlease create a Razorpay account:")
        print("1. Go to https://razorpay.com/")
        print("2. Click 'Sign Up' and complete registration")
        print("3. Verify your email")
        print("4. Log in to the dashboard")
        print("\nRun this script again after creating your account.\n")
        return
    
    print("\n✓ Great! Let's continue.\n")
    
    # Step 2: Get API keys
    print("Step 2: API Keys")
    print("-" * 60)
    print("You need to get your API keys from Razorpay Dashboard.\n")
    
    print("For TESTING:")
    print("1. Log in to https://dashboard.razorpay.com/")
    print("2. Switch to 'Test Mode' (toggle at top)")
    print("3. Go to Settings → API Keys")
    print("4. Click 'Generate Test Key'\n")
    
    mode = input("Are you setting up Test or Live keys? (test/live): ").lower().strip()
    
    if mode == "live":
        print("\n⚠️  WARNING: Live mode will process real payments!")
        print("Make sure you've completed KYC verification.\n")
        confirm = input("Continue with Live mode? (yes/no): ").lower().strip()
        if confirm != "yes":
            print("\nSwitching to Test mode for safety.\n")
            mode = "test"
    else:
        mode = "test"
    
    print(f"\nConfiguring for {mode.upper()} mode...\n")
    
    # Get Key ID
    while True:
        key_id = input(f"Enter your Razorpay Key ID (rzp_{mode}_xxxxx): ").strip()
        expected_prefix = f"rzp_{mode}_"
        
        if not key_id:
            print("Key ID cannot be empty. Try again.\n")
            continue
        
        if not key_id.startswith(expected_prefix):
            print(f"⚠️  Key ID should start with '{expected_prefix}'")
            use_anyway = input("Use this key anyway? (y/n): ").lower().strip()
            if use_anyway != 'y':
                continue
        
        break
    
    # Get Key Secret
    while True:
        key_secret = input("Enter your Razorpay Key Secret: ").strip()
        
        if not key_secret:
            print("Key Secret cannot be empty. Try again.\n")
            continue
        
        if len(key_secret) < 20:
            print("⚠️  Key Secret seems too short")
            use_anyway = input("Use this secret anyway? (y/n): ").lower().strip()
            if use_anyway != 'y':
                continue
        
        break
    
    # Optional: Webhook Secret
    print("\nStep 3: Webhook Secret (Optional)")
    print("-" * 60)
    print("Webhooks allow Razorpay to notify your backend about payment events.")
    print("You can set this up later if needed.\n")
    
    setup_webhook = input("Do you want to configure webhook now? (y/n): ").lower().strip()
    webhook_secret = ""
    
    if setup_webhook == 'y':
        print("\nTo get webhook secret:")
        print("1. Go to Settings → Webhooks in Razorpay Dashboard")
        print("2. Create a webhook with your server URL")
        print("3. Copy the Webhook Secret (starts with 'whsec_')\n")
        
        webhook_secret = input("Enter Webhook Secret (or press Enter to skip): ").strip()
    
    # Step 4: Update .env file
    print("\nStep 4: Updating Configuration")
    print("-" * 60)
    
    env_path = Path(__file__).parent / '.env'
    
    if not env_path.exists():
        print(f"✗ .env file not found at {env_path}")
        print("Please create it from .env.example first.\n")
        return
    
    # Read current .env
    with open(env_path, 'r') as f:
        lines = f.readlines()
    
    # Update lines
    new_lines = []
    updated_provider = False
    updated_key_id = False
    updated_key_secret = False
    updated_webhook = False
    
    for line in lines:
        if line.startswith('PAYMENT_PROVIDER='):
            new_lines.append('PAYMENT_PROVIDER=razorpay\n')
            updated_provider = True
        elif line.startswith('RAZORPAY_KEY_ID=') or line.startswith('# RAZORPAY_KEY_ID='):
            new_lines.append(f'RAZORPAY_KEY_ID={key_id}\n')
            updated_key_id = True
        elif line.startswith('RAZORPAY_KEY_SECRET=') or line.startswith('# RAZORPAY_KEY_SECRET='):
            new_lines.append(f'RAZORPAY_KEY_SECRET={key_secret}\n')
            updated_key_secret = True
        elif webhook_secret and (line.startswith('RAZORPAY_WEBHOOK_SECRET=') or line.startswith('# RAZORPAY_WEBHOOK_SECRET=')):
            new_lines.append(f'RAZORPAY_WEBHOOK_SECRET={webhook_secret}\n')
            updated_webhook = True
        else:
            new_lines.append(line)
    
    # Add missing lines if needed
    if not updated_provider:
        new_lines.append('\nPAYMENT_PROVIDER=razorpay\n')
    if not updated_key_id:
        new_lines.append(f'RAZORPAY_KEY_ID={key_id}\n')
    if not updated_key_secret:
        new_lines.append(f'RAZORPAY_KEY_SECRET={key_secret}\n')
    if webhook_secret and not updated_webhook:
        new_lines.append(f'RAZORPAY_WEBHOOK_SECRET={webhook_secret}\n')
    
    # Write updated .env
    with open(env_path, 'w') as f:
        f.writelines(new_lines)
    
    print(f"✓ Configuration saved to {env_path}\n")
    
    # Step 5: Summary
    print("="*60)
    print("Configuration Complete!")
    print("="*60 + "\n")
    
    print("Summary:")
    print(f"  Mode: {mode.upper()}")
    print(f"  Key ID: {key_id[:15]}...")
    print(f"  Key Secret: {'*' * 20}")
    if webhook_secret:
        print(f"  Webhook: Configured")
    print()
    
    print("Next Steps:")
    print("1. Test the integration:")
    print("   python3 test_razorpay.py")
    print()
    print("2. Start your backend server:")
    print("   python3 server.py")
    print()
    print("3. Use test cards for testing:")
    print("   Card: 4111 1111 1111 1111")
    print("   CVV: 123")
    print("   Expiry: Any future date")
    print()
    print("4. Read full setup guide:")
    print("   cat ../RAZORPAY_SETUP.md")
    print()
    
    print("⚠️  Security Reminder:")
    print("   - Never commit .env file to git")
    print("   - Keep your Key Secret private")
    print("   - Use Test keys for development")
    print("   - Switch to Live keys only in production")
    print()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\nConfiguration cancelled.\n")
    except Exception as e:
        print(f"\n✗ Error: {e}\n")
