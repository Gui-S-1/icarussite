# ICARUS SITE

Sistema web de gestão de manutenção para Granja Vitta, com backend Node + PostgreSQL e frontend estático.

## 🏗️ Estrutura
- **frontend/**: HTML/CSS/JS estático (deploy no Vercel)
- **backend/**: API Express com JWT + PostgreSQL (deploy no Droplet)

## 🚀 Deploy Completo (PRODUÇÃO)

### 1️⃣ Preparar Banco de Dados (DigitalOcean)
- Acesse seu Managed PostgreSQL no painel da DigitalOcean
- Vá em "Settings" → "Trusted Sources"
- Adicione o IP do droplet: `159.203.8.237`
- Isso permite que o backend conecte ao banco

### 2️⃣ Deploy Backend no Droplet

**SSH no servidor:**
```bash
ssh root@159.203.8.237
```

**Clone e configure:**
```bash
# Clonar repositório
git clone https://github.com/Gui-S-1/icarussite.git /opt/icarussite
cd /opt/icarussite/ICARUS\ SITE/backend

# Criar arquivo .env com credenciais
bash setup-env.sh

# Deploy completo (instala Node, PM2, seeds, inicia API)
bash deploy.sh
```

**Verificar:**
```bash
# Status
pm2 status

# Logs em tempo real
pm2 logs icarus-api

# Testar API
curl http://localhost:4000/health
```

### 3️⃣ Deploy Frontend no Vercel

1. Acesse [vercel.com](https://vercel.com) e faça login
2. Clique em "Add New Project"
3. Importe o repositório: `Gui-S-1/icarussite`
4. Configure:
   - **Root Directory**: `ICARUS SITE/frontend`
   - **Build Command**: (deixe vazio)
   - **Output Directory**: `.`
5. Clique em "Deploy"

Pronto! O site estará em `https://seu-projeto.vercel.app`

## 🔐 Credenciais Iniciais

**Chave do Tenant:** `granja-vitta-key`

**Usuário Admin:**
- Username: `admin`
- Senha: `123456`

**Outros usuários (todos senha: `123456`):**
- Eduardo, Declie, Alisson, Vanderlei (Manutenção)
- Edmilson (OS)
- Erica, Irene (Sala de Ovos)
- Bruno, Jose Walter (OS + View)
- Joacir (Compras)

## 🛠️ Desenvolvimento Local

### Backend
```bash
cd "ICARUS SITE/backend"
npm install
npm run dev
```

### Frontend
```bash
cd "ICARUS SITE/frontend"
npx serve . -p 4173
```

## 📡 API Endpoints

### Autenticação
- `POST /auth/validate-key` - Validar chave do tenant
- `POST /auth/login` - Login (requer key_id, username, password)

### Ordens de Serviço
- `GET /orders` - Listar todas as OS
- `POST /orders` - Criar nova OS (requer role: os)
- `PATCH /orders/:id` - Atualizar OS (apenas dono ou os_manage_all)
- `DELETE /orders/:id` - Excluir OS (apenas dono ou os_manage_all)

### Usuários
- `GET /users` - Listar usuários do tenant

### Almoxarifado
- `GET /inventory` - Listar itens
- `POST /inventory` - Criar item (requer role: almoxarifado)
- `PUT /inventory/:id` - Atualizar quantidade (requer role: almoxarifado)
- `DELETE /inventory/:id` - Excluir item (requer role: almoxarifado)

### Compras
- `GET /purchases` - Listar requisições
- `POST /purchases` - Criar requisição (requer role: compras/almoxarifado/os)
- `PATCH /purchases/:id` - Atualizar status (requer role: compras)
- `DELETE /purchases/:id` - Excluir (requer role: compras)

### Preventivas
- `GET /preventives` - Listar preventivas
- `POST /preventives` - Criar preventiva (requer role: preventivas)
- `POST /preventives/:id/complete` - Marcar como concluída
- `DELETE /preventives/:id` - Excluir (requer role: preventivas)

> Todas as rotas (exceto `/auth/*`) exigem Bearer token no header `Authorization: Bearer <token>`

## 🔑 Sistema de Roles

- **admin**: Acesso total a tudo
- **os**: Criar/editar/excluir próprias OS
- **os_manage_all**: Editar qualquer OS
- **os_view_all**: Ver todas as OS (somente leitura)
- **preventivas**: Gerenciar manutenções preventivas
- **almoxarifado**: Gerenciar estoque
- **compras**: Gerenciar requisições de compra
- **checklist_ovos**: Acesso a checklist da sala de ovos
- **checklist_granja**: Acesso a checklist da granja

## 🧹 Limpeza Automática

O sistema limpa automaticamente (a cada 6 horas):
- OS concluídas há mais de 60 dias
- Compras com status "chegou" há mais de 60 dias
- Preventivas concluídas há mais de 60 dias

## 🆘 Troubleshooting

### Backend não conecta ao banco
- Verifique se o IP do droplet está em "Trusted Sources" no Postgres da DO
- Teste conexão: `psql "postgresql://doadmin:SENHA@HOST:25060/defaultdb?sslmode=require"`

### Frontend não conecta à API
- Verifique `frontend/config.js` - deve apontar para `http://159.203.8.237:4000`
- Teste: `curl http://159.203.8.237:4000/health`

### PM2 não inicia no boot
- Execute: `pm2 startup` e siga as instruções
- Salve: `pm2 save`

### Atualizar código após mudanças
```bash
cd /opt/icarussite
git pull
cd ICARUS\ SITE/backend
npm install
pm2 restart icarus-api
```
