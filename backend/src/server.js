require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { v4: uuid } = require('uuid');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

// Push Notifications
let pushNotifications;
try {
  pushNotifications = require('./pushNotifications');
  console.log('✅ Módulo de push notifications carregado');
} catch (e) {
  console.log('Push notifications não disponível:', e.message);
}

// Security packages (optional - will work without them)
let helmet, rateLimit;
try {
  helmet = require('helmet');
} catch (e) {
  console.log('helmet not installed - running without helmet middleware');
}
try {
  rateLimit = require('express-rate-limit');
} catch (e) {
  console.log('express-rate-limit not installed - running without rate limiting');
}

const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false }
});

// ============================================
// PDF STYLING HELPERS - Design Premium
// ============================================
const PDF_COLORS = {
  primary: '#6366f1',      // Indigo
  secondary: '#8b5cf6',    // Violet
  success: '#10b981',      // Emerald
  warning: '#f59e0b',      // Amber
  danger: '#ef4444',       // Red
  info: '#06b6d4',         // Cyan
  dark: '#1e293b',         // Slate dark
  light: '#f1f5f9',        // Slate light
  water: '#0ea5e9',        // Sky blue
  diesel: '#f97316',       // Orange
  generator: '#eab308',    // Yellow
  orders: '#8b5cf6'        // Purple
};

// Função para criar header estilizado
function pdfHeader(doc, title, subtitle, color = PDF_COLORS.primary) {
  // Background gradiente do header
  doc.rect(0, 0, 595.28, 120)
     .fill('#1e293b');
  
  // Barra colorida lateral
  doc.rect(0, 0, 8, 120).fill(color);
  
  // Logo Icarus (estrela)
  const logoX = 45;
  const logoY = 35;
  const logoSize = 50;
  
  // Desenhar estrela estilizada
  doc.save();
  doc.circle(logoX + logoSize/2, logoY + logoSize/2, logoSize/2)
     .lineWidth(2).stroke(color);
  
  // Estrela de 8 pontas
  const cx = logoX + logoSize/2;
  const cy = logoY + logoSize/2;
  const outer = logoSize/2 - 8;
  const inner = outer * 0.4;
  
  doc.moveTo(cx, cy - outer);
  for (let i = 1; i <= 8; i++) {
    const angle = (i * Math.PI / 4) - Math.PI / 2;
    const r = i % 2 === 0 ? outer : inner;
    doc.lineTo(cx + r * Math.cos(angle), cy + r * Math.sin(angle));
  }
  doc.fill(color);
  doc.restore();
  
  // Título
  doc.font('Helvetica-Bold').fontSize(28).fillColor(color)
     .text(title, 110, 35);
  
  // Subtítulo
  doc.font('Helvetica').fontSize(12).fillColor('#94a3b8')
     .text(subtitle, 110, 70);
  
  // Linha decorativa
  doc.moveTo(110, 95).lineTo(450, 95).lineWidth(1).strokeColor(color).stroke();
  
  doc.fillColor('#000000'); // Reset color
  doc.y = 140;
}

// Função para criar card de estatística
function pdfStatCard(doc, x, y, width, label, value, icon, color = PDF_COLORS.primary) {
  // Background do card
  doc.roundedRect(x, y, width, 70, 8).fill('#f8fafc');
  
  // Barra lateral colorida
  doc.rect(x, y, 4, 70).fill(color);
  
  // Valor
  doc.font('Helvetica-Bold').fontSize(24).fillColor(color)
     .text(value, x + 15, y + 12, { width: width - 20 });
  
  // Label
  doc.font('Helvetica').fontSize(10).fillColor('#64748b')
     .text(label.toUpperCase(), x + 15, y + 48, { width: width - 20 });
}

// Função para criar tabela estilizada
function pdfTableHeader(doc, columns, y, color = PDF_COLORS.primary) {
  const startX = 50;
  const rowHeight = 25;
  
  // Background do header
  doc.rect(startX, y, 495, rowHeight).fill(color);
  
  // Textos do header
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#ffffff');
  let currentX = startX;
  columns.forEach(col => {
    doc.text(col.label, currentX + 5, y + 8, { width: col.width - 10, align: col.align || 'left' });
    currentX += col.width;
  });
  
  return y + rowHeight;
}

function pdfTableRow(doc, columns, values, y, isAlt = false) {
  const startX = 50;
  const rowHeight = 20;
  
  // Background alternado
  if (isAlt) {
    doc.rect(startX, y, 495, rowHeight).fill('#f8fafc');
  }
  
  // Valores
  doc.font('Helvetica').fontSize(8).fillColor('#334155');
  let currentX = startX;
  columns.forEach((col, i) => {
    doc.text(values[i] || '-', currentX + 5, y + 6, { width: col.width - 10, align: col.align || 'left' });
    currentX += col.width;
  });
  
  return y + rowHeight;
}

