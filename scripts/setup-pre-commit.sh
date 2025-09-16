#!/bin/bash

set -e

echo "🔧 Setting up pre-commit hooks for Universal Translator..."

# Check if we're in a git repository
if [ ! -d ".git" ]; then
    echo "❌ Not in a git repository. Please run this script from the project root."
    exit 1
fi

# Check if Python is available (required for pre-commit)
if ! command -v python3 &> /dev/null && ! command -v python &> /dev/null; then
    echo "❌ Python is required for pre-commit but not found."
    echo "Please install Python 3.x and try again."
    exit 1
fi

# Use python3 if available, otherwise fall back to python
PYTHON_CMD="python3"
if ! command -v python3 &> /dev/null; then
    PYTHON_CMD="python"
fi

echo "✅ Using Python: $PYTHON_CMD"

# Check if pip is available
if ! command -v pip3 &> /dev/null && ! command -v pip &> /dev/null; then
    echo "❌ pip is required but not found."
    echo "Please install pip and try again."
    exit 1
fi

PIP_CMD="pip3"
if ! command -v pip3 &> /dev/null; then
    PIP_CMD="pip"
fi

echo "✅ Using pip: $PIP_CMD"

# Install pre-commit
echo "📦 Installing pre-commit..."
$PIP_CMD install pre-commit

# Verify pre-commit installation
if ! command -v pre-commit &> /dev/null; then
    echo "❌ pre-commit installation failed or not in PATH."
    echo "Please ensure pip install directory is in your PATH."
    exit 1
fi

echo "✅ pre-commit installed successfully"

# Check if Node.js and npm are available (required for JS hooks)
if ! command -v npm &> /dev/null; then
    echo "⚠️ npm not found. Some hooks may not work properly."
    echo "Please install Node.js and npm for full functionality."
else
    echo "✅ npm found"

    # Install dependencies if package.json exists
    if [ -f "package.json" ]; then
        echo "📦 Installing npm dependencies..."
        npm install
    fi
fi

# Install git hooks
echo "🔗 Installing pre-commit git hooks..."
pre-commit install

# Install commit-msg hook for conventional commits
echo "🔗 Installing commit-msg hook..."
pre-commit install --hook-type commit-msg

# Install pre-push hook (optional)
echo "🔗 Installing pre-push hook..."
pre-commit install --hook-type pre-push

# Run pre-commit on all files to validate setup
echo "🧪 Running pre-commit on all files to validate setup..."
echo "This may take a while on first run as it downloads dependencies..."

if pre-commit run --all-files; then
    echo "✅ Pre-commit validation successful!"
else
    echo "⚠️ Some pre-commit checks failed."
    echo "This is normal for the first run. The hooks will fix many issues automatically."
    echo "Please review the output above and fix any remaining issues."
fi

# Create a helper script for manual pre-commit runs
cat > scripts/run-pre-commit.sh << 'EOF'
#!/bin/bash

echo "🔍 Running pre-commit checks manually..."

# Run specific hook
if [ "$1" ]; then
    echo "Running specific hook: $1"
    pre-commit run "$1" --all-files
else
    # Run all hooks
    echo "Running all pre-commit hooks..."
    pre-commit run --all-files
fi

echo "✅ Pre-commit check completed"
EOF

chmod +x scripts/run-pre-commit.sh

# Create a bypass script for emergencies
cat > scripts/commit-bypass.sh << 'EOF'
#!/bin/bash

echo "⚠️ EMERGENCY BYPASS: Committing without pre-commit hooks"
echo "This should only be used in emergency situations!"

read -p "Are you sure you want to bypass pre-commit hooks? (y/N): " confirm
if [[ $confirm == [yY] || $confirm == [yY][eE][sS] ]]; then
    git commit --no-verify "$@"
    echo "✅ Commit completed with --no-verify"
    echo "⚠️ Please ensure to run pre-commit checks later!"
else
    echo "❌ Commit cancelled"
fi
EOF

chmod +x scripts/commit-bypass.sh

echo ""
echo "🎉 Pre-commit setup completed successfully!"
echo ""
echo "📋 Summary:"
echo "  ✅ Pre-commit installed"
echo "  ✅ Git hooks configured"
echo "  ✅ Commit message linting enabled"
echo "  ✅ JavaScript/TypeScript linting configured"
echo "  ✅ Security scanning enabled"
echo "  ✅ Docker and shell script validation enabled"
echo ""
echo "🚀 Next steps:"
echo "  1. Make your first commit to test the hooks"
echo "  2. Use 'npm run lint' to manually check code"
echo "  3. Use './scripts/run-pre-commit.sh' for manual hook runs"
echo "  4. Use './scripts/commit-bypass.sh' for emergency commits only"
echo ""
echo "💡 Commit message format:"
echo "  feat: add new translation service"
echo "  fix: resolve authentication bug"
echo "  docs: update API documentation"
echo "  chore: update dependencies"
echo ""
echo "⚠️ Note: First run may be slow as hooks download dependencies"

# Check for common issues
echo ""
echo "🔍 Checking for common configuration issues..."

# Check if .eslintrc.json exists
if [ ! -f ".eslintrc.json" ]; then
    echo "⚠️ .eslintrc.json not found. ESLint hooks may not work properly."
fi

# Check if TypeScript is configured
if [ ! -f "tsconfig.json" ]; then
    echo "⚠️ tsconfig.json not found. TypeScript hooks may not work properly."
fi

# Check Docker files
if [ -f "Dockerfile" ] || [ -f "docker-compose.yml" ]; then
    if ! command -v docker &> /dev/null; then
        echo "⚠️ Docker files found but Docker not installed. Docker linting will be skipped."
    fi
fi

echo ""
echo "✅ Pre-commit setup validation complete!"
echo "Happy coding! 🚀"