# UŽDUOTIS #003: Sukonfigūruoti ir paleisti visus reikalingus servisus

## 🟡 PRIORITETAS: AUKŠTAS
**Terminas**: 1 diena
**Laikas**: ~2-3 valandos
**Blokuoja**: Development, testing, local deployment

## 📋 Problema

Servisai nėra paleisti arba neteisingai sukonfigūruoti:
- PostgreSQL ir Redis portai jau užimti
- MongoDB replica set nekonfigūruotas Rocket.Chat
- Servisai nestartuoja automatiškai
- Health checks nepraėna

## 🎯 Kodėl tai svarbu?

1. **Development blokavimas**: Be servisų negalima vystyti funkcionalumo
2. **Testavimas**: Testai reikalauja veikiančių servisų
3. **Local deployment**: Negalima demonstruoti funkcionalumo
4. **Integration testing**: Negalima testuoti pilnos sistemos

## 🔧 Kaip taisyti

### Žingsnis 1: Patikrinti ir atlaisvinti portus

```bash
# Patikrinti kas naudoja portus
lsof -i :5433  # PostgreSQL
lsof -i :6380  # Redis
lsof -i :3013  # Rocket.Chat
lsof -i :3012  # API

# Jei reikia, sustabdyti konfliktingus servisus
docker ps --filter "publish=5433"
docker ps --filter "publish=6380"

# Sustabdyti senus konteinerius
docker-compose -f docker-compose.yml down
docker-compose -f docker-compose.dev.yml down
```

### Žingsnis 2: Sukurti startup health check script

```bash
cat > scripts/check-services.sh << 'EOF'
#!/bin/bash

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "🔍 Checking services status..."
echo "================================"

# Function to check service
check_service() {
    local name=$1
    local host=$2
    local port=$3
    local type=$4

    echo -n "Checking $name... "

    if [ "$type" = "http" ]; then
        if curl -f -s "http://$host:$port" > /dev/null 2>&1; then
            echo -e "${GREEN}✅ Running${NC}"
            return 0
        fi
    else
        if nc -z $host $port 2>/dev/null; then
            echo -e "${GREEN}✅ Running${NC}"
            return 0
        fi
    fi

    echo -e "${RED}❌ Not running${NC}"
    return 1
}

# Check all services
ALL_GOOD=true

check_service "PostgreSQL" "localhost" "5433" "tcp" || ALL_GOOD=false
check_service "Redis" "localhost" "6380" "tcp" || ALL_GOOD=false
check_service "MongoDB" "localhost" "27017" "tcp" || ALL_GOOD=false
check_service "Rocket.Chat" "192.168.110.199" "3013" "http" || ALL_GOOD=false
check_service "API Server" "192.168.110.199" "3012" "http" || ALL_GOOD=false

echo "================================"

if [ "$ALL_GOOD" = true ]; then
    echo -e "${GREEN}✅ All services are running!${NC}"
    exit 0
else
    echo -e "${RED}❌ Some services are not running${NC}"
    echo ""
    echo "To start services, run:"
    echo "  docker-compose -f docker-compose.dev.yml up -d"
    exit 1
fi
EOF

chmod +x scripts/check-services.sh
```

### Žingsnis 3: Fiksuoti MongoDB replica set konfigūraciją

```bash
cat > scripts/init-mongodb-replica.sh << 'EOF'
#!/bin/bash

echo "Initializing MongoDB replica set..."

# Wait for MongoDB to start
sleep 5

# Initialize replica set
docker exec translator-mongodb-dev mongosh --eval '
rs.initiate({
  _id: "rs0",
  members: [
    { _id: 0, host: "mongodb:27017" }
  ]
});
'

# Wait for replica set to initialize
sleep 5

# Check status
docker exec translator-mongodb-dev mongosh --eval 'rs.status()'

echo "MongoDB replica set initialized!"
EOF

chmod +x scripts/init-mongodb-replica.sh
```

