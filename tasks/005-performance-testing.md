# UŽDUOTIS #005: Performance testavimas ir optimizavimas

## 🟡 PRIORITETAS: AUKŠTAS
**Terminas**: 2-3 dienos
**Laikas**: ~4-5 valandos
**Blokuoja**: Production deployment, scalability

## 📋 Problema

Sistema neturi performance testavimo:
- Nežinoma maksimali apkrova (requests per second)
- Nėra response time benchmarks
- Memory leaks nėra testuojami
- Database query performance nematuojama
- Nėra load testing prieš production

## 🎯 Kodėl tai svarbu?

1. **Scalability**: Nežinome kiek vartotojų sistema atlaikys
2. **User Experience**: Lėtas response time = blogas UX
3. **Resource Planning**: Nežinome kiek serverių resursų reikia
4. **Cost Optimization**: Per daug resursų = per dideli kaštai
5. **SLA Compliance**: Paysera turi griežtus performance reikalavimus

## 🔧 Kaip taisyti

### Žingsnis 1: Įdiegti performance testing tools

```bash
cd /opt/dev/rocket-chat-universal-translator

# Sukurti performance testing directory
mkdir -p performance
cd performance

# Įdiegti k6 load testing tool
cat > install-k6.sh << 'EOF'
#!/bin/bash

# Install k6 on macOS
brew install k6

# Arba Docker versija
docker pull grafana/k6

echo "✅ k6 installed successfully"
EOF

chmod +x install-k6.sh
./install-k6.sh
```

### Žingsnis 2: Sukurti API load test

```javascript
cat > api-load-test.js << 'EOF'
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');

// Test configuration
export const options = {
  stages: [
    { duration: '2m', target: 10 },   // Ramp up to 10 users
    { duration: '5m', target: 50 },   // Stay at 50 users
    { duration: '2m', target: 100 },  // Ramp up to 100 users
    { duration: '5m', target: 100 },  // Stay at 100 users
    { duration: '2m', target: 0 },    // Ramp down to 0
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],  // 95% of requests must complete below 500ms
    http_req_failed: ['rate<0.1'],     // Error rate must be below 10%
    errors: ['rate<0.1'],               // Custom error rate
  },
};

const BASE_URL = 'http://192.168.110.199:3012';

export default function () {
  // Test 1: Health check
  const healthRes = http.get(`${BASE_URL}/healthz`);
  check(healthRes, {
    'health check status is 200': (r) => r.status === 200,
  });

  // Test 2: Translation API
  const payload = JSON.stringify({
    text: 'Hello world, this is a performance test',
    sourceLang: 'en',
    targetLang: 'lt',
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
  };

  const translationRes = http.post(`${BASE_URL}/api/translate`, payload, params);

  const success = check(translationRes, {
    'translation status is 200': (r) => r.status === 200,
    'translation has result': (r) => r.json('translatedText') !== undefined,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });

  errorRate.add(!success);

  // Test 3: Language detection
  const detectPayload = JSON.stringify({
    text: 'Labas rytas, kaip sekasi?',
  });

  const detectRes = http.post(`${BASE_URL}/api/detect-language`, detectPayload, params);

  check(detectRes, {
    'detection status is 200': (r) => r.status === 200,
    'detected language is lt': (r) => r.json('language') === 'lt',
  });

  sleep(1);
}
EOF
```

### Žingsnis 3: Sukurti Rocket.Chat load test

```javascript
cat > rocketchat-load-test.js << 'EOF'
import http from 'k6/http';
import { check, sleep } from 'k6';
import { WebSocket } from 'k6/experimental/websockets';

export const options = {
  stages: [
    { duration: '1m', target: 5 },    // Simulate 5 chat users
    { duration: '3m', target: 20 },   // Ramp up to 20 users
    { duration: '5m', target: 20 },   // Stay at 20 users
    { duration: '2m', target: 0 },    // Ramp down
  ],
};

const ROCKETCHAT_URL = 'http://192.168.110.199:3013';
const WS_URL = 'ws://192.168.110.199:3013/websocket';

export default function () {
  // Login to Rocket.Chat
  const loginPayload = JSON.stringify({
    user: 'testuser',
    password: 'testpass123',
  });

  const loginRes = http.post(
    `${ROCKETCHAT_URL}/api/v1/login`,
    loginPayload,
    {
      headers: { 'Content-Type': 'application/json' },
    }
  );

  check(loginRes, {
    'login successful': (r) => r.status === 200,
  });

  if (loginRes.status === 200) {
    const authToken = loginRes.json('data.authToken');
    const userId = loginRes.json('data.userId');

    // Send message
    const messagePayload = JSON.stringify({
      message: {
        msg: 'Performance test message ' + Date.now(),
      },
    });

    const messageRes = http.post(
      `${ROCKETCHAT_URL}/api/v1/chat.postMessage`,
      messagePayload,
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Auth-Token': authToken,
          'X-User-Id': userId,
        },
      }
    );

    check(messageRes, {
      'message sent': (r) => r.status === 200,
    });
  }

  sleep(2);
}
EOF
```

