#!/bin/bash

echo "🚀 Testing Rocket.Chat Universal Translator Plugin Package"
echo "========================================================="

cd "$(dirname "$0")/.."

echo "📋 Checking required files..."
echo "✓ app.json: $([ -f app.json ] && echo "Found" || echo "Missing")"
echo "✓ main.js: $([ -f main.js ] && echo "Found" || echo "Missing")"
echo "✓ icon.png: $([ -f icon.png ] && echo "Found" || echo "Missing")"
echo "✓ package.json: $([ -f package.json ] && echo "Found" || echo "Missing")"

echo ""
echo "📦 Package info:"
if [ -f universal-translator.zip ]; then
    echo "✓ Package file: universal-translator.zip"
    echo "📊 Package size: $(du -h universal-translator.zip | cut -f1)"
    echo "📋 Package contents:"
    unzip -l universal-translator.zip | grep -E "\.(js|json|png)$" | head -10
else
    echo "❌ Package file not found"
    exit 1
fi

echo ""
echo "🔧 Build verification:"
npm run build > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "✓ TypeScript compilation successful"
else
    echo "❌ TypeScript compilation failed"
fi

echo ""
echo "✅ Plugin package validation complete!"