# UŽDUOTIS #006: Monitoring ir Logging infrastruktūra

## 🟡 PRIORITETAS: AUKŠTAS
**Terminas**: 2-3 dienos
**Laikas**: ~5-6 valandos
**Blokuoja**: Production observability, incident response

## 📋 Problema

Sistema neturi monitoring ir centralized logging:
- Nėra real-time metrics stebėjimo
- Logs išsibarstę per konteinerius
- Nėra alerting kai servisai nulūžta
- Negalima trace'inti requests per sistemą
- Nėra dashboards production stebėjimui

## 🎯 Kodėl tai kritiškai svarbu?

1. **Incident Response**: Be monitoring nežinome kada sistema neveikia
2. **Debugging**: Be centralized logs sunku rasti problemas
3. **Performance**: Negalime matyti degradation real-time
4. **Compliance**: Paysera reikalauja audit logging
5. **Cost Control**: Nežinome resource usage trends

## 🔧 Kaip taisyti

### Žingsnis 1: Įdiegti Prometheus + Grafana stack

```yaml
cat > docker-compose.monitoring.yml << 'EOF'
version: '3.8'

services:
  prometheus:
    image: prom/prometheus:latest
    container_name: translator-prometheus
    volumes:
      - ./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus_data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
      - '--web.console.libraries=/usr/share/prometheus/console_libraries'
      - '--web.console.templates=/usr/share/prometheus/consoles'
      - '--web.enable-lifecycle'
    ports:
      - "9090:9090"
    networks:
      - translator-network
    restart: unless-stopped

  grafana:
    image: grafana/grafana:latest
    container_name: translator-grafana
    volumes:
      - grafana_data:/var/lib/grafana
      - ./monitoring/grafana/provisioning:/etc/grafana/provisioning
    environment:
      - GF_SECURITY_ADMIN_USER=admin
      - GF_SECURITY_ADMIN_PASSWORD=admin123
      - GF_INSTALL_PLUGINS=redis-datasource,postgres-datasource
    ports:
      - "3014:3000"
    networks:
      - translator-network
    restart: unless-stopped
    depends_on:
      - prometheus

  loki:
    image: grafana/loki:latest
    container_name: translator-loki
    ports:
      - "3100:3100"
    volumes:
      - ./monitoring/loki-config.yml:/etc/loki/local-config.yaml
      - loki_data:/loki
    command: -config.file=/etc/loki/local-config.yaml
    networks:
      - translator-network
    restart: unless-stopped

  promtail:
    image: grafana/promtail:latest
    container_name: translator-promtail
    volumes:
      - /var/log:/var/log:ro
      - /var/lib/docker/containers:/var/lib/docker/containers:ro
      - ./monitoring/promtail-config.yml:/etc/promtail/config.yml
    command: -config.file=/etc/promtail/config.yml
    networks:
      - translator-network
    restart: unless-stopped
    depends_on:
      - loki

  node-exporter:
    image: prom/node-exporter:latest
    container_name: translator-node-exporter
    ports:
      - "9100:9100"
    volumes:
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
      - /:/rootfs:ro
    command:
      - '--path.procfs=/host/proc'
      - '--path.rootfs=/rootfs'
      - '--path.sysfs=/host/sys'
      - '--collector.filesystem.mount-points-exclude=^/(sys|proc|dev|host|etc)($$|/)'
    networks:
      - translator-network
    restart: unless-stopped

  postgres-exporter:
    image: prometheuscommunity/postgres-exporter:latest
    container_name: translator-postgres-exporter
    environment:
      DATA_SOURCE_NAME: "postgresql://translator:translator123@postgres:5432/translator?sslmode=disable"
    ports:
      - "9187:9187"
    networks:
      - translator-network
    restart: unless-stopped

  redis-exporter:
    image: oliver006/redis_exporter:latest
    container_name: translator-redis-exporter
    environment:
      REDIS_ADDR: "redis:6379"
    ports:
      - "9121:9121"
    networks:
      - translator-network
    restart: unless-stopped

  alertmanager:
    image: prom/alertmanager:latest
    container_name: translator-alertmanager
    volumes:
      - ./monitoring/alertmanager.yml:/etc/alertmanager/alertmanager.yml
      - alertmanager_data:/alertmanager
    command:
      - '--config.file=/etc/alertmanager/alertmanager.yml'
      - '--storage.path=/alertmanager'
    ports:
      - "9093:9093"
    networks:
      - translator-network
    restart: unless-stopped

volumes:
  prometheus_data:
  grafana_data:
  loki_data:
  alertmanager_data:

networks:
  translator-network:
    external: true
EOF
```