### Žingsnis 4: Sukurti database performance test

```bash
cat > database-performance-test.sh << 'EOF'
#!/bin/bash

echo "🔍 Testing Database Performance..."

# PostgreSQL performance test
cat > postgres-test.sql << 'SQL'
-- Test 1: Insert performance
EXPLAIN ANALYZE
INSERT INTO translations (text, source_lang, target_lang, translated_text)
SELECT
  'Test text ' || generate_series,
  'en',
  'lt',
  'Translated text ' || generate_series
FROM generate_series(1, 1000);

-- Test 2: Query performance
EXPLAIN ANALYZE
SELECT * FROM translations
WHERE source_lang = 'en' AND target_lang = 'lt'
ORDER BY created_at DESC
LIMIT 100;

-- Test 3: Join performance
EXPLAIN ANALYZE
SELECT t.*, u.username
FROM translations t
JOIN users u ON t.user_id = u.id
WHERE t.created_at > NOW() - INTERVAL '7 days';

-- Test 4: Index effectiveness
SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch
FROM pg_stat_user_indexes
ORDER BY idx_scan DESC;
SQL

# Run PostgreSQL tests
docker exec translator-postgres psql -U translator -d translator -f /tmp/postgres-test.sql

# Redis performance test
echo "Testing Redis performance..."
docker exec translator-redis redis-benchmark \
  -h localhost \
  -p 6379 \
  -n 10000 \
  -c 50 \
  -d 256

# MongoDB performance test
echo "Testing MongoDB performance..."
docker exec translator-mongo mongosh --eval "
  db.messages.explain('executionStats').find({
    'u.username': 'testuser',
    'ts': { \$gte: new Date(Date.now() - 7*24*60*60*1000) }
  }).limit(100);
"
EOF

chmod +x database-performance-test.sh
```

### Žingsnis 5: Sukurti memory leak detection

```javascript
cat > memory-leak-test.js << 'EOF'
import http from 'k6/http';
import { check } from 'k6';

export const options = {
  stages: [
    { duration: '10m', target: 10 },  // Constant load for 10 minutes
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000'],
  },
};

export default function () {
  // Monitor memory usage over time
  const memoryRes = http.get('http://192.168.110.199:3012/metrics');

  if (memoryRes.status === 200) {
    const metrics = memoryRes.body;

    // Parse memory metrics
    const heapUsed = metrics.match(/process_heap_bytes (\d+)/);
    const rss = metrics.match(/process_resident_memory_bytes (\d+)/);

    if (heapUsed && rss) {
      console.log(`Heap: ${heapUsed[1]}, RSS: ${rss[1]}`);
    }
  }

  // Create translation to stress memory
  const payload = JSON.stringify({
    text: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(100),
    sourceLang: 'en',
    targetLang: 'lt',
  });

  http.post('http://192.168.110.199:3012/api/translate', payload, {
    headers: { 'Content-Type': 'application/json' },
  });
}
EOF
```

### Žingsnis 6: Sukurti performance monitoring dashboard

