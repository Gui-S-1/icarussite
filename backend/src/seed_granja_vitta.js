require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false }
});

async function upsertTenantKey(keyValue, keyName) {
  const existing = await pool.query('SELECT id FROM tenant_keys WHERE key_value = $1', [keyValue]);
  if (existing.rowCount > 0) return existing.rows[0].id;
  const id = uuid();
  await pool.query('INSERT INTO tenant_keys (id, key_value, name) VALUES ($1,$2,$3)', [id, keyValue, keyName]);
  return id;
}

async function upsertUser({ username, name, password, roles, keyId }) {
  const found = await pool.query('SELECT id FROM users WHERE username = $1 AND key_id = $2', [username, keyId]);
  if (found.rowCount > 0) {
    const id = found.rows[0].id;
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      await pool.query('UPDATE users SET name = $1, roles = $2, password_hash = $3 WHERE id = $4', [name, roles, hash, id]);
    } else {
      await pool.query('UPDATE users SET name = $1, roles = $2 WHERE id = $3', [name, roles, id]);
    }
    return id;
  }
  const id = uuid();
  const hash = await bcrypt.hash(password || '123456', 10);
  await pool.query('INSERT INTO users (id, username, name, password_hash, roles, key_id) VALUES ($1,$2,$3,$4,$5,$6)', [id, username, name, hash, roles, keyId]);
  return id;
}

async function main() {
  // Ensure core tables exist
  await pool.query('SELECT 1');

  const keyId = await upsertTenantKey(process.env.SEED_KEY_VALUE || 'granja-vitta-key', process.env.SEED_KEY_NAME || 'Granja Vitta');

  const users = [
    // Admin
    { username: 'admin', name: 'Administrador', password: process.env.SEED_USER_PASSWORD || 'admin123', roles: ['admin','os','os_manage_all','preventivas','almoxarifado','compras'], keyId },
    // Manutenção executores
    { username: 'eduardo', name: 'Eduardo', roles: ['os','os_manage_all','preventivas','almoxarifado'], keyId },
    { username: 'declie', name: 'Declie', roles: ['os','os_manage_all','preventivas','almoxarifado'], keyId },
    { username: 'alisson', name: 'Alisson', roles: ['os','os_manage_all','preventivas','almoxarifado'], keyId },
    { username: 'vanderlei', name: 'Vanderlei', roles: ['os','os_manage_all','preventivas','almoxarifado'], keyId },
    // Edmilson: criar OS
    { username: 'edmilson', name: 'Edmilson', roles: ['os'], keyId },
    // Sala de ovos: Erica/Irene (OS + checklist sala de ovos)
    { username: 'erica', name: 'Erica', roles: ['os','checklist_ovos'], keyId },
    { username: 'irene', name: 'Irene', roles: ['os','checklist_ovos'], keyId },
    // Bruno: pode fazer OS e ver outras (somente leitura para as outras)
    { username: 'bruno', name: 'Bruno', roles: ['os','os_view_all'], keyId },
    // Jose Walter: igual Bruno + checklist granja
    { username: 'josewalter', name: 'Jose Walter', roles: ['os','os_view_all','checklist_granja'], keyId },
    // Joacir: OS + compras manager
    { username: 'joacir', name: 'Joacir', roles: ['os','compras'], keyId }
  ];

  for (const u of users) {
    await upsertUser({ ...u, password: '123456' });
  }

  console.log('Seed concluído para Granja Vitta.');
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
