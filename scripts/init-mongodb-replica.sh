#!/bin/bash

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}Initializing MongoDB replica set...${NC}"

# Wait for MongoDB to start
echo "Waiting for MongoDB to be ready..."
sleep 10

# Check if MongoDB is ready
echo "Checking MongoDB readiness..."
if ! docker exec translator-mongodb-dev mongo --eval "db.adminCommand('ping')" >/dev/null 2>&1; then
    echo -e "${RED}❌ MongoDB is not ready${NC}"
    exit 1
fi

# Check if replica set is already initialized
echo "Checking if replica set is already initialized..."
RS_STATUS=$(docker exec translator-mongodb-dev mongo --quiet --eval "try { rs.status(); print('INITIALIZED'); } catch(e) { print('NOT_INITIALIZED'); }")

if echo "$RS_STATUS" | grep -q "INITIALIZED"; then
    echo -e "${GREEN}✅ MongoDB replica set already initialized${NC}"
    exit 0
fi

echo "Initializing replica set..."
# Initialize replica set
docker exec translator-mongodb-dev mongo --eval '
rs.initiate({
  _id: "rs0",
  members: [
    { _id: 0, host: "mongodb:27017" }
  ]
});
'

# Wait for replica set to initialize
echo "Waiting for replica set to initialize..."
sleep 10

# Check status
echo "Checking replica set status..."
docker exec translator-mongodb-dev mongo --eval 'rs.status()' | head -20

# Wait for primary to be elected
echo "Waiting for primary to be elected..."
for i in {1..30}; do
    if docker exec translator-mongodb-dev mongo --quiet --eval "rs.isMaster().ismaster" | grep -q "true"; then
        echo -e "${GREEN}✅ MongoDB replica set initialized successfully!${NC}"
        exit 0
    fi
    echo "Waiting for primary... ($i/30)"
    sleep 2
done

echo -e "${RED}❌ Replica set initialization timed out${NC}"
exit 1