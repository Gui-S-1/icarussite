# 🚀 COMANDOS RÁPIDOS DE DEPLOY

## NO SEU COMPUTADOR (Windows)

### 1. Commit e Push das alterações
```powershell
cd "C:\Users\Eduardo\Desktop\Icarus\ICARUS SITE"
git add .
git commit -m "chore: configuracao final de deploy"
git push
```

## NO DROPLET (Linux - SSH)

### 2. Conectar ao servidor
```bash
ssh root@159.203.8.237
```

### 3. Deploy completo (copie e cole tudo de uma vez)

**IMPORTANTE:** Copie o conteúdo do arquivo `.env.production` (pasta backend) e use no comando abaixo.

```bash
# Clonar repositório
git clone https://github.com/Gui-S-1/icarussite.git /opt/icarussite
cd /opt/icarussite/ICARUS\ SITE/backend

# Criar .env com credenciais (edite com suas credenciais)
nano .env

# Ou copie direto (use suas credenciais reais):
cat > .env << 'EOF'
PORT=4000
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE
PGSSLMODE=require
JWT_SECRET=icarus-prod-secret
SEED_KEY_VALUE=granja-vitta-key
SEED_KEY_NAME=Granja Vitta
SEED_USER_NAME=Administrador
SEED_USER_USERNAME=admin
SEED_USER_PASSWORD=admin123
EOF

# Deploy e start da API
bash deploy.sh
```

### 4. Verificar se está funcionando
```bash
pm2 status
curl http://localhost:4000/health
```

**Resultado esperado:** `{"ok":true}`

## NO VERCEL (Browser)

### 5. Deploy do frontend
1. Acesse: https://vercel.com
2. Login com GitHub
3. "Add New Project"
4. Selecione: `Gui-S-1/icarussite`
5. Configure:
   - Root Directory: `ICARUS SITE/frontend`
   - Build Command: (vazio)
   - Output Directory: `.`
6. Deploy!

## ✅ PRONTO!

- **API Backend**: http://159.203.8.237:4000
- **Frontend**: https://seu-projeto.vercel.app
- **Login**: admin / 123456
- **Chave**: granja-vitta-key

## 🔧 Comandos úteis (no droplet)

```bash
# Ver logs
pm2 logs icarus-api

# Reiniciar
pm2 restart icarus-api

# Parar
pm2 stop icarus-api

# Atualizar código
cd /opt/icarussite
git pull
cd ICARUS\ SITE/backend
npm install
pm2 restart icarus-api
```