### Žingsnis 2: Sukurti Prometheus konfigūraciją

```yaml
mkdir -p monitoring

cat > monitoring/prometheus.yml << 'EOF'
global:
  scrape_interval: 15s
  evaluation_interval: 15s
  external_labels:
    monitor: 'translator-monitor'

alerting:
  alertmanagers:
    - static_configs:
        - targets: ['alertmanager:9093']

rule_files:
  - "alerts.yml"

scrape_configs:
  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']

  - job_name: 'node'
    static_configs:
      - targets: ['node-exporter:9100']

  - job_name: 'translator-api'
    static_configs:
      - targets: ['translator-api:3001']
    metrics_path: '/metrics'

  - job_name: 'postgres'
    static_configs:
      - targets: ['postgres-exporter:9187']

  - job_name: 'redis'
    static_configs:
      - targets: ['redis-exporter:9121']

  - job_name: 'docker'
    static_configs:
      - targets: ['host.docker.internal:9323']
EOF
```

### Žingsnis 3: Sukurti alert rules

```yaml
cat > monitoring/alerts.yml << 'EOF'
groups:
  - name: translator_alerts
    interval: 30s
    rules:
      # Service availability
      - alert: ServiceDown
        expr: up == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Service {{ $labels.job }} is down"
          description: "{{ $labels.instance }} of job {{ $labels.job }} has been down for more than 1 minute."

      # API response time
      - alert: HighResponseTime
        expr: http_request_duration_seconds{quantile="0.95"} > 0.5
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High response time on {{ $labels.job }}"
          description: "95th percentile response time is above 500ms (current: {{ $value }}s)"

      # Error rate
      - alert: HighErrorRate
        expr: rate(http_requests_total{status=~"5.."}[5m]) > 0.05
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "High error rate on {{ $labels.job }}"
          description: "Error rate is above 5% (current: {{ $value }})"

      # Memory usage
      - alert: HighMemoryUsage
        expr: (1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) > 0.9
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High memory usage on {{ $labels.instance }}"
          description: "Memory usage is above 90% (current: {{ $value }})"

      # Disk space
      - alert: LowDiskSpace
        expr: (node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"}) < 0.1
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Low disk space on {{ $labels.instance }}"
          description: "Less than 10% disk space remaining"

      # Database connections
      - alert: TooManyDatabaseConnections
        expr: pg_stat_database_numbackends{datname="translator"} > 80
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Too many database connections"
          description: "Database has {{ $value }} active connections"

      # Redis memory
      - alert: RedisHighMemory
        expr: redis_memory_used_bytes / redis_memory_max_bytes > 0.9
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Redis memory usage high"
          description: "Redis is using more than 90% of max memory"
EOF
```

### Žingsnis 4: Sukurti Loki logging konfigūraciją

```yaml
cat > monitoring/loki-config.yml << 'EOF'
auth_enabled: false

server:
  http_listen_port: 3100
  grpc_listen_port: 9096

common:
  path_prefix: /loki
  storage:
    filesystem:
      chunks_directory: /loki/chunks
      rules_directory: /loki/rules
  replication_factor: 1
  ring:
    instance_addr: 127.0.0.1
    kvstore:
      store: inmemory

schema_config:
  configs:
    - from: 2023-01-01
      store: boltdb-shipper
      object_store: filesystem
      schema: v11
      index:
        prefix: index_
        period: 24h

ruler:
  alertmanager_url: http://alertmanager:9093

analytics:
  reporting_enabled: false
EOF

cat > monitoring/promtail-config.yml << 'EOF'
server:
  http_listen_port: 9080
  grpc_listen_port: 0

positions:
  filename: /tmp/positions.yaml

clients:
  - url: http://loki:3100/loki/api/v1/push

scrape_configs:
  - job_name: containers
    static_configs:
      - targets:
          - localhost
        labels:
          job: containerlogs
          __path__: /var/lib/docker/containers/*/*log

    pipeline_stages:
      - json:
          expressions:
            output: log
            stream: stream
            attrs:
      - json:
          expressions:
            tag:
          source: attrs
      - regex:
          expression: (?P<container_name>(?:[^|]*))\|(?P<image_name>(?:[^|]*))
          source: tag
      - timestamp:
          format: RFC3339Nano
          source: time
      - labels:
          stream:
          container_name:
          image_name:
      - output:
          source: output

  - job_name: system
    static_configs:
      - targets:
          - localhost
        labels:
          job: varlogs
          __path__: /var/log/*log
EOF
```