```yaml
cat > grafana-dashboard.json << 'EOF'
{
  "dashboard": {
    "title": "Translation Service Performance",
    "panels": [
      {
        "title": "Request Rate",
        "targets": [
          {
            "expr": "rate(http_requests_total[5m])"
          }
        ]
      },
      {
        "title": "Response Time (p95)",
        "targets": [
          {
            "expr": "histogram_quantile(0.95, http_request_duration_seconds)"
          }
        ]
      },
      {
        "title": "Error Rate",
        "targets": [
          {
            "expr": "rate(http_requests_total{status=~'5..'}[5m])"
          }
        ]
      },
      {
        "title": "Memory Usage",
        "targets": [
          {
            "expr": "process_resident_memory_bytes"
          }
        ]
      },
      {
        "title": "Database Connections",
        "targets": [
          {
            "expr": "pg_stat_database_numbackends"
          }
        ]
      },
      {
        "title": "Cache Hit Rate",
        "targets": [
          {
            "expr": "redis_keyspace_hits_total / (redis_keyspace_hits_total + redis_keyspace_misses_total)"
          }
        ]
      }
    ]
  }
}
EOF
```

### Žingsnis 7: Paleisti performance testus

```bash
cd /opt/dev/rocket-chat-universal-translator/performance

# 1. Start services
docker-compose -f ../docker-compose.dev.yml up -d

# 2. Wait for services to be ready
sleep 30

# 3. Run API load test
k6 run api-load-test.js

# 4. Run Rocket.Chat load test
k6 run rocketchat-load-test.js

# 5. Run database performance test
./database-performance-test.sh

# 6. Run memory leak test
k6 run --duration=10m memory-leak-test.js

# 7. Generate HTML report
k6 run --out html=performance-report.html api-load-test.js
```

### Žingsnis 8: Analizuoti rezultatus

```bash
cat > analyze-results.sh << 'EOF'
#!/bin/bash

echo "📊 Performance Test Results Analysis"
echo "===================================="

# Check if thresholds passed
if [ -f performance-report.html ]; then
  echo "✅ Report generated: performance-report.html"

  # Extract key metrics
  echo ""
  echo "Key Metrics:"
  echo "- Requests per second: Check report"
  echo "- P95 response time: Check report"
  echo "- Error rate: Check report"
  echo "- Max concurrent users: 100"
fi

# Check for memory leaks
echo ""
echo "Memory Analysis:"
echo "- Check if memory increases linearly over time"
echo "- Normal: Memory stabilizes after initial growth"
echo "- Leak: Memory continuously increases"

# Database performance
echo ""
echo "Database Performance:"
echo "- Query execution time should be < 100ms"
echo "- Indexes should be used (idx_scan > 0)"
echo "- No sequential scans on large tables"

# Recommendations
echo ""
echo "📝 Optimization Recommendations:"
echo "1. Add caching for frequently accessed data"
echo "2. Optimize slow database queries"
echo "3. Implement connection pooling"
echo "4. Add rate limiting per user"
echo "5. Consider horizontal scaling for > 100 users"
EOF

chmod +x analyze-results.sh
./analyze-results.sh
```

## ✅ Sėkmės kriterijai

- [ ] k6 load testing tool įdiegtas
- [ ] API load test praeina su 100 concurrent users
- [ ] Response time p95 < 500ms
- [ ] Error rate < 10%
- [ ] Memory usage stabilus (no leaks)
- [ ] Database queries < 100ms
- [ ] Performance dashboard sukurtas
- [ ] HTML report sugeneruotas

## ⚠️ Galimos problemos

1. **Resource limits**: Docker containers gali neturėti pakankamai resursų
   - Sprendimas: Padidinti Docker Desktop memory/CPU limits

2. **Network bottleneck**: Network latency gali affect rezultatus
   - Sprendimas: Testuoti locally ir production-like environment

3. **Database connection pool**: Per mažas connection pool
   - Sprendimas: Adjust pool size based on load

4. **AI Provider rate limits**: OpenAI/Anthropic API rate limits
   - Sprendimas: Implement caching, use mock responses for testing

## 📚 Papildomi resursai

- [k6 documentation](https://k6.io/docs/)
- [Performance testing best practices](https://k6.io/docs/testing-guides/test-types/load-testing/)
- [PostgreSQL performance tuning](https://www.postgresql.org/docs/current/performance-tips.html)

## 📝 Pastabos

Po šios užduoties atlikimo:
1. Reguliariai vykdyti performance testus (CI/CD)
2. Sukurti performance baseline prieš kiekvieną release
3. Monitoriuoti production performance metrics
4. Optimizuoti based on real usage patterns