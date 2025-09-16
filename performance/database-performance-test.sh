#!/bin/bash

set -e

echo "🔍 Testing Database Performance..."
echo "=================================="

POSTGRES_CONTAINER="translator-postgres-dev"
REDIS_CONTAINER="translator-redis-dev"
MONGO_CONTAINER="translator-mongodb-dev"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Create test results directory
mkdir -p performance-results
RESULTS_DIR="./performance-results"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

echo -e "${BLUE}📊 Performance Test Results - $TIMESTAMP${NC}"
echo "Results will be saved to: $RESULTS_DIR"

# Function to check if container is running
check_container() {
    local container=$1
    if ! docker ps --format "table {{.Names}}" | grep -q "^$container\$"; then
        echo -e "${RED}❌ Container $container is not running${NC}"
        return 1
    fi
    echo -e "${GREEN}✅ Container $container is running${NC}"
    return 0
}

# Test PostgreSQL Performance
echo -e "\n${YELLOW}🐘 Testing PostgreSQL Performance...${NC}"
if check_container $POSTGRES_CONTAINER; then
    # Create PostgreSQL test file
    cat > $RESULTS_DIR/postgres-test.sql << 'SQL'
-- Performance Test Suite for PostgreSQL
-- Run with timing enabled

\timing on

-- Test 1: Insert performance
EXPLAIN ANALYZE
INSERT INTO translations (text, source_lang, target_lang, translated_text, user_id, created_at)
SELECT
  'Performance test text ' || generate_series,
  'en',
  'lt',
  'Translated performance test ' || generate_series,
  1,
  NOW() - (generate_series || ' minutes')::interval
FROM generate_series(1, 1000);

-- Test 2: Query performance with WHERE clause
EXPLAIN ANALYZE
SELECT * FROM translations
WHERE source_lang = 'en' AND target_lang = 'lt'
ORDER BY created_at DESC
LIMIT 100;

-- Test 3: Full-text search performance (if supported)
EXPLAIN ANALYZE
SELECT * FROM translations
WHERE text ILIKE '%performance%'
ORDER BY created_at DESC
LIMIT 50;

-- Test 4: Join performance (if users table exists)
EXPLAIN ANALYZE
SELECT t.id, t.text, t.translated_text, t.created_at, u.username
FROM translations t
LEFT JOIN users u ON t.user_id = u.id
WHERE t.created_at > NOW() - INTERVAL '1 hour'
ORDER BY t.created_at DESC
LIMIT 100;

-- Test 5: Aggregation performance
EXPLAIN ANALYZE
SELECT
  source_lang,
  target_lang,
  COUNT(*) as translation_count,
  AVG(CASE WHEN LENGTH(text) > 0 THEN LENGTH(text) END) as avg_text_length
FROM translations
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY source_lang, target_lang
ORDER BY translation_count DESC;

-- Test 6: Index effectiveness analysis
SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY idx_scan DESC;

-- Test 7: Table statistics
SELECT
  schemaname,
  tablename,
  n_tup_ins as inserts,
  n_tup_upd as updates,
  n_tup_del as deletes,
  n_live_tup as live_tuples,
  n_dead_tup as dead_tuples
FROM pg_stat_user_tables
WHERE schemaname = 'public';

-- Test 8: Connection and database size info
SELECT
  datname,
  numbackends,
  xact_commit,
  xact_rollback,
  blks_read,
  blks_hit,
  temp_files,
  temp_bytes
FROM pg_stat_database
WHERE datname = 'translator';

-- Cleanup test data
DELETE FROM translations WHERE text LIKE 'Performance test text %';

SQL

    # Run PostgreSQL tests with timing
    echo "Running PostgreSQL performance tests..."
    docker exec $POSTGRES_CONTAINER psql -U translator -d translator -f /tmp/postgres-test.sql > $RESULTS_DIR/postgres-results-$TIMESTAMP.txt 2>&1

    # Copy test file to container and run
    docker cp $RESULTS_DIR/postgres-test.sql $POSTGRES_CONTAINER:/tmp/postgres-test.sql
    docker exec $POSTGRES_CONTAINER psql -U translator -d translator -f /tmp/postgres-test.sql > $RESULTS_DIR/postgres-results-$TIMESTAMP.txt 2>&1

    echo -e "${GREEN}✅ PostgreSQL tests completed. Results saved to postgres-results-$TIMESTAMP.txt${NC}"
