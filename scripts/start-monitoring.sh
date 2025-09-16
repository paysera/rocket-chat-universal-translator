#!/bin/bash

set -e

echo "🚀 Starting Universal Translator Monitoring Stack..."
echo "=================================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    local color=$1
    local message=$2
    echo -e "${color}${message}${NC}"
}

# Function to check if a service is healthy
check_service() {
    local name=$1
    local url=$2
    local timeout=${3:-10}

    if timeout $timeout curl -sf "$url" >/dev/null 2>&1; then
        print_status $GREEN "✅ $name: Healthy"
        return 0
    else
        print_status $RED "❌ $name: Not ready"
        return 1
    fi
}

# Check if Docker is running
if ! docker info >/dev/null 2>&1; then
    print_status $RED "❌ Docker is not running. Please start Docker first."
    exit 1
fi

# Create necessary directories
print_status $BLUE "📁 Creating monitoring directories..."
mkdir -p monitoring/grafana/provisioning/{dashboards,datasources}
mkdir -p monitoring/prometheus/data
mkdir -p monitoring/loki/data
mkdir -p monitoring/alertmanager/data

# Create the translator network if it doesn't exist
print_status $BLUE "🌐 Setting up Docker network..."
if ! docker network ls | grep -q translator-network; then
    docker network create translator-network
    print_status $GREEN "✅ Created translator-network"
else
    print_status $YELLOW "⚠️  translator-network already exists"
fi

# Stop existing monitoring stack if running
print_status $BLUE "🛑 Stopping existing monitoring services..."
docker-compose -f docker-compose.monitoring.yml down --remove-orphans 2>/dev/null || true

# Clean up old volumes if requested
if [[ "$1" == "--clean" ]]; then
    print_status $YELLOW "🧹 Cleaning up monitoring volumes..."
    docker volume rm translator-prometheus_data translator-grafana_data translator-loki_data translator-alertmanager_data 2>/dev/null || true
fi

# Start monitoring stack
print_status $BLUE "🚀 Starting monitoring services..."
docker-compose -f docker-compose.monitoring.yml up -d

# Wait for services to initialize
print_status $BLUE "⏳ Waiting for services to start (30 seconds)..."
sleep 30

# Health check function with retries
wait_for_service() {
    local name=$1
    local url=$2
    local max_attempts=12
    local attempt=1

    print_status $BLUE "🔍 Checking $name..."

    while [ $attempt -le $max_attempts ]; do
        if check_service "$name" "$url" 5; then
            return 0
        fi

        if [ $attempt -eq $max_attempts ]; then
            print_status $RED "❌ $name failed to start after $max_attempts attempts"
            return 1
        fi

        print_status $YELLOW "⏳ Attempt $attempt/$max_attempts for $name, retrying in 10 seconds..."
        sleep 10
        ((attempt++))
    done
}

# Check all services
echo ""
print_status $BLUE "📊 Monitoring Stack Health Check:"
print_status $BLUE "================================="

services_healthy=true

# Check each service
wait_for_service "Prometheus" "http://localhost:9091/-/healthy" || services_healthy=false
wait_for_service "Grafana" "http://localhost:3014/api/health" || services_healthy=false
wait_for_service "Loki" "http://localhost:3100/ready" || services_healthy=false
wait_for_service "Alertmanager" "http://localhost:9093/-/healthy" || services_healthy=false

# Check exporters
check_service "Node Exporter" "http://localhost:9101/metrics" 5 || services_healthy=false
check_service "Postgres Exporter" "http://localhost:9188/metrics" 5 || services_healthy=false
check_service "Redis Exporter" "http://localhost:9122/metrics" 5 || services_healthy=false

echo ""
if [ "$services_healthy" = true ]; then
    print_status $GREEN "🎉 All monitoring services are healthy!"
else
    print_status $YELLOW "⚠️  Some services may need more time to start"
    print_status $BLUE "💡 Check logs with: docker-compose -f docker-compose.monitoring.yml logs -f"
fi

echo ""
print_status $BLUE "🔗 Access URLs:"
print_status $BLUE "==============="
echo "  📊 Prometheus:    http://192.168.110.199:9091"
echo "  📈 Grafana:       http://192.168.110.199:3014 (admin/admin123)"
echo "  📋 Alertmanager:  http://192.168.110.199:9093"
echo "  📝 Loki:          http://192.168.110.199:3100"
echo "  💻 Node Exporter: http://192.168.110.199:9101"
echo "  🐘 Postgres Exp:  http://192.168.110.199:9188"
echo "  🗄️  Redis Exp:     http://192.168.110.199:9122"
echo "  🐳 cAdvisor:      http://192.168.110.199:8081"

echo ""
print_status $BLUE "🛠️  Useful Commands:"
print_status $BLUE "=================="
echo "  📋 View logs:           docker-compose -f docker-compose.monitoring.yml logs -f"
echo "  📋 View specific logs:  docker-compose -f docker-compose.monitoring.yml logs -f grafana"
echo "  🔄 Restart service:     docker-compose -f docker-compose.monitoring.yml restart grafana"
echo "  🛑 Stop monitoring:     docker-compose -f docker-compose.monitoring.yml down"
echo "  🧹 Clean restart:       ./scripts/start-monitoring.sh --clean"

echo ""
print_status $BLUE "📚 Quick Start Guide:"
print_status $BLUE "==================="
echo "1. Open Grafana at http://192.168.110.199:3014"
echo "2. Login with admin/admin123"
echo "3. Navigate to Dashboards → Universal Translator Dashboard"
echo "4. Explore metrics and set up additional alerting as needed"

echo ""
print_status $GREEN "✅ Monitoring stack setup complete!"

# Show docker compose status
echo ""
print_status $BLUE "🐳 Container Status:"
print_status $BLUE "==================="
docker-compose -f docker-compose.monitoring.yml ps