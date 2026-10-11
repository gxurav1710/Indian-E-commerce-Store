#!/usr/bin/env bash
echo "=============================================================================="
echo "               STARTING UNIFIED E-COMMERCE PLATFORM (PRODUCTION)"
echo "=============================================================================="
echo ""
echo "Starting all microservices and unified background daemons..."
echo "Storefront:      http://localhost:5000"
echo "Business Admin:  http://localhost:5050 (Password in .env)"
echo "Control Center:  http://localhost:8090"
echo "Payment Gateway: http://localhost:6001"
echo ""
node services/core-handler/src/index.js
