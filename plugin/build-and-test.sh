#!/bin/bash
set -e

echo "🚀 Building and Testing Rocket.Chat Plugin"
echo "==========================================="

cd "$(dirname "$0")"

echo "🧹 Cleaning previous builds..."
rm -f *.js *.d.ts *.map *.zip

echo "🔨 Compiling TypeScript..."
npx tsc

echo "📦 Validating app structure..."
node validate-app.js

echo "📋 Final file check..."
echo "✓ Required files:"
ls -la UniversalTranslatorApp.js app.json icon.png package.json

echo "📦 Creating package..."
npx rc-apps package

echo "🎉 Build complete!"
if [ -f *.zip ]; then
    echo "📦 Package created: $(ls *.zip)"
else
    echo "❌ No package file found"
    exit 1
fi

echo "✅ Plugin is ready for deployment!"