### Žingsnis 4: Sukurti service startup script

```bash
cat > scripts/start-services.sh << 'EOF'
#!/bin/bash

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}🚀 Starting Universal Translator Services${NC}"
echo "=========================================="

# Change to project root
cd /opt/dev/rocket-chat-universal-translator

# Step 1: Stop any existing services
echo -e "${YELLOW}Stopping existing services...${NC}"
docker-compose -f docker-compose.dev.yml down

# Step 2: Clean up volumes if requested
if [ "$1" = "--clean" ]; then
    echo -e "${YELLOW}Cleaning volumes...${NC}"
    docker volume rm rocket-chat-universal-translator_mongodb_data 2>/dev/null || true
    docker volume rm rocket-chat-universal-translator_postgres_data 2>/dev/null || true
    docker volume rm rocket-chat-universal-translator_redis_data 2>/dev/null || true
fi

# Step 3: Build images
echo -e "${YELLOW}Building Docker images...${NC}"
docker-compose -f docker-compose.dev.yml build

# Step 4: Start infrastructure services first
echo -e "${YELLOW}Starting infrastructure services...${NC}"
docker-compose -f docker-compose.dev.yml up -d mongodb postgres redis

# Wait for services to be ready
echo -e "${YELLOW}Waiting for infrastructure...${NC}"
sleep 10

# Step 5: Initialize MongoDB replica set
echo -e "${YELLOW}Initializing MongoDB replica set...${NC}"
./scripts/init-mongodb-replica.sh

# Step 6: Run database migrations
echo -e "${YELLOW}Running database migrations...${NC}"
docker exec translator-postgres-dev psql -U translator -d translator -c "SELECT 1;" || {
    echo -e "${RED}Database not ready${NC}"
    exit 1
}

# Step 7: Start application services
echo -e "${YELLOW}Starting application services...${NC}"
docker-compose -f docker-compose.dev.yml up -d rocketchat translator-api

# Step 8: Wait for services to be ready
echo -e "${YELLOW}Waiting for services to start...${NC}"
sleep 20

# Step 9: Check all services
echo ""
./scripts/check-services.sh

# Step 10: Show access URLs
if [ $? -eq 0 ]; then
    echo ""
    echo -e "${GREEN}🎉 All services started successfully!${NC}"
    echo ""
    echo "Access URLs:"
    echo "  Rocket.Chat: http://192.168.110.199:3013"
    echo "  API Server: http://192.168.110.199:3012"
    echo "  API Health: http://192.168.110.199:3012/healthz"
    echo "  API Ready: http://192.168.110.199:3012/readyz"
    echo ""
    echo "Credentials:"
    echo "  Rocket.Chat: admin / admin123"
    echo "  PostgreSQL: translator / translator123"
    echo ""
    echo "To view logs:"
    echo "  docker-compose -f docker-compose.dev.yml logs -f"
    echo ""
    echo "To stop services:"
    echo "  docker-compose -f docker-compose.dev.yml down"
else
    echo ""
    echo -e "${RED}⚠️ Some services failed to start${NC}"
    echo "Check logs with:"
    echo "  docker-compose -f docker-compose.dev.yml logs"
    exit 1
fi
EOF

chmod +x scripts/start-services.sh
```

### Žingsnis 5: Sukurti service monitoring script

```bash
cat > scripts/monitor-services.sh << 'EOF'
#!/bin/bash

# Monitor services in real-time
watch -n 5 '
echo "🔍 Service Status Monitor"
echo "========================="
echo ""
echo "Docker Containers:"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep translator
echo ""
echo "Service Health:"
curl -s http://192.168.110.199:3012/healthz | jq . 2>/dev/null || echo "API: Not responding"
curl -s http://192.168.110.199:3012/readyz | jq . 2>/dev/null || echo "API Ready: Not ready"
echo ""
echo "Database Connections:"
docker exec translator-postgres-dev pg_isready 2>/dev/null || echo "PostgreSQL: Not ready"
docker exec translator-redis-dev redis-cli ping 2>/dev/null || echo "Redis: Not ready"
echo ""
echo "Memory Usage:"
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" | grep translator
'
EOF

chmod +x scripts/monitor-services.sh
```