else
    echo -e "${RED}❌ Skipping PostgreSQL tests${NC}"
fi

# Test Redis Performance
echo -e "\n${YELLOW}🔴 Testing Redis Performance...${NC}"
if check_container $REDIS_CONTAINER; then
    echo "Running Redis benchmark tests..."

    # Redis performance tests
    echo "Testing Redis SET operations..."
    docker exec $REDIS_CONTAINER redis-benchmark \
        -h localhost \
        -p 6379 \
        -n 10000 \
        -c 50 \
        -d 256 \
        -t set \
        --csv > $RESULTS_DIR/redis-set-results-$TIMESTAMP.csv

    echo "Testing Redis GET operations..."
    docker exec $REDIS_CONTAINER redis-benchmark \
        -h localhost \
        -p 6379 \
        -n 10000 \
        -c 50 \
        -d 256 \
        -t get \
        --csv > $RESULTS_DIR/redis-get-results-$TIMESTAMP.csv

    echo "Testing Redis mixed operations..."
    docker exec $REDIS_CONTAINER redis-benchmark \
        -h localhost \
        -p 6379 \
        -n 5000 \
        -c 25 \
        -d 256 \
        --csv > $RESULTS_DIR/redis-mixed-results-$TIMESTAMP.csv

    # Redis memory and connection info
    docker exec $REDIS_CONTAINER redis-cli info memory > $RESULTS_DIR/redis-memory-$TIMESTAMP.txt
    docker exec $REDIS_CONTAINER redis-cli info clients > $RESULTS_DIR/redis-clients-$TIMESTAMP.txt
    docker exec $REDIS_CONTAINER redis-cli info stats > $RESULTS_DIR/redis-stats-$TIMESTAMP.txt

    echo -e "${GREEN}✅ Redis tests completed. Results saved to redis-*-$TIMESTAMP files${NC}"
else
    echo -e "${RED}❌ Skipping Redis tests${NC}"
fi

# Test MongoDB Performance
echo -e "\n${YELLOW}🍃 Testing MongoDB Performance...${NC}"
if check_container $MONGO_CONTAINER; then
    echo "Running MongoDB performance tests..."

    # Create MongoDB performance test script
    cat > $RESULTS_DIR/mongo-test.js << 'MONGO'
// MongoDB Performance Tests
const dbName = 'rocketchat';
const db = db.getSiblingDB(dbName);

print('=== MongoDB Performance Test Results ===');
print('Timestamp:', new Date());

// Test 1: Document insertion performance
print('\n1. Testing document insertion performance...');
const startInsert = new Date();
const testData = [];
for (let i = 0; i < 1000; i++) {
    testData.push({
        msg: `Performance test message ${i}`,
        ts: new Date(),
        u: { _id: 'testuser', username: 'testuser' },
        rid: 'GENERAL',
        _updatedAt: new Date()
    });
}
db.rocketchat_message.insertMany(testData);
const insertTime = new Date() - startInsert;
print(`Inserted 1000 documents in ${insertTime}ms`);

// Test 2: Query performance
print('\n2. Testing query performance...');
const startQuery = new Date();
const messages = db.rocketchat_message.find({
    'u.username': 'testuser',
    'ts': { $gte: new Date(Date.now() - 24*60*60*1000) }
}).limit(100).toArray();
const queryTime = new Date() - startQuery;
print(`Queried ${messages.length} documents in ${queryTime}ms`);

// Test 3: Index effectiveness
print('\n3. Checking index usage...');
const explainResult = db.rocketchat_message.find({
    'u.username': 'testuser',
    'ts': { $gte: new Date(Date.now() - 7*24*60*60*1000) }
}).limit(100).explain('executionStats');

print('Execution stats:');
print(`Documents examined: ${explainResult.executionStats.totalDocsExamined}`);
print(`Documents returned: ${explainResult.executionStats.totalDocsReturned}`);
print(`Execution time: ${explainResult.executionStats.executionTimeMillis}ms`);

