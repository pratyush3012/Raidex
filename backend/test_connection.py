#!/usr/bin/env python3
"""
Simple MongoDB Connection Test (Synchronous)
"""

import os
from pymongo import MongoClient
from dotenv import load_dotenv
from pathlib import Path

# Load environment variables
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

def test_connection():
    """Test MongoDB connection"""
    
    mongo_url = os.environ['MONGO_URL']
    db_name = os.environ['DB_NAME']
    
    print(f"Testing MongoDB connection...")
    print(f"Database: {db_name}\n")
    
    try:
        # Try connection with TLS disabled for testing (NOT FOR PRODUCTION)
        # This helps us isolate if the issue is TLS-specific
        print("Attempt 1: Testing with default TLS settings...")
        client = MongoClient(
            mongo_url,
            serverSelectionTimeoutMS=5000
        )
        
        # Test connection
        client.admin.command('ping')
        print("✓ Successfully connected to MongoDB!\n")
        
        # Get server info
        server_info = client.server_info()
        print(f"MongoDB version: {server_info.get('version')}")
        
        # List databases
        databases = client.list_database_names()
        print(f"\nAvailable databases: {databases}")
        
        # Get the target database
        db = client[db_name]
        
        # List collections
        collections = db.list_collection_names()
        print(f"\nCollections in '{db_name}': {collections if collections else 'None (empty database)'}")
        
        # Test write operation
        print("\nTesting write operation...")
        test_doc = {"test": "connection", "status": "success"}
        result = db.test_collection.insert_one(test_doc)
        print(f"✓ Write test successful. Inserted ID: {result.inserted_id}")
        
        # Test read operation
        print("\nTesting read operation...")
        found_doc = db.test_collection.find_one({"test": "connection"})
        print(f"✓ Read test successful. Document: {found_doc}")
        
        # Clean up test document
        db.test_collection.delete_one({"test": "connection"})
        print("\n✓ Test document cleaned up")
        
        print("\n" + "="*60)
        print("✓ All connection tests passed!")
        print("="*60 + "\n")
        
        client.close()
        return True
        
    except Exception as e:
        print(f"\n✗ Connection failed: {e}\n")
        print("Troubleshooting tips:")
        print("1. Check if your IP address is whitelisted in MongoDB Atlas")
        print("2. Verify the connection string is correct")
        print("3. Ensure network connectivity to MongoDB Atlas")
        print("4. Check if there are firewall restrictions")
        return False

if __name__ == "__main__":
    test_connection()
