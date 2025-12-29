#!/bin/bash
set -e

echo "🔧 Icarus Backend Quick Setup"
echo "============================="

# Create .env file with actual credentials
cat > .env << 'EOF'
PORT=4000
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE
PGSSLMODE=require
JWT_SECRET=icarus-prod-secret

# Seed defaults for initial tenant and admin
SEED_KEY_VALUE=granja-vitta-key
SEED_KEY_NAME=Granja Vitta
SEED_USER_NAME=Administrador
SEED_USER_USERNAME=admin
SEED_USER_PASSWORD=admin123
EOF

echo "✅ .env template created"
echo ""
echo "⚠️  IMPORTANTE: Edite o arquivo .env e configure DATABASE_URL com suas credenciais"
echo ""
echo "🚀 Após editar, run: bash deploy.sh"