// Função para rodapé
function pdfFooter(doc, color = PDF_COLORS.primary) {
  const y = 780;
  
  // Linha decorativa
  doc.moveTo(50, y).lineTo(545, y).lineWidth(0.5).strokeColor('#cbd5e1').stroke();
  
  // Logo pequeno
  doc.circle(65, y + 18, 8).lineWidth(1).strokeColor(color).stroke();
  doc.font('Helvetica-Bold').fontSize(6).fillColor(color).text('★', 62, y + 14);
  
  // Texto
  doc.font('Helvetica-Bold').fontSize(10).fillColor(color).text('ICARUS', 80, y + 12);
  doc.font('Helvetica').fontSize(7).fillColor('#94a3b8').text('Sistema de Gestão', 80, y + 24);
  
  // Data/hora
  doc.font('Helvetica').fontSize(7).fillColor('#94a3b8')
     .text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, 350, y + 18, { align: 'right', width: 195 });
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenant_keys (
      id TEXT PRIMARY KEY,
      key_value TEXT UNIQUE NOT NULL,
      name TEXT,
      tenant_type TEXT DEFAULT 'granja',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Adiciona coluna tenant_type se não existir
    DO $$ BEGIN
      ALTER TABLE tenant_keys ADD COLUMN IF NOT EXISTS tenant_type TEXT DEFAULT 'granja';
    EXCEPTION WHEN others THEN NULL; END $$;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      roles TEXT[] DEFAULT ARRAY['tech'],
      key_id TEXT REFERENCES tenant_keys(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      sector TEXT,
      priority TEXT DEFAULT 'medium',
      status TEXT DEFAULT 'pending',
      progress_note TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ,
      requested_by TEXT REFERENCES users(id),
      key_id TEXT REFERENCES tenant_keys(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS order_assignments (
      order_id TEXT REFERENCES orders(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY(order_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS inventory_items (
      id TEXT PRIMARY KEY,
      sku TEXT,
      name TEXT NOT NULL,
      category TEXT,
      brand TEXT,
      quantity INTEGER DEFAULT 0,
      unit TEXT NOT NULL,
      min_stock INTEGER DEFAULT 0,
      max_stock INTEGER,
      location TEXT,
      specs TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      key_id TEXT REFERENCES tenant_keys(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS purchases (
      id TEXT PRIMARY KEY,
      item_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit TEXT NOT NULL,
      unit_price NUMERIC(12,2),
      total_cost NUMERIC(12,2),
      supplier TEXT,
      notes TEXT,
      status TEXT DEFAULT 'analise',
      requested_by TEXT REFERENCES users(id),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      key_id TEXT REFERENCES tenant_keys(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS preventives (
      id TEXT PRIMARY KEY,
      equipment_name TEXT NOT NULL,
      maintenance_type TEXT,
      frequency TEXT,
      next_date DATE,
      last_date DATE,
      responsible TEXT,
      checklist TEXT,
      key_id TEXT REFERENCES tenant_keys(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Checklists: templates de verificação (ex: Yamasa Sala de Ovos)
    CREATE TABLE IF NOT EXISTS checklists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      sector TEXT,
      frequency TEXT DEFAULT 'diario',
      created_by TEXT REFERENCES users(id),
      key_id TEXT REFERENCES tenant_keys(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Itens de cada checklist
    CREATE TABLE IF NOT EXISTS checklist_items (
      id TEXT PRIMARY KEY,
      checklist_id TEXT REFERENCES checklists(id) ON DELETE CASCADE,
      description TEXT NOT NULL,
      item_order INTEGER DEFAULT 0
    );

    -- Execuções de checklist (registro diário)
    CREATE TABLE IF NOT EXISTS checklist_executions (
      id TEXT PRIMARY KEY,
      checklist_id TEXT REFERENCES checklists(id) ON DELETE CASCADE,
      executed_by TEXT REFERENCES users(id),
      executed_at TIMESTAMPTZ DEFAULT NOW(),
      notes TEXT,
      key_id TEXT REFERENCES tenant_keys(id) ON DELETE CASCADE
    );

    -- Itens marcados em cada execução
    CREATE TABLE IF NOT EXISTS checklist_execution_items (
      execution_id TEXT REFERENCES checklist_executions(id) ON DELETE CASCADE,
      item_id TEXT REFERENCES checklist_items(id) ON DELETE CASCADE,
      checked BOOLEAN DEFAULT FALSE,
      checked_at TIMESTAMPTZ,
      notes TEXT,
      PRIMARY KEY(execution_id, item_id)
    );

    -- Adiciona coluna de foto nas compras (base64 ou URL)
    DO $$ BEGIN
      ALTER TABLE purchases ADD COLUMN IF NOT EXISTS photo_url TEXT;
    EXCEPTION WHEN others THEN NULL; END $$;

    -- Controle de Água - Registros das caixas d'água (Aviários e Recria)
    CREATE TABLE IF NOT EXISTS water_readings (
      id TEXT PRIMARY KEY,
      tank_name TEXT NOT NULL,
      reading_value NUMERIC(12,3) NOT NULL,
      reading_time TEXT NOT NULL,
      reading_date DATE NOT NULL,
      temperature NUMERIC(5,1),
      notes TEXT,
      recorded_by TEXT REFERENCES users(id),
      key_id TEXT REFERENCES tenant_keys(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Adiciona coluna de temperatura se não existir
    DO $$ BEGIN
      ALTER TABLE water_readings ADD COLUMN IF NOT EXISTS temperature NUMERIC(5,1);
    EXCEPTION WHEN others THEN NULL; END $$;

    -- Índice para consultas rápidas por data e tanque
    CREATE INDEX IF NOT EXISTS idx_water_readings_date ON water_readings(reading_date, tank_name);

    -- Controle de Diesel - Registros de entrada e saída de diesel
    CREATE TABLE IF NOT EXISTS diesel_records (
      id TEXT PRIMARY KEY,
      record_type TEXT NOT NULL CHECK (record_type IN ('entrada', 'saida')),
      quantity NUMERIC(12,3) NOT NULL,
      reason TEXT,
      record_date DATE NOT NULL,
      recorded_by TEXT REFERENCES users(id),
      notes TEXT,
      key_id TEXT REFERENCES tenant_keys(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Índice para consultas rápidas de diesel por data
    CREATE INDEX IF NOT EXISTS idx_diesel_records_date ON diesel_records(record_date);

    -- Controle de Gerador - Registros de uso do gerador
    CREATE TABLE IF NOT EXISTS generator_records (
      id TEXT PRIMARY KEY,
      record_type TEXT NOT NULL CHECK (record_type IN ('ligado', 'desligado', 'abastecimento', 'manutencao')),
      start_time TEXT,
      fuel_used NUMERIC(12,3),
      notes TEXT,
      record_date DATE NOT NULL,
      recorded_by TEXT REFERENCES users(id),
      key_id TEXT REFERENCES tenant_keys(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Índice para consultas rápidas do gerador por data
    CREATE INDEX IF NOT EXISTS idx_generator_records_date ON generator_records(record_date);

    -- Tarefas Aditivas - problemas repentinos fora de OS (auto-arquiva após 2 meses)
    CREATE TABLE IF NOT EXISTS additive_tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      sector TEXT,
      priority TEXT DEFAULT 'medium',
      status TEXT DEFAULT 'pending',
      executed_at TIMESTAMPTZ,
      executed_by TEXT REFERENCES users(id),
      archived_at TIMESTAMPTZ,
      notes TEXT,
      created_by TEXT REFERENCES users(id),
      key_id TEXT REFERENCES tenant_keys(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Índice para arquivamento automático
    CREATE INDEX IF NOT EXISTS idx_additive_tasks_executed ON additive_tasks(executed_at);

    -- Relatórios da Manutenção (nunca apagar)
    CREATE TABLE IF NOT EXISTS maintenance_reports (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      category TEXT,
      visibility TEXT DEFAULT 'public',
      attachments JSONB DEFAULT '[]',
      created_by TEXT REFERENCES users(id),
      key_id TEXT REFERENCES tenant_keys(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Adicionar novas colunas se não existirem
    DO $$ BEGIN
      ALTER TABLE maintenance_reports ADD COLUMN IF NOT EXISTS visibility TEXT DEFAULT 'public';
      ALTER TABLE maintenance_reports ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]';
    EXCEPTION WHEN others THEN NULL; END $$;

    -- Índice para consultas de relatórios
    CREATE INDEX IF NOT EXISTS idx_maintenance_reports_date ON maintenance_reports(created_at);
    
    -- Configurações de automação de checklists
    CREATE TABLE IF NOT EXISTS checklist_automation (
      id TEXT PRIMARY KEY,
      checklist_id TEXT REFERENCES checklists(id) ON DELETE CASCADE,
      auto_complete BOOLEAN DEFAULT false,
      frequency_days INTEGER DEFAULT 1,
      last_auto_run TIMESTAMPTZ,
      next_auto_run TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    
    -- Adicionar coluna de automação aos checklists
    DO $$ BEGIN
      ALTER TABLE checklists ADD COLUMN IF NOT EXISTS auto_complete BOOLEAN DEFAULT false;
      ALTER TABLE checklists ADD COLUMN IF NOT EXISTS frequency_days INTEGER DEFAULT 1;
      ALTER TABLE checklists ADD COLUMN IF NOT EXISTS last_auto_run TIMESTAMPTZ;
      ALTER TABLE checklists ADD COLUMN IF NOT EXISTS auto_time TEXT DEFAULT '11:00';
      ALTER TABLE checklists ADD COLUMN IF NOT EXISTS auto_create_os BOOLEAN DEFAULT false;
      ALTER TABLE checklists ADD COLUMN IF NOT EXISTS auto_os_executor TEXT;
      ALTER TABLE checklists ADD COLUMN IF NOT EXISTS auto_os_title TEXT;
    EXCEPTION WHEN others THEN NULL; END $$;

    -- Push Notification Tokens
    CREATE TABLE IF NOT EXISTS push_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL,
      device_type TEXT DEFAULT 'android',
      active BOOLEAN DEFAULT true,
      key_id TEXT REFERENCES tenant_keys(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Índice para busca de tokens por usuário
    CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON push_tokens(user_id, active);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_push_tokens_unique ON push_tokens(token);

    -- ========================================
    -- MÓDULO LAVANDERIA - Controle de Roupas
    -- ========================================

    -- Clientes da lavanderia (empresas que contratam o serviço)
    CREATE TABLE IF NOT EXISTS laundry_clients (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      price_per_piece NUMERIC(10,2) NOT NULL DEFAULT 3.00,
      color TEXT DEFAULT '#ec4899',
      active BOOLEAN DEFAULT true,
      key_id TEXT REFERENCES tenant_keys(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Categorias de roupa (calça masc, camisa fem, etc)
    CREATE TABLE IF NOT EXISTS laundry_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon TEXT DEFAULT '👕',
      key_id TEXT REFERENCES tenant_keys(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Lançamentos diários de lavanderia
    CREATE TABLE IF NOT EXISTS laundry_entries (
      id TEXT PRIMARY KEY,
      client_id TEXT REFERENCES laundry_clients(id) ON DELETE CASCADE,
      category_id TEXT REFERENCES laundry_categories(id) ON DELETE CASCADE,
      quantity INTEGER NOT NULL DEFAULT 0,
      unit_price NUMERIC(10,2) NOT NULL,
      total_value NUMERIC(12,2) NOT NULL,
      entry_date DATE NOT NULL,
      recorded_by TEXT REFERENCES users(id),
      notes TEXT,
      key_id TEXT REFERENCES tenant_keys(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Índices para consultas rápidas de lavanderia
    CREATE INDEX IF NOT EXISTS idx_laundry_entries_date ON laundry_entries(entry_date);
    CREATE INDEX IF NOT EXISTS idx_laundry_entries_client ON laundry_entries(client_id);
  `);

  const seedKeyValue = process.env.SEED_KEY_VALUE;
  const seedKeyName = process.env.SEED_KEY_NAME || 'Tenant Demo';
  let keyId;

  if (seedKeyValue) {
    const keyResult = await pool.query('SELECT id FROM tenant_keys WHERE key_value = $1', [seedKeyValue]);
    if (keyResult.rowCount > 0) {
      keyId = keyResult.rows[0].id;
    } else {
      keyId = uuid();
      await pool.query('INSERT INTO tenant_keys (id, key_value, name) VALUES ($1, $2, $3)', [keyId, seedKeyValue, seedKeyName]);
    }
  }

  const seedUser = process.env.SEED_USER_USERNAME;
  const seedPass = process.env.SEED_USER_PASSWORD;
  const seedName = process.env.SEED_USER_NAME || 'Administrador';
  if (keyId && seedUser && seedPass) {
    const userResult = await pool.query('SELECT id FROM users WHERE username = $1', [seedUser]);
    if (userResult.rowCount === 0) {
      const hash = await bcrypt.hash(seedPass, 10);
      await pool.query(
        'INSERT INTO users (id, username, name, password_hash, roles, key_id) VALUES ($1, $2, $3, $4, $5, $6)',
        [uuid(), seedUser, seedName, hash, ['admin'], keyId]
      );
      console.log('Seeded default admin user');
    }
  }
}

function buildToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' });
}

function requireAuth(req, res, next) {
  // Tentar pegar token do header Authorization ou da query string (para downloads de PDF)
  const header = req.headers.authorization || '';
  let token = header.replace('Bearer ', '');
  
  // Se não tem no header, tentar query string (usado para download de PDF no Android)
  if (!token && req.query.token) {
    token = req.query.token;
  }
  
  if (!token) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    return next();
  } catch (err) {
    return res.status(401).json({ ok: false, error: 'Invalid token' });
  }
}

const app = express();

// Security middleware
if (helmet) {
  app.use(helmet({
    contentSecurityPolicy: false, // Disabled for API-only server
    crossOriginEmbedderPolicy: false
  }));
}

// Rate limiting for auth endpoints (prevent brute force)
if (rateLimit) {
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Max 10 login attempts per IP per window
    message: { ok: false, error: 'Muitas tentativas. Tente novamente em 15 minutos.' },
    standardHeaders: true,
    legacyHeaders: false
  });
  
  const generalLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 100, // Max 100 requests per minute per IP
    message: { ok: false, error: 'Limite de requisições excedido. Aguarde um momento.' }
  });
  
  // Apply limiters
  app.use('/auth/login', authLimiter);
  app.use('/auth/validate-key', authLimiter);
  app.use(generalLimiter);
}

app.use(cors());
app.use(express.json({ limit: '10mb' })); // Limit body size

// ========== INPUT SANITIZATION ==========
// Sanitize string input to prevent XSS when data is stored
function sanitizeString(str, maxLength = 500) {
  if (str === null || str === undefined) return null;
  if (typeof str !== 'string') str = String(str);
  // Trim and limit length
  str = str.trim().substring(0, maxLength);
  // Remove null bytes and other control characters (except newline/tab)
  str = str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  return str || null;
}

// Validate UUID format
function isValidUUID(str) {
  if (!str) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);
}

function requireRoles(roles) {
  return (req, res, next) => {
    const userRoles = (req.user && req.user.roles) || [];
    if (userRoles.includes('admin')) return next();
    if (!roles || roles.length === 0) return next();
    const ok = roles.some(r => userRoles.includes(r));
    return ok ? next() : res.status(403).json({ ok: false, error: 'Forbidden' });
  };
}

// ========== TENANT TYPE SECURITY ==========
// Middleware que valida se o usuário pode acessar determinado módulo
// Isso previne ataques onde alguém tenta chamar APIs de outro tenant via DevTools/Postman
function requireTenantType(allowedTypes) {
  return async (req, res, next) => {
    // tenantType vem do token JWT (definido no login)
    const userTenantType = req.user?.tenantType || 'granja';
    
    // Se não especificou tipos, permite todos
    if (!allowedTypes || allowedTypes.length === 0) return next();
    
    // Verificar se o tipo do usuário está na lista permitida
    const allowed = allowedTypes.includes(userTenantType);
    if (!allowed) {
      console.warn(`[SECURITY] Tentativa de acesso bloqueada: user=${req.user?.username}, tenantType=${userTenantType}, requiredTypes=${allowedTypes.join(',')}, path=${req.path}`);
      return res.status(403).json({ 
        ok: false, 
        error: 'Acesso negado: seu tenant não tem permissão para este módulo' 
      });
    }
    
    // Verificar também no banco para garantir que o tenant_type não foi alterado
    // (double-check de segurança - token pode estar desatualizado)
    try {
      const result = await pool.query(
        'SELECT tenant_type FROM tenant_keys WHERE id = $1',
        [req.user.keyId]
      );
      if (result.rowCount === 0) {
        return res.status(403).json({ ok: false, error: 'Tenant não encontrado' });
      }
      const dbTenantType = result.rows[0].tenant_type || 'granja';
      if (!allowedTypes.includes(dbTenantType)) {
        console.warn(`[SECURITY] Token desatualizado detectado: token=${userTenantType}, db=${dbTenantType}`);
        return res.status(403).json({ 
          ok: false, 
          error: 'Token desatualizado - faça login novamente',
          code: 'TOKEN_REFRESH_REQUIRED'
        });
      }
    } catch (dbErr) {
      console.error('Erro ao verificar tenant_type:', dbErr);
      // Em caso de erro de DB, permitir com base no token (graceful degradation)
    }
    
    return next();
  };
}

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Endpoint para retornar URL atual do túnel Cloudflare
app.get('/tunnel-url', async (_req, res) => {
  try {
    const { execSync } = require('child_process');
    const logs = execSync('pm2 logs tunnel --lines 100 --nostream 2>&1').toString();
    // Pegar TODAS as URLs e usar a última (mais recente)
    const matches = logs.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g);
    if (matches && matches.length > 0) {
      const latestUrl = matches[matches.length - 1];
      res.json({ ok: true, url: latestUrl });
    } else {
      res.json({ ok: false, error: 'URL não encontrada nos logs' });
    }
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ========== APP VERSION CHECK (for auto-update) ==========
app.get('/api/app-version', (req, res) => {
  res.json({
    ok: true,
    version: '1.0.6',
    required: false,
    changelog: 'Correções de conexão e melhorias no módulo Lavanderia.',
    downloadUrl: 'https://github.com/Gui-S-1/icarussite/releases/latest/download/icarus.apk'
  });
});

app.post('/auth/validate-key', async (req, res) => {
  const { key } = req.body || {};
  if (!key) return res.status(400).json({ ok: false, error: 'Chave obrigatória' });
  try {
    const result = await pool.query('SELECT id, name, tenant_type FROM tenant_keys WHERE key_value = $1', [key]);
    if (result.rowCount === 0) return res.status(401).json({ ok: false, error: 'Chave inválida' });
    const row = result.rows[0];
    return res.json({ ok: true, key_id: row.id, tenant: row.name, company_name: row.name, tenant_type: row.tenant_type || 'granja' });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/auth/login', async (req, res) => {
  const { username, password, key_id } = req.body || {};
  if (!username || !password || !key_id) {
    return res.status(400).json({ ok: false, error: 'Credenciais ausentes' });
  }
  try {
    const userResult = await pool.query(
      `SELECT u.id, u.username, u.name, u.password_hash, u.roles, u.key_id, t.tenant_type, t.name as tenant_name
       FROM users u
       JOIN tenant_keys t ON t.id = u.key_id
       WHERE u.username = $1 AND u.key_id = $2`,
      [username, key_id]
    );
    if (userResult.rowCount === 0) return res.status(401).json({ ok: false, error: 'Usuário não encontrado' });
    const user = userResult.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ ok: false, error: 'Senha inválida' });

    const tenantType = user.tenant_type || 'granja';
    const token = buildToken({ userId: user.id, roles: user.roles, keyId: user.key_id, name: user.name, username: user.username, tenantType });
    return res.json({ ok: true, token, user: { id: user.id, name: user.name, username: user.username, roles: user.roles, key_id: user.key_id, tenant_type: tenantType, tenant_name: user.tenant_name } });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// Refresh token - renova o token sem precisar digitar senha novamente
app.post('/auth/refresh', requireAuth, async (req, res) => {
  try {
    // Buscar dados atualizados do usuário no banco com tenant_type
    const userResult = await pool.query(
      `SELECT u.id, u.username, u.name, u.roles, u.key_id, t.tenant_type, t.name as tenant_name
       FROM users u
       JOIN tenant_keys t ON t.id = u.key_id
       WHERE u.id = $1`,
      [req.user.userId]
    );
    if (userResult.rowCount === 0) {
      return res.status(401).json({ ok: false, error: 'Usuário não encontrado' });
    }
    const user = userResult.rows[0];
    const tenantType = user.tenant_type || 'granja';
    
    // Gerar novo token com dados atualizados (roles e tenant_type podem ter mudado)
    const newToken = buildToken({ 
      userId: user.id, 
      roles: user.roles, 
      keyId: user.key_id, 
      name: user.name, 
      username: user.username,
      tenantType
    });
    
    return res.json({ 
      ok: true, 
      token: newToken, 
      user: { 
        id: user.id, 
        name: user.name, 
        username: user.username, 
        roles: user.roles, 
        key_id: user.key_id,
        tenant_type: tenantType,
        tenant_name: user.tenant_name
      } 
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/users', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, name, roles FROM users WHERE key_id = $1 ORDER BY name',
      [req.user.keyId]
    );
    return res.json({ ok: true, users: result.rows });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

async function fetchOrders(keyId) {
  const result = await pool.query(
    `SELECT o.*, 
            req.name as requested_by_name,
            req.username as requested_by_username,
            COALESCE(json_agg(json_build_object('id', u.id, 'username', u.username, 'name', u.name)) FILTER (WHERE u.id IS NOT NULL), '[]'::json) AS assigned_users
     FROM orders o
     LEFT JOIN users req ON req.id = o.requested_by
     LEFT JOIN order_assignments oa ON oa.order_id = o.id
     LEFT JOIN users u ON u.id = oa.user_id
     WHERE o.key_id = $1
     GROUP BY o.id, req.name, req.username
     ORDER BY o.created_at DESC`,
    [keyId]
  );
  return result.rows.map(row => ({
    ...row,
    assigned_users: Array.isArray(row.assigned_users) ? row.assigned_users : [],
  }));
}

function normalizeInventory(rows) {
  return rows.map(item => ({ ...item, quantity: Number(item.quantity) }));
}

function normalizePurchases(rows) {
  return rows.map(p => ({
    ...p,
    quantity: Number(p.quantity),
    unit_price: p.unit_price !== null ? Number(p.unit_price) : null,
    total_cost: p.total_cost !== null ? Number(p.total_cost) : null,
  }));
}

app.get('/orders', requireAuth, async (req, res) => {
  try {
    let orders = await fetchOrders(req.user.keyId);
    
    // Admin, os_manage_all e os_view_all veem todas as OS
    const userRoles = req.user.roles || [];
    const canSeeAll = userRoles.includes('admin') || userRoles.includes('os_manage_all') || userRoles.includes('os_view_all');
    
    if (!canSeeAll) {
      // Filtrar apenas OS criadas pelo usuário OU onde ele está atribuído
      orders = orders.filter(order => {
        // OS criada por mim
        if (order.requested_by === req.user.userId) return true;
        
        // OS onde estou atribuído
        if (order.assigned_users && order.assigned_users.some(u => u.id === req.user.userId)) return true;
        
        return false;
      });
    }
    
    return res.json({ ok: true, orders });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ========== DASHBOARD STATS ==========
// GET - Estatísticas completas para dashboard (OS + Aditiva por funcionário)
app.get('/dashboard/stats', requireAuth, async (req, res) => {
  try {
    const { period } = req.query; // 'daily', 'weekly', 'monthly'
    let dateFilter = '';
    
    if (period === 'daily') {
      dateFilter = "AND DATE(o.finished_at) = CURRENT_DATE";
    } else if (period === 'weekly') {
      dateFilter = "AND o.finished_at >= NOW() - INTERVAL '7 days'";
    } else if (period === 'monthly') {
      dateFilter = "AND o.finished_at >= NOW() - INTERVAL '30 days'";
    } else {
      dateFilter = "AND o.finished_at >= NOW() - INTERVAL '30 days'";
    }
    
    // Estatísticas de OS por funcionário
    const osStats = await pool.query(`
      SELECT 
        u.id as user_id,
        u.name as user_name,
        COUNT(DISTINCT oa.order_id) as os_completed,
        COALESCE(SUM(
          CASE 
            WHEN o.worked_minutes > 0 THEN o.worked_minutes
            WHEN o.started_at IS NOT NULL AND o.finished_at IS NOT NULL 
            THEN EXTRACT(EPOCH FROM (o.finished_at - o.started_at)) / 60 
            ELSE 0 
          END
        ), 0) as total_minutes_os
      FROM users u
      LEFT JOIN order_assignments oa ON oa.user_id = u.id
      LEFT JOIN orders o ON o.id = oa.order_id AND o.status = 'completed' ${dateFilter}
      WHERE u.key_id = $1
      GROUP BY u.id, u.name
    `, [req.user.keyId]);
    
    // Estatísticas de Aditiva por funcionário
    let aditivaDateFilter = '';
    if (period === 'daily') {
      aditivaDateFilter = "AND DATE(at.executed_at) = CURRENT_DATE";
    } else if (period === 'weekly') {
      aditivaDateFilter = "AND at.executed_at >= NOW() - INTERVAL '7 days'";
    } else {
      aditivaDateFilter = "AND at.executed_at >= NOW() - INTERVAL '30 days'";
    }
    
    const aditivaStats = await pool.query(`
      SELECT 
        u.id as user_id,
        u.name as user_name,
        COUNT(at.id) as aditiva_completed
      FROM users u
      LEFT JOIN additive_tasks at ON at.executed_by = u.id AND at.status = 'completed' ${aditivaDateFilter}
      WHERE u.key_id = $1
      GROUP BY u.id, u.name
    `, [req.user.keyId]);
    
    // Combinar estatísticas
    const userStats = {};
    osStats.rows.forEach(row => {
      userStats[row.user_id] = {
        user_id: row.user_id,
        user_name: row.user_name,
        os_completed: parseInt(row.os_completed) || 0,
        total_minutes_os: parseFloat(row.total_minutes_os) || 0,
        aditiva_completed: 0
      };
    });
    
    aditivaStats.rows.forEach(row => {
      if (userStats[row.user_id]) {
        userStats[row.user_id].aditiva_completed = parseInt(row.aditiva_completed) || 0;
      } else {
        userStats[row.user_id] = {
          user_id: row.user_id,
          user_name: row.user_name,
          os_completed: 0,
          total_minutes_os: 0,
          aditiva_completed: parseInt(row.aditiva_completed) || 0
        };
      }
    });
    
    // Calcular total de tarefas e ranking
    const rankings = Object.values(userStats)
      .map(u => ({
        ...u,
        total_tasks: u.os_completed + u.aditiva_completed,
        avg_minutes_per_task: u.os_completed > 0 ? Math.round(u.total_minutes_os / u.os_completed) : 0
      }))
      .filter(u => u.total_tasks > 0)
      .sort((a, b) => b.total_tasks - a.total_tasks);
    
    return res.json({ ok: true, rankings });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /orders - Criar OS (qualquer usuário logado pode criar)
app.post('/orders', requireAuth, async (req, res) => {
  const { title, description, sector, priority = 'medium', assigned_user_ids = [] } = req.body || {};
  if (!title) return res.status(400).json({ ok: false, error: 'Título obrigatório' });
  try {
    const orderId = uuid();
    await pool.query(
      `INSERT INTO orders (id, title, description, sector, priority, status, requested_by, key_id)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7)`,
      [orderId, title, description || null, sector || null, priority, req.user.userId, req.user.keyId]
    );

    if (Array.isArray(assigned_user_ids) && assigned_user_ids.length > 0) {
      const values = assigned_user_ids.map((uid, idx) => `($1, $${idx + 2})`).join(',');
      await pool.query(`INSERT INTO order_assignments (order_id, user_id) VALUES ${values}`,[orderId, ...assigned_user_ids]);
    }

    // Notificar manutenção sobre nova OS
    if (pushNotifications) {
      pushNotifications.notifyNewOrder(pool, { id: orderId, title, priority });
    }

    const orders = await fetchOrders(req.user.keyId);
    return res.status(201).json({ ok: true, orders });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// PATCH /orders - Atualizar OS (criador, atribuído ou admin pode alterar)
app.patch('/orders/:id', requireAuth, async (req, res) => {
  const { status, assigned_user_ids, progress_note, started_at_custom, finished_at_custom, break_minutes } = req.body || {};
  const orderId = req.params.id;
  try {
    const allowedStatus = ['pending', 'in_progress', 'completed', 'paused'];
    if (status && !allowedStatus.includes(status)) {
      return res.status(400).json({ ok: false, error: 'Status inválido' });
    }

    const result = await pool.query('SELECT * FROM orders WHERE id = $1 AND key_id = $2', [orderId, req.user.keyId]);
    if (result.rowCount === 0) return res.status(404).json({ ok: false, error: 'OS não encontrada' });

    const order = result.rows[0];
    
    // Verificar permissão: admin, os_manage_all, criador OU atribuído à OS
    const canManageAll = (req.user.roles || []).includes('admin') || (req.user.roles || []).includes('os_manage_all');
    const isCreator = order.requested_by === req.user.userId;
    
    // Verificar se está atribuído à OS
    const assignmentCheck = await pool.query('SELECT 1 FROM order_assignments WHERE order_id = $1 AND user_id = $2', [orderId, req.user.userId]);
    const isAssigned = assignmentCheck.rowCount > 0;
    
    if (!canManageAll && !isCreator && !isAssigned) {
      return res.status(403).json({ ok: false, error: 'Sem permissão para alterar esta OS' });
    }
    
    // RESTRIÇÃO: Somente manutenção (canManageAll) pode concluir OS
    if (status === 'completed' && !canManageAll) {
      return res.status(403).json({ ok: false, error: 'Somente a manutenção pode concluir OS' });
    }
    
    // RESTRIÇÃO: Somente manutenção (canManageAll) pode alterar atribuições de técnicos
    if (Array.isArray(assigned_user_ids) && !canManageAll) {
      return res.status(403).json({ ok: false, error: 'Somente a manutenção pode atribuir técnicos às OS' });
    }
    
    const nextStatus = status || order.status;
    
    // Permitir datas retroativas customizadas (só manutenção/admin pode usar)
    let startedAt = order.started_at;
    let finishedAt = order.finished_at;
    let workedMinutes = order.worked_minutes || 0;
    let pausedAt = order.paused_at;
    
    // Calcular tempo trabalhado quando pausar
    if (nextStatus === 'paused' && order.status === 'in_progress') {
      const now = new Date();
      const lastStart = order.resumed_at || order.started_at;
      if (lastStart) {
        const minutesWorked = Math.round((now - new Date(lastStart)) / 60000);
        workedMinutes += minutesWorked;
      }
      pausedAt = now;
    }
    
    // Quando retomar, registrar o momento
    let resumedAt = order.resumed_at;
    if (nextStatus === 'in_progress' && order.status === 'paused') {
      resumedAt = new Date();
      pausedAt = null;
    }
    
    if (nextStatus === 'in_progress' && !order.started_at) {
      // Usa data customizada se fornecida (só para manutenção/admin), senão data atual
      if (started_at_custom && canManageAll) {
        startedAt = new Date(started_at_custom);
      } else {
        startedAt = new Date();
      }
      resumedAt = startedAt;
    }
    
    if (nextStatus === 'completed') {
      // Usa data customizada se fornecida (só para manutenção/admin), senão data atual
      if (finished_at_custom && canManageAll) {
        finishedAt = new Date(finished_at_custom);
      } else {
        finishedAt = new Date();
      }
      // Se estiver concluindo direto sem ter iniciado, setar started_at também
      if (!startedAt) {
        if (started_at_custom && canManageAll) {
          startedAt = new Date(started_at_custom);
        } else {
          startedAt = new Date();
        }
      }
      
      // Calcular worked_minutes
      // Se temos datas customizadas (retroativo)
      if ((started_at_custom || finished_at_custom) && canManageAll) {
        // Calcular tempo total entre início e fim
        const totalMinutes = Math.round((new Date(finishedAt) - new Date(startedAt)) / 60000);
        // Subtrair tempo de descanso informado
        const breakMins = parseInt(break_minutes) || 0;
        workedMinutes = Math.max(0, totalMinutes - breakMins);
      } else if (order.status === 'in_progress' || order.status === 'paused') {
        // Conclusão normal - somar tempo trabalhado desde último resume
        const lastStart = order.resumed_at || order.started_at;
        if (lastStart && order.status === 'in_progress') {
          const additionalMinutes = Math.round((finishedAt - new Date(lastStart)) / 60000);
          workedMinutes += additionalMinutes;
        }
        // Se estava pausada, já temos o tempo acumulado em workedMinutes
      } else if (!workedMinutes && startedAt && finishedAt) {
        // Fallback: calcular diferença bruta
        workedMinutes = Math.round((new Date(finishedAt) - new Date(startedAt)) / 60000);
      }
    }

    if (nextStatus === 'completed') {
      // Require at least one executor defined in assignment
      const countRes = await pool.query('SELECT COUNT(*)::int AS c FROM order_assignments WHERE order_id = $1', [orderId]);
      const alreadyAssigned = countRes.rows[0].c;
      if (Array.isArray(assigned_user_ids)) {
        if (assigned_user_ids.length === 0 && alreadyAssigned === 0) {
          return res.status(400).json({ ok: false, error: 'Defina quem executou a OS antes de concluir' });
        }
      } else if (alreadyAssigned === 0) {
        return res.status(400).json({ ok: false, error: 'Defina quem executou a OS antes de concluir' });
      }
    }

    await pool.query(
      `UPDATE orders SET status = $1, progress_note = COALESCE($2, progress_note), started_at = $3, finished_at = $4, worked_minutes = $5, paused_at = $6, resumed_at = $7 WHERE id = $8 AND key_id = $9`,
      [nextStatus, progress_note, startedAt, finishedAt, workedMinutes, pausedAt, resumedAt, orderId, req.user.keyId]
    );

    if (Array.isArray(assigned_user_ids)) {
      await pool.query('DELETE FROM order_assignments WHERE order_id = $1', [orderId]);
      if (assigned_user_ids.length > 0) {
        const values = assigned_user_ids.map((uid, idx) => `($1, $${idx + 2})`).join(',');
        await pool.query(`INSERT INTO order_assignments (order_id, user_id) VALUES ${values}`,[orderId, ...assigned_user_ids]);
      }
    }

    // Notificar criador quando OS é concluída
    if (nextStatus === 'completed' && pushNotifications) {
      pushNotifications.notifyOrderCompleted(pool, { id: orderId, title: order.title, created_by: order.requested_by });
    }

    const orders = await fetchOrders(req.user.keyId);
    const updated = orders.find(o => o.id === orderId);
    return res.json({ ok: true, order: updated, assigned_users: updated ? updated.assigned_users : [] });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE /orders - Excluir OS (criador ou admin pode excluir)
app.delete('/orders/:id', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT requested_by FROM orders WHERE id = $1 AND key_id = $2', [req.params.id, req.user.keyId]);
    if (result.rowCount === 0) return res.status(404).json({ ok: false, error: 'OS não encontrada' });
    const owner = result.rows[0].requested_by;
    const canManageAll = (req.user.roles || []).includes('admin') || (req.user.roles || []).includes('os_manage_all');
    if (!canManageAll && owner !== req.user.userId) {
      return res.status(403).json({ ok: false, error: 'Sem permissão para excluir esta OS' });
    }
    await pool.query('DELETE FROM orders WHERE id = $1 AND key_id = $2', [req.params.id, req.user.keyId]);
    const orders = await fetchOrders(req.user.keyId);
    return res.json({ ok: true, orders });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/inventory', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM inventory_items WHERE key_id = $1 ORDER BY name', [req.user.keyId]);
    return res.json({ ok: true, items: normalizeInventory(result.rows) });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/inventory', requireAuth, requireRoles(['almoxarifado']), async (req, res) => {
  const { sku, name, category, brand, quantity = 0, unit, min_stock = 0, max_stock, location, specs } = req.body || {};
  if (!name || !unit) return res.status(400).json({ ok: false, error: 'Nome e unidade são obrigatórios' });
  try {
    const id = uuid();
    await pool.query(
      `INSERT INTO inventory_items (id, sku, name, category, brand, quantity, unit, min_stock, max_stock, location, specs, key_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)` ,
      [id, sku || null, name, category || null, brand || null, quantity, unit, min_stock, max_stock || null, location || null, specs || null, req.user.keyId]
    );
    const result = await pool.query('SELECT * FROM inventory_items WHERE key_id = $1 ORDER BY name', [req.user.keyId]);
    return res.status(201).json({ ok: true, items: normalizeInventory(result.rows) });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.put('/inventory/:id', requireAuth, requireRoles(['almoxarifado']), async (req, res) => {
  const { quantity } = req.body || {};
  if (quantity === undefined) return res.status(400).json({ ok: false, error: 'Quantidade obrigatória' });
  try {
    await pool.query('UPDATE inventory_items SET quantity = $1, updated_at = NOW() WHERE id = $2 AND key_id = $3', [quantity, req.params.id, req.user.keyId]);
    const result = await pool.query('SELECT * FROM inventory_items WHERE key_id = $1 ORDER BY name', [req.user.keyId]);
    const items = result.rows.map(item => ({ ...item, quantity: Number(item.quantity) }));
    return res.json({ ok: true, items });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete('/inventory/:id', requireAuth, requireRoles(['almoxarifado']), async (req, res) => {
  try {
    await pool.query('DELETE FROM inventory_items WHERE id = $1 AND key_id = $2', [req.params.id, req.user.keyId]);
    const result = await pool.query('SELECT * FROM inventory_items WHERE key_id = $1 ORDER BY name', [req.user.keyId]);
    return res.json({ ok: true, items: normalizeInventory(result.rows) });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// =====================================================
// INVENTORY MOVEMENTS - Sistema de Movimentações V2
// =====================================================

// Listar movimentações
app.get('/api/inventory/movements', requireAuth, async (req, res) => {
  try {
    const { start_date, end_date, movement_type, item_id, person_name, pending_return } = req.query;
    
    let query = `
      SELECT m.*, i.name as item_name, i.sku as item_sku, i.category as item_category, i.brand as item_brand, i.unit as item_unit, i.item_type
      FROM inventory_movements m
      LEFT JOIN inventory_items i ON m.item_id::text = i.id
      WHERE m.key_id = $1
    `;
    const params = [req.user.keyId];
    let paramCount = 2;
    
    if (start_date) {
      query += ` AND m.created_at >= $${paramCount++}`;
      params.push(start_date);
    }
    if (end_date) {
      query += ` AND m.created_at <= $${paramCount++}`;
      params.push(end_date + ' 23:59:59');
    }
    if (movement_type) {
      query += ` AND m.movement_type = $${paramCount++}`;
      params.push(movement_type);
    }
    if (item_id) {
      query += ` AND m.item_id = $${paramCount++}`;
      params.push(item_id);
    }
    if (person_name) {
      query += ` AND m.person_name ILIKE $${paramCount++}`;
      params.push('%' + person_name + '%');
    }
    if (pending_return === 'true') {
      query += ` AND m.usage_type = 'emprestimo' AND m.is_returned = false`;
    }
    
    query += ' ORDER BY m.created_at DESC LIMIT 500';
    
    const result = await pool.query(query, params);
    return res.json({ ok: true, movements: result.rows });
  } catch (err) {
    console.error('Erro ao buscar movimentações:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// Registrar nova movimentação (entrada, saída, devolução)
app.post('/api/inventory/movements', requireAuth, requireRoles(['almoxarifado']), async (req, res) => {
  const { 
    item_id, 
    movement_type, 
    quantity, 
    person_name, 
    person_sector,
    usage_type,
    expected_return_date,
    reference,
    notes 
  } = req.body || {};
  
  if (!item_id || !movement_type || !quantity) {
    return res.status(400).json({ ok: false, error: 'Item, tipo e quantidade são obrigatórios' });
  }
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const keyId = req.user.keyId;
    
    // Buscar item atual
    const itemResult = await client.query('SELECT * FROM inventory_items WHERE id = $1 AND key_id = $2', [item_id, keyId]);
    if (itemResult.rows.length === 0) {
      throw new Error('Item não encontrado');
    }
    const item = itemResult.rows[0];
    const quantityBefore = parseInt(item.quantity) || 0;
    
    // Calcular nova quantidade
    let quantityAfter = quantityBefore;
    const qty = parseInt(quantity);
    
    if (movement_type === 'entrada' || movement_type === 'devolucao') {
      quantityAfter = quantityBefore + qty;
    } else if (movement_type === 'saida') {
      quantityAfter = quantityBefore - qty;
      if (quantityAfter < 0) {
        throw new Error('Quantidade insuficiente em estoque');
      }
    } else if (movement_type === 'ajuste') {
      quantityAfter = qty; // Ajuste define o valor absoluto
    }
    
    // Inserir movimentação
    const movementId = uuid();
    await client.query(`
      INSERT INTO inventory_movements (
        id, key_id, item_id, movement_type, quantity, previous_quantity, new_quantity,
        person_name, person_sector, usage_type, expected_return_date, reason, notes, is_returned, created_by, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
    `, [
      movementId, keyId, item_id, movement_type, qty, quantityBefore, quantityAfter,
      person_name || null, person_sector || null, usage_type || 'consumo',
      expected_return_date || null, reference || null, notes || null, false, req.user.userId
    ]);
    
    // Atualizar quantidade no estoque
    await client.query('UPDATE inventory_items SET quantity = $1, updated_at = NOW() WHERE id = $2', [quantityAfter, item_id]);
    
    await client.query('COMMIT');
    
    // Retornar item atualizado
    const updatedItems = await pool.query('SELECT * FROM inventory_items WHERE key_id = $1 ORDER BY name', [keyId]);
    
    return res.status(201).json({ 
      ok: true, 
      movement: { id: movementId, movement_type, quantity: qty, quantity_before: quantityBefore, quantity_after: quantityAfter },
      items: normalizeInventory(updatedItems.rows)
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erro ao registrar movimentação:', err);
    return res.status(500).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
});

// Registrar devolução de item emprestado
app.post('/api/inventory/movements/:id/return', requireAuth, requireRoles(['almoxarifado']), async (req, res) => {
  const { return_condition, notes } = req.body || {};
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Buscar movimentação original
    const movResult = await client.query(`
      SELECT m.*
      FROM inventory_movements m 
      WHERE m.id = $1 AND m.key_id = $2
    `, [req.params.id, req.user.keyId]);
    
    if (movResult.rows.length === 0) {
      throw new Error('Movimentação não encontrada');
    }
    
    const movement = movResult.rows[0];
    
    if (movement.is_returned) {
      throw new Error('Item já foi devolvido');
    }
    
    if (movement.usage_type !== 'emprestimo') {
      throw new Error('Esta movimentação não é um empréstimo');
    }
    
    // Marcar como devolvido
    await client.query(`
      UPDATE inventory_movements 
      SET is_returned = true, returned_at = NOW(), notes = COALESCE(notes, '') || ' | Devolução: ' || $1
      WHERE id = $2
    `, [notes || '', req.params.id]);
    
    // Criar movimentação de devolução
    const returnId = uuid();
    await client.query(`
      INSERT INTO inventory_movements (
        id, key_id, item_id, movement_type, quantity, previous_quantity, new_quantity,
        person_name, person_sector, usage_type, notes, is_returned, created_by, created_at
      )
      SELECT $1, key_id, item_id, 'devolucao', quantity, 
        (SELECT quantity FROM inventory_items WHERE id = m.item_id::text),
        (SELECT quantity FROM inventory_items WHERE id = m.item_id::text) + quantity,
        person_name, person_sector, 'emprestimo', $2, true, $3, NOW()
      FROM inventory_movements m WHERE id = $4
    `, [returnId, notes || 'Devolução de empréstimo', req.user.userId, req.params.id]);
    
    // Atualizar estoque
    await client.query(`
      UPDATE inventory_items 
      SET quantity = quantity + $1, updated_at = NOW()
      WHERE id = $2
    `, [movement.quantity, movement.item_id]);
    
    await client.query('COMMIT');
    
    const updatedItems = await pool.query('SELECT * FROM inventory_items WHERE key_id = $1 ORDER BY name', [req.user.keyId]);
    
    return res.json({ ok: true, message: 'Devolução registrada com sucesso', items: normalizeInventory(updatedItems.rows) });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erro ao registrar devolução:', err);
    return res.status(500).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
});

// Estatísticas de movimentações
app.get('/api/inventory/stats', requireAuth, async (req, res) => {
  try {
    const { period } = req.query; // day, week, month, year
    
    let dateFilter = '';
    if (period === 'day') {
      dateFilter = "AND m.created_at >= CURRENT_DATE";
    } else if (period === 'week') {
      dateFilter = "AND m.created_at >= CURRENT_DATE - INTERVAL '7 days'";
    } else if (period === 'month') {
      dateFilter = "AND m.created_at >= CURRENT_DATE - INTERVAL '30 days'";
    } else if (period === 'year') {
      dateFilter = "AND m.created_at >= CURRENT_DATE - INTERVAL '365 days'";
    }
    
    const keyId = req.user.keyId;
    
    // Estatísticas gerais
    const statsQuery = `
      SELECT 
        COUNT(*) FILTER (WHERE movement_type = 'entrada') as total_entradas,
        COUNT(*) FILTER (WHERE movement_type = 'saida') as total_saidas,
        COUNT(*) FILTER (WHERE movement_type = 'devolucao') as total_devolucoes,
        COALESCE(SUM(quantity) FILTER (WHERE movement_type = 'entrada'), 0) as qty_entradas,
        COALESCE(SUM(quantity) FILTER (WHERE movement_type = 'saida'), 0) as qty_saidas,
        COALESCE(SUM(quantity) FILTER (WHERE movement_type = 'devolucao'), 0) as qty_devolucoes,
        COUNT(*) FILTER (WHERE usage_type = 'emprestimo' AND is_returned = false) as emprestimos_pendentes
      FROM inventory_movements m
      WHERE key_id = $1 ${dateFilter}
    `;
    
    const statsResult = await pool.query(statsQuery, [keyId]);
    
    // Top 10 itens mais movimentados
    const topItemsQuery = `
      SELECT i.name, i.sku, COUNT(*) as total_movimentos, SUM(m.quantity) as total_quantidade
      FROM inventory_movements m
      JOIN inventory_items i ON m.item_id::text = i.id
      WHERE m.key_id = $1 ${dateFilter}
      GROUP BY i.id, i.name, i.sku
      ORDER BY total_movimentos DESC
      LIMIT 10
    `;
    
    const topItemsResult = await pool.query(topItemsQuery, [keyId]);
    
    // Top setores que mais retiram
    const topSectorsQuery = `
      SELECT person_sector, COUNT(*) as total_retiradas, SUM(quantity) as total_quantidade
      FROM inventory_movements m
      WHERE key_id = $1 AND movement_type = 'saida' AND person_sector IS NOT NULL ${dateFilter}
      GROUP BY person_sector
      ORDER BY total_retiradas DESC
      LIMIT 10
    `;
    
    const topSectorsResult = await pool.query(topSectorsQuery, [keyId]);
    
    // Movimentações por dia (últimos 30 dias)
    const dailyQuery = `
      SELECT DATE(created_at) as date, movement_type, COUNT(*) as count, SUM(quantity) as quantity
      FROM inventory_movements
      WHERE key_id = $1 AND created_at >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY DATE(created_at), movement_type
      ORDER BY date
    `;
    
    const dailyResult = await pool.query(dailyQuery, [keyId]);
    
    // Itens em estoque baixo
    const lowStockQuery = `
      SELECT id, name, sku, quantity, min_stock, category, brand
      FROM inventory_items
      WHERE key_id = $1 AND quantity <= COALESCE(min_stock, 0)
      ORDER BY quantity ASC
      LIMIT 20
    `;
    
    const lowStockResult = await pool.query(lowStockQuery, [keyId]);
    
    return res.json({
      ok: true,
      stats: {
        summary: statsResult.rows[0],
        topItems: topItemsResult.rows,
        topSectors: topSectorsResult.rows,
        dailyMovements: dailyResult.rows,
        lowStock: lowStockResult.rows
      }
    });
  } catch (err) {
    console.error('Erro ao buscar estatísticas:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// Empréstimos pendentes (ferramentas não devolvidas)
app.get('/api/inventory/loans/pending', requireAuth, async (req, res) => {
  try {
    const query = `
      SELECT m.*, i.name as item_name, i.sku as item_sku, i.category as item_category, i.item_type
      FROM inventory_movements m
      JOIN inventory_items i ON m.item_id::text = i.id
      WHERE m.key_id = $1 AND m.usage_type = 'emprestimo' AND m.is_returned = false
      ORDER BY m.created_at DESC
    `;
    
    const result = await pool.query(query, [req.user.keyId]);
    return res.json({ ok: true, loans: result.rows });
  } catch (err) {
    console.error('Erro ao buscar empréstimos pendentes:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// Histórico de movimentações de um item específico
app.get('/api/inventory/:id/history', requireAuth, async (req, res) => {
  try {
    const query = `
      SELECT m.*
      FROM inventory_movements m
      WHERE m.item_id = $1 AND m.key_id = $2
      ORDER BY m.created_at DESC
      LIMIT 100
    `;
    
    const result = await pool.query(query, [req.params.id, req.user.keyId]);
    return res.json({ ok: true, history: result.rows });
  } catch (err) {
    console.error('Erro ao buscar histórico:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// Atualizar item completo (com novos campos)
app.put('/inventory/:id/full', requireAuth, requireRoles(['almoxarifado']), async (req, res) => {
  const { sku, name, category, brand, quantity, unit, min_stock, max_stock, location, specs, item_type, requires_return, unit_price } = req.body || {};
  
  try {
    await pool.query(`
      UPDATE inventory_items 
      SET sku = COALESCE($1, sku), name = COALESCE($2, name), category = COALESCE($3, category),
          brand = COALESCE($4, brand), quantity = COALESCE($5, quantity), unit = COALESCE($6, unit),
          min_stock = COALESCE($7, min_stock), max_stock = $8, location = $9, specs = $10,
          item_type = COALESCE($11, item_type), requires_return = COALESCE($12, requires_return),
          unit_price = $13, updated_at = NOW()
      WHERE id = $14 AND key_id = $15
    `, [sku, name, category, brand, quantity, unit, min_stock, max_stock, location, specs, item_type, requires_return, unit_price, req.params.id, req.user.keyId]);
    
    const result = await pool.query('SELECT * FROM inventory_items WHERE key_id = $1 ORDER BY name', [req.user.keyId]);
    return res.json({ ok: true, items: normalizeInventory(result.rows) });
  } catch (err) {
    console.error('Erro ao atualizar item:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/purchases', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM purchases WHERE key_id = $1 ORDER BY created_at DESC', [req.user.keyId]);
    return res.json({ ok: true, purchases: normalizePurchases(result.rows) });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// Anyone with os/almoxarifado/compras/compras_request can create purchase requests
app.post('/purchases', requireAuth, requireRoles(['compras','almoxarifado','os','compras_request']), async (req, res) => {
  const { item_name, quantity, unit, unit_price, total_cost, supplier, notes, photo_url } = req.body || {};
  if (!item_name || !quantity || !unit) return res.status(400).json({ ok: false, error: 'Campos obrigatórios faltando' });
  try {
    const id = uuid();
    await pool.query(
      `INSERT INTO purchases (id, item_name, quantity, unit, unit_price, total_cost, supplier, notes, photo_url, status, requested_by, key_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'analise',$10,$11)` ,
      [id, item_name, quantity, unit, unit_price || 0, total_cost || 0, supplier || null, notes || null, photo_url || null, req.user.userId, req.user.keyId]
    );
    
    // Notificar Joacir sobre nova compra
    if (pushNotifications) {
      pushNotifications.notifyJoacir(pool, 'purchase', `${item_name} (${quantity} ${unit})`);
    }
    
    const result = await pool.query('SELECT * FROM purchases WHERE key_id = $1 ORDER BY created_at DESC', [req.user.keyId]);
    return res.status(201).json({ ok: true, purchases: normalizePurchases(result.rows) });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// Only compras managers can advance status
app.patch('/purchases/:id', requireAuth, requireRoles(['compras']), async (req, res) => {
  const { status, unit_price, supplier, notes, total_cost } = req.body || {};
  
  try {
    // Construir query dinâmica baseado nos campos fornecidos
    const updates = [];
    const values = [];
    let paramCount = 1;
    
    if (status) {
      const allowed = ['analise', 'pedido', 'chegando', 'chegou'];
      if (!allowed.includes(status)) return res.status(400).json({ ok: false, error: 'Status inválido' });
      updates.push(`status = $${paramCount++}`);
      values.push(status);
    }
    
    if (unit_price !== undefined && unit_price !== null) {
      updates.push(`unit_price = $${paramCount++}`);
      values.push(unit_price);
    }
    
    if (total_cost !== undefined && total_cost !== null) {
      updates.push(`total_cost = $${paramCount++}`);
      values.push(total_cost);
    }
    
    if (supplier !== undefined) {
      updates.push(`supplier = $${paramCount++}`);
      values.push(supplier);
    }
    
    if (notes !== undefined) {
      updates.push(`notes = $${paramCount++}`);
      values.push(notes);
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ ok: false, error: 'Nenhum campo para atualizar' });
    }
    
    values.push(req.params.id);
    values.push(req.user.keyId);
    
    await pool.query(
      `UPDATE purchases SET ${updates.join(', ')} WHERE id = $${paramCount++} AND key_id = $${paramCount}`,
      values
    );
    
    // Notificar Joacir quando compra chegou
    if (status === 'chegou' && pushNotifications) {
      const purchaseResult = await pool.query('SELECT item_name FROM purchases WHERE id = $1', [req.params.id]);
      if (purchaseResult.rows.length > 0) {
        pushNotifications.notifyJoacir(pool, 'purchase_delivered', `${purchaseResult.rows[0].item_name} chegou!`);
      }
    }
    
    const result = await pool.query('SELECT * FROM purchases WHERE key_id = $1 ORDER BY created_at DESC', [req.user.keyId]);
    return res.json({ ok: true, purchases: normalizePurchases(result.rows) });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete('/purchases/:id', requireAuth, requireRoles(['compras']), async (req, res) => {
  try {
    await pool.query('DELETE FROM purchases WHERE id = $1 AND key_id = $2', [req.params.id, req.user.keyId]);
    const result = await pool.query('SELECT * FROM purchases WHERE key_id = $1 ORDER BY created_at DESC', [req.user.keyId]);
    return res.json({ ok: true, purchases: normalizePurchases(result.rows) });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/preventives', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM preventives WHERE key_id = $1 ORDER BY next_date ASC', [req.user.keyId]);
    return res.json({ ok: true, preventives: result.rows });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/preventives', requireAuth, requireRoles(['preventivas']), async (req, res) => {
  const { equipment_name, maintenance_type, frequency, next_date, responsible, checklist } = req.body || {};
  if (!equipment_name || !next_date) return res.status(400).json({ ok: false, error: 'Equipamento e data são obrigatórios' });
  try {
    const id = uuid();
    await pool.query(
      `INSERT INTO preventives (id, equipment_name, maintenance_type, frequency, next_date, responsible, checklist, key_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)` ,
      [id, equipment_name, maintenance_type || null, frequency || null, next_date, responsible || null, checklist || null, req.user.keyId]
    );
    const result = await pool.query('SELECT * FROM preventives WHERE key_id = $1 ORDER BY next_date ASC', [req.user.keyId]);
    return res.status(201).json({ ok: true, preventives: result.rows });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/preventives/:id/complete', requireAuth, requireRoles(['preventivas']), async (req, res) => {
  try {
    const today = new Date();
    await pool.query(
      'UPDATE preventives SET last_date = $1, next_date = $2 WHERE id = $3 AND key_id = $4',
      [today, new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000), req.params.id, req.user.keyId]
    );
    const result = await pool.query('SELECT * FROM preventives WHERE key_id = $1 ORDER BY next_date ASC', [req.user.keyId]);
    return res.json({ ok: true, preventives: result.rows });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete('/preventives/:id', requireAuth, requireRoles(['preventivas']), async (req, res) => {
  try {
    await pool.query('DELETE FROM preventives WHERE id = $1 AND key_id = $2', [req.params.id, req.user.keyId]);
    const result = await pool.query('SELECT * FROM preventives WHERE key_id = $1 ORDER BY next_date ASC', [req.user.keyId]);
    return res.json({ ok: true, preventives: result.rows });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ========== CHECKLISTS ==========

// Função auxiliar para verificar se pode editar checklist
function canEditChecklist(userRoles) {
  return userRoles.includes('admin') || userRoles.includes('os_manage_all') || userRoles.includes('checklist');
}

// GET - Listar checklists com itens
app.get('/checklists', requireAuth, async (req, res) => {
  try {
    const checklists = await pool.query(
      `SELECT c.*, u.name as created_by_name,
        COALESCE(json_agg(json_build_object('id', ci.id, 'description', ci.description, 'item_order', ci.item_order) ORDER BY ci.item_order) FILTER (WHERE ci.id IS NOT NULL), '[]'::json) as items
       FROM checklists c
       LEFT JOIN users u ON u.id = c.created_by
       LEFT JOIN checklist_items ci ON ci.checklist_id = c.id
       WHERE c.key_id = $1
       GROUP BY c.id, u.name
       ORDER BY c.name`,
      [req.user.keyId]
    );
    return res.json({ ok: true, checklists: checklists.rows });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// POST - Criar checklist (manutenção, sala de ovos, admin)
app.post('/checklists', requireAuth, async (req, res) => {
  const { name, description, sector, frequency, items } = req.body || {};
  if (!canEditChecklist(req.user.roles || [])) {
    return res.status(403).json({ ok: false, error: 'Sem permissão para criar checklist' });
  }
  if (!name) return res.status(400).json({ ok: false, error: 'Nome é obrigatório' });
  try {
    const id = uuid();
    await pool.query(
      `INSERT INTO checklists (id, name, description, sector, frequency, created_by, key_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, name, description || null, sector || null, frequency || 'diario', req.user.userId, req.user.keyId]
    );
    // Inserir itens
    if (items && Array.isArray(items)) {
      for (let i = 0; i < items.length; i++) {
        await pool.query(
          'INSERT INTO checklist_items (id, checklist_id, description, item_order) VALUES ($1,$2,$3,$4)',
          [uuid(), id, items[i], i]
        );
      }
    }
    const checklists = await pool.query(
      `SELECT c.*, u.name as created_by_name,
        COALESCE(json_agg(json_build_object('id', ci.id, 'description', ci.description, 'item_order', ci.item_order) ORDER BY ci.item_order) FILTER (WHERE ci.id IS NOT NULL), '[]'::json) as items
       FROM checklists c
       LEFT JOIN users u ON u.id = c.created_by
       LEFT JOIN checklist_items ci ON ci.checklist_id = c.id
       WHERE c.key_id = $1
       GROUP BY c.id, u.name
       ORDER BY c.name`,
      [req.user.keyId]
    );
    return res.status(201).json({ ok: true, checklists: checklists.rows });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// PATCH - Atualizar checklist
app.patch('/checklists/:id', requireAuth, async (req, res) => {
  if (!canEditChecklist(req.user.roles || [])) {
    return res.status(403).json({ ok: false, error: 'Sem permissão para editar checklist' });
  }
  const { name, description, sector, frequency, items } = req.body || {};
  try {
    await pool.query(
      `UPDATE checklists SET name = COALESCE($1, name), description = COALESCE($2, description), 
       sector = COALESCE($3, sector), frequency = COALESCE($4, frequency) WHERE id = $5 AND key_id = $6`,
      [name, description, sector, frequency, req.params.id, req.user.keyId]
    );
    // Atualizar itens se enviados
    if (items && Array.isArray(items)) {
      await pool.query('DELETE FROM checklist_items WHERE checklist_id = $1', [req.params.id]);
      for (let i = 0; i < items.length; i++) {
        const itemDesc = typeof items[i] === 'string' ? items[i] : items[i].description;
        await pool.query(
          'INSERT INTO checklist_items (id, checklist_id, description, item_order) VALUES ($1,$2,$3,$4)',
          [uuid(), req.params.id, itemDesc, i]
        );
      }
    }
    const checklists = await pool.query(
      `SELECT c.*, u.name as created_by_name,
        COALESCE(json_agg(json_build_object('id', ci.id, 'description', ci.description, 'item_order', ci.item_order) ORDER BY ci.item_order) FILTER (WHERE ci.id IS NOT NULL), '[]'::json) as items
       FROM checklists c
       LEFT JOIN users u ON u.id = c.created_by
       LEFT JOIN checklist_items ci ON ci.checklist_id = c.id
       WHERE c.key_id = $1
       GROUP BY c.id, u.name
       ORDER BY c.name`,
      [req.user.keyId]
    );
    return res.json({ ok: true, checklists: checklists.rows });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE - Excluir checklist
app.delete('/checklists/:id', requireAuth, async (req, res) => {
  if (!canEditChecklist(req.user.roles || [])) {
    return res.status(403).json({ ok: false, error: 'Sem permissão para excluir checklist' });
  }
  try {
    await pool.query('DELETE FROM checklists WHERE id = $1 AND key_id = $2', [req.params.id, req.user.keyId]);
    const checklists = await pool.query(
      `SELECT c.*, u.name as created_by_name,
        COALESCE(json_agg(json_build_object('id', ci.id, 'description', ci.description, 'item_order', ci.item_order) ORDER BY ci.item_order) FILTER (WHERE ci.id IS NOT NULL), '[]'::json) as items
       FROM checklists c
       LEFT JOIN users u ON u.id = c.created_by
       LEFT JOIN checklist_items ci ON ci.checklist_id = c.id
       WHERE c.key_id = $1
       GROUP BY c.id, u.name
       ORDER BY c.name`,
      [req.user.keyId]
    );
    return res.json({ ok: true, checklists: checklists.rows });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// GET - Listar execuções de checklist
app.get('/checklists/:id/executions', requireAuth, async (req, res) => {
  try {
    const executions = await pool.query(
      `SELECT ce.*, u.name as executed_by_name,
        COALESCE(json_agg(json_build_object('item_id', cei.item_id, 'checked', cei.checked, 'checked_at', cei.checked_at, 'notes', cei.notes, 'description', ci.description) ORDER BY ci.item_order) FILTER (WHERE cei.item_id IS NOT NULL), '[]'::json) as items
       FROM checklist_executions ce
       LEFT JOIN users u ON u.id = ce.executed_by
       LEFT JOIN checklist_execution_items cei ON cei.execution_id = ce.id
       LEFT JOIN checklist_items ci ON ci.id = cei.item_id
       WHERE ce.checklist_id = $1 AND ce.key_id = $2
       GROUP BY ce.id, u.name
       ORDER BY ce.executed_at DESC
       LIMIT 30`,
      [req.params.id, req.user.keyId]
    );
    return res.json({ ok: true, executions: executions.rows });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// POST - Executar checklist (marcar itens)
app.post('/checklists/:id/execute', requireAuth, async (req, res) => {
  const { items, notes } = req.body || {};
  // Qualquer usuário pode executar checklist (sala de ovos, manutenção, etc)
  try {
    const execId = uuid();
    await pool.query(
      `INSERT INTO checklist_executions (id, checklist_id, executed_by, notes, key_id)
       VALUES ($1,$2,$3,$4,$5)`,
      [execId, req.params.id, req.user.userId, notes || null, req.user.keyId]
    );
    // Inserir itens marcados
    if (items && Array.isArray(items)) {
      for (const item of items) {
        await pool.query(
          `INSERT INTO checklist_execution_items (execution_id, item_id, checked, checked_at, notes)
           VALUES ($1,$2,$3,$4,$5)`,
          [execId, item.item_id, item.checked || false, item.checked ? new Date() : null, item.notes || null]
        );
      }
    }
    return res.status(201).json({ ok: true, execution_id: execId });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// PATCH - Configurar automação de checklist (dia sim dia não, etc)
app.patch('/checklists/:id/automation', requireAuth, async (req, res) => {
  if (!canEditChecklist(req.user.roles || [])) {
    return res.status(403).json({ ok: false, error: 'Sem permissão para configurar automação' });
  }
  
  const { auto_complete, frequency_days, auto_time, auto_create_os, auto_os_executor, auto_os_title } = req.body || {};
  
  try {
    // Atualizar configuração de automação
    await pool.query(
      `UPDATE checklists SET 
        auto_complete = COALESCE($1, auto_complete),
        frequency_days = COALESCE($2, frequency_days),
        auto_time = COALESCE($3, auto_time),
        auto_create_os = COALESCE($4, auto_create_os),
        auto_os_executor = COALESCE($5, auto_os_executor),
        auto_os_title = COALESCE($6, auto_os_title)
       WHERE id = $7 AND key_id = $8`,
      [auto_complete, frequency_days, auto_time, auto_create_os, auto_os_executor, auto_os_title, req.params.id, req.user.keyId]
    );
    
    // Se ativou automação, calcular próxima execução
    if (auto_complete) {
      const freqDays = frequency_days || 2; // Padrão dia sim dia não
      const nextRun = new Date();
      nextRun.setDate(nextRun.getDate() + freqDays);
      
      await pool.query(
        `UPDATE checklists SET last_auto_run = NOW() WHERE id = $1`,
        [req.params.id]
      );
    }
    
    // Retornar lista atualizada
    const checklists = await pool.query(
      `SELECT c.*, u.name as created_by_name,
        COALESCE(json_agg(json_build_object('id', ci.id, 'description', ci.description, 'item_order', ci.item_order) ORDER BY ci.item_order) FILTER (WHERE ci.id IS NOT NULL), '[]'::json) as items
       FROM checklists c
       LEFT JOIN users u ON u.id = c.created_by
       LEFT JOIN checklist_items ci ON ci.checklist_id = c.id
       WHERE c.key_id = $1
       GROUP BY c.id, u.name
       ORDER BY c.name`,
      [req.user.keyId]
    );
    
    return res.json({ ok: true, checklists: checklists.rows });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// GET - Estatísticas do dashboard de checklists
app.get('/checklists/dashboard-stats', requireAuth, async (req, res) => {
  try {
    const keyId = req.user.keyId;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Total de execuções hoje
    const todayExecs = await pool.query(
      `SELECT ce.*, c.auto_complete, c.name as checklist_name
       FROM checklist_executions ce
       JOIN checklists c ON c.id = ce.checklist_id
       WHERE ce.key_id = $1 AND ce.executed_at >= $2
       ORDER BY ce.executed_at DESC`,
      [keyId, today]
    );
    
    // Contar automáticas vs manuais
    const todayAuto = todayExecs.rows.filter(e => e.notes === 'Execução automática').length;
    const todayManual = todayExecs.rows.length - todayAuto;
    
    // Total de checklists pendentes hoje (não executados ainda)
    const allChecklists = await pool.query(
      `SELECT id, name FROM checklists WHERE key_id = $1`,
      [keyId]
    );
    const executedIds = new Set(todayExecs.rows.map(e => e.checklist_id));
    const pendingCount = allChecklists.rows.filter(c => !executedIds.has(c.id)).length;
    
    // Calcular streak (dias consecutivos com pelo menos uma execução)
    let streakDays = 0;
    let checkDate = new Date();
    checkDate.setHours(0, 0, 0, 0);
    
    // Se hoje já tem execução, conta hoje
    if (todayExecs.rows.length > 0) {
      streakDays = 1;
      checkDate.setDate(checkDate.getDate() - 1);
      
      // Verificar dias anteriores
      for (let i = 0; i < 365; i++) {
        const dayStart = new Date(checkDate);
        const dayEnd = new Date(checkDate);
        dayEnd.setDate(dayEnd.getDate() + 1);
        
        const dayExecs = await pool.query(
          `SELECT COUNT(*) FROM checklist_executions 
           WHERE key_id = $1 AND executed_at >= $2 AND executed_at < $3`,
          [keyId, dayStart, dayEnd]
        );
        
        if (parseInt(dayExecs.rows[0].count) > 0) {
          streakDays++;
          checkDate.setDate(checkDate.getDate() - 1);
        } else {
          break; // Streak quebrado
        }
      }
    }
    
    // Pegar as 5 execuções mais recentes para a timeline
    const recentExecs = todayExecs.rows.slice(0, 5).map(e => ({
      checklist_name: e.checklist_name,
      executed_at: e.executed_at,
      is_auto: e.notes === 'Execução automática'
    }));
    
    return res.json({
      ok: true,
      today_total: todayExecs.rows.length,
      today_auto: todayAuto,
      today_manual: todayManual,
      pending: pendingCount,
      streak_days: streakDays,
      recent_executions: recentExecs
    });
  } catch (err) {
    console.error('Erro ao buscar stats de checklist:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// POST - Executar automação de checklist manualmente (marcar como feito sem precisar marcar cada item)
app.post('/checklists/:id/auto-execute', requireAuth, async (req, res) => {
  try {
    // Buscar checklist e seus itens
    const checklist = await pool.query(
      `SELECT c.*, 
        COALESCE(json_agg(json_build_object('id', ci.id, 'description', ci.description) ORDER BY ci.item_order) FILTER (WHERE ci.id IS NOT NULL), '[]'::json) as items
       FROM checklists c
       LEFT JOIN checklist_items ci ON ci.checklist_id = c.id
       WHERE c.id = $1 AND c.key_id = $2
       GROUP BY c.id`,
      [req.params.id, req.user.keyId]
    );
    
    if (checklist.rowCount === 0) {
      return res.status(404).json({ ok: false, error: 'Checklist não encontrado' });
    }
    
    const cl = checklist.rows[0];
    const items = cl.items || [];
    
    // Criar execução automática com todos os itens marcados
    const execId = uuid();
    await pool.query(
      `INSERT INTO checklist_executions (id, checklist_id, executed_by, notes, key_id)
       VALUES ($1,$2,$3,$4,$5)`,
      [execId, req.params.id, req.user.userId, 'Execução automática', req.user.keyId]
    );
    
    // Marcar todos os itens como checked
    for (const item of items) {
      await pool.query(
        `INSERT INTO checklist_execution_items (execution_id, item_id, checked, checked_at, notes)
         VALUES ($1,$2,$3,$4,$5)`,
        [execId, item.id, true, new Date(), 'Auto']
      );
    }
    
    // Atualizar última execução automática
    await pool.query(
      `UPDATE checklists SET last_auto_run = NOW() WHERE id = $1`,
      [req.params.id]
    );
    
    return res.status(201).json({ ok: true, execution_id: execId, message: 'Checklist marcado como executado' });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/config/verify-whatsapp', requireAuth, async (req, res) => {
  const { phone } = req.body || {};
  const digits = (phone || '').replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 13) return res.status(400).json({ ok: false, error: 'Telefone inválido' });
  return res.json({ ok: true, phone: digits });
});

// ========== CONTROLE DE ÁGUA ==========

// GET - Listar leituras de água (com filtros opcionais)
app.get('/water-readings', requireAuth, async (req, res) => {
  try {
    const { tank, start_date, end_date } = req.query;
    
    let query = `
      SELECT wr.*, u.name as recorded_by_name 
      FROM water_readings wr 
      LEFT JOIN users u ON u.id = wr.recorded_by 
      WHERE wr.key_id = $1
    `;
    const params = [req.user.keyId];
    let paramCount = 2;
    
    if (tank) {
      query += ` AND wr.tank_name = $${paramCount++}`;
      params.push(tank);
    }
    
    if (start_date) {
      query += ` AND wr.reading_date >= $${paramCount++}`;
      params.push(start_date);
    }
    
    if (end_date) {
      query += ` AND wr.reading_date <= $${paramCount++}`;
      params.push(end_date);
    }
    
    query += ' ORDER BY wr.reading_date DESC, wr.reading_time DESC';
    
    const result = await pool.query(query, params);
    
    // Converter valores numéricos
    const readings = result.rows.map(r => ({
      ...r,
      reading_value: Number(r.reading_value),
      temperature: r.temperature !== null ? Number(r.temperature) : null
    }));
    
    return res.json({ ok: true, readings });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// POST - Adicionar nova leitura de água
app.post('/water-readings', requireAuth, async (req, res) => {
  const { tank_name, reading_value, reading_time, reading_date, temperature, notes } = req.body || {};
  
  if (!tank_name || reading_value === undefined || !reading_time || !reading_date) {
    return res.status(400).json({ ok: false, error: 'Campos obrigatórios: tank_name, reading_value, reading_time, reading_date' });
  }
  
  // Validar tank_name
  const validTanks = ['aviarios', 'recria'];
  if (!validTanks.includes(tank_name.toLowerCase())) {
    return res.status(400).json({ ok: false, error: 'Tank inválido. Use: aviarios ou recria' });
  }
  
  // Validar reading_time
  const validTimes = ['07:00', '16:00'];
  if (!validTimes.includes(reading_time)) {
    return res.status(400).json({ ok: false, error: 'Horário inválido. Use: 07:00 ou 16:00' });
  }
  
  try {
    // Verificar se já existe leitura para este tanque/data/horário
    const existing = await pool.query(
      'SELECT id FROM water_readings WHERE tank_name = $1 AND reading_date = $2 AND reading_time = $3 AND key_id = $4',
      [tank_name.toLowerCase(), reading_date, reading_time, req.user.keyId]
    );
    
    if (existing.rowCount > 0) {
      // Atualizar leitura existente
      await pool.query(
        'UPDATE water_readings SET reading_value = $1, temperature = $2, notes = $3, recorded_by = $4 WHERE id = $5',
        [reading_value, temperature || null, notes || null, req.user.userId, existing.rows[0].id]
      );
    } else {
      // Inserir nova leitura
      const id = uuid();
      await pool.query(
        `INSERT INTO water_readings (id, tank_name, reading_value, reading_time, reading_date, temperature, notes, recorded_by, key_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [id, tank_name.toLowerCase(), reading_value, reading_time, reading_date, temperature || null, notes || null, req.user.userId, req.user.keyId]
      );
    }
    
    // Retornar todas as leituras
    const result = await pool.query(
      `SELECT wr.*, u.name as recorded_by_name 
       FROM water_readings wr 
       LEFT JOIN users u ON u.id = wr.recorded_by 
       WHERE wr.key_id = $1 
       ORDER BY wr.reading_date DESC, wr.reading_time DESC`,
      [req.user.keyId]
    );
    
    const readings = result.rows.map(r => ({
      ...r,
      reading_value: Number(r.reading_value),
      temperature: r.temperature !== null ? Number(r.temperature) : null
    }));
    
    return res.status(201).json({ ok: true, readings });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// GET - Estatísticas de consumo de água
app.get('/water-readings/stats', requireAuth, async (req, res) => {
  try {
    const { period = 'week' } = req.query;
    
    let dateFilter;
    switch (period) {
      case 'day':
        dateFilter = "reading_date = CURRENT_DATE";
        break;
      case 'week':
        dateFilter = "reading_date >= CURRENT_DATE - INTERVAL '7 days'";
        break;
      case 'month':
        dateFilter = "reading_date >= CURRENT_DATE - INTERVAL '30 days'";
        break;
      default:
        dateFilter = "reading_date >= CURRENT_DATE - INTERVAL '7 days'";
    }
    
    // Buscar leituras do período
    const result = await pool.query(
      `SELECT tank_name, reading_value, reading_time, reading_date 
       FROM water_readings 
       WHERE key_id = $1 AND ${dateFilter}
       ORDER BY reading_date ASC, reading_time ASC`,
      [req.user.keyId]
    );
    
    const readings = result.rows.map(r => ({
      ...r,
      reading_value: Number(r.reading_value)
    }));
    
    // Calcular consumos por tanque
    const stats = {
      aviarios: { readings: [], daily_consumption: [], total_consumption: 0 },
      recria: { readings: [], daily_consumption: [], total_consumption: 0 }
    };
    
    readings.forEach(r => {
      if (stats[r.tank_name]) {
        stats[r.tank_name].readings.push(r);
      }
    });
    
    // Calcular consumo diário para cada tanque
    ['aviarios', 'recria'].forEach(tank => {
      const tankReadings = stats[tank].readings;
      
      // Agrupar por data
      const byDate = {};
      tankReadings.forEach(r => {
        const date = r.reading_date.toISOString().split('T')[0];
        if (!byDate[date]) byDate[date] = {};
        byDate[date][r.reading_time] = r.reading_value;
      });
      
      // Calcular consumo diário (7h dia X+1 - 7h dia X = consumo 24h)
      // Hidrômetro aumenta, então consumo = leitura nova - leitura antiga
      const dates = Object.keys(byDate).sort();
      let totalConsumption = 0;
      
      for (let i = 0; i < dates.length - 1; i++) {
        const currentDate = dates[i];
        const nextDate = dates[i + 1];
        
        const morning7h = byDate[currentDate]['07:00'];
        const nextMorning7h = byDate[nextDate] ? byDate[nextDate]['07:00'] : null;
        
        if (morning7h !== undefined && nextMorning7h !== undefined) {
          const consumption = nextMorning7h - morning7h;
          if (consumption >= 0) {
            stats[tank].daily_consumption.push({
              date: nextDate,
              consumption: consumption
            });
            totalConsumption += consumption;
          }
        }
      }
      
      stats[tank].total_consumption = totalConsumption;
      
      // Calcular médias
      const consumptions = stats[tank].daily_consumption;
      stats[tank].avg_daily = consumptions.length > 0 
        ? consumptions.reduce((a, b) => a + b.consumption, 0) / consumptions.length 
        : 0;
      stats[tank].avg_hourly = stats[tank].avg_daily / 24;
    });
    
    return res.json({ ok: true, stats, period });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE - Remover leitura (admin ou manutenção)
app.delete('/water-readings/:id', requireAuth, async (req, res) => {
  // Verificar permissão
  const userRoles = req.user.roles || [];
  if (!userRoles.includes('admin') && !userRoles.includes('os_manage_all')) {
    return res.status(403).json({ ok: false, error: 'Sem permissão para excluir leituras' });
  }
  
  try {
    await pool.query('DELETE FROM water_readings WHERE id = $1 AND key_id = $2', [req.params.id, req.user.keyId]);
    
    const result = await pool.query(
      `SELECT wr.*, u.name as recorded_by_name 
       FROM water_readings wr 
       LEFT JOIN users u ON u.id = wr.recorded_by 
       WHERE wr.key_id = $1 
       ORDER BY wr.reading_date DESC, wr.reading_time DESC`,
      [req.user.keyId]
    );
    
    const readings = result.rows.map(r => ({
      ...r,
      reading_value: Number(r.reading_value)
    }));
    
    return res.json({ ok: true, readings });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ========== CONTROLE DE DIESEL ==========

// GET - Listar registros de diesel (com filtros opcionais por período)
app.get('/diesel-records', requireAuth, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    let query = `
      SELECT dr.*, u.name as recorded_by_name 
      FROM diesel_records dr 
      LEFT JOIN users u ON u.id = dr.recorded_by 
      WHERE dr.key_id = $1
    `;
    const params = [req.user.keyId];
    let paramCount = 2;
    
    if (startDate) {
      query += ` AND dr.record_date >= $${paramCount++}`;
      params.push(startDate);
    }
    
    if (endDate) {
      query += ` AND dr.record_date <= $${paramCount++}`;
      params.push(endDate);
    }
    
    query += ' ORDER BY dr.record_date DESC, dr.created_at DESC';
    
    const result = await pool.query(query, params);
    
    // Converter valores numéricos
    const records = result.rows.map(r => ({
      ...r,
      quantity: Number(r.quantity)
    }));
    
    return res.json({ ok: true, records });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// GET - Estatísticas de diesel (total entrada, total saída, saldo atual)
app.get('/diesel-records/stats', requireAuth, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    let dateFilter = '';
    const params = [req.user.keyId];
    let paramCount = 2;
    
    if (startDate) {
      dateFilter += ` AND record_date >= $${paramCount++}`;
      params.push(startDate);
    }
    
    if (endDate) {
      dateFilter += ` AND record_date <= $${paramCount++}`;
      params.push(endDate);
    }
    
    // Total de entradas no período
    const entradasResult = await pool.query(
      `SELECT COALESCE(SUM(quantity), 0) as total 
       FROM diesel_records 
       WHERE key_id = $1 AND record_type = 'entrada' ${dateFilter}`,
      params
    );
    
    // Total de saídas no período
    const saidasResult = await pool.query(
      `SELECT COALESCE(SUM(quantity), 0) as total 
       FROM diesel_records 
       WHERE key_id = $1 AND record_type = 'saida' ${dateFilter}`,
      params
    );
    
    // Saldo atual (histórico completo - sem filtro de data)
    const saldoResult = await pool.query(
      `SELECT 
        COALESCE(SUM(CASE WHEN record_type = 'entrada' THEN quantity ELSE 0 END), 0) as total_entradas,
        COALESCE(SUM(CASE WHEN record_type = 'saida' THEN quantity ELSE 0 END), 0) as total_saidas
       FROM diesel_records 
       WHERE key_id = $1`,
      [req.user.keyId]
    );
    
    const totalEntradas = Number(entradasResult.rows[0].total);
    const totalSaidas = Number(saidasResult.rows[0].total);
    const saldoEntradas = Number(saldoResult.rows[0].total_entradas);
    const saldoSaidas = Number(saldoResult.rows[0].total_saidas);
    const saldoAtual = saldoEntradas - saldoSaidas;
    
    return res.json({ 
      ok: true, 
      stats: {
        total_entrada: totalEntradas,
        total_saida: totalSaidas,
        saldo_periodo: totalEntradas - totalSaidas,
        saldo_atual: saldoAtual
      }
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// POST - Adicionar registro de diesel
app.post('/diesel-records', requireAuth, async (req, res) => {
  const { record_type, quantity, reason, record_date, notes } = req.body || {};
  
  if (!record_type || quantity === undefined || !record_date) {
    return res.status(400).json({ ok: false, error: 'Campos obrigatórios: record_type, quantity, record_date' });
  }
  
  // Validar record_type
  const validTypes = ['entrada', 'saida'];
  if (!validTypes.includes(record_type)) {
    return res.status(400).json({ ok: false, error: 'Tipo inválido. Use: entrada ou saida' });
  }
  
  // Validar quantity
  if (quantity <= 0) {
    return res.status(400).json({ ok: false, error: 'Quantidade deve ser maior que zero' });
  }
  
  try {
    const id = uuid();
    await pool.query(
      `INSERT INTO diesel_records (id, record_type, quantity, reason, record_date, notes, recorded_by, key_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, record_type, quantity, reason || null, record_date, notes || null, req.user.userId, req.user.keyId]
    );
    
    // Notificar Joacir sobre novo registro de diesel
    if (pushNotifications) {
      const tipoText = record_type === 'entrada' ? 'Entrada' : 'Saída';
      pushNotifications.notifyJoacir(pool, 'diesel', `${tipoText}: ${quantity}L - ${reason || 'Sem motivo'}`);
    }
    
    // Retornar todos os registros
    const result = await pool.query(
      `SELECT dr.*, u.name as recorded_by_name 
       FROM diesel_records dr 
       LEFT JOIN users u ON u.id = dr.recorded_by 
       WHERE dr.key_id = $1 
       ORDER BY dr.record_date DESC, dr.created_at DESC`,
      [req.user.keyId]
    );
    
    const records = result.rows.map(r => ({
      ...r,
      quantity: Number(r.quantity)
    }));
    
    return res.status(201).json({ ok: true, records });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE - Remover registro de diesel (admin ou diesel role)
app.delete('/diesel-records/:id', requireAuth, async (req, res) => {
  // Verificar permissão
  const userRoles = req.user.roles || [];
  if (!userRoles.includes('admin') && !userRoles.includes('os_manage_all') && !userRoles.includes('diesel')) {
    return res.status(403).json({ ok: false, error: 'Sem permissão para excluir registros de diesel' });
  }
  
  try {
    await pool.query('DELETE FROM diesel_records WHERE id = $1 AND key_id = $2', [req.params.id, req.user.keyId]);
    
    const result = await pool.query(
      `SELECT dr.*, u.name as recorded_by_name 
       FROM diesel_records dr 
       LEFT JOIN users u ON u.id = dr.recorded_by 
       WHERE dr.key_id = $1 
       ORDER BY dr.record_date DESC, dr.created_at DESC`,
      [req.user.keyId]
    );
    
    const records = result.rows.map(r => ({
      ...r,
      quantity: Number(r.quantity)
    }));
    
    return res.json({ ok: true, records });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ========== CONTROLE DE GERADOR ==========

// GET - Listar registros do gerador (com filtros opcionais por período)
app.get('/generator-records', requireAuth, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    let query = `
      SELECT gr.*, u.name as recorded_by_name 
      FROM generator_records gr 
      LEFT JOIN users u ON u.id = gr.recorded_by 
      WHERE gr.key_id = $1
    `;
    const params = [req.user.keyId];
    let paramCount = 2;
    
    if (startDate) {
      query += ` AND gr.record_date >= $${paramCount++}`;
      params.push(startDate);
    }
    
    if (endDate) {
      query += ` AND gr.record_date <= $${paramCount++}`;
      params.push(endDate);
    }
    
    query += ' ORDER BY gr.record_date DESC, gr.created_at DESC';
    
    const result = await pool.query(query, params);
    
    // Converter valores numéricos
    const records = result.rows.map(r => ({
      ...r,
      fuel_used: r.fuel_used !== null ? Number(r.fuel_used) : null
    }));
    
    return res.json({ ok: true, records });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// GET - Estatísticas do gerador (total horas ligado, diesel consumido, média por hora)
app.get('/generator-records/stats', requireAuth, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    let dateFilter = '';
    const params = [req.user.keyId];
    let paramCount = 2;
    
    if (startDate) {
      dateFilter += ` AND record_date >= $${paramCount++}`;
      params.push(startDate);
    }
    
    if (endDate) {
      dateFilter += ` AND record_date <= $${paramCount++}`;
      params.push(endDate);
    }
    
    // Total de diesel consumido (registros de abastecimento)
    const dieselResult = await pool.query(
      `SELECT COALESCE(SUM(fuel_used), 0) as total 
       FROM generator_records 
       WHERE key_id = $1 AND fuel_used IS NOT NULL ${dateFilter}`,
      params
    );
    
    // Contar registros por tipo
    const countResult = await pool.query(
      `SELECT 
        record_type,
        COUNT(*) as count
       FROM generator_records 
       WHERE key_id = $1 ${dateFilter}
       GROUP BY record_type`,
      params
    );
    
    // Calcular horas ligado (diferença entre ligado e desligado)
    // Buscar todos os registros de ligado/desligado para calcular horas
    const horasResult = await pool.query(
      `SELECT record_type, start_time, record_date, created_at
       FROM generator_records 
       WHERE key_id = $1 AND record_type IN ('ligado', 'desligado') ${dateFilter}
       ORDER BY record_date ASC, created_at ASC`,
      params
    );
    
    let totalHoras = 0;
    let lastLigado = null;
    
    for (const record of horasResult.rows) {
      if (record.record_type === 'ligado') {
        lastLigado = {
          date: record.record_date,
          time: record.start_time,
          created: record.created_at
        };
      } else if (record.record_type === 'desligado' && lastLigado) {
        // Calcular diferença de tempo
        const ligadoDateTime = new Date(`${lastLigado.date.toISOString().split('T')[0]}T${lastLigado.time || '00:00'}:00`);
        const desligadoDateTime = new Date(`${record.record_date.toISOString().split('T')[0]}T${record.start_time || '00:00'}:00`);
        
        const diffMs = desligadoDateTime - ligadoDateTime;
        const diffHoras = diffMs / (1000 * 60 * 60);
        
        if (diffHoras >= 0 && diffHoras < 720) { // Máximo 30 dias
          totalHoras += diffHoras;
        }
        
        lastLigado = null;
      }
    }
    
    const totalDiesel = Number(dieselResult.rows[0].total);
    const mediaHora = totalHoras > 0 ? totalDiesel / totalHoras : 0;
    
    // Montar contagem por tipo
    const countByType = {};
    countResult.rows.forEach(r => {
      countByType[r.record_type] = Number(r.count);
    });
    
    return res.json({ 
      ok: true, 
      stats: {
        total_horas_ligado: Math.round(totalHoras * 100) / 100,
        total_diesel_consumido: totalDiesel,
        media_diesel_por_hora: Math.round(mediaHora * 100) / 100,
        registros_por_tipo: countByType
      }
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// POST - Adicionar registro do gerador
app.post('/generator-records', requireAuth, async (req, res) => {
  const { record_type, start_time, fuel_used, record_date, notes } = req.body || {};
  
  if (!record_type || !record_date) {
    return res.status(400).json({ ok: false, error: 'Campos obrigatórios: record_type, record_date' });
  }
  
  // Validar record_type
  const validTypes = ['ligado', 'desligado', 'abastecimento', 'manutencao'];
  if (!validTypes.includes(record_type)) {
    return res.status(400).json({ ok: false, error: 'Tipo inválido. Use: ligado, desligado, abastecimento ou manutencao' });
  }
  
  // Validar fuel_used para abastecimento
  if (record_type === 'abastecimento' && (fuel_used === undefined || fuel_used <= 0)) {
    return res.status(400).json({ ok: false, error: 'Quantidade de diesel é obrigatória para abastecimento' });
  }
  
  try {
    const id = uuid();
    await pool.query(
      `INSERT INTO generator_records (id, record_type, start_time, fuel_used, notes, record_date, recorded_by, key_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, record_type, start_time || null, fuel_used || null, notes || null, record_date, req.user.userId, req.user.keyId]
    );
    
    // Retornar todos os registros
    const result = await pool.query(
      `SELECT gr.*, u.name as recorded_by_name 
       FROM generator_records gr 
       LEFT JOIN users u ON u.id = gr.recorded_by 
       WHERE gr.key_id = $1 
       ORDER BY gr.record_date DESC, gr.created_at DESC`,
      [req.user.keyId]
    );
    
    const records = result.rows.map(r => ({
      ...r,
      fuel_used: r.fuel_used !== null ? Number(r.fuel_used) : null
    }));
    
    return res.status(201).json({ ok: true, records });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// NOTA: DELETE de generator NÃO é permitido - dados nunca são apagados

// ========== TAREFAS ADITIVAS ==========

// GET - Listar tarefas aditivas (ativas e arquivadas separadamente)
app.get('/additive-tasks', requireAuth, async (req, res) => {
  try {
    const { archived } = req.query;
    
    let query = `
      SELECT at.*, 
             u1.name as created_by_name,
             u2.name as executed_by_name
      FROM additive_tasks at 
      LEFT JOIN users u1 ON u1.id = at.created_by 
      LEFT JOIN users u2 ON u2.id = at.executed_by 
      WHERE at.key_id = $1
    `;
    
    if (archived === 'true') {
      query += ' AND at.archived_at IS NOT NULL';
    } else {
      query += ' AND at.archived_at IS NULL';
    }
    
    query += ' ORDER BY at.created_at DESC';
    
    const result = await pool.query(query, [req.user.keyId]);
    return res.json({ ok: true, tasks: result.rows });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// GET - Estatísticas de aditivas para dashboard
app.get('/additive-tasks/stats', requireAuth, async (req, res) => {
  try {
    // Total pendentes
    const pendingResult = await pool.query(
      `SELECT COUNT(*) as total FROM additive_tasks 
       WHERE key_id = $1 AND status = 'pending' AND archived_at IS NULL`,
      [req.user.keyId]
    );
    
    // Total em andamento
    const progressResult = await pool.query(
      `SELECT COUNT(*) as total FROM additive_tasks 
       WHERE key_id = $1 AND status = 'in_progress' AND archived_at IS NULL`,
      [req.user.keyId]
    );
    
    // Total concluídas (últimos 30 dias)
    const completedResult = await pool.query(
      `SELECT COUNT(*) as total FROM additive_tasks 
       WHERE key_id = $1 AND status = 'completed' AND executed_at > NOW() - INTERVAL '30 days'`,
      [req.user.keyId]
    );
    
    return res.json({ 
      ok: true, 
      stats: {
        pending: parseInt(pendingResult.rows[0].total),
        in_progress: parseInt(progressResult.rows[0].total),
        completed_month: parseInt(completedResult.rows[0].total)
      }
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// POST - Criar tarefa aditiva (só manutenção)
app.post('/additive-tasks', requireAuth, requireRoles(['aditiva']), async (req, res) => {
  try {
    const { title, description, sector, priority, notes } = req.body || {};
    
    if (!title) {
      return res.status(400).json({ ok: false, error: 'Título é obrigatório' });
    }
    
    const id = uuid();
    await pool.query(
      `INSERT INTO additive_tasks (id, title, description, sector, priority, notes, created_by, key_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, title, description || null, sector || null, priority || 'medium', notes || null, req.user.userId, req.user.keyId]
    );
    
    const result = await pool.query(
      `SELECT at.*, u1.name as created_by_name, u2.name as executed_by_name
       FROM additive_tasks at 
       LEFT JOIN users u1 ON u1.id = at.created_by 
       LEFT JOIN users u2 ON u2.id = at.executed_by 
       WHERE at.key_id = $1 AND at.archived_at IS NULL
       ORDER BY at.created_at DESC`,
      [req.user.keyId]
    );
    
    return res.status(201).json({ ok: true, tasks: result.rows });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// PUT - Atualizar tarefa aditiva (status, executar, etc)
app.put('/additive-tasks/:id', requireAuth, requireRoles(['aditiva']), async (req, res) => {
  try {
    const { title, description, sector, priority, status, notes, executed_by_id } = req.body || {};
    const taskId = req.params.id;
    
    // Verificar se existe
    const existing = await pool.query(
      'SELECT * FROM additive_tasks WHERE id = $1 AND key_id = $2',
      [taskId, req.user.keyId]
    );
    
    if (existing.rowCount === 0) {
      return res.status(404).json({ ok: false, error: 'Tarefa não encontrada' });
    }
    
    // Se está marcando como concluída
    let executedAt = existing.rows[0].executed_at;
    let executedBy = existing.rows[0].executed_by;
    
    // Se forneceu executed_by_id, usar ele
    if (executed_by_id) {
      executedBy = executed_by_id;
    }
    
    if (status === 'completed' && existing.rows[0].status !== 'completed') {
      executedAt = new Date();
      // Se não foi especificado quem executou, usar o usuário atual
      if (!executedBy) {
        executedBy = req.user.userId;
      }
    }
    
    await pool.query(
      `UPDATE additive_tasks SET 
         title = COALESCE($1, title),
         description = COALESCE($2, description),
         sector = COALESCE($3, sector),
         priority = COALESCE($4, priority),
         status = COALESCE($5, status),
         notes = COALESCE($6, notes),
         executed_at = $7,
         executed_by = $8
       WHERE id = $9 AND key_id = $10`,
      [title, description, sector, priority, status, notes, executedAt, executedBy, taskId, req.user.keyId]
    );
    
    const result = await pool.query(
      `SELECT at.*, u1.name as created_by_name, u2.name as executed_by_name
       FROM additive_tasks at 
       LEFT JOIN users u1 ON u1.id = at.created_by 
       LEFT JOIN users u2 ON u2.id = at.executed_by 
       WHERE at.key_id = $1 AND at.archived_at IS NULL
       ORDER BY at.created_at DESC`,
      [req.user.keyId]
    );
    
    return res.json({ ok: true, tasks: result.rows });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE - Só pode excluir se estiver arquivada (nunca remove do banco, apenas marca)
// Na verdade, aditivas concluídas vão para arquivo após 2 meses automaticamente
// Não há exclusão manual

// =============================================
// PUSH NOTIFICATIONS ENDPOINTS
// =============================================

// Registrar token de push notification
app.post('/api/push-tokens', requireAuth, async (req, res) => {
  try {
    const { token, device_type = 'android' } = req.body;
    
    if (!token) {
      return res.status(400).json({ ok: false, error: 'Token é obrigatório' });
    }

    // Upsert - atualiza se existir, insere se não
    await pool.query(`
      INSERT INTO push_tokens (id, user_id, token, device_type, key_id, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (token) DO UPDATE SET
        user_id = $2,
        active = true,
        updated_at = NOW()
    `, [uuid(), req.user.userId, token, device_type, req.user.keyId]);

    return res.json({ ok: true, message: 'Token registrado com sucesso' });
  } catch (err) {
    console.error('Erro ao registrar push token:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// Desativar token (logout)
app.delete('/api/push-tokens', requireAuth, async (req, res) => {
  try {
    const { token } = req.body;
    
    if (token) {
      await pool.query('UPDATE push_tokens SET active = false WHERE token = $1', [token]);
    } else {
      // Desativar todos os tokens do usuário
      await pool.query('UPDATE push_tokens SET active = false WHERE user_id = $1', [req.user.userId]);
    }

    return res.json({ ok: true, message: 'Token desativado' });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// Endpoint de teste - enviar notificação para si mesmo
app.post('/api/push-test', requireAuth, async (req, res) => {
  try {
    if (!pushNotifications) {
      return res.status(503).json({ ok: false, error: 'Push notifications não configurado' });
    }

    const result = await pool.query(
      'SELECT token FROM push_tokens WHERE user_id = $1 AND active = true',
      [req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Nenhum dispositivo registrado' });
    }

    const tokens = result.rows.map(r => r.token);
    await pushNotifications.sendToMultipleDevices(
      tokens,
      '🧪 Teste de Notificação',
      'Se você recebeu isso, as notificações estão funcionando!',
      { type: 'test' }
    );

    return res.json({ ok: true, message: 'Notificação de teste enviada' });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ========================================
// RELATÓRIOS DA MANUTENÇÃO (maintenance_reports)
// ========================================

// GET - Listar relatórios (filtra por visibilidade)
app.get('/maintenance-reports', requireAuth, async (req, res) => {
  try {
    const { category } = req.query;
    const isAdmin = req.user.roles && (req.user.roles.includes('admin') || req.user.roles.includes('os_manage_all'));
    
    let query = `
      SELECT r.*, u.name as created_by_name, u.username as created_by_username
      FROM maintenance_reports r
      LEFT JOIN users u ON r.created_by = u.id
      WHERE r.key_id = $1
        AND (r.visibility = 'public' OR r.created_by = $2 ${isAdmin ? "OR TRUE" : ""})
    `;
    const params = [req.user.keyId, req.user.userId];
    
    if (category && category !== 'all') {
      query += ` AND r.category = $${params.length + 1}`;
      params.push(category);
    }
    
    query += ` ORDER BY r.created_at DESC LIMIT 100`;
    
    const result = await pool.query(query, params);
    return res.json({ ok: true, reports: result.rows });
  } catch (err) {
    console.error('Erro ao listar relatórios:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// GET - Buscar relatório específico
app.get('/maintenance-reports/:id', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.*, u.name as created_by_name, u.username as created_by_username
       FROM maintenance_reports r
       LEFT JOIN users u ON r.created_by = u.id
       WHERE r.id = $1 AND r.key_id = $2`,
      [req.params.id, req.user.keyId]
    );
    
    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, error: 'Relatório não encontrado' });
    }
    
    const report = result.rows[0];
    // Verificar permissão de visualização
    if (report.visibility === 'private' && report.created_by !== req.user.userId) {
      const isAdmin = req.user.roles && (req.user.roles.includes('admin') || req.user.roles.includes('os_manage_all'));
      if (!isAdmin) {
        return res.status(403).json({ ok: false, error: 'Este relatório é privado' });
      }
    }
    
    return res.json({ ok: true, report: report });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// POST - Criar relatório com visibilidade e anexos
app.post('/maintenance-reports', requireAuth, requireRoles(['admin', 'relatorios_write', 'relatorios', 'os_manage_all']), async (req, res) => {
  try {
    const { title, content, category, visibility, attachments } = req.body;
    
    if (!title || !content) {
      return res.status(400).json({ ok: false, error: 'Título e conteúdo são obrigatórios' });
    }
    
    const id = uuid();
    const validVisibility = ['public', 'private'].includes(visibility) ? visibility : 'public';
    const validAttachments = Array.isArray(attachments) ? JSON.stringify(attachments) : '[]';
    
    await pool.query(
      `INSERT INTO maintenance_reports (id, title, content, category, visibility, attachments, created_by, key_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, sanitizeString(title, 200), sanitizeString(content, 10000), category || 'geral', validVisibility, validAttachments, req.user.userId, req.user.keyId]
    );
    
    // Retornar lista atualizada
    const isAdmin = req.user.roles && (req.user.roles.includes('admin') || req.user.roles.includes('os_manage_all'));
    const result = await pool.query(
      `SELECT r.*, u.name as created_by_name
       FROM maintenance_reports r
       LEFT JOIN users u ON r.created_by = u.id
       WHERE r.key_id = $1
         AND (r.visibility = 'public' OR r.created_by = $2 ${isAdmin ? "OR TRUE" : ""})
       ORDER BY r.created_at DESC LIMIT 100`,
      [req.user.keyId, req.user.userId]
    );
    
    return res.status(201).json({ ok: true, reports: result.rows });
  } catch (err) {
    console.error('Erro ao criar relatório:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// PUT - Atualizar relatório
app.put('/maintenance-reports/:id', requireAuth, requireRoles(['admin', 'relatorios_write', 'relatorios', 'os_manage_all']), async (req, res) => {
  try {
    const { title, content, category, visibility, attachments } = req.body;
    
    // Verificar se é dono ou admin
    const check = await pool.query(
      'SELECT created_by FROM maintenance_reports WHERE id = $1 AND key_id = $2',
      [req.params.id, req.user.keyId]
    );
    
    if (check.rowCount === 0) {
      return res.status(404).json({ ok: false, error: 'Relatório não encontrado' });
    }
    
    const isAdmin = req.user.roles && (req.user.roles.includes('admin') || req.user.roles.includes('os_manage_all'));
    if (check.rows[0].created_by !== req.user.userId && !isAdmin) {
      return res.status(403).json({ ok: false, error: 'Sem permissão para editar este relatório' });
    }
    
    const validAttachments = Array.isArray(attachments) ? JSON.stringify(attachments) : undefined;
    
    await pool.query(
      `UPDATE maintenance_reports SET 
        title = COALESCE($1, title),
        content = COALESCE($2, content),
        category = COALESCE($3, category),
        visibility = COALESCE($4, visibility),
        attachments = COALESCE($5, attachments)
       WHERE id = $6 AND key_id = $7`,
      [title, content, category, visibility, validAttachments, req.params.id, req.user.keyId]
    );
    
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE - Excluir relatório (dono ou admin)
app.delete('/maintenance-reports/:id', requireAuth, requireRoles(['admin', 'relatorios_write', 'relatorios', 'os_manage_all']), async (req, res) => {
  try {
    // Verificar se é dono ou admin
    const check = await pool.query(
      'SELECT created_by FROM maintenance_reports WHERE id = $1 AND key_id = $2',
      [req.params.id, req.user.keyId]
    );
    
    if (check.rowCount === 0) {
      return res.status(404).json({ ok: false, error: 'Relatório não encontrado' });
    }
    
    const isAdmin = req.user.roles && (req.user.roles.includes('admin') || req.user.roles.includes('os_manage_all'));
    if (check.rows[0].created_by !== req.user.userId && !isAdmin) {
      return res.status(403).json({ ok: false, error: 'Sem permissão para excluir este relatório' });
    }
    
    await pool.query(
      'DELETE FROM maintenance_reports WHERE id = $1 AND key_id = $2',
      [req.params.id, req.user.keyId]
    );
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// GET - Gerar PDF bonito de relatório
app.get('/maintenance-reports/:id/pdf', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.*, u.name as created_by_name
       FROM maintenance_reports r
       LEFT JOIN users u ON r.created_by = u.id
       WHERE r.id = $1 AND r.key_id = $2`,
      [req.params.id, req.user.keyId]
    );
    
    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, error: 'Relatório não encontrado' });
    }
    
    const report = result.rows[0];
    
    // Criar PDF bonito
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="relatorio-${report.id}.pdf"`);
    doc.pipe(res);
    
    const magenta = '#ec4899';
    const pink = '#f472b6';
    
    // Header com gradiente rosa/magenta
    doc.rect(0, 0, 595.28, 140).fill('#1a0a14');
    doc.rect(0, 0, 8, 140).fill(magenta);
    
    // Orbs decorativos (simulados com círculos)
    doc.circle(500, 40, 80).fillOpacity(0.15).fill(magenta);
    doc.circle(450, 100, 50).fillOpacity(0.1).fill(pink);
    doc.fillOpacity(1);
    
    // Logo Icarus (ícone)
    doc.circle(70, 65, 28).lineWidth(2).strokeColor(magenta).stroke();
    doc.font('Helvetica-Bold').fontSize(16).fillColor(magenta).text('IC', 58, 56);
    
    // Título
    doc.font('Helvetica-Bold').fontSize(28).fillColor('#fff').text('ICARUS', 115, 40);
    doc.font('Helvetica').fontSize(11).fillColor('#f9a8d4').text('Central de Relatórios • Granja Vitta', 115, 72);
    
    // Badge categoria
    const catColors = {
      geral: magenta,
      manutencao: '#a855f7',
      incidente: '#ef4444',
      melhoria: '#22c55e',
      orcamento: '#f59e0b'
    };
    const catColor = catColors[report.category] || magenta;
    const catLabels = { geral: 'GERAL', manutencao: 'MANUTENÇÃO', incidente: 'INCIDENTE', melhoria: 'MELHORIA', orcamento: 'ORÇAMENTO' };
    
    doc.roundedRect(115, 95, 100, 22, 11).fill(catColor);
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#fff').text(catLabels[report.category] || 'GERAL', 125, 101);
    
    // Data
    const dateStr = report.created_at ? new Date(report.created_at).toLocaleDateString('pt-BR', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    }) : '';
    doc.font('Helvetica').fontSize(10).fillColor('#9ca3af').text(dateStr, 230, 100);
    
    doc.y = 160;
    
    // Título do relatório
    doc.font('Helvetica-Bold').fontSize(24).fillColor('#111').text(report.title, 50, doc.y, { width: 495 });
    doc.moveDown(0.8);
    
    // Autor
    doc.font('Helvetica').fontSize(11).fillColor('#6b7280').text(`Por: ${report.created_by_name || 'Anônimo'}`, 50);
    doc.moveDown(1.5);
    
    // Linha decorativa
    doc.moveTo(50, doc.y).lineTo(545, doc.y).lineWidth(1).strokeColor(magenta).stroke();
    doc.moveDown(1);
    
    // Conteúdo - processar e detectar valores/números
    const content = report.content || '';
    doc.font('Helvetica').fontSize(12).fillColor('#374151').text(content, 50, doc.y, {
      width: 495,
      align: 'justify',
      lineGap: 6
    });
    
    // Anexos se houver
    const attachments = report.attachments || [];
    if (attachments.length > 0) {
      doc.moveDown(2);
      doc.font('Helvetica-Bold').fontSize(14).fillColor(magenta).text('Anexos:', 50);
      doc.moveDown(0.5);
      attachments.forEach((att, i) => {
        doc.font('Helvetica').fontSize(11).fillColor('#3b82f6').text(`${i + 1}. ${att.name || att.url}`, 60);
      });
    }
    
    // Footer com propaganda Icarus
    const footerY = 760;
    doc.rect(0, footerY, 595.28, 80).fill('#1a0a14');
    doc.rect(0, footerY, 595.28, 2).fill(magenta);
    
    // Logo no footer
    doc.circle(70, footerY + 30, 18).lineWidth(1.5).strokeColor(magenta).stroke();
    doc.font('Helvetica-Bold').fontSize(11).fillColor(magenta).text('IC', 62, footerY + 24);
    
    // Info de contato
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#fff').text('ICARUS SYSTEM', 100, footerY + 15);
    doc.font('Helvetica').fontSize(9).fillColor('#f9a8d4').text('Gestão Inteligente de Manutenção', 100, footerY + 30);
    doc.font('Helvetica').fontSize(9).fillColor('#9ca3af').text('WhatsApp: (62) 98493-0056', 100, footerY + 42);
    doc.font('Helvetica').fontSize(9).fillColor('#60a5fa').text('icarussite.vercel.app', 100, footerY + 54);
    
    // QR Code placeholder (canto direito)
    doc.roundedRect(480, footerY + 10, 60, 60, 6).lineWidth(1).strokeColor('rgba(236,72,153,0.3)').stroke();
    doc.font('Helvetica').fontSize(7).fillColor('#6b7280').text('Acesse', 495, footerY + 32);
    doc.font('Helvetica').fontSize(7).fillColor('#6b7280').text('o sistema', 493, footerY + 40);
    
    doc.end();
    
  } catch (err) {
    console.error('Erro ao gerar PDF:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ========================================
// MÓDULO LAVANDERIA - API Routes
// ========================================

// Listar clientes da lavanderia
app.get('/laundry/clients', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM laundry_clients WHERE key_id = $1 ORDER BY name',
      [req.user.keyId]
    );
    res.json({ ok: true, clients: result.rows });
  } catch (error) {
    console.error('Erro ao listar clientes:', error);
    res.status(500).json({ ok: false, error: 'Erro ao listar clientes' });
  }
});

// Criar cliente da lavanderia
app.post('/laundry/clients', requireAuth, requireRoles(['admin', 'lavanderia']), async (req, res) => {
  try {
    const { name, price_per_piece, color } = req.body;
    const id = crypto.randomUUID();
    await pool.query(
      'INSERT INTO laundry_clients (id, name, price_per_piece, color, key_id) VALUES ($1, $2, $3, $4, $5)',
      [id, name, price_per_piece || 3.00, color || '#ec4899', req.user.keyId]
    );
    const result = await pool.query('SELECT * FROM laundry_clients WHERE key_id = $1 ORDER BY name', [req.user.keyId]);
    res.json({ ok: true, clients: result.rows });
  } catch (error) {
    console.error('Erro ao criar cliente:', error);
    res.status(500).json({ ok: false, error: 'Erro ao criar cliente' });
  }
});

// Atualizar cliente
app.patch('/laundry/clients/:id', requireAuth, requireRoles(['admin', 'lavanderia']), async (req, res) => {
  try {
    const { name, price_per_piece, color, active } = req.body;
    await pool.query(
      `UPDATE laundry_clients SET 
        name = COALESCE($1, name),
        price_per_piece = COALESCE($2, price_per_piece),
        color = COALESCE($3, color),
        active = COALESCE($4, active)
       WHERE id = $5 AND key_id = $6`,
      [name, price_per_piece, color, active, req.params.id, req.user.keyId]
    );
    const result = await pool.query('SELECT * FROM laundry_clients WHERE key_id = $1 ORDER BY name', [req.user.keyId]);
    res.json({ ok: true, clients: result.rows });
  } catch (error) {
    console.error('Erro ao atualizar cliente:', error);
    res.status(500).json({ ok: false, error: 'Erro ao atualizar cliente' });
  }
});

// Listar categorias de roupa
app.get('/laundry/categories', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM laundry_categories WHERE key_id = $1 ORDER BY name',
      [req.user.keyId]
    );
    res.json({ ok: true, categories: result.rows });
  } catch (error) {
    console.error('Erro ao listar categorias:', error);
    res.status(500).json({ ok: false, error: 'Erro ao listar categorias' });
  }
});

// Criar categoria de roupa
app.post('/laundry/categories', requireAuth, requireRoles(['admin', 'lavanderia']), async (req, res) => {
  try {
    const { name, icon } = req.body;
    const id = crypto.randomUUID();
    await pool.query(
      'INSERT INTO laundry_categories (id, name, icon, key_id) VALUES ($1, $2, $3, $4)',
      [id, name, icon || '👕', req.user.keyId]
    );
    const result = await pool.query('SELECT * FROM laundry_categories WHERE key_id = $1 ORDER BY name', [req.user.keyId]);
    res.json({ ok: true, categories: result.rows });
  } catch (error) {
    console.error('Erro ao criar categoria:', error);
    res.status(500).json({ ok: false, error: 'Erro ao criar categoria' });
  }
});

// Listar lançamentos de lavanderia (com filtro de data)
app.get('/laundry/entries', requireAuth, async (req, res) => {
  try {
    const { start_date, end_date, client_id } = req.query;
    let query = `
      SELECT e.*, c.name as client_name, c.color as client_color, cat.name as category_name, cat.icon as category_icon
      FROM laundry_entries e
      JOIN laundry_clients c ON c.id = e.client_id
      LEFT JOIN laundry_categories cat ON cat.id = e.category_id
      WHERE e.key_id = $1
    `;
    const params = [req.user.keyId];
    let paramIdx = 2;

    if (start_date) {
      query += ` AND e.entry_date >= $${paramIdx++}`;
      params.push(start_date);
    }
    if (end_date) {
      query += ` AND e.entry_date <= $${paramIdx++}`;
      params.push(end_date);
    }
    if (client_id) {
      query += ` AND e.client_id = $${paramIdx++}`;
      params.push(client_id);
    }

    query += ' ORDER BY e.entry_date DESC, e.created_at DESC';
    
    const result = await pool.query(query, params);
    res.json({ ok: true, entries: result.rows });
  } catch (error) {
    console.error('Erro ao listar lançamentos:', error);
    res.status(500).json({ ok: false, error: 'Erro ao listar lançamentos' });
  }
});

// Criar lançamento de lavanderia
app.post('/laundry/entries', requireAuth, requireRoles(['admin', 'lavanderia']), async (req, res) => {
  try {
    const { client_id, category_id, quantity, entry_date, notes } = req.body;
    
    // Buscar preço do cliente (verificando key_id para isolamento de tenant)
    const clientResult = await pool.query('SELECT price_per_piece FROM laundry_clients WHERE id = $1 AND key_id = $2', [client_id, req.user.keyId]);
    if (clientResult.rowCount === 0) {
      return res.status(404).json({ ok: false, error: 'Cliente não encontrado' });
    }
    
    const unit_price = clientResult.rows[0].price_per_piece;
    const total_value = quantity * unit_price;
    const id = crypto.randomUUID();
    
    await pool.query(
      `INSERT INTO laundry_entries (id, client_id, category_id, quantity, unit_price, total_value, entry_date, recorded_by, notes, key_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [id, client_id, category_id || null, quantity, unit_price, total_value, entry_date, req.user.userId, notes || null, req.user.keyId]
    );
    
    // Retornar lançamentos do dia
    const result = await pool.query(
      `SELECT e.*, c.name as client_name, c.color as client_color, cat.name as category_name, cat.icon as category_icon
       FROM laundry_entries e
       JOIN laundry_clients c ON c.id = e.client_id
       LEFT JOIN laundry_categories cat ON cat.id = e.category_id
       WHERE e.key_id = $1 AND e.entry_date = $2
       ORDER BY e.created_at DESC`,
      [req.user.keyId, entry_date]
    );
    res.json({ ok: true, entries: result.rows });
  } catch (error) {
    console.error('Erro ao criar lançamento:', error);
    res.status(500).json({ ok: false, error: 'Erro ao criar lançamento' });
  }
});

// Deletar lançamento
app.delete('/laundry/entries/:id', requireAuth, requireRoles(['admin', 'lavanderia']), async (req, res) => {
  try {
    await pool.query('DELETE FROM laundry_entries WHERE id = $1 AND key_id = $2', [req.params.id, req.user.keyId]);
    res.json({ ok: true });
  } catch (error) {
    console.error('Erro ao deletar lançamento:', error);
    res.status(500).json({ ok: false, error: 'Erro ao deletar lançamento' });
  }
});

// Estatísticas da lavanderia
app.get('/laundry/stats', requireAuth, async (req, res) => {
  try {
    // Stats de hoje
    const todayResult = await pool.query(
      `SELECT COALESCE(SUM(total_value), 0) as value, COALESCE(SUM(quantity), 0) as pieces
       FROM laundry_entries WHERE key_id = $1 AND entry_date = CURRENT_DATE`,
      [req.user.keyId]
    );
    
    // Stats da semana
    const weekResult = await pool.query(
      `SELECT COALESCE(SUM(total_value), 0) as value, COALESCE(SUM(quantity), 0) as pieces
       FROM laundry_entries WHERE key_id = $1 AND entry_date >= DATE_TRUNC('week', CURRENT_DATE)`,
      [req.user.keyId]
    );
    
    // Stats do mês
    const monthResult = await pool.query(
      `SELECT COALESCE(SUM(total_value), 0) as value, COALESCE(SUM(quantity), 0) as pieces
       FROM laundry_entries WHERE key_id = $1 AND entry_date >= DATE_TRUNC('month', CURRENT_DATE)`,
      [req.user.keyId]
    );
    
    // Stats total
    const totalResult = await pool.query(
      `SELECT COALESCE(SUM(total_value), 0) as value, COALESCE(SUM(quantity), 0) as pieces
       FROM laundry_entries WHERE key_id = $1`,
      [req.user.keyId]
    );
    
    // Por cliente
    const byClientResult = await pool.query(
      `SELECT c.id, c.name, c.color, COALESCE(SUM(e.total_value), 0) as total, COALESCE(SUM(e.quantity), 0) as pieces
       FROM laundry_clients c
       LEFT JOIN laundry_entries e ON e.client_id = c.id
       WHERE c.key_id = $1 AND c.active = true
       GROUP BY c.id, c.name, c.color
       ORDER BY total DESC`,
      [req.user.keyId]
    );
    
    res.json({
      ok: true,
      stats: {
        today_pieces: parseInt(todayResult.rows[0].pieces),
        today_value: parseFloat(todayResult.rows[0].value),
        week_pieces: parseInt(weekResult.rows[0].pieces),
        week_value: parseFloat(weekResult.rows[0].value),
        month_pieces: parseInt(monthResult.rows[0].pieces),
        month_value: parseFloat(monthResult.rows[0].value),
        total_pieces: parseInt(totalResult.rows[0].pieces),
        total_value: parseFloat(totalResult.rows[0].value),
        byClient: byClientResult.rows
      }
    });
  } catch (error) {
    console.error('Erro ao buscar estatísticas:', error);
    res.status(500).json({ ok: false, error: 'Erro ao buscar estatísticas' });
  }
});

// ========================================
// LAVANDERIA V2 - Sistema Completo
// ========================================
// SEGURANÇA: Todas as rotas da lavanderia só podem ser acessadas por tenants do tipo 'lavanderia'

// Listar clientes com configuração completa
app.get('/laundry/v2/clients', requireAuth, requireTenantType(['lavanderia']), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, price_per_piece, marking_price, billing_cycle, 
              cycle_start_day, categories_config, color, icon, active
       FROM laundry_clients 
       WHERE key_id = $1 
       ORDER BY name`,
      [req.user.keyId]
    );
    res.json({ ok: true, clients: result.rows });
  } catch (error) {
    console.error('Erro ao listar clientes V2:', error);
    res.status(500).json({ ok: false, error: 'Erro ao listar clientes' });
  }
});

// Obter lançamentos diários de um cliente
app.get('/laundry/v2/entries/:clientId', requireAuth, requireTenantType(['lavanderia']), async (req, res) => {
  try {
    const { clientId } = req.params;
    const { start_date, end_date } = req.query;
    
    let query = `
      SELECT e.*, c.name as client_name, c.color as client_color
      FROM laundry_daily_entries e
      JOIN laundry_clients c ON c.id = e.client_id
      WHERE e.client_id = $1 AND e.key_id = $2
    `;
    const params = [clientId, req.user.keyId];
    let paramIdx = 3;

    if (start_date) {
      query += ` AND e.entry_date >= $${paramIdx++}`;
      params.push(start_date);
    }
    if (end_date) {
      query += ` AND e.entry_date <= $${paramIdx++}`;
      params.push(end_date);
    }

    query += ' ORDER BY e.entry_date DESC';
    
    const result = await pool.query(query, params);
    res.json({ ok: true, entries: result.rows });
  } catch (error) {
    console.error('Erro ao listar lançamentos:', error);
    res.status(500).json({ ok: false, error: 'Erro ao listar lançamentos' });
  }
});

// Salvar/Atualizar lançamento diário (upsert)
app.post('/laundry/v2/entries', requireAuth, requireTenantType(['lavanderia']), requireRoles(['admin', 'lavanderia']), async (req, res) => {
  try {
    const { 
      client_id, entry_date, 
      camisa_masc, calca_masc, camisa_fem, calca_fem,
      camisa, calca, pecas, marcacoes, notes 
    } = req.body;
    
    // Buscar configuração do cliente
    const clientResult = await pool.query(
      'SELECT price_per_piece, marking_price FROM laundry_clients WHERE id = $1 AND key_id = $2',
      [client_id, req.user.keyId]
    );
    if (clientResult.rowCount === 0) {
      return res.status(404).json({ ok: false, error: 'Cliente não encontrado' });
    }
    
    const client = clientResult.rows[0];
    const pricePerPiece = parseFloat(client.price_per_piece) || 0;
    const markingPrice = parseFloat(client.marking_price) || 0;
    
    // Calcular totais
    const totalPecas = (camisa_masc || 0) + (calca_masc || 0) + 
                       (camisa_fem || 0) + (calca_fem || 0) +
                       (camisa || 0) + (calca || 0) + (pecas || 0);
    const valorPecas = totalPecas * pricePerPiece;
    const valorMarcacoes = (marcacoes || 0) * markingPrice;
    const valorTotal = valorPecas + valorMarcacoes;
    
    const id = crypto.randomUUID();
    
    // Upsert: inserir ou atualizar se já existe para esse cliente/data
    await pool.query(`
      INSERT INTO laundry_daily_entries (
        id, client_id, entry_date, camisa_masc, calca_masc, camisa_fem, calca_fem,
        camisa, calca, pecas, marcacoes, total_pecas, valor_pecas, valor_marcacoes,
        valor_total, notes, recorded_by, key_id, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW())
      ON CONFLICT (client_id, entry_date) DO UPDATE SET
        camisa_masc = EXCLUDED.camisa_masc,
        calca_masc = EXCLUDED.calca_masc,
        camisa_fem = EXCLUDED.camisa_fem,
        calca_fem = EXCLUDED.calca_fem,
        camisa = EXCLUDED.camisa,
        calca = EXCLUDED.calca,
        pecas = EXCLUDED.pecas,
        marcacoes = EXCLUDED.marcacoes,
        total_pecas = EXCLUDED.total_pecas,
        valor_pecas = EXCLUDED.valor_pecas,
        valor_marcacoes = EXCLUDED.valor_marcacoes,
        valor_total = EXCLUDED.valor_total,
        notes = EXCLUDED.notes,
        updated_at = NOW()
    `, [
      id, client_id, entry_date,
      camisa_masc || 0, calca_masc || 0, camisa_fem || 0, calca_fem || 0,
      camisa || 0, calca || 0, pecas || 0, marcacoes || 0,
      totalPecas, valorPecas, valorMarcacoes, valorTotal,
      notes || null, req.user.userId, req.user.keyId
    ]);
    
    res.json({ ok: true, message: 'Lançamento salvo com sucesso' });
  } catch (error) {
    console.error('Erro ao salvar lançamento:', error);
    res.status(500).json({ ok: false, error: 'Erro ao salvar lançamento' });
  }
});

// Deletar lançamento diário
app.delete('/laundry/v2/entries/:id', requireAuth, requireRoles(['admin', 'lavanderia']), async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM laundry_daily_entries WHERE id = $1 AND key_id = $2',
      [req.params.id, req.user.keyId]
    );
    res.json({ ok: true });
  } catch (error) {
    console.error('Erro ao deletar lançamento:', error);
    res.status(500).json({ ok: false, error: 'Erro ao deletar lançamento' });
  }
});

// Estatísticas V2 - Dashboard completo
app.get('/laundry/v2/stats', requireAuth, async (req, res) => {
  try {
    // Total geral a receber
    const totalResult = await pool.query(
      `SELECT COALESCE(SUM(valor_total), 0) as total_value,
              COALESCE(SUM(total_pecas), 0) as total_pieces,
              COALESCE(SUM(marcacoes), 0) as total_markings
       FROM laundry_daily_entries WHERE key_id = $1`,
      [req.user.keyId]
    );
    
    // Totais do mês atual
    const monthResult = await pool.query(
      `SELECT COALESCE(SUM(valor_total), 0) as value,
              COALESCE(SUM(total_pecas), 0) as pieces,
              COALESCE(SUM(marcacoes), 0) as markings
       FROM laundry_daily_entries 
       WHERE key_id = $1 AND entry_date >= DATE_TRUNC('month', CURRENT_DATE)`,
      [req.user.keyId]
    );
    
    // Totais de hoje
    const todayResult = await pool.query(
      `SELECT COALESCE(SUM(valor_total), 0) as value,
              COALESCE(SUM(total_pecas), 0) as pieces
       FROM laundry_daily_entries 
       WHERE key_id = $1 AND entry_date = CURRENT_DATE`,
      [req.user.keyId]
    );
    
    // Por cliente com período atual
    const byClientResult = await pool.query(
      `SELECT c.id, c.name, c.color, c.icon, c.price_per_piece, c.marking_price,
              c.billing_cycle, c.cycle_start_day,
              COALESCE(SUM(e.total_pecas), 0) as total_pieces,
              COALESCE(SUM(e.marcacoes), 0) as total_markings,
              COALESCE(SUM(e.valor_total), 0) as total_value,
              COUNT(e.id) as days_with_entries
       FROM laundry_clients c
       LEFT JOIN laundry_daily_entries e ON e.client_id = c.id 
         AND e.entry_date >= DATE_TRUNC('month', CURRENT_DATE)
       WHERE c.key_id = $1 AND c.active = true
       GROUP BY c.id, c.name, c.color, c.icon, c.price_per_piece, c.marking_price, c.billing_cycle, c.cycle_start_day
       ORDER BY total_value DESC`,
      [req.user.keyId]
    );
    
    res.json({
      ok: true,
      stats: {
        total_value: parseFloat(totalResult.rows[0].total_value),
        total_pieces: parseInt(totalResult.rows[0].total_pieces),
        total_markings: parseInt(totalResult.rows[0].total_markings),
        month_value: parseFloat(monthResult.rows[0].value),
        month_pieces: parseInt(monthResult.rows[0].pieces),
        month_markings: parseInt(monthResult.rows[0].markings),
        today_value: parseFloat(todayResult.rows[0].value),
        today_pieces: parseInt(todayResult.rows[0].pieces),
        byClient: byClientResult.rows
      }
    });
  } catch (error) {
    console.error('Erro ao buscar estatísticas V2:', error);
    res.status(500).json({ ok: false, error: 'Erro ao buscar estatísticas' });
  }
});

// Relatório para exportação PDF de um cliente
app.get('/laundry/v2/report/:clientId', requireAuth, async (req, res) => {
  try {
    const { clientId } = req.params;
    const { start_date, end_date } = req.query;
    
    // Dados do cliente
    const clientResult = await pool.query(
      `SELECT * FROM laundry_clients WHERE id = $1 AND key_id = $2`,
      [clientId, req.user.keyId]
    );
    if (clientResult.rowCount === 0) {
      return res.status(404).json({ ok: false, error: 'Cliente não encontrado' });
    }
    const client = clientResult.rows[0];
    
    // Lançamentos do período
    const entriesResult = await pool.query(
      `SELECT * FROM laundry_daily_entries 
       WHERE client_id = $1 AND key_id = $2 
         AND entry_date >= $3 AND entry_date <= $4
       ORDER BY entry_date`,
      [clientId, req.user.keyId, start_date, end_date]
    );
    
    // Totais
    const totalsResult = await pool.query(
      `SELECT 
         COALESCE(SUM(camisa_masc), 0) as total_camisa_masc,
         COALESCE(SUM(calca_masc), 0) as total_calca_masc,
         COALESCE(SUM(camisa_fem), 0) as total_camisa_fem,
         COALESCE(SUM(calca_fem), 0) as total_calca_fem,
         COALESCE(SUM(camisa), 0) as total_camisa,
         COALESCE(SUM(calca), 0) as total_calca,
         COALESCE(SUM(pecas), 0) as total_pecas_raw,
         COALESCE(SUM(total_pecas), 0) as total_pecas,
         COALESCE(SUM(marcacoes), 0) as total_marcacoes,
         COALESCE(SUM(valor_pecas), 0) as total_valor_pecas,
         COALESCE(SUM(valor_marcacoes), 0) as total_valor_marcacoes,
         COALESCE(SUM(valor_total), 0) as total_valor
       FROM laundry_daily_entries 
       WHERE client_id = $1 AND key_id = $2 
         AND entry_date >= $3 AND entry_date <= $4`,
      [clientId, req.user.keyId, start_date, end_date]
    );
    
    res.json({
      ok: true,
      report: {
        client,
        period: { start: start_date, end: end_date },
        entries: entriesResult.rows,
        totals: totalsResult.rows[0]
      }
    });
  } catch (error) {
    console.error('Erro ao gerar relatório:', error);
    res.status(500).json({ ok: false, error: 'Erro ao gerar relatório' });
  }
});

// Calcular período atual de um cliente (para Marajoara que é 16 dias)
app.get('/laundry/v2/period/:clientId', requireAuth, async (req, res) => {
  try {
    const { clientId } = req.params;
    
    const clientResult = await pool.query(
      `SELECT billing_cycle, cycle_start_day FROM laundry_clients WHERE id = $1 AND key_id = $2`,
      [clientId, req.user.keyId]
    );
    if (clientResult.rowCount === 0) {
      return res.status(404).json({ ok: false, error: 'Cliente não encontrado' });
    }
    
    const { billing_cycle, cycle_start_day } = clientResult.rows[0];
    const today = new Date();
    let periodStart, periodEnd;
    
    if (billing_cycle === 'biweekly') {
      // Ciclo de 16 dias (ex: 5-20 ou 21-4)
      const dayOfMonth = today.getDate();
      const year = today.getFullYear();
      const month = today.getMonth();
      
      if (cycle_start_day === 5) {
        // Marajoara: 5-20 ou 21-4
        if (dayOfMonth >= 5 && dayOfMonth <= 20) {
          periodStart = new Date(year, month, 5);
          periodEnd = new Date(year, month, 20);
        } else if (dayOfMonth >= 21) {
          periodStart = new Date(year, month, 21);
          periodEnd = new Date(year, month + 1, 4);
        } else {
          // Dias 1-4: período anterior (21 do mês passado até 4 deste mês)
          periodStart = new Date(year, month - 1, 21);
          periodEnd = new Date(year, month, 4);
        }
      } else {
        // Ciclo genérico
        periodStart = new Date(year, month, cycle_start_day);
        periodEnd = new Date(year, month, cycle_start_day + 15);
      }
    } else {
      // Mês completo
      periodStart = new Date(today.getFullYear(), today.getMonth(), 1);
      periodEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    }
    
    res.json({
      ok: true,
      period: {
        start: periodStart.toISOString().split('T')[0],
        end: periodEnd.toISOString().split('T')[0],
        billing_cycle,
        cycle_start_day
      }
    });
  } catch (error) {
    console.error('Erro ao calcular período:', error);
    res.status(500).json({ ok: false, error: 'Erro ao calcular período' });
  }
});

// ============================================
// PDF DIRETO - Retorna application/pdf para download nativo
// ============================================

// PDF de Relatório de Água
app.get('/api/pdf/water-report', requireAuth, async (req, res) => {
  try {
    const { month } = req.query; // formato: YYYY-MM
    const keyId = req.user.keyId;
    
    // Definir período
    let startDate, endDate, monthLabel;
    if (month) {
      const [year, m] = month.split('-');
      startDate = new Date(parseInt(year), parseInt(m) - 1, 1);
      endDate = new Date(parseInt(year), parseInt(m), 0);
      const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
      monthLabel = monthNames[parseInt(m) - 1] + ' ' + year;
    } else {
      const now = new Date();
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
      monthLabel = monthNames[now.getMonth()] + ' ' + now.getFullYear();
    }
    
    // Buscar leituras
    const result = await pool.query(
      `SELECT * FROM water_readings 
       WHERE key_id = $1 AND reading_date >= $2 AND reading_date <= $3
       ORDER BY reading_date, reading_time`,
      [keyId, startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]]
    );
    
    const readings = result.rows;
    
    // Calcular consumo por tanque
    function calculateConsumption(tankName) {
      const tankReadings = readings.filter(r => r.tank_name === tankName);
      if (tankReadings.length < 2) return { total: 0, avg: 0 };
      
      const byDay = {};
      tankReadings.forEach(r => {
        const day = r.reading_date.toISOString().split('T')[0];
        if (!byDay[day]) byDay[day] = [];
        byDay[day].push(r);
      });
      
      let total = 0;
      Object.values(byDay).forEach(dayReadings => {
        if (dayReadings.length >= 2) {
          dayReadings.sort((a, b) => (a.reading_time || '').localeCompare(b.reading_time || ''));
          const consumption = dayReadings[dayReadings.length - 1].reading_value - dayReadings[0].reading_value;
          if (consumption > 0) total += consumption;
        }
      });
      
      const days = Object.keys(byDay).length;
      return { total, avg: days > 0 ? total / days : 0 };
    }
    
    const aviariosCalc = calculateConsumption('aviarios');
    const recriaCalc = calculateConsumption('recria');
    
    // Gerar PDF
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => {
      const pdfBuffer = Buffer.concat(chunks);
      const filename = `relatorio_agua_${monthLabel.replace(' ', '_')}.pdf`;
      
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', pdfBuffer.length);
      res.send(pdfBuffer);
    });
    
    // Cabeçalho
    doc.fontSize(20).font('Helvetica-Bold').text('RELATÓRIO DE ÁGUA', { align: 'center' });
    doc.fontSize(14).font('Helvetica').text('Granja Vitta', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(12).text(`Período: ${monthLabel}`, { align: 'center' });
    doc.moveDown(1);
    
    // Linha separadora
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(1);
    
    // Resumo
    doc.fontSize(14).font('Helvetica-Bold').text('RESUMO DE CONSUMO');
    doc.moveDown(0.5);
    doc.fontSize(11).font('Helvetica');
    doc.text(`Aviários: ${aviariosCalc.total.toFixed(3)} m³ (média: ${aviariosCalc.avg.toFixed(3)} m³/dia)`);
    doc.text(`Recria: ${recriaCalc.total.toFixed(3)} m³ (média: ${recriaCalc.avg.toFixed(3)} m³/dia)`);
    doc.text(`Total: ${(aviariosCalc.total + recriaCalc.total).toFixed(3)} m³`);
    doc.moveDown(1);
    
    // Tabela de leituras
    doc.fontSize(14).font('Helvetica-Bold').text('LEITURAS DO PERÍODO');
    doc.moveDown(0.5);
    
    // Cabeçalho da tabela
    const tableTop = doc.y;
    doc.fontSize(9).font('Helvetica-Bold');
    doc.text('Data', 50, tableTop);
    doc.text('Hora', 130, tableTop);
    doc.text('Tanque', 200, tableTop);
    doc.text('Leitura (m³)', 300, tableTop);
    doc.text('Responsável', 400, tableTop);
    
    doc.moveTo(50, tableTop + 15).lineTo(545, tableTop + 15).stroke();
    
    let y = tableTop + 20;
    doc.font('Helvetica').fontSize(8);
    
    readings.slice(0, 80).forEach(r => {
      if (y > 750) {
        doc.addPage();
        y = 50;
      }
      const dateStr = new Date(r.reading_date).toLocaleDateString('pt-BR');
      doc.text(dateStr, 50, y);
      doc.text(r.reading_time || '-', 130, y);
      doc.text(r.tank_name === 'aviarios' ? 'Aviários' : 'Recria', 200, y);
      doc.text(r.reading_value.toFixed(3), 300, y);
      doc.text(r.recorded_by_name || '-', 400, y);
      y += 14;
    });
    
    // Rodapé
    doc.fontSize(8).font('Helvetica')
       .text(`Gerado em: ${new Date().toLocaleString('pt-BR')} - Sistema Icarus`, 50, 780, { align: 'center' });
    
    doc.end();
    
  } catch (error) {
    console.error('Erro ao gerar PDF de água:', error);
    res.status(500).json({ ok: false, error: 'Erro ao gerar PDF' });
  }
});

// PDF de Relatório de Diesel
app.get('/api/pdf/diesel-report', requireAuth, async (req, res) => {
  try {
    const { month } = req.query;
    const keyId = req.user.keyId;
    
    let startDate, endDate, monthLabel;
    if (month) {
      const [year, m] = month.split('-');
      startDate = new Date(parseInt(year), parseInt(m) - 1, 1);
      endDate = new Date(parseInt(year), parseInt(m), 0);
      const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
      monthLabel = monthNames[parseInt(m) - 1] + ' ' + year;
    } else {
      const now = new Date();
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
      monthLabel = monthNames[now.getMonth()] + ' ' + now.getFullYear();
    }
    
    // Buscar registros de diesel
    const result = await pool.query(
      `SELECT * FROM diesel_records 
       WHERE key_id = $1 AND record_date >= $2 AND record_date <= $3
       ORDER BY record_date DESC`,
      [keyId, startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]]
    );
    
    const records = result.rows;
    
    // Calcular totais
    let totalEntrada = 0, totalSaida = 0;
    records.forEach(r => {
      if (r.record_type === 'entrada') totalEntrada += parseFloat(r.liters) || 0;
      else totalSaida += parseFloat(r.liters) || 0;
    });
    
    // Gerar PDF
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => {
      const pdfBuffer = Buffer.concat(chunks);
      const filename = `relatorio_diesel_${monthLabel.replace(' ', '_')}.pdf`;
      
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', pdfBuffer.length);
      res.send(pdfBuffer);
    });
    
    // Cabeçalho
    doc.fontSize(20).font('Helvetica-Bold').text('RELATÓRIO DE DIESEL', { align: 'center' });
    doc.fontSize(14).font('Helvetica').text('Granja Vitta', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(12).text(`Período: ${monthLabel}`, { align: 'center' });
    doc.moveDown(1);
    
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(1);
    
    // Resumo
    doc.fontSize(14).font('Helvetica-Bold').text('RESUMO');
    doc.moveDown(0.5);
    doc.fontSize(11).font('Helvetica');
    doc.text(`Total Entradas: ${totalEntrada.toFixed(2)} litros`);
    doc.text(`Total Saídas: ${totalSaida.toFixed(2)} litros`);
    doc.text(`Saldo: ${(totalEntrada - totalSaida).toFixed(2)} litros`);
    doc.moveDown(1);
    
    // Tabela
    doc.fontSize(14).font('Helvetica-Bold').text('MOVIMENTAÇÕES');
    doc.moveDown(0.5);
    
    const tableTop = doc.y;
    doc.fontSize(9).font('Helvetica-Bold');
    doc.text('Data', 50, tableTop);
    doc.text('Tipo', 130, tableTop);
    doc.text('Litros', 200, tableTop);
    doc.text('Destino/Origem', 280, tableTop);
    doc.text('Responsável', 420, tableTop);
    
    doc.moveTo(50, tableTop + 15).lineTo(545, tableTop + 15).stroke();
    
    let y = tableTop + 20;
    doc.font('Helvetica').fontSize(8);
    
    records.slice(0, 60).forEach(r => {
      if (y > 750) {
        doc.addPage();
        y = 50;
      }
      const dateStr = new Date(r.record_date).toLocaleDateString('pt-BR');
      doc.text(dateStr, 50, y);
      doc.text(r.record_type === 'entrada' ? 'Entrada' : 'Saída', 130, y);
      doc.text(`${parseFloat(r.liters).toFixed(2)} L`, 200, y);
      doc.text((r.destination || r.origin || '-').substring(0, 25), 280, y);
      doc.text(r.recorded_by_name || '-', 420, y);
      y += 14;
    });
    
    doc.fontSize(8).font('Helvetica')
       .text(`Gerado em: ${new Date().toLocaleString('pt-BR')} - Sistema Icarus`, 50, 780, { align: 'center' });
    
    doc.end();
    
  } catch (error) {
    console.error('Erro ao gerar PDF de diesel:', error);
    res.status(500).json({ ok: false, error: 'Erro ao gerar PDF' });
  }
});

// PDF de Relatório de Gerador
app.get('/api/pdf/generator-report', requireAuth, async (req, res) => {
  try {
    const { month } = req.query;
    const keyId = req.user.keyId;
    
    let startDate, endDate, monthLabel;
    if (month) {
      const [year, m] = month.split('-');
      startDate = new Date(parseInt(year), parseInt(m) - 1, 1);
      endDate = new Date(parseInt(year), parseInt(m), 0);
      const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
      monthLabel = monthNames[parseInt(m) - 1] + ' ' + year;
    } else {
      const now = new Date();
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
      monthLabel = monthNames[now.getMonth()] + ' ' + now.getFullYear();
    }
    
    // Buscar registros
    const result = await pool.query(
      `SELECT * FROM generator_records 
       WHERE key_id = $1 AND record_date >= $2 AND record_date <= $3
       ORDER BY record_date DESC, start_time DESC`,
      [keyId, startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]]
    );
    
    const records = result.rows;
    
    // Calcular totais
    let totalHoras = 0, totalDiesel = 0;
    records.forEach(r => {
      totalHoras += parseFloat(r.duration_hours) || 0;
      totalDiesel += parseFloat(r.diesel_used) || 0;
    });
    
    // Gerar PDF
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => {
      const pdfBuffer = Buffer.concat(chunks);
      const filename = `relatorio_gerador_${monthLabel.replace(' ', '_')}.pdf`;
      
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', pdfBuffer.length);
      res.send(pdfBuffer);
    });
    
    // Cabeçalho
    doc.fontSize(20).font('Helvetica-Bold').text('RELATÓRIO DE GERADOR', { align: 'center' });
    doc.fontSize(14).font('Helvetica').text('Granja Vitta', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(12).text(`Período: ${monthLabel}`, { align: 'center' });
    doc.moveDown(1);
    
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(1);
    
    // Resumo
    doc.fontSize(14).font('Helvetica-Bold').text('RESUMO');
    doc.moveDown(0.5);
    doc.fontSize(11).font('Helvetica');
    doc.text(`Total de Acionamentos: ${records.length}`);
    doc.text(`Total de Horas: ${totalHoras.toFixed(1)} h`);
    doc.text(`Total de Diesel: ${totalDiesel.toFixed(2)} L`);
    if (totalHoras > 0) {
      doc.text(`Consumo Médio: ${(totalDiesel / totalHoras).toFixed(2)} L/h`);
    }
    doc.moveDown(1);
    
    // Tabela
    doc.fontSize(14).font('Helvetica-Bold').text('ACIONAMENTOS');
    doc.moveDown(0.5);
    
    const tableTop = doc.y;
    doc.fontSize(9).font('Helvetica-Bold');
    doc.text('Data', 50, tableTop);
    doc.text('Início', 110, tableTop);
    doc.text('Fim', 160, tableTop);
    doc.text('Duração', 210, tableTop);
    doc.text('Diesel', 270, tableTop);
    doc.text('Motivo', 330, tableTop);
    
    doc.moveTo(50, tableTop + 15).lineTo(545, tableTop + 15).stroke();
    
    let y = tableTop + 20;
    doc.font('Helvetica').fontSize(8);
    
    records.slice(0, 50).forEach(r => {
      if (y > 750) {
        doc.addPage();
        y = 50;
      }
      const dateStr = new Date(r.record_date).toLocaleDateString('pt-BR');
      doc.text(dateStr, 50, y);
      doc.text(r.start_time || '-', 110, y);
      doc.text(r.end_time || '-', 160, y);
      doc.text(`${(parseFloat(r.duration_hours) || 0).toFixed(1)}h`, 210, y);
      doc.text(`${(parseFloat(r.diesel_used) || 0).toFixed(1)}L`, 270, y);
      doc.text((r.reason || '-').substring(0, 30), 330, y);
      y += 14;
    });
    
    doc.fontSize(8).font('Helvetica')
       .text(`Gerado em: ${new Date().toLocaleString('pt-BR')} - Sistema Icarus`, 50, 780, { align: 'center' });
    
    doc.end();
    
  } catch (error) {
    console.error('Erro ao gerar PDF de gerador:', error);
    res.status(500).json({ ok: false, error: 'Erro ao gerar PDF' });
  }
});

// PDF de Ordens de Serviço
app.get('/api/pdf/orders-report', requireAuth, async (req, res) => {
  try {
    const { status, period } = req.query;
    const keyId = req.user.keyId;
    
    // Definir período
    const now = new Date();
    let startDate, endDate, periodLabel;
    
    if (period === 'weekly') {
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      endDate = now;
      periodLabel = 'Última Semana';
    } else if (period === 'monthly') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = now;
      periodLabel = 'Este Mês';
    } else {
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      endDate = now;
      periodLabel = 'Últimos 30 dias';
    }
    
    // Query base
    let query = `
      SELECT o.*, u.name as requested_by_name,
             array_agg(DISTINCT ua.name) FILTER (WHERE ua.name IS NOT NULL) as assigned_names
      FROM orders o
      LEFT JOIN users u ON o.requested_by = u.id
      LEFT JOIN order_assignments oa ON o.id = oa.order_id
      LEFT JOIN users ua ON oa.user_id = ua.id
      WHERE o.key_id = $1 AND o.created_at >= $2 AND o.created_at <= $3
    `;
    const params = [keyId, startDate.toISOString(), endDate.toISOString()];
    
    if (status && status !== 'all') {
      query += ` AND o.status = $4`;
      params.push(status);
    }
    
    query += ` GROUP BY o.id, u.name ORDER BY o.created_at DESC`;
    
    const result = await pool.query(query, params);
    const orders = result.rows;
    
    // Contagens
    const pending = orders.filter(o => o.status === 'pending').length;
    const inProgress = orders.filter(o => o.status === 'in_progress').length;
    const completed = orders.filter(o => o.status === 'completed').length;
    
    // Gerar PDF
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => {
      const pdfBuffer = Buffer.concat(chunks);
      const filename = `relatorio_ordens_${periodLabel.replace(' ', '_')}.pdf`;
      
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', pdfBuffer.length);
      res.send(pdfBuffer);
    });
    
    // Cabeçalho
    doc.fontSize(20).font('Helvetica-Bold').text('RELATÓRIO DE ORDENS DE SERVIÇO', { align: 'center' });
    doc.fontSize(14).font('Helvetica').text('Granja Vitta', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(12).text(`Período: ${periodLabel}`, { align: 'center' });
    doc.moveDown(1);
    
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(1);
    
    // Resumo
    doc.fontSize(14).font('Helvetica-Bold').text('RESUMO');
    doc.moveDown(0.5);
    doc.fontSize(11).font('Helvetica');
    doc.text(`Total de Ordens: ${orders.length}`);
    doc.text(`Pendentes: ${pending}`);
    doc.text(`Em Andamento: ${inProgress}`);
    doc.text(`Concluídas: ${completed}`);
    doc.moveDown(1);
    
    // Lista de ordens
    doc.fontSize(14).font('Helvetica-Bold').text('ORDENS DE SERVIÇO');
    doc.moveDown(0.5);
    
    orders.slice(0, 30).forEach((order, idx) => {
      if (doc.y > 700) {
        doc.addPage();
      }
      
      const statusMap = { pending: 'Pendente', in_progress: 'Em Andamento', completed: 'Concluída' };
      const priorityMap = { low: 'Baixa', medium: 'Média', high: 'Alta', critical: 'Crítica' };
      
      doc.fontSize(10).font('Helvetica-Bold');
      doc.text(`${idx + 1}. ${order.title}`);
      doc.fontSize(9).font('Helvetica');
      doc.text(`   Status: ${statusMap[order.status] || order.status} | Prioridade: ${priorityMap[order.priority] || order.priority}`);
      doc.text(`   Setor: ${order.sector || '-'} | Criado: ${new Date(order.created_at).toLocaleDateString('pt-BR')}`);
      if (order.assigned_names && order.assigned_names.length > 0) {
        doc.text(`   Responsáveis: ${order.assigned_names.join(', ')}`);
      }
      doc.moveDown(0.5);
    });
    
    doc.fontSize(8).font('Helvetica')
       .text(`Gerado em: ${new Date().toLocaleString('pt-BR')} - Sistema Icarus`, 50, 780, { align: 'center' });
    
    doc.end();
    
  } catch (error) {
    console.error('Erro ao gerar PDF de ordens:', error);
    res.status(500).json({ ok: false, error: 'Erro ao gerar PDF' });
  }
});

// PDF de Dashboard (relatório completo com estatísticas)
app.get('/api/pdf/dashboard-report', requireAuth, async (req, res) => {
  try {
    const { period } = req.query;
    const keyId = req.user.keyId;
    
    // Definir período
    const now = new Date();
    let startDate, endDate, periodLabel;
    
    if (period === 'daily') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      endDate = now;
      periodLabel = 'Hoje';
    } else if (period === 'weekly') {
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      endDate = now;
      periodLabel = 'Esta Semana';
    } else {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = now;
      periodLabel = 'Este Mês';
    }
    
    // Buscar ordens do período
    const ordersQuery = `
      SELECT o.*, u.name as requested_by_name,
             array_agg(DISTINCT ua.name) FILTER (WHERE ua.name IS NOT NULL) as assigned_names
      FROM orders o
      LEFT JOIN users u ON o.requested_by = u.id
      LEFT JOIN order_assignments oa ON o.id = oa.order_id
      LEFT JOIN users ua ON oa.user_id = ua.id
      WHERE o.key_id = $1 AND o.created_at >= $2 AND o.created_at <= $3
      GROUP BY o.id, u.name ORDER BY o.created_at DESC
    `;
    const ordersResult = await pool.query(ordersQuery, [keyId, startDate.toISOString(), endDate.toISOString()]);
    const orders = ordersResult.rows;
    
    // Contagens
    const pending = orders.filter(o => o.status === 'pending').length;
    const inProgress = orders.filter(o => o.status === 'in_progress' || o.status === 'paused').length;
    const completed = orders.filter(o => o.status === 'completed').length;
    const total = orders.length;
    const aproveitamento = total > 0 ? Math.round((completed / total) * 100) : 0;
    
    // Agrupar por executor
    const byExecutor = {};
    orders.forEach(o => {
      if (o.assigned_names && o.assigned_names.length > 0) {
        o.assigned_names.forEach(name => {
          if (!byExecutor[name]) byExecutor[name] = { total: 0, completed: 0 };
          byExecutor[name].total++;
          if (o.status === 'completed') byExecutor[name].completed++;
        });
      }
    });
    
    // Agrupar por setor
    const bySetor = {};
    orders.forEach(o => {
      const setor = o.sector || 'Não especificado';
      if (!bySetor[setor]) bySetor[setor] = 0;
      bySetor[setor]++;
    });
    
    // Gerar PDF
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => {
      const pdfBuffer = Buffer.concat(chunks);
      const filename = `relatorio_dashboard_${periodLabel.replace(' ', '_')}.pdf`;
      
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', pdfBuffer.length);
      res.send(pdfBuffer);
    });
    
    // Cabeçalho
    doc.fontSize(22).font('Helvetica-Bold').text('RELATÓRIO DASHBOARD', { align: 'center' });
    doc.fontSize(14).font('Helvetica').text('Granja Vitta - Sistema Icarus', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(12).text(`Período: ${periodLabel}`, { align: 'center' });
    doc.fontSize(10).text(`Gerado em: ${now.toLocaleString('pt-BR')}`, { align: 'center' });
    doc.moveDown(1);
    
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(1);
    
    // Resumo geral
    doc.fontSize(16).font('Helvetica-Bold').text('RESUMO GERAL');
    doc.moveDown(0.5);
    doc.fontSize(12).font('Helvetica');
    doc.text(`Total de OS: ${total}`);
    doc.text(`Pendentes: ${pending}`);
    doc.text(`Em Andamento: ${inProgress}`);
    doc.text(`Concluídas: ${completed}`);
    doc.text(`Aproveitamento: ${aproveitamento}%`);
    doc.moveDown(1);
    
    // Por executor
    if (Object.keys(byExecutor).length > 0) {
      doc.fontSize(14).font('Helvetica-Bold').text('DESEMPENHO POR EXECUTOR');
      doc.moveDown(0.5);
      doc.fontSize(10).font('Helvetica');
      Object.entries(byExecutor).forEach(([name, data]) => {
        const taxa = data.total > 0 ? Math.round((data.completed / data.total) * 100) : 0;
        doc.text(`• ${name}: ${data.completed}/${data.total} concluídas (${taxa}%)`);
      });
      doc.moveDown(1);
    }
    
    // Por setor
    if (Object.keys(bySetor).length > 0) {
      doc.fontSize(14).font('Helvetica-Bold').text('ORDENS POR SETOR');
      doc.moveDown(0.5);
      doc.fontSize(10).font('Helvetica');
      Object.entries(bySetor).sort((a, b) => b[1] - a[1]).forEach(([setor, count]) => {
        doc.text(`• ${setor}: ${count} ordens`);
      });
      doc.moveDown(1);
    }
    
    // Lista de ordens recentes
    doc.fontSize(14).font('Helvetica-Bold').text('ORDENS RECENTES');
    doc.moveDown(0.5);
    
    const statusMap = { pending: 'Pendente', in_progress: 'Em Andamento', paused: 'Pausada', completed: 'Concluída' };
    const priorityMap = { low: 'Baixa', medium: 'Média', high: 'Alta', critical: 'Crítica' };
    
    orders.slice(0, 20).forEach((order, idx) => {
      if (doc.y > 700) doc.addPage();
      doc.fontSize(10).font('Helvetica-Bold').text(`${idx + 1}. ${order.title}`);
      doc.fontSize(9).font('Helvetica');
      doc.text(`   Status: ${statusMap[order.status] || order.status} | Prioridade: ${priorityMap[order.priority] || order.priority} | Setor: ${order.sector || '-'}`);
      doc.moveDown(0.3);
    });
    
    doc.end();
    
  } catch (error) {
    console.error('Erro ao gerar PDF do dashboard:', error);
    res.status(500).json({ ok: false, error: 'Erro ao gerar PDF' });
  }
});

// ============================================
// GERAÇÃO DE PDF - Endpoint para gerar PDF no servidor
// ============================================
const pdfStorage = new Map(); // Armazena PDFs temporariamente (5 minutos)

// Limpar PDFs antigos a cada 5 minutos
setInterval(() => {
  const now = Date.now();
  for (const [id, data] of pdfStorage.entries()) {
    if (now - data.createdAt > 5 * 60 * 1000) {
      pdfStorage.delete(id);
    }
  }
}, 5 * 60 * 1000);

// Endpoint para gerar PDF a partir de dados estruturados
app.post('/api/generate-pdf', async (req, res) => {
  try {
    const { title, content, type } = req.body;
    
    if (!title || !content) {
      return res.status(400).json({ ok: false, error: 'Título e conteúdo são obrigatórios' });
    }
    
    const pdfId = uuid();
    const chunks = [];
    
    const doc = new PDFDocument({ 
      size: 'A4',
      margins: { top: 50, bottom: 50, left: 50, right: 50 }
    });
    
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => {
      const pdfBuffer = Buffer.concat(chunks);
      pdfStorage.set(pdfId, {
        buffer: pdfBuffer,
        title: title,
        createdAt: Date.now()
      });
      
      res.json({ 
        ok: true, 
        pdfId,
        downloadUrl: `/api/download-pdf/${pdfId}`,
        expiresIn: '5 minutos'
      });
    });
    
    // Cabeçalho
    doc.fontSize(18).font('Helvetica-Bold').text(title, { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica').text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, { align: 'center' });
    doc.moveDown(1);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(1);
    
    // Processar conteúdo baseado no tipo
    if (type === 'water-report' && Array.isArray(content.readings)) {
      // Relatório de água
      doc.fontSize(12).font('Helvetica-Bold').text('Período: ' + (content.period || ''));
      doc.moveDown(0.5);
      
      if (content.summary) {
        doc.fontSize(11).font('Helvetica-Bold').text('Resumo:');
        doc.fontSize(10).font('Helvetica');
        doc.text(`Consumo Total: ${content.summary.totalConsumption || 0} m³`);
        doc.text(`Média Diária: ${content.summary.avgDaily || 0} m³`);
        doc.text(`Total de Leituras: ${content.summary.totalReadings || 0}`);
        doc.moveDown(1);
      }
      
      // Tabela de leituras
      doc.fontSize(11).font('Helvetica-Bold').text('Leituras Diárias:');
      doc.moveDown(0.5);
      
      const tableTop = doc.y;
      const col1 = 50, col2 = 150, col3 = 250, col4 = 350, col5 = 450;
      
      doc.fontSize(9).font('Helvetica-Bold');
      doc.text('Data', col1, tableTop);
      doc.text('Hora', col2, tableTop);
      doc.text('Leitura', col3, tableTop);
      doc.text('Consumo', col4, tableTop);
      
      doc.moveTo(50, tableTop + 15).lineTo(545, tableTop + 15).stroke();
      
      let y = tableTop + 20;
      doc.font('Helvetica').fontSize(8);
      
      for (const reading of content.readings.slice(0, 50)) { // Limitar a 50 linhas
        if (y > 750) {
          doc.addPage();
          y = 50;
        }
        doc.text(reading.date || '', col1, y);
        doc.text(reading.time || '', col2, y);
        doc.text(reading.value || '', col3, y);
        doc.text(reading.consumption || '', col4, y);
        y += 15;
      }
      
    } else if (type === 'table' && Array.isArray(content.rows)) {
      // Tabela genérica
      const headers = content.headers || [];
      const rows = content.rows || [];
      
      let y = doc.y;
      const colWidth = 480 / Math.max(headers.length, 1);
      
      // Headers
      doc.fontSize(9).font('Helvetica-Bold');
      headers.forEach((h, i) => {
        doc.text(h, 50 + (i * colWidth), y, { width: colWidth - 5 });
      });
      y += 20;
      doc.moveTo(50, y).lineTo(545, y).stroke();
      y += 5;
      
      // Rows
      doc.font('Helvetica').fontSize(8);
      for (const row of rows.slice(0, 100)) {
        if (y > 750) {
          doc.addPage();
          y = 50;
        }
        const cells = Array.isArray(row) ? row : Object.values(row);
        cells.forEach((cell, i) => {
          doc.text(String(cell || ''), 50 + (i * colWidth), y, { width: colWidth - 5 });
        });
        y += 15;
      }
      
    } else if (typeof content === 'string') {
      // Texto simples
      doc.fontSize(10).font('Helvetica').text(content, {
        align: 'left',
        lineGap: 3
      });
    } else if (Array.isArray(content.sections)) {
      // Seções
      for (const section of content.sections) {
        doc.fontSize(12).font('Helvetica-Bold').text(section.title || '');
        doc.moveDown(0.3);
        doc.fontSize(10).font('Helvetica').text(section.text || '');
        doc.moveDown(1);
      }
    }
    
    // Rodapé
    doc.fontSize(8).font('Helvetica')
       .text('Sistema Icarus - Relatório gerado automaticamente', 50, 780, { align: 'center' });
    
    doc.end();
    
  } catch (error) {
    console.error('Erro ao gerar PDF:', error);
    res.status(500).json({ ok: false, error: 'Erro ao gerar PDF' });
  }
});

// ============================================
// PDF ICARUS.LAV - RELATÓRIO DE LAVANDERIA
// ============================================
app.post('/api/pdf/lav-report', async (req, res) => {
  try {
    const { client, entries, period, totals } = req.body;
    
    if (!client || !entries || !period) {
      return res.status(400).json({ ok: false, error: 'Dados incompletos' });
    }
    
    // Criar PDF
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];
    
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => {
      const pdfBuffer = Buffer.concat(chunks);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="relatorio_${client.name}_${period.label}.pdf"`);
      res.setHeader('Content-Length', pdfBuffer.length);
      res.send(pdfBuffer);
    });
    
    const clientColor = client.color || '#f472b6';
    
    // ===== CABEÇALHO =====
    doc.rect(0, 0, 595, 120).fill('#0f172a');
    doc.rect(40, 25, 515, 70).lineWidth(2).stroke(clientColor);
    
    doc.fontSize(28).font('Helvetica-Bold').fillColor(clientColor)
       .text('RELATÓRIO ' + client.name.toUpperCase(), 40, 40, { align: 'center', width: 515 });
    
    doc.fontSize(11).font('Helvetica').fillColor('#94a3b8')
       .text('Controle de Lavanderia • Sistema Icarus', 40, 72, { align: 'center', width: 515 });
    
    doc.fontSize(10).fillColor('#cbd5e1')
       .text('📅 ' + period.label, 40, 88, { align: 'center', width: 515 });
    
    // ===== CARDS DE ESTATÍSTICAS =====
    let y = 140;
    const cardWidth = 120;
    const cardGap = 15;
    const totalCards = client.markingPrice > 0 ? 4 : 3;
    const startX = (595 - (totalCards * cardWidth + (totalCards - 1) * cardGap)) / 2;
    
    // Card Peças
    doc.rect(startX, y, cardWidth, 70).fill('#1e293b');
    doc.rect(startX, y, cardWidth, 70).lineWidth(1).stroke('#334155');
    doc.fontSize(24).font('Helvetica-Bold').fillColor(clientColor)
       .text(totals.pieces.toString(), startX, y + 15, { width: cardWidth, align: 'center' });
    doc.fontSize(9).font('Helvetica').fillColor('#64748b')
       .text('PEÇAS', startX, y + 48, { width: cardWidth, align: 'center' });
    
    let cardX = startX + cardWidth + cardGap;
    
    // Card Marcações (se aplicável)
    if (client.markingPrice > 0) {
      doc.rect(cardX, y, cardWidth, 70).fill('#1e293b');
      doc.rect(cardX, y, cardWidth, 70).lineWidth(1).stroke('#334155');
      doc.fontSize(24).font('Helvetica-Bold').fillColor(clientColor)
         .text((totals.markings || 0).toString(), cardX, y + 15, { width: cardWidth, align: 'center' });
      doc.fontSize(9).font('Helvetica').fillColor('#64748b')
         .text('MARCAÇÕES', cardX, y + 48, { width: cardWidth, align: 'center' });
      cardX += cardWidth + cardGap;
    }
    
    // Card Lançamentos
    doc.rect(cardX, y, cardWidth, 70).fill('#1e293b');
    doc.rect(cardX, y, cardWidth, 70).lineWidth(1).stroke('#334155');
    doc.fontSize(24).font('Helvetica-Bold').fillColor(clientColor)
       .text(entries.length.toString(), cardX, y + 15, { width: cardWidth, align: 'center' });
    doc.fontSize(9).font('Helvetica').fillColor('#64748b')
       .text('LANÇAMENTOS', cardX, y + 48, { width: cardWidth, align: 'center' });
    cardX += cardWidth + cardGap;
    
    // Card Total (destaque)
    doc.rect(cardX, y, cardWidth, 70).fill(clientColor);
    doc.fontSize(18).font('Helvetica-Bold').fillColor('#000')
       .text('R$ ' + totals.value.toFixed(0), cardX, y + 18, { width: cardWidth, align: 'center' });
    doc.fontSize(9).font('Helvetica').fillColor('#000')
       .text('TOTAL', cardX, y + 48, { width: cardWidth, align: 'center' });
    
    // ===== INFORMAÇÕES DO CLIENTE =====
    y += 90;
    doc.rect(40, y, 515, 35).fill('#1e293b');
    doc.fontSize(9).font('Helvetica').fillColor('#94a3b8');
    
    const infoWidth = 515 / 4;
    doc.text('Cliente', 50, y + 5, { width: infoWidth });
    doc.font('Helvetica-Bold').fillColor('#fff').text(client.name, 50, y + 18, { width: infoWidth });
    
    doc.font('Helvetica').fillColor('#94a3b8').text('R$/Peça', 50 + infoWidth, y + 5, { width: infoWidth });
    doc.font('Helvetica-Bold').fillColor('#fff').text('R$ ' + client.pricePerPiece.toFixed(2), 50 + infoWidth, y + 18, { width: infoWidth });
    
    if (client.markingPrice > 0) {
      doc.font('Helvetica').fillColor('#94a3b8').text('R$/Marcação', 50 + infoWidth * 2, y + 5, { width: infoWidth });
      doc.font('Helvetica-Bold').fillColor('#fff').text('R$ ' + client.markingPrice.toFixed(2), 50 + infoWidth * 2, y + 18, { width: infoWidth });
    }
    
    doc.font('Helvetica').fillColor('#94a3b8').text('Ciclo', 50 + infoWidth * 3, y + 5, { width: infoWidth });
    doc.font('Helvetica-Bold').fillColor('#fff').text(client.billingCycle === 'biweekly' ? 'Quinzenal' : 'Mensal', 50 + infoWidth * 3, y + 18, { width: infoWidth });
    
    // ===== TABELA DE LANÇAMENTOS =====
    y += 50;
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#fff')
       .text('📋 Lançamentos do Período', 40, y);
    y += 20;
    
    // Cabeçalho da tabela
    const fields = client.fields || [];
    const colWidths = [70]; // Data
    fields.forEach(() => colWidths.push(Math.floor((515 - 70 - 80) / fields.length))); // Campos dinâmicos
    colWidths.push(80); // Valor
    
    let x = 40;
    doc.rect(40, y, 515, 22).fill(clientColor);
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#000');
    doc.text('Data', x + 5, y + 7, { width: colWidths[0] });
    x += colWidths[0];
    
    fields.forEach((field, i) => {
      doc.text(field.label, x + 5, y + 7, { width: colWidths[i + 1], align: 'center' });
      x += colWidths[i + 1];
    });
    doc.text('Valor', x + 5, y + 7, { width: colWidths[colWidths.length - 1], align: 'right' });
    
    y += 22;
    
    // Linhas da tabela
    doc.font('Helvetica').fontSize(9);
    entries.forEach((entry, idx) => {
      if (y > 750) {
        doc.addPage();
        y = 40;
      }
      
      const bgColor = idx % 2 === 0 ? '#1e293b' : '#0f172a';
      doc.rect(40, y, 515, 20).fill(bgColor);
      
      x = 40;
      doc.fillColor('#fff');
      
      // Data
      const dateStr = entry.date.split('-').reverse().slice(0, 2).join('/');
      doc.text(dateStr, x + 5, y + 6, { width: colWidths[0] });
      x += colWidths[0];
      
      // Campos
      fields.forEach((field, i) => {
        doc.fillColor('#94a3b8').text((entry[field.key] || 0).toString(), x + 5, y + 6, { width: colWidths[i + 1], align: 'center' });
        x += colWidths[i + 1];
      });
      
      // Valor
      doc.fillColor(clientColor).text('R$ ' + (entry.totalValue || 0).toFixed(2), x + 5, y + 6, { width: colWidths[colWidths.length - 1] - 10, align: 'right' });
      
      y += 20;
    });
    
    // Rodapé da tabela (totais)
    doc.rect(40, y, 515, 25).fill('#334155');
    x = 40;
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#fff');
    doc.text('TOTAIS', x + 5, y + 8, { width: colWidths[0] });
    x += colWidths[0];
    
    fields.forEach((field, i) => {
      doc.text((totals.byField[field.key] || 0).toString(), x + 5, y + 8, { width: colWidths[i + 1], align: 'center' });
      x += colWidths[i + 1];
    });
    doc.fillColor(clientColor).text('R$ ' + totals.value.toFixed(2), x + 5, y + 8, { width: colWidths[colWidths.length - 1] - 10, align: 'right' });
    
    // ===== RODAPÉ =====
    y = 800;
    doc.fontSize(8).font('Helvetica').fillColor('#64748b')
       .text('Gerado em ' + new Date().toLocaleString('pt-BR') + ' • Icarus.LAV v1.0 • Guilherme Braga', 40, y, { align: 'center', width: 515 });
    
    doc.end();
    
  } catch (error) {
    console.error('Erro ao gerar PDF LAV:', error);
    res.status(500).json({ ok: false, error: 'Erro ao gerar PDF' });
  }
});

// Endpoint para download do PDF gerado
app.get('/api/download-pdf/:id', (req, res) => {
  const pdfData = pdfStorage.get(req.params.id);
  
  if (!pdfData) {
    return res.status(404).json({ ok: false, error: 'PDF não encontrado ou expirado' });
  }
  
  const filename = (pdfData.title || 'relatorio').replace(/[^a-zA-Z0-9]/g, '_') + '.pdf';
  
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', pdfData.buffer.length);
  res.send(pdfData.buffer);
});

// Endpoint público (sem auth) para verificar versão
app.get('/api/version', (req, res) => {
  res.json({
    ok: true,
    version: CURRENT_APP_VERSION,
    changelog: APP_CHANGELOG,
    downloadUrl: APK_DOWNLOAD_URL
  });
});

// ============================================
// ENDPOINTS DE NOTAS & BOLETOS
// ============================================

// Listar notas do tenant
app.get('/api/notas', requireAuth, async (req, res) => {
  try {
    const tenantId = req.user.tenant_id;
    const result = await pool.query(
      `SELECT * FROM notas_boletos 
       WHERE tenant_id = $1 
       ORDER BY created_at DESC`,
      [tenantId]
    );
    
    // Parse dos anexos JSON
    const notas = result.rows.map(row => ({
      ...row,
      nota_anexo: row.nota_anexo ? JSON.parse(row.nota_anexo) : null,
      boleto_anexo: row.boleto_anexo ? JSON.parse(row.boleto_anexo) : null
    }));
    
    res.json({ ok: true, notas });
  } catch (err) {
    console.error('Erro ao buscar notas:', err);
    res.status(500).json({ ok: false, error: 'Erro ao buscar notas' });
  }
});

// Criar/Atualizar nota
app.post('/api/notas', requireAuth, async (req, res) => {
  try {
    const tenantId = req.user.tenant_id;
    const { nota } = req.body;
    
    if (!nota) {
      return res.status(400).json({ ok: false, error: 'Dados da nota não fornecidos' });
    }
    
    // Verificar se já existe
    const existing = await pool.query(
      'SELECT id FROM notas_boletos WHERE id = $1 AND tenant_id = $2',
      [nota.id, tenantId]
    );
    
    if (existing.rows.length > 0) {
      // Atualizar
      await pool.query(
        `UPDATE notas_boletos SET 
          empresa = $1,
          descricao = $2,
          responsavel = $3,
          setor = $4,
          valor_nota = $5,
          valor_boleto = $6,
          data_emissao = $7,
          data_vencimento = $8,
          status = $9,
          nota_anexo = $10,
          boleto_anexo = $11,
          updated_at = NOW()
        WHERE id = $12 AND tenant_id = $13`,
        [
          nota.empresa,
          nota.descricao,
          nota.responsavel,
          nota.setor,
          nota.valor_nota || 0,
          nota.valor_boleto || 0,
          nota.data_emissao,
          nota.data_vencimento,
          nota.status,
          nota.nota_anexo ? JSON.stringify(nota.nota_anexo) : null,
          nota.boleto_anexo ? JSON.stringify(nota.boleto_anexo) : null,
          nota.id,
          tenantId
        ]
      );
    } else {
      // Inserir
      await pool.query(
        `INSERT INTO notas_boletos 
          (id, tenant_id, empresa, descricao, responsavel, setor, 
           valor_nota, valor_boleto, data_emissao, data_vencimento, 
           status, nota_anexo, boleto_anexo, created_by, created_by_name, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())`,
        [
          nota.id,
          tenantId,
          nota.empresa,
          nota.descricao,
          nota.responsavel,
          nota.setor,
          nota.valor_nota || 0,
          nota.valor_boleto || 0,
          nota.data_emissao,
          nota.data_vencimento,
          nota.status,
          nota.nota_anexo ? JSON.stringify(nota.nota_anexo) : null,
          nota.boleto_anexo ? JSON.stringify(nota.boleto_anexo) : null,
          nota.created_by,
          nota.created_by_name
        ]
      );
    }
    
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao salvar nota:', err);
    res.status(500).json({ ok: false, error: 'Erro ao salvar nota' });
  }
});

// Excluir nota
app.delete('/api/notas/:id', requireAuth, async (req, res) => {
  try {
    const tenantId = req.user.tenant_id;
    const { id } = req.params;
    
    await pool.query(
      'DELETE FROM notas_boletos WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );
    
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao excluir nota:', err);
    res.status(500).json({ ok: false, error: 'Erro ao excluir nota' });
  }
});

// Sincronizar todas as notas (bulk save)
app.post('/api/notas/sync', requireAuth, async (req, res) => {
  try {
    const tenantId = req.user.tenant_id;
    const { notas } = req.body;
    
    if (!notas || !Array.isArray(notas)) {
      return res.status(400).json({ ok: false, error: 'Lista de notas não fornecida' });
    }
    
    for (const nota of notas) {
      const existing = await pool.query(
        'SELECT id FROM notas_boletos WHERE id = $1 AND tenant_id = $2',
        [nota.id, tenantId]
      );
      
      if (existing.rows.length > 0) {
        await pool.query(
          `UPDATE notas_boletos SET 
            empresa = $1, descricao = $2, responsavel = $3, setor = $4,
            valor_nota = $5, valor_boleto = $6, data_emissao = $7, data_vencimento = $8,
            status = $9, nota_anexo = $10, boleto_anexo = $11, updated_at = NOW()
          WHERE id = $12 AND tenant_id = $13`,
          [
            nota.empresa, nota.descricao, nota.responsavel, nota.setor,
            nota.valor_nota || 0, nota.valor_boleto || 0, nota.data_emissao, nota.data_vencimento,
            nota.status, nota.nota_anexo ? JSON.stringify(nota.nota_anexo) : null,
            nota.boleto_anexo ? JSON.stringify(nota.boleto_anexo) : null, nota.id, tenantId
          ]
        );
      } else {
        await pool.query(
          `INSERT INTO notas_boletos 
            (id, tenant_id, empresa, descricao, responsavel, setor, valor_nota, valor_boleto,
             data_emissao, data_vencimento, status, nota_anexo, boleto_anexo, created_by, created_by_name, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())`,
          [
            nota.id, tenantId, nota.empresa, nota.descricao, nota.responsavel, nota.setor,
            nota.valor_nota || 0, nota.valor_boleto || 0, nota.data_emissao, nota.data_vencimento,
            nota.status, nota.nota_anexo ? JSON.stringify(nota.nota_anexo) : null,
            nota.boleto_anexo ? JSON.stringify(nota.boleto_anexo) : null, nota.created_by, nota.created_by_name
          ]
        );
      }
    }
    
    res.json({ ok: true, synced: notas.length });
  } catch (err) {
    console.error('Erro ao sincronizar notas:', err);
    res.status(500).json({ ok: false, error: 'Erro ao sincronizar notas' });
  }
});

async function start() {
  try {
    await initDb();
    // periodic cleanup (every 6 hours)
    setInterval(async () => {
      try {
        await pool.query("DELETE FROM orders WHERE status = 'completed' AND finished_at < NOW() - INTERVAL '60 days'");
        await pool.query("DELETE FROM purchases WHERE status = 'chegou' AND created_at < NOW() - INTERVAL '60 days'");
        await pool.query("DELETE FROM preventives WHERE last_date IS NOT NULL AND last_date < NOW() - INTERVAL '60 days'");
        await pool.query("DELETE FROM checklist_executions WHERE executed_at < NOW() - INTERVAL '60 days'");
        // Arquivar tarefas aditivas concluídas há mais de 2 meses
        await pool.query("UPDATE additive_tasks SET archived_at = NOW() WHERE status = 'completed' AND executed_at < NOW() - INTERVAL '60 days' AND archived_at IS NULL");
      } catch (e) { /* noop */ }
    }, 6 * 60 * 60 * 1000);
    
    // Verificar preventivas a cada 2 horas e notificar
    if (pushNotifications) {
      setInterval(async () => {
        try {
          await pushNotifications.notifyPendingPreventives(pool);
        } catch (e) { console.log('Erro ao verificar preventivas:', e); }
      }, 2 * 60 * 60 * 1000);
      
      // Verificar imediatamente ao iniciar (após 1 minuto)
      setTimeout(async () => {
        try {
          await pushNotifications.notifyPendingPreventives(pool);
        } catch (e) { /* noop */ }
      }, 60 * 1000);
    }
    
    // ============= SCHEDULER DE CHECKLISTS AUTOMÁTICOS =============
    // Executa a cada minuto para verificar checklists no horário configurado
    async function executeAutoChecklists() {
      console.log('🔄 Verificando checklists automáticos...');
      try {
        // Buscar todos os checklists com auto_complete ativado
        const autoChecklists = await pool.query(
          `SELECT c.*, 
            COALESCE(json_agg(json_build_object('id', ci.id, 'description', ci.description) ORDER BY ci.item_order) FILTER (WHERE ci.id IS NOT NULL), '[]'::json) as items
           FROM checklists c
           LEFT JOIN checklist_items ci ON ci.checklist_id = c.id
           WHERE c.auto_complete = true
           GROUP BY c.id`
        );
        
        const now = new Date();
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        
        for (const checklist of autoChecklists.rows) {
          const freqDays = checklist.frequency_days || 2; // Padrão: dia sim dia não
          const lastRun = checklist.last_auto_run ? new Date(checklist.last_auto_run) : null;
          const autoTime = checklist.auto_time || '11:00';
          
          // Verificar se é o horário correto (com tolerância de 2 minutos)
          const [targetHour, targetMin] = autoTime.split(':').map(Number);
          const currentHour = now.getHours();
          const currentMin = now.getMinutes();
          const isCorrectTime = currentHour === targetHour && Math.abs(currentMin - targetMin) <= 2;
          
          if (!isCorrectTime) {
            continue; // Não é a hora ainda
          }
          
          // Verificar se já executou hoje
          const todayExec = await pool.query(
            `SELECT id FROM checklist_executions 
             WHERE checklist_id = $1 AND executed_at >= $2`,
            [checklist.id, today]
          );
          
          if (todayExec.rowCount > 0) {
            console.log(`  ⏭️ ${checklist.name}: já executado hoje`);
            continue;
          }
          
          // Calcular se deve executar hoje baseado na frequência
          let shouldExecute = false;
          
          if (!lastRun) {
            // Primeira execução
            shouldExecute = true;
          } else {
            // Calcular dias desde última execução
            const lastRunDate = new Date(lastRun);
            lastRunDate.setHours(0, 0, 0, 0);
            const diffTime = today.getTime() - lastRunDate.getTime();
            const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
            
            // Executar se passou o número de dias da frequência
            shouldExecute = diffDays >= freqDays;
          }
          
          if (shouldExecute) {
            console.log(`  ✅ Executando automaticamente: ${checklist.name} às ${autoTime}`);
            
            // Criar execução automática
            const execId = uuid();
            const executorId = checklist.auto_os_executor || null;
            await pool.query(
              `INSERT INTO checklist_executions (id, checklist_id, executed_by, notes, key_id)
               VALUES ($1, $2, $3, 'Execução automática', $4)`,
              [execId, checklist.id, executorId, checklist.key_id]
            );
            
            // Marcar todos os itens como checked
            const items = checklist.items || [];
            for (const item of items) {
              await pool.query(
                `INSERT INTO checklist_execution_items (execution_id, item_id, checked, checked_at, notes)
                 VALUES ($1, $2, true, NOW(), 'Auto')`,
                [execId, item.id]
              );
            }
            
            // Atualizar última execução
            await pool.query(
              `UPDATE checklists SET last_auto_run = NOW() WHERE id = $1`,
              [checklist.id]
            );
            
            // Se configurado para criar OS, criar e já fechar
            if (checklist.auto_create_os && checklist.auto_os_executor) {
              const osId = uuid();
              const osTitle = checklist.auto_os_title || `Checklist: ${checklist.name}`;
              const itemsDesc = items.map((item, i) => `${i + 1}. ${item.description}`).join('\n');
              const osDescription = `Originado do Checklist Automático: ${checklist.name}\n\nItens:\n${itemsDesc}\n\nExecutado automaticamente em ${new Date().toLocaleString('pt-BR')}`;
              
              // Criar a OS já como concluída
              await pool.query(
                `INSERT INTO orders (id, title, description, sector, priority, status, requested_by, started_at, finished_at, worked_minutes, key_id, created_at)
                 VALUES ($1, $2, $3, $4, 'low', 'completed', $5, NOW(), NOW(), 0, $6, NOW())`,
                [osId, osTitle, osDescription, checklist.sector || 'Manutenção', checklist.auto_os_executor, checklist.key_id]
              );
              
              // Atribuir ao executor
              await pool.query(
                `INSERT INTO order_users (order_id, user_id) VALUES ($1, $2)`,
                [osId, checklist.auto_os_executor]
              );
              
              console.log(`    📋 OS criada e fechada: ${osTitle}`);
            }
          } else {
            console.log(`  ⏸️ ${checklist.name}: aguardando ${freqDays - Math.floor((today - new Date(lastRun)) / (1000 * 60 * 60 * 24))} dias`);
          }
        }
        
        console.log('✅ Verificação de checklists automáticos concluída');
      } catch (err) {
        console.error('❌ Erro ao executar checklists automáticos:', err);
      }
    }
    
    // Verificar checklists a cada minuto
    setInterval(executeAutoChecklists, 60 * 1000);
    
    // Executar verificação 30 segundos após iniciar
    setTimeout(executeAutoChecklists, 30 * 1000);
    
    console.log('⏰ Scheduler de checklists automáticos iniciado (verifica a cada minuto)');
    
    app.listen(PORT, () => console.log(`API Icarus rodando na porta ${PORT}`));
  } catch (err) {
    console.error('Falha ao iniciar servidor', err);
    process.exit(1);
  }
}

start();