// Test 4: Aggregation performance
print('\n4. Testing aggregation performance...');
const startAgg = new Date();
const aggResult = db.rocketchat_message.aggregate([
    { $match: { ts: { $gte: new Date(Date.now() - 24*60*60*1000) } } },
    { $group: { _id: '$u.username', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 }
]).toArray();
const aggTime = new Date() - startAgg;
print(`Aggregation completed in ${aggTime}ms`);
print(`Results: ${aggResult.length} user groups`);

// Test 5: Collection stats
print('\n5. Collection statistics...');
const stats = db.rocketchat_message.stats();
print(`Total documents: ${stats.count}`);
print(`Average document size: ${stats.avgObjSize} bytes`);
print(`Total size: ${stats.size} bytes`);
print(`Index count: ${stats.nindexes}`);
print(`Total index size: ${stats.totalIndexSize} bytes`);

// Test 6: Database info
print('\n6. Database information...');
const dbStats = db.stats();
print(`Database: ${dbStats.db}`);
print(`Collections: ${dbStats.collections}`);
print(`Data size: ${dbStats.dataSize} bytes`);
print(`Index size: ${dbStats.indexSize} bytes`);

// Cleanup test data
print('\n7. Cleaning up test data...');
const deleteResult = db.rocketchat_message.deleteMany({
    msg: /^Performance test message/
});
print(`Deleted ${deleteResult.deletedCount} test documents`);

print('\n=== MongoDB Performance Test Completed ===');
MONGO

    # Run MongoDB tests
    docker cp $RESULTS_DIR/mongo-test.js $MONGO_CONTAINER:/tmp/mongo-test.js
    docker exec $MONGO_CONTAINER mongosh --file /tmp/mongo-test.js > $RESULTS_DIR/mongo-results-$TIMESTAMP.txt 2>&1

    echo -e "${GREEN}✅ MongoDB tests completed. Results saved to mongo-results-$TIMESTAMP.txt${NC}"
else
    echo -e "${RED}❌ Skipping MongoDB tests${NC}"
fi

# Generate summary report
echo -e "\n${BLUE}📋 Generating Performance Summary Report...${NC}"
cat > $RESULTS_DIR/performance-summary-$TIMESTAMP.txt << EOF
DATABASE PERFORMANCE TEST SUMMARY
==================================
Test Date: $(date)
Test Duration: Automated database performance tests

POSTGRESQL RESULTS:
- Test file: postgres-results-$TIMESTAMP.txt
- Key metrics: Query execution time, index usage, table statistics
- Recommendations: Check for sequential scans, ensure indexes are used

REDIS RESULTS:
- Test files: redis-*-$TIMESTAMP.csv
- Key metrics: Operations per second, latency, memory usage
- Recommendations: Monitor memory usage and connection count

MONGODB RESULTS:
- Test file: mongo-results-$TIMESTAMP.txt
- Key metrics: Document insertion/query time, aggregation performance
- Recommendations: Ensure proper indexing for chat message queries

ANALYSIS CHECKLIST:
□ PostgreSQL queries complete under 100ms
□ Redis operations achieve >10,000 ops/sec
□ MongoDB queries use appropriate indexes
□ No excessive memory usage detected
□ Connection pools are properly sized

OPTIMIZATION RECOMMENDATIONS:
1. Add database indexes for frequently queried columns
2. Implement connection pooling if not present
3. Monitor slow query logs
4. Set up database query caching where appropriate
5. Consider read replicas for high-read workloads

For detailed results, check individual result files in performance-results/
EOF

echo -e "${GREEN}✅ Performance summary generated: performance-summary-$TIMESTAMP.txt${NC}"

# Display quick summary
echo -e "\n${BLUE}📊 Quick Performance Analysis:${NC}"
echo "======================================"

if [ -f "$RESULTS_DIR/postgres-results-$TIMESTAMP.txt" ]; then
    echo -e "${YELLOW}PostgreSQL:${NC}"
    grep -i "execution time\|planning time" "$RESULTS_DIR/postgres-results-$TIMESTAMP.txt" | head -5 || echo "  Check detailed results file"
fi

if [ -f "$RESULTS_DIR/redis-set-results-$TIMESTAMP.csv" ]; then
    echo -e "${YELLOW}Redis SET Performance:${NC}"
    tail -1 "$RESULTS_DIR/redis-set-results-$TIMESTAMP.csv" | head -1 || echo "  Check detailed results file"
fi

echo -e "\n${GREEN}🎉 Database performance testing completed!${NC}"
echo -e "Results saved in: ${BLUE}$RESULTS_DIR/${NC}"
echo -e "Summary report: ${BLUE}performance-summary-$TIMESTAMP.txt${NC}"