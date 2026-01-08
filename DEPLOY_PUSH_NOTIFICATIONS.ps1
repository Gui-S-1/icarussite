# Deploy Push Notifications to Digital Ocean
# Run this script to update the backend with Firebase push notifications

# 1. SSH into server and navigate to backend
Write-Host "Conectando ao servidor..." -ForegroundColor Cyan

# 2. Create the files on the server
$sshCommand = @"
cd /opt/icarussite

# Create pushNotifications.js
cat > src/pushNotifications.js << 'ENDFILE'
// =============================================
// PUSH NOTIFICATIONS SERVICE - Firebase Admin
// =============================================

const admin = require('firebase-admin');
const path = require('path');

// Inicializar Firebase Admin
let firebaseInitialized = false;

function initializeFirebase() {
  if (firebaseInitialized) return;
  
  try {
    const serviceAccount = require('./firebase-config.json');
    
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id
    });
    
    firebaseInitialized = true;
    console.log('✅ Firebase Admin inicializado com sucesso');
  } catch (error) {
    console.error('❌ Erro ao inicializar Firebase:', error.message);
  }
}

// Inicializar ao carregar o módulo
initializeFirebase();

// =============================================
// FUNÇÕES DE ENVIO DE NOTIFICAÇÕES
// =============================================

async function sendToDevice(token, title, body, data = {}) {
  if (!firebaseInitialized) {
    console.warn('Firebase não inicializado');
    return null;
  }

  try {
    const message = {
      token: token,
      notification: { title, body },
      data: { ...data, click_action: 'OPEN_APP', timestamp: new Date().toISOString() },
      android: { priority: 'high', notification: { sound: 'default', channelId: 'icarus_notifications' } },
      apns: { payload: { aps: { sound: 'default', badge: 1 } } }
    };

    const response = await admin.messaging().send(message);
    console.log('✅ Notificação enviada:', response);
    return response;
  } catch (error) {
    console.error('❌ Erro ao enviar notificação:', error.message);
    return null;
  }
}

async function sendToMultipleDevices(tokens, title, body, data = {}) {
  if (!firebaseInitialized || !tokens || tokens.length === 0) return null;

  try {
    const message = {
      notification: { title, body },
      data: { ...data, click_action: 'OPEN_APP', timestamp: new Date().toISOString() },
      android: { priority: 'high', notification: { sound: 'default', channelId: 'icarus_notifications' } },
      tokens: tokens
    };

    const response = await admin.messaging().sendEachForMulticast(message);
    console.log('✅ Notificações enviadas: ' + response.successCount + '/' + tokens.length);
    return response;
  } catch (error) {
    console.error('❌ Erro ao enviar notificações:', error.message);
    return null;
  }
}

async function notifyNewOrder(db, order) {
  try {
    const result = await db.query(
      "SELECT DISTINCT pt.token FROM push_tokens pt JOIN users u ON pt.user_id = u.id WHERE u.roles && ARRAY['manutencao', 'admin', 'os_manage_all'] AND pt.active = true"
    );
    const tokens = result.rows.map(r => r.token);
    if (tokens.length === 0) return;
    await sendToMultipleDevices(tokens, '🔧 Nova OS Criada', order.title + ' - Prioridade: ' + (order.priority || 'Normal'), { type: 'new_order', order_id: String(order.id) });
  } catch (error) {
    console.error('Erro ao notificar nova OS:', error);
  }
}

async function notifyOrderCompleted(db, order) {
  try {
    const result = await db.query('SELECT pt.token FROM push_tokens pt WHERE pt.user_id = \$1 AND pt.active = true', [order.created_by]);
    const tokens = result.rows.map(r => r.token);
    if (tokens.length === 0) return;
    await sendToMultipleDevices(tokens, '✅ OS Concluída', '"' + order.title + '" foi finalizada!', { type: 'order_completed', order_id: String(order.id) });
  } catch (error) {
    console.error('Erro ao notificar OS concluída:', error);
  }
}

async function notifyJoacir(db, type, message) {
  try {
    const result = await db.query("SELECT pt.token FROM push_tokens pt JOIN users u ON pt.user_id = u.id WHERE LOWER(u.username) = 'joacir' AND pt.active = true");
    const tokens = result.rows.map(r => r.token);
    if (tokens.length === 0) return;
    const titles = { diesel: '⛽ Novo Abastecimento', purchase: '🛒 Nova Compra', purchase_delivered: '📦 Compra Entregue' };
    await sendToMultipleDevices(tokens, titles[type] || '📢 Notificação', message, { type: type });
  } catch (error) {
    console.error('Erro ao notificar Joacir:', error);
  }
}

