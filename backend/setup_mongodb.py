#!/usr/bin/env python3
"""
MongoDB Setup and Connection Test Script
Sets up collections and indexes for Raidex backend.

Index definitions live in one place - server.create_indexes() - so this
script and the FastAPI startup hook can never drift out of sync again.
"""

import os
import asyncio
import sys
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
from pathlib import Path

# Load environment variables
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')
sys.path.insert(0, str(ROOT_DIR))

from server import create_indexes  # noqa: E402  (import after sys.path setup)


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

        await create_indexes(db)
        print("✓ All indexes created (see server.create_indexes for the full list)")

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
