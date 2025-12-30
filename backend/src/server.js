require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { v4: uuid } = require('uuid');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false }
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenant_keys (
      id TEXT PRIMARY KEY,
      key_value TEXT UNIQUE NOT NULL,
      name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

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
      notes TEXT,
      recorded_by TEXT REFERENCES users(id),
      key_id TEXT REFERENCES tenant_keys(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Índice para consultas rápidas por data e tanque
    CREATE INDEX IF NOT EXISTS idx_water_readings_date ON water_readings(reading_date, tank_name);
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
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '12h' });
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.replace('Bearer ', '');
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
app.use(cors());
app.use(express.json());

function requireRoles(roles) {
  return (req, res, next) => {
    const userRoles = (req.user && req.user.roles) || [];
    if (userRoles.includes('admin')) return next();
    if (!roles || roles.length === 0) return next();
    const ok = roles.some(r => userRoles.includes(r));
    return ok ? next() : res.status(403).json({ ok: false, error: 'Forbidden' });
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

app.post('/auth/validate-key', async (req, res) => {
  const { key } = req.body || {};
  if (!key) return res.status(400).json({ ok: false, error: 'Chave obrigatória' });
  try {
    const result = await pool.query('SELECT id, name FROM tenant_keys WHERE key_value = $1', [key]);
    if (result.rowCount === 0) return res.status(401).json({ ok: false, error: 'Chave inválida' });
    const row = result.rows[0];
    return res.json({ ok: true, key_id: row.id, tenant: row.name });
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
      'SELECT id, username, name, password_hash, roles, key_id FROM users WHERE username = $1 AND key_id = $2',
      [username, key_id]
    );
    if (userResult.rowCount === 0) return res.status(401).json({ ok: false, error: 'Usuário não encontrado' });
    const user = userResult.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ ok: false, error: 'Senha inválida' });

    const token = buildToken({ userId: user.id, roles: user.roles, keyId: user.key_id, name: user.name, username: user.username });
    return res.json({ ok: true, token, user: { id: user.id, name: user.name, username: user.username, roles: user.roles, key_id: user.key_id } });
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
    `SELECT o.*, COALESCE(json_agg(json_build_object('id', u.id, 'username', u.username, 'name', u.name)) FILTER (WHERE u.id IS NOT NULL), '[]'::json) AS assigned_users
     FROM orders o
     LEFT JOIN order_assignments oa ON oa.order_id = o.id
     LEFT JOIN users u ON u.id = oa.user_id
     WHERE o.key_id = $1
     GROUP BY o.id
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

app.post('/orders', requireAuth, requireRoles(['os']), async (req, res) => {
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

    const orders = await fetchOrders(req.user.keyId);
    return res.status(201).json({ ok: true, orders });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.patch('/orders/:id', requireAuth, requireRoles(['os']), async (req, res) => {
  const { status, assigned_user_ids, progress_note } = req.body || {};
  const orderId = req.params.id;
  try {
    const allowedStatus = ['pending', 'in_progress', 'completed'];
    if (status && !allowedStatus.includes(status)) {
      return res.status(400).json({ ok: false, error: 'Status inválido' });
    }

    const result = await pool.query('SELECT * FROM orders WHERE id = $1 AND key_id = $2', [orderId, req.user.keyId]);
    if (result.rowCount === 0) return res.status(404).json({ ok: false, error: 'OS não encontrada' });

    const order = result.rows[0];
    const canManageAll = (req.user.roles || []).includes('admin') || (req.user.roles || []).includes('os_manage_all');
    if (!canManageAll && order.requested_by !== req.user.userId) {
      return res.status(403).json({ ok: false, error: 'Sem permissão para alterar esta OS' });
    }
    const nextStatus = status || order.status;
    const startedAt = nextStatus === 'in_progress' && !order.started_at ? new Date() : order.started_at;
    const finishedAt = nextStatus === 'completed' ? new Date() : order.finished_at;

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
      `UPDATE orders SET status = $1, progress_note = COALESCE($2, progress_note), started_at = $3, finished_at = $4 WHERE id = $5 AND key_id = $6`,
      [nextStatus, progress_note, startedAt, finishedAt, orderId, req.user.keyId]
    );

    if (Array.isArray(assigned_user_ids)) {
      await pool.query('DELETE FROM order_assignments WHERE order_id = $1', [orderId]);
      if (assigned_user_ids.length > 0) {
        const values = assigned_user_ids.map((uid, idx) => `($1, $${idx + 2})`).join(',');
        await pool.query(`INSERT INTO order_assignments (order_id, user_id) VALUES ${values}`,[orderId, ...assigned_user_ids]);
      }
    }

    const orders = await fetchOrders(req.user.keyId);
    const updated = orders.find(o => o.id === orderId);
    return res.json({ ok: true, order: updated, assigned_users: updated ? updated.assigned_users : [] });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete('/orders/:id', requireAuth, requireRoles(['os']), async (req, res) => {
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

app.get('/purchases', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM purchases WHERE key_id = $1 ORDER BY created_at DESC', [req.user.keyId]);
    return res.json({ ok: true, purchases: normalizePurchases(result.rows) });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// Anyone with os/almoxarifado/compras can create purchase requests
app.post('/purchases', requireAuth, requireRoles(['compras','almoxarifado','os']), async (req, res) => {
  const { item_name, quantity, unit, unit_price, total_cost, supplier, notes, photo_url } = req.body || {};
  if (!item_name || !quantity || !unit) return res.status(400).json({ ok: false, error: 'Campos obrigatórios faltando' });
  try {
    const id = uuid();
    await pool.query(
      `INSERT INTO purchases (id, item_name, quantity, unit, unit_price, total_cost, supplier, notes, photo_url, status, requested_by, key_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'analise',$10,$11)` ,
      [id, item_name, quantity, unit, unit_price || 0, total_cost || 0, supplier || null, notes || null, photo_url || null, req.user.userId, req.user.keyId]
    );
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
      reading_value: Number(r.reading_value)
    }));
    
    return res.json({ ok: true, readings });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// POST - Adicionar nova leitura de água
app.post('/water-readings', requireAuth, async (req, res) => {
  const { tank_name, reading_value, reading_time, reading_date, notes } = req.body || {};
  
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
        'UPDATE water_readings SET reading_value = $1, notes = $2, recorded_by = $3 WHERE id = $4',
        [reading_value, notes || null, req.user.userId, existing.rows[0].id]
      );
    } else {
      // Inserir nova leitura
      const id = uuid();
      await pool.query(
        `INSERT INTO water_readings (id, tank_name, reading_value, reading_time, reading_date, notes, recorded_by, key_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, tank_name.toLowerCase(), reading_value, reading_time, reading_date, notes || null, req.user.userId, req.user.keyId]
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
      reading_value: Number(r.reading_value)
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
      
      // Calcular consumo diário (7h dia X - 7h dia X+1 = consumo 24h)
      const dates = Object.keys(byDate).sort();
      let totalConsumption = 0;
      
      for (let i = 0; i < dates.length - 1; i++) {
        const currentDate = dates[i];
        const nextDate = dates[i + 1];
        
        const morning7h = byDate[currentDate]['07:00'];
        const nextMorning7h = byDate[nextDate] ? byDate[nextDate]['07:00'] : null;
        
        if (morning7h !== undefined && nextMorning7h !== undefined) {
          const consumption = morning7h - nextMorning7h;
          if (consumption >= 0) {
            stats[tank].daily_consumption.push({
              date: currentDate,
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

// DELETE - Remover leitura (admin only)
app.delete('/water-readings/:id', requireAuth, requireRoles(['admin']), async (req, res) => {
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
      } catch (e) { /* noop */ }
    }, 6 * 60 * 60 * 1000);
    app.listen(PORT, () => console.log(`API Icarus rodando na porta ${PORT}`));
  } catch (err) {
    console.error('Falha ao iniciar servidor', err);
    process.exit(1);
  }
}

start();
