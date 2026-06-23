#!/usr/bin/env python3
"""
MongoDB Setup and Connection Test Script
Sets up collections and indexes for Raidex backend
"""

import os
import asyncio
import ssl
import certifi
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
from pathlib import Path

# Load environment variables
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

async def setup_database():
    """Setup MongoDB collections and indexes"""
    
    # Connect to MongoDB
    mongo_url = os.environ['MONGO_URL']
    db_name = os.environ['DB_NAME']
    
    print(f"Connecting to MongoDB Atlas...")
    print(f"Database: {db_name}")
    
    try:
        # Add TLS/SSL parameters to connection string
        if '?' in mongo_url:
            mongo_url_with_params = f"{mongo_url}&tls=true&tlsAllowInvalidCertificates=false"
        else:
            mongo_url_with_params = f"{mongo_url}?tls=true&tlsAllowInvalidCertificates=false"
        
        # Create client with minimal SSL settings
        client = AsyncIOMotorClient(
            mongo_url_with_params,
            serverSelectionTimeoutMS=30000,
            connectTimeoutMS=30000,
            socketTimeoutMS=30000
        )
        db = client[db_name]
        
        # Test connection
        await client.admin.command('ping')
        print("✓ Successfully connected to MongoDB Atlas!")
        
        # Get server info
        server_info = await client.server_info()
        print(f"✓ MongoDB version: {server_info.get('version')}")
        
        # List existing collections
        existing_collections = await db.list_collection_names()
        print(f"\nExisting collections: {existing_collections if existing_collections else 'None'}")
        
        print("\n" + "="*60)
        print("Setting up collections and indexes...")
        print("="*60 + "\n")
        
        # ── Users Collection ────────────────────────────────────
        print("Setting up 'users' collection...")
        await db.users.create_index("email", unique=True)
        await db.users.create_index("user_id", unique=True)
        print("✓ users indexes created")
        
        # ── User Sessions ────────────────────────────────────────
        print("Setting up 'user_sessions' collection...")
        await db.user_sessions.create_index("session_token", unique=True)
        await db.user_sessions.create_index("user_id")
        await db.user_sessions.create_index("expires_at")
        print("✓ user_sessions indexes created")
        
        # ── Push Tokens ──────────────────────────────────────────
        print("Setting up 'push_tokens' collection...")
        await db.push_tokens.create_index([("user_id", 1), ("token", 1)], unique=True)
        print("✓ push_tokens indexes created")
        
        # ── Vehicles ─────────────────────────────────────────────
        print("Setting up 'vehicles' collection...")
        await db.vehicles.create_index("vehicle_id", unique=True)
        await db.vehicles.create_index("owner_id")
        await db.vehicles.create_index([("available", 1), ("type", 1)])
        await db.vehicles.create_index([("latitude", 1), ("longitude", 1)])
        print("✓ vehicles indexes created")
        
        # ── Bookings ─────────────────────────────────────────────
        print("Setting up 'bookings' collection...")
        await db.bookings.create_index("booking_id", unique=True)
        await db.bookings.create_index([("user_id", 1), ("created_at", -1)])
        await db.bookings.create_index([("owner_id", 1), ("created_at", -1)])
        await db.bookings.create_index("vehicle_id")
        await db.bookings.create_index("status")
        print("✓ bookings indexes created")
        
        # ── Payments ─────────────────────────────────────────────
        print("Setting up 'payments' collection...")
        await db.payments.create_index("payment_id", unique=True)
        await db.payments.create_index([("user_id", 1), ("created_at", -1)])
        await db.payments.create_index("booking_id")
        await db.payments.create_index("status")
        await db.payments.create_index("provider_order_id")
        print("✓ payments indexes created")
        
        # ── KYC Submissions ──────────────────────────────────────
        print("Setting up 'kyc_submissions' collection...")
        await db.kyc_submissions.create_index("kyc_id", unique=True)
        await db.kyc_submissions.create_index([("user_id", 1), ("submitted_at", -1)])
        print("✓ kyc_submissions indexes created")
        
        # ── Inspections ──────────────────────────────────────────
        print("Setting up 'inspections' collection...")
        await db.inspections.create_index("inspection_id", unique=True)
        await db.inspections.create_index([("booking_id", 1), ("phase", 1)], unique=True)
        await db.inspections.create_index("vehicle_id")
        print("✓ inspections indexes created")
        
        # ── GPS Tracks ───────────────────────────────────────────
        print("Setting up 'gps_tracks' collection...")
        await db.gps_tracks.create_index("track_id", unique=True)
        await db.gps_tracks.create_index([("booking_id", 1), ("recorded_at", 1)])
        await db.gps_tracks.create_index([("vehicle_id", 1), ("recorded_at", -1)])
        print("✓ gps_tracks indexes created")
        
        # ── Geofence Events ──────────────────────────────────────
        print("Setting up 'geofence_events' collection...")
        await db.geofence_events.create_index("event_id", unique=True)
        await db.geofence_events.create_index([("owner_id", 1), ("created_at", -1)])
        await db.geofence_events.create_index("acknowledged")
        print("✓ geofence_events indexes created")
        
        # ── Notifications ────────────────────────────────────────
        print("Setting up 'notifications' collection...")
        await db.notifications.create_index("notification_id", unique=True)
        await db.notifications.create_index([("user_id", 1), ("created_at", -1)])
        print("✓ notifications indexes created")
        
        # ── Wallet Ledger ────────────────────────────────────────
        print("Setting up 'wallet_ledger' collection...")
        await db.wallet_ledger.create_index("ledger_id", unique=True)
        await db.wallet_ledger.create_index([("user_id", 1), ("created_at", -1)])
        print("✓ wallet_ledger indexes created")
        
        # ── Ride Miles Ledger ────────────────────────────────────
        print("Setting up 'ride_miles_ledger' collection...")
        await db.ride_miles_ledger.create_index("ledger_id", unique=True)
        await db.ride_miles_ledger.create_index([("user_id", 1), ("created_at", -1)])
        print("✓ ride_miles_ledger indexes created")
        
        # ── Support Threads ──────────────────────────────────────
        print("Setting up 'support_threads' collection...")
        await db.support_threads.create_index("thread_id", unique=True)
        await db.support_threads.create_index([("user_id", 1), ("created_at", -1)])
        print("✓ support_threads indexes created")
        
        # ── Support Messages ─────────────────────────────────────
        print("Setting up 'support_messages' collection...")
        await db.support_messages.create_index("message_id", unique=True)
        await db.support_messages.create_index([("thread_id", 1), ("created_at", 1)])
        print("✓ support_messages indexes created")
        
        # ── Agent Runs ───────────────────────────────────────────
        print("Setting up 'agent_runs' collection...")
        await db.agent_runs.create_index("run_id", unique=True)
        await db.agent_runs.create_index("created_at")
        print("✓ agent_runs indexes created")
        
        # ── Admin Audit ──────────────────────────────────────────
        print("Setting up 'admin_audit' collection...")
        await db.admin_audit.create_index("audit_id", unique=True)
        await db.admin_audit.create_index([("admin_id", 1), ("created_at", -1)])
        print("✓ admin_audit indexes created")
        
        # ── Payouts ──────────────────────────────────────────────
        print("Setting up 'payouts' collection...")
        await db.payouts.create_index("payout_id", unique=True)
        await db.payouts.create_index([("owner_id", 1), ("period_end", -1)])
        print("✓ payouts indexes created")
        
        # List all collections after setup
        print("\n" + "="*60)
        print("Database setup complete!")
        print("="*60 + "\n")
        
        collections = await db.list_collection_names()
        print(f"Total collections created: {len(collections)}")
        print(f"Collections: {', '.join(sorted(collections))}")
        
        # Show collection stats
        print("\n" + "="*60)
        print("Collection Statistics:")
        print("="*60 + "\n")
        
        for collection_name in sorted(collections):
            if not collection_name.startswith('system.'):
                stats = await db.command("collStats", collection_name)
                doc_count = stats.get('count', 0)
                indexes = stats.get('nindexes', 0)
                print(f"  {collection_name:20} - Documents: {doc_count:5}, Indexes: {indexes}")
        
        print("\n" + "="*60)
        print("✓ MongoDB setup completed successfully!")
        print("="*60 + "\n")
        
        # Close connection
        client.close()
        
    except Exception as e:
        print(f"\n✗ Error: {e}")
        raise

if __name__ == "__main__":
    asyncio.run(setup_database())
