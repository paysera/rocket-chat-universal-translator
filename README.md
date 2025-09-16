# 🌍 Universal Translator Pro for Rocket.Chat

Automated real-time translation system for Rocket.Chat platform with AI-powered translation capabilities.

## 📋 Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Configuration](#configuration)
- [Development](#development)
- [Testing](#testing)
- [Deployment](#deployment)
- [API Documentation](#api-documentation)
- [Troubleshooting](#troubleshooting)

## 🎯 Overview

Universal Translator Pro integrates with Rocket.Chat and automatically translates messages in real-time using:
- OpenAI GPT-4
- Anthropic Claude
- Google Translate
- DeepL

### Key Features

✅ **Real-time Translation** - Automatic message translation
✅ **Language Detection** - Automatically detects source language
✅ **Multi-provider Support** - Multiple AI provider integration
✅ **Context-aware Translation** - Maintains conversation context
✅ **Offline Cache** - Redis cache for fast translation

## 🏗️ Architecture

```
┌─────────────────┐     ┌──────────────┐     ┌─────────────┐
│  Rocket.Chat    │────▶│ Translation  │────▶│ AI Providers│
│   (Plugin)      │◀────│     API      │◀────│  (OpenAI,   │
└─────────────────┘     └──────────────┘     │   Claude)   │
        │                      │              └─────────────┘
        │                      │
        ▼                      ▼
┌─────────────────┐     ┌──────────────┐
│    MongoDB      │     │  PostgreSQL  │
│  (Chat data)    │     │ (Translations)│
└─────────────────┘     └──────────────┘
                               │
                               ▼
                        ┌──────────────┐
                        │    Redis     │
                        │   (Cache)    │
                        └──────────────┘
```

## 🛠️ Requirements

### System
- Docker Desktop 4.0+
- Node.js 18+ (development)
- 8GB RAM minimum
- 20GB disk space

### Ports
- **3012**: Translation API (dev)
- **3013**: Rocket.Chat (dev)
- **5434**: PostgreSQL (dev)
- **6381**: Redis (dev)
- **27017**: MongoDB

### Production Domains
- **translate-api.paysera.tech**: Production API
- **translate-api-dev.paysera.tech**: Development API

## 📦 Installation

### Quick Start (Docker)

```bash
# Clone repository
git clone https://github.com/paysera/rocket-chat-universal-translator.git
cd rocket-chat-universal-translator

# Copy environment template
cp .env.example .env

# Add your API keys to .env
# OPENAI_API_KEY=sk-...
# ANTHROPIC_API_KEY=sk-ant-...

# Start all services
docker-compose -f docker-compose.dev.yml up -d

# Check status
docker-compose -f docker-compose.dev.yml ps

# View logs
docker-compose -f docker-compose.dev.yml logs -f
```

### Access Points

- **Rocket.Chat**: http://192.168.110.199:3013
  - Username: admin
  - Password: admin123

- **API Health**: http://192.168.110.199:3012/healthz
- **API Docs**: http://192.168.110.199:3012/api-docs

## ⚙️ Configuration

### Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `NODE_ENV` | Environment (development/production) | Yes | development |
| `PORT` | API server port | Yes | 3001 |
| `DB_HOST` | PostgreSQL host | Yes | postgres |
| `DB_PORT` | PostgreSQL port | Yes | 5432 |
| `DB_NAME` | Database name | Yes | translator |
| `DB_USER` | Database user | Yes | translator |
| `DB_PASSWORD` | Database password | Yes | - |
| `REDIS_HOST` | Redis host | Yes | redis |
| `REDIS_PORT` | Redis port | Yes | 6379 |
| `OPENAI_API_KEY` | OpenAI API key | No | - |
| `ANTHROPIC_API_KEY` | Anthropic API key | No | - |
| `DEEPL_API_KEY` | DeepL API key | No | - |
| `GOOGLE_TRANSLATE_API_KEY` | Google Translate key | No | - |

## 💻 Development

### Local Development Setup

```bash
# Install dependencies
npm install

# Start development services
docker-compose -f docker-compose.dev.yml up -d

# Start API in watch mode
cd api && npm run dev

# In another terminal, start plugin development
cd plugin && npm run dev

# Run tests
npm test

# Lint code
npm run lint

# Type check
npm run typecheck
```

### Project Structure

```
rocket-chat-universal-translator/
├── api/                  # Translation API backend
│   ├── src/
│   │   ├── routes/       # API endpoints
│   │   ├── services/     # Business logic
│   │   ├── providers/    # AI provider integrations
│   │   ├── middleware/   # Express middleware
│   │   └── config/       # Database and Redis config
│   └── tests/            # API tests
├── plugin/               # Rocket.Chat plugin
│   ├── src/
│   │   ├── handlers/     # Message handlers
│   │   ├── settings/     # Plugin settings
│   │   └── lib/          # Helper functions
│   └── tests/            # Plugin tests
├── shared/               # Shared types and utilities
├── scripts/              # Utility scripts
└── docs/                 # Documentation
```

## 🧪 Testing

### Run All Tests

```bash
# Unit tests
npm test

# Integration tests
npm run test:integration

# E2E tests
npm run test:e2e

# Coverage report
npm run test:coverage
```

### Test Specific Component

```bash
# Test API only
cd api && npm test

# Test plugin only
cd plugin && npm test

# Test with watch mode
npm run test:watch
```

## 🚀 Deployment

### Production Deployment

```bash
# Build production images
docker-compose -f docker-compose.production.yml build

# Deploy to production
docker-compose -f docker-compose.production.yml up -d

# Check production health
curl https://translate-api.paysera.tech/healthz
```

### CI/CD Pipeline

GitHub Actions automatically:
1. Runs tests on PR
2. Builds Docker images
3. Deploys to staging on merge to develop
4. Deploys to production on merge to main

## 📚 API Documentation

### Endpoints

#### POST /api/translate
Translate text between languages.

**Request:**
```json
{
  "text": "Hello world",
  "sourceLang": "en",
  "targetLang": "lt",
  "provider": "openai"
}
```

**Response:**
```json
{
  "translatedText": "Labas pasauli",
  "sourceLang": "en",
  "targetLang": "lt",
  "confidence": 0.95,
  "provider": "openai"
}
```

#### POST /api/detect-language
Detect language of text.

**Request:**
```json
{
  "text": "Bonjour le monde"
}
```

**Response:**
```json
{
  "language": "fr",
  "confidence": 0.98
}
```

#### GET /api/languages
Get supported languages.

**Response:**
```json
{
  "languages": [
    {"code": "en", "name": "English"},
    {"code": "lt", "name": "Lithuanian"},
    {"code": "fr", "name": "French"}
  ]
}
```

### Rate Limiting

- 100 requests per minute per IP
- 1000 requests per hour per API key
- Bulk translations: 10 requests per minute

### Error Codes

| Code | Description |
|------|-------------|
| 400 | Bad Request - Invalid parameters |
| 401 | Unauthorized - Invalid API key |
| 429 | Too Many Requests - Rate limit exceeded |
| 500 | Internal Server Error |
| 503 | Service Unavailable - Provider down |

## 🔧 Troubleshooting

### Common Issues

#### Services won't start
```bash
# Check port conflicts
lsof -i :3012
lsof -i :3013

# Stop conflicting services
docker-compose down
docker stop $(docker ps -aq)

# Restart with clean state
docker-compose -f docker-compose.dev.yml down -v
docker-compose -f docker-compose.dev.yml up -d
```

#### MongoDB replica set error
```bash
# Initialize replica set manually
docker exec -it translator-mongodb-dev mongosh
> rs.initiate()
```

#### Translation not working
1. Check API keys in .env file
2. Verify provider is enabled in config
3. Check API logs: `docker logs translator-api-dev`
4. Test API directly: `curl http://192.168.110.199:3012/healthz`

#### High memory usage
```bash
# Check container stats
docker stats

# Restart specific service
docker-compose -f docker-compose.dev.yml restart translator-api
```

## 📞 Support

- **Documentation**: [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md)
- **Troubleshooting**: [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
- **Issues**: [GitHub Issues](https://github.com/paysera/rocket-chat-universal-translator/issues)
- **Email**: translator-support@paysera.com

## 📄 License

Copyright © 2024 Paysera. All rights reserved.