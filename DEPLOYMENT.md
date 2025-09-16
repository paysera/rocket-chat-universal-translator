# 🚀 Rocket Chat Universal Translator - Deployment Guide

## 📌 Registruota informacija

### Development aplinka
- **API URL**: http://192.168.110.199:3012
- **Rocket.Chat URL**: http://192.168.110.199:3013
- **Domenai** (jei sukonfigūruotas DNS):
  - API: translate-api-dev.paysera.tech
  - Chat: translate-chat-dev.paysera.tech
- **Portas**: 3012 (API), 3013 (Rocket.Chat)

### Production aplinka
- **API URL**: https://translate-api.paysera.tech
- **Chat URL**: https://translate-chat.paysera.tech
- **Portas**: 8015

## 🐳 Docker paleidimas

### Development aplinka

```bash
# 1. Eikite į projekto direktoriją
cd /opt/dev/rocket-chat-universal-translator

# 2. Paleiskite Docker konteinerius
docker-compose -f docker-compose.dev.yml up -d

# 3. Stebėkite logus
docker-compose -f docker-compose.dev.yml logs -f

# 4. Patikrinkite ar veikia
curl http://192.168.110.199:3012/healthz
curl http://192.168.110.199:3013/api/info
```

### Production aplinka

```bash
# 1. Sukurkite .env.production failą su tikrais slaptažodžiais
cp .env.example .env.production

# 2. Redaguokite .env.production ir įrašykite:
# - JWT_SECRET (sugeneruokite: openssl rand -hex 32)
# - ENCRYPTION_KEY (sugeneruokite: openssl rand -hex 16)
# - DB_PASSWORD, REDIS_PASSWORD, MONGO_ROOT_PASSWORD
# - AI Provider raktus (OPENAI_API_KEY, ANTHROPIC_API_KEY, etc.)

# 3. Paleiskite production konteinerius
docker-compose -f docker-compose.production.yml --env-file .env.production up -d

# 4. Stebėkite logus
docker-compose -f docker-compose.production.yml logs -f
```

## 🔗 Prieigos taškai

### Development (vietiniame tinkle)

#### API Server
- **Health Check**: http://192.168.110.199:3012/healthz
- **Ready Check**: http://192.168.110.199:3012/readyz
- **API Docs**: http://192.168.110.199:3012/

#### Rocket.Chat
- **Web Interface**: http://192.168.110.199:3013
- **Admin Panel**: http://192.168.110.199:3013/admin
- **Kredencialai**: admin / admin123

#### Duomenų bazės (development only)
- **PostgreSQL**: 192.168.110.199:5433 (user: translator, pass: translator123)
- **Redis**: 192.168.110.199:6380
- **MongoDB**: 192.168.110.199:27017 (user: rocketchat, pass: rocketchat)

### Production

#### API Server
- **Health Check**: https://translate-api.paysera.tech/healthz
- **Ready Check**: https://translate-api.paysera.tech/readyz
- **API Docs**: https://translate-api.paysera.tech/

#### Rocket.Chat
- **Web Interface**: https://translate-chat.paysera.tech
- **Admin Panel**: https://translate-chat.paysera.tech/admin

## 📦 Plugin diegimas

1. **Prisijunkite prie Rocket.Chat admin**:
   - Development: http://192.168.110.199:3013/admin
   - Production: https://translate-chat.paysera.tech/admin

2. **Eikite į Apps → Marketplace → Upload App**

3. **Įkelkite plugin failą**:
   ```bash
   # Plugin failas yra:
   /opt/dev/rocket-chat-universal-translator/plugin/universal-translator-pro.zip
   ```

4. **Sukonfigūruokite plugin nustatymus**:
   - API URL: http://translator-api:3001 (Docker vidinis)
   - Enable real-time translation: ✅
   - Default source language: Auto-detect
   - Available languages: All

## 🛠️ Docker komandos

### Paleisti/sustabdyti

```bash
# Development
docker-compose -f docker-compose.dev.yml up -d     # Paleisti
docker-compose -f docker-compose.dev.yml down      # Sustabdyti
docker-compose -f docker-compose.dev.yml restart   # Perkrauti

# Production
docker-compose -f docker-compose.production.yml up -d
docker-compose -f docker-compose.production.yml down
docker-compose -f docker-compose.production.yml restart
```

### Logų peržiūra

```bash
# Visi logai
docker-compose -f docker-compose.dev.yml logs -f

# Konkretaus serviso logai
docker-compose -f docker-compose.dev.yml logs -f translator-api
docker-compose -f docker-compose.dev.yml logs -f rocketchat
```

### Duomenų bazių valdymas

```bash
# PostgreSQL prisijungimas
docker exec -it translator-postgres-dev psql -U translator -d translator

# Redis prisijungimas
docker exec -it translator-redis-dev redis-cli

# MongoDB prisijungimas
docker exec -it translator-mongodb-dev mongosh -u rocketchat -p rocketchat
```

## 🔍 Problemų sprendimas

### Jei API neatsako

```bash
# Patikrinkite ar veikia konteineris
docker ps | grep translator-api

# Peržiūrėkite logus
docker logs translator-api-dev

# Patikrinkite health endpoint
curl http://192.168.110.199:3012/healthz
```

### Jei Rocket.Chat neatsako

```bash
# Patikrinkite MongoDB replikaciją
docker exec -it translator-mongodb-dev mongosh --eval "rs.status()"

# Patikrinkite Rocket.Chat logus
docker logs translator-rocketchat-dev
```

### Jei nepavyksta prisijungti prie duomenų bazės

```bash
# Patikrinkite ar veikia DB konteineriai
docker ps | grep -E "postgres|redis|mongo"

# Testuokite prisijungimą
docker exec -it translator-postgres-dev pg_isready
docker exec -it translator-redis-dev redis-cli ping
```

## 📊 Monitoringas

### Health endpoints

```bash
# API Health
watch -n 5 'curl -s http://192.168.110.199:3012/healthz | jq .'

# API Readiness (tikrina DB, Redis, Rocket.Chat)
watch -n 5 'curl -s http://192.168.110.199:3012/readyz | jq .'
```

### Docker statistikos

```bash
# CPU/Memory naudojimas
docker stats --no-stream

# Detali informacija
docker-compose -f docker-compose.dev.yml ps
```

## 🔐 Saugumo pastabos

### Production aplinkoje būtina:

1. **Pakeisti visus default slaptažodžius**
2. **Sukonfigūruoti SSL/TLS** (naudoti Traefik arba Nginx)
3. **Apriboti prieigą prie duomenų bazių** (tik iš Docker network)
4. **Įjungti rate limiting** API serveryje
5. **Sukonfigūruoti backup** duomenų bazėms
6. **Stebėti logus** dėl įtartinos veiklos

## 📝 Naudingos nuorodos

- **Projekto kelias**: `/opt/dev/rocket-chat-universal-translator`
- **Portų registras**: `/opt/registry/projects.json`
- **Docker Compose failai**:
  - Development: `docker-compose.dev.yml`
  - Production: `docker-compose.production.yml`
- **Plugin package**: `plugin/universal-translator-pro.zip`