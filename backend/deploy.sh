#!/bin/bash
set -e

echo "🚀 Icarus Backend Deployment Script"
echo "===================================="

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "📦 Installing Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi

# Check if PM2 is installed
if ! command -v pm2 &> /dev/null; then
    echo "📦 Installing PM2..."
    npm install -g pm2
fi

# Navigate to backend directory
cd "$(dirname "$0")"
echo "📂 Current directory: $(pwd)"

# Check if .env exists
if [ ! -f .env ]; then
    echo "⚠️  .env file not found!"
    echo "📝 Creating .env template..."
    cat > .env << 'EOF'
PORT=4000
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE
PGSSLMODE=require
JWT_SECRET=icarus-prod-secret

# Seed defaults
SEED_KEY_VALUE=granja-vitta-key
SEED_KEY_NAME=Granja Vitta
SEED_USER_NAME=Administrador
SEED_USER_USERNAME=admin
SEED_USER_PASSWORD=admin123
EOF
    echo ""
    echo "⚠️  IMPORTANTE: Edite o .env e configure DATABASE_URL:"
    echo "   nano .env"
    echo ""
    read -p "Press Enter after you've edited the .env file..."
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Run database seed
echo "🌱 Seeding database with Granja Vitta data..."
npm run seed:vitta

# Stop existing PM2 process if running
if pm2 list | grep -q "icarus-api"; then
    echo "🔄 Stopping existing icarus-api process..."
    pm2 stop icarus-api
    pm2 delete icarus-api
fi

# Start the API with PM2
echo "🚀 Starting API with PM2..."
pm2 start src/server.js --name icarus-api --time
pm2 save

# Setup PM2 to start on boot
echo "⚙️  Configuring PM2 startup..."
pm2 startup systemd -u root --hp /root

echo ""
echo "✅ Deployment complete!"
echo ""
echo "📊 Check status: pm2 status"
echo "📋 View logs: pm2 logs icarus-api"
echo "🔄 Restart: pm2 restart icarus-api"
echo "🧪 Test API: curl http://localhost:4000/health"
echo ""
echo "🌐 API running at: http://159.203.8.237:4000"
