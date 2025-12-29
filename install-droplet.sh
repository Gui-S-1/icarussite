#!/bin/bash

# Script de instalação para o droplet DigitalOcean
# Execute como root: bash install-droplet.sh

set -e

echo "🚀 Instalando Icarus no Droplet..."
echo ""

# 1. Instalar Node.js 20
echo "📦 Instalando Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# 2. Instalar PM2
echo "📦 Instalando PM2..."
npm install -g pm2

# 3. Clonar repositório
echo "📥 Clonando repositório..."
cd /opt
rm -rf icarussite
git clone https://github.com/Gui-S-1/icarussite.git
cd icarussite

# 4. Configurar backend
echo "⚙️  Configurando backend..."
cd backend

# Verificar se DB_PASSWORD foi fornecida
if [ -z "$DB_PASSWORD" ]; then
  echo ""
  echo "❌ Erro: Variável DB_PASSWORD não definida"
  echo "Execute com: DB_PASSWORD=sua_senha bash install-droplet.sh"
  exit 1
fi

# Criar .env com credenciais
cat > .env << EOF
DATABASE_URL=postgresql://doadmin:${DB_PASSWORD}@icarus-empress-do-user-30413430-0.g.db.ondigitalocean.com:25060/defaultdb?sslmode=require
JWT_SECRET=icarus-super-secret-jwt-key-2024-granja-vitta
PORT=4000
NODE_ENV=production
EOF

# Instalar dependências
npm install

# Executar seed
echo "🌱 Criando usuários da Granja Vitta..."
node src/seed_granja_vitta.js

# 5. Iniciar com PM2
echo "🚀 Iniciando servidor com PM2..."
pm2 delete icarus-backend 2>/dev/null || true
pm2 start src/server.js --name icarus-backend
pm2 save
pm2 startup

echo ""
echo "✅ Instalação concluída!"
echo ""
echo "📍 Backend rodando em http://159.203.8.237:4000"
echo ""
echo "Comandos úteis:"
echo "  pm2 status          - Ver status"
echo "  pm2 logs icarus-backend - Ver logs"
echo "  pm2 restart icarus-backend - Reiniciar"
echo ""