### Žingsnis 5: Pridėti metrics į API

```typescript
cat > api/src/middleware/metrics.ts << 'EOF'
import { Request, Response, NextFunction } from 'express';
import promClient from 'prom-client';

// Create a Registry
const register = new promClient.Registry();

// Add default metrics
promClient.collectDefaultMetrics({ register });

// Custom metrics
const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.1, 0.3, 0.5, 0.7, 1, 3, 5, 7, 10],
});

const httpRequestTotal = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status'],
});

const translationCounter = new promClient.Counter({
  name: 'translations_total',
  help: 'Total number of translations',
  labelNames: ['source_lang', 'target_lang', 'provider'],
});

const activeConnections = new promClient.Gauge({
  name: 'active_connections',
  help: 'Number of active connections',
});

// Register metrics
register.registerMetric(httpRequestDuration);
register.registerMetric(httpRequestTotal);
register.registerMetric(translationCounter);
register.registerMetric(activeConnections);

// Middleware to track metrics
export const metricsMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();

  // Track active connections
  activeConnections.inc();

  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    const route = req.route?.path || req.path;

    // Record metrics
    httpRequestDuration
      .labels(req.method, route, res.statusCode.toString())
      .observe(duration);

    httpRequestTotal
      .labels(req.method, route, res.statusCode.toString())
      .inc();

    activeConnections.dec();
  });

  next();
};

// Endpoint to expose metrics
export const metricsEndpoint = (_req: Request, res: Response) => {
  res.set('Content-Type', register.contentType);
  register.metrics().then(metrics => {
    res.end(metrics);
  });
};

// Export for use in translation service
export const incrementTranslationCounter = (
  sourceLang: string,
  targetLang: string,
  provider: string
) => {
  translationCounter.labels(sourceLang, targetLang, provider).inc();
};

export { register };
EOF
```

### Žingsnis 6: Sukurti Grafana dashboards

```json
cat > monitoring/grafana/provisioning/dashboards/translator-dashboard.json << 'EOF'
{
  "dashboard": {
    "title": "Universal Translator Dashboard",
    "panels": [
      {
        "gridPos": {"h": 8, "w": 12, "x": 0, "y": 0},
        "title": "Request Rate",
        "targets": [
          {
            "expr": "sum(rate(http_requests_total[5m])) by (method)",
            "legendFormat": "{{method}}"
          }
        ],
        "type": "graph"
      },
      {
        "gridPos": {"h": 8, "w": 12, "x": 12, "y": 0},
        "title": "Response Time (p95)",
        "targets": [
          {
            "expr": "histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))"
          }
        ],
        "type": "graph"
      },
      {
        "gridPos": {"h": 8, "w": 12, "x": 0, "y": 8},
        "title": "Translation Rate by Language",
        "targets": [
          {
            "expr": "sum(rate(translations_total[5m])) by (source_lang, target_lang)",
            "legendFormat": "{{source_lang}} → {{target_lang}}"
          }
        ],
        "type": "graph"
      },
      {
        "gridPos": {"h": 8, "w": 12, "x": 12, "y": 8},
        "title": "Error Rate",
        "targets": [
          {
            "expr": "sum(rate(http_requests_total{status=~'5..'}[5m]))"
          }
        ],
        "type": "graph"
      },
      {
        "gridPos": {"h": 8, "w": 8, "x": 0, "y": 16},
        "title": "Service Health",
        "targets": [
          {
            "expr": "up",
            "legendFormat": "{{job}}"
          }
        ],
        "type": "table"
      },
      {
        "gridPos": {"h": 8, "w": 8, "x": 8, "y": 16},
        "title": "Memory Usage",
        "targets": [
          {
            "expr": "process_resident_memory_bytes / 1024 / 1024",
            "legendFormat": "{{job}}"
          }
        ],
        "type": "graph"
      },
      {
        "gridPos": {"h": 8, "w": 8, "x": 16, "y": 16},
        "title": "Database Connections",
        "targets": [
          {
            "expr": "pg_stat_database_numbackends{datname='translator'}"
          }
        ],
        "type": "stat"
      }
    ]
  }
}
EOF
```

### Žingsnis 7: Sukurti alerting konfigūraciją

