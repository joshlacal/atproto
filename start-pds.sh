#!/bin/bash

# Start PDS with OAuth debugging enabled
# Usage: ./start-pds.sh

# Ensure we're using Node 22
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm use 22

# Create data directories first (with defaults)
mkdir -p "./pds-data"
mkdir -p "./pds-blobs"

# Load environment variables
if [ -f oauth-debug.env ]; then
    export $(cat oauth-debug.env | grep -v '^#' | xargs)
    echo "✓ Loaded oauth-debug.env configuration"
else
    echo "✗ oauth-debug.env not found!"
    exit 1
fi

# Create data directories again with configured paths if different
mkdir -p "${PDS_DATA_DIRECTORY:-./pds-data}"
mkdir -p "${PDS_BLOBSTORE_DISK_LOCATION:-./pds-blobs}"

echo "Starting PDS with OAuth debugging..."
echo "Hostname: ${PDS_HOSTNAME}"
echo "Port: ${PDS_PORT:-3000}"
echo "Log Level: ${LOG_LEVEL}"
echo "Log Systems: ${LOG_SYSTEMS}"
echo ""

cd services/pds && node index.js