### Žingsnis 6: Fiksuoti docker-compose.dev.yml health checks

```yaml
# Pridėti į docker-compose.dev.yml kiekvienam servisui:

mongodb:
  healthcheck:
    test: ["CMD", "mongosh", "--eval", "db.adminCommand('ping')"]
    interval: 10s
    timeout: 5s
    retries: 5
    start_period: 40s

postgres:
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U translator -d translator"]
    interval: 10s
    timeout: 5s
    retries: 5
    start_period: 30s

redis:
  healthcheck:
    test: ["CMD", "redis-cli", "ping"]
    interval: 10s
    timeout: 5s
    retries: 5
    start_period: 20s

rocketchat:
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:3000/api/info"]
    interval: 30s
    timeout: 10s
    retries: 10
    start_period: 60s

translator-api:
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:3001/healthz"]
    interval: 30s
    timeout: 10s
    retries: 5
    start_period: 40s
```

### Žingsnis 7: Paleisti servisus

```bash
cd /opt/dev/rocket-chat-universal-translator

# Paleisti visus servisus
./scripts/start-services.sh

# Arba su clean start (išvalo duomenis)
./scripts/start-services.sh --clean

# Stebėti servisų statusą
./scripts/monitor-services.sh

# Patikrinti ar visi servisai veikia
./scripts/check-services.sh
```

### Žingsnis 8: Troubleshooting commands

```bash
# Jei MongoDB replica set neveikia
docker exec -it translator-mongodb-dev mongosh
> rs.status()
> rs.initiate()

# Jei PostgreSQL nepasiekiamas
docker logs translator-postgres-dev
docker exec -it translator-postgres-dev psql -U translator

# Jei Redis neatsako
docker logs translator-redis-dev
docker exec -it translator-redis-dev redis-cli ping

# Jei Rocket.Chat nestartuoja
docker logs translator-rocketchat-dev

# Jei API neveikia
docker logs translator-api-dev
```

## ✅ Sėkmės kriterijai

- [ ] Visi servisai paleisti ir veikia
- [ ] Health checks praėna sėkmingai
- [ ] MongoDB replica set inicializuotas
- [ ] PostgreSQL migrations pritaikytos
- [ ] Redis cache veikia
- [ ] Rocket.Chat pasiekiamas per http://192.168.110.199:3013
- [ ] API pasiekiamas per http://192.168.110.199:3012
- [ ] Monitoring script rodo visus servisus "healthy"

## ⚠️ Galimos problemos

1. **Port konfliktai**: Kiti Docker containers gali naudoti tuos pačius portus
   - Sprendimas: Pakeisti portus docker-compose.dev.yml

2. **MongoDB replica set init failure**: Gali nepavykti inicializuoti
   - Sprendimas: Manual init per mongosh

3. **Insufficient memory**: Docker gali neturėti pakankamai RAM
   - Sprendimas: Padidinti Docker Desktop memory limit

4. **Network issues**: Containers negali komunikuoti
   - Sprendimas: Patikrinti Docker network konfigūraciją

## 📚 Papildomi resursai

- [Docker Compose networking](https://docs.docker.com/compose/networking/)
- [MongoDB Replica Set](https://docs.mongodb.com/manual/replication/)
- [PostgreSQL Docker](https://hub.docker.com/_/postgres)

## 📝 Pastabos

Po šios užduoties atlikimo:
1. Sukonfigūruoti automatic service restart
2. Pridėti service health monitoring į Grafana
3. Sukurti backup scripts duomenų bazėms
4. Dokumentuoti troubleshooting guide