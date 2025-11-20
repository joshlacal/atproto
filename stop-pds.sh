#!/bin/bash

# Stop the PDS server
# Usage: ./stop-pds.sh

echo "Stopping PDS..."

# Find and kill the node process running the PDS
pkill -f "node.*services/pds/index.js"

if [ $? -eq 0 ]; then
    echo "✓ PDS stopped"
else
    echo "✗ PDS not running or failed to stop"
    exit 1
fi
