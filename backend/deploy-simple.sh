#!/bin/bash
set -e

echo "🚀 Icarus Backend Deployment"
echo "=============================="

# Navigate to script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
cd "$SCRIPT_DIR"

echo "📂 Working directory: $SCRIPT_DIR"

# Install Node.js if not present
if ! command -v node &> /dev/null; then
    echo "📦 Installing Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
else
    echo "✅ Node.js already installed: $(node --version)"
fi

# Install PM2 if not present
if ! command -v pm2 &> /dev/null; then
    echo "📦 Installing PM2..."
    npm install -g pm2
else
    echo "✅ PM2 already installed"
fi

# Check for .env
if [ ! -f .env ]; then
    echo ""
    echo "❌ ERROR: .env file not found!"
    echo ""
    echo "Create .env file with:"
    echo "  nano .env"
    echo ""
    echo "Paste this content and edit DATABASE_URL:"
    echo "---"
    cat .env.example
    echo "---"
    exit 1
fi

echo "✅ .env file found"

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Run seed
echo "🌱 Seeding database..."
npm run seed:vitta || {
    echo "⚠️  Seed failed - may already be populated"
}

# Stop existing process
if pm2 list | grep -q "icarus-api"; then
    echo "🔄 Stopping existing process..."
    pm2 stop icarus-api || true
    pm2 delete icarus-api || true
fi

# Start API
echo "🚀 Starting API..."
pm2 start src/server.js --name icarus-api --time

# Save PM2 config
pm2 save

# Setup startup
echo "⚙️  Setting up PM2 startup..."
pm2 startup systemd -u root --hp /root || true

echo ""
echo "✅ DEPLOYMENT COMPLETE!"
echo ""
echo "📊 Status: pm2 status"
echo "📋 Logs: pm2 logs icarus-api"
echo "🧪 Test: curl http://localhost:4000/health"
echo ""
