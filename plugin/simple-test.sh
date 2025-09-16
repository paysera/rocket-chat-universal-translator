#!/bin/bash
set -e

echo "🧪 Simple package test..."

cd "$(dirname "$0")"

echo "Step 1: Creating minimal app.json backup..."
cp app.json app.json.backup

echo "Step 2: Testing with existing working package from dist/..."
if [ -f "dist/universal-translator-pro.zip" ]; then
    echo "✅ Working package exists: dist/universal-translator-pro.zip"
    unzip -l dist/universal-translator-pro.zip | head -10

    # Extract and use the working app.json temporarily
    unzip -j -o dist/universal-translator-pro.zip app.json -d ./
    mv app.json app.json.from-working

    echo "Step 3: Trying with extracted working app.json..."
    npx rc-apps package 2>&1 || echo "Still failed with extracted app.json"

    echo "Step 4: Restoring our app.json..."
    cp app.json.backup app.json
    rm -f app.json.from-working
else
    echo "❌ No working package found"
fi

echo "✅ Test complete"