```yaml
cat > monitoring/alertmanager.yml << 'EOF'
global:
  resolve_timeout: 5m
  smtp_from: 'alerts@paysera.tech'
  smtp_smarthost: 'smtp.gmail.com:587'
  smtp_auth_username: 'alerts@paysera.tech'
  smtp_auth_password: 'YOUR_SMTP_PASSWORD'

route:
  group_by: ['alertname', 'cluster', 'service']
  group_wait: 10s
  group_interval: 10s
  repeat_interval: 12h
  receiver: 'team-leads'

  routes:
    - match:
        severity: critical
      receiver: 'pagerduty'
      continue: true

    - match:
        severity: warning
      receiver: 'slack'

receivers:
  - name: 'team-leads'
    email_configs:
      - to: 'team-lead@paysera.tech'
        headers:
          Subject: 'Translation Service Alert: {{ .GroupLabels.alertname }}'

  - name: 'slack'
    slack_configs:
      - api_url: 'YOUR_SLACK_WEBHOOK_URL'
        channel: '#translator-alerts'
        title: 'Translation Service Alert'
        text: '{{ range .Alerts }}{{ .Annotations.summary }}{{ end }}'

  - name: 'pagerduty'
    pagerduty_configs:
      - service_key: 'YOUR_PAGERDUTY_KEY'
        description: '{{ .CommonAnnotations.summary }}'

inhibit_rules:
  - source_match:
      severity: 'critical'
    target_match:
      severity: 'warning'
    equal: ['alertname', 'dev', 'instance']
EOF
```

### Žingsnis 8: Sukurti startup script

```bash
cat > scripts/start-monitoring.sh << 'EOF'
#!/bin/bash

echo "🚀 Starting Monitoring Stack..."

# Create necessary directories
mkdir -p monitoring/grafana/provisioning/{dashboards,datasources}

# Create Grafana datasource config
cat > monitoring/grafana/provisioning/datasources/prometheus.yml << 'DATASOURCE'
apiVersion: 1

datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true

  - name: Loki
    type: loki
    access: proxy
    url: http://loki:3100
DATASOURCE

# Start monitoring stack
docker-compose -f docker-compose.monitoring.yml up -d

# Wait for services to start
echo "Waiting for services to start..."
sleep 20

# Check status
echo ""
echo "📊 Monitoring Stack Status:"
echo "=========================="
curl -s http://localhost:9090/-/healthy && echo "✅ Prometheus: Healthy" || echo "❌ Prometheus: Not ready"
curl -s http://localhost:3014/api/health && echo "✅ Grafana: Healthy" || echo "❌ Grafana: Not ready"
curl -s http://localhost:3100/ready && echo "✅ Loki: Healthy" || echo "❌ Loki: Not ready"
curl -s http://localhost:9093/-/healthy && echo "✅ Alertmanager: Healthy" || echo "❌ Alertmanager: Not ready"

echo ""
echo "Access URLs:"
echo "  Prometheus: http://192.168.110.199:9090"
echo "  Grafana: http://192.168.110.199:3014 (admin/admin123)"
echo "  Alertmanager: http://192.168.110.199:9093"
echo ""
echo "To view logs:"
echo "  docker-compose -f docker-compose.monitoring.yml logs -f"
EOF

chmod +x scripts/start-monitoring.sh
```

## ✅ Sėkmės kriterijai

- [ ] Prometheus scrape'ina visus servisus
- [ ] Grafana dashboard rodo metrics
- [ ] Loki renka logs iš visų konteinerių
- [ ] Alerts veikia ir siunčia pranešimus
- [ ] Metrics endpoint API veikia (/metrics)
- [ ] Custom metrics tracking translations
- [ ] Alertmanager konfigūruotas su receivers
- [ ] Monitoring stack startuoja automatiškai

## ⚠️ Galimos problemos

1. **Port konfliktai**: Grafana default port 3000 gali būti užimtas
   - Sprendimas: Naudojame 3014 portą

2. **Prometheus scraping failures**: Servisai gali neturėti metrics endpoint
   - Sprendimas: Pridėti metrics middleware į API

3. **High cardinality**: Per daug labels gali padaryti Prometheus lėtą
   - Sprendimas: Limit labels, use recording rules

4. **Log volume**: Per daug logs gali užpildyti diską
   - Sprendimas: Implement log rotation, retention policies

## 📚 Papildomi resursai

- [Prometheus documentation](https://prometheus.io/docs/)
- [Grafana tutorials](https://grafana.com/tutorials/)
- [Loki best practices](https://grafana.com/docs/loki/latest/best-practices/)

## 📝 Pastabos

Po šios užduoties atlikimo:
1. Sukonfigūruoti production alerting channels
2. Sukurti custom dashboards pagal poreikius
3. Implementuoti distributed tracing (Jaeger)
4. Pridėti business metrics tracking