# Performance Testing Suite

Complete performance testing infrastructure for the Rocket Chat Universal Translator project.

## 🎯 Overview

This performance testing suite evaluates:
- **API Load Testing**: 100 concurrent users, P95 < 500ms
- **Memory Leak Detection**: 15-minute sustained load monitoring
- **Database Performance**: PostgreSQL, Redis, MongoDB benchmarks
- **Rocket.Chat Integration**: Chat system load testing
- **System Monitoring**: Grafana dashboards and metrics

## 📁 Files Structure

```
performance/
├── install-k6.sh                    # k6 installation script
├── api-load-test.js                 # API load testing (main test)
├── rocketchat-load-test.js          # Rocket.Chat load testing
├── memory-leak-test.js              # Memory leak detection
├── database-performance-test.sh     # Database benchmarks
├── analyze-results.sh               # Results analysis script
├── grafana-dashboard.json           # Grafana dashboard config
├── run-all-tests.sh                # Complete test suite runner
└── README.md                        # This file
```

## 🚀 Quick Start

### 1. Install k6 Load Testing Tool
```bash
./install-k6.sh
```

### 2. Start Services
```bash
cd ..
docker-compose -f docker-compose.dev.yml up -d
```

### 3. Run Complete Test Suite
```bash
./run-all-tests.sh
```

### 4. View Results
- Open `performance-report.html` in browser for visual analysis
- Review `performance-analysis-report-[timestamp].md` for recommendations

## 📊 Individual Tests

### API Load Test
Tests translation API with realistic load patterns:
```bash
k6 run --out html=performance-report.html api-load-test.js
```

**Test Profile:**
- Ramp up: 2min → 10 users → 5min @ 50 users → 2min → 100 users
- Sustained: 5 minutes at 100 concurrent users
- Ramp down: 2 minutes to 0 users

**Endpoints Tested:**
- `GET /healthz` - Health check
- `POST /api/translate` - Single translation
- `POST /api/translate/bulk` - Bulk translation
- `POST /api/detect-language` - Language detection
- `GET /api/languages` - Supported languages
- `GET /api/translations/history` - User history

### Memory Leak Detection
Monitors memory usage patterns during sustained load:
```bash
k6 run memory-leak-test.js
```

**Features:**
- 15-minute constant load test
- Real-time memory monitoring via `/metrics` endpoint
- Automatic leak detection algorithm
- Memory trend analysis and reporting

### Database Performance Tests
Comprehensive database benchmarking:
```bash
./database-performance-test.sh
```

**Tests Include:**
- PostgreSQL: Query performance, index effectiveness, connection stats
- Redis: Operations per second, memory usage, connection metrics
- MongoDB: Document operations, aggregation performance, collection stats

### Rocket.Chat Load Test
Simulates real chat user behavior:
```bash
k6 run rocketchat-load-test.js
```

**User Actions:**
- User registration and login
- Message posting to channels
- Channel subscription
- WebSocket connection testing
- User status updates

## 📈 Performance Targets

| Metric | Target | Critical Threshold |
|--------|--------|-------------------|
| P95 Response Time | < 500ms | < 1000ms |
| Error Rate | < 10% | < 15% |
| Concurrent Users | 100+ | 50+ |
| Memory Growth | Stable | < 20% increase |
| Database Queries | < 100ms avg | < 500ms avg |

## 🔧 Configuration

### Environment Variables
```bash
# API endpoint (automatically configured)
BASE_URL=http://192.168.110.199:3012
ROCKETCHAT_URL=http://192.168.110.199:3013

# Test configuration
TARGET_USERS=100
TEST_DURATION=15m
ERROR_THRESHOLD=0.1
```

### Test Scenarios
Modify test scenarios in each `.js` file:

```javascript
export const options = {
  stages: [
    { duration: '2m', target: 10 },   // Ramp up
    { duration: '5m', target: 50 },   // Sustain
    { duration: '2m', target: 100 },  // Peak
    { duration: '5m', target: 100 },  // Hold peak
    { duration: '2m', target: 0 },    // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.1'],
  },
};
```

## 📊 Monitoring & Analysis

### Grafana Dashboard
Import the dashboard configuration:
1. Open Grafana UI
2. Go to Dashboards → Import
3. Upload `grafana-dashboard.json`
4. Configure Prometheus data source

**Dashboard Panels:**
- Request rate and response times
- Error rates and status code distribution
- Memory and CPU usage
- Database connection metrics
- Cache hit rates
- Top translation language pairs

### Automated Analysis
The `analyze-results.sh` script provides:
- Threshold compliance checking
- Performance trend analysis
- Resource utilization review
- Optimization recommendations
- Comprehensive HTML and markdown reports

## 🛠️ Troubleshooting

### Common Issues

**k6 command not found:**
```bash
# macOS
brew install k6

# Linux
sudo apt-get install k6

# Docker fallback
docker run --rm -v $(pwd):/scripts grafana/k6 run /scripts/api-load-test.js
```

**Service not responding:**
```bash
# Check service status
docker-compose ps

# Check service logs
docker-compose logs translator-api

# Restart services
docker-compose restart
```

**High error rates:**
1. Check API service logs
2. Verify database connections
3. Monitor system resources
4. Reduce concurrent user count temporarily

**Memory leak false positives:**
- Java/Node.js garbage collection can cause temporary spikes
- Allow 2-3 GC cycles before flagging as leak
- Check for gradual, sustained growth over 10+ minutes

### Performance Optimization

**Immediate Actions:**
1. Enable Redis caching for translations
2. Add database indexes on frequently queried columns
3. Implement connection pooling
4. Set up rate limiting per user

**Medium-term:**
1. Implement horizontal scaling
2. Add CDN for static assets
3. Optimize database queries
4. Set up monitoring alerts

**Long-term:**
1. Microservices architecture
2. Advanced caching strategies
3. Database sharding
4. Multi-region deployment

## 📚 Resources

- [k6 Documentation](https://k6.io/docs/)
- [k6 Load Testing Guide](https://k6.io/docs/testing-guides/test-types/load-testing/)
- [PostgreSQL Performance Tuning](https://www.postgresql.org/docs/current/performance-tips.html)
- [Redis Performance Best Practices](https://redis.io/docs/management/optimization/)
- [Grafana Dashboard Best Practices](https://grafana.com/docs/grafana/latest/best-practices/)

## 🤝 Contributing

To add new performance tests:

1. Create test script in this directory
2. Follow existing naming convention (`*-test.js` or `*-test.sh`)
3. Add test to `run-all-tests.sh`
4. Update this README with test description
5. Include appropriate thresholds and success criteria

## 📝 Test Results Archive

Test results are automatically saved to timestamped directories:
- `test-results-YYYYMMDD_HHMMSS/` - Complete test suite results
- Individual test outputs in JSON and HTML formats
- Console logs for debugging
- Analysis reports with recommendations

Regular performance testing helps maintain system reliability and user experience quality.