async function notifyWaterAlert(db, alert) {
  try {
    const result = await db.query("SELECT pt.token FROM push_tokens pt JOIN users u ON pt.user_id = u.id WHERE LOWER(u.username) IN ('bruno', 'josewalter') AND pt.active = true");
    const tokens = result.rows.map(r => r.token);
    if (tokens.length === 0) return;
    await sendToMultipleDevices(tokens, '💧 Alerta de Água', alert.message, { type: 'water_alert', alert_type: alert.type });
  } catch (error) {
    console.error('Erro ao notificar alerta de água:', error);
  }
}

async function notifyPendingPreventives(db) {
  try {
    const result = await db.query("SELECT * FROM preventives WHERE next_date <= CURRENT_DATE AND status = 'active'");
    if (result.rows.length === 0) return;
    const tokensResult = await db.query("SELECT DISTINCT pt.token FROM push_tokens pt JOIN users u ON pt.user_id = u.id WHERE u.roles && ARRAY['manutencao', 'admin'] AND pt.active = true");
    const tokens = tokensResult.rows.map(r => r.token);
    if (tokens.length === 0) return;
    
    const hoje = new Date().toISOString().split('T')[0];
    const atrasadas = result.rows.filter(p => p.next_date < hoje);
    const vencem = result.rows.filter(p => p.next_date === hoje);

    if (atrasadas.length > 0) {
      await sendToMultipleDevices(tokens, '⚠️ Preventivas Atrasadas!', atrasadas.length + ' preventiva(s) precisam de atenção URGENTE', { type: 'preventive_overdue', count: String(atrasadas.length) });
    }
    if (vencem.length > 0) {
      await sendToMultipleDevices(tokens, '📅 Preventivas de Hoje', vencem.length + ' preventiva(s) vencem hoje', { type: 'preventive_today', count: String(vencem.length) });
    }
  } catch (error) {
    console.error('Erro ao notificar preventivas:', error);
  }
}

module.exports = {
  sendToDevice,
  sendToMultipleDevices,
  notifyNewOrder,
  notifyOrderCompleted,
  notifyJoacir,
  notifyWaterAlert,
  notifyPendingPreventives
};
ENDFILE

echo "✅ pushNotifications.js criado"

# Install firebase-admin
npm install firebase-admin

# Restart PM2
pm2 restart icarus-api

echo "✅ Deploy concluído!"
"@

Write-Host ""
Write-Host "================================================================" -ForegroundColor Yellow
Write-Host "ATENÇÃO: Execute os seguintes comandos no servidor:" -ForegroundColor Yellow
Write-Host "================================================================" -ForegroundColor Yellow
Write-Host ""
Write-Host "1. Conecte via SSH:" -ForegroundColor Cyan
Write-Host "   ssh root@159.203.8.237" -ForegroundColor White
Write-Host ""
Write-Host "2. Crie o arquivo firebase-config.json:" -ForegroundColor Cyan
Write-Host "   nano /opt/icarussite/src/firebase-config.json" -ForegroundColor White
Write-Host ""
Write-Host "3. Cole o conteúdo do arquivo JSON do Firebase" -ForegroundColor Yellow
Write-Host ""
Write-Host "4. Crie o pushNotifications.js:" -ForegroundColor Cyan
Write-Host "   O conteúdo está em:" -ForegroundColor Yellow
Write-Host "   c:\Users\Eduardo\Desktop\Icarus\backend\src\pushNotifications.js" -ForegroundColor White
Write-Host ""
Write-Host "5. Instale firebase-admin:" -ForegroundColor Cyan
Write-Host "   cd /opt/icarussite && npm install firebase-admin" -ForegroundColor White
Write-Host ""
Write-Host "6. Atualize o server.js com as alterações" -ForegroundColor Cyan
Write-Host ""
Write-Host "7. Reinicie o servidor:" -ForegroundColor Cyan
Write-Host "   pm2 restart icarus-api" -ForegroundColor White
Write-Host ""
Write-Host "================================================================" -ForegroundColor Yellow
