#!/bin/bash

echo "Setting up test database..."

# Wait for PostgreSQL to be ready
max_attempts=30
attempt=0
until docker exec translator-postgres-test pg_isready -U translator -d translator_test > /dev/null 2>&1; do
  if [ $attempt -ge $max_attempts ]; then
    echo "❌ PostgreSQL test service is not responding after $max_attempts attempts"
    exit 1
  fi
  echo "⏳ Waiting for PostgreSQL test service... (attempt $((attempt+1)))"
  sleep 2
  ((attempt++))
done

echo "✅ PostgreSQL test service is ready"

# Create test database if it doesn't exist
echo "📊 Creating test database..."
docker exec translator-postgres-test psql -U translator -c "SELECT 'CREATE DATABASE translator_test' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'translator_test')\\gexec" > /dev/null 2>&1

# Check if migrations directory exists and apply them
MIGRATIONS_DIR="../migrations"
if [ -d "$MIGRATIONS_DIR" ]; then
  echo "🔄 Applying migrations to test database..."
  for migration in "$MIGRATIONS_DIR"/*.sql; do
    if [ -f "$migration" ]; then
      echo "   Applying: $(basename "$migration")"
      docker exec -i translator-postgres-test psql -U translator -d translator_test < "$migration"
    fi
  done
else
  echo "⚠️  No migrations directory found, creating basic test schema..."
  # Create a basic schema for testing
  docker exec -i translator-postgres-test psql -U translator -d translator_test << 'EOF'
-- Basic test schema
CREATE TABLE IF NOT EXISTS translations (
    id SERIAL PRIMARY KEY,
    source_text TEXT NOT NULL,
    translated_text TEXT NOT NULL,
    source_lang VARCHAR(10) NOT NULL,
    target_lang VARCHAR(10) NOT NULL,
    provider VARCHAR(50) NOT NULL,
    confidence DECIMAL(3,2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS api_keys (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    key_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_translations_langs ON translations(source_lang, target_lang);
CREATE INDEX IF NOT EXISTS idx_translations_created_at ON translations(created_at);
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
EOF
fi

echo "✅ Test database setup complete!"