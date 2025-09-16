#!/bin/bash

echo "🚀 Installing k6 Load Testing Tool..."

# Check if running on macOS or Linux
if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "Detected macOS - Installing k6 via Homebrew..."

    # Check if brew is installed
    if ! command -v brew &> /dev/null; then
        echo "❌ Homebrew not found. Installing Homebrew first..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    fi

    # Install k6
    brew install k6

elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    echo "Detected Linux - Installing k6..."

    # Download and install k6 for Linux
    sudo gpg -k
    sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
    echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
    sudo apt-get update
    sudo apt-get install k6

else
    echo "⚠️  Unsupported OS. Using Docker version instead..."

    # Pull Docker image as fallback
    if command -v docker &> /dev/null; then
        docker pull grafana/k6:latest
        echo "✅ k6 Docker image pulled successfully"
        echo "Usage: docker run --rm -v \$(pwd):/scripts grafana/k6 run /scripts/your-test.js"
    else
        echo "❌ Docker not found. Please install k6 manually from https://k6.io/docs/get-started/installation/"
        exit 1
    fi
fi

# Verify installation
if command -v k6 &> /dev/null; then
    echo "✅ k6 installed successfully"
    echo "Version: $(k6 version)"
else
    echo "⚠️  k6 command not found in PATH, but Docker image should be available"
fi

echo ""
echo "📚 k6 Resources:"
echo "- Documentation: https://k6.io/docs/"
echo "- Examples: https://github.com/grafana/k6/tree/master/samples"
echo "- Load testing guide: https://k6.io/docs/testing-guides/test-types/load-testing/"
echo ""
echo "🏁 Ready to run performance tests!"