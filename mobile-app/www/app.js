// Global State
const state = {
  token: null,
  user: null,
  keyId: null,  // Armazenar key_id para usar no login
  orders: [],
  users: [],
  inventory: [],
  preventives: [],
  purchases: [],
  checklists: [],
  waterReadings: [],
  waterPeriod: 'day',
  waterStats: null,
  currentView: 'dashboard',
  dashboardFilter: 'daily', // daily, weekly, monthly
  dashboardMonth: null, // null = mês atual, ou 'YYYY-MM' para mês específico
  dashboardRankings: [], // Rankings de produtividade (OS + Aditiva)
  lastOrderCount: 0,
  lastPreventiveCheck: new Date(),
  // Diesel Control
  dieselRecords: [],
  dieselStats: null,
  dieselPeriod: 'month',
  dieselSelectedMonth: null, // null = período atual, ou 'YYYY-MM' para mês específico
  // Generator Control
  generatorRecords: [],
  generatorStats: null,
  generatorPeriod: 'month',
  // Aditiva Control
  additiveTasks: [],
  additiveStats: null,
  additiveFilter: 'active', // 'active' ou 'archived'
  // Lavanderia Control
  laundryClients: [],
  laundryEntries: [],
  laundryStats: null,
  laundryPeriod: 'month',
  // Relatórios
  reports: [],
  reportCategory: 'all',
  currentReport: null,
  // Offline/Online status
  isOnline: navigator.onLine
};

const API_URL = (typeof window !== 'undefined' && window.ICARUS_API_URL)
  ? window.ICARUS_API_URL
  : 'http://localhost:4000';

// ========================================
// PUSH NOTIFICATIONS - Capacitor
// ========================================
const APP_VERSION = '1.0.8';

async function initPushNotifications() {
  try {
    // Verificar se estamos no Capacitor (app nativo)
    if (typeof Capacitor === 'undefined' || !Capacitor.isNativePlatform()) {
      console.log('Push Notifications: Não está em ambiente nativo');
      return;
    }

    const { PushNotifications } = Capacitor.Plugins;
    if (!PushNotifications) {
      console.log('Push Notifications: Plugin não disponível');
      return;
    }

    // Verificar permissões
    let permStatus = await PushNotifications.checkPermissions();
    console.log('Push Permissions:', permStatus.receive);
    
    if (permStatus.receive === 'prompt') {
      // Pedir permissão ao usuário
      permStatus = await PushNotifications.requestPermissions();
      console.log('Push Permissions após request:', permStatus.receive);
    }

    if (permStatus.receive !== 'granted') {
      console.log('Push Notifications: Permissão negada');
      showNotification('Ative as notificações nas configurações do app', 'warning');
      return;
    }

    // Registrar para receber notificações
    await PushNotifications.register();
    console.log('Push Notifications: Registrando...');

    // Listener quando o token é recebido
    await PushNotifications.addListener('registration', async (token) => {
      console.log('Push Token recebido:', token.value);
      // Enviar token para o servidor
      await registerPushToken(token.value);
    });

    // Listener de erro no registro
    await PushNotifications.addListener('registrationError', (error) => {
      console.error('Erro no registro push:', error);
      showNotification('Erro ao registrar notificações: ' + (error.error || 'desconhecido'), 'error');
    });

    // Listener quando notificação é recebida (app aberto)
    await PushNotifications.addListener('pushNotificationReceived', (notification) => {
      console.log('Notificação recebida:', notification);
      // Mostrar notificação in-app
      showNotification(notification.title + ': ' + notification.body, 'info');
      
      // Atualizar dados
      if (notification.data?.type === 'new_order' || notification.data?.type === 'order_completed') {
        loadOrders();
      }
    });

    // Listener quando usuário toca na notificação
    await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      console.log('Ação na notificação:', action);
      const data = action.notification.data;
      
      // Navegar para a view correta
      if (data?.type === 'new_order' || data?.type === 'order_completed') {
        navigateTo('os');
      } else if (data?.type === 'water_alert') {
        navigateTo('water');
      } else if (data?.type === 'preventive_overdue' || data?.type === 'preventive_today') {
        navigateTo('preventive');
      }
    });

    console.log('Push Notifications inicializado com sucesso');
  } catch (error) {
    console.error('Erro ao inicializar Push Notifications:', error);
  }
}

// Registrar token no servidor
async function registerPushToken(token) {
  if (!state.token || !token) {
    console.log('registerPushToken: token do app ou FCM ausente');
    return;
  }
  
  try {
    console.log('Enviando token FCM para servidor...');
    const response = await fetch(`${API_URL}/api/push-tokens`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${state.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        token: token,
        device_type: 'android'
      })
    });
    
    const data = await response.json();
    if (data.ok) {
      console.log('Token push registrado com sucesso no servidor');
      localStorage.setItem('push_token', token);
      showNotification('Notificações ativadas!', 'success');
    } else {
      console.error('Erro ao registrar token:', data.error);
    }
  } catch (error) {
    console.error('Erro ao registrar token push:', error);
  }
}

// ========================================
// APP UPDATE SYSTEM - Atualização In-App
// ========================================

async function checkAppVersion() {
  try {
    const response = await fetch(`${API_URL}/api/app-version`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    
    if (!response.ok) return;
    
    const data = await response.json();
    if (data.ok && data.version && data.version !== APP_VERSION) {
      // Nova versão disponível
      const isRequired = data.required || false;
      showUpdateDialog(data.version, data.changelog || 'Melhorias e correções.', data.downloadUrl, isRequired);
    }
  } catch (error) {
    console.log('Não foi possível verificar atualizações:', error);
  }
}

function showUpdateDialog(version, changelog, downloadUrl, required) {
  // Remover dialog existente se houver
  const existing = document.getElementById('update-dialog');
  if (existing) existing.remove();
  
  const dialog = document.createElement('div');
  dialog.id = 'update-dialog';
  dialog.className = 'modal-overlay';
  dialog.style.display = 'flex';
  dialog.innerHTML = `
    <div class="modal-content" style="max-width: 400px;">
      <div class="modal-header">
        <h3>🚀 Nova Atualização Disponível!</h3>
        ${!required ? '<button class="modal-close" onclick="closeUpdateDialog()">×</button>' : ''}
      </div>
      <div class="modal-body">
        <div style="text-align: center; margin-bottom: 20px;">
          <div style="font-size: 48px; margin-bottom: 10px;">📱</div>
          <h4 style="color: var(--gold); margin: 0;">Versão ${version}</h4>
          <p style="color: var(--text-secondary); margin: 5px 0;">Atual: ${APP_VERSION}</p>
        </div>
        <div style="background: var(--card-bg); padding: 15px; border-radius: 8px; margin-bottom: 20px;">
          <h5 style="margin: 0 0 10px; color: var(--gold);">O que há de novo:</h5>
          <p style="margin: 0; color: var(--text-secondary); font-size: 14px;">${changelog}</p>
        </div>
        ${required ? '<p style="color: var(--danger); text-align: center; font-size: 12px;">⚠️ Esta atualização é obrigatória para continuar usando o app.</p>' : ''}
      </div>
      <div class="modal-footer">
        ${!required ? '<button class="btn btn-secondary" onclick="closeUpdateDialog()">Depois</button>' : ''}
        <button class="btn btn-primary" onclick="downloadUpdate(\\'${downloadUrl}\\')">
          <span>📥</span> Baixar Atualização
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(dialog);
}

function closeUpdateDialog() {
  const dialog = document.getElementById('update-dialog');
  if (dialog) dialog.remove();
}

async function downloadUpdate(url) {
  if (!url) {
    showNotification('URL de download não disponível', 'error');
    return;
  }
  
  try {
    // Verificar se estamos no Capacitor
    if (typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform()) {
      const { Browser } = Capacitor.Plugins;
      if (Browser) {
        await Browser.open({ url: url });
      } else {
        window.open(url, '_system');
      }
    } else {
      window.open(url, '_blank');
    }
    
    showNotification('Download iniciado! Após baixar, instale o APK.', 'success');
    closeUpdateDialog();
  } catch (error) {
    console.error('Erro ao baixar atualização:', error);
    showNotification('Erro ao iniciar download', 'error');
  }
}

// ========================================
// FORCE APP UPDATE - Limpa cache e recarrega
// ========================================

async function forceAppUpdate() {
  showNotification('🔄 Limpando cache e atualizando...', 'info');
  
  try {
    // 1. Limpar caches do localStorage
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('icarus_cache_')) {
        localStorage.removeItem(key);
      }
    });
    
    // 2. Limpar Service Worker cache (se existir)
    if ('caches' in window) {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames.map(cacheName => caches.delete(cacheName))
      );
    }
    
    // 3. Unregister Service Workers
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(
        registrations.map(reg => reg.unregister())
      );
    }
    
    // 4. Mostrar mensagem de sucesso
    showNotification('✅ Cache limpo! Recarregando...', 'success');
    
    // 5. Recarregar a página com cache busting
    setTimeout(() => {
      window.location.href = window.location.origin + window.location.pathname + '?v=' + Date.now();
    }, 1000);
    
  } catch (error) {
    console.error('Erro ao forçar atualização:', error);
    showNotification('Erro ao atualizar. Tentando recarregar...', 'warning');
    setTimeout(() => window.location.reload(true), 1000);
  }
}

// ========================================
// CACHE OFFLINE - Salva dados localmente
// ========================================

const CACHE_KEYS = {
  orders: 'icarus_cache_orders',
  purchases: 'icarus_cache_purchases',
  inventory: 'icarus_cache_inventory',
  preventives: 'icarus_cache_preventives',
  waterReadings: 'icarus_cache_water',
  dieselRecords: 'icarus_cache_diesel'
};

// Renovar token em background para atualizar roles sem deslogar
async function refreshTokenInBackground() {
  try {
    const response = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${state.token}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data.ok) {
        // Atualizar token e usuário com dados novos
        state.token = data.token;
        state.user = data.user;
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        
        // Atualizar permissões com as novas roles
        setupPermissions();
        setupMobileNavPermissions();
        console.log('Token renovado em background, roles atualizadas');
      }
    }
  } catch (error) {
    console.log('Não foi possível renovar token em background:', error);
  }
}

// Salvar dados no localStorage (comprimido)
function saveToCache(key, data) {
  try {
    const cacheData = {
      timestamp: Date.now(),
      data: data
    };
    localStorage.setItem(key, JSON.stringify(cacheData));
  } catch (e) {
    console.warn('Erro ao salvar cache:', e);
    // Se localStorage cheio, limpar caches antigos
    clearOldCache();
  }
}

// Carregar dados do cache
function loadFromCache(key) {
  try {
    const cached = localStorage.getItem(key);
    if (!cached) return null;
    const parsed = JSON.parse(cached);
    // Cache válido por 24 horas
    if (Date.now() - parsed.timestamp > 24 * 60 * 60 * 1000) {
      localStorage.removeItem(key);
      return null;
    }
    return parsed.data;
  } catch (e) {
    return null;
  }
}

// Limpar caches antigos
function clearOldCache() {
  Object.values(CACHE_KEYS).forEach(key => {
    try {
      const cached = localStorage.getItem(key);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Date.now() - parsed.timestamp > 48 * 60 * 60 * 1000) {
          localStorage.removeItem(key);
        }
      }
    } catch (e) {}
  });
}

// Detectar mudança online/offline
window.addEventListener('online', () => {
  state.isOnline = true;
  showNotification('🌐 Conectado! Atualizando dados...', 'success');
  // Recarregar dados quando voltar online
  if (state.token) {
    loadViewData(state.currentView);
  }
});

window.addEventListener('offline', () => {
  state.isOnline = false;
  showNotification('📴 Modo offline - usando dados salvos', 'warning');
});

// ========================================
// SECURITY: Sanitization Functions
// ========================================

// Escape HTML to prevent XSS attacks
function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  if (typeof text !== 'string') text = String(text);
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Sanitize a string for use in HTML attributes (IDs, onclick, etc)
function sanitizeId(str) {
  if (!str) return '';
  return String(str).replace(/[^a-zA-Z0-9\-_]/g, '');
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  // Setup navigation PRIMEIRO (antes de qualquer coisa)
  setupNavigation();
  
  // Tentativa de retomar sessão salva (token + user)
  const savedToken = localStorage.getItem('token');
  const savedUser = localStorage.getItem('user');
  const savedKey = localStorage.getItem('icarus_key');
  const savedUsername = localStorage.getItem('icarus_username');

  if (savedKey) {
    const keyInput = document.getElementById('key-input');
    if (keyInput) keyInput.value = savedKey;
  }
  if (savedUsername) {
    const userInput = document.getElementById('username-input');
    if (userInput) userInput.value = savedUsername;
  }
  
  // Carregar senha salva se existir
  const savedPassword = localStorage.getItem('icarus_password_enc');
  if (savedPassword && savedUsername) {
    const passInput = document.getElementById('password-input');
    if (passInput) passInput.value = atob(savedPassword); // Decodificar base64
    const rememberCheck = document.getElementById('remember-login');
    if (rememberCheck) rememberCheck.checked = true;
  }

  if (savedToken && savedUser) {
    try {
      state.token = savedToken;
      state.user = JSON.parse(savedUser);
      document.getElementById('loading-screen').classList.add('hidden');
      showApp();
      
      // Tentar renovar token em background para atualizar roles
      refreshTokenInBackground();
      return;
    } catch (e) {
      console.warn('Falha ao restaurar sessão, limpando cache', e);
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    }
  }

  setTimeout(() => {
    document.getElementById('loading-screen').classList.add('hidden');
    document.getElementById('auth-screen').classList.remove('hidden');
  }, 500);
});

function setupNavigation() {
  document.querySelectorAll('.nav-item').forEach(item => {
    // Remove listeners antigos para evitar duplicação
    item.replaceWith(item.cloneNode(true));
  });
  
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const view = item.getAttribute('data-view');
      console.log('Clicou em:', view);
      if (view) {
        navigateTo(view);
      }
    });
  });
  console.log('Navegação configurada');
}

// Navigation
function navigateTo(view) {
  console.log('Navegando para:', view);
  console.log('User roles:', state.user?.roles);
  
  state.currentView = view; // Salvar view atual para polling
  
  // Update active nav
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.remove('active');
    if (item.getAttribute('data-view') === view) {
      item.classList.add('active');
      console.log('Nav item ativado:', item);
    }
  });

  // Update active view - ESCONDER TODAS primeiro
  document.querySelectorAll('.view').forEach(v => {
    v.classList.remove('active');
  });

  const activeView = document.getElementById(`${view}-view`);
  console.log('View encontrada:', activeView);
  if (activeView) {
    activeView.classList.add('active');
    console.log('View ativada com sucesso');
  } else {
    console.error('View não encontrada para:', view);
  }

  // SCROLL PARA O TOPO ao trocar de view - IMPORTANTE!
  const contentContainer = document.querySelector('.content');
  if (contentContainer) {
    contentContainer.scrollTop = 0;
  }
  window.scrollTo(0, 0);

  loadViewData(view).catch(err => console.error('Erro ao carregar view:', err));
}

async function loadViewData(view) {
  try {
    switch(view) {
      case 'dashboard':
        await loadDashboard();
        break;
      case 'os':
        await loadOrders();
        await loadHistoryCount();
        break;
      case 'almoxarifado':
        await loadInventory();
        break;
      case 'compras':
        await loadPurchases();
        break;
      case 'preventivas':
        await loadPreventives();
        break;
      case 'checklists':
        await loadChecklists();
        break;
      case 'controle-agua':
        await loadWaterControl();
        break;
      case 'controle-diesel':
        await loadDieselControl();
        break;
      case 'controle-gerador':
        await loadGeneratorControl();
        break;
      case 'aditiva':
        await loadAditiva();
        break;
      case 'lavanderia':
        await loadLavanderia();
        break;
      case 'relatorios':
        await loadRelatorios();
        break;
      case 'configuracoes':
        loadConfigurations();
        break;
    }
  } catch (error) {
    console.error('Erro em loadViewData:', error);
  }
}

// Authentication
async function validateKey() {
  const key = document.getElementById('key-input').value;
  const errorDiv = document.getElementById('auth-error');

  if (!key) {
    showError('Digite uma chave');
    return;
  }

  try {
    const response = await fetch(`${API_URL}/auth/validate-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key })
    });

    const data = await response.json();

    if (data.ok) {
      state.keyId = data.key_id;
      state.tenantType = data.tenant_type || 'granja';
      localStorage.setItem('icarus_key', key);
      // Salvar nome da empresa e tipo de tenant
      if (data.company_name) {
        localStorage.setItem('icarus_company', data.company_name);
      }
      localStorage.setItem('icarus_tenant_type', data.tenant_type || 'granja');
      document.getElementById('key-validation-form').classList.add('hidden');
      document.getElementById('login-form').classList.remove('hidden');
      errorDiv.classList.add('hidden');
    } else {
      showError(data.error || 'Chave inválida');
    }
  } catch (error) {
    showError('Erro ao validar chave: ' + error.message);
  }
}

async function login() {
  const username = document.getElementById('username-input').value;
  const password = document.getElementById('password-input').value;

  if (!username || !password) {
    showError('Preencha todos os campos');
    return;
  }

  try {
    const response = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        key_id: state.keyId,  // Incluir key_id no login
        username, 
        password 
      })
    });

    const data = await response.json();

    if (data.ok) {
      state.token = data.token;
      state.user = data.user;
      state.tenantType = data.user.tenant_type || localStorage.getItem('icarus_tenant_type') || 'granja';
      localStorage.setItem('icarus_username', username);
    
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      
      // Salvar tenant_type e nome da empresa
      if (data.user.tenant_type) {
        localStorage.setItem('icarus_tenant_type', data.user.tenant_type);
      }
      if (data.user.tenant_name) {
        localStorage.setItem('icarus_company', data.user.tenant_name);
      }
      
      // Salvar senha se checkbox marcado
      const rememberCheck = document.getElementById('remember-login');
      if (rememberCheck && rememberCheck.checked) {
        localStorage.setItem('icarus_password_enc', btoa(password)); // Codificar em base64
      } else {
        localStorage.removeItem('icarus_password_enc');
      }

      // Check if salaovos user - show operator selection popup
      if (username.toLowerCase() === 'salaovos') {
        window.afterUserSelection = showAppWithWelcome;
        openUserSelectionPopup();
      } else {
        showAppWithWelcome();
      }
    } else {
      showError(data.error || 'Login inválido');
    }
  } catch (error) {
    showError('Erro ao fazer login: ' + error.message);
  }
}

// Mostrar tela de boas-vindas animada antes do app
async function showAppWithWelcome() {
  // Esconder tela de auth
  document.getElementById('auth-screen').classList.add('hidden');
  
  // Preparar tela de boas-vindas
  const welcomeScreen = document.getElementById('welcome-screen');
  const welcomeUserName = document.getElementById('welcome-user-name');
  const welcomeCompanyName = document.getElementById('welcome-company-name');
  
  // Pegar nome do usuário e empresa
  const userName = state.user?.name || 'Usuário';
  const companyName = localStorage.getItem('icarus_company') || 'Granja Vitta';
  
  if (welcomeUserName) welcomeUserName.textContent = userName;
  if (welcomeCompanyName) welcomeCompanyName.textContent = companyName;
  
  // Mostrar tela de boas-vindas
  welcomeScreen.classList.remove('hidden');
  
  // Aguardar animação (3.5 segundos) e depois mostrar o app
  setTimeout(() => {
    welcomeScreen.classList.add('hidden');
    showApp();
  }, 3500);
}

async function showApp() {
  document.getElementById('auth-screen').classList.add('hidden');
  const welcomeScreen = document.getElementById('welcome-screen');
  if (welcomeScreen) welcomeScreen.classList.add('hidden');
  document.getElementById('app-screen').style.display = 'flex';

  // Setup user info
  const avatar = state.user.name.substring(0, 2).toUpperCase();
  document.getElementById('user-avatar').textContent = avatar;
  
  // If operator selected, show it in the name
  // Busca operador específico por username
  const username = state.user?.username || localStorage.getItem('icarus_username') || 'default';
  const selectedOperator = localStorage.getItem(`selectedOperator_${username}`);
  const displayName = selectedOperator ? `${state.user.name} (${selectedOperator})` : state.user.name;
  document.getElementById('user-name').textContent = displayName;

  // Setup permissions e navegação (IMPORTANTE: refazer para garantir que funciona)
  setupPermissions();
  setupNavigation();
  
  // Inicializar Push Notifications (importante: depois do login)
  setTimeout(() => initPushNotifications(), 1000);

  // Load initial data
  await loadUsers(); // Carregar usuários primeiro
  
  // Determinar view inicial baseado no tipo de tenant e permissões
  const roles = state.user.roles || [];
  const tenantType = state.tenantType || state.user?.tenant_type || localStorage.getItem('icarus_tenant_type') || 'granja';
  const isLavanderia = tenantType === 'lavanderia';
  const canSeeDashboard = roles.includes('admin') || roles.includes('os_manage_all') || roles.includes('os_view_all');
  
  if (isLavanderia) {
    // Lavanderias vão direto para o módulo de lavanderia
    navigateTo('lavanderia');
  } else if (canSeeDashboard) {
    navigateTo('dashboard');
  } else {
    navigateTo('os');
  }

  // Polling em tempo real a cada 5 segundos para atualizar views
  setInterval(() => {
    if (state.currentView && state.token) {
      loadViewData(state.currentView).catch(err => console.error('Erro no polling:', err));
    }
  }, 5000);
  
  // Verificar atualizações do app
  setTimeout(() => checkAppVersion(), 2000);
  
  // Inicializar busca rápida (Ctrl+K)
  initQuickSearch();
}

function setupPermissions() {
  const roles = state.user.roles || [];
  const isAdmin = roles.includes('admin');
  const tenantType = state.tenantType || state.user?.tenant_type || localStorage.getItem('icarus_tenant_type') || 'granja';
  
  // ========== ISOLAMENTO POR TIPO DE EMPRESA ==========
  // Se for lavanderia, só mostra módulos de lavanderia
  const isLavanderia = tenantType === 'lavanderia';
  
  // ========== SISTEMA DE PERMISSÕES POR ABA ==========
  // Cada aba tem uma role específica para VER e outra para EDITAR
  // Role 'admin' tem acesso total a tudo
  
  // Dashboard: dashboard (ver) - Lavanderia NÃO tem dashboard separado, só o módulo lavanderia
  const canSeeDashboard = !isLavanderia && (isAdmin || roles.includes('dashboard') || roles.includes('os_manage_all') || roles.includes('os_view_all'));
  
  // Ordens de Serviço: os (ver/criar), os_manage_all (gerenciar todas)
  // OS sempre visível para granja, oculto para lavanderia
  const canSeeOS = !isLavanderia;
  
  // Almoxarifado: almoxarifado_view (ver), almoxarifado (editar) - só granja
  // Manutenção (os_manage_all) pode VER o almoxarifado para consultar peças
  const canSeeAlmox = !isLavanderia && (isAdmin || roles.includes('almoxarifado') || roles.includes('almoxarifado_view') || roles.includes('os_manage_all') || roles.includes('tech'));
  const canEditAlmox = !isLavanderia && (isAdmin || roles.includes('almoxarifado'));
  
  // Compras: compras_view (ver), compras (editar), compras_request (pode enviar pedidos) - só granja
  const canSeeCompras = !isLavanderia && (isAdmin || roles.includes('compras') || roles.includes('compras_view') || roles.includes('compras_request'));
  const canEditCompras = !isLavanderia && (isAdmin || roles.includes('compras'));
  const canRequestCompras = !isLavanderia && (isAdmin || roles.includes('compras') || roles.includes('compras_request'));
  
  // Preventivas: preventivas_view (ver), preventivas (editar) - só granja
  const canSeePrev = !isLavanderia && (isAdmin || roles.includes('preventivas') || roles.includes('preventivas_view'));
  const canEditPrev = !isLavanderia && (isAdmin || roles.includes('preventivas'));
  
  // Checklists: checklist (ver), checklist_manage (editar) - só granja
  const canSeeChecklists = !isLavanderia && (isAdmin || roles.includes('checklist') || roles.includes('checklist_manage') || roles.includes('os_manage_all'));
  const canEditChecklists = !isLavanderia && (isAdmin || roles.includes('checklist_manage') || roles.includes('os_manage_all'));
  
  // Controle de Água: agua (ver), agua_manage (editar) - só granja
  const canSeeWater = !isLavanderia && (isAdmin || roles.includes('agua') || roles.includes('agua_manage') || roles.includes('os_manage_all'));
  const canEditWater = !isLavanderia && (isAdmin || roles.includes('agua_manage') || roles.includes('os_manage_all'));
  
  // Controle de Diesel: diesel (ver), diesel_manage (editar) - só granja
  const canSeeDiesel = !isLavanderia && (isAdmin || roles.includes('diesel') || roles.includes('diesel_manage') || roles.includes('os_manage_all'));
  const canEditDiesel = !isLavanderia && (isAdmin || roles.includes('diesel_manage') || roles.includes('os_manage_all'));
  
  // Gerador: gerador (ver), gerador_manage (editar) - só granja
  const canSeeGerador = !isLavanderia && (isAdmin || roles.includes('gerador') || roles.includes('gerador_manage') || roles.includes('os_manage_all'));
  const canEditGerador = !isLavanderia && (isAdmin || roles.includes('gerador_manage') || roles.includes('os_manage_all'));

  // Aditiva: aditiva_view (ver), aditiva (editar - só manutenção) - só granja
  const canSeeAditiva = !isLavanderia && (isAdmin || roles.includes('aditiva') || roles.includes('aditiva_view') || roles.includes('os_manage_all'));
  const canEditAditiva = !isLavanderia && (isAdmin || roles.includes('aditiva') || roles.includes('os_manage_all'));

  // Lavanderia: só para tenant de lavanderia OU quem tem role lavanderia
  const canSeeLavanderia = isLavanderia || isAdmin || roles.includes('lavanderia');
  const canEditLavanderia = isLavanderia || isAdmin || roles.includes('lavanderia');

  // Relatórios: relatorios (ver), relatorios_write (escrever - só manutenção) - só granja por enquanto
  const canSeeRelatorios = !isLavanderia && (isAdmin || roles.includes('relatorios') || roles.includes('relatorios_write') || roles.includes('os_manage_all'));
  const canWriteRelatorios = !isLavanderia && (isAdmin || roles.includes('relatorios_write') || roles.includes('os_manage_all'));

  // Elementos de navegação
  const navDashboard = document.querySelector('[data-view="dashboard"]');
  const navOS = document.querySelector('[data-view="os"]');
  const navAlmox = document.querySelector('[data-view="almoxarifado"]');
  const navCompras = document.querySelector('[data-view="compras"]');
  const navPrev = document.querySelector('[data-view="preventivas"]');
  const navChecklists = document.querySelector('[data-view="checklists"]');
  const navWater = document.querySelector('[data-view="controle-agua"]');
  const navDiesel = document.querySelector('[data-view="controle-diesel"]');
  const navGerador = document.querySelector('[data-view="controle-gerador"]');
  const navAditiva = document.querySelector('[data-view="aditiva"]');
  const navLavanderia = document.querySelector('[data-view="lavanderia"]');
  const navRel = document.querySelector('[data-view="relatorios"]');
  const navCfg = document.querySelector('[data-view="configuracoes"]');

  // Aplicar visibilidade das abas (considerando tenant_type)
  if (navDashboard) navDashboard.classList.toggle('hidden', !canSeeDashboard);
  if (navOS) navOS.classList.toggle('hidden', !canSeeOS); // OS oculto para lavanderia
  if (navAlmox) navAlmox.classList.toggle('hidden', !canSeeAlmox);
  if (navCompras) navCompras.classList.toggle('hidden', !canSeeCompras);
  if (navPrev) navPrev.classList.toggle('hidden', !canSeePrev);
  if (navChecklists) navChecklists.classList.toggle('hidden', !canSeeChecklists);
  if (navWater) navWater.classList.toggle('hidden', !canSeeWater);
  if (navDiesel) navDiesel.classList.toggle('hidden', !canSeeDiesel);
  if (navGerador) navGerador.classList.toggle('hidden', !canSeeGerador);
  if (navAditiva) navAditiva.classList.toggle('hidden', !canSeeAditiva);
  if (navLavanderia) navLavanderia.classList.toggle('hidden', !canSeeLavanderia);
  if (navRel) navRel.classList.toggle('hidden', !canSeeRelatorios);
  if (navCfg) navCfg.classList.toggle('hidden', isLavanderia); // Esconder config para lavanderia
  
  // Aplicar classe lavanderia-mode no body para esconder sidebar
  if (isLavanderia) {
    document.body.classList.add('lavanderia-mode');
  } else {
    document.body.classList.remove('lavanderia-mode');
  }
  
  // Salvar tipo de tenant e permissões no state
  state.tenantType = tenantType;
  state.isLavanderiaMode = isLavanderia;
  state.canEditDiesel = canEditDiesel;
  state.canEditGerador = canEditGerador;
  state.canEditWater = canEditWater;
  state.canEditAlmox = canEditAlmox;
  state.canEditCompras = canEditCompras;
  state.canRequestCompras = canRequestCompras;
  state.canEditPreventivas = canEditPrev;
  state.canEditChecklists = canEditChecklists;
  state.canEditAditiva = canEditAditiva;
  state.canWriteRelatorios = canWriteRelatorios;
  
  console.log('Permissões configuradas. Roles:', roles, 'Pode editar diesel:', canEditDiesel, 'Pode editar gerador:', canEditGerador);
  
  // Atualizar navegação mobile baseado nas permissões
  setupMobileNavPermissions();
}

// Configura visibilidade dos itens da navegação mobile baseado nas permissões
function setupMobileNavPermissions() {
  const roles = state.user?.roles || [];
  const isAdmin = roles.includes('admin');
  const tenantType = state.tenantType || localStorage.getItem('icarus_tenant_type') || 'granja';
  const isLavanderia = tenantType === 'lavanderia';
  
  // Mesmas regras de permissão do setupPermissions - considerando tenant_type
  // Para lavanderia: não tem dashboard separado, só o módulo lavanderia
  const canSeeDashboard = !isLavanderia && (isAdmin || roles.includes('dashboard') || roles.includes('os_manage_all') || roles.includes('os_view_all'));
  const canSeeOS = !isLavanderia;
  const canSeeWater = !isLavanderia && (isAdmin || roles.includes('agua') || roles.includes('agua_manage') || roles.includes('os_manage_all'));
  const canSeeDiesel = !isLavanderia && (isAdmin || roles.includes('diesel') || roles.includes('diesel_manage') || roles.includes('os_manage_all'));
  const canSeeGerador = !isLavanderia && (isAdmin || roles.includes('gerador') || roles.includes('gerador_manage') || roles.includes('os_manage_all'));
  const canSeeChecklists = !isLavanderia && (isAdmin || roles.includes('checklist') || roles.includes('checklist_manage') || roles.includes('os_manage_all'));
  const canSeeAditiva = !isLavanderia && (isAdmin || roles.includes('aditiva') || roles.includes('aditiva_view') || roles.includes('os_manage_all'));
  const canSeeRelatorios = !isLavanderia && (isAdmin || roles.includes('relatorios') || roles.includes('relatorios_write') || roles.includes('os_manage_all'));
  const canSeeCompras = !isLavanderia && (isAdmin || roles.includes('compras') || roles.includes('compras_view') || roles.includes('compras_request'));
  const canSeeLavanderia = isLavanderia || isAdmin || roles.includes('lavanderia');
  const canSeeMore = !isLavanderia; // Esconder "Mais" para lavanderia
  
  // Itens da barra de navegação mobile principal
  const mobileNavDashboard = document.querySelector('.mobile-nav-item[data-view="dashboard"]');
  const mobileNavOS = document.querySelector('.mobile-nav-item[data-view="os"]');
  const mobileNavWater = document.querySelector('.mobile-nav-item[data-view="controle-agua"]');
  const mobileNavDiesel = document.querySelector('.mobile-nav-item[data-view="controle-diesel"]');
  const mobileNavLavanderia = document.querySelector('.mobile-nav-item[data-view="lavanderia"]');
  const mobileNavMore = document.querySelector('.mobile-nav-item[data-view="mobile-more"]');
  
  if (mobileNavDashboard) mobileNavDashboard.style.display = canSeeDashboard ? '' : 'none';
  if (mobileNavOS) mobileNavOS.style.display = canSeeOS ? '' : 'none';
  if (mobileNavWater) mobileNavWater.style.display = canSeeWater ? '' : 'none';
  if (mobileNavDiesel) mobileNavDiesel.style.display = canSeeDiesel ? '' : 'none';
  if (mobileNavLavanderia) mobileNavLavanderia.style.display = canSeeLavanderia ? '' : 'none';
  if (mobileNavMore) mobileNavMore.style.display = canSeeMore ? '' : 'none';
  
  // Se for lavanderia, marcar a nav de lavanderia como ativa
  if (isLavanderia && mobileNavLavanderia) {
    document.querySelectorAll('.mobile-nav-item').forEach(item => item.classList.remove('active'));
    mobileNavLavanderia.classList.add('active');
  }
  
  // Itens do menu "Mais" mobile
  const moreGerador = document.querySelector('.mobile-more-item[onclick*="controle-gerador"]');
  const moreChecklist = document.querySelector('.mobile-more-item[onclick*="checklist"]');
  const moreAditiva = document.querySelector('.mobile-more-item[onclick*="aditiva"]');
  const moreRelatorios = document.querySelector('.mobile-more-item[onclick*="relatorios"]');
  const moreCompras = document.querySelector('.mobile-more-item[onclick*="compras"]');
  const moreAlmoxarifado = document.querySelector('.mobile-more-item[onclick*="almoxarifado"]');
  const moreConfig = document.querySelector('.mobile-more-item[onclick*="configuracoes"]');
  
  // Permissão para almoxarifado mobile
  const canSeeAlmoxMobile = !isLavanderia && (isAdmin || roles.includes('almoxarifado') || roles.includes('almoxarifado_view') || roles.includes('os_manage_all') || roles.includes('tech'));
  
  if (moreGerador) moreGerador.style.display = canSeeGerador ? '' : 'none';
  if (moreChecklist) moreChecklist.style.display = canSeeChecklists ? '' : 'none';
  if (moreAditiva) moreAditiva.style.display = canSeeAditiva ? '' : 'none';
  if (moreRelatorios) moreRelatorios.style.display = canSeeRelatorios ? '' : 'none';
  if (moreCompras) moreCompras.style.display = canSeeCompras ? '' : 'none';
  if (moreAlmoxarifado) moreAlmoxarifado.style.display = canSeeAlmoxMobile ? '' : 'none';
  if (moreConfig) moreConfig.style.display = !isLavanderia ? '' : 'none';
}

function showError(message) {
  const errorDiv = document.getElementById('auth-error');
  errorDiv.textContent = message;
  errorDiv.classList.remove('hidden');
}

// Dashboard
function setDashboardFilter(filter) {
  state.dashboardFilter = filter;
  
  // Update button states - usar IDs corretos com sufixo -new
  const filterDaily = document.getElementById('filter-daily-new');
  const filterWeekly = document.getElementById('filter-weekly-new');
  const filterMonthly = document.getElementById('filter-monthly-new');
  
  if (filterDaily) filterDaily.classList.remove('active');
  if (filterWeekly) filterWeekly.classList.remove('active');
  if (filterMonthly) filterMonthly.classList.remove('active');
  
  const filterBtn = document.getElementById(`filter-${filter}-new`);
  if (filterBtn) filterBtn.classList.add('active');
  
  // Se escolheu mês específico, força monthly
  if (state.dashboardMonth && filter !== 'monthly') {
    state.dashboardMonth = null;
    document.getElementById('filter-month').value = '';
  }
  
  // Update labels
  const labels = {
    daily: { period: 'hoje', period2: 'do dia', productivity: '(Hoje)' },
    weekly: { period: 'semana', period2: 'da semana', productivity: '(Esta Semana)' },
    monthly: { period: 'mês', period2: 'do mês', productivity: '(Este Mês)' }
  };
  
  const periodLabel = document.getElementById('stat-period-label');
  const periodLabel2 = document.getElementById('stat-period-label2');
  const productivityPeriod = document.getElementById('productivity-period');
  
  if (periodLabel && labels[filter]) periodLabel.textContent = labels[filter].period;
  if (periodLabel2 && labels[filter]) periodLabel2.textContent = labels[filter].period2;
  if (productivityPeriod && labels[filter]) productivityPeriod.textContent = labels[filter].productivity;
  
  // Reload dashboard
  updateDashboardStats();
}

function setDashboardMonth(monthValue) {
  state.dashboardMonth = monthValue || null;
  
  if (monthValue) {
    // Força filtro mensal quando seleciona mês específico
    state.dashboardFilter = 'monthly';
    const dEl = document.getElementById('filter-daily-new');
    const wEl = document.getElementById('filter-weekly-new');
    const mEl = document.getElementById('filter-monthly-new');
    if (dEl) dEl.classList.remove('active');
    if (wEl) wEl.classList.remove('active');
    if (mEl) mEl.classList.add('active');
    
    // Atualiza label com nome do mês
    const [year, month] = monthValue.split('-');
    const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const monthLabel = `${monthNames[parseInt(month) - 1]}/${year}`;
    
    const periodLabel = document.getElementById('stat-period-label');
    const periodLabel2 = document.getElementById('stat-period-label2');
    if (periodLabel) periodLabel.textContent = monthLabel;
    if (periodLabel2) periodLabel2.textContent = 'de ' + monthLabel;
  }
  
  updateDashboardStats();
}

function initMonthSelector() {
  const select = document.getElementById('filter-month');
  if (!select) return;
  
  const now = new Date();
  const months = [];
  const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 
                      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  
  // Últimos 12 meses
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = `${monthNames[d.getMonth()]} ${d.getFullYear()}`;
    months.push({ value, label });
  }
  
  select.innerHTML = '<option value="">Mês Atual</option>' + 
    months.map(m => `<option value="${m.value}">${m.label}</option>`).join('');
}

function getDateRange() {
  const now = new Date();
  let startDate, endDate;
  
  // Se tem mês específico selecionado
  if (state.dashboardMonth) {
    const [year, month] = state.dashboardMonth.split('-').map(Number);
    startDate = new Date(year, month - 1, 1);
    endDate = new Date(year, month, 0, 23, 59, 59, 999);
    return { startDate, endDate };
  }
  
  switch(state.dashboardFilter) {
    case 'daily':
      startDate = new Date(now.setHours(0, 0, 0, 0));
      endDate = new Date(now.setHours(23, 59, 59, 999));
      break;
    case 'weekly':
      // Segunda a Sábado
      const dayOfWeek = now.getDay();
      const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // Se domingo, voltar 6 dias
      startDate = new Date(now);
      startDate.setDate(now.getDate() + diff);
      startDate.setHours(0, 0, 0, 0);
      
      endDate = new Date(startDate);
      endDate.setDate(startDate.getDate() + 5); // Até sábado
      endDate.setHours(23, 59, 59, 999);
      break;
    case 'monthly':
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      break;
  }
  
  return { startDate, endDate };
}

async function loadDashboard() {
  try {
    // Inicializa seletor de meses
    initMonthSelector();
    
    const response = await fetch(`${API_URL}/orders`, {
      headers: {
        'Authorization': `Bearer ${state.token}`
      }
    });

    const data = await response.json();
    if (data.ok) {
      state.orders = data.orders;
      setDashboardFilter(state.dashboardFilter); // Apply current filter
    }
  } catch (error) {
    console.error('Erro ao carregar dashboard:', error);
  }
}

function updateDashboardStats() {
  // Get filtered date range
  const { startDate, endDate } = getDateRange();
  
  // Filter orders by date range
  const filteredOrders = state.orders.filter(order => {
    const orderDate = new Date(order.created_at);
    return orderDate >= startDate && orderDate <= endDate;
  });
  
  const pending = filteredOrders.filter(o => o.status === 'pending').length;
  const inProgress = filteredOrders.filter(o => o.status === 'in_progress').length;
  const paused = filteredOrders.filter(o => o.status === 'paused').length;
  
  const completedInPeriod = filteredOrders.filter(o => 
    o.status === 'completed' && o.finished_at
  ).length;

  const createdInPeriod = filteredOrders.length;

  const statPending = document.getElementById('stat-pending');
  const statProgress = document.getElementById('stat-progress');
  const statCompleted = document.getElementById('stat-completed');
  const statTotal = document.getElementById('stat-total');
  const statPaused = document.getElementById('stat-paused');

  if (statPending) statPending.textContent = pending;
  if (statProgress) statProgress.textContent = inProgress + paused;
  if (statPaused) statPaused.textContent = paused;
  if (statCompleted) statCompleted.textContent = completedInPeriod;
  if (statTotal) statTotal.textContent = createdInPeriod;

  // Update period labels
  const periodLabels = { daily: 'hoje', weekly: 'semana', monthly: 'mês' };
  const periodLabel = periodLabels[state.dashboardFilter] || 'hoje';
  const label1 = document.getElementById('stat-period-label');
  const label2 = document.getElementById('stat-period-label2');
  if (label1) label1.textContent = periodLabel;
  if (label2) label2.textContent = 'do ' + periodLabel;

  // Update dashboard date
  const dashDate = document.getElementById('dashboard-date');
  if (dashDate) {
    const now = new Date();
    dashDate.textContent = now.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
  }

  // Productivity chart with combined OS + Aditiva stats
  loadDashboardStats();

  // Update summary stats
  updateDashboardSummary(filteredOrders, completedInPeriod, createdInPeriod);

  // Recent activity - compact format
  renderRecentActivity();
  
  // Carregar dados de checklists para o dashboard
  loadChecklistDashboard();
}

// ========== CHECKLIST DASHBOARD ==========
async function loadChecklistDashboard() {
  try {
    const response = await fetch(`${API_URL}/checklists/dashboard-stats`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    
    const data = await response.json();
    if (data.ok) {
      renderChecklistDashboard(data);
    }
  } catch (error) {
    console.error('Erro ao carregar checklist dashboard:', error);
    // Fallback com dados mock se endpoint não existir
    renderChecklistDashboard({
      today_total: 0,
      today_auto: 0,
      today_manual: 0,
      pending: 0,
      streak_days: 0,
      recent_executions: []
    });
  }
}

function renderChecklistDashboard(data) {
  // Atualizar stats
  const totalEl = document.getElementById('chk-total-exec');
  const autoEl = document.getElementById('chk-auto-exec');
  const manualEl = document.getElementById('chk-manual-exec');
  const pendingEl = document.getElementById('chk-pending');
  const streakEl = document.getElementById('streak-days');
  
  if (totalEl) totalEl.textContent = data.today_total || 0;
  if (autoEl) autoEl.textContent = data.today_auto || 0;
  if (manualEl) manualEl.textContent = data.today_manual || 0;
  if (pendingEl) pendingEl.textContent = data.pending || 0;
  if (streakEl) streakEl.textContent = data.streak_days || 0;
  
  // Atualizar ring chart
  const total = (data.today_auto || 0) + (data.today_manual || 0) + (data.pending || 0);
  const completed = (data.today_auto || 0) + (data.today_manual || 0);
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  
  const ringProgress = document.getElementById('ring-progress');
  const ringPercent = document.getElementById('ring-percent');
  
  if (ringProgress) {
    const circumference = 2 * Math.PI * 40; // 251.2
    const dashArray = (percent / 100) * circumference;
    ringProgress.style.strokeDasharray = `${dashArray} ${circumference}`;
    ringProgress.style.stroke = percent >= 80 ? '#10b981' : percent >= 50 ? '#f59e0b' : '#ef4444';
  }
  if (ringPercent) {
    ringPercent.textContent = percent + '%';
    ringPercent.style.color = percent >= 80 ? '#10b981' : percent >= 50 ? '#f59e0b' : '#ef4444';
  }
  
  // Atualizar legend
  const legendAuto = document.getElementById('legend-auto');
  const legendManual = document.getElementById('legend-manual');
  const legendPending = document.getElementById('legend-pending');
  
  if (legendAuto) legendAuto.textContent = data.today_auto || 0;
  if (legendManual) legendManual.textContent = data.today_manual || 0;
  if (legendPending) legendPending.textContent = data.pending || 0;
  
  // Renderizar timeline
  renderChecklistTimeline(data.recent_executions || []);
}

function renderChecklistTimeline(executions) {
  const container = document.getElementById('timeline-items');
  if (!container) return;
  
  if (executions.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 20px; color: rgba(255,255,255,0.4); font-size: 12px;">
        Nenhuma execução hoje
      </div>
    `;
    return;
  }
  
  container.innerHTML = executions.slice(0, 5).map(exec => {
    const isAuto = exec.is_auto || false;
    const time = exec.executed_at ? new Date(exec.executed_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
    const name = exec.checklist_name || 'Checklist';
    
    return `
      <div class="timeline-item">
        <div class="timeline-item-icon ${isAuto ? 'auto' : 'manual'}">
          ${isAuto 
            ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4"/></svg>'
            : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>'
          }
        </div>
        <div class="timeline-item-info">
          <div class="timeline-item-name">${escapeHtml(name)}</div>
          <div class="timeline-item-time">${time} • ${isAuto ? 'Automático' : 'Manual'}</div>
        </div>
      </div>
    `;
  }).join('');
}

function updateDashboardSummary(filteredOrders, completed, total) {
  // Taxa de conclusão
  const rate = total > 0 ? Math.round((completed / total) * 100) : 0;
  const rateEl = document.getElementById('completion-rate');
  if (rateEl) rateEl.textContent = rate + '%';

  // OS Criadas
  const createdEl = document.getElementById('created-count');
  if (createdEl) createdEl.textContent = total;

  // Técnico destaque (quem mais concluiu)
  const completedOrders = filteredOrders.filter(o => o.status === 'completed');
  const techStats = {};
  completedOrders.forEach(order => {
    if (order.assigned_users && Array.isArray(order.assigned_users)) {
      order.assigned_users.forEach(user => {
        const name = user.name || user.username;
        techStats[name] = (techStats[name] || 0) + 1;
      });
    }
  });
  const topTech = Object.entries(techStats).sort((a, b) => b[1] - a[1])[0];
  const topTechEl = document.getElementById('top-tech');
  if (topTechEl) topTechEl.textContent = topTech ? `${topTech[0]} (${topTech[1]})` : '-';

  // Tempo médio (placeholder - precisa de finished_at no backend)
  const avgTimeEl = document.getElementById('avg-time');
  if (avgTimeEl) avgTimeEl.textContent = '-';
}

function renderRecentActivity() {
  const recent = state.orders.slice(0, 8);
  const container = document.getElementById('recent-activity');
  if (!container) return;

  if (recent.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px 20px; color: rgba(196, 181, 253, 0.6);">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity: 0.4; margin-bottom: 12px;">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
        </svg>
        <p style="font-size: 14px; margin: 0;">Nenhuma atividade recente</p>
      </div>
    `;
    return;
  }

  container.innerHTML = recent.map(order => {
    const time = formatTimeAgo(order.created_at);
    const titleRaw = order.title.length > 28 ? order.title.substring(0, 28) + '...' : order.title;
    const title = escapeHtml(titleRaw);
    const user = order.assigned_users?.[0]?.name || order.requested_by_name || '-';
    
    let iconClass = 'created';
    let iconSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>';
    
    if (order.status === 'completed') {
      iconClass = 'completed';
      iconSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
    } else if (order.status === 'in_progress' || order.status === 'paused') {
      iconClass = 'started';
      iconSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>';
    }
    
    return `
      <div class="activity-item-neo" onclick="showOSDetail('${sanitizeId(order.id)}')" style="cursor: pointer;">
        <div class="activity-icon-neo ${iconClass}">${iconSvg}</div>
        <div class="activity-content-neo">
          <div class="activity-title-neo">${title}</div>
          <div class="activity-meta-neo">
            <span>${user}</span>
            <span>•</span>
            <span>${time}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function formatTimeAgo(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = Math.floor((now - date) / 1000);
  
  if (diff < 60) return 'agora';
  if (diff < 3600) return Math.floor(diff / 60) + 'min atrás';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h atrás';
  if (diff < 604800) return Math.floor(diff / 86400) + 'd atrás';
  return date.toLocaleDateString('pt-BR');
}

async function loadDashboardStats() {
  try {
    const period = state.dashboardFilter || 'monthly';
    const response = await fetch(`${API_URL}/dashboard/stats?period=${period}`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await response.json();
    if (data.ok) {
      state.dashboardRankings = data.rankings || [];
      renderProductivityChart();
    }
  } catch (error) {
    console.error('Erro ao carregar stats:', error);
    // Fallback para método antigo se endpoint não existir
    renderProductivityChartLegacy(state.orders);
  }
}

function renderProductivityChart() {
  const rankings = state.dashboardRankings || [];
  const container = document.getElementById('productivity-chart');
  if (!container) return;
  
  if (rankings.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px 20px; color: rgba(196, 181, 253, 0.6);">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity: 0.4; margin-bottom: 12px;">
          <line x1="18" y1="20" x2="18" y2="10"/>
          <line x1="12" y1="20" x2="12" y2="4"/>
          <line x1="6" y1="20" x2="6" y2="14"/>
        </svg>
        <p style="font-size: 14px; margin: 0;">Nenhuma tarefa concluída ainda</p>
      </div>
    `;
    return;
  }
  
  const maxCount = rankings[0]?.total_tasks || 1;
  
  const chartHtml = rankings.slice(0, 5).map(user => {
    const percentage = (user.total_tasks / maxCount) * 100;
    const avgTime = user.avg_minutes_per_task > 0 ? `${user.avg_minutes_per_task}min` : '';
    const initials = user.user_name ? user.user_name.split(' ').map(n => n[0]).join('').substring(0, 2) : '??';
    
    return `
      <div class="productivity-bar-neo">
        <div class="productivity-avatar">${initials}</div>
        <div class="productivity-info">
          <div class="productivity-name-neo">${escapeHtml(user.user_name)}</div>
          <div class="productivity-bar-track">
            <div class="productivity-bar-fill-neo" style="width: ${percentage}%"></div>
          </div>
        </div>
        <div class="productivity-stats">
          <span title="Total">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
              <polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
            ${user.total_tasks}
          </span>
          <span title="OS">${user.os_completed} OS</span>
          ${avgTime ? `<span title="Tempo médio">${avgTime}</span>` : ''}
        </div>
      </div>
    `;
  }).join('');
  
  container.innerHTML = chartHtml;
}

function renderProductivityChartLegacy(filteredOrders = state.orders) {
  const completedOrders = filteredOrders.filter(o => o.status === 'completed');
  
  // Contar OS por usuário (assigned_users) - todos os usuários da equipe de manutenção
  const userStats = {};
  
  completedOrders.forEach(order => {
    if (order.assigned_users && Array.isArray(order.assigned_users)) {
      order.assigned_users.forEach(user => {
        const username = user.username.toLowerCase();
        const displayName = user.name || username;
        // Usar o nome para exibição mas username como chave
        if (!userStats[username]) {
          userStats[username] = { count: 0, name: displayName };
        }
        userStats[username].count++;
      });
    }
  });
  
  // Ordenar por quantidade (maior para menor)
  const sorted = Object.entries(userStats).sort((a, b) => b[1].count - a[1].count);
  const maxCount = sorted.length > 0 ? sorted[0][1].count : 1;
  
  const chartHtml = sorted.length > 0 ? sorted.map(([username, data]) => {
    const percentage = (data.count / maxCount) * 100;
    return `
      <div class="productivity-bar">
        <div class="productivity-name">${data.name}</div>
        <div class="productivity-bar-container">
          <div class="productivity-bar-fill" style="width: ${percentage}%">
            <span class="productivity-count">${data.count}</span>
          </div>
        </div>
        <div class="productivity-total">${data.count}</div>
      </div>
    `;
  }).join('') : '<p style="color: var(--text-secondary); padding: 20px;">Nenhuma OS concluída ainda</p>';
  
  document.getElementById('productivity-chart').innerHTML = chartHtml;
}

// Orders
async function loadOrders() {
  try {
    // Tentar carregar do cache primeiro se offline
    if (!state.isOnline) {
      const cached = loadFromCache(CACHE_KEYS.orders);
      if (cached) {
        state.orders = cached;
        renderOrdersTable();
        updateOSBadge();
        return;
      }
    }
    
    const response = await fetch(`${API_URL}/orders`, {
      headers: {
        'Authorization': `Bearer ${state.token}`
      }
    });

    const data = await response.json();
    if (data.ok) {
      state.orders = data.orders;
      saveToCache(CACHE_KEYS.orders, data.orders); // Salvar no cache
      renderOrdersTable();
      updateOSBadge(); // Atualizar badge no header
    }
  } catch (error) {
    console.error('Erro ao carregar OS:', error);
    // Fallback para cache em caso de erro
    const cached = loadFromCache(CACHE_KEYS.orders);
    if (cached) {
      state.orders = cached;
      renderOrdersTable();
      updateOSBadge();
    }
  }
}

function updateOSBadge() {
  const badge = document.getElementById('os-badge');
  if (!badge) return;
  
  const pending = state.orders.filter(o => o.status === 'pending').length;
  badge.textContent = pending;
  badge.style.display = pending > 0 ? 'block' : 'none';
  
  if (pending > 5) {
    badge.style.background = 'var(--danger)';
    badge.style.animation = 'pulse 2s infinite';
  } else if (pending > 0) {
    badge.style.background = 'var(--warning)';
    badge.style.animation = 'none';
  }
}

function updateOSStats() {
  // Calculate stats
  const urgentes = state.orders.filter(o => o.priority === 'high' && o.status !== 'completed').length;
  const emAndamento = state.orders.filter(o => o.status === 'in_progress').length;
  const pendentes = state.orders.filter(o => o.status === 'pending').length;
  
  // Get completed this month
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const concluidasMes = state.orders.filter(o => {
    if (o.status !== 'completed' || !o.finished_at) return false;
    const finishedDate = new Date(o.finished_at);
    return finishedDate >= startOfMonth;
  }).length;
  
  // Update UI
  const urgentesEl = document.getElementById('os-urgentes');
  const emAndamentoEl = document.getElementById('os-em-andamento');
  const pendentesEl = document.getElementById('os-pendentes');
  const concluidasEl = document.getElementById('os-concluidas-mes');
  
  if (urgentesEl) urgentesEl.textContent = urgentes;
  if (emAndamentoEl) emAndamentoEl.textContent = emAndamento;
  if (pendentesEl) pendentesEl.textContent = pendentes;
  if (concluidasEl) concluidasEl.textContent = concluidasMes;
}

// Estado de filtro de OS por status
state.osStatusFilter = null;

// Filtrar OS por status (clicando nos cards)
function filterOSByStatus(status) {
  // Se clicar no mesmo filtro que já está ativo, desativa
  if (state.osStatusFilter === status) {
    state.osStatusFilter = null;
  } else {
    state.osStatusFilter = status;
  }
  
  // Atualizar indicador visual
  const indicator = document.getElementById('os-filter-indicator');
  const filterText = document.getElementById('os-filter-text');
  
  if (indicator) {
    if (state.osStatusFilter) {
      indicator.style.display = 'flex';
      const filterLabels = {
        'pending': '🕐 Pendentes',
        'in_progress': '⚡ Em Andamento',
        'paused': '⏸️ Pausadas',
        'completed': '✅ Concluídas',
        'urgent': '🚨 Urgentes'
      };
      filterText.textContent = `Filtro: ${filterLabels[state.osStatusFilter] || state.osStatusFilter}`;
    } else {
      indicator.style.display = 'none';
    }
  }
  
  // Atualizar visual dos cards (destacar o selecionado)
  document.querySelectorAll('.os-stat-card').forEach(card => {
    card.style.transform = '';
    card.style.boxShadow = '';
  });
  
  if (state.osStatusFilter) {
    const classMap = {
      'pending': 'pending',
      'in_progress': 'progress',
      'completed': 'completed',
      'urgent': 'urgent'
    };
    const selectedCard = document.querySelector(`.os-stat-card.${classMap[state.osStatusFilter]}`);
    if (selectedCard) {
      selectedCard.style.transform = 'scale(1.05)';
      selectedCard.style.boxShadow = '0 4px 20px rgba(212, 175, 55, 0.3)';
    }
  }
  
  // Re-renderizar tabela com filtro
  renderOrdersTable();
}

function renderOrdersTable() {
  const tbody = document.querySelector('#os-table tbody');
  
  // Update stats
  updateOSStats();
  
  // Aplicar filtro de status
  let filteredOrders = state.orders;
  
  if (state.osStatusFilter === 'urgent') {
    // Filtro especial para urgentes - filtra por prioridade HIGH
    filteredOrders = state.orders.filter(o => o.priority === 'high' && o.status !== 'completed');
  } else if (state.osStatusFilter === 'completed') {
    // Mostrar concluídas do mês
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    filteredOrders = state.orders.filter(o => {
      if (o.status !== 'completed') return false;
      const finishedAt = o.finished_at ? new Date(o.finished_at) : null;
      return finishedAt && finishedAt >= startOfMonth;
    });
  } else if (state.osStatusFilter) {
    // Filtro por status normal
    filteredOrders = state.orders.filter(o => o.status === state.osStatusFilter);
  } else {
    // Sem filtro - mostrar apenas ativas (comportamento padrão)
    filteredOrders = state.orders.filter(o => o.status !== 'completed');
  }
  
  if (filteredOrders.length === 0) {
    const emptyMessage = state.osStatusFilter 
      ? `Nenhuma OS ${state.osStatusFilter === 'urgent' ? 'urgente' : state.osStatusFilter === 'completed' ? 'concluída no mês' : ''} encontrada`
      : 'Nenhuma OS ativa no momento';
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align: center; padding: 40px 20px; color: var(--text-secondary);">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity: 0.5; margin-bottom: 12px;">
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
          </svg>
          <div style="font-size: 14px;">${emptyMessage}</div>
          <div style="font-size: 12px; margin-top: 4px;">Clique em "Nova OS" para criar</div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filteredOrders.map(order => {
    const assigned = order.assigned_users && order.assigned_users.length > 0
      ? escapeHtml(order.assigned_users[0].name || order.assigned_users[0].username)
      : '-';
    const solicitante = order.requested_by_name ? escapeHtml(order.requested_by_name) : '-';
    return `
      <tr onclick="showOSDetail('${sanitizeId(order.id)}')" style="cursor: pointer;">
        <td>
          <div><strong>${escapeHtml(order.title)}</strong></div>
          <div style="font-size: 11px; color: var(--text-secondary);">${escapeHtml(order.sector) || '-'} • Solicitante: ${solicitante}</div>
        </td>
        <td><span class="badge ${sanitizeId(order.priority)}">${getPriorityText(order.priority)}</span></td>
        <td>${assigned}</td>
        <td>${formatDate(order.created_at)}</td>
        <td><span class="badge ${sanitizeId(order.status)}">${getStatusText(order.status)}</span></td>
      </tr>
    `;
  }).join('');
}

function showOSDetail(orderId) {
  const order = state.orders.find(o => o.id === orderId);
  if (!order) return;
  
  // Preencher modal
  document.getElementById('detail-os-title').textContent = order.title;
  document.getElementById('detail-os-sector').textContent = order.sector;
  document.getElementById('detail-os-created').textContent = formatDate(order.created_at);
  document.getElementById('detail-os-description').textContent = order.description || 'Sem observações';
  
  // Solicitante
  const solicitanteEl = document.getElementById('detail-os-solicitante');
  if (solicitanteEl) {
    solicitanteEl.textContent = order.requested_by_name || '-';
  }
  
  const statusBadge = document.getElementById('detail-os-status');
  statusBadge.textContent = getStatusText(order.status);
  statusBadge.className = `badge ${order.status}`;
  
  const priorityBadge = document.getElementById('detail-os-priority');
  priorityBadge.textContent = getPriorityText(order.priority);
  priorityBadge.className = `badge ${order.priority}`;

  // Horários de início, fim e tempo total
  const startedRow = document.getElementById('detail-os-started-row');
  const finishedRow = document.getElementById('detail-os-finished-row');
  const tempoRow = document.getElementById('detail-os-tempo-row');
  const startedEl = document.getElementById('detail-os-started');
  const finishedEl = document.getElementById('detail-os-finished');
  const tempoEl = document.getElementById('detail-os-tempo');

  const startedAt = order.started_at ? new Date(order.started_at) : null;
  const finishedAt = order.finished_at ? new Date(order.finished_at) : null;

  if (startedAt) {
    startedEl.textContent = startedAt.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    startedRow.style.display = '';
  } else {
    startedRow.style.display = 'none';
  }

  if (finishedAt) {
    finishedEl.textContent = finishedAt.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    finishedRow.style.display = '';
  } else {
    finishedRow.style.display = 'none';
  }

  // Calcular tempo total - usar worked_minutes se disponível
  if (order.worked_minutes && order.worked_minutes > 0) {
    // Usar worked_minutes do backend (já descontado o tempo de descanso)
    const totalMinutes = order.worked_minutes;
    const diffHours = Math.floor(totalMinutes / 60);
    const diffMinutes = totalMinutes % 60;
    
    let tempoTotal;
    if (diffHours >= 24) {
      const days = Math.floor(diffHours / 24);
      const hours = diffHours % 24;
      tempoTotal = `${days}d ${hours}h ${diffMinutes}min`;
    } else {
      tempoTotal = `${diffHours}h ${diffMinutes}min`;
    }
    tempoEl.textContent = tempoTotal;
    tempoEl.style.color = '';
    tempoRow.style.display = '';
  } else if (startedAt && finishedAt) {
    // Fallback: calcular diferença bruta
    const diffMs = finishedAt - startedAt;
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    
    let tempoTotal;
    if (diffHours > 24) {
      const days = Math.floor(diffHours / 24);
      const hours = diffHours % 24;
      tempoTotal = `${days}d ${hours}h ${diffMinutes}min`;
    } else {
      tempoTotal = `${diffHours}h ${diffMinutes}min`;
    }
    tempoEl.textContent = tempoTotal;
    tempoEl.style.color = '';
    tempoRow.style.display = '';
  } else if (startedAt && !finishedAt) {
    // Em andamento - mostrar tempo decorrido
    const now = new Date();
    const diffMs = now - startedAt;
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    tempoEl.textContent = `${diffHours}h ${diffMinutes}min (em andamento)`;
    tempoEl.style.color = 'var(--info)';
    tempoRow.style.display = '';
  } else {
    tempoRow.style.display = 'none';
  }

  // Nota de progresso/comentário
  const noteField = document.getElementById('detail-os-note');
  if (noteField) {
    noteField.value = order.progress_note || order.description || '';
  }
  
  // Mostrar usuários atribuídos
  const assignedContainer = document.getElementById('detail-os-assigned');
  if (order.assigned_users && order.assigned_users.length > 0) {
    assignedContainer.innerHTML = order.assigned_users.map(u => 
      `<span class="user-chip">${escapeHtml(u.name || u.username)}</span>`
    ).join('');
  } else {
    assignedContainer.innerHTML = '<span style="color: var(--text-secondary);">Nenhum técnico atribuído</span>';
  }
  
  // Checkboxes para editar atribuições (se for o criador ou admin)
  const canEdit = state.user.roles.includes('admin') || state.user.roles.includes('os_manage_all') || order.requested_by === state.user.id;
  const canManageAll = state.user.roles.includes('admin') || state.user.roles.includes('os_manage_all');
  const checkboxContainer = document.getElementById('detail-assign-checkboxes');
  
  // Mostrar seção de datas retroativas (só para manutenção/admin e quando não concluída)
  const retroactiveDates = document.getElementById('detail-retroactive-dates');
  if (retroactiveDates) {
    if (canManageAll && order.status !== 'completed') {
      retroactiveDates.style.display = 'block';
      // Limpar campos
      const startedInput = document.getElementById('detail-started-at-custom');
      const finishedInput = document.getElementById('detail-finished-at-custom');
      if (startedInput) startedInput.value = '';
      if (finishedInput) finishedInput.value = '';
    } else {
      retroactiveDates.style.display = 'none';
    }
  }
  
  // Checkboxes para editar atribuições
  // APENAS Manutenção/admin pode editar técnicos (usuário comum não pode mais)
  const canEditAssignments = canManageAll;
  
  if (canEditAssignments) {
    const assignedIds = order.assigned_users ? order.assigned_users.map(u => u.id) : [];
    const labelText = order.status === 'completed' ? 'Editar técnicos (OS concluída):' : 'Alterar atribuições:';
    checkboxContainer.innerHTML = `
      <label style="font-size: 13px; font-weight: 600; color: var(--text-secondary); margin-bottom: 8px;">${labelText}</label>
      ${['declie', 'eduardo', 'vanderlei', 'alissom'].map(username => {
        const user = state.users.find(u => u.username.toLowerCase() === username);
        const isChecked = user && assignedIds.includes(user.id);
        return `<div class="checkbox-item"><input type="checkbox" id="detail-assign-${username}" value="${username}" ${isChecked ? 'checked' : ''}><label for="detail-assign-${username}">${username.charAt(0).toUpperCase() + username.slice(1)}</label></div>`;
      }).join('')}
    `;
  } else {
    checkboxContainer.innerHTML = '';
  }
  
  // Ações
  const actionsContainer = document.getElementById('detail-os-actions');
  let actions = '<button type="button" class="btn-small btn-cancel" onclick="closeModal(\'modal-os-detail\')">Fechar</button>';
  
  // Botão salvar - manutenção pode salvar mesmo em OS concluída
  if (canEditAssignments) {
    actions += `<button type="button" class="btn-small btn-primary" onclick="updateOSAssignments('${order.id}')">Salvar Alterações</button>`;
  }
  
  if (canEdit && order.status === 'pending') {
    actions += `<button type="button" class="btn-small btn-primary" onclick="startOrder('${order.id}'); closeModal('modal-os-detail')">Iniciar</button>`;
  }
  
  if (canEdit && order.status === 'in_progress') {
    actions += `<button type="button" class="btn-small btn-warning" onclick="pauseOrder('${order.id}')">⏸ Pausar</button>`;
    // Somente manutenção pode concluir
    if (canManageAll) {
      actions += `<button type="button" class="btn-small btn-primary" onclick="completeOrder('${order.id}'); closeModal('modal-os-detail')">Concluir</button>`;
    }
  }
  
  // Se estiver pausada, mostrar botão de retomar
  if (canEdit && order.status === 'paused') {
    actions += `<button type="button" class="btn-small btn-primary" onclick="resumeOrder('${order.id}')">▶ Retomar</button>`;
    // Somente manutenção pode concluir
    if (canManageAll) {
      actions += `<button type="button" class="btn-small btn-success" onclick="completeOrder('${order.id}'); closeModal('modal-os-detail')">Concluir</button>`;
    }
  }
  
  // Botão excluir - criador pode excluir sua OS, manutenção pode excluir qualquer
  const canDelete = order.requested_by === state.user.id || state.user.roles.includes('admin') || state.user.roles.includes('os_manage_all');
  if (canDelete) {
    actions += `<button type="button" class="btn-small btn-danger" onclick="deleteOrder('${order.id}')">Excluir</button>`;
  }
  
  actionsContainer.innerHTML = actions;
  
  // Mostrar modal
  const modal = document.getElementById('modal-os-detail');
  modal.classList.remove('hidden');
  modal.classList.add('active');
}

async function updateOSAssignments(orderId) {
  // Pegar usuários selecionados
  const assignedUsernames = [];
  ['declie', 'eduardo', 'vanderlei', 'alissom'].forEach(username => {
    if (document.getElementById(`detail-assign-${username}`)?.checked) {
      assignedUsernames.push(username);
    }
  });
  
  // Buscar IDs
  const assignedUserIds = [];
  state.users.forEach(user => {
    if (assignedUsernames.includes(user.username.toLowerCase())) {
      assignedUserIds.push(user.id);
    }
  });

  const noteField = document.getElementById('detail-os-note');
  const progressNote = noteField ? noteField.value : undefined;
  
  try {
    const response = await fetch(`${API_URL}/orders/${orderId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${state.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ assigned_user_ids: assignedUserIds, progress_note: progressNote })
    });

    let data;
    try {
      data = await response.json();
    } catch (jsonErr) {
      const text = await response.text();
      showNotification(`Resposta inválida do servidor: ${text.substring(0, 100)}`, 'error');
      return;
    }
    if (data.ok) {
      await loadOrders();
      // await backupOrdersToTXT(); // Desabilitado temporariamente
      closeModal('modal-os-detail');
      showNotification('✓ Salvo', 'success');
      // Atualizar visualização dos técnicos atribuídos se necessário
      if (data.assigned_users) {
        const assignedContainer = document.getElementById('detail-os-assigned');
        assignedContainer.innerHTML = data.assigned_users.map(u => `<span class="user-chip">${escapeHtml(u.name || u.username)}</span>`).join('');
      }
    } else {
      showNotification('Erro ao atualizar: ' + (data.error || 'Erro desconhecido'), 'error');
    }
  } catch (error) {
    showNotification('Erro ao atualizar: ' + error.message, 'error');
  }
}

async function loadHistoryCount() {
  const completedCount = state.orders.filter(o => o.status === 'completed').length;
  document.getElementById('historico-count').textContent = completedCount;
}

async function loadHistoryInOS() {
  const tbody = document.querySelector('#os-historico-table tbody');
  const completedOrders = state.orders.filter(o => o.status === 'completed');
  
  if (completedOrders.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-secondary);">Nenhuma OS concluída</td></tr>';
    return;
  }

  tbody.innerHTML = completedOrders.map(o => {
    const startedAt = o.started_at ? new Date(o.started_at) : null;
    const finishedAt = o.finished_at ? new Date(o.finished_at) : null;
    
    // Calcular tempo total - usar worked_minutes se disponível (já com descanso descontado)
    let tempoTotal = '-';
    if (o.worked_minutes && o.worked_minutes > 0) {
      // Usar worked_minutes do backend (já descontado o tempo de descanso)
      const totalMinutes = o.worked_minutes;
      const diffHours = Math.floor(totalMinutes / 60);
      const diffMinutes = totalMinutes % 60;
      
      if (diffHours >= 24) {
        const days = Math.floor(diffHours / 24);
        const hours = diffHours % 24;
        tempoTotal = `${days}d ${hours}h`;
      } else {
        tempoTotal = `${diffHours}h ${diffMinutes}min`;
      }
    } else if (startedAt && finishedAt) {
      // Fallback: calcular diferença bruta (sem descanso descontado)
      const diffMs = finishedAt - startedAt;
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      
      if (diffHours > 24) {
        const days = Math.floor(diffHours / 24);
        const hours = diffHours % 24;
        tempoTotal = `${days}d ${hours}h`;
      } else {
        tempoTotal = `${diffHours}h ${diffMinutes}min`;
      }
    }
    
    // Quem executou
    const executores = o.assigned_users && o.assigned_users.length > 0
      ? escapeHtml(o.assigned_users.map(u => u.name || u.username).join(', '))
      : '-';
    
    return `
      <tr onclick="showOSDetail('${sanitizeId(o.id)}')" style="cursor: pointer;">
        <td>
          <div><strong>${escapeHtml(o.title)}</strong></div>
          <div style="font-size: 11px; color: var(--text-secondary);">Executado por: ${executores}</div>
        </td>
        <td>${escapeHtml(o.sector) || '-'}</td>
        <td>${startedAt ? startedAt.toLocaleString('pt-BR', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'}) : '-'}</td>
        <td>${finishedAt ? finishedAt.toLocaleString('pt-BR', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'}) : '-'}</td>
        <td><strong>${tempoTotal}</strong></td>
      </tr>
    `;
  }).join('');
}

function toggleOSView(view) {
  const btnAtivas = document.getElementById('btn-os-ativas');
  const btnHistorico = document.getElementById('btn-os-historico');
  const contentAtivas = document.getElementById('os-ativas-content');
  const contentHistorico = document.getElementById('os-historico-content');
  
  if (view === 'ativas') {
    btnAtivas.classList.add('active');
    btnHistorico.classList.remove('active');
    contentAtivas.classList.remove('hidden');
    contentHistorico.classList.add('hidden');
  } else {
    btnHistorico.classList.add('active');
    btnAtivas.classList.remove('active');
    contentHistorico.classList.remove('hidden');
    contentAtivas.classList.add('hidden');
    loadHistoryInOS(); // Carregar histórico ao mostrar
  }
}

async function startOrder(orderId) {
  try {
    // Verificar se tem data retroativa customizada
    const startedAtCustomInput = document.getElementById('detail-started-at-custom');
    const startedAtCustom = startedAtCustomInput?.value || null;
    
    const body = { status: 'in_progress' };
    if (startedAtCustom) {
      // Converter datetime-local para ISO com timezone
      body.started_at_custom = new Date(startedAtCustom).toISOString();
    }
    
    const response = await fetch(`${API_URL}/orders/${orderId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${state.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    const data = await response.json();
    if (data.ok) {
      showNotification('OS iniciada com sucesso!', 'success');
      await loadOrders();
    } else {
      showNotification(data.error || 'Erro ao iniciar OS', 'error');
    }
  } catch (error) {
    showNotification('Erro ao iniciar OS: ' + error.message, 'error');
  }
}

// Pausar OS (para almoço, fim do dia, etc)
async function pauseOrder(orderId) {
  try {
    const response = await fetch(`${API_URL}/orders/${orderId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${state.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status: 'paused' })
    });

    const data = await response.json();
    if (data.ok) {
      showNotification('⏸ OS pausada - tempo registrado!', 'info');
      closeModal('modal-os-detail');
      await loadOrders();
    } else {
      showNotification(data.error || 'Erro ao pausar OS', 'error');
    }
  } catch (error) {
    showNotification('Erro ao pausar OS: ' + error.message, 'error');
  }
}

// Retomar OS pausada
async function resumeOrder(orderId) {
  try {
    const response = await fetch(`${API_URL}/orders/${orderId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${state.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status: 'in_progress' })
    });

    const data = await response.json();
    if (data.ok) {
      showNotification('▶ OS retomada!', 'success');
      closeModal('modal-os-detail');
      await loadOrders();
    } else {
      showNotification(data.error || 'Erro ao retomar OS', 'error');
    }
  } catch (error) {
    showNotification('Erro ao retomar OS: ' + error.message, 'error');
  }
}

async function completeOrder(orderId) {
  // Verificar se alguém foi atribuído à OS antes de concluir
  const order = state.orders.find(o => o.id === orderId);
  if (order) {
    const hasAssigned = order.assigned_users && order.assigned_users.length > 0;
    
    // Verificar também os checkboxes no modal (caso esteja aberto)
    const assignedUsernames = [];
    ['declie', 'eduardo', 'vanderlei', 'alissom'].forEach(username => {
      const checkbox = document.getElementById(`detail-assign-${username}`);
      if (checkbox && checkbox.checked) {
        assignedUsernames.push(username);
      }
    });
    
    if (!hasAssigned && assignedUsernames.length === 0) {
      showNotification('Atribua quem executou a OS antes de concluir!', 'error');
      return;
    }
    
    // Se tem checkboxes selecionados, salvar primeiro
    if (assignedUsernames.length > 0) {
      // Buscar IDs
      const assignedUserIds = state.users
        .filter(u => assignedUsernames.includes(u.username.toLowerCase()))
        .map(u => u.id);
      
      try {
        await fetch(`${API_URL}/orders/${orderId}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${state.token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ assigned_user_ids: assignedUserIds })
        });
      } catch (e) {
        console.error('Erro ao atribuir usuários:', e);
      }
    }
  }
  
  try {
    // Verificar se tem datas retroativas customizadas
    const startedAtCustomInput = document.getElementById('detail-started-at-custom');
    const finishedAtCustomInput = document.getElementById('detail-finished-at-custom');
    const breakMinutesInput = document.getElementById('detail-break-minutes');
    const startedAtCustom = startedAtCustomInput?.value || null;
    const finishedAtCustom = finishedAtCustomInput?.value || null;
    const breakMinutes = breakMinutesInput?.value ? parseInt(breakMinutesInput.value) : 0;
    
    // Converter datetime-local para ISO com timezone de Brasília (-03:00)
    // datetime-local retorna "2026-01-12T08:01" sem timezone
    // Adicionamos :00-03:00 para indicar que é horário de Brasília
    const toISOLocal = (dtValue) => {
      if (!dtValue) return null;
      // Adicionar segundos e timezone de Brasília
      return dtValue + ':00-03:00';
    };
    
    const body = { status: 'completed' };
    if (startedAtCustom) {
      body.started_at_custom = toISOLocal(startedAtCustom);
    }
    if (finishedAtCustom) {
      body.finished_at_custom = toISOLocal(finishedAtCustom);
    }
    if (breakMinutes > 0) {
      body.break_minutes = breakMinutes;
    }
    
    const response = await fetch(`${API_URL}/orders/${orderId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${state.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    const data = await response.json();
    if (data.ok) {
      showNotification('OS concluída com sucesso!', 'success');
      await loadOrders();
      closeModal('modal-os-detail');
    } else {
      showNotification(data.error || 'Erro ao concluir OS', 'error');
    }
  } catch (error) {
    showNotification('Erro ao concluir OS: ' + error.message, 'error');
  }
}

// Função específica para fechar OS com datas retroativas
async function closeOrderWithRetroactiveDates() {
  // Pegar o ID da OS do modal aberto
  const osIdEl = document.querySelector('#modal-os-detail [data-order-id]');
  const osTitle = document.getElementById('detail-os-title');
  
  // Buscar a OS pelo título ou iterar orders
  const order = state.orders.find(o => {
    const titleEl = document.getElementById('detail-os-title');
    return titleEl && o.title === titleEl.textContent;
  });
  
  if (!order) {
    showNotification('Erro: OS não encontrada. Feche e abra novamente.', 'error');
    return;
  }
  
  const orderId = order.id;
  
  // Pegar datas retroativas
  const startedAtCustomInput = document.getElementById('detail-started-at-custom');
  const finishedAtCustomInput = document.getElementById('detail-finished-at-custom');
  const breakMinutesInput = document.getElementById('detail-break-minutes');
  
  const startedAtCustom = startedAtCustomInput?.value || null;
  const finishedAtCustom = finishedAtCustomInput?.value || null;
  const breakMinutes = breakMinutesInput?.value ? parseInt(breakMinutesInput.value) : 0;
  
  // Validar que pelo menos uma data foi preenchida
  if (!startedAtCustom && !finishedAtCustom) {
    showNotification('Preencha pelo menos a Data/Hora de Início ou Conclusão!', 'error');
    return;
  }
  
  // Validar que a data de fim é posterior ao início
  if (startedAtCustom && finishedAtCustom) {
    const start = new Date(startedAtCustom);
    const end = new Date(finishedAtCustom);
    if (end <= start) {
      showNotification('A data de conclusão deve ser posterior à data de início!', 'error');
      return;
    }
  }
  
  // Verificar se tem técnico atribuído
  let hasAssigned = order.assigned_users && order.assigned_users.length > 0;
  const assignedUsernames = [];
  
  ['declie', 'eduardo', 'vanderlei', 'alissom'].forEach(username => {
    const cb = document.getElementById('detail-assign-' + username);
    if (cb && cb.checked) {
      assignedUsernames.push(username);
    }
  });
  
  if (!hasAssigned && assignedUsernames.length === 0) {
    showNotification('Atribua quem executou a OS antes de concluir!', 'error');
    return;
  }
  
  try {
    // Salvar atribuições primeiro
    if (assignedUsernames.length > 0) {
      const assignedUserIds = state.users
        .filter(u => assignedUsernames.includes(u.username.toLowerCase()))
        .map(u => u.id);
      
      await fetch(`${API_URL}/orders/${orderId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${state.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ assigned_user_ids: assignedUserIds })
      });
    }
    
    // Converter datetime-local para ISO com timezone local
    // datetime-local retorna "2026-01-12T08:01" sem timezone
    // new Date() pode interpretar isso como UTC ou local dependendo do browser
    // Vamos garantir que seja interpretado como horário local de Brasília (UTC-3)
    const toISOWithTimezone = (dateTimeLocalValue) => {
      if (!dateTimeLocalValue) return null;
      // dateTimeLocalValue vem como "2026-01-12T08:01"
      // Adicionar timezone de Brasília (-03:00) para garantir interpretação correta
      // Isso faz o backend entender que 08:01 é horário de Brasília, não UTC
      const withTimezone = dateTimeLocalValue + ':00-03:00';
      return withTimezone;
    };
    
    // Fechar a OS com as datas retroativas
    const body = { 
      status: 'completed',
      started_at_custom: toISOWithTimezone(startedAtCustom),
      finished_at_custom: toISOWithTimezone(finishedAtCustom),
      break_minutes: breakMinutes
    };
    
    const response = await fetch(`${API_URL}/orders/${orderId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${state.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    
    const data = await response.json();
    if (data.ok) {
      const tempoInfo = breakMinutes > 0 ? ` (${breakMinutes}min de descanso descontados)` : '';
      showNotification(`OS fechada com datas retroativas!${tempoInfo}`, 'success');
      await loadOrders();
      closeModal('modal-os-detail');
    } else {
      showNotification(data.error || 'Erro ao fechar OS', 'error');
    }
  } catch (error) {
    showNotification('Erro ao fechar OS: ' + error.message, 'error');
  }
}

async function deleteOrder(orderId) {
  if (!confirm('Tem certeza que deseja excluir esta OS?')) return;

  try {
    const response = await fetch(`${API_URL}/orders/${orderId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${state.token}`
      }
    });

    const data = await response.json();
    if (data.ok) {
      showNotification('OS excluída com sucesso!', 'success');
      closeModal('modal-os-detail');
      await loadOrders();
    } else {
      showNotification(data.error || 'Erro ao excluir OS', 'error');
    }
  } catch (error) {
    showNotification('Erro ao excluir OS: ' + error.message, 'error');
  }
}

function showCreateOS() {
  // Limpar form
  document.getElementById('form-create-os').reset();
  
  // Mostrar seção de atribuição apenas para manutenção
  const assignSection = document.getElementById('os-assign-section');
  if (assignSection) {
    const canAssign = state.user && state.user.roles && (
      state.user.roles.includes('admin') || 
      state.user.roles.includes('os_manage_all') || 
      state.user.roles.includes('tecnico')
    );
    assignSection.style.display = canAssign ? 'block' : 'none';
  }
  
  const modal = document.getElementById('modal-create-os');
  modal.classList.remove('hidden');
  modal.classList.add('active');
}

async function createOrderFromForm(event) {
  event.preventDefault();
  
  const title = document.getElementById('os-title').value.trim();
  const sector = document.getElementById('os-sector').value.trim();
  const priority = document.getElementById('os-priority').value;
  const description = document.getElementById('os-description').value.trim();
  
  if (!title) {
    showNotification('Título é obrigatório!', 'error');
    return;
  }
  
  // Pegar usuários selecionados
  const assignedUsernames = [];
  ['declie', 'eduardo', 'vanderlei', 'alissom'].forEach(username => {
    if (document.getElementById(`assign-${username}`).checked) {
      assignedUsernames.push(username);
    }
  });
  
  // Buscar IDs dos usuários
  const assignedUserIds = [];
  if (assignedUsernames.length > 0) {
    // Buscar users do state ou fazer requisição
    await loadUsers();
    state.users.forEach(user => {
      if (assignedUsernames.includes(user.username.toLowerCase())) {
        assignedUserIds.push(user.id);
      }
    });
  }
  
  const orderData = {
    title,
    description,
    sector,
    priority,
    assigned_user_ids: assignedUserIds
  };
  
  await createOrder(orderData);
  closeModal('modal-create-os');
}

async function loadUsers() {
  if (state.users.length > 0) return; // Já carregado
  
  try {
    const response = await fetch(`${API_URL}/users`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await response.json();
    if (data.ok) {
      state.users = data.users;
    }
  } catch (error) {
    console.error('Erro ao carregar usuários:', error);
  }
}

async function createOrder(orderData) {
  try {
    const response = await fetch(`${API_URL}/orders`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${state.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(orderData)
    });

    const data = await response.json();
    if (data.ok) {
      await loadOrders();
      // await backupOrdersToTXT(); // Desabilitado temporariamente
      showNotification('OS criada com sucesso!', 'success');
    } else {
      showNotification(data.error || 'Erro ao criar OS', 'error');
    }
  } catch (error) {
    showNotification('Erro ao criar OS: ' + error.message, 'error');
  }
}

async function backupOrdersToTXT() {
  try {
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0]; // YYYY-MM-DD
    const timestamp = today.toLocaleString('pt-BR');
    const tenantName = (state.user && state.user.tenant) ? state.user.tenant.replace(/\s+/g, '_') : 'tenant';
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 60);
    
    // Filtrar últimas 60 dias
    const recentOrders = state.orders.filter(o => new Date(o.created_at) >= cutoff);
    const ordersToday = recentOrders.filter(o => o.created_at.startsWith(dateStr));
    
    let content = `BACKUP ORDENS DE SERVIÇO - ${timestamp}\n`;
    content += '='.repeat(100) + '\n\n';
    content += `TENANT: ${tenantName}\n`;
    content += `TOTAL DE OS (60d): ${recentOrders.length}\n`;
    content += `OS CRIADAS HOJE (${dateStr}): ${ordersToday.length}\n\n`;
    content += '='.repeat(100) + '\n\n';
    
    recentOrders.forEach(order => {
      const statusLabels = { open: 'Aberta', in_progress: 'Em Andamento', completed: 'Concluída', cancelled: 'Cancelada' };
      const priorityLabels = { high: 'Alta', medium: 'Média', low: 'Baixa' };
      
      content += `OS #${order.id}\n`;
      content += `Título: ${order.title}\n`;
      content += `Status: ${statusLabels[order.status] || order.status}\n`;
      content += `Urgência: ${priorityLabels[order.priority] || order.priority}\n`;
      content += `Local/Setor: ${order.sector || 'N/A'}\n`;
      content += `Solicitante: ${order.requested_by_name || 'N/A'}\n`;
      content += `Comentário: ${order.progress_note || order.description || 'N/A'}\n`;
      
      if (order.assigned_users && order.assigned_users.length > 0) {
        const techs = order.assigned_users.map(u => u.username).join(', ');
        content += `Técnicos: ${techs}\n`;
      }
      
      content += `Criada em: ${new Date(order.created_at).toLocaleString('pt-BR')}\n`;
      
      if (order.started_at) {
        content += `Iniciada em: ${new Date(order.started_at).toLocaleString('pt-BR')}\n`;
      }
      
      if (order.finished_at) {
        content += `Concluída em: ${new Date(order.finished_at).toLocaleString('pt-BR')}\n`;
      }
      
      if (order.description) {
        content += `Descrição: ${order.description}\n`;
      }
      
      content += '-'.repeat(100) + '\n\n';
    });
    
    // Salvar com nome baseado na data
    const filename = `OS_${tenantName}_backup_${dateStr}.txt`;
    
    if (window.electronAPI && window.electronAPI.saveFile) {
      const result = await window.electronAPI.saveFile({
        filename: filename,
        content: content
      });
      
      if (result.success) {
        console.log('Backup de OS salvo:', result.path);
      }
    } else {
      // Fallback: download
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    }
  } catch (error) {
    console.error('Erro ao fazer backup de OS:', error);
  }
}

// History
// NOTA: loadInventory() real está mais abaixo no arquivo

function renderInventoryOld() {
  const view = document.getElementById('almoxarifado-view');
  const lowStock = state.inventory.filter(i => i.quantity < i.min_stock);
  
  const html = `
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Almoxarifado</h3>
        <button class="btn-small btn-primary" onclick="alert('Adicionar item em breve')">+ Novo Item</button>
      </div>
      ${lowStock.length > 0 ? `
        <div style="background: rgba(239,68,68,0.1); border: 1px solid var(--danger); border-radius: 8px; padding: 12px; margin-bottom: 16px;">
          <strong style="color: var(--danger);">◆ ${lowStock.length} itens com estoque baixo!</strong>
        </div>
      ` : ''}
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>SKU</th>
              <th>Nome</th>
              <th>Quantidade</th>
              <th>Unidade</th>
              <th>Localização</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${state.inventory.map(item => `
              <tr>
                <td>${item.sku}</td>
                <td>${item.name}</td>
                <td style="color: ${item.quantity < item.min_stock ? 'var(--danger)' : 'var(--success)'}">
                  <strong>${item.quantity}</strong> / ${item.min_stock}
                </td>
                <td>${item.unit}</td>
                <td>${item.location || '-'}</td>
                <td>
                  ${item.quantity < item.min_stock ? 
                    '<span class="badge high">Baixo</span>' : 
                    '<span class="badge completed">OK</span>'}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
  view.innerHTML = html;
}

// NOTA: Funções loadPurchases() e loadPreventives() reais estão mais abaixo no arquivo

// Reports (Relatórios)
async function loadReports() {
  const completedOrders = state.orders.filter(o => o.status === 'completed');
  
  // Produtividade
  const userStats = {};
  ['declie', 'eduardo', 'vanderlei', 'alissom'].forEach(username => {
    userStats[username] = { count: 0, totalTime: 0 };
  });
  
  completedOrders.forEach(order => {
    if (order.assigned_users && Array.isArray(order.assigned_users)) {
      order.assigned_users.forEach(user => {
        const username = user.username.toLowerCase();
        if (userStats[username]) {
          userStats[username].count++;
          
          // Calcular tempo - usar worked_minutes se disponível
          if (order.worked_minutes && order.worked_minutes > 0) {
            // worked_minutes já está em minutos, converter para ms
            userStats[username].totalTime += order.worked_minutes * 60 * 1000;
          } else if (order.started_at && order.finished_at) {
            // Fallback: calcular diferença bruta
            const duration = new Date(order.finished_at) - new Date(order.started_at);
            userStats[username].totalTime += duration;
          }
        }
      });
    }
  });
  
  // Renderizar produtividade
  const sorted = Object.entries(userStats).sort((a, b) => b[1].count - a[1].count);
  const maxCount = sorted.length > 0 ? sorted[0][1].count : 1;
  
  const productivityHtml = sorted.map(([username, stats]) => {
    const percentage = (stats.count / maxCount) * 100;
    const avgTime = stats.count > 0 ? (stats.totalTime / stats.count / (1000 * 60 * 60)).toFixed(1) : 0;
    return `
      <div class="productivity-bar">
        <div class="productivity-name">${username.charAt(0).toUpperCase() + username.slice(1)}</div>
        <div class="productivity-bar-container">
          <div class="productivity-bar-fill" style="width: ${percentage}%">
            <span class="productivity-count">${stats.count}</span>
          </div>
        </div>
        <div class="productivity-total">${stats.count} OS</div>
      </div>
    `;
  }).join('');
  
  document.getElementById('relatorio-productivity').innerHTML = productivityHtml || 
    '<p style="color: var(--text-secondary); padding: 20px;">Nenhum dado disponível</p>';
  
  // Tempo médio
  const timeHtml = sorted.map(([username, stats]) => {
    const avgTime = stats.count > 0 ? (stats.totalTime / stats.count / (1000 * 60 * 60)).toFixed(1) : 0;
    return `
      <div class="productivity-bar">
        <div class="productivity-name">${username.charAt(0).toUpperCase() + username.slice(1)}</div>
        <div class="productivity-bar-container" style="background: var(--bg-secondary);">
          <div style="padding: 12px; color: var(--text-primary);">
            ${avgTime}h por OS
          </div>
        </div>
        <div class="productivity-total">${stats.count > 0 ? avgTime + 'h' : '-'}</div>
      </div>
    `;
  }).join('');
  
  document.getElementById('relatorio-time').innerHTML = timeHtml ||
    '<p style="color: var(--text-secondary); padding: 20px;">Nenhum dado disponível</p>';
  
  // Por urgência
  const priorityStats = {
    high: completedOrders.filter(o => o.priority === 'high').length,
    medium: completedOrders.filter(o => o.priority === 'medium').length,
    low: completedOrders.filter(o => o.priority === 'low').length
  };
  
  const total = priorityStats.high + priorityStats.medium + priorityStats.low;
  const maxPriority = Math.max(priorityStats.high, priorityStats.medium, priorityStats.low, 1);
  
  const priorityHtml = `
    <div class="productivity-bar">
      <div class="productivity-name">Alta</div>
      <div class="productivity-bar-container">
        <div class="productivity-bar-fill" style="width: ${(priorityStats.high / maxPriority) * 100}%; background: linear-gradient(90deg, var(--danger) 0%, #c53030 100%);">
          <span class="productivity-count">${priorityStats.high}</span>
        </div>
      </div>
      <div class="productivity-total">${priorityStats.high}</div>
    </div>
    <div class="productivity-bar">
      <div class="productivity-name">Média</div>
      <div class="productivity-bar-container">
        <div class="productivity-bar-fill" style="width: ${(priorityStats.medium / maxPriority) * 100}%; background: linear-gradient(90deg, var(--warning) 0%, #d97706 100%);">
          <span class="productivity-count">${priorityStats.medium}</span>
        </div>
      </div>
      <div class="productivity-total">${priorityStats.medium}</div>
    </div>
    <div class="productivity-bar">
      <div class="productivity-name">Baixa</div>
      <div class="productivity-bar-container">
        <div class="productivity-bar-fill" style="width: ${(priorityStats.low / maxPriority) * 100}%; background: linear-gradient(90deg, var(--info) 0%, #2563eb 100%);">
          <span class="productivity-count">${priorityStats.low}</span>
        </div>
      </div>
      <div class="productivity-total">${priorityStats.low}</div>
    </div>
  `;
  
  document.getElementById('relatorio-priority').innerHTML = priorityHtml ||
    '<p style="color: var(--text-secondary); padding: 20px;">Nenhum dado disponível</p>';
}

// Notifications System
async function checkForUpdates() {
  try {
    // Check for new orders
    const response = await fetch(`${API_URL}/orders`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await response.json();
    
    if (data.ok) {
      const newOrders = data.orders.filter(o => 
        o.status === 'pending' && 
        !state.orders.find(existing => existing.id === o.id)
      );

      // Notify about new orders
      newOrders.forEach(order => {
        showNotification(
          '[NOVA OS] ' + order.title,
          `Prioridade: ${getPriorityText(order.priority)} - Setor: ${order.sector}`,
          'info'
        );
      });

      state.orders = data.orders;
      
      // Update current view if on dashboard or OS
      if (state.currentView === 'dashboard') {
        updateDashboardStats();
      } else if (state.currentView === 'os') {
        renderOrdersTable();
        loadHistoryCount();
      }
    }

    // Check for pending tasks every 5 minutes
    const pending = state.orders.filter(o => o.status === 'pending');
    const inProgress = state.orders.filter(o => o.status === 'in_progress');
    
    if (pending.length > 0 || inProgress.length > 0) {
      let message = '';
      if (pending.length > 0) message += `${pending.length} OS pendente(s). `;
      if (inProgress.length > 0) message += `${inProgress.length} em andamento. `;
      
      showNotification(
        '[LEMBRETE] Tarefas Ativas',
        message + 'Continue o bom trabalho!',
        'warning',
        5000
      );
    }

  } catch (error) {
    console.error('Erro ao verificar atualizações:', error);
  }
}

function showNotification(message, type = 'info', duration = 5000, playSound = true) {
  const container = document.getElementById('notification-container');
  if (!container) return;
  
  const id = 'notif-' + Date.now();
  
  const typeIcons = {
    success: '✓',
    error: '✗',
    warning: '⚠',
    info: 'ℹ'
  };
  
  const typeColors = {
    success: '#10b981',
    error: '#ef4444',
    warning: '#f59e0b',
    info: '#3b82f6'
  };
  
  // Tocar som de notificação
  if (playSound && typeof Audio !== 'undefined') {
    try {
      // Som de notificação estilo Discord (frequência curta)
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      
      oscillator.frequency.value = type === 'error' ? 400 : type === 'warning' ? 600 : 800;
      oscillator.type = 'sine';
      gainNode.gain.value = 0.1;
      
      oscillator.start();
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
      oscillator.stop(audioCtx.currentTime + 0.2);
    } catch (e) {
      console.log('Erro ao tocar som:', e);
    }
  }
  
  const notification = document.createElement('div');
  notification.className = `notification ${type} notification-slide-in`;
  notification.id = id;
  notification.style.cssText = `
    position: relative;
    background: linear-gradient(135deg, rgba(30,30,30,0.98), rgba(20,20,20,0.98));
    border: 1px solid ${typeColors[type]}40;
    border-left: 4px solid ${typeColors[type]};
    border-radius: 12px;
    padding: 16px 20px;
    margin-bottom: 12px;
    box-shadow: 0 10px 40px rgba(0,0,0,0.4), 0 0 20px ${typeColors[type]}20;
    animation: notificationSlideIn 0.4s cubic-bezier(0.16, 1, 0.3, 1);
    backdrop-filter: blur(10px);
    max-width: 380px;
    cursor: pointer;
  `;
  notification.innerHTML = `
    <div class="notification-content" style="display: flex; align-items: flex-start; gap: 12px;">
      <span class="notification-icon" style="
        width: 32px; 
        height: 32px; 
        border-radius: 50%; 
        background: ${typeColors[type]}20; 
        display: flex; 
        align-items: center; 
        justify-content: center; 
        font-size: 16px;
        color: ${typeColors[type]};
        flex-shrink: 0;
      ">${typeIcons[type] || typeIcons.info}</span>
      <div style="flex: 1; min-width: 0;">
        <span class="notification-message" style="
          display: block;
          color: #fff;
          font-size: 14px;
          line-height: 1.5;
          word-wrap: break-word;
        ">${message}</span>
        <span style="font-size: 11px; color: rgba(255,255,255,0.4); margin-top: 4px; display: block;">
          ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      <span class="notification-close" onclick="event.stopPropagation(); closeNotification('${id}')" style="
        width: 24px;
        height: 24px;
        border-radius: 6px;
        background: rgba(255,255,255,0.05);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.2s;
        color: rgba(255,255,255,0.5);
        font-size: 14px;
      " onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='rgba(255,255,255,0.05)'">×</span>
    </div>
  `;
  
  // Adicionar ao início (notificações mais recentes em cima)
  container.insertBefore(notification, container.firstChild);
  
  // Auto remove after duration
  setTimeout(() => {
    closeNotification(id);
  }, duration);
}

function closeNotification(id) {
  const notif = document.getElementById(id);
  if (notif) {
    notif.style.animation = 'slideIn 0.3s ease reverse';
    setTimeout(() => notif.remove(), 300);
  }
}

// Utilities
function getStatusText(status) {
  const map = {
    'pending': 'Pendente',
    'in_progress': 'Em Andamento',
    'paused': 'Pausada',
    'completed': 'Concluída'
  };
  return map[status] || status;
}

function getPriorityText(priority) {
  const map = {
    'low': 'Baixa',
    'medium': 'Média',
    'high': 'Alta'
  };
  return map[priority] || priority;
}

function formatDate(dateString) {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// Almoxarifado Module
async function loadInventory() {
  try {
    // Se offline, carregar do cache
    if (!state.isOnline) {
      const cached = loadFromCache(CACHE_KEYS.inventory);
      if (cached) {
        state.inventory = cached;
        renderInventoryTable();
        showNotification('Modo offline - dados do cache', 'warning');
        return;
      }
    }

    const response = await fetch(`${API_URL}/inventory`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });

    const data = await response.json();
    if (data.ok) {
      state.inventory = data.items;
      saveToCache(CACHE_KEYS.inventory, data.items); // Salvar no cache
      renderInventoryTable();
    }
  } catch (error) {
    console.error('Erro ao carregar almoxarifado:', error);
    // Tentar carregar do cache em caso de erro
    const cached = loadFromCache(CACHE_KEYS.inventory);
    if (cached) {
      state.inventory = cached;
      renderInventoryTable();
      showNotification('Sem conexão - usando dados salvos', 'warning');
    } else {
      showNotification('Erro ao carregar almoxarifado', 'error');
    }
  }
}

function renderInventoryTable() {
  const tbody = document.querySelector('#almoxarifado-table tbody');
  if (!tbody) return;

  // Atualizar estatísticas
  updateAlmoxarifadoStats();
  
  // Atualizar lista de marcas no filtro
  updateMarcasFilter();

  if (state.inventory.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center">Nenhum item cadastrado</td></tr>';
    updateShowingCount(0);
    return;
  }

  const categoryLabels = {
    ferramentas: '🔧 Ferramentas',
    eletrica: '⚡ Elétrica',
    hidraulica: '💧 Hidráulica',
    rolamentos: '⚙️ Rolamentos',
    parafusos: '🔩 Parafusos',
    lubrificantes: '🛢️ Lubrificantes',
    epis: '🦺 EPIs',
    outros: '📦 Outros',
    // Categorias antigas para compatibilidade
    eletrico: '⚡ Elétrico',
    pneumatico: 'Pneumático',
    hidraulico: '💧 Hidráulico',
    mecanico: 'Mecânico',
    rolamento: '⚙️ Rolamento',
    ferramenta: '🔧 Ferramenta',
    epi: '🦺 EPI',
    limpeza: 'Limpeza',
    outro: '📦 Outro'
  };

  const categoryClasses = {
    ferramentas: 'ferramentas',
    eletrica: 'eletrica',
    hidraulica: 'hidraulica',
    rolamentos: 'rolamentos',
    parafusos: 'parafusos',
    lubrificantes: 'lubrificantes',
    epis: 'epis',
    outros: 'outros',
    eletrico: 'eletrica',
    hidraulico: 'hidraulica',
    rolamento: 'rolamentos',
    ferramenta: 'ferramentas',
    epi: 'epis',
    outro: 'outros'
  };

  // Aplicar filtros
  var itemsToShow = filterInventoryItems(state.inventory);
  updateShowingCount(itemsToShow.length);

  if (itemsToShow.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; color: var(--text-secondary);">Nenhum item encontrado com os filtros selecionados</td></tr>';
    return;
  }

  tbody.innerHTML = itemsToShow.map(item => {
    var catClass = categoryClasses[item.category] || 'outros';
    var statusClass = item.quantity <= 0 ? 'badge-high' : (item.quantity <= (item.min_stock || 0) ? 'badge-warning' : 'badge-low');
    var statusText = item.quantity <= 0 ? '🔴 Zerado' : (item.quantity <= (item.min_stock || 0) ? '⚠️ Baixo' : '✅ OK');
    
    // Criar descrição informativa do item
    var descParts = [];
    if (item.brand) descParts.push(item.brand);
    if (item.specs) {
      var specsPreview = item.specs.substring(0, 60) + (item.specs.length > 60 ? '...' : '');
      descParts.push(specsPreview);
    }
    var descHtml = descParts.length > 0 
      ? '<div style="font-size:11px; color:var(--text-secondary); margin-top:2px; max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + escapeHtml(descParts.join(' • ')) + '</div>'
      : '<div style="font-size:11px; color:var(--text-muted); margin-top:2px; font-style:italic;">Sem descrição</div>';
    
    // Localização com ícone
    var locationHtml = item.location 
      ? '<span style="font-size: 12px; display:flex; align-items:center; gap:4px;"><span style="opacity:0.6;">📍</span>' + escapeHtml(item.location) + '</span>'
      : '<span style="font-size: 11px; color:var(--text-muted); font-style:italic;">Não definido</span>';
    
    return '<tr onclick="showItemDetail(\'' + sanitizeId(item.id) + '\')" style="cursor: pointer;" title="Clique para ver detalhes">' +
      '<td><code style="background: var(--bg-secondary); padding: 2px 6px; border-radius: 4px; font-size: 11px;">' + escapeHtml(item.sku || '-') + '</code></td>' +
      '<td><div><strong>' + escapeHtml(item.name) + '</strong>' + descHtml + '</div></td>' +
      '<td><span class="category-badge ' + catClass + '">' + escapeHtml(categoryLabels[item.category] || item.category || '-') + '</span></td>' +
      '<td>' + escapeHtml(item.brand || '-') + '</td>' +
      '<td><div style="display:flex; align-items:center; gap:6px;">' +
        '<strong style="font-size: 16px;">' + escapeHtml(item.quantity) + '</strong>' +
        '<span style="color: var(--text-secondary); font-size:11px;">min ' + (item.min_stock || 0) + (item.max_stock ? ' / max ' + item.max_stock : '') + '</span>' +
      '</div></td>' +
      '<td>' + escapeHtml(item.unit) + '</td>' +
      '<td>' + locationHtml + '</td>' +
      '<td><span class="badge ' + statusClass + '">' + statusText + '</span></td>' +
      '<td onclick="event.stopPropagation()">' +
        '<button class="btn-small" onclick="adjustStock(' + item.id + ', -1)" title="Remover 1" style="padding: 4px 8px;">−</button>' +
        '<button class="btn-small" onclick="adjustStock(' + item.id + ', 1)" title="Adicionar 1" style="padding: 4px 8px;">+</button>' +
        '<button class="btn-small btn-danger" onclick="deleteItem(' + item.id + ')" style="padding: 4px 8px;" title="Excluir item">×</button>' +
      '</td>' +
    '</tr>';
  }).join('');
  
  // Renderizar versão mobile (cards)
  renderInventoryMobile(itemsToShow, categoryLabels);
}

// Renderizar lista mobile do almoxarifado
function renderInventoryMobile(items, categoryLabels) {
  var mobileContainer = document.getElementById('almox-mobile-list');
  
  // Criar container se não existir
  if (!mobileContainer) {
    var tableContainer = document.querySelector('#almoxarifado-table');
    if (tableContainer && tableContainer.parentElement) {
      mobileContainer = document.createElement('div');
      mobileContainer.id = 'almox-mobile-list';
      mobileContainer.className = 'almox-mobile-list';
      mobileContainer.style.display = 'none'; // Escondido por padrão (CSS mobile mostra)
      tableContainer.parentElement.insertBefore(mobileContainer, tableContainer.nextSibling);
    } else {
      return;
    }
  }
  
  if (!items || items.length === 0) {
    mobileContainer.innerHTML = '<div style="text-align:center; padding:40px 20px; color: var(--text-secondary);">Nenhum item encontrado</div>';
    return;
  }
  
  mobileContainer.innerHTML = items.map(function(item) {
    var isLowStock = item.quantity <= (item.min_stock || 0);
    var isCritical = item.quantity <= 0;
    var catLabel = categoryLabels[item.category] || item.category || '-';
    
    // Criar descrição/specs preview
    var specsPreview = item.specs 
      ? '<div style="font-size:11px; color:var(--text-secondary); margin-top:4px; padding:6px 8px; background:rgba(255,255,255,0.03); border-radius:6px; max-height:40px; overflow:hidden;">' + escapeHtml(item.specs.substring(0, 80) + (item.specs.length > 80 ? '...' : '')) + '</div>'
      : '';
    
    // Status visual
    var statusBadge = isCritical 
      ? '<span style="font-size:10px; padding:2px 6px; background:rgba(239,68,68,0.2); color:#ef4444; border-radius:4px;">ZERADO</span>'
      : isLowStock 
        ? '<span style="font-size:10px; padding:2px 6px; background:rgba(245,158,11,0.2); color:#f59e0b; border-radius:4px;">ESTOQUE BAIXO</span>'
        : '<span style="font-size:10px; padding:2px 6px; background:rgba(16,185,129,0.2); color:#10b981; border-radius:4px;">OK</span>';
    
    return '<div class="almox-mobile-item' + (isLowStock ? ' low-stock' : '') + '" onclick="showItemDetail(\'' + item.id + '\')" style="padding:12px;">' +
      '<div class="almox-mobile-item-header">' +
        '<div style="flex:1;">' +
          '<div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">' +
            '<div class="almox-mobile-item-name">' + escapeHtml(item.name) + '</div>' +
            statusBadge +
          '</div>' +
          '<div class="almox-mobile-item-sku" style="display:flex; align-items:center; gap:8px;">' +
            '<code style="background:var(--bg-secondary); padding:2px 6px; border-radius:4px; font-size:10px;">SKU: ' + escapeHtml(item.sku || '-') + '</code>' +
            (item.brand ? '<span style="font-size:11px; color:var(--accent-cyan);">' + escapeHtml(item.brand) + '</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="almox-mobile-item-qty" style="text-align:right;">' +
          '<div class="qty-value" style="font-size:24px; font-weight:700; color:' + (isCritical ? '#ef4444' : isLowStock ? '#f59e0b' : 'var(--accent-cyan)') + ';">' + item.quantity + '</div>' +
          '<div class="qty-unit" style="font-size:11px; color:var(--text-secondary);">' + escapeHtml(item.unit || 'un') + '</div>' +
        '</div>' +
      '</div>' +
      specsPreview +
      '<div class="almox-mobile-item-details" style="display:flex; flex-wrap:wrap; gap:8px; margin-top:8px; padding-top:8px; border-top:1px solid rgba(255,255,255,0.05);">' +
        '<span style="font-size:11px; padding:3px 8px; background:rgba(6,182,212,0.1); border-radius:4px;">' + escapeHtml(catLabel) + '</span>' +
        (item.location ? '<span style="font-size:11px; display:flex; align-items:center; gap:4px;"><span>📍</span>' + escapeHtml(item.location) + '</span>' : '<span style="font-size:11px; color:var(--text-muted); font-style:italic;">Sem local</span>') +
        '<span style="font-size:11px; color:var(--text-secondary);">Min: ' + (item.min_stock || 0) + (item.max_stock ? ' / Max: ' + item.max_stock : '') + '</span>' +
      '</div>' +
    '</div>';
  }).join('');
}

function updateAlmoxarifadoStats() {
  var totalItems = state.inventory.length;
  var estoqueBaixo = state.inventory.filter(function(i) { return i.quantity <= (i.min_stock || 0); }).length;
  var categorias = [...new Set(state.inventory.map(function(i) { return i.category; }))].length;
  var marcas = [...new Set(state.inventory.filter(function(i) { return i.brand; }).map(function(i) { return i.brand; }))].length;
  
  var elTotal = document.getElementById('almox-total-items');
  var elBaixo = document.getElementById('almox-estoque-baixo');
  var elCat = document.getElementById('almox-categorias');
  var elMarcas = document.getElementById('almox-marcas');
  
  if (elTotal) elTotal.textContent = totalItems;
  if (elBaixo) elBaixo.textContent = estoqueBaixo;
  if (elCat) elCat.textContent = categorias;
  if (elMarcas) elMarcas.textContent = marcas;
}

function updateMarcasFilter() {
  var select = document.getElementById('almox-filter-marca');
  if (!select) return;
  
  var marcas = [...new Set(state.inventory.filter(function(i) { return i.brand; }).map(function(i) { return i.brand; }))].sort();
  
  // Manter valor selecionado
  var currentValue = select.value;
  
  select.innerHTML = '<option value="">Todas</option>';
  marcas.forEach(function(marca) {
    var option = document.createElement('option');
    option.value = marca;
    option.textContent = marca;
    if (marca === currentValue) option.selected = true;
    select.appendChild(option);
  });
}

function updateShowingCount(count) {
  var el = document.getElementById('almox-showing-count');
  if (el) el.textContent = count + ' ' + (count === 1 ? 'item' : 'itens');
}

function filterInventoryItems(items) {
  var searchInput = document.getElementById('almox-search-input');
  var catFilter = document.getElementById('almox-filter-categoria');
  var marcaFilter = document.getElementById('almox-filter-marca');
  var statusFilter = document.getElementById('almox-filter-status');
  
  var search = (searchInput && searchInput.value) ? searchInput.value.toLowerCase() : '';
  var categoria = catFilter ? catFilter.value : '';
  var marca = marcaFilter ? marcaFilter.value : '';
  var status = statusFilter ? statusFilter.value : '';
  
  return items.filter(function(item) {
    // Filtro de busca
    if (search) {
      var searchFields = [item.name, item.sku, item.brand, item.category, item.location].join(' ').toLowerCase();
      if (searchFields.indexOf(search) === -1) return false;
    }
    
    // Filtro de categoria
    if (categoria && item.category !== categoria) return false;
    
    // Filtro de marca
    if (marca && item.brand !== marca) return false;
    
    // Filtro de status
    if (status) {
      var isLow = item.quantity <= (item.min_stock || 0);
      var isCritical = item.quantity <= 0;
      if (status === 'normal' && isLow) return false;
      if (status === 'baixo' && (!isLow || isCritical)) return false;
      if (status === 'critico' && !isCritical) return false;
    }
    
    return true;
  });
}

function filterAlmoxarifado() {
  renderInventoryTable();
}

function showItemDetail(itemId) {
  const item = state.inventory.find(i => i.id === itemId);
  if (!item) return;
  
  const isLowStock = item.quantity <= (item.min_stock || 0);
  const isZero = item.quantity <= 0;
  
  const statusConfig = isZero 
    ? { color: '#ef4444', bg: 'rgba(239,68,68,0.15)', text: 'ZERADO', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>' }
    : isLowStock 
    ? { color: '#f59e0b', bg: 'rgba(245,158,11,0.15)', text: 'BAIXO', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>' }
    : { color: '#10b981', bg: 'rgba(16,185,129,0.15)', text: 'OK', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22,4 12,14.01 9,11.01"/></svg>' };
  
  const categoryIcons = {
    ferramentas: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent-cyan)" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
    eletrica: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#facc15" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
    hidraulica: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>',
    rolamentos: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#a855f7" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    epis: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    outros: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>'
  };
  
  const catIcon = categoryIcons[item.category] || categoryIcons.outros;
  
  const modalHtml = `
    <div id="modal-item-detail" class="modal-overlay active" onclick="if(event.target === this) closeModal('modal-item-detail')" style="backdrop-filter: blur(8px); background: rgba(0,0,0,0.7);">
      <div class="modal" style="max-width: 500px; background: linear-gradient(135deg, rgba(15,23,42,0.95) 0%, rgba(30,41,59,0.95) 100%); border: 1px solid rgba(6,182,212,0.2); box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5), 0 0 40px rgba(6,182,212,0.1);">
        
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <div style="width: 48px; height: 48px; background: linear-gradient(135deg, rgba(6,182,212,0.2), rgba(6,182,212,0.05)); border-radius: 12px; display: flex; align-items: center; justify-content: center; border: 1px solid rgba(6,182,212,0.3);">
              ${catIcon}
            </div>
            <div>
              <h3 style="margin: 0; font-size: 18px; color: #fff;">${escapeHtml(item.name)}</h3>
              <code style="background: rgba(6,182,212,0.15); color: var(--accent-cyan); padding: 2px 8px; border-radius: 4px; font-size: 11px;">SKU: ${escapeHtml(item.sku || 'N/A')}</code>
            </div>
          </div>
          <button onclick="closeModal('modal-item-detail')" style="background: none; border: none; color: #64748b; cursor: pointer; padding: 4px; transition: color 0.2s;" onmouseover="this.style.color='#fff'" onmouseout="this.style.color='#64748b'">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        
        <div style="display: flex; gap: 12px; margin-bottom: 20px;">
          <div style="flex: 1; background: rgba(6,182,212,0.1); border: 1px solid rgba(6,182,212,0.2); border-radius: 12px; padding: 16px; text-align: center;">
            <div style="font-size: 32px; font-weight: 700; color: var(--accent-cyan);">${item.quantity}</div>
            <div style="font-size: 12px; color: #64748b; text-transform: uppercase;">${escapeHtml(item.unit || 'un')}</div>
          </div>
          <div style="flex: 1; background: ${statusConfig.bg}; border: 1px solid ${statusConfig.color}33; border-radius: 12px; padding: 16px; text-align: center;">
            <div style="display: flex; align-items: center; justify-content: center; gap: 6px; color: ${statusConfig.color}; margin-bottom: 4px;">
              ${statusConfig.icon}
              <span style="font-size: 14px; font-weight: 600;">${statusConfig.text}</span>
            </div>
            <div style="font-size: 11px; color: #64748b;">Min: ${item.min_stock || 0} ${item.max_stock ? '/ Max: ' + item.max_stock : ''}</div>
          </div>
        </div>
        
        <div style="background: rgba(255,255,255,0.03); border-radius: 12px; padding: 16px; margin-bottom: 16px;">
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
              <div><div style="font-size: 11px; color: #64748b;">Categoria</div><div style="font-size: 13px; color: #fff;">${escapeHtml(item.category || 'N/A')}</div></div>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
              <div><div style="font-size: 11px; color: #64748b;">Marca</div><div style="font-size: 13px; color: #fff;">${escapeHtml(item.brand || 'N/A')}</div></div>
            </div>
            <div style="display: flex; align-items: center; gap: 8px; grid-column: span 2;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
              <div><div style="font-size: 11px; color: #64748b;">Localiza\u00e7\u00e3o</div><div style="font-size: 13px; color: #fff;">${escapeHtml(item.location || 'N\u00e3o definida')}</div></div>
            </div>
          </div>
        </div>
        
        ${item.specs ? `
        <div style="margin-bottom: 16px;">
          <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 8px; color: #64748b; font-size: 12px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10,9 9,9 8,9"/></svg>
            ESPECIFICAÇÕES TÉCNICAS
          </div>
          <div style="background: rgba(255,255,255,0.03); border-radius: 8px; padding: 12px; font-size: 13px; color: #94a3b8; white-space: pre-wrap; max-height: 120px; overflow-y: auto;">${escapeHtml(item.specs)}</div>
        </div>
        ` : `
        <div style="margin-bottom: 16px;">
          <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 8px; color: #64748b; font-size: 12px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10,9 9,9 8,9"/></svg>
            ESPECIFICAÇÕES TÉCNICAS
          </div>
          <div style="background: rgba(255,255,255,0.03); border-radius: 8px; padding: 16px; text-align: center;">
            <div style="color: #64748b; font-size: 12px; margin-bottom: 8px;">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity: 0.5; margin-bottom: 8px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
            </div>
            <div style="font-size: 12px; color: #64748b;">Nenhuma especificação cadastrada</div>
            <div style="font-size: 11px; color: #475569; margin-top: 4px;">Clique em "Editar Item" para adicionar detalhes técnicos</div>
          </div>
        </div>
        `}
        
        <div style="display: flex; gap: 10px;">
          <button onclick="closeModal('modal-item-detail')" style="flex: 1; padding: 12px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; color: #fff; cursor: pointer; font-weight: 500; transition: all 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='rgba(255,255,255,0.05)'">Fechar</button>
          <button onclick="closeModal('modal-item-detail'); showEditItemModal('${item.id}')" style="flex: 1; padding: 12px; background: linear-gradient(135deg, var(--accent-cyan), #0891b2); border: none; border-radius: 10px; color: #000; cursor: pointer; font-weight: 600; transition: all 0.2s;" onmouseover="this.style.transform='translateY(-1px)'" onmouseout="this.style.transform='translateY(0)'">Editar Item</button>
        </div>
      </div>
    </div>
  `;
  
  const existing = document.getElementById('modal-item-detail');
  if (existing) existing.remove();
  
  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function showCreateItem() {
  const modal = document.getElementById('modal-create-item');
  modal.classList.remove('hidden');
  modal.classList.add('active');
}

function showEditItemModal(itemId) {
  const item = state.inventory.find(i => i.id === itemId);
  if (!item) return;
  
  // Por enquanto, abre o modal de criar e preenche com os dados (simplificado)
  // TODO: Criar modal de edição dedicado
  showNotification('Função de edição em desenvolvimento', 'info');
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  modal.classList.remove('active');
  modal.classList.add('hidden');
  // Reset form
  const form = document.querySelector(`#${modalId} form`);
  if (form) form.reset();
}

async function createItemFromForm(event) {
  event.preventDefault();
  
  const formData = new FormData(event.target);
  const itemData = {
    sku: formData.get('sku'),
    name: formData.get('name'),
    category: formData.get('category'),
    brand: formData.get('brand') || null,
    quantity: parseInt(formData.get('quantity')),
    unit: formData.get('unit'),
    min_stock: parseInt(formData.get('min_stock')) || 0,
    max_stock: formData.get('max_stock') ? parseInt(formData.get('max_stock')) : null,
    location: formData.get('location') || null,
    specs: formData.get('specs') || null
  };

  try {
    const response = await fetch(`${API_URL}/inventory`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify(itemData)
    });

    const data = await response.json();
    if (data.ok) {
      showNotification('[ALMOXARIFADO] Item cadastrado com sucesso', 'success');
      closeModal('modal-create-item');
      await loadInventory();
      // await backupInventoryToTXT(); // Desabilitado temporariamente
    } else {
      showNotification('Erro ao criar item: ' + (data.error || 'Erro desconhecido'), 'error');
    }
  } catch (error) {
    console.error('Erro ao criar item:', error);
    showNotification('Erro ao criar item', 'error');
  }
}

async function adjustStock(itemId, delta) {
  const item = state.inventory.find(i => i.id === itemId);
  if (!item) return;

  const newQuantity = item.quantity + delta;
  if (newQuantity < 0) {
    showNotification('Quantidade não pode ser negativa', 'error');
    return;
  }
  if (item.max_stock && newQuantity > item.max_stock) {
    showNotification('Acima do estoque máximo definido', 'warning');
    return;
  }

  try {
    const response = await fetch(`${API_URL}/inventory/${itemId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ quantity: newQuantity })
    });

    const data = await response.json();
    if (data.ok) {
      await loadInventory();
      // await backupInventoryToTXT(); // Desabilitado temporariamente
      showNotification(`✓ ${item.name} atualizado`, 'success');
    } else {
      showNotification('Erro ao atualizar estoque', 'error');
    }
  } catch (error) {
    console.error('Erro ao ajustar estoque:', error);
    showNotification('Erro ao ajustar estoque', 'error');
  }
}

async function deleteItem(itemId) {
  if (!confirm('Tem certeza que deseja excluir este item?')) return;

  try {
    const response = await fetch(`${API_URL}/inventory/${itemId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${state.token}` }
    });

    const data = await response.json();
    if (data.ok) {
      showNotification('[ALMOXARIFADO] Item excluído', 'success');
      await loadInventory();
      // await backupInventoryToTXT(); // Desabilitado temporariamente
    } else {
      showNotification('Erro ao excluir item', 'error');
    }
  } catch (error) {
    console.error('Erro ao excluir item:', error);
    showNotification('Erro ao excluir item', 'error');
  }
}

async function backupInventoryToTXT() {
  try {
    // Gerar conteúdo TXT
    const timestamp = new Date().toLocaleString('pt-BR');
    const tenantName = (state.user && state.user.tenant) ? state.user.tenant.replace(/\s+/g, '_') : 'tenant';
    let content = `BACKUP ALMOXARIFADO - ${timestamp}\n`;
    content += '='.repeat(80) + '\n\n';
    
    state.inventory.forEach(item => {
      content += `SKU: ${item.sku || 'N/A'}\n`;
      content += `Nome: ${item.name}\n`;
      content += `Quantidade: ${item.quantity} ${item.unit}\n`;
      content += `Estoque Mínimo: ${item.min_stock || 0}\n`;
      content += `Estoque Máximo: ${item.max_stock || '-'}\n`;
      content += `Categoria: ${item.category || '-'}\n`;
      content += `Marca: ${item.brand || '-'}\n`;
      content += `Localização: ${item.location || 'N/A'}\n`;
      content += `Última Atualização: ${item.updated_at ? new Date(item.updated_at).toLocaleString('pt-BR') : '-'}\n`;
      content += '-'.repeat(80) + '\n\n';
    });

    // Usar IPC do Electron para salvar arquivo
    if (window.electronAPI && window.electronAPI.saveFile) {
      const result = await window.electronAPI.saveFile({
        filename: `almoxarifado_${tenantName}_backup.txt`,
        content: content
      });
      
      if (result.success) {
        console.log('Backup salvo:', result.path);
      } else {
        console.error('Erro ao salvar backup:', result.error);
      }
    } else {
      // Fallback: download via browser
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `almoxarifado_backup_${Date.now()}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    }
  } catch (error) {
    console.error('Erro ao fazer backup:', error);
  }
}

// Compras Module
async function loadPurchases() {
  try {
    // Se offline, carregar do cache
    if (!state.isOnline) {
      const cached = loadFromCache(CACHE_KEYS.purchases);
      if (cached) {
        state.purchases = cached;
        renderPurchasesTable();
        updateFinancialDashboard();
        showNotification('Modo offline - dados do cache', 'warning');
        return;
      }
    }

    const response = await fetch(`${API_URL}/purchases`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });

    const data = await response.json();
    if (data.ok) {
      state.purchases = data.purchases;
      saveToCache(CACHE_KEYS.purchases, data.purchases); // Salvar no cache
      renderPurchasesTable();
      updateFinancialDashboard();
      // await backupPurchasesToTXT(); // Desabilitado temporariamente
    }
  } catch (error) {
    console.error('Erro ao carregar compras:', error);
    // Tentar carregar do cache em caso de erro
    const cached = loadFromCache(CACHE_KEYS.purchases);
    if (cached) {
      state.purchases = cached;
      renderPurchasesTable();
      updateFinancialDashboard();
      showNotification('Sem conexão - usando dados salvos', 'warning');
    } else {
      showNotification('Erro ao carregar compras', 'error');
    }
  }
}

function updateFinancialDashboard() {
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  
  // Filtrar compras do mês atual
  const thisMonth = state.purchases.filter(p => {
    const date = new Date(p.created_at);
    return date.getMonth() === currentMonth && date.getFullYear() === currentYear;
  });
  
  // Total gasto no mês
  const totalMes = thisMonth.reduce((sum, p) => sum + (p.total_cost || 0), 0);
  
  // Requisições pendentes (análise)
  const pendentes = state.purchases.filter(p => p.status === 'analise').length;
  
  // Pedidos em andamento (pedido + chegando)
  const emAndamento = state.purchases
    .filter(p => p.status === 'pedido' || p.status === 'chegando')
    .reduce((sum, p) => sum + (p.total_cost || 0), 0);
  
  // Economia vs orçamento (exemplo: orçamento mensal de R$ 10.000)
  const orcamento = 10000;
  const economia = ((orcamento - totalMes) / orcamento * 100).toFixed(0);
  
  document.getElementById('compras-total-mes').textContent = `R$ ${totalMes.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;  document.getElementById('compras-pendentes').textContent = pendentes;
  document.getElementById('compras-em-andamento').textContent = `R$ ${emAndamento.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
  document.getElementById('compras-economia').textContent = `${economia}%`;
}

function renderPurchasesTable() {
  const tbody = document.querySelector('#compras-table tbody');
  if (!tbody) return;

  if (state.purchases.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center">Nenhuma requisição cadastrada</td></tr>';
    return;
  }

  const statusLabels = {
    analise: 'Em Análise',
    pedido: 'Pedido Feito',
    chegando: 'Em Trânsito',
    chegou: 'Entregue'
  };

  const statusClasses = {
    analise: 'badge-medium',
    pedido: 'badge-info',
    chegando: 'badge-high',
    chegou: 'badge-low'
  };

  tbody.innerHTML = state.purchases.map(purchase => {
    const unitPrice = purchase.unit_price || 0;
    const totalCost = purchase.total_cost || 0;
    // Criar thumbnail da foto se existir
    const photoHtml = purchase.photo_url 
      ? `<img src="${purchase.photo_url}" class="purchase-photo-thumb" onclick="event.stopPropagation(); showPurchasePhoto('${purchase.id}')" title="Clique para ampliar" alt="Foto da peça">`
      : '<span style="color: var(--text-secondary); font-size: 11px;">Sem foto</span>';
    return `
    <tr onclick="showPurchaseDetails('${purchase.id}')" style="cursor: pointer;" title="Clique para ver detalhes">
      <td class="purchase-item-cell">
        <div class="purchase-item-info">
          <div class="purchase-photo-container">${photoHtml}</div>
          <div class="purchase-item-details">
            <strong>${escapeHtml(purchase.item_name)}</strong>
            <span class="purchase-item-qty">${purchase.quantity} ${purchase.unit}</span>
            ${purchase.notes ? `<span class="purchase-item-notes">${escapeHtml(purchase.notes.substring(0, 50))}${purchase.notes.length > 50 ? '...' : ''}</span>` : ''}
          </div>
        </div>
      </td>
      <td>R$ ${unitPrice.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</td>
      <td><strong>R$ ${totalCost.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</strong></td>
      <td>${escapeHtml(purchase.requested_by_name || 'N/A')}</td>
      <td>
        <span class="badge ${statusClasses[purchase.status]}">
          ${statusLabels[purchase.status]}
        </span>
      </td>
      <td>${new Date(purchase.created_at).toLocaleDateString('pt-BR')}</td>
      <td>
        <div style="display: flex; flex-direction: column; gap: 6px;">
        ${purchase.status !== 'chegou' && (state.user.username === 'joacir' || state.user.roles.includes('admin') || state.user.roles.includes('compras')) ? `
          <button class="btn-small" onclick="showAdvancePurchaseModal('${purchase.id}')">
            Avançar
          </button>
        ` : ''}
        ${purchase.requested_by === state.user.id || state.user.roles.includes('admin') ? `
          <button class="btn-small btn-danger" onclick="deletePurchase('${purchase.id}')">Excluir</button>
        ` : ''}
        </div>
      </td>
    </tr>
  `}).join('');
}

function showCreatePurchase() {
  document.getElementById('form-create-purchase').reset();
  const modal = document.getElementById('modal-create-purchase');
  modal.classList.remove('hidden');
  modal.classList.add('active');
}

function showAdvancePurchaseModal(purchaseId) {
  const purchase = state.purchases.find(p => p.id === purchaseId);
  if (!purchase) return;
  
  const statusFlow = {
    analise: { next: 'pedido', label: 'Pedido Feito' },
    pedido: { next: 'chegando', label: 'Em Trânsito' },
    chegando: { next: 'chegou', label: 'Entregue' }
  };
  
  const nextStatus = statusFlow[purchase.status];
  if (!nextStatus) return;
  
  // Criar modal dinâmico
  const modalHtml = `
    <div id="modal-advance-purchase" class="modal-overlay active" onclick="if(event.target === this) closeModal('modal-advance-purchase')">
      <div class="modal">
        <div class="modal-header">
          <h3 class="modal-title">Avançar para: ${nextStatus.label}</h3>
          <span style="cursor: pointer; font-size: 24px;" onclick="closeModal('modal-advance-purchase')">×</span>
        </div>
        
        <div style="padding: 15px; background: var(--bg-secondary); border-radius: 8px; margin-bottom: 15px;">
          <strong>${purchase.item_name}</strong><br>
          <span style="color: var(--text-secondary);">${purchase.quantity} ${purchase.unit}</span>
        </div>
        
        <form id="form-advance-purchase" onsubmit="advancePurchaseWithDetails(event, '${purchaseId}')">
          ${purchase.status === 'analise' && (!purchase.unit_price || !purchase.supplier) ? `
            <div class="form-row">
              <div class="form-group">
                <label>Preço Unitário (R$)</label>
                <input type="number" name="unit_price" step="0.01" min="0" value="${purchase.unit_price || ''}" placeholder="0.00">
              </div>
              <div class="form-group">
                <label>Fornecedor</label>
                <input type="text" name="supplier" value="${purchase.supplier || ''}" placeholder="Nome do fornecedor">
              </div>
            </div>
          ` : ''}
          
          <div class="form-group">
            <label>Observações (opcional)</label>
            <textarea name="notes" placeholder="Adicione informações relevantes..."></textarea>
          </div>
          
          <div class="modal-actions">
            <button type="button" class="btn-small btn-cancel" onclick="closeModal('modal-advance-purchase')">Cancelar</button>
            <button type="submit" class="btn-small btn-primary">Confirmar Avanço</button>
          </div>
        </form>
      </div>
    </div>
  `;
  
  // Remover modal anterior se existir
  const oldModal = document.getElementById('modal-advance-purchase');
  if (oldModal) oldModal.remove();
  
  // Adicionar novo modal
  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

// Preview foto de compra
function previewPurchasePhoto(input) {
  const preview = document.getElementById('purchase-photo-preview');
  const img = document.getElementById('purchase-photo-img');
  
  if (input.files && input.files[0]) {
    const reader = new FileReader();
    reader.onload = function(e) {
      img.src = e.target.result;
      preview.style.display = 'block';
    };
    reader.readAsDataURL(input.files[0]);
  }
}

// Função para comprimir imagem antes de enviar
function compressImage(file, maxWidth = 800, quality = 0.7) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = function(e) {
      const img = new Image();
      img.onload = function() {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        
        // Redimensionar se maior que maxWidth
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        if (height > maxWidth) {
          width = Math.round((width * maxWidth) / height);
          height = maxWidth;
        }
        
        canvas.width = width;
        canvas.height = height;
        
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        
        // Converter para JPEG comprimido
        const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(compressedDataUrl);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function clearPurchasePhoto() {
  document.getElementById('purchase-photo').value = '';
  document.getElementById('purchase-photo-preview').style.display = 'none';
  document.getElementById('purchase-photo-img').src = '';
}

async function createPurchaseFromForm(event) {
  event.preventDefault();
  
  const formData = new FormData(event.target);
  const quantity = parseInt(formData.get('quantity'));
  const unitPrice = parseFloat(formData.get('price')) || null;
  const totalCost = unitPrice ? quantity * unitPrice : null;
  
  // Converter foto para base64 se existir (com compressão automática)
  let photoUrl = null;
  const photoInput = document.getElementById('purchase-photo');
  if (photoInput && photoInput.files && photoInput.files[0]) {
    const file = photoInput.files[0];
    // Comprimir imagem automaticamente (máx 800px, qualidade 70%)
    photoUrl = await compressImage(file, 800, 0.7);
  }
  
  const purchaseData = {
    item_name: formData.get('item'),
    quantity: quantity,
    unit: formData.get('unit'),
    unit_price: unitPrice,
    total_cost: totalCost,
    supplier: formData.get('supplier') || null,
    notes: formData.get('notes') || null,
    photo_url: photoUrl
  };

  try {
    const response = await fetch(`${API_URL}/purchases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify(purchaseData)
    });

    const data = await response.json();
    if (data.ok) {
      showNotification('[COMPRAS] Requisição criada com sucesso', 'success');
      closeModal('modal-create-purchase');
      clearPurchasePhoto();
      await loadPurchases();
    } else {
      showNotification('Erro ao criar requisição: ' + (data.error || 'Erro desconhecido'), 'error');
    }
  } catch (error) {
    console.error('Erro ao criar requisição:', error);
    showNotification('Erro ao criar requisição', 'error');
  }
}

async function advancePurchaseWithDetails(event, purchaseId) {
  event.preventDefault();
  
  const formData = new FormData(event.target);
  const purchase = state.purchases.find(p => p.id === purchaseId);
  if (!purchase) return;
  
  const statusFlow = {
    analise: 'pedido',
    pedido: 'chegando',
    chegando: 'chegou'
  };
  
  const nextStatus = statusFlow[purchase.status];
  if (!nextStatus) return;
  
  // Preparar dados para atualizar
  const updateData = { status: nextStatus };
  
  const unitPrice = parseFloat(formData.get('unit_price'));
  const supplier = formData.get('supplier');
  const notes = formData.get('notes');
  
  if (unitPrice && unitPrice > 0) {
    updateData.unit_price = unitPrice;
    updateData.total_cost = unitPrice * purchase.quantity;
  }
  if (supplier) updateData.supplier = supplier;
  if (notes) updateData.notes = notes;
  
  try {
    const response = await fetch(`${API_URL}/purchases/${purchaseId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify(updateData)
    });
    
    const data = await response.json();
    if (data.ok) {
      const statusLabels = {
        pedido: 'Pedido Feito',
        chegando: 'Em Trânsito',
        chegou: 'Entregue'
      };
      showNotification(`Status atualizado: ${statusLabels[nextStatus]}`, 'success');
      closeModal('modal-advance-purchase');
      await loadPurchases();
    } else {
      showNotification('Erro ao atualizar: ' + (data.error || 'Erro desconhecido'), 'error');
    }
  } catch (error) {
    console.error('Erro ao avançar:', error);
    showNotification('Erro ao avançar status', 'error');
  }
}

// Função para mostrar foto ampliada
function showPurchasePhoto(purchaseId) {
  const purchase = state.purchases.find(p => p.id === purchaseId);
  if (!purchase || !purchase.photo_url) return;
  
  const modalHtml = `
    <div id="modal-photo-viewer" class="modal-overlay active" onclick="if(event.target === this) closeModal('modal-photo-viewer')" style="z-index: 10001;">
      <div class="photo-viewer-modal">
        <div class="photo-viewer-header">
          <h3>📷 ${escapeHtml(purchase.item_name)}</h3>
          <span style="cursor: pointer; font-size: 28px; color: #fff;" onclick="closeModal('modal-photo-viewer')">×</span>
        </div>
        <div class="photo-viewer-content">
          <img src="${purchase.photo_url}" alt="Foto da peça" class="photo-viewer-img">
        </div>
        <div class="photo-viewer-footer">
          <span>${purchase.quantity} ${purchase.unit}</span>
          ${purchase.notes ? `<span style="color: var(--text-secondary);">• ${escapeHtml(purchase.notes)}</span>` : ''}
        </div>
      </div>
    </div>
  `;
  
  const oldModal = document.getElementById('modal-photo-viewer');
  if (oldModal) oldModal.remove();
  
  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

async function deletePurchase(purchaseId) {
  if (!confirm('Tem certeza que deseja excluir esta requisição?')) return;

  try {
    const response = await fetch(`${API_URL}/purchases/${purchaseId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${state.token}` }
    });

    const data = await response.json();
    if (data.ok) {
      showNotification('[COMPRAS] Requisição excluída', 'success');
      await loadPurchases();
    } else {
      showNotification('Erro ao excluir requisição', 'error');
    }
  } catch (error) {
    console.error('Erro ao excluir requisição:', error);
    showNotification('Erro ao excluir requisição', 'error');
  }
}

async function backupPurchasesToTXT() {
  try {
    const now = new Date();
    const tenantName = (state.user && state.user.tenant) ? state.user.tenant.replace(/\s+/g, '_') : 'tenant';
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 60);

    const recent = state.purchases.filter(p => new Date(p.created_at) >= cutoff);

    let content = `BACKUP COMPRAS - ${now.toLocaleString('pt-BR')}\n`;
    content += `TENANT: ${tenantName}\n`;
    content += '='.repeat(90) + '\n\n';

    recent.forEach(p => {
      content += `ID: ${p.id}\n`;
      content += `Item: ${p.item_name}\n`;
      content += `Qtd: ${p.quantity} ${p.unit}\n`;
      content += `Fornecedor: ${p.supplier || '-'}\n`;
      content += `Status: ${p.status}\n`;
      content += `Total: R$ ${(p.total_cost || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n`;
      content += `Criado em: ${new Date(p.created_at).toLocaleString('pt-BR')}\n`;
      content += `Notas: ${p.notes || '-'}\n`;
      content += '-'.repeat(90) + '\n\n';
    });

    if (window.electronAPI && window.electronAPI.saveFile) {
      await window.electronAPI.saveFile({ filename: `compras_${tenantName}_backup.txt`, content });
    } else {
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `compras_${tenantName}_backup.txt`;
      a.click();
      URL.revokeObjectURL(url);
    }
  } catch (error) {
    console.error('Erro ao fazer backup de compras:', error);
  }
}

// Preventivas Module
async function loadPreventives() {
  try {
    // Se offline, carregar do cache
    if (!state.isOnline) {
      const cached = loadFromCache(CACHE_KEYS.preventives);
      if (cached) {
        state.preventives = cached;
        renderPreventivesTable();
        updatePreventiveDashboard();
        showNotification('Modo offline - dados do cache', 'warning');
        return;
      }
    }

    const response = await fetch(`${API_URL}/preventives`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });

    const data = await response.json();
    if (data.ok) {
      state.preventives = data.preventives || [];
      saveToCache(CACHE_KEYS.preventives, state.preventives); // Salvar no cache
      renderPreventivesTable();
      updatePreventiveDashboard();
    }
  } catch (error) {
    console.error('Erro ao carregar preventivas:', error);
    // Tentar carregar do cache em caso de erro
    const cached = loadFromCache(CACHE_KEYS.preventives);
    if (cached) {
      state.preventives = cached;
      renderPreventivesTable();
      updatePreventiveDashboard();
      showNotification('Sem conexão - usando dados salvos', 'warning');
    } else {
      showNotification('Erro ao carregar preventivas', 'error');
    }
  }
}

function renderPreventivesTable() {
  const tbody = document.querySelector('#preventivas-table tbody');
  if (!tbody) return;

  if (!state.preventives || state.preventives.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center">Nenhuma preventiva cadastrada</td></tr>';
    return;
  }

  const typeLabels = {
    lubrificacao: 'Lubrificação',
    inspecao: 'Inspeção',
    limpeza: 'Limpeza',
    calibracao: 'Calibração',
    troca_peca: 'Troca de Peça',
    teste: 'Teste',
    outro: 'Outro'
  };

  const frequencyLabels = {
    semanal: 'Semanal',
    quinzenal: 'Quinzenal',
    mensal: 'Mensal',
    bimestral: 'Bimestral',
    trimestral: 'Trimestral',
    semestral: 'Semestral',
    anual: 'Anual'
  };

  // Ordenar: vencidas primeiro, depois por data mais próxima
  const sortedPreventives = [...state.preventives].sort((a, b) => {
    const dateA = new Date(a.next_date);
    const dateB = new Date(b.next_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const aVencida = dateA < today;
    const bVencida = dateB < today;
    
    // Vencidas primeiro
    if (aVencida && !bVencida) return -1;
    if (!aVencida && bVencida) return 1;
    
    // Depois ordenar por data
    return dateA - dateB;
  });

  // Verificar alertas de vencimento próximo
  checkPreventiveAlerts(sortedPreventives);

  tbody.innerHTML = sortedPreventives.map(prev => {
    const nextDate = new Date(prev.next_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const daysUntil = Math.ceil((nextDate - today) / (1000 * 60 * 60 * 24));
    
    let statusClass = 'badge-low';
    let statusText = 'Em Dia';
    let rowClass = '';
    
    if (daysUntil < 0) {
      statusClass = 'badge-high';
      statusText = `VENCIDA (${Math.abs(daysUntil)}d)`;
      rowClass = 'row-expired';
    } else if (daysUntil === 0) {
      statusClass = 'badge-high';
      statusText = 'VENCE HOJE!';
      rowClass = 'row-today';
    } else if (daysUntil === 1) {
      statusClass = 'badge-medium';
      statusText = 'VENCE AMANHÃ!';
      rowClass = 'row-warning';
    } else if (daysUntil <= 7) {
      statusClass = 'badge-medium';
      statusText = `${daysUntil}d restantes`;
    }

    return `
    <tr class="${rowClass}">
      <td><strong>${prev.equipment_name}</strong></td>
      <td><span class="badge badge-info">${typeLabels[prev.maintenance_type] || prev.maintenance_type}</span></td>
      <td>${frequencyLabels[prev.frequency] || prev.frequency}</td>
      <td>${nextDate.toLocaleDateString('pt-BR')}</td>
      <td>${prev.last_date ? new Date(prev.last_date).toLocaleDateString('pt-BR') : '-'}</td>
      <td><span class="badge ${statusClass}">${statusText}</span></td>
      <td>
        <button class="btn-small btn-success" onclick="markPreventiveDone(${prev.id})">✓ Feito</button>
        <button class="btn-small btn-danger" onclick="deletePreventive(${prev.id})">Excluir</button>
      </td>
    </tr>
  `}).join('');
}

// Verificar alertas de preventivas
function checkPreventiveAlerts(preventives) {
  const alertContainer = document.getElementById('preventive-alerts');
  if (!alertContainer) return;
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const alerts = [];
  
  preventives.forEach(prev => {
    const nextDate = new Date(prev.next_date);
    const daysUntil = Math.ceil((nextDate - today) / (1000 * 60 * 60 * 24));
    
    if (daysUntil < 0) {
      alerts.push({
        type: 'danger',
        icon: '🚨',
        title: 'Preventiva VENCIDA',
        text: `${prev.equipment_name} está ${Math.abs(daysUntil)} dia(s) atrasada!`
      });
    } else if (daysUntil === 0) {
      alerts.push({
        type: 'warning',
        icon: '⚠️',
        title: 'Vence HOJE',
        text: `${prev.equipment_name} vence hoje!`
      });
    } else if (daysUntil === 1) {
      alerts.push({
        type: 'info',
        icon: '📢',
        title: 'Vence AMANHÃ',
        text: `${prev.equipment_name} vence amanhã!`
      });
    }
  });
  
  if (alerts.length === 0) {
    alertContainer.innerHTML = '';
    return;
  }
  
  alertContainer.innerHTML = alerts.slice(0, 5).map(alert => `
    <div class="preventive-alert ${alert.type}">
      <span class="alert-icon">${alert.icon}</span>
      <div class="alert-content">
        <strong>${alert.title}</strong>
        <span>${alert.text}</span>
      </div>
    </div>
  `).join('');
}

// Marcar preventiva como feita (reinicia a data)
async function markPreventiveDone(id) {
  if (!confirm('Marcar esta preventiva como concluída? A próxima data será recalculada automaticamente.')) return;
  
  try {
    const response = await fetch(`${API_URL}/preventives/${id}/complete`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${state.token}`,
        'Content-Type': 'application/json'
      }
    });
    
    const data = await response.json();
    if (data.ok) {
      showNotification('Preventiva concluída! Próxima data atualizada.', 'success');
      await loadPreventives();
    } else {
      showNotification('Erro ao concluir: ' + data.error, 'error');
    }
  } catch (error) {
    showNotification('Erro de conexão', 'error');
  }
}

function updatePreventiveDashboard() {
  const today = new Date();
  const next7Days = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
  const thisMonth = today.getMonth();
  const thisYear = today.getFullYear();

  const proximas = state.preventives.filter(p => {
    const nextDate = new Date(p.next_date);
    return nextDate >= today && nextDate <= next7Days;
  }).length;

  const atrasadas = state.preventives.filter(p => {
    const nextDate = new Date(p.next_date);
    return nextDate < today;
  }).length;

  const concluidasMes = state.preventives.filter(p => {
    if (!p.last_date) return false;
    const lastDate = new Date(p.last_date);
    return lastDate.getMonth() === thisMonth && lastDate.getFullYear() === thisYear;
  }).length;

  const totalAno = state.preventives.filter(p => {
    if (!p.last_date) return false;
    const lastDate = new Date(p.last_date);
    return lastDate.getFullYear() === thisYear;
  }).length;

  document.getElementById('prev-proximas').textContent = proximas;
  document.getElementById('prev-atrasadas').textContent = atrasadas;
  document.getElementById('prev-concluidas-mes').textContent = concluidasMes;
  document.getElementById('prev-total-ano').textContent = totalAno;
}

function showCreatePreventive() {
  const modal = document.getElementById('modal-create-preventive');
  modal.classList.remove('hidden');
  modal.classList.add('active');
}

async function createPreventiveFromForm(event) {
  event.preventDefault();
  
  const formData = new FormData(event.target);
  const preventiveData = {
    equipment_name: formData.get('equipment_name'),
    maintenance_type: formData.get('maintenance_type'),
    frequency: formData.get('frequency'),
    next_date: formData.get('next_date'),
    responsible: formData.get('responsible') || null,
    checklist: formData.get('checklist') || null
  };

  try {
    const response = await fetch(`${API_URL}/preventives`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify(preventiveData)
    });

    const data = await response.json();
    if (data.ok) {
      showNotification('[PREVENTIVA] Cadastrada com sucesso', 'success');
      closeModal('modal-create-preventive');
      await loadPreventives();
    } else {
      showNotification('Erro ao criar preventiva: ' + (data.error || 'Erro desconhecido'), 'error');
    }
  } catch (error) {
    console.error('Erro ao criar preventiva:', error);
    showNotification('Erro ao criar preventiva', 'error');
  }
}

async function completePreventive(preventiveId) {
  const prev = state.preventives.find(p => p.id === preventiveId);
  if (!prev) return;

  if (!confirm(`Marcar "${prev.equipment_name}" como concluída?`)) return;

  try {
    const response = await fetch(`${API_URL}/preventives/${preventiveId}/complete`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${state.token}`,
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();
    if (data.ok) {
      showNotification('[PREVENTIVA] Concluída! Próxima data agendada.', 'success');
      await loadPreventives();
    } else {
      showNotification('Erro ao concluir preventiva', 'error');
    }
  } catch (error) {
    console.error('Erro ao concluir preventiva:', error);
    showNotification('Erro ao concluir preventiva', 'error');
  }
}

async function deletePreventive(preventiveId) {
  if (!confirm('Tem certeza que deseja excluir esta preventiva?')) return;

  try {
    const response = await fetch(`${API_URL}/preventives/${preventiveId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${state.token}` }
    });

    const data = await response.json();
    if (data.ok) {
      showNotification('[PREVENTIVA] Excluída', 'success');
      await loadPreventives();
    } else {
      showNotification('Erro ao excluir preventiva', 'error');
    }
  } catch (error) {
    console.error('Erro ao excluir preventiva:', error);
    showNotification('Erro ao excluir preventiva', 'error');
  }
}

// Configurações Module
function loadConfigurations() {
  // Carregar dados do usuário
  if (state.user) {
    document.getElementById('config-username').value = state.user.username || '';
  }
  
  // Carregar key
  const savedKey = localStorage.getItem('icarus_key');
  if (savedKey) {
    document.getElementById('config-key').value = savedKey;
  }
  
  // Carregar preferências
  const rememberMe = localStorage.getItem('icarus_remember_me') === 'true';
  document.getElementById('config-remember-me').checked = rememberMe;
  
  const whatsappEnabled = localStorage.getItem('icarus_whatsapp_enabled') === 'true';
  document.getElementById('config-whatsapp-enabled').checked = whatsappEnabled;
  
  const whatsappPhone = localStorage.getItem('icarus_whatsapp_phone');
  if (whatsappPhone) {
    document.getElementById('config-whatsapp-phone').value = whatsappPhone;
  }
  
  if (whatsappEnabled) {
    document.getElementById('whatsapp-config').classList.remove('hidden');
  }
  
  // Salvar quando mudar remember-me
  document.getElementById('config-remember-me').addEventListener('change', (e) => {
    localStorage.setItem('icarus_remember_me', e.target.checked);
    if (e.target.checked) {
      // Salvar credenciais
      localStorage.setItem('icarus_key', document.getElementById('config-key').value);
      localStorage.setItem('icarus_username', state.user.username);
    } else {
      // Limpar credenciais salvas (mas manter a sessão atual)
      localStorage.removeItem('icarus_key');
      localStorage.removeItem('icarus_username');
    }
  });
}

function toggleWhatsAppConfig() {
  const enabled = document.getElementById('config-whatsapp-enabled').checked;
  const configDiv = document.getElementById('whatsapp-config');
  
  if (enabled) {
    configDiv.classList.remove('hidden');
  } else {
    configDiv.classList.add('hidden');
  }
  
  localStorage.setItem('icarus_whatsapp_enabled', enabled);
}

async function verifyWhatsApp() {
  const phone = document.getElementById('config-whatsapp-phone').value.trim();
  
  if (!phone) {
    alert('Por favor, insira seu número de WhatsApp');
    return;
  }
  
  // Validar formato básico
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length < 10 || cleaned.length > 11) {
    alert('Número inválido. Use o formato: (XX) XXXXX-XXXX');
    return;
  }
  
  try {
    const response = await fetch(`${API_URL}/config/verify-whatsapp`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${state.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ phone: cleaned })
    });

    const data = await response.json();
    if (data.ok) {
      localStorage.setItem('icarus_whatsapp_phone', phone);
      showNotification('[WHATSAPP] Verificado! Você receberá notificações.', 'success');
    } else {
      showNotification('Erro ao verificar WhatsApp: ' + (data.error || 'Tente novamente'), 'error');
    }
  } catch (error) {
    console.error('Erro ao verificar WhatsApp:', error);
    showNotification('Erro ao verificar WhatsApp', 'error');
  }
}

function openWhatsAppSupport() {
  // Seu número de WhatsApp para suporte
  const supportPhone = '5511999999999'; // ALTERAR PARA SEU NÚMERO
  const message = encodeURIComponent('Olá! Preciso de ajuda com o sistema Icarus.');
  window.open(`https://wa.me/${supportPhone}?text=${message}`, '_blank');
}

function openDocumentation() {
  alert('Documentação em desenvolvimento!\n\nEm breve teremos um guia completo do sistema.');
}

function reportBug() {
  const description = prompt('Descreva o problema que encontrou:');
  if (!description) return;
  
  showNotification('[BUG REPORTADO] Obrigado! Vamos analisar o problema.', 'success');
  console.log('Bug Report:', description, 'User:', state.user.username);
}

// Busca rápida global (Ctrl+K)
function initQuickSearch() {
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      showQuickSearch();
    }
  });
}

function showQuickSearch() {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay active';
  modal.innerHTML = `
    <div class="modal" style="max-width: 600px;">
      <div class="modal-header">
        <h3 class="modal-title">🔍 Busca Rápida</h3>
        <span style="cursor: pointer; font-size: 24px;" onclick="this.closest('.modal-overlay').remove()">×</span>
      </div>
      <input type="text" id="quick-search-input" placeholder="Digite para buscar OS, peças, compras..." 
        style="width: 100%; padding: 12px; font-size: 16px; border: 1px solid var(--border-color); border-radius: 6px; background: var(--bg-secondary); color: var(--text-primary); margin-bottom: 15px;">
      <div id="quick-search-results" style="max-height: 400px; overflow-y: auto;"></div>
    </div>
  `;
  document.body.appendChild(modal);
  
  const input = document.getElementById('quick-search-input');
  input.focus();
  
  input.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    if (query.length < 2) {
      document.getElementById('quick-search-results').innerHTML = '<p style="color: var(--text-secondary); text-align: center;">Digite pelo menos 2 caracteres</p>';
      return;
    }
    
    const results = [];
    
    // Buscar OS
    state.orders.forEach(o => {
      if (o.title.toLowerCase().includes(query) || (o.description && o.description.toLowerCase().includes(query))) {
        results.push({ type: 'OS', title: o.title, id: o.id, action: () => { modal.remove(); navigateTo('os'); setTimeout(() => showOSDetail(o.id), 300); } });
      }
    });
    
    // Buscar peças
    state.inventory.forEach(i => {
      if (i.name.toLowerCase().includes(query) || (i.sku && i.sku.toLowerCase().includes(query))) {
        results.push({ type: 'Peça', title: i.name, id: i.sku, action: () => { modal.remove(); navigateTo('almoxarifado'); } });
      }
    });
    
    // Buscar compras
    state.purchases.forEach(p => {
      if (p.item_name.toLowerCase().includes(query)) {
        results.push({ type: 'Compra', title: p.item_name, id: p.id, action: () => { modal.remove(); navigateTo('compras'); } });
      }
    });
    
    if (results.length === 0) {
      document.getElementById('quick-search-results').innerHTML = '<p style="color: var(--text-secondary); text-align: center;">Nenhum resultado encontrado</p>';
    } else {
      document.getElementById('quick-search-results').innerHTML = results.slice(0, 10).map(r => `
        <div onclick="(${r.action.toString()})()" style="padding: 12px; border-bottom: 1px solid var(--border-color); cursor: pointer; transition: background 0.2s;" 
          onmouseover="this.style.background='var(--bg-secondary)'" onmouseout="this.style.background='transparent'">
          <span style="color: var(--accent-gold); font-weight: bold;">[${escapeHtml(r.type)}]</span> ${escapeHtml(r.title)}
          ${r.id ? `<span style="color: var(--text-secondary); font-size: 12px;"> • ${escapeHtml(r.id)}</span>` : ''}
        </div>
      `).join('');
    }
  });
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
}

function logout() {
  if (!confirm('Tem certeza que deseja sair?')) return;

  localStorage.removeItem('token');
  localStorage.removeItem('user');
  delete state.token;
  delete state.user;

  showLoginScreen();
}

function showLoginScreen() {
  document.getElementById('app-screen').style.display = 'none';
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('login-form').classList.add('hidden');
  document.getElementById('key-validation-form').classList.remove('hidden');
  document.getElementById('auth-error').classList.add('hidden');
}

// Mobile Menu Toggle
function toggleMobileMenu() {
  const sidebar = document.querySelector('.sidebar');
  const toggle = document.querySelector('.mobile-menu-toggle');
  
  sidebar.classList.toggle('mobile-open');
  toggle.classList.toggle('active');
  
  // Fechar ao clicar em qualquer item do menu
  if (sidebar.classList.contains('mobile-open')) {
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        sidebar.classList.remove('mobile-open');
        toggle.classList.remove('active');
      }, { once: true });
    });
  }
}

// Fechar menu ao clicar fora
document.addEventListener('click', (e) => {
  const sidebar = document.querySelector('.sidebar');
  const toggle = document.querySelector('.mobile-menu-toggle');
  
  if (sidebar && toggle && sidebar.classList.contains('mobile-open')) {
    if (!sidebar.contains(e.target) && !toggle.contains(e.target)) {
      sidebar.classList.remove('mobile-open');
      toggle.classList.remove('active');
    }
  }
});

// ========== CHECKLISTS MODULE ==========

// State for checklists
state.checklists = [];
state.currentChecklistId = null;

// Check if user can edit checklists
function canEditChecklist() {
  const roles = state.user?.roles || [];
  return roles.includes('admin') || roles.includes('os_manage_all') || roles.includes('checklist');
}

// Load checklists
async function loadChecklists() {
  try {
    const response = await fetch(`${API_URL}/checklists`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await response.json();
    if (data.ok) {
      state.checklists = data.checklists || [];
      renderChecklists();
    }
  } catch (error) {
    console.error('Erro ao carregar checklists:', error);
  }
}

// Render checklists list
function renderChecklists() {
  const container = document.getElementById('checklists-list');
  if (!container) return;
  
  const canEdit = canEditChecklist();
  
  // Hide/show create button based on permission
  const createBtn = document.getElementById('btn-create-checklist');
  if (createBtn) {
    createBtn.style.display = canEdit ? 'flex' : 'none';
  }
  
  // Update stats
  const totalEl = document.getElementById('checklists-total');
  const pendentesEl = document.getElementById('checklists-pendentes');
  const concluidosEl = document.getElementById('checklists-concluidos');
  
  if (totalEl) totalEl.textContent = state.checklists.length;
  if (pendentesEl) pendentesEl.textContent = state.checklists.length; // Simplified: all are pending
  if (concluidosEl) concluidosEl.textContent = '0';
  
  if (state.checklists.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px 20px; color: var(--text-secondary);">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity: 0.5; margin-bottom: 16px;">
          <path d="M9 11l3 3L22 4"/>
          <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
        </svg>
        <p style="margin: 0 0 8px 0; font-size: 16px;">Nenhum checklist cadastrado</p>
        <p style="margin: 0; font-size: 13px;">Clique em "Novo Checklist" para começar</p>
      </div>
    `;
    return;
  }
  
  const frequencyLabels = {
    diario: 'Diário',
    semanal: 'Semanal',
    mensal: 'Mensal'
  };
  
  const frequencyIcons = {
    diario: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
    semanal: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    mensal: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01"/></svg>'
  };
  
  container.innerHTML = state.checklists.map(cl => {
    // Verificar se automação está ativa
    const isAutoEnabled = cl.auto_complete === true;
    const autoFreqDays = cl.frequency_days || 1;
    const lastAutoRun = cl.last_auto_run ? new Date(cl.last_auto_run).toLocaleDateString('pt-BR') : null;
    
    return `
    <div class="checklist-item-card" style="background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 14px; padding: 18px; margin-bottom: 14px; transition: all 0.2s; ${isAutoEnabled ? 'border-color: rgba(168, 85, 247, 0.4); box-shadow: 0 0 20px rgba(168, 85, 247, 0.1);' : ''}">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px;">
        <div style="display: flex; gap: 14px; align-items: flex-start;">
          <div style="width: 44px; height: 44px; background: linear-gradient(135deg, ${isAutoEnabled ? 'rgba(168, 85, 247, 0.2) 0%, rgba(139, 92, 246, 0.1)' : 'rgba(16, 185, 129, 0.2) 0%, rgba(5, 150, 105, 0.1)'} 100%); border-radius: 10px; display: flex; align-items: center; justify-content: center; color: ${isAutoEnabled ? '#a855f7' : '#10b981'};">
            ${isAutoEnabled ? `
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
              </svg>
            ` : `
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 11l3 3L22 4"/>
                <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
              </svg>
            `}
          </div>
          <div>
            <h4 style="margin: 0 0 4px 0; color: var(--text-primary); font-size: 16px; font-weight: 600;">${escapeHtml(cl.name)}</h4>
            <p style="margin: 0; font-size: 13px; color: var(--text-secondary); display: flex; align-items: center; gap: 8px;">
              <span style="display: flex; align-items: center; gap: 4px;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                ${escapeHtml(cl.sector) || 'Sem setor'}
              </span>
              <span style="opacity: 0.5;">•</span>
              <span>${cl.items?.length || 0} itens</span>
            </p>
          </div>
        </div>
        <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 6px;">
          <span style="display: flex; align-items: center; gap: 6px; padding: 6px 12px; background: rgba(16, 185, 129, 0.15); color: #10b981; border-radius: 20px; font-size: 12px; font-weight: 500;">
            ${frequencyIcons[cl.frequency] || ''}
            ${escapeHtml(frequencyLabels[cl.frequency] || cl.frequency)}
          </span>
          ${isAutoEnabled ? `
            <span style="display: flex; align-items: center; gap: 5px; padding: 5px 10px; background: linear-gradient(135deg, rgba(168, 85, 247, 0.2), rgba(139, 92, 246, 0.1)); color: #a855f7; border-radius: 15px; font-size: 10px; font-weight: 600; text-transform: uppercase; border: 1px solid rgba(168, 85, 247, 0.3);">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4"/></svg>
              Auto • A cada ${autoFreqDays} dia${autoFreqDays > 1 ? 's' : ''}
            </span>
          ` : ''}
        </div>
      </div>
      
      ${cl.description ? `<p style="font-size: 13px; color: var(--text-secondary); margin: 0 0 14px 0; padding-left: 58px;">${escapeHtml(cl.description)}</p>` : ''}
      
      ${isAutoEnabled && lastAutoRun ? `
        <div style="margin: 0 0 14px 0; padding: 10px 14px; padding-left: 58px; display: inline-flex; align-items: center; gap: 8px; background: rgba(168, 85, 247, 0.08); border-radius: 8px; font-size: 12px; color: #c084fc; margin-left: 58px;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          Última execução automática: ${lastAutoRun}
        </div>
      ` : ''}
      
      <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; padding-left: 58px;">
        ${(cl.items || []).slice(0, 4).map(item => `
          <span style="font-size: 12px; padding: 6px 10px; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 6px; color: var(--text-secondary); display: flex; align-items: center; gap: 6px;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/></svg>
            ${escapeHtml(item.description)}
          </span>
        `).join('')}
        ${(cl.items?.length || 0) > 4 ? `<span style="font-size: 12px; padding: 6px 10px; color: var(--text-secondary);">+${cl.items.length - 4} mais</span>` : ''}
      </div>
      
      <div style="display: flex; flex-wrap: wrap; gap: 10px; padding-left: 58px;">
        <button class="btn-checklist-execute" onclick="openExecuteChecklist('${sanitizeId(cl.id)}')" style="display: flex; align-items: center; gap: 6px; padding: 10px 16px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); border: none; border-radius: 8px; color: #fff; font-size: 13px; font-weight: 600; cursor: pointer; box-shadow: 0 4px 15px rgba(16, 185, 129, 0.3);">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
          Executar
        </button>
        <button class="btn-checklist-secondary" onclick="viewChecklistHistory('${sanitizeId(cl.id)}')" style="display: flex; align-items: center; gap: 6px; padding: 10px 16px; background: rgba(255,255,255,0.05); border: 1px solid var(--border-color); border-radius: 8px; color: var(--text-secondary); font-size: 13px; cursor: pointer;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          Histórico
        </button>
        ${canEdit ? `
          <button class="btn-checklist-auto" onclick="showChecklistAutomation('${sanitizeId(cl.id)}')" style="display: flex; align-items: center; gap: 6px; padding: 10px 16px; background: ${isAutoEnabled ? 'linear-gradient(135deg, #a855f7, #7c3aed)' : 'rgba(168, 85, 247, 0.1)'}; border: 1px solid ${isAutoEnabled ? 'transparent' : 'rgba(168, 85, 247, 0.3)'}; border-radius: 8px; color: ${isAutoEnabled ? '#fff' : '#a855f7'}; font-size: 13px; cursor: pointer; font-weight: ${isAutoEnabled ? '600' : '400'}; ${isAutoEnabled ? 'box-shadow: 0 4px 15px rgba(168, 85, 247, 0.3);' : ''}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4"/></svg>
            ${isAutoEnabled ? 'Automático' : 'Automatizar'}
          </button>
          <button class="btn-checklist-secondary" onclick="editChecklist('${sanitizeId(cl.id)}')" style="display: flex; align-items: center; gap: 6px; padding: 10px 16px; background: rgba(255,255,255,0.05); border: 1px solid var(--border-color); border-radius: 8px; color: var(--text-secondary); font-size: 13px; cursor: pointer;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Editar
          </button>
          <button class="btn-checklist-danger" onclick="deleteChecklist('${sanitizeId(cl.id)}')" style="display: flex; align-items: center; gap: 6px; padding: 10px 16px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 8px; color: #ef4444; font-size: 13px; cursor: pointer;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            Excluir
          </button>
        ` : ''}
      </div>
    </div>
  `}).join('');
}

// Mostrar modal de automação de checklist
function showChecklistAutomation(checklistId) {
  const checklist = state.checklists.find(c => c.id === checklistId);
  if (!checklist) return;
  
  const isEnabled = checklist.auto_complete === true;
  const freqDays = checklist.frequency_days || 1;
  
  const modalHtml = `
    <div id="modal-checklist-automation" class="modal-overlay active" style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); backdrop-filter: blur(8px); z-index: 9999; display: flex; align-items: center; justify-content: center; padding: 20px;">
      <div style="background: linear-gradient(135deg, #0f0f14 0%, #1a1020 100%); border: 1px solid rgba(168, 85, 247, 0.3); border-radius: 20px; max-width: 420px; width: 100%; padding: 28px; animation: slideInMagenta 0.3s ease-out;">
        <div style="display: flex; align-items: center; gap: 14px; margin-bottom: 24px;">
          <div style="width: 50px; height: 50px; background: linear-gradient(135deg, #a855f7, #7c3aed); border-radius: 14px; display: flex; align-items: center; justify-content: center; box-shadow: 0 8px 25px rgba(168, 85, 247, 0.4);">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
          </div>
          <div>
            <h3 style="margin: 0; font-size: 18px; color: #fff; font-weight: 700;">Automação de Checklist</h3>
            <p style="margin: 4px 0 0 0; font-size: 13px; color: rgba(255,255,255,0.6);">${escapeHtml(checklist.name)}</p>
          </div>
        </div>
        
        <div style="background: rgba(168, 85, 247, 0.1); border: 1px solid rgba(168, 85, 247, 0.2); border-radius: 12px; padding: 16px; margin-bottom: 20px;">
          <p style="margin: 0; font-size: 13px; color: rgba(255,255,255,0.7); line-height: 1.6;">
            <strong style="color: #c084fc;">Automação:</strong> Quando ativada, o checklist será marcado como concluído automaticamente na frequência definida (ex: dia sim, dia não).
          </p>
        </div>
        
        <div style="margin-bottom: 20px;">
          <label style="display: flex; align-items: center; gap: 12px; cursor: pointer; padding: 16px; background: rgba(255,255,255,0.03); border: 1px solid var(--border-color); border-radius: 12px;">
            <input type="checkbox" id="auto-enabled" ${isEnabled ? 'checked' : ''} style="width: 20px; height: 20px; accent-color: #a855f7;">
            <div>
              <span style="font-size: 14px; font-weight: 600; color: #fff;">Ativar execução automática</span>
              <p style="margin: 4px 0 0 0; font-size: 12px; color: rgba(255,255,255,0.5);">Marca automaticamente como feito</p>
            </div>
          </label>
        </div>
        
        <div style="margin-bottom: 24px;">
          <label style="display: block; font-size: 13px; font-weight: 600; color: rgba(255,255,255,0.8); margin-bottom: 8px;">Frequência (em dias)</label>
          <div style="display: flex; gap: 10px;">
            <button type="button" onclick="setAutoFreq(1)" class="freq-btn" style="flex: 1; padding: 12px; background: ${freqDays === 1 ? 'linear-gradient(135deg, #a855f7, #7c3aed)' : 'rgba(255,255,255,0.05)'}; border: 1px solid ${freqDays === 1 ? 'transparent' : 'var(--border-color)'}; border-radius: 10px; color: #fff; font-size: 13px; font-weight: 600; cursor: pointer;">Diário</button>
            <button type="button" onclick="setAutoFreq(2)" class="freq-btn" style="flex: 1; padding: 12px; background: ${freqDays === 2 ? 'linear-gradient(135deg, #a855f7, #7c3aed)' : 'rgba(255,255,255,0.05)'}; border: 1px solid ${freqDays === 2 ? 'transparent' : 'var(--border-color)'}; border-radius: 10px; color: #fff; font-size: 13px; font-weight: 600; cursor: pointer;">Dia sim/não</button>
            <button type="button" onclick="setAutoFreq(3)" class="freq-btn" style="flex: 1; padding: 12px; background: ${freqDays === 3 ? 'linear-gradient(135deg, #a855f7, #7c3aed)' : 'rgba(255,255,255,0.05)'}; border: 1px solid ${freqDays === 3 ? 'transparent' : 'var(--border-color)'}; border-radius: 10px; color: #fff; font-size: 13px; font-weight: 600; cursor: pointer;">A cada 3 dias</button>
          </div>
          <input type="hidden" id="auto-freq-days" value="${freqDays}">
        </div>
        
        <div style="display: flex; gap: 12px;">
          <button onclick="closeChecklistAutomation()" style="flex: 1; padding: 14px; background: rgba(255,255,255,0.05); border: 1px solid var(--border-color); border-radius: 10px; color: var(--text-secondary); font-size: 14px; cursor: pointer;">Cancelar</button>
          <button onclick="saveChecklistAutomation('${checklistId}')" style="flex: 1; padding: 14px; background: linear-gradient(135deg, #a855f7, #7c3aed); border: none; border-radius: 10px; color: #fff; font-size: 14px; font-weight: 600; cursor: pointer; box-shadow: 0 4px 15px rgba(168, 85, 247, 0.4);">Salvar</button>
        </div>
      </div>
    </div>
  `;
  
  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

// Definir frequência na modal
function setAutoFreq(days) {
  document.getElementById('auto-freq-days').value = days;
  
  // Atualizar visual dos botões
  document.querySelectorAll('.freq-btn').forEach((btn, i) => {
    const btnDays = i + 1;
    if (btnDays === days) {
      btn.style.background = 'linear-gradient(135deg, #a855f7, #7c3aed)';
      btn.style.borderColor = 'transparent';
    } else {
      btn.style.background = 'rgba(255,255,255,0.05)';
      btn.style.borderColor = 'var(--border-color)';
    }
  });
}

// Fechar modal de automação
function closeChecklistAutomation() {
  const modal = document.getElementById('modal-checklist-automation');
  if (modal) modal.remove();
}

// Salvar configuração de automação
async function saveChecklistAutomation(checklistId) {
  const enabled = document.getElementById('auto-enabled').checked;
  const freqDays = parseInt(document.getElementById('auto-freq-days').value) || 1;
  
  try {
    const response = await fetch(`${API_URL}/checklists/${checklistId}/automation`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + state.token
      },
      body: JSON.stringify({
        auto_complete: enabled,
        frequency_days: freqDays
      })
    });
    
    const data = await response.json();
    
    if (data.ok) {
      closeChecklistAutomation();
      await loadChecklists();
      renderChecklists();
      showNotification(enabled ? 'Automação ativada com sucesso!' : 'Automação desativada', 'success');
    } else {
      showNotification(data.error || 'Erro ao salvar automação', 'error');
    }
  } catch (error) {
    console.error('Erro ao salvar automação:', error);
    showNotification('Erro ao salvar automação', 'error');
  }
}

// Show create checklist modal
function showCreateChecklist() {
  document.getElementById('form-create-checklist').reset();
  const modal = document.getElementById('modal-create-checklist');
  modal.classList.remove('hidden');
  modal.classList.add('active');
}

// Create checklist from form
async function createChecklistFromForm(event) {
  event.preventDefault();
  
  const name = document.getElementById('checklist-name').value.trim();
  const sector = document.getElementById('checklist-sector').value.trim();
  const frequency = document.getElementById('checklist-frequency').value;
  const description = document.getElementById('checklist-description').value.trim();
  const itemsText = document.getElementById('checklist-items').value.trim();
  
  const items = itemsText.split('\n').map(i => i.trim()).filter(i => i.length > 0);
  
  if (!name || items.length === 0) {
    showNotification('Preencha o nome e pelo menos um item', 'error');
    return;
  }
  
  try {
    const response = await fetch(`${API_URL}/checklists`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${state.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name, sector, frequency, description, items })
    });
    
    const data = await response.json();
    if (data.ok) {
      state.checklists = data.checklists || [];
      renderChecklists();
      closeModal('modal-create-checklist');
      showNotification('Checklist criado com sucesso!', 'success');
    } else {
      showNotification(data.error || 'Erro ao criar checklist', 'error');
    }
  } catch (error) {
    showNotification('Erro ao criar checklist: ' + error.message, 'error');
  }
}

// Open execute checklist modal
function openExecuteChecklist(checklistId) {
  const checklist = state.checklists.find(c => c.id === checklistId);
  if (!checklist) return;
  
  state.currentChecklistId = checklistId;
  
  document.getElementById('execute-checklist-title').textContent = checklist.name;
  document.getElementById('execute-checklist-notes').value = '';
  
  const items = checklist.items || [];
  const container = document.getElementById('execute-checklist-items');
  
  // Atualizar contadores
  const totalCount = document.getElementById('chk-total-count');
  const checkedCount = document.getElementById('chk-checked-count');
  if (totalCount) totalCount.textContent = items.length;
  if (checkedCount) checkedCount.textContent = '0';
  
  // Reset progress bar
  const progressFill = document.getElementById('chk-progress-fill');
  if (progressFill) progressFill.style.width = '0%';
  
  container.innerHTML = items.map((item, idx) => `
    <div class="chk-exec-item" data-idx="${idx}" onclick="toggleChecklistItem(this, ${idx})">
      <span class="chk-item-num">${idx + 1}</span>
      <div class="chk-checkbox-wrapper">
        <input type="checkbox" id="exec-item-${idx}" data-item-id="${sanitizeId(item.id)}" onchange="updateChecklistProgress()">
        <div class="chk-checkbox-custom">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </div>
      </div>
      <span class="chk-item-label">${escapeHtml(item.description)}</span>
    </div>
  `).join('');
  
  // Mostrar opção de criar OS apenas para manutenção
  const createOSSection = document.getElementById('chk-create-os-section');
  const createOSCheck = document.getElementById('chk-create-os-check');
  const executorSelect = document.getElementById('chk-os-executor-select');
  
  if (createOSSection) {
    const canCreateOS = state.user && state.user.roles && (
      state.user.roles.includes('admin') || 
      state.user.roles.includes('os_manage_all') || 
      state.user.roles.includes('tecnico')
    );
    createOSSection.style.display = canCreateOS ? 'block' : 'none';
    
    // Reset estado
    if (createOSCheck) createOSCheck.checked = false;
    if (executorSelect) executorSelect.style.display = 'none';
  }
  
  const modal = document.getElementById('modal-execute-checklist');
  modal.classList.remove('hidden');
  modal.classList.add('active');
}

// Toggle checklist item ao clicar na linha inteira
function toggleChecklistItem(element, idx) {
  const checkbox = element.querySelector('input[type="checkbox"]');
  if (checkbox) {
    checkbox.checked = !checkbox.checked;
    element.classList.toggle('checked', checkbox.checked);
    updateChecklistProgress();
  }
}

// Atualizar progress bar do checklist
function updateChecklistProgress() {
  const checkboxes = document.querySelectorAll('#execute-checklist-items input[type="checkbox"]');
  const total = checkboxes.length;
  const checked = Array.from(checkboxes).filter(cb => cb.checked).length;
  
  const checkedCount = document.getElementById('chk-checked-count');
  const progressFill = document.getElementById('chk-progress-fill');
  
  if (checkedCount) checkedCount.textContent = checked;
  if (progressFill) {
    const percent = total > 0 ? (checked / total) * 100 : 0;
    progressFill.style.width = percent + '%';
  }
  
  // Atualizar classes checked nas linhas
  checkboxes.forEach((cb, i) => {
    const item = cb.closest('.chk-exec-item');
    if (item) item.classList.toggle('checked', cb.checked);
  });
}

// Toggle seção de executor quando marca criar OS
function toggleChecklistOSExecutor() {
  const checkbox = document.getElementById('chk-create-os-check');
  const executorSection = document.getElementById('chk-os-executor-select');
  
  if (checkbox && checkbox.checked) {
    executorSection.style.display = 'block';
    loadChecklistOSExecutors();
  } else if (executorSection) {
    executorSection.style.display = 'none';
  }
}

// Carregar lista de técnicos para o select
async function loadChecklistOSExecutors() {
  const select = document.getElementById('chk-os-executor');
  if (!select) return;
  
  try {
    const response = await fetch(`${API_URL}/users`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await response.json();
    
    if (data.ok) {
      const technicians = (data.users || []).filter(u => 
        u.roles && (u.roles.includes('tecnico') || u.roles.includes('os_manage_all') || u.roles.includes('admin'))
      );
      
      select.innerHTML = '<option value="">-- Selecione o técnico --</option>' +
        technicians.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
    }
  } catch (error) {
    console.error('Erro ao carregar técnicos:', error);
  }
}

// Submit checklist execution
async function submitChecklistExecution() {
  const checklistId = state.currentChecklistId;
  if (!checklistId) return;
  
  const notes = document.getElementById('execute-checklist-notes').value.trim();
  const itemCheckboxes = document.querySelectorAll('#execute-checklist-items input[type="checkbox"]');
  
  const items = Array.from(itemCheckboxes).map(cb => ({
    item_id: cb.dataset.itemId,
    checked: cb.checked
  }));
  
  // Verificar se deve criar OS
  const createOSCheck = document.getElementById('chk-create-os-check');
  const createOS = createOSCheck && createOSCheck.checked;
  const executorId = createOS ? document.getElementById('chk-os-executor')?.value : null;
  
  if (createOS && !executorId) {
    showNotification('Selecione um técnico para a OS', 'warning');
    return;
  }
  
  try {
    const response = await fetch(`${API_URL}/checklists/${checklistId}/execute`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${state.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ items, notes })
    });
    
    const data = await response.json();
    if (data.ok) {
      // Se marcou para criar OS, criar a OS também
      if (createOS && executorId) {
        await createOSFromChecklist(checklistId, executorId, notes);
      }
      
      closeModal('modal-execute-checklist');
      showNotification('Checklist executado com sucesso!', 'success');
    } else {
      showNotification(data.error || 'Erro ao executar checklist', 'error');
    }
  } catch (error) {
    showNotification('Erro ao executar checklist: ' + error.message, 'error');
  }
}

// Criar OS a partir do checklist
async function createOSFromChecklist(checklistId, executorId, notes) {
  const checklist = state.checklists.find(c => c.id === checklistId);
  if (!checklist) return;
  
  // Montar descrição com os itens do checklist
  const itemsDesc = (checklist.items || []).map((item, i) => `${i + 1}. ${item.description}`).join('\n');
  const description = `Originado do Checklist: ${checklist.name}\n\nItens:\n${itemsDesc}${notes ? '\n\nObservações: ' + notes : ''}`;
  
  const orderData = {
    title: `Checklist: ${checklist.name}`,
    description: description,
    sector: checklist.sector || 'Manutenção',
    priority: 'medium',
    assigned_to: executorId
  };
  
  try {
    const response = await fetch(`${API_URL}/orders`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${state.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(orderData)
    });
    
    const data = await response.json();
    if (data.ok) {
      showNotification('Ordem de Serviço criada!', 'success');
      await loadOrders(); // Atualizar lista de OS
    } else {
      showNotification('Erro ao criar OS: ' + (data.error || ''), 'error');
    }
  } catch (error) {
    console.error('Erro ao criar OS do checklist:', error);
  }
}

// View checklist history
async function viewChecklistHistory(checklistId) {
  const checklist = state.checklists.find(c => c.id === checklistId);
  if (!checklist) return;
  
  try {
    const response = await fetch(`${API_URL}/checklists/${checklistId}/executions`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    
    const data = await response.json();
    if (data.ok) {
      const executions = data.executions || [];
      
      const historyCard = document.getElementById('checklist-history-card');
      historyCard.style.display = 'block';
      
      const container = document.getElementById('checklist-executions-list');
      
      if (executions.length === 0) {
        container.innerHTML = '<p style="color: var(--text-secondary); padding: 20px; text-align: center;">Nenhuma execução registrada</p>';
      } else {
        container.innerHTML = executions.map(exec => {
          const checkedCount = (exec.items || []).filter(i => i.checked).length;
          const totalCount = (exec.items || []).length;
          
          return `
            <div style="background: var(--bg-secondary); border-radius: 8px; padding: 12px; margin-bottom: 8px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <strong>${escapeHtml(exec.executed_by_name) || 'Usuário'}</strong>
                <span style="font-size: 12px; color: var(--text-secondary);">${formatDate(exec.executed_at)}</span>
              </div>
              <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                ${(exec.items || []).map(item => `
                  <span style="font-size: 11px; padding: 3px 6px; background: ${item.checked ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)'}; color: ${item.checked ? 'var(--success)' : 'var(--danger)'}; border-radius: 4px;">
                    ${item.checked ? '✓' : '✗'} ${escapeHtml(item.description)}
                  </span>
                `).join('')}
              </div>
              ${exec.notes ? `<p style="font-size: 12px; color: var(--text-secondary); margin-top: 8px;">${escapeHtml(exec.notes)}</p>` : ''}
              <div style="margin-top: 8px; font-size: 12px; color: var(--accent-gold);">
                ${checkedCount}/${totalCount} itens verificados
              </div>
            </div>
          `;
        }).join('');
      }
    }
  } catch (error) {
    showNotification('Erro ao carregar histórico: ' + error.message, 'error');
  }
}

function closeChecklistHistory() {
  document.getElementById('checklist-history-card').style.display = 'none';
}

// Delete checklist
async function deleteChecklist(checklistId) {
  if (!confirm('Tem certeza que deseja excluir este checklist?')) return;
  
  try {
    const response = await fetch(`${API_URL}/checklists/${checklistId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    
    const data = await response.json();
    if (data.ok) {
      state.checklists = data.checklists || [];
      renderChecklists();
      showNotification('Checklist excluído!', 'success');
    } else {
      showNotification(data.error || 'Erro ao excluir', 'error');
    }
  } catch (error) {
    showNotification('Erro ao excluir: ' + error.message, 'error');
  }
}

// Edit checklist (simplified - just opens modal with data)
function editChecklist(checklistId) {
  const checklist = state.checklists.find(c => c.id === checklistId);
  if (!checklist) return;
  
  document.getElementById('checklist-name').value = checklist.name || '';
  document.getElementById('checklist-sector').value = checklist.sector || '';
  document.getElementById('checklist-frequency').value = checklist.frequency || 'diario';
  document.getElementById('checklist-description').value = checklist.description || '';
  document.getElementById('checklist-items').value = (checklist.items || []).map(i => i.description).join('\n');
  
  // Change form to update mode
  const form = document.getElementById('form-create-checklist');
  form.onsubmit = (e) => updateChecklistFromForm(e, checklistId);
  
  const modal = document.getElementById('modal-create-checklist');
  modal.querySelector('.modal-title').textContent = 'Editar Checklist';
  modal.classList.remove('hidden');
  modal.classList.add('active');
}

async function updateChecklistFromForm(event, checklistId) {
  event.preventDefault();
  
  const name = document.getElementById('checklist-name').value.trim();
  const sector = document.getElementById('checklist-sector').value.trim();
  const frequency = document.getElementById('checklist-frequency').value;
  const description = document.getElementById('checklist-description').value.trim();
  const itemsText = document.getElementById('checklist-items').value.trim();
  
  const items = itemsText.split('\n').map(i => i.trim()).filter(i => i.length > 0);
  
  try {
    const response = await fetch(`${API_URL}/checklists/${checklistId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${state.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name, sector, frequency, description, items })
    });
    
    const data = await response.json();
    if (data.ok) {
      state.checklists = data.checklists || [];
      renderChecklists();
      closeModal('modal-create-checklist');
      showNotification('Checklist atualizado!', 'success');
      
      // Reset form onsubmit
      document.getElementById('form-create-checklist').onsubmit = createChecklistFromForm;
      document.querySelector('#modal-create-checklist .modal-title').textContent = 'Novo Checklist';
    } else {
      showNotification(data.error || 'Erro ao atualizar', 'error');
    }
  } catch (error) {
    showNotification('Erro ao atualizar: ' + error.message, 'error');
  }
}

// ========== CONTROLE DE ÁGUA - GRANJA VITTA ==========

// Estado do controle de água
state.waterReadings = [];
state.waterPeriod = 'day';
state.waterStats = null;
state.waterChartType = 'consumo'; // 'consumo' ou 'temperatura'

// Buscar temperatura atual da internet (Granja Vitta - Aparecida de Goiânia)
async function fetchCurrentTemperature() {
  try {
    // Coordenadas da Granja Vitta - Aparecida de Goiânia, GO
    const lat = -16.8225;
    const lon = -49.2433;
    
    // API Open-Meteo (gratuita, sem chave necessária)
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`);
    const data = await response.json();
    
    if (data.current_weather && data.current_weather.temperature !== undefined) {
      const temp = data.current_weather.temperature;
      const tempInput = document.getElementById('water-temperature');
      if (tempInput && !tempInput.value) {
        tempInput.value = temp.toFixed(1);
        tempInput.placeholder = `${temp.toFixed(1)}°C (atual)`;
      }
      return temp;
    }
  } catch (error) {
    console.log('Não foi possível obter temperatura automática:', error);
  }
  return null;
}

// Carregar controle de água
async function loadWaterControl() {
  try {
    // Verificar permissão - Bruno e JoseWalter só visualizam
    const inputSection = document.querySelector('.water-input-section');
    const username = state.user?.username?.toLowerCase() || '';
    const canEdit = !['bruno', 'josewalter'].includes(username);
    
    if (inputSection) {
      inputSection.style.display = canEdit ? 'block' : 'none';
    }
    
    // Definir data de hoje no input APENAS se estiver vazio (formato local correto)
    if (canEdit) {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const today = `${year}-${month}-${day}`;
      
      const dateInput = document.getElementById('water-reading-date');
      if (dateInput && !dateInput.value) dateInput.value = today;
      
      // Buscar temperatura automática da internet
      fetchCurrentTemperature();
      
      // Atualizar horário atual
      updateCurrentTime();
      setInterval(updateCurrentTime, 60000);
    }
    
    // Carregar dados EM PARALELO (mais rápido)
    await Promise.all([
      loadWaterReadings(),
      loadWaterStats()
    ]);
    
    // Renderizar
    renderWaterStats();
    renderWaterChart();
    renderWaterHistory();
    checkWaterAlerts();
    
  } catch (error) {
    console.error('Erro ao carregar controle de água:', error);
  }
}

// Atualizar horário atual
function updateCurrentTime() {
  const timeEl = document.getElementById('current-time');
  if (timeEl) {
    const now = new Date();
    timeEl.textContent = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
}

// Carregar leituras de água
async function loadWaterReadings() {
  try {
    // Se offline, carregar do cache
    if (!state.isOnline) {
      const cached = loadFromCache(CACHE_KEYS.waterReadings);
      if (cached) {
        state.waterReadings = cached;
        return;
      }
    }

    const response = await fetch(`${API_URL}/water-readings`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    
    const data = await response.json();
    if (data.ok) {
      state.waterReadings = data.readings || [];
      saveToCache(CACHE_KEYS.waterReadings, state.waterReadings); // Salvar no cache
    }
  } catch (error) {
    console.error('Erro ao carregar leituras:', error);
    // Tentar carregar do cache em caso de erro
    const cached = loadFromCache(CACHE_KEYS.waterReadings);
    if (cached) {
      state.waterReadings = cached;
    }
  }
}

// Carregar estatísticas de água
async function loadWaterStats() {
  try {
    const response = await fetch(`${API_URL}/water-readings/stats?period=${state.waterPeriod}`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    
    const data = await response.json();
    if (data.ok) {
      state.waterStats = data.stats;
    }
  } catch (error) {
    console.error('Erro ao carregar estatísticas:', error);
  }
}

// Estado da visualização
state.waterViewType = 'trabalho'; // 'trabalho' ou '24h'

// Definir tipo de visualização
function setWaterViewType(type) {
  state.waterViewType = type;
  
  // Atualizar abas
  document.querySelectorAll('.water-view-tab').forEach(tab => tab.classList.remove('active'));
  const activeTab = document.getElementById(`tab-${type}`);
  if (activeTab) activeTab.classList.add('active');
  
  // Re-renderizar
  renderWaterStats();
  renderWaterChart();
  renderWaterHistory();
}

// Definir período do filtro
async function setWaterPeriod(period) {
  state.waterPeriod = period;
  
  // Atualizar botões
  document.querySelectorAll('.water-filter-btn').forEach(btn => btn.classList.remove('active'));
  const activeBtn = document.getElementById(`water-filter-${period}`);
  if (activeBtn) activeBtn.classList.add('active');
  
  // Recarregar dados
  await loadWaterStats();
  renderWaterStats();
  renderWaterChart();
}

// Renderizar estatísticas
function renderWaterStats() {
  const stats = state.waterStats;
  const readings = state.waterReadings;
  
  // Função para formatar data corretamente
  function getDateKey(dateStr) {
    const parts = dateStr.split('T')[0].split('-');
    return parts.join('-'); // YYYY-MM-DD
  }
  
  // Data de HOJE (sempre mostrar dados de hoje)
  const today = new Date();
  const todayKey = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
  
  // Ordenar leituras
  const sortedReadings = [...readings].sort((a, b) => {
    const dateCompare = getDateKey(b.reading_date).localeCompare(getDateKey(a.reading_date));
    if (dateCompare !== 0) return dateCompare;
    return b.reading_time.localeCompare(a.reading_time);
  });
  
  ['aviarios', 'recria'].forEach(tank => {
    const tankReadings = sortedReadings.filter(r => r.tank_name === tank);
    
    // SEMPRE usar data de HOJE para exibição principal
    const leitura7hHoje = tankReadings.find(r => r.reading_time === '07:00' && getDateKey(r.reading_date) === todayKey);
    const leitura16hHoje = tankReadings.find(r => r.reading_time === '16:00' && getDateKey(r.reading_date) === todayKey);
    
    // Atualizar leituras - sempre mostra HOJE
    const el7h = document.getElementById(`${tank}-leitura-7h`);
    const el16h = document.getElementById(`${tank}-leitura-16h`);
    
    if (el7h) {
      if (leitura7hHoje) {
        el7h.textContent = Math.round(leitura7hHoje.reading_value).toLocaleString('pt-BR');
      } else {
        // Sempre mostra Pendente para hoje se não tem leitura
        el7h.innerHTML = '<span style="color: #eab308;">Pendente</span>';
      }
    }
    if (el16h) {
      if (leitura16hHoje) {
        el16h.textContent = Math.round(leitura16hHoje.reading_value).toLocaleString('pt-BR');
      } else {
        // Sempre mostra Pendente para hoje se não tem leitura
        el16h.innerHTML = '<span style="color: #eab308;">Pendente</span>';
      }
    }
    
    // Calcular consumo do período de trabalho (7h-16h = 9 horas) - só se ambos existem HOJE
    let consumoTrabalho = '--';
    let ltHoraTrabalho = '--';
    if (leitura7hHoje && leitura16hHoje) {
      const diff = leitura16hHoje.reading_value - leitura7hHoje.reading_value;
      if (diff >= 0) {
        consumoTrabalho = diff.toFixed(0);
        ltHoraTrabalho = Math.round((diff * 1000) / 9).toLocaleString('pt-BR');
      }
    }
    
    const elConsumoTrab = document.getElementById(`${tank}-consumo-trabalho`);
    const elLtHoraTrab = document.getElementById(`${tank}-lt-hora-trabalho`);
    if (elConsumoTrab) elConsumoTrab.textContent = consumoTrabalho;
    if (elLtHoraTrab) elLtHoraTrab.textContent = ltHoraTrabalho;
    
    // Calcular consumo 24h do ÚLTIMO DIA COMPLETO (ontem)
    // Consumo de ontem = Leitura 7h HOJE - Leitura 7h ONTEM
    let consumo24h = '--';
    let ltHora24h = '--';
    
    if (leitura7hHoje) {
      // Calcular data de ontem
      const ontem = new Date(today);
      ontem.setDate(ontem.getDate() - 1);
      const ontemKey = ontem.getFullYear() + '-' + String(ontem.getMonth() + 1).padStart(2, '0') + '-' + String(ontem.getDate()).padStart(2, '0');
      
      const leitura7hOntem = tankReadings.find(r => r.reading_time === '07:00' && getDateKey(r.reading_date) === ontemKey);
      
      if (leitura7hOntem) {
        const diff = leitura7hHoje.reading_value - leitura7hOntem.reading_value;
        if (diff >= 0) {
          consumo24h = diff.toFixed(0);
          ltHora24h = Math.round((diff * 1000) / 24).toLocaleString('pt-BR');
        }
      }
    }
    
    const elConsumo24h = document.getElementById(`${tank}-consumo-24h`);
    const elLtHora24h = document.getElementById(`${tank}-lt-hora-24h`);
    if (elConsumo24h) elConsumo24h.textContent = consumo24h;
    if (elLtHora24h) elLtHora24h.textContent = ltHora24h;
  });
  
  // Filtrar leituras pelo período selecionado
  const period = state.waterPeriod || 'day';
  let periodStartDate = new Date(today);
  
  if (period === 'day') {
    periodStartDate.setHours(0, 0, 0, 0);
  } else if (period === 'week') {
    // Início da semana (segunda-feira)
    const dayOfWeek = periodStartDate.getDay();
    const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    periodStartDate.setDate(periodStartDate.getDate() + diff);
    periodStartDate.setHours(0, 0, 0, 0);
  } else if (period === 'month') {
    periodStartDate = new Date(today.getFullYear(), today.getMonth(), 1);
  }
  
  const periodStartKey = periodStartDate.getFullYear() + '-' + String(periodStartDate.getMonth() + 1).padStart(2, '0') + '-' + String(periodStartDate.getDate()).padStart(2, '0');
  
  // Comparativo - usar leituras do período selecionado
  const aviariosReadings = sortedReadings.filter(r => r.tank_name === 'aviarios' && getDateKey(r.reading_date) >= periodStartKey);
  const recriaReadings = sortedReadings.filter(r => r.tank_name === 'recria' && getDateKey(r.reading_date) >= periodStartKey);
  
  // Calcular totais e picos baseado nas leituras 7h
  let aviariosTotal = 0, recriaTotal = 0;
  let aviariosDays = 0, recriaDays = 0;
  let picoAviarios = { valor: 0, data: '--' };
  let picoRecria = { valor: 0, data: '--' };
  
  const aviarios7h = aviariosReadings.filter(r => r.reading_time === '07:00').sort((a, b) => getDateKey(a.reading_date).localeCompare(getDateKey(b.reading_date)));
  const recria7h = recriaReadings.filter(r => r.reading_time === '07:00').sort((a, b) => getDateKey(a.reading_date).localeCompare(getDateKey(b.reading_date)));
  
  for (let i = 1; i < aviarios7h.length; i++) {
    const diff = aviarios7h[i].reading_value - aviarios7h[i-1].reading_value;
    if (diff >= 0) { 
      aviariosTotal += diff; 
      aviariosDays++;
      // Verificar se é o pico
      if (diff > picoAviarios.valor) {
        picoAviarios.valor = diff;
        const parts = getDateKey(aviarios7h[i].reading_date).split('-');
        picoAviarios.data = parts[2] + '/' + parts[1];
      }
    }
  }
  for (let i = 1; i < recria7h.length; i++) {
    const diff = recria7h[i].reading_value - recria7h[i-1].reading_value;
    if (diff >= 0) { 
      recriaTotal += diff; 
      recriaDays++;
      // Verificar se é o pico
      if (diff > picoRecria.valor) {
        picoRecria.valor = diff;
        const parts = getDateKey(recria7h[i].reading_date).split('-');
        picoRecria.data = parts[2] + '/' + parts[1];
      }
    }
  }
  
  // Atualizar card de Total das Caixas no Período
  const totalGeral = aviariosTotal + recriaTotal;
  const totalDias = Math.max(aviariosDays, recriaDays, 1);
  const mediaDiaria = totalGeral / totalDias;
  
  // Label do período
  const elPeriodoLabel = document.getElementById('total-periodo-label');
  if (elPeriodoLabel) {
    if (period === 'day') elPeriodoLabel.textContent = 'Hoje';
    else if (period === 'week') elPeriodoLabel.textContent = 'Esta Semana';
    else if (period === 'month') elPeriodoLabel.textContent = 'Este Mês';
  }
  
  const elTotalAviarios = document.getElementById('total-aviarios-valor');
  const elTotalRecria = document.getElementById('total-recria-valor');
  const elTotalGeral = document.getElementById('total-geral-valor');
  const elMediaDiaria = document.getElementById('total-media-diaria');
  
  if (elTotalAviarios) elTotalAviarios.textContent = aviariosTotal > 0 ? aviariosTotal.toFixed(0) : '--';
  if (elTotalRecria) elTotalRecria.textContent = recriaTotal > 0 ? recriaTotal.toFixed(0) : '--';
  if (elTotalGeral) elTotalGeral.textContent = totalGeral > 0 ? totalGeral.toFixed(0) : '--';
  if (elMediaDiaria) elMediaDiaria.textContent = mediaDiaria > 0 ? mediaDiaria.toFixed(1) : '--';
  
  // Mini charts - gerar a partir das leituras filtradas pelo período
  renderMiniChartFromReadings('aviarios', aviarios7h, period);
  renderMiniChartFromReadings('recria', recria7h, period);
}

// Renderizar mini chart a partir das leituras
function renderMiniChartFromReadings(tank, readings7h, period) {
  const container = document.getElementById(`${tank}-mini-chart`);
  if (!container) return;
  
  if (readings7h.length < 2) {
    container.innerHTML = '<span style="color: var(--text-secondary); font-size: 11px;">Sem dados</span>';
    return;
  }
  
  // Calcular consumos diários
  const consumptions = [];
  for (let i = 1; i < readings7h.length; i++) {
    const diff = readings7h[i].reading_value - readings7h[i-1].reading_value;
    if (diff >= 0) {
      consumptions.push({ date: readings7h[i].reading_date, consumption: diff });
    }
  }
  
  if (consumptions.length === 0) {
    container.innerHTML = '<span style="color: var(--text-secondary); font-size: 11px;">Sem dados</span>';
    return;
  }
  
  // Filtrar pelo período
  let numBars = 1;
  if (period === 'week') numBars = 7;
  else if (period === 'month') numBars = 30;
  
  const filteredConsumptions = consumptions.slice(-numBars);
  const maxConsumption = Math.max(...filteredConsumptions.map(c => c.consumption), 1);
  
  container.innerHTML = filteredConsumptions.map(c => {
    const height = (c.consumption / maxConsumption) * 100;
    return '<div class="tank-chart-bar" style="height: ' + Math.max(height, 5) + '%;" title="' + c.consumption.toFixed(2) + ' m³"></div>';
  }).join('');
}

// Renderizar gráfico principal
function renderWaterChart() {
  // Se estiver no modo temperatura, renderizar o gráfico de temperatura
  if (state.waterChartType === 'temperatura') {
    renderTemperatureChart();
    return;
  }
  
  var container = document.getElementById('water-consumption-chart');
  if (!container) return;
  
  var readings = state.waterReadings || [];
  
  if (readings.length < 2) {
    container.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 40px;">Registre leituras para ver o gráfico</p>';
    return;
  }
  
  // Função para formatar data
  function getDateKey(dateStr) {
    return dateStr.split('T')[0];
  }
  
  // Função para calcular o dia anterior
  function getPreviousDay(dateKey) {
    var parts = dateKey.split('-');
    var d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]), 12, 0, 0);
    d.setDate(d.getDate() - 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  
  // Calcular consumo diário a partir das leituras 7h
  // O consumo do DIA X é a diferença: Leitura 7h do dia (X+1) - Leitura 7h do dia X
  // Então atribuímos o consumo ao DIA ANTERIOR da leitura nova
  function calcularConsumos(tank) {
    var tankReadings = readings
      .filter(function(r) { return r.tank_name === tank && r.reading_time === '07:00'; })
      .sort(function(a, b) { return getDateKey(a.reading_date).localeCompare(getDateKey(b.reading_date)); });
    
    var consumos = {};
    for (var i = 1; i < tankReadings.length; i++) {
      var diff = tankReadings[i].reading_value - tankReadings[i-1].reading_value;
      if (diff >= 0) {
        // Consumo é atribuído ao dia ANTERIOR (dia X, não dia X+1)
        var consumptionDate = getDateKey(tankReadings[i-1].reading_date);
        consumos[consumptionDate] = diff;
      }
    }
    return consumos;
  }
  
  var aviariosMap = calcularConsumos('aviarios');
  var recriaMap = calcularConsumos('recria');
  
  // Combinar datas
  var allDates = new Set();
  Object.keys(aviariosMap).forEach(function(d) { allDates.add(d); });
  Object.keys(recriaMap).forEach(function(d) { allDates.add(d); });
  
  var dates = Array.from(allDates).sort().slice(-14);
  
  if (dates.length === 0) {
    container.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 40px;">Registre leituras de pelo menos 2 dias para ver o gráfico</p>';
    return;
  }
  
  var maxValue = Math.max(
    ...Object.values(aviariosMap),
    ...Object.values(recriaMap),
    1
  );
  
  container.innerHTML = dates.map(function(date) {
    var aviariosValue = aviariosMap[date] || 0;
    var recriaValue = recriaMap[date] || 0;
    var aviariosHeight = (aviariosValue / maxValue) * 180;
    var recriaHeight = (recriaValue / maxValue) * 180;
    
    // Formatar data corretamente
    var parts = date.split('-');
    var dateLabel = parts[2] + '/' + parts[1];
    
    return '<div class="chart-bar-group">' +
      '<div class="chart-bars">' +
        '<div class="chart-bar aviarios" style="height: ' + Math.max(aviariosHeight, 4) + 'px;" title="Aviários: ' + aviariosValue.toFixed(2) + ' m³"></div>' +
        '<div class="chart-bar recria" style="height: ' + Math.max(recriaHeight, 4) + 'px;" title="Recria: ' + recriaValue.toFixed(2) + ' m³"></div>' +
      '</div>' +
      '<span class="chart-bar-label">' + dateLabel + '</span>' +
    '</div>';
  }).join('');
}

// Alternar tipo de gráfico de água (consumo/temperatura)
function setWaterChartType(type) {
  state.waterChartType = type;
  
  // Atualizar botões ativos
  document.querySelectorAll('.water-chart-toggle-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  const activeBtn = document.querySelector(`.water-chart-toggle-btn[data-type="${type}"]`);
  if (activeBtn) activeBtn.classList.add('active');
  
  // Atualizar legenda
  const legend = document.querySelector('.water-chart-card .chart-legend');
  if (legend) {
    if (type === 'temperatura') {
      legend.innerHTML = '<span class="legend-item temperatura"><span class="legend-dot" style="background: #f59e0b;"></span> Temperatura °C</span>';
    } else {
      legend.innerHTML = '<span class="legend-item aviarios"><span class="legend-dot"></span> Aviários</span><span class="legend-item recria"><span class="legend-dot"></span> Recria</span>';
    }
  }
  
  // Re-renderizar gráfico
  if (type === 'temperatura') {
    renderTemperatureChart();
  } else {
    renderWaterChart();
  }
}

// Renderizar gráfico de temperatura - Mostra Mínima (7h) e Máxima (16h) do dia
function renderTemperatureChart() {
  var container = document.getElementById('water-consumption-chart');
  if (!container) return;
  
  var readings = state.waterReadings || [];
  
  // Filtrar leituras que têm temperatura
  var tempReadings = readings.filter(function(r) { 
    return r.temperature !== null && r.temperature !== undefined; 
  });
  
  if (tempReadings.length === 0) {
    container.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 40px;">Nenhuma leitura de temperatura registrada</p>';
    return;
  }
  
  // Função para formatar data
  function getDateKey(dateStr) {
    return dateStr.split('T')[0];
  }
  
  // Agrupar por data - pegar temperatura das 7h (mínima) e 16h (máxima)
  var tempByDate = {};
  tempReadings.forEach(function(r) {
    var dateKey = getDateKey(r.reading_date);
    if (!tempByDate[dateKey]) {
      tempByDate[dateKey] = { temp7h: null, temp16h: null };
    }
    if (r.reading_time === '07:00') {
      tempByDate[dateKey].temp7h = r.temperature;
    }
    if (r.reading_time === '16:00') {
      tempByDate[dateKey].temp16h = r.temperature;
    }
  });
  
  // Filtrar dias com dados
  var dates = Object.keys(tempByDate).filter(function(d) {
    return tempByDate[d].temp7h !== null || tempByDate[d].temp16h !== null;
  }).sort().slice(-14);
  
  if (dates.length === 0) {
    container.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 40px;">Dados insuficientes</p>';
    return;
  }
  
  // Calcular range de temperatura
  var allTemps = [];
  dates.forEach(function(d) {
    if (tempByDate[d].temp7h !== null) allTemps.push(tempByDate[d].temp7h);
    if (tempByDate[d].temp16h !== null) allTemps.push(tempByDate[d].temp16h);
  });
  
  var minTemp = Math.floor(Math.min.apply(null, allTemps) - 1);
  var maxTemp = Math.ceil(Math.max.apply(null, allTemps) + 1);
  var tempRange = maxTemp - minTemp || 10;
  
  // Dimensões do gráfico SVG
  var svgWidth = Math.max(dates.length * 55, 400);
  var svgHeight = 200;
  var paddingLeft = 35;
  var paddingRight = 15;
  var paddingTop = 25;
  var paddingBottom = 35;
  var chartWidth = svgWidth - paddingLeft - paddingRight;
  var chartHeight = svgHeight - paddingTop - paddingBottom;
  
  // Função para calcular posição Y
  function getY(temp) {
    return paddingTop + chartHeight - ((temp - minTemp) / tempRange * chartHeight);
  }
  
  // Função para calcular posição X
  function getX(index) {
    return paddingLeft + (index + 0.5) * (chartWidth / dates.length);
  }
  
  // Criar linhas de grade horizontais
  var gridLines = '';
  var yLabels = '';
  var numGridLines = 5;
  for (var i = 0; i <= numGridLines; i++) {
    var tempVal = minTemp + (tempRange * i / numGridLines);
    var y = getY(tempVal);
    gridLines += '<line x1="' + paddingLeft + '" y1="' + y + '" x2="' + (svgWidth - paddingRight) + '" y2="' + y + '" stroke="rgba(255,255,255,0.07)" stroke-width="1"/>';
    yLabels += '<text x="' + (paddingLeft - 5) + '" y="' + (y + 3) + '" text-anchor="end" fill="#64748b" font-size="9">' + tempVal.toFixed(0) + '°</text>';
  }
  
  // Criar path das linhas e pontos
  var path7h = '';
  var path16h = '';
  var points7h = '';
  var points16h = '';
  var labels = '';
  var xLabels = '';
  
  dates.forEach(function(d, i) {
    var x = getX(i);
    var data = tempByDate[d];
    var parts = d.split('-');
    var dateLabel = parts[2] + '/' + parts[1];
    
    // Label do eixo X
    xLabels += '<text x="' + x + '" y="' + (svgHeight - 8) + '" text-anchor="middle" fill="#64748b" font-size="9">' + dateLabel + '</text>';
    
    // Ponto e linha da 7h (mínima - azul)
    if (data.temp7h !== null) {
      var y7 = getY(data.temp7h);
      if (path7h === '') {
        path7h = 'M' + x + ',' + y7;
      } else {
        path7h += ' L' + x + ',' + y7;
      }
      points7h += '<circle cx="' + x + '" cy="' + y7 + '" r="5" fill="#3b82f6" stroke="#fff" stroke-width="2"/>';
      labels += '<text x="' + x + '" y="' + (y7 + 16) + '" text-anchor="middle" fill="#3b82f6" font-size="9" font-weight="600">' + data.temp7h.toFixed(1) + '°</text>';
    }
    
    // Ponto e linha da 16h (máxima - vermelho)
    if (data.temp16h !== null) {
      var y16 = getY(data.temp16h);
      if (path16h === '') {
        path16h = 'M' + x + ',' + y16;
      } else {
        path16h += ' L' + x + ',' + y16;
      }
      points16h += '<circle cx="' + x + '" cy="' + y16 + '" r="5" fill="#ef4444" stroke="#fff" stroke-width="2"/>';
      labels += '<text x="' + x + '" y="' + (y16 - 8) + '" text-anchor="middle" fill="#ef4444" font-size="9" font-weight="600">' + data.temp16h.toFixed(1) + '°</text>';
    }
  });
  
  // Montar SVG
  var svg = '<svg width="100%" height="' + svgHeight + '" viewBox="0 0 ' + svgWidth + ' ' + svgHeight + '" preserveAspectRatio="xMidYMid meet" style="overflow:visible;">';
  svg += gridLines;
  svg += yLabels;
  svg += xLabels;
  
  // Linhas
  if (path7h) svg += '<path d="' + path7h + '" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.8"/>';
  if (path16h) svg += '<path d="' + path16h + '" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.8"/>';
  
  // Pontos
  svg += points7h;
  svg += points16h;
  
  // Labels de valor
  svg += labels;
  
  svg += '</svg>';
  
  // Renderizar
  container.innerHTML = '<div style="display:flex;flex-direction:column;gap:8px;">' +
    '<div style="display:flex;justify-content:center;gap:24px;padding:8px 0;">' +
      '<div style="display:flex;align-items:center;gap:6px;">' +
        '<div style="width:10px;height:10px;background:#3b82f6;border-radius:50%;"></div>' +
        '<span style="font-size:11px;color:var(--text-secondary);">7h (Mínima)</span>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:6px;">' +
        '<div style="width:10px;height:10px;background:#ef4444;border-radius:50%;"></div>' +
        '<span style="font-size:11px;color:var(--text-secondary);">16h (Máxima)</span>' +
      '</div>' +
    '</div>' +
    '<div style="overflow-x:auto;padding:0 5px;">' + svg + '</div>' +
  '</div>';
}

// Renderizar histórico
function renderWaterHistory() {
  const tbody = document.getElementById('water-history-tbody');
  if (!tbody) return;
  
  const readings = state.waterReadings;
  const filterTank = document.getElementById('history-tank-filter')?.value || 'all';
  const filterConsumption = document.getElementById('history-consumption-filter')?.value || '24h';
  
  // Atualizar header da coluna de consumo
  const consumptionHeader = document.getElementById('consumption-column-header');
  if (consumptionHeader) {
    consumptionHeader.textContent = filterConsumption === '24h' ? 'Consumo 24h' : 'Consumo 9h';
  }
  
  let filteredReadings = readings;
  if (filterTank !== 'all') {
    filteredReadings = readings.filter(r => r.tank_name === filterTank);
  }
  
  if (filteredReadings.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: var(--text-secondary);">Nenhuma leitura registrada</td></tr>';
    return;
  }
  
  // Função para formatar data corretamente (evitar timezone issues)
  function formatDate(dateStr) {
    const parts = dateStr.split('T')[0].split('-');
    const year = parseInt(parts[0]);
    const month = parseInt(parts[1]) - 1;
    const day = parseInt(parts[2]);
    const date = new Date(year, month, day, 12, 0, 0);
    
    const dayOfWeek = date.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '').toUpperCase();
    const formatted = date.toLocaleDateString('pt-BR');
    return { formatted, dayOfWeek, dateObj: date, dateKey: dateStr.split('T')[0] };
  }
  
  // Função para calcular o dia anterior
  function getPreviousDay(dateKey) {
    const parts = dateKey.split('-');
    const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]), 12, 0, 0);
    d.setDate(d.getDate() - 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  
  // Função para calcular o dia seguinte
  function getNextDay(dateKey) {
    const parts = dateKey.split('-');
    const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]), 12, 0, 0);
    d.setDate(d.getDate() + 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  
  // Ordenar por data DESC, horário DESC
  const sorted = [...filteredReadings].sort((a, b) => {
    const dateA = a.reading_date.split('T')[0];
    const dateB = b.reading_date.split('T')[0];
    if (dateA !== dateB) return dateB.localeCompare(dateA);
    return b.reading_time.localeCompare(a.reading_time);
  });
  
  // Filtrar leituras baseado no tipo de consumo selecionado
  // Se 24h: mostrar apenas leituras das 7h
  // Se 9h: mostrar apenas leituras das 16h
  // Se 'all' ou não definido: mostrar todas
  let displayReadings = sorted;
  if (filterConsumption === '24h') {
    displayReadings = sorted.filter(r => r.reading_time === '07:00');
  } else if (filterConsumption === '9h') {
    displayReadings = sorted.filter(r => r.reading_time === '16:00');
  }
  
  // Calcular consumo 24h para cada leitura das 7h
  // Consumo 24h do dia X = Leitura 7h do dia (X+1) - Leitura 7h do dia X
  // Ou seja, só podemos mostrar consumo 24h se tivermos a leitura do dia SEGUINTE
  const today = new Date().toISOString().split('T')[0];
  
  // Criar mapa de datas únicas para cores alternadas
  const uniqueDates = [...new Set(displayReadings.map(r => r.reading_date.split('T')[0]))];
  const dateColorMap = {};
  uniqueDates.forEach((date, index) => {
    dateColorMap[date] = index % 2 === 0 ? 'day-even' : 'day-odd';
  });
  
  tbody.innerHTML = displayReadings.slice(0, 50).map((reading) => {
    const { formatted: date, dayOfWeek, dateKey } = formatDate(reading.reading_date);
    const tankClass = reading.tank_name;
    const tankLabel = reading.tank_name === 'aviarios' ? 'Aviários' : 'Recria';
    const dayClass = dateColorMap[dateKey] || 'day-even';
    
    // Calcular consumo baseado no filtro selecionado
    let consumption = '--';
    
    if (filterConsumption === '24h') {
      // Consumo 24h: só para leituras das 7h
      // Consumo do DIA = Leitura 7h do dia SEGUINTE - Leitura 7h deste dia
      if (reading.reading_time === '07:00' && dateKey !== today) {
        const nextDay = getNextDay(dateKey);
        const nextReading = sorted.find(r => 
          r.tank_name === reading.tank_name && 
          r.reading_time === '07:00' &&
          r.reading_date.split('T')[0] === nextDay
        );
        if (nextReading) {
          const diff = nextReading.reading_value - reading.reading_value;
          consumption = diff >= 0 
            ? '<span class="consumption-positive">' + diff.toFixed(0) + ' m³</span>'
            : '<span class="consumption-negative">' + diff.toFixed(0) + ' m³</span>';
        }
      }
    } else if (filterConsumption === '9h') {
      // Consumo 9h (7h às 16h): só para leituras das 16h
      // Consumo 9h = Leitura 16h - Leitura 7h do MESMO dia
      if (reading.reading_time === '16:00') {
        const reading7h = sorted.find(r => 
          r.tank_name === reading.tank_name && 
          r.reading_time === '07:00' &&
          r.reading_date.split('T')[0] === dateKey
        );
        if (reading7h) {
          const diff = reading.reading_value - reading7h.reading_value;
          consumption = diff >= 0 
            ? '<span class="consumption-positive">' + diff.toFixed(0) + ' m³</span>'
            : '<span class="consumption-negative">' + diff.toFixed(0) + ' m³</span>';
        }
      }
    }
    
    // Botão de delete (só para admin ou quem tem permissão)
    const canDelete = state.user && (state.user.roles.includes('admin') || state.user.roles.includes('os_manage_all'));
    const deleteBtn = canDelete 
      ? '<button class="delete-reading-btn" onclick="deleteWaterReading(\'' + reading.id + '\')" title="Excluir leitura">×</button>'
      : '';
    
    return '<tr class="' + dayClass + '">' +
      '<td>' + date + '</td>' +
      '<td><span style="color: var(--text-secondary); font-size: 11px;">' + dayOfWeek + '</span></td>' +
      '<td>' + reading.reading_time + '</td>' +
      '<td><span class="tank-badge ' + tankClass + '">' + tankLabel + '</span></td>' +
      '<td><strong>' + reading.reading_value.toFixed(0) + '</strong></td>' +
      '<td>' + consumption + '</td>' +
      '<td>' + (reading.temperature !== null ? reading.temperature + '°C' : '-') + '</td>' +
      '<td>' + (reading.notes || '-') + '</td>' +
      '<td class="delete-cell">' + deleteBtn + '</td>' +
      '</tr>';
  }).join('');
}

// Filtrar histórico
function filterWaterHistory() {
  renderWaterHistory();
}

// Excluir leitura de água
async function deleteWaterReading(id) {
  if (!confirm('Tem certeza que deseja excluir esta leitura?')) return;
  
  try {
    const response = await fetch(API_URL + '/water-readings/' + id, {
      method: 'DELETE',
      headers: {
        'Authorization': 'Bearer ' + state.token
      }
    });
    
    const data = await response.json();
    
    if (data.ok) {
      state.waterReadings = data.readings;
      renderWaterHistory();
      renderWaterChart();
      showNotification('Leitura excluída com sucesso!', 'success');
    } else {
      showNotification(data.error || 'Erro ao excluir leitura', 'error');
    }
  } catch (error) {
    console.error('Erro ao excluir leitura:', error);
    showNotification('Erro ao excluir leitura', 'error');
  }
}

// Verificar alertas
function checkWaterAlerts() {
  const container = document.getElementById('water-alert-container');
  if (!container) return;
  
  const stats = state.waterStats;
  if (!stats) {
    container.innerHTML = '';
    return;
  }
  
  // Verificar consumo anormal (mais que 2x a média)
  const alerts = [];
  
  ['aviarios', 'recria'].forEach(tank => {
    const tankStats = stats[tank];
    if (!tankStats || !tankStats.daily_consumption || tankStats.daily_consumption.length < 3) return;
    
    const consumptions = tankStats.daily_consumption.map(c => c.consumption);
    const avg = consumptions.reduce((a, b) => a + b, 0) / consumptions.length;
    const lastConsumption = consumptions[consumptions.length - 1] || 0;
    
    if (lastConsumption > avg * 1.5) {
      alerts.push({
        tank: tank === 'aviarios' ? 'Aviários' : 'Recria',
        message: `Consumo ${((lastConsumption / avg - 1) * 100).toFixed(0)}% acima da média!`,
        value: lastConsumption.toFixed(2)
      });
    }
  });
  
  if (alerts.length === 0) {
    container.innerHTML = '';
    return;
  }
  
  container.innerHTML = alerts.map(alert => `
    <div class="water-alert">
      <span class="water-alert-icon">🚨</span>
      <div class="water-alert-text">
        <div class="water-alert-title">Consumo acima do normal - ${alert.tank}</div>
        <div class="water-alert-desc">${alert.message} (${alert.value} m³)</div>
      </div>
    </div>
  `).join('');
}

// Salvar leitura de água
async function saveWaterReading() {
  const date = document.getElementById('water-reading-date').value;
  const time = document.getElementById('water-reading-time').value;
  const aviariosValue = document.getElementById('water-aviarios-value').value;
  const recriaValue = document.getElementById('water-recria-value').value;
  const temperatureValue = document.getElementById('water-temperature').value;
  const notes = document.getElementById('water-reading-notes').value;
  
  if (!date || !time) {
    showNotification('Preencha a data e horário', 'error');
    return;
  }
  
  if (!aviariosValue && !recriaValue) {
    showNotification('Preencha pelo menos uma leitura', 'error');
    return;
  }
  
  const temperature = temperatureValue ? parseFloat(temperatureValue) : null;
  
  try {
    // Salvar leitura de Aviários
    if (aviariosValue) {
      await fetch(`${API_URL}/water-readings`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${state.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          tank_name: 'aviarios',
          reading_value: parseFloat(aviariosValue),
          reading_time: time,
          reading_date: date,
          temperature: temperature,
          notes: notes
        })
      });
    }
    
    // Salvar leitura de Recria
    if (recriaValue) {
      const response = await fetch(`${API_URL}/water-readings`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${state.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          tank_name: 'recria',
          reading_value: parseFloat(recriaValue),
          reading_time: time,
          reading_date: date,
          temperature: temperature,
          notes: notes
        })
      });
      
      const data = await response.json();
      if (data.ok) {
        state.waterReadings = data.readings;
      }
    }
    
    // Limpar campos
    document.getElementById('water-aviarios-value').value = '';
    document.getElementById('water-recria-value').value = '';
    document.getElementById('water-temperature').value = '';
    document.getElementById('water-reading-notes').value = '';
    
    // Recarregar dados
    await loadWaterReadings();
    await loadWaterStats();
    renderWaterStats();
    renderWaterChart();
    renderWaterHistory();
    checkWaterAlerts();
    
    showNotification('Leitura salva com sucesso!', 'success');
    
  } catch (error) {
    showNotification('Erro ao salvar leitura: ' + error.message, 'error');
  }
}

// Estado para relatório de água
state.waterReportMonth = null; // null = mês atual

// Exportar relatório PDF - DESIGN PREMIUM
function exportWaterReportPDF(selectedMonth) {
  const readings = state.waterReadings || [];
  
  if (readings.length === 0) {
    showNotification('Nenhum dado para exportar', 'warning');
    return;
  }
  
  // Determinar mês a filtrar
  const now = new Date();
  let filterYear, filterMonth, monthLabel;
  
  if (selectedMonth) {
    const parts = selectedMonth.split('-');
    filterYear = parseInt(parts[0]);
    filterMonth = parseInt(parts[1]) - 1;
    const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    monthLabel = monthNames[filterMonth] + ' ' + filterYear;
  } else {
    filterYear = now.getFullYear();
    filterMonth = now.getMonth();
    const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    monthLabel = monthNames[filterMonth] + ' ' + filterYear;
  }
  
  // Função para formatar data
  function formatDatePDF(dateStr) {
    const parts = dateStr.split('T')[0].split('-');
    const year = parseInt(parts[0]);
    const month = parseInt(parts[1]) - 1;
    const day = parseInt(parts[2]);
    const date = new Date(year, month, day, 12, 0, 0);
    const dayOfWeek = date.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '').toUpperCase();
    const formatted = date.toLocaleDateString('pt-BR');
    return { formatted, dayOfWeek, dateObj: date, year, month, day };
  }
  
  // Filtrar leituras do mês selecionado (dia 1 até hoje ou fim do mês)
  const filteredReadings = readings.filter(r => {
    const info = formatDatePDF(r.reading_date);
    return info.year === filterYear && info.month === filterMonth;
  });
  
  if (filteredReadings.length === 0) {
    showNotification('Nenhuma leitura para ' + monthLabel, 'warning');
    return;
  }
  
  // Ordenar por data
  const sortedReadings = [...filteredReadings].sort((a, b) => 
    formatDatePDF(a.reading_date).dateObj - formatDatePDF(b.reading_date).dateObj
  );
  
  // Período
  const firstDate = formatDatePDF(sortedReadings[0].reading_date);
  const lastDate = formatDatePDF(sortedReadings[sortedReadings.length - 1].reading_date);
  const periodStr = firstDate.formatted + ' a ' + lastDate.formatted;
  
  // CÁLCULO 24H: Consumo do Dia X = Leitura 7h do Dia X+1 - Leitura 7h do Dia X
  // Isso mede o consumo REAL de 24 horas
  function calculateConsumption(tank) {
    // Filtrar leituras do tanque específico
    const tankReadings = sortedReadings.filter(r => r.tank_name === tank);
    
    if (tankReadings.length === 0) return { total: 0, avg: 0, days: 0, dailyData: {} };
    
    // Pegar apenas leituras das 7h (ou a primeira do dia se não tiver 7h)
    const morningReadings = {};
    tankReadings.forEach(r => {
      const dayKey = formatDatePDF(r.reading_date).formatted;
      const dateObj = formatDatePDF(r.reading_date).dateObj;
      const time = r.reading_time || '00:00';
      const [h, m] = time.split(':').map(Number);
      const timeMinutes = h * 60 + m;
      
      // Preferir leitura das 7h (entre 6h e 8h)
      const isMorning = timeMinutes >= 360 && timeMinutes <= 480; // 6:00 a 8:00
      
      if (!morningReadings[dayKey]) {
        morningReadings[dayKey] = { reading: r, dateObj: dateObj, isMorning: isMorning, time: timeMinutes };
      } else if (isMorning && !morningReadings[dayKey].isMorning) {
        // Substituir por leitura da manhã
        morningReadings[dayKey] = { reading: r, dateObj: dateObj, isMorning: isMorning, time: timeMinutes };
      } else if (isMorning && morningReadings[dayKey].isMorning) {
        // Ambas são manhã, pegar a mais próxima das 7h
        const current7hDiff = Math.abs(morningReadings[dayKey].time - 420); // 420 = 7:00
        const new7hDiff = Math.abs(timeMinutes - 420);
        if (new7hDiff < current7hDiff) {
          morningReadings[dayKey] = { reading: r, dateObj: dateObj, isMorning: isMorning, time: timeMinutes };
        }
      }
    });
    
    // Ordenar dias cronologicamente
    const sortedDays = Object.keys(morningReadings).sort((a, b) => {
      return morningReadings[a].dateObj - morningReadings[b].dateObj;
    });
    
    // Calcular consumo: Dia X = Leitura Dia X+1 - Leitura Dia X
    let total = 0;
    const dailyConsumption = {};
    
    for (let i = 0; i < sortedDays.length - 1; i++) {
      const currentDay = sortedDays[i];
      const nextDay = sortedDays[i + 1];
      
      const currentReading = morningReadings[currentDay].reading.reading_value;
      const nextReading = morningReadings[nextDay].reading.reading_value;
      
      // Consumo de 24h = leitura do dia seguinte - leitura do dia atual
      const consumption = nextReading - currentReading;
      
      if (consumption > 0) {
        dailyConsumption[currentDay] = consumption;
        total += consumption;
      } else {
        dailyConsumption[currentDay] = 0; // Pode ser reset do hidrômetro ou erro
      }
    }
    
    const daysWithConsumption = Object.keys(dailyConsumption).filter(k => dailyConsumption[k] > 0).length;
    return { 
      total, 
      avg: daysWithConsumption > 0 ? total / daysWithConsumption : 0, 
      days: daysWithConsumption,
      dailyData: dailyConsumption
    };
  }
  
  const aviariosCalc = calculateConsumption('aviarios');
  const recriaCalc = calculateConsumption('recria');
  const totalConsumo = aviariosCalc.total + recriaCalc.total;
  
  // Gerar opções de meses disponíveis
  const availableMonths = [];
  const uniqueMonths = new Set();
  readings.forEach(r => {
    const info = formatDatePDF(r.reading_date);
    const key = info.year + '-' + String(info.month + 1).padStart(2, '0');
    uniqueMonths.add(key);
  });
  
  const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  [...uniqueMonths].sort().reverse().forEach(key => {
    const [y, m] = key.split('-');
    availableMonths.push({
      value: key,
      label: monthNames[parseInt(m) - 1] + ' ' + y,
      selected: key === (filterYear + '-' + String(filterMonth + 1).padStart(2, '0'))
    });
  });
  
  const currentMonthValue = filterYear + '-' + String(filterMonth + 1).padStart(2, '0');
  
  // Gerar linhas da tabela
  const tableRows = sortedReadings.slice(-100).reverse().map(r => {
    const info = formatDatePDF(r.reading_date);
    return '<tr>' +
      '<td>' + info.formatted + '</td>' +
      '<td style="color:#64748b;font-size:11px;">' + info.dayOfWeek + '</td>' +
      '<td>' + r.reading_time + '</td>' +
      '<td class="tank-' + r.tank_name + '">' + (r.tank_name === 'aviarios' ? 'Aviários' : 'Recria') + '</td>' +
      '<td><strong>' + r.reading_value.toFixed(3) + '</strong></td>' +
      '<td>' + (r.recorded_by_name || '-') + '</td>' +
      '<td>' + (r.notes || '-') + '</td>' +
    '</tr>';
  }).join('');

  const htmlContent = '<!DOCTYPE html>' +
  '<html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>Relatório de Água - Granja Vitta</title>' +
  '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">' +
  '<style>' +
  '*{margin:0;padding:0;box-sizing:border-box}' +
  'body{font-family:"Inter",system-ui,sans-serif;background:#050510;color:#fff;min-height:100vh;padding:20px}' +
  'body::before{content:"";position:fixed;top:0;left:0;right:0;bottom:0;background:linear-gradient(90deg,rgba(6,182,212,0.03) 1px,transparent 1px),linear-gradient(rgba(6,182,212,0.03) 1px,transparent 1px);background-size:50px 50px;pointer-events:none;z-index:0}' +
  '.container{max-width:1200px;margin:0 auto;position:relative;z-index:1}' +
  '.header{text-align:center;padding:40px 24px;background:linear-gradient(135deg,rgba(6,182,212,0.1) 0%,rgba(6,182,212,0.02) 100%);border:1px solid rgba(6,182,212,0.2);border-radius:20px;margin-bottom:24px}' +
  '.header-icon{display:inline-flex;align-items:center;justify-content:center;width:64px;height:64px;background:linear-gradient(135deg,rgba(6,182,212,0.2),rgba(6,182,212,0.1));border:1px solid rgba(6,182,212,0.3);border-radius:16px;margin-bottom:16px;color:#22d3ee}' +
  '.header h1{font-size:28px;font-weight:800;color:#22d3ee;margin-bottom:8px;letter-spacing:1px}' +
  '.header .subtitle{color:#94a3b8;font-size:14px}' +
  '.header .period{display:inline-flex;align-items:center;gap:8px;margin-top:12px;padding:8px 16px;background:rgba(6,182,212,0.1);border:1px solid rgba(6,182,212,0.2);border-radius:20px;font-size:12px;color:#67e8f9}' +
  '.stats-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px}' +
  '.stat-card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:20px;text-align:center}' +
  '.stat-card.primary{border-color:rgba(6,182,212,0.3);background:linear-gradient(180deg,rgba(6,182,212,0.1) 0%,rgba(6,182,212,0.02) 100%)}' +
  '.stat-card h3{font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;font-weight:600}' +
  '.stat-card .value{font-size:32px;font-weight:800;color:#fff}' +
  '.stat-card .value.cyan{color:#22d3ee}' +
  '.stat-card .value.green{color:#10b981}' +
  '.stat-card .unit{font-size:11px;color:#64748b;margin-top:4px}' +
  '.total-card{grid-column:span 4;background:linear-gradient(135deg,rgba(6,182,212,0.15) 0%,rgba(16,185,129,0.1) 100%);border:1px solid rgba(6,182,212,0.3);border-radius:16px;padding:24px;text-align:center}' +
  '.total-card h3{font-size:11px;color:#22d3ee;margin-bottom:8px;letter-spacing:1px}' +
  '.total-card .value{font-size:48px;font-weight:800;background:linear-gradient(135deg,#22d3ee,#10b981);-webkit-background-clip:text;-webkit-text-fill-color:transparent}' +
  '.table-card{background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.08);border-radius:16px;overflow:hidden;margin-bottom:24px}' +
  '.table-header{display:flex;align-items:center;gap:12px;padding:16px 20px;border-bottom:1px solid rgba(255,255,255,0.06)}' +
  '.table-header svg{color:#22d3ee}' +
  '.table-header h3{font-size:15px;font-weight:600}' +
  '.table-scroll{overflow-x:auto}' +
  'table{width:100%;border-collapse:collapse;min-width:600px}' +
  'th{background:rgba(6,182,212,0.1);color:#22d3ee;padding:12px 14px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:600}' +
  'td{padding:12px 14px;border-bottom:1px solid rgba(255,255,255,0.04);font-size:13px}' +
  'tr:hover{background:rgba(6,182,212,0.03)}' +
  '.tank-aviarios{color:#22d3ee;font-weight:600}' +
  '.tank-recria{color:#10b981;font-weight:600}' +
  '.footer{text-align:center;padding:24px}' +
  '.icarus-brand{display:flex;align-items:center;justify-content:center;gap:14px;margin:0 auto 16px;padding:16px 24px;background:linear-gradient(135deg,rgba(212,175,55,0.08),rgba(6,182,212,0.08));border:1px solid rgba(212,175,55,0.2);border-radius:14px;max-width:360px}' +
  '.icarus-logo{display:flex;align-items:center;justify-content:center;width:44px;height:44px;background:linear-gradient(135deg,rgba(212,175,55,0.2),rgba(212,175,55,0.1));border-radius:10px;border:1px solid rgba(212,175,55,0.3)}' +
  '.icarus-info{display:flex;flex-direction:column;align-items:flex-start;gap:2px}' +
  '.icarus-title{font-size:13px;font-weight:700;color:#d4af37;letter-spacing:2px}' +
  '.icarus-subtitle{font-size:9px;color:#8b8b9e}' +
  '.icarus-contact{display:flex;align-items:center;gap:4px;font-size:11px;font-weight:600;color:#22d3ee}' +
  '.footer-text{color:#64748b;font-size:11px}' +
  '@media(max-width:768px){.stats-grid{grid-template-columns:repeat(2,1fr)}.total-card{grid-column:span 2}.stat-card .value{font-size:24px}.total-card .value{font-size:32px}.header h1{font-size:20px}}' +
  '@media print{body{background:#fff!important;color:#1e293b!important;padding:15px!important}body::before{display:none}.stat-card,.table-card{background:#fff!important;border-color:#e2e8f0!important}.stat-card .value{color:#1e293b!important}.value.cyan,.value.green{color:#0891b2!important}.total-card{background:#f8fafc!important}.total-card .value{-webkit-text-fill-color:#0891b2!important}th{background:#f1f5f9!important;color:#0891b2!important}td{border-color:#e2e8f0!important}.icarus-brand{background:#f8f8f8!important}.icarus-title{color:#b8942e!important}@page{size:A4 portrait;margin:10mm}}' +
  '</style></head><body>' +
  '<div class="container">' +
  '<div class="header">' +
  '<div class="header-icon"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2.69l5.66 5.66a8 8 0 11-11.31 0z"/></svg></div>' +
  '<h1>CONTROLE DE ÁGUA</h1>' +
  '<p class="subtitle"><strong>Granja Vitta</strong> — Sistema Icarus</p>' +
  '<div class="period"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>' + periodStr + '</div>' +
  '</div>' +
  '<div class="stats-grid">' +
  '<div class="stat-card primary"><h3>Aviários (Média)</h3><div class="value cyan">' + aviariosCalc.avg.toFixed(2) + '</div><div class="unit">m³/dia</div></div>' +
  '<div class="stat-card primary"><h3>Recria (Média)</h3><div class="value green">' + recriaCalc.avg.toFixed(2) + '</div><div class="unit">m³/dia</div></div>' +
  '<div class="stat-card"><h3>Total Aviários</h3><div class="value">' + aviariosCalc.total.toFixed(2) + '</div><div class="unit">m³ período</div></div>' +
  '<div class="stat-card"><h3>Total Recria</h3><div class="value">' + recriaCalc.total.toFixed(2) + '</div><div class="unit">m³ período</div></div>' +
  '<div class="total-card"><h3>CONSUMO TOTAL DO MÊS</h3><div class="value">' + totalConsumo.toFixed(2) + ' m³</div><div class="unit">' + sortedReadings.length + ' leituras registradas</div></div>' +
  '</div>' +
  '<div class="table-card">' +
  '<div class="table-header"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg><h3>Histórico de Leituras</h3></div>' +
  '<div class="table-scroll"><table><thead><tr><th>Data</th><th>Dia</th><th>Horário</th><th>Caixa</th><th>Leitura</th><th>Registrado por</th><th>Obs</th></tr></thead><tbody>' + tableRows + '</tbody></table></div>' +
  '</div>' +
  '<div class="footer">' +
  '<div class="icarus-brand">' +
  '<div class="icarus-logo"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#d4af37" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></div>' +
  '<div class="icarus-info"><span class="icarus-title">ICARUS SYSTEM</span><span class="icarus-subtitle">Sistema de Gestão</span><span class="icarus-contact"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>+55 62 98493-0056</span></div>' +
  '</div>' +
  '<p class="footer-text">Desenvolvido por Guilherme Braga © 2025</p>' +
  '</div>' +
  '</div></body></html>';

  // Dados estruturados para PDF no servidor
  const waterReportData = {
    title: 'Relatório de Água - Granja Vitta',
    type: 'water-report',
    content: {
      period: periodStr,
      summary: {
        totalConsumption: totalConsumo.toFixed(2),
        avgDailyAviarios: aviariosCalc.avg.toFixed(2),
        avgDailyRecria: recriaCalc.avg.toFixed(2),
        totalAviarios: aviariosCalc.total.toFixed(2),
        totalRecria: recriaCalc.total.toFixed(2),
        totalReadings: sortedReadings.length
      },
      readings: sortedReadings.slice(-100).reverse().map(function(r) {
        const info = formatDatePDF(r.reading_date);
        return {
          date: info.formatted,
          dayOfWeek: info.dayOfWeek,
          time: r.reading_time,
          tank: r.tank_name === 'aviarios' ? 'Aviários' : 'Recria',
          value: r.reading_value.toFixed(3) + ' m³',
          recordedBy: r.recorded_by_name || '-',
          notes: r.notes || '-'
        };
      })
    }
  };

  // Renderizar diretamente na página (funciona em APK, mobile e desktop)
  showReportInPage(htmlContent, 'Relatório de Água', 'Relatório de Água gerado!', waterReportData);
}

// Função utilitária para mostrar relatórios na página atual (100% compatível com APK/WebView)
// Armazena o HTML para uso posterior no download
var currentReportHtml = '';
var currentReportTitle = '';
var currentReportData = null;

function showReportInPage(htmlContent, reportTitle, successMessage, reportData) {
  // Salvar HTML para download posterior
  currentReportHtml = htmlContent;
  currentReportTitle = reportTitle;
  // Salvar dados estruturados para geração de PDF no servidor
  currentReportData = reportData || null;
  
  // Remover overlay anterior se existir
  const existingOverlay = document.getElementById('report-overlay');
  if (existingOverlay) existingOverlay.remove();
  
  // Criar overlay fullscreen
  const overlay = document.createElement('div');
  overlay.id = 'report-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:#0a0a12;z-index:99999;display:flex;flex-direction:column;overflow:hidden';
  
  // Barra de ferramentas fixa no topo
  const toolbar = document.createElement('div');
  toolbar.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:linear-gradient(135deg,#111118,#1a1a28);border-bottom:1px solid rgba(255,255,255,0.1);flex-shrink:0;gap:8px;flex-wrap:wrap';
  
  // Botão Voltar
  const btnBack = document.createElement('button');
  btnBack.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg><span>Voltar</span>';
  btnBack.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 16px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:10px;color:#fff;font-size:14px;font-weight:500;cursor:pointer;transition:all 0.2s';
  btnBack.onclick = function() { overlay.remove(); };
  
  // Container dos botões de ação
  const actionsDiv = document.createElement('div');
  actionsDiv.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
  
  // Botão Imprimir
  const btnPrint = document.createElement('button');
  btnPrint.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg><span>Imprimir</span>';
  btnPrint.style.cssText = 'display:flex;align-items:center;gap:6px;padding:10px 14px;background:linear-gradient(135deg,#6366f1,#4f46e5);border:none;border-radius:10px;color:#fff;font-size:13px;font-weight:600;cursor:pointer;transition:all 0.2s';
  btnPrint.onclick = function() {
    const iframe = document.getElementById('report-iframe');
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.print();
    }
  };
  
  // Botão Salvar PDF (usa print com opção salvar)
  const btnDownload = document.createElement('button');
  btnDownload.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><span>Salvar PDF</span>';
  btnDownload.style.cssText = 'display:flex;align-items:center;gap:6px;padding:10px 14px;background:linear-gradient(135deg,#10b981,#059669);border:none;border-radius:10px;color:#fff;font-size:13px;font-weight:600;cursor:pointer;transition:all 0.2s';
  btnDownload.onclick = function() {
    downloadReportAsPDF();
  };
  
  actionsDiv.appendChild(btnPrint);
  actionsDiv.appendChild(btnDownload);
  
  toolbar.appendChild(btnBack);
  toolbar.appendChild(actionsDiv);
  
  // Container do conteúdo com scroll
  const contentContainer = document.createElement('div');
  contentContainer.style.cssText = 'flex:1;overflow:auto;-webkit-overflow-scrolling:touch';
  
  // Iframe para renderizar o HTML
  const iframe = document.createElement('iframe');
  iframe.id = 'report-iframe';
  iframe.style.cssText = 'width:100%;height:100%;border:none;background:#fff';
  
  contentContainer.appendChild(iframe);
  overlay.appendChild(toolbar);
  overlay.appendChild(contentContainer);
  document.body.appendChild(overlay);
  
  // Escrever conteúdo no iframe
  setTimeout(function() {
    try {
      const doc = iframe.contentDocument || iframe.contentWindow.document;
      doc.open();
      doc.write(htmlContent);
      doc.close();
    } catch (e) {
      console.error('Erro ao escrever no iframe:', e);
    }
  }, 50);
  
  if (successMessage) showNotification(successMessage, 'success');
}

// Função para baixar PDF - Navega diretamente para endpoint que retorna PDF real
async function downloadReportAsPDF() {
  // Mostrar loading
  showNotification('Gerando PDF...', 'info');
  
  // Pegar URL da API (config.js define window.ICARUS_API_URL)
  var API_URL = window.ICARUS_API_URL || 'https://kong-dust-analysts-developers.trycloudflare.com';
  
  // Garantir que a URL não termina com /
  if (API_URL.endsWith('/')) {
    API_URL = API_URL.slice(0, -1);
  }
  
  console.log('[PDF] API_URL:', API_URL);
  console.log('[PDF] currentReportTitle:', currentReportTitle);
  
  // Detectar tipo de relatório pelo título atual
  var pdfEndpoint = null;
  var params = '';
  
  if (currentReportTitle && currentReportTitle.toLowerCase().includes('dashboard')) {
    var period = state.dashboardFilter || 'monthly';
    pdfEndpoint = '/api/pdf/dashboard-report';
    params = '?period=' + period;
  } else if (currentReportTitle && currentReportTitle.toLowerCase().includes('água')) {
    var month = state.waterReportMonth || (new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0'));
    pdfEndpoint = '/api/pdf/water-report';
    params = '?month=' + month;
  } else if (currentReportTitle && currentReportTitle.toLowerCase().includes('diesel')) {
    var month = state.dieselReportMonth || (new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0'));
    pdfEndpoint = '/api/pdf/diesel-report';
    params = '?month=' + month;
  } else if (currentReportTitle && currentReportTitle.toLowerCase().includes('gerador')) {
    var month = state.generatorReportMonth || (new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0'));
    pdfEndpoint = '/api/pdf/generator-report';
    params = '?month=' + month;
  } else if (currentReportTitle && (currentReportTitle.toLowerCase().includes('ordem') || currentReportTitle.toLowerCase().includes('os'))) {
    pdfEndpoint = '/api/pdf/orders-report';
    params = '?period=monthly';
  }
  
  // Se temos endpoint específico
  if (pdfEndpoint) {
    try {
      var fullUrl = API_URL + pdfEndpoint + params + '&token=' + encodeURIComponent(state.token);
      console.log('[PDF] URL completa:', fullUrl);
      
      // Detectar se estamos no APK Android/iOS (Capacitor)
      var isCapacitor = false;
      try {
        isCapacitor = typeof window.Capacitor !== 'undefined' && 
                      window.Capacitor.isNativePlatform && 
                      window.Capacitor.isNativePlatform();
      } catch (e) {
        console.log('[PDF] Erro ao detectar Capacitor:', e);
      }
      console.log('[PDF] isCapacitor:', isCapacitor);
      
      // CAPACITOR/ANDROID/iOS: Abrir no navegador do sistema
      if (isCapacitor) {
        console.log('[PDF] Capacitor detectado - abrindo no navegador do sistema');
        
        // Método 1: Usar Capacitor Browser plugin (recomendado)
        try {
          if (window.Capacitor.Plugins && window.Capacitor.Plugins.Browser) {
            console.log('[PDF] Tentando Browser plugin...');
            await window.Capacitor.Plugins.Browser.open({ 
              url: fullUrl,
              windowName: '_system',
              toolbarColor: '#0f172a'
            });
            showNotification('📄 PDF aberto no navegador!', 'success');
            return;
          }
        } catch (browserErr) {
          console.log('[PDF] Browser plugin erro:', browserErr);
        }
        
        // Método 2: Usar App.openUrl (Capacitor App plugin)
        try {
          if (window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
            console.log('[PDF] Tentando App.openUrl...');
            await window.Capacitor.Plugins.App.openUrl({ url: fullUrl });
            showNotification('📄 PDF aberto!', 'success');
            return;
          }
        } catch (appErr) {
          console.log('[PDF] App.openUrl erro:', appErr);
        }
        
        // Método 3: Usar Cordova InAppBrowser (se disponível)
        try {
          if (window.cordova && window.cordova.InAppBrowser) {
            console.log('[PDF] Tentando InAppBrowser...');
            window.cordova.InAppBrowser.open(fullUrl, '_system', 'location=yes');
            showNotification('📄 PDF aberto!', 'success');
            return;
          }
        } catch (cordovaErr) {
          console.log('[PDF] InAppBrowser erro:', cordovaErr);
        }
        
        // Método 4: Fallback window.open com _system
        console.log('[PDF] Fallback: window.open _system');
        window.open(fullUrl, '_system');
        showNotification('📄 Abrindo PDF...', 'success');
        return;
      }
      
      // BROWSER NORMAL: abrir em nova aba
      console.log('[PDF] Browser desktop - abrindo em nova aba');
      window.open(fullUrl, '_blank');
      showNotification('Abrindo PDF...', 'success');
      return;
    } catch (e) {
      console.error('[PDF] Erro geral:', e);
      showNotification('Erro ao gerar PDF: ' + e.message, 'error');
    }
  } else {
    console.log('[PDF] Nenhum endpoint detectado para:', currentReportTitle);
  }
  
  // Fallback para relatórios sem endpoint específico: usar print
  showNotification('Abrindo impressão... Selecione "Salvar como PDF"', 'info');
  var iframe = document.getElementById('report-iframe');
  if (iframe && iframe.contentWindow) {
    try {
      iframe.contentWindow.print();
    } catch (e) {
      // Se print falhar, abrir HTML em nova janela
      if (currentReportHtml) {
        var win = window.open('', '_blank');
        if (win) {
          win.document.write(currentReportHtml);
          win.document.close();
          win.print();
        }
      }
    }
  }
}

// Função para compartilhar
async function shareReportAsPDF() {
  downloadReportAsPDF();
}

// Função auxiliar para carregar scripts dinamicamente
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[src="' + src + '"]');
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

// Exportar relatório Excel (CSV) - Formato oficial Granja Vitta
function exportWaterReportExcel() {
  var readings = state.waterReadings;
  
  if (readings.length === 0) {
    showNotification('Nenhum dado para exportar', 'warning');
    return;
  }
  
  // Função para formatar data corretamente no padrão DD/MM/YYYY
  function formatDateExcel(dateStr) {
    if (!dateStr) return { formatted: '', dayOfWeek: '', key: '' };
    var parts = dateStr.split('T')[0].split('-');
    if (parts.length < 3) return { formatted: '', dayOfWeek: '', key: '' };
    var year = parseInt(parts[0]);
    var month = parseInt(parts[1]) - 1;
    var day = parseInt(parts[2]);
    var date = new Date(year, month, day, 12, 0, 0);
    
    // Dia da semana por extenso
    var diasSemana = ['DOMINGO', 'SEGUNDA', 'TERÇA', 'QUARTA', 'QUINTA', 'SEXTA', 'SÁBADO'];
    var dayOfWeek = diasSemana[date.getDay()];
    
    // Data no formato DD/MM/YYYY
    var formatted = String(day).padStart(2, '0') + '/' + String(month + 1).padStart(2, '0') + '/' + year;
    
    return { formatted: formatted, dayOfWeek: dayOfWeek, dateObj: date, key: parts.join('-') };
  }
  
  // Agrupar leituras por dia e por tanque
  var dailyData = {};
  var sortedReadings = [...readings].sort(function(a, b) {
    var keyA = formatDateExcel(a.reading_date).key;
    var keyB = formatDateExcel(b.reading_date).key;
    return keyA.localeCompare(keyB);
  });
  
  sortedReadings.forEach(function(r) {
    var dateInfo = formatDateExcel(r.reading_date);
    if (!dateInfo.key) return;
    var dateKey = dateInfo.key;
    
    if (!dailyData[dateKey]) {
      dailyData[dateKey] = { 
        aviarios: {}, 
        recria: {}, 
        dateFormatted: dateInfo.formatted, 
        dayOfWeek: dateInfo.dayOfWeek 
      };
    }
    
    // Mapear tank_name para chave correta
    var tankKey = r.tank_name.toLowerCase().includes('recria') ? 'recria' : 'aviarios';
    var timeKey = r.reading_time === '07:00' ? 'am' : 'pm';
    dailyData[dateKey][tankKey][timeKey] = parseFloat(r.reading_value) || 0;
  });
  
  // Gerar linhas organizadas por data
  var rows = [];
  var dates = Object.keys(dailyData).sort();
  
  dates.forEach(function(dateStr, idx) {
    var data = dailyData[dateStr];
    var formattedDate = data.dateFormatted;
    var dayOfWeek = data.dayOfWeek;
    
    // Próximo dia para calcular consumo 24h
    var nextDate = dates[idx + 1];
    var nextData = nextDate ? dailyData[nextDate] : null;
    
    // RECRIA - Período de trabalho (7AM-4PM)
    if (data.recria.am !== undefined && data.recria.pm !== undefined) {
      var consumoM3 = Math.max(0, data.recria.pm - data.recria.am);
      var consumoLitros = Math.round(consumoM3 * 1000);
      var ltPorHora = Math.round(consumoLitros / 9);
      var entradaRange = Math.round(data.recria.am) + ' - ' + Math.round(data.recria.pm);
      rows.push([formattedDate, dayOfWeek, 'RECRIA', '7AM - 4PM', entradaRange, ltPorHora, consumoLitros, 'TRABALHO']);
    }
    
    // AVIARIOS - Período de trabalho (7AM-4PM)
    if (data.aviarios.am !== undefined && data.aviarios.pm !== undefined) {
      var consumoM3 = Math.max(0, data.aviarios.pm - data.aviarios.am);
      var consumoLitros = Math.round(consumoM3 * 1000);
      var ltPorHora = Math.round(consumoLitros / 9);
      var entradaRange = Math.round(data.aviarios.am) + ' - ' + Math.round(data.aviarios.pm);
      rows.push([formattedDate, dayOfWeek, 'AVIARIOS', '7AM - 4PM', entradaRange, ltPorHora, consumoLitros, 'TRABALHO']);
    }
    
    // RECRIA - Consumo 24H
    if (data.recria.am !== undefined && nextData && nextData.recria && nextData.recria.am !== undefined) {
      var consumoM3 = Math.max(0, nextData.recria.am - data.recria.am);
      var consumoLitros = Math.round(consumoM3 * 1000);
      var ltPorHora = Math.round(consumoLitros / 24);
      var entradaRange = Math.round(data.recria.am) + ' - ' + Math.round(nextData.recria.am);
      rows.push([formattedDate, dayOfWeek, 'RECRIA', '24H', entradaRange, ltPorHora, consumoLitros, 'DIARIO']);
    }
    
    // AVIARIOS - Consumo 24H
    if (data.aviarios.am !== undefined && nextData && nextData.aviarios && nextData.aviarios.am !== undefined) {
      var consumoM3 = Math.max(0, nextData.aviarios.am - data.aviarios.am);
      var consumoLitros = Math.round(consumoM3 * 1000);
      var ltPorHora = Math.round(consumoLitros / 24);
      var entradaRange = Math.round(data.aviarios.am) + ' - ' + Math.round(nextData.aviarios.am);
      rows.push([formattedDate, dayOfWeek, 'AVIARIOS', '24H', entradaRange, ltPorHora, consumoLitros, 'DIARIO']);
    }
  });
  
  // Criar CSV com cabeçalhos claros
  var headers = ['DATA', 'DIA/SEMANA', 'CAIXA', 'HORAS', 'ENTRADA (M3)', 'LT POR HORA', 'LT TOTAL', 'PERIODO'];
  
  var csvContent = headers.join(';') + '\n';
  rows.forEach(function(row) {
    // Formatar a data como texto puro para o Excel não interpretar errado
    // Prefixar com = para for\u00e7ar texto no Excel
    var formattedRow = row.map(function(cell, idx) {
      if (idx === 0 && cell) {
        // Coluna DATA - formatar como texto puro entre aspas
        return '"' + cell + '"';
      }
      return cell;
    });
    csvContent += formattedRow.join(';') + '\n';
  });
  
  // Criar blob e baixar
  var blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
  var link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  
  // Nome do arquivo com data atual
  var today = new Date();
  var fileName = 'CONTROLE_DE_AGUA_GRANJA_VITTA_' + 
    today.getFullYear() + '-' + 
    String(today.getMonth() + 1).padStart(2, '0') + '-' + 
    String(today.getDate()).padStart(2, '0') + '.csv';
  link.download = fileName;
  link.click();
  
  showNotification('Planilha exportada com sucesso! ' + rows.length + ' registros.', 'success');
  
  // Também gerar relatório HTML interativo
  generateInteractiveReport(rows, dailyData, dates);
}

// Gerar relatório HTML interativo e tecnológico
function generateInteractiveReport(rows, dailyData, dates) {
  // Calcular totais para os gráficos
  let totalRecria = 0, totalAviarios = 0;
  let totalRecriaTrabalho = 0, totalAviariosTrabalho = 0;
  const chartDataTrabalho = [];
  const chartData24h = [];
  const dailyTotals = []; // Para ranking de maiores gastos

  dates.forEach((dateStr, idx) => {
    const data = dailyData[dateStr];
    const nextData = dates[idx + 1] ? dailyData[dates[idx + 1]] : null;
    const formattedDate = data.dateFormatted || new Date(dateStr + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    
    let dayTotalTrabalho = 0;
    let dayTotal24h = 0;
    
    // Trabalho RECRIA
    if (data.recria?.am !== undefined && data.recria?.pm !== undefined) {
      const consumo = (data.recria.pm - data.recria.am) * 1000;
      chartDataTrabalho.push({ date: formattedDate, tank: 'Recria', value: consumo });
      totalRecriaTrabalho += consumo;
      dayTotalTrabalho += consumo;
    }
    // Trabalho AVIARIOS
    if (data.aviarios?.am !== undefined && data.aviarios?.pm !== undefined) {
      const consumo = (data.aviarios.pm - data.aviarios.am) * 1000;
      chartDataTrabalho.push({ date: formattedDate, tank: 'Aviários', value: consumo });
      totalAviariosTrabalho += consumo;
      dayTotalTrabalho += consumo;
    }
    
    // 24h RECRIA
    if (data.recria?.am !== undefined && nextData?.recria?.am !== undefined) {
      const consumo = (nextData.recria.am - data.recria.am) * 1000;
      chartData24h.push({ date: formattedDate, tank: 'Recria', value: consumo });
      totalRecria += consumo;
      dayTotal24h += consumo;
    }
    // 24h AVIARIOS
    if (data.aviarios?.am !== undefined && nextData?.aviarios?.am !== undefined) {
      const consumo = (nextData.aviarios.am - data.aviarios.am) * 1000;
      chartData24h.push({ date: formattedDate, tank: 'Aviários', value: consumo });
      totalAviarios += consumo;
      dayTotal24h += consumo;
    }
    
    if (dayTotal24h > 0) {
      dailyTotals.push({ date: formattedDate, total: dayTotal24h });
    }
  });
  
  // Top 5 maiores gastos
  const topGastos = [...dailyTotals].sort((a, b) => b.total - a.total).slice(0, 5);
  
  // Dados para gráfico de linha (tendência)
  const uniqueDatesTrabalho = [...new Set(chartDataTrabalho.map(d => d.date))];
  const uniqueDates24h = [...new Set(chartData24h.map(d => d.date))];
  
  // Média móvel (tendência)
  const avgRecria = totalRecria / Math.max(uniqueDates24h.length, 1);
  const avgAviarios = totalAviarios / Math.max(uniqueDates24h.length, 1);

  const htmlContent = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Relatório de Controle de Água - Granja Vitta</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: 'Segoe UI', system-ui, sans-serif; 
      background: linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 100%);
      color: #fff;
      min-height: 100vh;
      padding: 30px;
    }
    .container { max-width: 1400px; margin: 0 auto; }
    .header {
      text-align: center;
      padding: 40px;
      background: linear-gradient(135deg, rgba(212, 175, 55, 0.1) 0%, rgba(212, 175, 55, 0.02) 100%);
      border: 1px solid rgba(212, 175, 55, 0.3);
      border-radius: 20px;
      margin-bottom: 30px;
    }
    .header h1 { 
      font-size: 32px; 
      color: #d4af37; 
      margin-bottom: 10px;
      text-transform: uppercase;
      letter-spacing: 3px;
    }
    .header p { color: #888; font-size: 14px; }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 20px;
      margin-bottom: 30px;
    }
    .stat-card {
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 16px;
      padding: 25px;
      text-align: center;
    }
    .stat-card.gold { border-color: rgba(212, 175, 55, 0.5); }
    .stat-card h3 { font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px; }
    .stat-card .value { font-size: 36px; font-weight: 700; color: #d4af37; }
    .stat-card .unit { font-size: 14px; color: #666; }
    .tabs {
      display: flex;
      gap: 10px;
      margin-bottom: 20px;
    }
    .tab {
      flex: 1;
      padding: 15px;
      background: rgba(255,255,255,0.03);
      border: 2px solid rgba(255,255,255,0.1);
      border-radius: 12px;
      color: #888;
      font-weight: 600;
      cursor: pointer;
      text-align: center;
      transition: all 0.3s;
    }
    .tab:hover, .tab.active { border-color: #d4af37; color: #d4af37; background: rgba(212, 175, 55, 0.1); }
    .chart-container {
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 16px;
      padding: 30px;
      margin-bottom: 30px;
    }
    .chart-title { font-size: 18px; color: #fff; margin-bottom: 20px; display: flex; align-items: center; gap: 10px; }
    .charts-grid { display: grid; grid-template-columns: 2fr 1fr; gap: 20px; margin-bottom: 30px; }
    .ranking-list { list-style: none; }
    .ranking-item { 
      display: flex; 
      justify-content: space-between; 
      align-items: center;
      padding: 15px; 
      border-bottom: 1px solid rgba(255,255,255,0.05);
      transition: background 0.2s;
    }
    .ranking-item:hover { background: rgba(255,255,255,0.02); }
    .ranking-position { 
      width: 30px; 
      height: 30px; 
      background: linear-gradient(135deg, #d4af37, #b8942e);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 12px;
      color: #000;
      margin-right: 15px;
    }
    .ranking-item:nth-child(1) .ranking-position { background: linear-gradient(135deg, #ffd700, #ffaa00); }
    .ranking-item:nth-child(2) .ranking-position { background: linear-gradient(135deg, #c0c0c0, #a0a0a0); }
    .ranking-item:nth-child(3) .ranking-position { background: linear-gradient(135deg, #cd7f32, #a0522d); }
    .ranking-date { flex: 1; font-weight: 500; }
    .ranking-value { font-weight: 700; color: #d4af37; font-size: 16px; }
    .table-container {
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 16px;
      overflow: hidden;
    }
    .table-header { padding: 20px 25px; border-bottom: 1px solid rgba(255,255,255,0.1); }
    .table-header h3 { font-size: 18px; color: #fff; }
    table { width: 100%; border-collapse: collapse; }
    th { 
      background: rgba(212, 175, 55, 0.15); 
      color: #d4af37; 
      padding: 15px; 
      text-align: left; 
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    td { 
      padding: 15px; 
      border-bottom: 1px solid rgba(255,255,255,0.05); 
      font-size: 13px;
    }
    tr:hover { background: rgba(255,255,255,0.02); }
    .badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 600;
    }
    .badge-trabalho { background: rgba(59, 130, 246, 0.2); color: #60a5fa; }
    .badge-diario { background: rgba(16, 185, 129, 0.2); color: #34d399; }
    .badge-recria { background: rgba(16, 185, 129, 0.2); color: #34d399; }
    .badge-aviarios { background: rgba(59, 130, 246, 0.2); color: #60a5fa; }
    .print-btn { 
      background: linear-gradient(135deg, #d4af37, #b8942e); 
      color: #000; 
      border: none; 
      padding: 15px 40px; 
      font-size: 16px; 
      font-weight: 600; 
      border-radius: 8px; 
      cursor: pointer; 
      margin-bottom: 20px;
    }
    .footer {
      text-align: center;
      padding: 30px;
      color: #666;
      font-size: 12px;
    }
    @media print {
      body { background: #fff; color: #333; }
      .stat-card { border-color: #ddd; }
      .stat-card .value { color: #333; }
      .print-btn { display: none; }
      .charts-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>💧 Controle de Água</h1>
      <p><strong>Granja Vitta</strong> • Sistema Icarus • Gerado em ${new Date().toLocaleString('pt-BR')}</p>
    </div>

    <div class="stats-grid">
      <div class="stat-card gold">
        <h3>🏆 Total Geral</h3>
        <div class="value">${((totalRecria + totalAviarios) / 1000).toFixed(1)}</div>
        <div class="unit">m³ consumidos (24h)</div>
      </div>
      <div class="stat-card">
        <h3>💚 Recria (24h)</h3>
        <div class="value">${(totalRecria / 1000).toFixed(1)}</div>
        <div class="unit">m³ consumidos</div>
      </div>
      <div class="stat-card">
        <h3>💙 Aviários (24h)</h3>
        <div class="value">${(totalAviarios / 1000).toFixed(1)}</div>
        <div class="unit">m³ consumidos</div>
      </div>
      <div class="stat-card gold">
        <h3>📊 Média Diária</h3>
        <div class="value">${Math.round((avgRecria + avgAviarios)).toLocaleString('pt-BR')}</div>
        <div class="unit">litros/dia (total)</div>
      </div>
    </div>

    <div class="tabs">
      <div class="tab active" onclick="showTab('trabalho')">⏰ Período Trabalho (7h-16h)</div>
      <div class="tab" onclick="showTab('diario')">📊 Consumo 24 Horas</div>
    </div>

    <div class="charts-grid">
      <div class="chart-container">
        <div class="chart-title">📈 Evolução do Consumo</div>
        <canvas id="waterChart" height="120"></canvas>
      </div>
      <div class="chart-container">
        <div class="chart-title">🏅 Top 5 Maiores Gastos (24h)</div>
        <ul class="ranking-list">
          ${topGastos.map((item, idx) => `
            <li class="ranking-item">
              <span class="ranking-position">${idx + 1}</span>
              <span class="ranking-date">${item.date}</span>
              <span class="ranking-value">${(item.total / 1000).toFixed(2)} m³</span>
            </li>
          `).join('')}
          ${topGastos.length === 0 ? '<li class="ranking-item"><span style="color:#666">Sem dados suficientes</span></li>' : ''}
        </ul>
      </div>
    </div>

    <div class="chart-container" style="margin-bottom: 30px;">
      <div class="chart-title">🎯 Consumo por Caixa (Período Selecionado)</div>
      <canvas id="tankChart" height="80"></canvas>
    </div>

    <div class="table-container">
      <div class="table-header">
        <h3>📋 Histórico Detalhado de Leituras</h3>
      </div>
      <table>
        <thead>
          <tr>
            <th>Data</th>
            <th>Dia</th>
            <th>Caixa</th>
            <th>Período</th>
            <th>Entrada (m³)</th>
            <th>L/Hora</th>
            <th>Total (L)</th>
            <th>Tipo</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(row => `
            <tr>
              <td><strong>${row[0]}</strong></td>
              <td>${row[1]}</td>
              <td><span class="badge badge-${row[2].toLowerCase()}">${row[2]}</span></td>
              <td>${row[3]}</td>
              <td style="font-family: monospace;">${row[4]}</td>
              <td>${row[5]}</td>
              <td><strong>${row[6]}</strong></td>
              <td><span class="badge badge-${row[7].toLowerCase()}">${row[7]}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <div class="footer">
      <button onclick="window.print()" class="print-btn">🖨️ Imprimir / Salvar PDF</button>
      <p>Relatório gerado automaticamente pelo Sistema Icarus • Granja Vitta</p>
      <p>Desenvolvido por Guilherme Braga • © 2025</p>
    </div>
  </div>

  <script>
    // Preparar dados para gráficos
    const trabalhoData = ${JSON.stringify(chartDataTrabalho)};
    const data24h = ${JSON.stringify(chartData24h)};
    const avgRecria = ${avgRecria.toFixed(0)};
    const avgAviarios = ${avgAviarios.toFixed(0)};
    
    // Agrupar por data
    function groupByDate(data) {
      const grouped = {};
      data.forEach(d => {
        if (!grouped[d.date]) grouped[d.date] = { recria: 0, aviarios: 0 };
        if (d.tank === 'Recria') grouped[d.date].recria = d.value;
        if (d.tank === 'Aviários') grouped[d.date].aviarios = d.value;
      });
      return grouped;
    }
    
    let currentData = groupByDate(trabalhoData);
    let labels = Object.keys(currentData);
    
    // Gráfico principal de evolução
    const ctx = document.getElementById('waterChart').getContext('2d');
    let chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Recria (L)',
            data: labels.map(l => currentData[l]?.recria || 0),
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            fill: true,
            tension: 0.4,
            pointRadius: 6,
            pointHoverRadius: 10
          },
          {
            label: 'Aviários (L)',
            data: labels.map(l => currentData[l]?.aviarios || 0),
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            fill: true,
            tension: 0.4,
            pointRadius: 6,
            pointHoverRadius: 10
          }
        ]
      },
      options: {
        responsive: true,
        interaction: { intersect: false, mode: 'index' },
        plugins: { legend: { labels: { color: '#888' } } },
        scales: {
          x: { ticks: { color: '#888' }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: { ticks: { color: '#888' }, grid: { color: 'rgba(255,255,255,0.05)' } }
        }
      }
    });
    
    // Gráfico de barras horizontais por caixa
    const tankCtx = document.getElementById('tankChart').getContext('2d');
    const totalRecriaChart = Object.values(currentData).reduce((a, b) => a + (b.recria || 0), 0);
    const totalAviariosChart = Object.values(currentData).reduce((a, b) => a + (b.aviarios || 0), 0);
    
    let tankChart = new Chart(tankCtx, {
      type: 'bar',
      data: {
        labels: ['Recria', 'Aviários'],
        datasets: [{
          data: [totalRecriaChart, totalAviariosChart],
          backgroundColor: ['rgba(16, 185, 129, 0.7)', 'rgba(59, 130, 246, 0.7)'],
          borderColor: ['#10b981', '#3b82f6'],
          borderWidth: 2,
          borderRadius: 8
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#888' }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: { ticks: { color: '#888', font: { size: 14, weight: 'bold' } }, grid: { display: false } }
        }
      }
    });

    function showTab(type) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      event.target.classList.add('active');
      
      const sourceData = type === 'trabalho' ? trabalhoData : data24h;
      currentData = groupByDate(sourceData);
      labels = Object.keys(currentData);
      
      chart.data.labels = labels;
      chart.data.datasets[0].data = labels.map(l => currentData[l]?.recria || 0);
      chart.data.datasets[1].data = labels.map(l => currentData[l]?.aviarios || 0);
      chart.update();
      
      // Atualizar gráfico de barras
      const totalRecria = labels.reduce((a, l) => a + (currentData[l]?.recria || 0), 0);
      const totalAviarios = labels.reduce((a, l) => a + (currentData[l]?.aviarios || 0), 0);
      tankChart.data.datasets[0].data = [totalRecria, totalAviarios];
      tankChart.update();
    }
  </script>
</body>
</html>`;

  // Abrir em nova janela
  const newWindow = window.open('', '_blank');
  newWindow.document.write(htmlContent);
  newWindow.document.close();
}

// Obter label do período
function getPeriodLabel() {
  switch (state.waterPeriod) {
    case 'day': return 'Hoje';
    case 'week': return 'Última Semana';
    case 'month': return 'Último Mês';
    default: return 'Período';
  }
}

// ========== FIM CONTROLE DE ÁGUA ==========

// ========== CONTROLE DE DIESEL ==========

// Estado adicional para mês selecionado no diesel
if (typeof state.dieselSelectedMonth === 'undefined') {
  state.dieselSelectedMonth = null; // null = mês atual, ou 'YYYY-MM' para mês específico
}

// Função auxiliar para obter datas do período (diesel)
function getDieselPeriodDates() {
  var now = new Date();
  var year, month, day, endDate, startDate;
  
  // Se um mês específico foi selecionado
  if (state.dieselSelectedMonth) {
    var parts = state.dieselSelectedMonth.split('-');
    year = parseInt(parts[0]);
    month = parseInt(parts[1]) - 1; // 0-indexed
    
    // Para mês específico, sempre retorna o mês inteiro
    startDate = new Date(year, month, 1, 0, 0, 0);
    // Último dia do mês
    endDate = new Date(year, month + 1, 0, 23, 59, 59);
  } else {
    // Comportamento original para hoje/semana/mês atual
    year = now.getFullYear();
    month = now.getMonth();
    day = now.getDate();
    endDate = new Date(year, month, day, 23, 59, 59);
    
    if (state.dieselPeriod === 'today') {
      startDate = new Date(year, month, day, 0, 0, 0);
    } else if (state.dieselPeriod === 'week') {
      // 7 dias atrás
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      startDate.setHours(0, 0, 0, 0);
    } else {
      // month - mês atual inteiro (do dia 1 até hoje)
      startDate = new Date(year, month, 1, 0, 0, 0);
    }
  }
  
  var startStr = startDate.getFullYear() + '-' + 
    String(startDate.getMonth() + 1).padStart(2, '0') + '-' + 
    String(startDate.getDate()).padStart(2, '0');
  var endStr = endDate.getFullYear() + '-' + 
    String(endDate.getMonth() + 1).padStart(2, '0') + '-' + 
    String(endDate.getDate()).padStart(2, '0');
  
  return { startDate: startStr, endDate: endStr };
}

// Carregar controle de diesel
async function loadDieselControl() {
  try {
    // Verificar permissão de edição e esconder/mostrar formulário
    var formSection = document.getElementById('diesel-form-section');
    if (formSection) {
      formSection.classList.toggle('hidden', !state.canEditDiesel);
    }
    
    // Definir data de hoje no input APENAS se estiver vazio
    var now = new Date();
    var year = now.getFullYear();
    var month = String(now.getMonth() + 1).padStart(2, '0');
    var day = String(now.getDate()).padStart(2, '0');
    var today = year + '-' + month + '-' + day;
    
    var dateInput = document.getElementById('diesel-date');
    if (dateInput && !dateInput.value) dateInput.value = today;
    
    // Preencher dropdown de meses (últimos 12 meses)
    populateDieselMonthSelect();
    
    // Atualizar estado dos botões de período
    updateDieselPeriodButtons();
    
    // Carregar dados
    await Promise.all([
      loadDieselRecords(),
      loadDieselStats()
    ]);
    
    // Renderizar
    renderDieselStats();
    renderDieselChart();
    renderDieselHistory();
    checkDieselAlerts();
    
    console.log('Diesel carregado:', state.dieselRecords.length, 'registros', state.dieselStats);
    
  } catch (error) {
    console.error('Erro ao carregar controle de diesel:', error);
  }
}

// Preencher dropdown de meses do diesel
function populateDieselMonthSelect() {
  var select = document.getElementById('diesel-month-select');
  if (!select) return;
  
  var now = new Date();
  var meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 
               'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  
  var html = '<option value="">Mês Específico...</option>';
  
  // Últimos 12 meses
  for (var i = 0; i < 12; i++) {
    var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    var value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    var label = meses[d.getMonth()] + ' ' + d.getFullYear();
    html += '<option value="' + value + '">' + label + '</option>';
  }
  
  select.innerHTML = html;
  
  // Se já há um mês selecionado, marcar
  if (state.dieselSelectedMonth) {
    select.value = state.dieselSelectedMonth;
  }
}

// Atualizar estado visual dos botões de período do diesel
function updateDieselPeriodButtons() {
  ['today', 'week', 'month'].forEach(function(p) {
    var btn = document.getElementById('diesel-filter-' + p);
    if (btn) {
      if (state.dieselSelectedMonth) {
        btn.classList.remove('active');
      } else if (p === state.dieselPeriod) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    }
  });
}

// Carregar registros de diesel
async function loadDieselRecords() {
  try {
    var dates = getDieselPeriodDates();
    var url = API_URL + '/diesel-records?startDate=' + dates.startDate + '&endDate=' + dates.endDate;
    console.log('[Diesel] Carregando registros:', url);
    
    var response = await fetch(url, {
      headers: { 'Authorization': 'Bearer ' + state.token }
    });
    
    var data = await response.json();
    console.log('[Diesel] Resposta registros:', data);
    if (data.ok) {
      state.dieselRecords = data.records || [];
      console.log('[Diesel] Registros carregados:', state.dieselRecords.length);
    }
  } catch (error) {
    console.error('Erro ao carregar registros de diesel:', error);
  }
}

// Carregar estatísticas de diesel
async function loadDieselStats() {
  try {
    var dates = getDieselPeriodDates();
    var url = API_URL + '/diesel-records/stats?startDate=' + dates.startDate + '&endDate=' + dates.endDate;
    console.log('[Diesel] Carregando stats:', url);
    
    var response = await fetch(url, {
      headers: { 'Authorization': 'Bearer ' + state.token }
    });
    
    var data = await response.json();
    console.log('[Diesel] Resposta stats:', data);
    if (data.ok) {
      state.dieselStats = data.stats;
      console.log('[Diesel] Stats carregados:', state.dieselStats);
    }
  } catch (error) {
    console.error('Erro ao carregar estatísticas de diesel:', error);
  }
}

// Alternar período do diesel
async function setDieselPeriod(period) {
  state.dieselPeriod = period;
  state.dieselSelectedMonth = null; // Limpar seleção de mês específico
  
  // Atualizar botões - usar IDs que começam com diesel-filter
  ['today', 'week', 'month'].forEach(function(p) {
    var btn = document.getElementById('diesel-filter-' + p);
    if (btn) btn.classList.remove('active');
  });
  var activeBtn = document.getElementById('diesel-filter-' + period);
  if (activeBtn) activeBtn.classList.add('active');
  
  // Limpar seleção do dropdown de mês
  var monthSelect = document.getElementById('diesel-month-select');
  if (monthSelect) monthSelect.value = '';
  
  // Recarregar dados
  await Promise.all([
    loadDieselRecords(),
    loadDieselStats()
  ]);
  
  renderDieselStats();
  renderDieselChart();
  renderDieselHistory();
  checkDieselAlerts();
}

// Selecionar mês específico do diesel
async function setDieselMonth(monthValue) {
  if (!monthValue) {
    // Voltou para "mês atual"
    state.dieselSelectedMonth = null;
    state.dieselPeriod = 'month';
    setDieselPeriod('month');
    return;
  }
  
  state.dieselSelectedMonth = monthValue; // formato YYYY-MM
  
  // Remover active de todos os botões de período
  ['today', 'week', 'month'].forEach(function(p) {
    var btn = document.getElementById('diesel-filter-' + p);
    if (btn) btn.classList.remove('active');
  });
  
  // Recarregar dados
  await Promise.all([
    loadDieselRecords(),
    loadDieselStats()
  ]);
  
  renderDieselStats();
  renderDieselChart();
  renderDieselHistory();
  checkDieselAlerts();
}

// Verificar alertas de estoque de diesel
function checkDieselAlerts() {
  var container = document.getElementById('diesel-alert-container');
  if (!container) return;
  
  var stats = state.dieselStats || {};
  var saldo = stats.saldo_atual || stats.saldoAtual || 0;
  
  // Ícones SVG modernos
  var svgOk = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
  var svgAlert = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
  var svgCritical = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
  var svgEmpty = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>';
  var svgGauge = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4"/><path d="m16.2 7.8 2.9-2.9"/><path d="M18 12h4"/><path d="m16.2 16.2 2.9 2.9"/><path d="M12 18v4"/><path d="m4.9 19.1 2.9-2.9"/><path d="M2 12h4"/><path d="m4.9 4.9 2.9 2.9"/><circle cx="12" cy="12" r="4"/></svg>';
  
  // Limites de alerta
  var LIMITE_CRITICO = 50;   // Crítico - vermelho
  var LIMITE_BAIXO = 100;    // Baixo - amarelo/laranja
  var LIMITE_ATENCAO = 200;  // Atenção - amarelo
  
  // Estilo base do card
  var baseStyle = 'display:flex;align-items:center;gap:16px;padding:16px 20px;border-radius:16px;';
  var iconStyle = 'display:flex;align-items:center;justify-content:center;width:48px;height:48px;border-radius:12px;flex-shrink:0;';
  var contentStyle = 'display:flex;flex-direction:column;gap:4px;';
  var titleStyle = 'font-size:15px;font-weight:700;letter-spacing:0.5px;';
  var subtitleStyle = 'font-size:13px;opacity:0.9;';
  
  if (saldo <= 0) {
    container.innerHTML = '<div class="diesel-status-card" style="' + baseStyle + 'background:linear-gradient(135deg,rgba(249,57,67,0.15),rgba(220,38,38,0.1));border:1px solid rgba(249,57,67,0.4);">' +
      '<div style="' + iconStyle + 'background:rgba(249,57,67,0.2);color:#f93943;">' + svgEmpty + '</div>' +
      '<div style="' + contentStyle + '">' +
      '<span style="' + titleStyle + 'color:#f93943;">DIESEL ESGOTADO</span>' +
      '<span style="' + subtitleStyle + 'color:#fca5a5;">Tanque vazio! Abastecimento urgente necessário.</span>' +
      '</div></div>';
    // Verificar se precisa criar requisição de compra
    checkDieselAutoRequest(saldo);
  } else if (saldo <= LIMITE_CRITICO) {
    container.innerHTML = '<div class="diesel-status-card" style="' + baseStyle + 'background:linear-gradient(135deg,rgba(249,57,67,0.15),rgba(220,38,38,0.1));border:1px solid rgba(249,57,67,0.4);">' +
      '<div style="' + iconStyle + 'background:rgba(249,57,67,0.2);color:#f93943;">' + svgCritical + '</div>' +
      '<div style="' + contentStyle + '">' +
      '<span style="' + titleStyle + 'color:#f93943;">ESTOQUE CRÍTICO</span>' +
      '<span style="' + subtitleStyle + 'color:#fca5a5;">Apenas <strong>' + saldo.toLocaleString('pt-BR') + ' L</strong> restantes. Abasteça imediatamente!</span>' +
      '</div></div>';
    checkDieselAutoRequest(saldo);
  } else if (saldo <= LIMITE_BAIXO) {
    container.innerHTML = '<div class="diesel-status-card" style="' + baseStyle + 'background:linear-gradient(135deg,rgba(249,115,22,0.15),rgba(234,88,12,0.1));border:1px solid rgba(249,115,22,0.4);">' +
      '<div style="' + iconStyle + 'background:rgba(249,115,22,0.2);color:#f97316;">' + svgAlert + '</div>' +
      '<div style="' + contentStyle + '">' +
      '<span style="' + titleStyle + 'color:#f97316;">ESTOQUE BAIXO</span>' +
      '<span style="' + subtitleStyle + 'color:#fdba74;"><strong>' + saldo.toLocaleString('pt-BR') + ' L</strong> restantes. Programe o abastecimento.</span>' +
      '</div></div>';
    checkDieselAutoRequest(saldo);
  } else if (saldo <= LIMITE_ATENCAO) {
    container.innerHTML = '<div class="diesel-status-card" style="' + baseStyle + 'background:linear-gradient(135deg,rgba(234,179,8,0.15),rgba(202,138,4,0.1));border:1px solid rgba(234,179,8,0.4);">' +
      '<div style="' + iconStyle + 'background:rgba(234,179,8,0.2);color:#eab308;">' + svgGauge + '</div>' +
      '<div style="' + contentStyle + '">' +
      '<span style="' + titleStyle + 'color:#eab308;">ATENÇÃO AO ESTOQUE</span>' +
      '<span style="' + subtitleStyle + 'color:#fde047;"><strong>' + saldo.toLocaleString('pt-BR') + ' L</strong> disponíveis. Monitore o consumo.</span>' +
      '</div></div>';
  } else {
    container.innerHTML = '<div class="diesel-status-card" style="' + baseStyle + 'background:linear-gradient(135deg,rgba(34,197,94,0.12),rgba(22,163,74,0.08));border:1px solid rgba(34,197,94,0.35);">' +
      '<div style="' + iconStyle + 'background:rgba(34,197,94,0.2);color:#22c55e;">' + svgOk + '</div>' +
      '<div style="' + contentStyle + '">' +
      '<span style="' + titleStyle + 'color:#22c55e;">ESTOQUE ADEQUADO</span>' +
      '<span style="' + subtitleStyle + 'color:#86efac;"><strong>' + saldo.toLocaleString('pt-BR') + ' L</strong> disponíveis no tanque.</span>' +
      '</div></div>';
  }
}

// Verificar e criar/remover requisição automática de diesel quando estoque baixo
// Flag para evitar chamadas duplicadas
var _dieselAutoRequestRunning = false;

async function checkDieselAutoRequest(saldo) {
  // Evitar execução duplicada
  if (_dieselAutoRequestRunning) {
    console.log('[Diesel] Auto-request já em execução, ignorando...');
    return;
  }
  
  // Só usuários com permissão podem ver/criar requisições
  if (!state.user || !state.user.roles) {
    return;
  }
  
  var hasPermission = state.user.roles.includes('admin') || 
                      state.user.roles.includes('compras') || 
                      state.user.roles.includes('diesel');
  if (!hasPermission) return;
  
  _dieselAutoRequestRunning = true;
  
  // Limite para considerar estoque baixo (100L ou menos)
  var LIMITE_BAIXO = 100;
  var dieselBaixo = saldo <= LIMITE_BAIXO;
  
  try {
    // SEMPRE recarregar compras do servidor para ter dados atualizados
    var resp = await fetch(API_URL + '/purchases', {
      headers: { 'Authorization': 'Bearer ' + state.token }
    });
    var data = await resp.json();
    if (data.ok) state.purchases = data.purchases || [];
    
    // Procurar requisição de diesel pendente (em análise ou pedido)
    var requisicaoDiesel = state.purchases.find(function(p) {
      var isDiesel = p.item_name && p.item_name.toLowerCase().includes('diesel');
      var isPendente = p.status === 'analise' || p.status === 'pedido' || p.status === 'chegando';
      var isAuto = p.auto_generated === true || (p.notes && p.notes.includes('AUTOMÁTICA'));
      return isDiesel && isPendente && isAuto;
    });
    
    if (dieselBaixo) {
      // Diesel baixo - criar requisição se não existe
      if (!requisicaoDiesel) {
        console.log('[Diesel] Estoque baixo (' + saldo + 'L) - criando requisição automática...');
        
        var stats = state.dieselStats || {};
        var consumoMes = stats.total_saida || stats.totalSaida || 0;
        var quantidadeSugerida = Math.max(consumoMes, 200);
        
        var mensagem = 'REQUISIÇÃO AUTOMÁTICA DE DIESEL\n\n' +
          'O sistema detectou que o estoque de diesel está baixo:\n' +
          '• Estoque atual: ' + saldo.toLocaleString('pt-BR') + ' litros\n' +
          '• Consumo do mês: ' + consumoMes.toLocaleString('pt-BR') + ' litros\n' +
          '• Quantidade sugerida: ' + quantidadeSugerida.toLocaleString('pt-BR') + ' litros\n\n' +
          'Por favor, providencie o abastecimento o mais rápido possível.';
        
        var response = await fetch(API_URL + '/purchases', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + state.token
          },
          body: JSON.stringify({
            item_name: '🛢️ DIESEL - Abastecimento Urgente',
            quantity: quantidadeSugerida,
            unit: 'L',
            category: 'combustivel',
            priority: 'high',
            notes: mensagem,
            auto_generated: true
          })
        });
        
        if (response.ok) {
          showNotification('⛽ Requisição de diesel criada automaticamente!', 'warning');
          console.log('[Diesel] Requisição automática criada com sucesso');
          // Recarregar compras
          await loadPurchases();
        }
      } else {
        console.log('[Diesel] Requisição de diesel já existe:', requisicaoDiesel.id);
      }
    } else {
      // Diesel OK - remover requisição automática se existir
      if (requisicaoDiesel) {
        console.log('[Diesel] Estoque OK (' + saldo + 'L) - removendo requisição automática...');
        
        var delResp = await fetch(API_URL + '/purchases/' + requisicaoDiesel.id, {
          method: 'DELETE',
          headers: { 'Authorization': 'Bearer ' + state.token }
        });
        
        if (delResp.ok) {
          showNotification('✅ Requisição de diesel removida (estoque OK)', 'success');
          console.log('[Diesel] Requisição automática removida');
          await loadPurchases();
        }
      }
    }
  } catch (e) {
    console.error('[Diesel] Erro ao gerenciar requisição automática:', e);
  } finally {
    _dieselAutoRequestRunning = false;
  }
}

// Função para mostrar detalhes da requisição
function showPurchaseDetails(purchaseId) {
  const purchase = state.purchases.find(p => p.id === purchaseId);
  if (!purchase) return;
  
  const statusConfig = {
    analise: { color: '#f59e0b', bg: 'rgba(245,158,11,0.15)', text: 'Em Análise', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>' },
    pedido: { color: '#3b82f6', bg: 'rgba(59,130,246,0.15)', text: 'Pedido Feito', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22,4 12,14.01 9,11.01"/></svg>' },
    chegando: { color: '#8b5cf6', bg: 'rgba(139,92,246,0.15)', text: 'Em Trânsito', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="3" width="15" height="13"/><polygon points="16,8 20,8 23,11 23,16 16,16 16,8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>' },
    chegou: { color: '#10b981', bg: 'rgba(16,185,129,0.15)', text: 'Entregue', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22,4 12,14.01 9,11.01"/></svg>' }
  };
  
  const status = statusConfig[purchase.status] || statusConfig.analise;
  
  const photoHtml = purchase.photo_url 
    ? `<div style="margin-top: 12px; border-radius: 12px; overflow: hidden; border: 1px solid rgba(255,255,255,0.1);">
         <img src="${purchase.photo_url}" style="width: 100%; max-height: 250px; object-fit: cover; cursor: pointer; transition: transform 0.3s;" onclick="window.open('${purchase.photo_url}', '_blank')" onmouseover="this.style.transform='scale(1.02)'" onmouseout="this.style.transform='scale(1)'">
       </div>`
    : `<div style="text-align: center; padding: 30px; background: rgba(255,255,255,0.02); border-radius: 12px; border: 1px dashed rgba(255,255,255,0.1);">
         <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#475569" stroke-width="1.5" style="margin-bottom: 8px;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21,15 16,10 5,21"/></svg>
         <div style="color: #64748b; font-size: 13px;">Nenhuma foto anexada</div>
       </div>`;
  
  const modalHtml = `
    <div id="modal-purchase-details" class="modal-overlay active" onclick="if(event.target === this) closeModal('modal-purchase-details')" style="backdrop-filter: blur(8px); background: rgba(0,0,0,0.7);">
      <div class="modal" style="max-width: 520px; background: linear-gradient(135deg, rgba(15,23,42,0.95) 0%, rgba(30,41,59,0.95) 100%); border: 1px solid rgba(6,182,212,0.2); box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5), 0 0 40px rgba(6,182,212,0.1);">
        
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <div style="width: 48px; height: 48px; background: linear-gradient(135deg, rgba(6,182,212,0.2), rgba(6,182,212,0.05)); border-radius: 12px; display: flex; align-items: center; justify-content: center; border: 1px solid rgba(6,182,212,0.3);">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent-cyan)" stroke-width="2"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
            </div>
            <div>
              <h3 style="margin: 0; font-size: 16px; color: #fff; max-width: 280px;">${escapeHtml(purchase.item_name)}</h3>
              <div style="display: flex; align-items: center; gap: 6px; margin-top: 4px;">
                <span style="background: ${status.bg}; color: ${status.color}; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; display: flex; align-items: center; gap: 4px;">
                  ${status.icon} ${status.text}
                </span>
              </div>
            </div>
          </div>
          <button onclick="closeModal('modal-purchase-details')" style="background: none; border: none; color: #64748b; cursor: pointer; padding: 4px; transition: color 0.2s;" onmouseover="this.style.color='#fff'" onmouseout="this.style.color='#64748b'">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 16px;">
          <div style="background: rgba(6,182,212,0.1); border: 1px solid rgba(6,182,212,0.2); border-radius: 10px; padding: 12px; text-align: center;">
            <div style="font-size: 20px; font-weight: 700; color: var(--accent-cyan);">${purchase.quantity}</div>
            <div style="font-size: 11px; color: #64748b;">${escapeHtml(purchase.unit || 'un')}</div>
          </div>
          <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 12px; text-align: center;">
            <div style="font-size: 14px; font-weight: 600; color: #fff;">R$ ${(purchase.unit_price || 0).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</div>
            <div style="font-size: 11px; color: #64748b;">Pre\u00e7o Unit.</div>
          </div>
          <div style="background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.2); border-radius: 10px; padding: 12px; text-align: center;">
            <div style="font-size: 14px; font-weight: 600; color: #10b981;">R$ ${(purchase.total_cost || 0).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</div>
            <div style="font-size: 11px; color: #64748b;">Total</div>
          </div>
        </div>
        
        <div style="background: rgba(255,255,255,0.03); border-radius: 10px; padding: 14px; margin-bottom: 16px;">
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 13px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              <div><span style="color: #64748b;">Solicitante:</span> <span style="color: #fff;">${escapeHtml(purchase.requested_by_name || 'N/A')}</span></div>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              <div><span style="color: #64748b;">Data:</span> <span style="color: #fff;">${new Date(purchase.created_at).toLocaleDateString('pt-BR')}</span></div>
            </div>
            ${purchase.supplier ? `
            <div style="display: flex; align-items: center; gap: 8px; grid-column: span 2;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9,22 9,12 15,12 15,22"/></svg>
              <div><span style="color: #64748b;">Fornecedor:</span> <span style="color: #fff;">${escapeHtml(purchase.supplier)}</span></div>
            </div>` : ''}
          </div>
        </div>
        
        ${purchase.notes ? `
        <div style="margin-bottom: 16px;">
          <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 8px; color: #64748b; font-size: 12px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            OBSERVA\u00c7\u00d5ES
          </div>
          <div style="background: rgba(255,255,255,0.03); border-radius: 8px; padding: 12px; font-size: 13px; color: #94a3b8; white-space: pre-wrap; max-height: 140px; overflow-y: auto; border: 1px solid rgba(255,255,255,0.05);">${escapeHtml(purchase.notes)}</div>
        </div>` : ''}
        
        <div style="margin-bottom: 16px;">
          <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 8px; color: #64748b; font-size: 12px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21,15 16,10 5,21"/></svg>
            FOTO ANEXADA
          </div>
          ${photoHtml}
        </div>
        
        <div style="display: flex; gap: 10px;">
          <button onclick="closeModal('modal-purchase-details')" style="flex: 1; padding: 12px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; color: #fff; cursor: pointer; font-weight: 500; transition: all 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='rgba(255,255,255,0.05)'">Fechar</button>
          ${purchase.status !== 'chegou' && (state.user.username === 'joacir' || state.user.roles.includes('admin') || state.user.roles.includes('compras')) ? `
            <button onclick="closeModal('modal-purchase-details'); showAdvancePurchaseModal('${purchase.id}')" style="flex: 1; padding: 12px; background: linear-gradient(135deg, var(--accent-cyan), #0891b2); border: none; border-radius: 10px; color: #000; cursor: pointer; font-weight: 600; transition: all 0.2s;" onmouseover="this.style.transform='translateY(-1px)'" onmouseout="this.style.transform='translateY(0)'">Avan\u00e7ar Status</button>
          ` : ''}
        </div>
      </div>
    </div>
  `;
  
  const existing = document.getElementById('modal-purchase-details');
  if (existing) existing.remove();
  
  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

// Renderizar estatísticas do diesel
function renderDieselStats() {
  var stats = state.dieselStats || {};
  var records = state.dieselRecords || [];
  
  console.log('[Diesel] renderDieselStats chamado - stats:', stats, 'records:', records.length);
  
  var elTotalEntrada = document.getElementById('diesel-total-entrada');
  var elTotalSaida = document.getElementById('diesel-total-saida');
  var elSaldoAtual = document.getElementById('diesel-saldo-atual');
  var elUltimaMov = document.getElementById('diesel-ultima-mov');
  var elUltimaMovTipo = document.getElementById('diesel-ultima-mov-tipo');
  
  console.log('[Diesel] Elementos encontrados:', {
    entrada: !!elTotalEntrada, 
    saida: !!elTotalSaida, 
    saldo: !!elSaldoAtual, 
    mov: !!elUltimaMov, 
    movTipo: !!elUltimaMovTipo
  });
  
  // API retorna com underscores, converter para valores
  var totalEntrada = stats.total_entrada || stats.totalEntrada || 0;
  var totalSaida = stats.total_saida || stats.totalSaida || 0;
  var saldo = stats.saldo_atual || stats.saldoAtual || 0;
  
  if (elTotalEntrada) {
    elTotalEntrada.textContent = totalEntrada.toLocaleString('pt-BR') + ' L';
  }
  if (elTotalSaida) {
    elTotalSaida.textContent = totalSaida.toLocaleString('pt-BR') + ' L';
  }
  if (elSaldoAtual) {
    elSaldoAtual.textContent = saldo.toLocaleString('pt-BR') + ' L';
    // Mudar cor baseado no saldo
    if (saldo <= 50) {
      elSaldoAtual.style.color = '#f93943';
    } else if (saldo <= 100) {
      elSaldoAtual.style.color = '#f97316';
    } else if (saldo <= 200) {
      elSaldoAtual.style.color = '#eab308';
    } else {
      elSaldoAtual.style.color = '#22c55e';
    }
  }
  
  // Última movimentação
  if (elUltimaMov && elUltimaMovTipo) {
    if (records.length > 0) {
      // Ordenar por data e pegar o mais recente
      var sorted = records.slice().sort(function(a, b) {
        return (b.record_date || '').localeCompare(a.record_date || '');
      });
      var ultimo = sorted[0];
      var dateStr = ultimo.record_date ? ultimo.record_date.split('T')[0] : '';
      var parts = dateStr.split('-');
      var formattedDate = parts.length === 3 ? (parts[2] + '/' + parts[1]) : dateStr;
      
      elUltimaMov.textContent = formattedDate;
      var tipoTexto = ultimo.record_type === 'entrada' ? 'Entrada' : 'Saída';
      var qtd = (parseFloat(ultimo.quantity) || 0).toLocaleString('pt-BR');
      elUltimaMovTipo.textContent = tipoTexto + ': ' + qtd + ' L';
      
      // Cor baseada no tipo
      if (ultimo.record_type === 'entrada') {
        elUltimaMov.style.color = '#10b981';
      } else {
        elUltimaMov.style.color = '#ef4444';
      }
    } else {
      elUltimaMov.textContent = '-';
      elUltimaMovTipo.textContent = 'Sem registros no período';
      elUltimaMov.style.color = '#888';
    }
  }
}

// Renderizar gráfico de diesel (barras - entradas/saídas)
function renderDieselChart() {
  var canvas = document.getElementById('diesel-consumption-chart');
  if (!canvas) return;
  
  // Verificar se Chart.js está disponível
  if (typeof Chart === 'undefined') {
    console.warn('[Diesel] Chart.js não disponível, pulando gráfico');
    return;
  }
  
  var ctx = canvas.getContext('2d');
  var records = state.dieselRecords || [];
  
  // Agrupar por data
  var dailyData = {};
  records.forEach(function(r) {
    var dateKey = r.record_date ? r.record_date.split('T')[0] : '';
    if (!dailyData[dateKey]) {
      dailyData[dateKey] = { entrada: 0, saida: 0 };
    }
    if (r.record_type === 'entrada') {
      dailyData[dateKey].entrada += parseFloat(r.quantity) || 0;
    } else {
      dailyData[dateKey].saida += parseFloat(r.quantity) || 0;
    }
  });
  
  var labels = Object.keys(dailyData).sort();
  var entradasData = labels.map(function(d) { return dailyData[d].entrada; });
  var saidasData = labels.map(function(d) { return dailyData[d].saida; });
  
  // Formatar labels para exibição
  var formattedLabels = labels.map(function(d) {
    var parts = d.split('-');
    return parts[2] + '/' + parts[1];
  });
  
  // Destruir gráfico anterior se existir
  if (window.dieselChart) {
    window.dieselChart.destroy();
  }
  
  window.dieselChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: formattedLabels,
      datasets: [
        {
          label: 'Entradas (L)',
          data: entradasData,
          backgroundColor: 'rgba(16, 185, 129, 0.7)',
          borderColor: '#10b981',
          borderWidth: 1,
          borderRadius: 4
        },
        {
          label: 'Saídas (L)',
          data: saidasData,
          backgroundColor: 'rgba(239, 68, 68, 0.7)',
          borderColor: '#ef4444',
          borderWidth: 1,
          borderRadius: 4
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: '#888' }
        }
      },
      scales: {
        x: {
          ticks: { color: '#888' },
          grid: { color: 'rgba(255,255,255,0.05)' }
        },
        y: {
          ticks: { color: '#888' },
          grid: { color: 'rgba(255,255,255,0.05)' }
        }
      }
    }
  });
}

// Renderizar histórico do diesel
function renderDieselHistory() {
  var tbody = document.getElementById('diesel-history-tbody');
  if (!tbody) return;
  
  var records = state.dieselRecords || [];
  
  // Ordenar por data (mais recente primeiro)
  var sorted = records.slice().sort(function(a, b) {
    return (b.record_date || '').localeCompare(a.record_date || '');
  });
  
  if (sorted.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#888;">Nenhum registro no período</td></tr>';
    return;
  }
  
  var diasSemana = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
  
  var html = '';
  sorted.forEach(function(r) {
    var dateStr = r.record_date ? r.record_date.split('T')[0] : '';
    var parts = dateStr.split('-');
    var formattedDate = parts.length === 3 ? (parts[2] + '/' + parts[1] + '/' + parts[0]) : dateStr;
    
    // Calcular dia da semana
    var diaSemana = '';
    if (parts.length === 3) {
      var d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]), 12, 0, 0);
      diaSemana = diasSemana[d.getDay()];
    }
    
    var typeClass = r.record_type === 'entrada' ? 'badge-success' : 'badge-danger';
    var typeLabel = r.record_type === 'entrada' ? 'Entrada' : 'Saída';
    
    // Botão de delete (só para admin ou quem tem permissão)
    var canDelete = state.user && (state.user.roles.includes('admin') || state.user.roles.includes('os_manage_all') || state.user.roles.includes('diesel'));
    var deleteBtn = canDelete 
      ? '<button class="delete-reading-btn" onclick="deleteDieselRecord(\'' + r.id + '\')" title="Excluir registro">×</button>'
      : '';
    
    html += '<tr>';
    html += '<td>' + formattedDate + '</td>';
    html += '<td><span style="color: var(--text-secondary); font-size: 11px;">' + diaSemana + '</span></td>';
    html += '<td><span class="badge ' + typeClass + '">' + typeLabel + '</span></td>';
    html += '<td><strong>' + (parseFloat(r.quantity) || 0).toLocaleString('pt-BR') + ' L</strong></td>';
    html += '<td>' + (r.reason || '-') + '</td>';
    html += '<td>' + (r.recorded_by_name || '-') + '</td>';
    html += '<td class="delete-cell">' + deleteBtn + '</td>';
    html += '</tr>';
  });
  
  tbody.innerHTML = html;
}

// Salvar registro de diesel
async function saveDieselRecord() {
  try {
    // Verificar permissão de edição
    if (!state.canEditDiesel) {
      showNotification('Você não tem permissão para registrar diesel', 'error');
      return;
    }
    
    var dateInput = document.getElementById('diesel-date');
    var typeInput = document.getElementById('diesel-type');
    var quantityInput = document.getElementById('diesel-quantity');
    var reasonInput = document.getElementById('diesel-reason');
    
    var recordDate = dateInput ? dateInput.value : '';
    var recordType = typeInput ? typeInput.value : '';
    var quantity = quantityInput ? parseFloat(quantityInput.value) : 0;
    var reason = reasonInput ? reasonInput.value : '';
    
    if (!recordDate || !recordType || !quantity || quantity <= 0) {
      showNotification('Preencha todos os campos obrigatórios', 'error');
      return;
    }
    
    var response = await fetch(API_URL + '/diesel-records', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + state.token
      },
      body: JSON.stringify({
        record_date: recordDate,
        record_type: recordType,
        quantity: quantity,
        reason: reason
      })
    });
    
    var data = await response.json();
    
    if (data.ok) {
      showNotification('Registro de diesel salvo com sucesso!', 'success');
      
      // Limpar formulário
      if (quantityInput) quantityInput.value = '';
      if (reasonInput) reasonInput.value = '';
      
      // Recarregar dados
      await loadDieselControl();
    } else {
      showNotification(data.error || 'Erro ao salvar registro', 'error');
    }
  } catch (error) {
    console.error('Erro ao salvar registro de diesel:', error);
    showNotification('Erro ao salvar registro', 'error');
  }
}

// Excluir registro de diesel
async function deleteDieselRecord(id) {
  if (!confirm('Tem certeza que deseja excluir este registro de diesel?')) return;
  
  try {
    var response = await fetch(API_URL + '/diesel-records/' + id, {
      method: 'DELETE',
      headers: {
        'Authorization': 'Bearer ' + state.token
      }
    });
    
    var data = await response.json();
    
    if (data.ok) {
      state.dieselRecords = data.records;
      renderDieselHistory();
      // Recarregar estatísticas
      await loadDieselControl();
      showNotification('Registro de diesel excluído com sucesso!', 'success');
    } else {
      showNotification(data.error || 'Erro ao excluir registro', 'error');
    }
  } catch (error) {
    console.error('Erro ao excluir registro de diesel:', error);
    showNotification('Erro ao excluir registro', 'error');
  }
}

// Exportar relatório de diesel PDF
function exportDieselReportPDF() {
  var records = state.dieselRecords || [];
  var stats = state.dieselStats || {};
  
  if (records.length === 0) {
    showNotification('Nenhum dado para exportar', 'warning');
    return;
  }
  
  // Ordenar registros
  var sorted = records.slice().sort(function(a, b) {
    return (a.record_date || '').localeCompare(b.record_date || '');
  });
  
  var periodLabel = state.dieselPeriod === 'today' ? 'Hoje' : 
                    state.dieselPeriod === 'week' ? 'Última Semana' : 'Último Mês';
  
  var content = '<!DOCTYPE html>' +
    '<html lang="pt-BR">' +
    '<head>' +
    '<meta charset="UTF-8">' +
    '<title>Relatório de Diesel - Granja Vitta</title>' +
    '<style>' +
    'body { font-family: Arial, sans-serif; padding: 40px; background: #fff; color: #333; }' +
    '.header { text-align: center; margin-bottom: 30px; border-bottom: 3px solid #d4af37; padding-bottom: 20px; }' +
    '.header h1 { color: #1a1a2e; margin-bottom: 5px; }' +
    '.header p { color: #666; }' +
    '.stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 30px; }' +
    '.stat-box { background: #f8f9fa; border: 1px solid #ddd; border-radius: 8px; padding: 15px; text-align: center; }' +
    '.stat-box h3 { font-size: 12px; color: #666; margin-bottom: 5px; }' +
    '.stat-box .value { font-size: 24px; font-weight: bold; color: #1a1a2e; }' +
    'table { width: 100%; border-collapse: collapse; margin-top: 20px; }' +
    'th { background: #1a1a2e; color: #d4af37; padding: 12px; text-align: left; font-size: 12px; }' +
    'td { padding: 10px; border-bottom: 1px solid #eee; font-size: 13px; }' +
    'tr:nth-child(even) { background: #f8f9fa; }' +
    '.badge { padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; }' +
    '.badge-entrada { background: #d4edda; color: #155724; }' +
    '.badge-saida { background: #f8d7da; color: #721c24; }' +
    '.footer { text-align: center; margin-top: 40px; color: #888; font-size: 11px; }' +
    '@media print { body { padding: 20px; } }' +
    '</style>' +
    '</head>' +
    '<body>' +
    '<div class="header">' +
    '<h1>⛽ CONTROLE DE DIESEL</h1>' +
    '<p><strong>Granja Vitta</strong> | Período: ' + periodLabel + '</p>' +
    '<p>Gerado em: ' + new Date().toLocaleString('pt-BR') + '</p>' +
    '</div>' +
    '<div class="stats-grid">' +
    '<div class="stat-box"><h3>Total Entradas</h3><div class="value">' + (stats.totalEntrada || 0).toLocaleString('pt-BR') + ' L</div></div>' +
    '<div class="stat-box"><h3>Total Saídas</h3><div class="value">' + (stats.totalSaida || 0).toLocaleString('pt-BR') + ' L</div></div>' +
    '<div class="stat-box"><h3>Saldo Atual</h3><div class="value">' + (stats.saldoAtual || 0).toLocaleString('pt-BR') + ' L</div></div>' +
    '<div class="stat-box"><h3>Média Diária</h3><div class="value">' + (stats.mediaDiaria || 0).toFixed(1) + ' L</div></div>' +
    '</div>' +
    '<h2 style="color:#1a1a2e;font-size:16px;margin-bottom:15px;">HISTÓRICO DE MOVIMENTAÇÕES</h2>' +
    '<table>' +
    '<thead><tr><th>Data</th><th>Tipo</th><th>Quantidade</th><th>Motivo</th><th>Registrado por</th><th>Observações</th></tr></thead>' +
    '<tbody>';
  
  sorted.forEach(function(r) {
    var dateStr = r.record_date ? r.record_date.split('T')[0] : '';
    var parts = dateStr.split('-');
    var formattedDate = parts.length === 3 ? (parts[2] + '/' + parts[1] + '/' + parts[0]) : dateStr;
    var badgeClass = r.record_type === 'entrada' ? 'badge-entrada' : 'badge-saida';
    var typeLabel = r.record_type === 'entrada' ? 'Entrada' : 'Saída';
    
    content += '<tr>';
    content += '<td>' + formattedDate + '</td>';
    content += '<td><span class="badge ' + badgeClass + '">' + typeLabel + '</span></td>';
    content += '<td><strong>' + (parseFloat(r.quantity) || 0).toLocaleString('pt-BR') + ' L</strong></td>';
    content += '<td>' + (r.reason || '-') + '</td>';
    content += '<td>' + (r.recorded_by_name || '-') + '</td>';
    content += '<td>' + (r.notes || '-') + '</td>';
    content += '</tr>';
  });
  
  content += '</tbody></table>' +
    '<div class="footer">' +
    '<p>Relatório gerado automaticamente pelo Sistema Icarus | Granja Vitta</p>' +
    '<p>Desenvolvido por Guilherme Braga | © 2025</p>' +
    '</div>' +
    '</body></html>';
  
  var printWindow = window.open('', '_blank');
  printWindow.document.write(content);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(function() {
    printWindow.print();
  }, 500);
  
  showNotification('Relatório PDF gerado!', 'success');
}

// Exportar relatório de diesel Excel/CSV
function exportDieselReportExcel() {
  var records = state.dieselRecords || [];
  
  if (records.length === 0) {
    showNotification('Nenhum dado para exportar', 'warning');
    return;
  }
  
  // Ordenar registros por data
  var sorted = records.slice().sort(function(a, b) {
    return (a.record_date || '').localeCompare(b.record_date || '');
  });
  
  // Calcular totais
  var totalEntrada = 0, totalSaida = 0;
  sorted.forEach(function(r) {
    var qty = parseFloat(r.quantity) || 0;
    if (r.record_type === 'entrada') totalEntrada += qty;
    else totalSaida += qty;
  });
  
  // Cabeçalhos
  var headers = ['DATA', 'DIA', 'TIPO', 'QUANTIDADE (L)', 'MOTIVO', 'REGISTRADO POR', 'OBSERVACOES'];
  
  // Nomes dos dias
  var diasSemana = ['DOMINGO', 'SEGUNDA', 'TERCA', 'QUARTA', 'QUINTA', 'SEXTA', 'SABADO'];
  
  // Linhas de dados
  var rows = sorted.map(function(r) {
    var dateStr = r.record_date ? r.record_date.split('T')[0] : '';
    var parts = dateStr.split('-');
    var formattedDate = parts.length === 3 ? (parts[2] + '/' + parts[1] + '/' + parts[0]) : dateStr;
    
    // Calcular dia da semana
    var dayOfWeek = '';
    if (parts.length === 3) {
      var d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]), 12, 0, 0);
      dayOfWeek = diasSemana[d.getDay()];
    }
    
    var typeLabel = r.record_type === 'entrada' ? 'ENTRADA' : 'SAIDA';
    
    return [
      formattedDate,
      dayOfWeek,
      typeLabel,
      (parseFloat(r.quantity) || 0).toFixed(1),
      r.reason || '-',
      r.recorded_by_name || '-',
      r.notes || '-'
    ].join(';');
  });
  
  // Adicionar linha de totais
  rows.push('');
  rows.push('RESUMO;;;;');
  rows.push('Total Entradas;;;' + totalEntrada.toFixed(1) + ' L;;');
  rows.push('Total Saidas;;;' + totalSaida.toFixed(1) + ' L;;');
  rows.push('Saldo;;;' + (totalEntrada - totalSaida).toFixed(1) + ' L;;');
  
  var csv = headers.join(';') + '\n' + rows.join('\n');
  
  // Criar blob e baixar
  var blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  var link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  
  var today = new Date();
  var fileName = 'CONTROLE_DIESEL_GRANJA_VITTA_' + 
    today.getFullYear() + '-' + 
    String(today.getMonth() + 1).padStart(2, '0') + '-' + 
    String(today.getDate()).padStart(2, '0') + '.csv';
  link.download = fileName;
  link.click();
  
  showNotification('Planilha exportada: ' + sorted.length + ' registros', 'success');
  
  // Gerar relatório HTML interativo também
  generateDieselInteractiveReport(sorted, totalEntrada, totalSaida);
}

// Gerar relatório HTML interativo para Diesel
function generateDieselInteractiveReport(records, totalEntrada, totalSaida) {
  var diasSemana = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  
  // Agrupar por mês para gráfico
  var monthlyData = {};
  records.forEach(function(r) {
    var dateStr = r.record_date ? r.record_date.split('T')[0] : '';
    var parts = dateStr.split('-');
    if (parts.length === 3) {
      var monthKey = parts[0] + '-' + parts[1];
      if (!monthlyData[monthKey]) monthlyData[monthKey] = { entrada: 0, saida: 0 };
      var qty = parseFloat(r.quantity) || 0;
      if (r.record_type === 'entrada') monthlyData[monthKey].entrada += qty;
      else monthlyData[monthKey].saida += qty;
    }
  });
  
  // Gerar linhas da tabela
  var tableRows = records.map(function(r) {
    var dateStr = r.record_date ? r.record_date.split('T')[0] : '';
    var parts = dateStr.split('-');
    var formattedDate = parts.length === 3 ? (parts[2] + '/' + parts[1] + '/' + parts[0]) : dateStr;
    var dayOfWeek = '';
    if (parts.length === 3) {
      var d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]), 12, 0, 0);
      dayOfWeek = diasSemana[d.getDay()];
    }
    var typeClass = r.record_type === 'entrada' ? 'entrada' : 'saida';
    var typeLabel = r.record_type === 'entrada' ? '⬆ ENTRADA' : '⬇ SAÍDA';
    
    return '<tr>' +
      '<td>' + formattedDate + '</td>' +
      '<td>' + dayOfWeek + '</td>' +
      '<td class="' + typeClass + '">' + typeLabel + '</td>' +
      '<td class="qty">' + (parseFloat(r.quantity) || 0).toFixed(1) + ' L</td>' +
      '<td>' + (r.reason || '-') + '</td>' +
      '<td>' + (r.recorded_by_name || '-') + '</td>' +
      '</tr>';
  }).join('');
  
  var saldo = totalEntrada - totalSaida;
  var saldoClass = saldo >= 0 ? 'positive' : 'negative';
  
  var html = '<!DOCTYPE html>' +
    '<html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    '<title>Relatório de Diesel - Granja Vitta</title>' +
    '<style>' +
    '* { margin: 0; padding: 0; box-sizing: border-box; }' +
    'body { font-family: "Segoe UI", system-ui, sans-serif; background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); color: #e2e8f0; min-height: 100vh; padding: 40px 20px; }' +
    '.container { max-width: 1200px; margin: 0 auto; }' +
    '.header { text-align: center; margin-bottom: 40px; padding: 40px; background: linear-gradient(135deg, rgba(245, 158, 11, 0.1) 0%, rgba(217, 119, 6, 0.05) 100%); border: 1px solid rgba(245, 158, 11, 0.2); border-radius: 20px; }' +
    '.header h1 { font-size: 2.5rem; background: linear-gradient(135deg, #fbbf24, #f59e0b); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 8px; }' +
    '.header p { color: #94a3b8; font-size: 1.1rem; }' +
    '.stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 40px; }' +
    '.stat-card { background: rgba(30, 41, 59, 0.8); border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 24px; text-align: center; }' +
    '.stat-card.entrada { border-color: rgba(34, 197, 94, 0.3); background: linear-gradient(180deg, rgba(34, 197, 94, 0.1) 0%, transparent 100%); }' +
    '.stat-card.saida { border-color: rgba(239, 68, 68, 0.3); background: linear-gradient(180deg, rgba(239, 68, 68, 0.1) 0%, transparent 100%); }' +
    '.stat-card.saldo { border-color: rgba(59, 130, 246, 0.3); background: linear-gradient(180deg, rgba(59, 130, 246, 0.1) 0%, transparent 100%); }' +
    '.stat-value { font-size: 2rem; font-weight: 700; margin-bottom: 8px; }' +
    '.stat-card.entrada .stat-value { color: #4ade80; }' +
    '.stat-card.saida .stat-value { color: #f87171; }' +
    '.stat-card.saldo .stat-value { color: #60a5fa; }' +
    '.stat-label { color: #94a3b8; font-size: 0.9rem; text-transform: uppercase; letter-spacing: 1px; }' +
    '.table-card { background: rgba(30, 41, 59, 0.8); border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; overflow: hidden; }' +
    '.table-header { padding: 20px 24px; border-bottom: 1px solid rgba(255,255,255,0.1); display: flex; justify-content: space-between; align-items: center; }' +
    '.table-header h2 { font-size: 1.2rem; display: flex; align-items: center; gap: 10px; }' +
    'table { width: 100%; border-collapse: collapse; }' +
    'th { background: rgba(0,0,0,0.3); padding: 14px 16px; text-align: left; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 1px; color: #94a3b8; }' +
    'td { padding: 14px 16px; border-bottom: 1px solid rgba(255,255,255,0.05); }' +
    'tr:hover { background: rgba(255,255,255,0.02); }' +
    '.entrada { color: #4ade80; font-weight: 600; }' +
    '.saida { color: #f87171; font-weight: 600; }' +
    '.qty { font-weight: 700; font-size: 1.1rem; }' +
    '.footer { margin-top: 40px; text-align: center; color: #64748b; font-size: 0.85rem; }' +
    '@media print { body { background: white; color: #1e293b; } .stat-card, .table-card { border: 1px solid #e2e8f0; background: white; } }' +
    '</style></head><body>' +
    '<div class="container">' +
    '<div class="header">' +
    '<h1>🛢️ Controle de Diesel</h1>' +
    '<p>Granja Vitta • Relatório gerado em ' + new Date().toLocaleDateString('pt-BR') + '</p>' +
    '</div>' +
    '<div class="stats-grid">' +
    '<div class="stat-card entrada"><div class="stat-value">+' + totalEntrada.toFixed(1) + ' L</div><div class="stat-label">Total Entradas</div></div>' +
    '<div class="stat-card saida"><div class="stat-value">-' + totalSaida.toFixed(1) + ' L</div><div class="stat-label">Total Saídas</div></div>' +
    '<div class="stat-card saldo"><div class="stat-value">' + saldo.toFixed(1) + ' L</div><div class="stat-label">Saldo</div></div>' +
    '<div class="stat-card"><div class="stat-value">' + records.length + '</div><div class="stat-label">Registros</div></div>' +
    '</div>' +
    '<div class="table-card">' +
    '<div class="table-header"><h2>📋 Histórico de Movimentações</h2></div>' +
    '<table><thead><tr><th>Data</th><th>Dia</th><th>Tipo</th><th>Quantidade</th><th>Motivo</th><th>Responsável</th></tr></thead>' +
    '<tbody>' + tableRows + '</tbody></table>' +
    '</div>' +
    '<div class="footer"><p>Sistema ICARUS • Desenvolvido por Guilherme Braga</p></div>' +
    '</div></body></html>';
  
  // Abrir em nova aba
  var newWindow = window.open('', '_blank');
  if (newWindow) {
    newWindow.document.write(html);
    newWindow.document.close();
  }
}

// ========== FIM CONTROLE DE DIESEL ==========

// ========== CONTROLE DE GERADOR ==========

// Função auxiliar para obter datas do período (gerador)
function getGeneratorPeriodDates() {
  var now = new Date();
  var year = now.getFullYear();
  var month = now.getMonth();
  var day = now.getDate();
  var endDate = new Date(year, month, day, 23, 59, 59);
  var startDate;
  
  if (state.generatorPeriod === 'today') {
    startDate = new Date(year, month, day, 0, 0, 0);
  } else if (state.generatorPeriod === 'week') {
    startDate = new Date(year, month, day - 7, 0, 0, 0);
  } else {
    // month
    startDate = new Date(year, month - 1, day, 0, 0, 0);
  }
  
  var startStr = startDate.getFullYear() + '-' + 
    String(startDate.getMonth() + 1).padStart(2, '0') + '-' + 
    String(startDate.getDate()).padStart(2, '0');
  var endStr = endDate.getFullYear() + '-' + 
    String(endDate.getMonth() + 1).padStart(2, '0') + '-' + 
    String(endDate.getDate()).padStart(2, '0');
  
  return { startDate: startStr, endDate: endStr };
}

// Carregar controle de gerador
async function loadGeneratorControl() {
  try {
    // Verificar permissão de edição e esconder/mostrar formulário
    var formSection = document.getElementById('generator-form-section');
    if (formSection) {
      formSection.classList.toggle('hidden', !state.canEditGerador);
    }
    
    // Definir data de hoje no input
    var now = new Date();
    var year = now.getFullYear();
    var month = String(now.getMonth() + 1).padStart(2, '0');
    var day = String(now.getDate()).padStart(2, '0');
    var today = year + '-' + month + '-' + day;
    
    var dateInput = document.getElementById('generator-date');
    if (dateInput) dateInput.value = today;
    
    // Carregar dados
    await Promise.all([
      loadGeneratorRecords(),
      loadGeneratorStats()
    ]);
    
    // Renderizar
    renderGeneratorStats();
    renderGeneratorHistory();
    
  } catch (error) {
    console.error('Erro ao carregar controle de gerador:', error);
  }
}

// Carregar registros de gerador
async function loadGeneratorRecords() {
  try {
    var dates = getGeneratorPeriodDates();
    var url = API_URL + '/generator-records?startDate=' + dates.startDate + '&endDate=' + dates.endDate;
    
    var response = await fetch(url, {
      headers: { 'Authorization': 'Bearer ' + state.token }
    });
    
    var data = await response.json();
    if (data.ok) {
      state.generatorRecords = data.records || [];
    }
  } catch (error) {
    console.error('Erro ao carregar registros de gerador:', error);
  }
}

// Carregar estatísticas de gerador
async function loadGeneratorStats() {
  try {
    var dates = getGeneratorPeriodDates();
    var url = API_URL + '/generator-records/stats?startDate=' + dates.startDate + '&endDate=' + dates.endDate;
    
    var response = await fetch(url, {
      headers: { 'Authorization': 'Bearer ' + state.token }
    });
    
    var data = await response.json();
    if (data.ok) {
      state.generatorStats = data.stats;
    }
  } catch (error) {
    console.error('Erro ao carregar estatísticas de gerador:', error);
  }
}

// Alternar período do gerador
async function setGeneratorPeriod(period) {
  state.generatorPeriod = period;
  
  // Atualizar botões
  document.querySelectorAll('.generator-filter-btn').forEach(function(btn) {
    btn.classList.remove('active');
  });
  var activeBtn = document.getElementById('generator-filter-' + period);
  if (activeBtn) activeBtn.classList.add('active');
  
  // Recarregar dados
  await Promise.all([
    loadGeneratorRecords(),
    loadGeneratorStats()
  ]);
  
  renderGeneratorStats();
  renderGeneratorHistory();
}

// Renderizar estatísticas do gerador
function renderGeneratorStats() {
  var stats = state.generatorStats || {};
  
  var elTotalHours = document.getElementById('generator-total-hours');
  var elFuelUsed = document.getElementById('generator-fuel-used');
  var elAvgConsumption = document.getElementById('generator-avg-consumption');
  var elMaintenanceCount = document.getElementById('generator-maintenance-count');
  
  if (elTotalHours) {
    var hours = stats.totalHours || 0;
    var hoursInt = Math.floor(hours);
    var minutes = Math.round((hours - hoursInt) * 60);
    elTotalHours.textContent = hoursInt + 'h ' + minutes + 'min';
  }
  if (elFuelUsed) {
    elFuelUsed.textContent = (stats.fuelUsed || 0).toLocaleString('pt-BR') + ' L';
  }
  if (elAvgConsumption) {
    elAvgConsumption.textContent = (stats.avgConsumption || 0).toFixed(1) + ' L/h';
  }
  if (elMaintenanceCount) {
    elMaintenanceCount.textContent = (stats.maintenanceCount || 0).toString();
  }
}

// Renderizar histórico do gerador
function renderGeneratorHistory() {
  var tbody = document.getElementById('generator-history-tbody');
  if (!tbody) return;
  
  var records = state.generatorRecords || [];
  
  // Ordenar por data (mais recente primeiro)
  var sorted = records.slice().sort(function(a, b) {
    return (b.record_date || '').localeCompare(a.record_date || '');
  });
  
  if (sorted.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#888;">Nenhum registro encontrado</td></tr>';
    return;
  }
  
  var html = '';
  sorted.forEach(function(r) {
    var dateStr = r.record_date ? r.record_date.split('T')[0] : '';
    var parts = dateStr.split('-');
    var formattedDate = parts.length === 3 ? (parts[2] + '/' + parts[1] + '/' + parts[0]) : dateStr;
    
    var typeLabel = '';
    var typeClass = '';
    if (r.record_type === 'ligado') {
      typeLabel = 'Ligado';
      typeClass = 'badge-success';
    } else if (r.record_type === 'desligado') {
      typeLabel = 'Desligado';
      typeClass = 'badge-warning';
    } else if (r.record_type === 'manutencao') {
      typeLabel = 'Manutenção';
      typeClass = 'badge-info';
    } else {
      typeLabel = r.record_type || '-';
      typeClass = 'badge-secondary';
    }
    
    var runTime = r.run_time ? (parseFloat(r.run_time).toFixed(1) + 'h') : '-';
    var fuelUsed = r.fuel_used ? (parseFloat(r.fuel_used).toLocaleString('pt-BR') + ' L') : '-';
    
    html += '<tr>';
    html += '<td>' + formattedDate + '</td>';
    html += '<td><span class="badge ' + typeClass + '">' + typeLabel + '</span></td>';
    html += '<td>' + runTime + '</td>';
    html += '<td>' + fuelUsed + '</td>';
    html += '<td>' + (r.recorded_by_name || '-') + '</td>';
    html += '<td>' + (r.notes || '-') + '</td>';
    html += '</tr>';
  });
  
  tbody.innerHTML = html;
}

// Salvar registro de gerador
async function saveGeneratorRecord() {
  try {
    // Verificar permissão de edição
    if (!state.canEditGerador) {
      showNotification('Você não tem permissão para registrar eventos do gerador', 'error');
      return;
    }
    
    var dateInput = document.getElementById('generator-date');
    var typeInput = document.getElementById('generator-type');
    var timeInput = document.getElementById('generator-time');
    var fuelInput = document.getElementById('generator-fuel');
    var notesInput = document.getElementById('generator-notes');
    
    var recordDate = dateInput ? dateInput.value : '';
    var recordType = typeInput ? typeInput.value : '';
    var runTime = timeInput ? parseFloat(timeInput.value) || 0 : 0;
    var fuelUsed = fuelInput ? parseFloat(fuelInput.value) || 0 : 0;
    var notes = notesInput ? notesInput.value : '';
    
    if (!recordDate || !recordType) {
      showNotification('Preencha os campos obrigatórios (data e tipo)', 'error');
      return;
    }
    
    var response = await fetch(API_URL + '/generator-records', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + state.token
      },
      body: JSON.stringify({
        record_date: recordDate,
        record_type: recordType,
        run_time: runTime,
        fuel_used: fuelUsed,
        notes: notes
      })
    });
    
    var data = await response.json();
    
    if (data.ok) {
      showNotification('Registro de gerador salvo com sucesso!', 'success');
      
      // Limpar formulário
      if (timeInput) timeInput.value = '';
      if (fuelInput) fuelInput.value = '';
      if (notesInput) notesInput.value = '';
      
      // Recarregar dados
      await loadGeneratorControl();
    } else {
      showNotification(data.error || 'Erro ao salvar registro', 'error');
    }
  } catch (error) {
    console.error('Erro ao salvar registro de gerador:', error);
    showNotification('Erro ao salvar registro', 'error');
  }
}

// Exportar relatório de gerador PDF
function exportGeneratorReportPDF() {
  var records = state.generatorRecords || [];
  var stats = state.generatorStats || {};
  
  if (records.length === 0) {
    showNotification('Nenhum dado para exportar', 'warning');
    return;
  }
  
  // Ordenar registros
  var sorted = records.slice().sort(function(a, b) {
    return (a.record_date || '').localeCompare(b.record_date || '');
  });
  
  var periodLabel = state.generatorPeriod === 'today' ? 'Hoje' : 
                    state.generatorPeriod === 'week' ? 'Última Semana' : 'Último Mês';
  
  var totalHours = stats.totalHours || 0;
  var hoursInt = Math.floor(totalHours);
  var minutes = Math.round((totalHours - hoursInt) * 60);
  var hoursFormatted = hoursInt + 'h ' + minutes + 'min';
  
  var content = '<!DOCTYPE html>' +
    '<html lang="pt-BR">' +
    '<head>' +
    '<meta charset="UTF-8">' +
    '<title>Relatório de Gerador - Granja Vitta</title>' +
    '<style>' +
    'body { font-family: Arial, sans-serif; padding: 40px; background: #fff; color: #333; }' +
    '.header { text-align: center; margin-bottom: 30px; border-bottom: 3px solid #d4af37; padding-bottom: 20px; }' +
    '.header h1 { color: #1a1a2e; margin-bottom: 5px; }' +
    '.header p { color: #666; }' +
    '.stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 30px; }' +
    '.stat-box { background: #f8f9fa; border: 1px solid #ddd; border-radius: 8px; padding: 15px; text-align: center; }' +
    '.stat-box h3 { font-size: 12px; color: #666; margin-bottom: 5px; }' +
    '.stat-box .value { font-size: 24px; font-weight: bold; color: #1a1a2e; }' +
    'table { width: 100%; border-collapse: collapse; margin-top: 20px; }' +
    'th { background: #1a1a2e; color: #d4af37; padding: 12px; text-align: left; font-size: 12px; }' +
    'td { padding: 10px; border-bottom: 1px solid #eee; font-size: 13px; }' +
    'tr:nth-child(even) { background: #f8f9fa; }' +
    '.badge { padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; }' +
    '.badge-ligado { background: #d4edda; color: #155724; }' +
    '.badge-desligado { background: #fff3cd; color: #856404; }' +
    '.badge-manutencao { background: #cce5ff; color: #004085; }' +
    '.footer { text-align: center; margin-top: 40px; color: #888; font-size: 11px; }' +
    '@media print { body { padding: 20px; } }' +
    '</style>' +
    '</head>' +
    '<body>' +
    '<div class="header">' +
    '<h1>🔌 CONTROLE DE GERADOR</h1>' +
    '<p><strong>Granja Vitta</strong> | Período: ' + periodLabel + '</p>' +
    '<p>Gerado em: ' + new Date().toLocaleString('pt-BR') + '</p>' +
    '</div>' +
    '<div class="stats-grid">' +
    '<div class="stat-box"><h3>Total de Horas</h3><div class="value">' + hoursFormatted + '</div></div>' +
    '<div class="stat-box"><h3>Combustível Usado</h3><div class="value">' + (stats.fuelUsed || 0).toLocaleString('pt-BR') + ' L</div></div>' +
    '<div class="stat-box"><h3>Consumo Médio</h3><div class="value">' + (stats.avgConsumption || 0).toFixed(1) + ' L/h</div></div>' +
    '<div class="stat-box"><h3>Manutenções</h3><div class="value">' + (stats.maintenanceCount || 0) + '</div></div>' +
    '</div>' +
    '<h2 style="color:#1a1a2e;font-size:16px;margin-bottom:15px;">HISTÓRICO DE OPERAÇÕES</h2>' +
    '<table>' +
    '<thead><tr><th>Data</th><th>Tipo</th><th>Tempo</th><th>Combustível</th><th>Registrado por</th><th>Observações</th></tr></thead>' +
    '<tbody>';
  
  sorted.forEach(function(r) {
    var dateStr = r.record_date ? r.record_date.split('T')[0] : '';
    var parts = dateStr.split('-');
    var formattedDate = parts.length === 3 ? (parts[2] + '/' + parts[1] + '/' + parts[0]) : dateStr;
    
    var typeLabel = '';
    var badgeClass = '';
    if (r.record_type === 'ligado') {
      typeLabel = 'Ligado';
      badgeClass = 'badge-ligado';
    } else if (r.record_type === 'desligado') {
      typeLabel = 'Desligado';
      badgeClass = 'badge-desligado';
    } else if (r.record_type === 'manutencao') {
      typeLabel = 'Manutenção';
      badgeClass = 'badge-manutencao';
    } else {
      typeLabel = r.record_type || '-';
      badgeClass = '';
    }
    
    var runTime = r.run_time ? (parseFloat(r.run_time).toFixed(1) + 'h') : '-';
    var fuelUsed = r.fuel_used ? (parseFloat(r.fuel_used).toLocaleString('pt-BR') + ' L') : '-';
    
    content += '<tr>';
    content += '<td>' + formattedDate + '</td>';
    content += '<td><span class="badge ' + badgeClass + '">' + typeLabel + '</span></td>';
    content += '<td>' + runTime + '</td>';
    content += '<td>' + fuelUsed + '</td>';
    content += '<td>' + (r.recorded_by_name || '-') + '</td>';
    content += '<td>' + (r.notes || '-') + '</td>';
    content += '</tr>';
  });
  
  content += '</tbody></table>' +
    '<div class="footer">' +
    '<p>Relatório gerado automaticamente pelo Sistema Icarus | Granja Vitta</p>' +
    '<p>Desenvolvido por Guilherme Braga | © 2025</p>' +
    '</div>' +
    '</body></html>';
  
  var printWindow = window.open('', '_blank');
  printWindow.document.write(content);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(function() {
    printWindow.print();
  }, 500);
  
  showNotification('Relatório PDF gerado!', 'success');
}

// ========== FIM CONTROLE DE GERADOR ==========

// ========== EXPORTAÇÃO DASHBOARD ==========

function exportDashboardReport() {
  const orders = state.orders || [];
  const checklists = state.checklists || [];
  const filter = state.dashboardFilter || 'daily';
  
  // Usar o mesmo range do dashboard
  const { startDate, endDate } = getDateRange();
  let periodLabel = 'Hoje';
  
  if (state.dashboardMonth) {
    const [year, month] = state.dashboardMonth.split('-');
    const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    periodLabel = monthNames[parseInt(month) - 1] + ' ' + year;
  } else if (filter === 'weekly') {
    periodLabel = 'Esta Semana';
  } else if (filter === 'monthly') {
    periodLabel = 'Este Mês';
  }
  
  const filteredOrders = orders.filter(o => {
    const created = new Date(o.created_at);
    return created >= startDate && created <= endDate;
  });
  
  // Status corretos do sistema
  const pending = filteredOrders.filter(o => o.status === 'pending').length;
  const inProgress = filteredOrders.filter(o => o.status === 'in_progress' || o.status === 'paused').length;
  const completed = filteredOrders.filter(o => o.status === 'completed').length;
  const total = filteredOrders.length;
  const aproveitamento = total > 0 ? Math.round((completed / total) * 100) : 0;
  
  // Dados de checklists para o relatório
  const checklistStats = {
    total: checklists.length,
    automaticos: checklists.filter(c => c.auto_complete).length,
    manuais: checklists.filter(c => !c.auto_complete).length,
    lista: checklists.map(c => ({
      name: c.name,
      sector: c.sector || 'N/A',
      items: (c.items || []).length,
      auto: c.auto_complete ? 'Sim' : 'Não',
      frequency: c.auto_complete ? (c.frequency_days === 1 ? 'Diário' : c.frequency_days === 2 ? 'Dia sim/não' : `A cada ${c.frequency_days} dias`) : 'Manual'
    }))
  };
  
  // Agrupar por executor - usando assigned_users que é o formato correto
  const byExecutor = {};
  filteredOrders.forEach(o => {
    // Pegar nomes dos usuários atribuídos
    if (o.assigned_users && Array.isArray(o.assigned_users) && o.assigned_users.length > 0) {
      o.assigned_users.forEach(user => {
        const name = user.name || user.username || 'Não atribuído';
        if (!byExecutor[name]) byExecutor[name] = { total: 0, completed: 0, minutes: 0 };
        byExecutor[name].total++;
        if (o.status === 'completed') byExecutor[name].completed++;
        if (o.worked_minutes) byExecutor[name].minutes += o.worked_minutes;
      });
    } else {
      const name = 'Não atribuído';
      if (!byExecutor[name]) byExecutor[name] = { total: 0, completed: 0, minutes: 0 };
      byExecutor[name].total++;
      if (o.status === 'completed') byExecutor[name].completed++;
    }
  });
  
  // Agrupar por setor - usando 'sector' que é o campo correto
  const bySetor = {};
  filteredOrders.forEach(o => {
    const setor = o.sector || 'Não especificado';
    if (!bySetor[setor]) bySetor[setor] = 0;
    bySetor[setor]++;
  });

  // SVG Icons inline
  const svgIcons = {
    chart: '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/></svg>',
    trending: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>',
    pie: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg>',
    users: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    printer: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>',
    target: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>',
    clock: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    check: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    alert: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
    activity: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
    zap: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
    award: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg>'
  };

  const htmlContent = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Relatório Dashboard - Granja Vitta</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
    
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    body { 
      font-family: 'Inter', system-ui, sans-serif; 
      background: #050510;
      color: #fff;
      min-height: 100vh;
      padding: 40px;
      position: relative;
      overflow-x: hidden;
    }
    
    /* Animated background grid */
    body::before {
      content: '';
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: 
        linear-gradient(90deg, rgba(139, 92, 246, 0.03) 1px, transparent 1px),
        linear-gradient(rgba(139, 92, 246, 0.03) 1px, transparent 1px);
      background-size: 60px 60px;
      pointer-events: none;
      z-index: 0;
    }
    
    /* Glowing orbs */
    body::after {
      content: '';
      position: fixed;
      top: 20%;
      left: 10%;
      width: 400px;
      height: 400px;
      background: radial-gradient(circle, rgba(139, 92, 246, 0.15) 0%, transparent 70%);
      border-radius: 50%;
      pointer-events: none;
      z-index: 0;
      animation: float 20s ease-in-out infinite;
    }
    
    @keyframes float {
      0%, 100% { transform: translate(0, 0) scale(1); }
      33% { transform: translate(50px, -30px) scale(1.1); }
      66% { transform: translate(-30px, 20px) scale(0.9); }
    }
    
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.7; }
    }
    
    @keyframes slideUp {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }
    
    @keyframes glow {
      0%, 100% { box-shadow: 0 0 20px rgba(212, 175, 55, 0.3); }
      50% { box-shadow: 0 0 40px rgba(212, 175, 55, 0.5), 0 0 60px rgba(139, 92, 246, 0.2); }
    }
    
    .container { 
      max-width: 1400px; 
      margin: 0 auto; 
      position: relative; 
      z-index: 1;
      animation: slideUp 0.8s ease-out;
    }
    
    .header {
      text-align: center;
      padding: 50px 40px;
      background: linear-gradient(135deg, rgba(139, 92, 246, 0.1) 0%, rgba(212, 175, 55, 0.05) 50%, rgba(6, 182, 212, 0.1) 100%);
      border: 1px solid rgba(139, 92, 246, 0.2);
      border-radius: 24px;
      margin-bottom: 30px;
      position: relative;
      overflow: hidden;
      backdrop-filter: blur(10px);
    }
    
    .header::before {
      content: '';
      position: absolute;
      top: -50%;
      left: -50%;
      width: 200%;
      height: 200%;
      background: linear-gradient(45deg, transparent, rgba(212, 175, 55, 0.03), transparent);
      animation: shimmer 3s linear infinite;
    }
    
    @keyframes shimmer {
      0% { transform: translateX(-100%) rotate(45deg); }
      100% { transform: translateX(100%) rotate(45deg); }
    }
    
    .header-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 80px;
      height: 80px;
      background: linear-gradient(135deg, rgba(212, 175, 55, 0.2) 0%, rgba(139, 92, 246, 0.2) 100%);
      border-radius: 20px;
      margin-bottom: 20px;
      color: #d4af37;
      animation: glow 3s ease-in-out infinite;
    }
    
    .header h1 { 
      font-size: 32px; 
      font-weight: 800;
      background: linear-gradient(135deg, #d4af37 0%, #f0d060 50%, #d4af37 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      margin-bottom: 12px; 
      letter-spacing: 2px;
      text-transform: uppercase;
      word-wrap: break-word;
    }
    
    .header .subtitle { 
      color: #a5b4fc; 
      font-size: 16px;
      font-weight: 500;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
    }
    
    .header .subtitle .dot {
      width: 6px;
      height: 6px;
      background: #8b5cf6;
      border-radius: 50%;
    }
    
    .header .period-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin-top: 16px;
      padding: 10px 20px;
      background: rgba(139, 92, 246, 0.15);
      border: 1px solid rgba(139, 92, 246, 0.3);
      border-radius: 30px;
      font-size: 13px;
      color: #c4b5fd;
    }
    
    .stats-grid { 
      display: grid; 
      grid-template-columns: repeat(5, 1fr); 
      gap: 16px; 
      margin-bottom: 30px; 
    }
    
    .stat-card {
      background: linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 20px;
      padding: 28px;
      text-align: center;
      position: relative;
      overflow: hidden;
      transition: all 0.3s ease;
      backdrop-filter: blur(10px);
    }
    
    .stat-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      background: linear-gradient(90deg, var(--accent-color, #8b5cf6), transparent);
      opacity: 0;
      transition: opacity 0.3s;
    }
    
    .stat-card:hover::before { opacity: 1; }
    
    .stat-card.gold { 
      border-color: rgba(212, 175, 55, 0.3);
      --accent-color: #d4af37;
    }
    .stat-card.gold::before { opacity: 1; background: linear-gradient(90deg, #d4af37, #f0d060, transparent); }
    
    .stat-card .stat-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 48px;
      height: 48px;
      background: rgba(255,255,255,0.05);
      border-radius: 14px;
      margin-bottom: 16px;
      color: var(--icon-color, #8b5cf6);
    }
    
    .stat-card h3 { 
      font-size: 11px; 
      color: #64748b; 
      text-transform: uppercase; 
      letter-spacing: 1.5px; 
      margin-bottom: 12px;
      font-weight: 600;
    }
    
    .stat-card .value { 
      font-size: 48px; 
      font-weight: 800;
      line-height: 1;
      margin-bottom: 8px;
    }
    
    .stat-card .value.gold { color: #d4af37; }
    .stat-card .value.green { color: #10b981; }
    .stat-card .value.blue { color: #3b82f6; }
    .stat-card .value.orange { color: #f59e0b; }
    .stat-card .value.purple { color: #8b5cf6; }
    
    .stat-card .trend {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      padding: 4px 10px;
      border-radius: 20px;
      font-weight: 500;
    }
    
    .stat-card .trend.up { background: rgba(16, 185, 129, 0.15); color: #10b981; }
    .stat-card .trend.down { background: rgba(239, 68, 68, 0.15); color: #ef4444; }
    
    .charts-row { 
      display: grid; 
      grid-template-columns: 1fr 1fr; 
      gap: 20px; 
      margin-bottom: 30px; 
    }
    
    .chart-card {
      background: linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.01) 100%);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 20px;
      padding: 28px;
      backdrop-filter: blur(10px);
    }
    
    .chart-card .card-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 24px;
    }
    
    .chart-card .card-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 42px;
      height: 42px;
      background: linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(139, 92, 246, 0.1));
      border-radius: 12px;
      color: #a78bfa;
    }
    
    .chart-card h3 { 
      color: #fff; 
      font-size: 17px;
      font-weight: 600;
    }
    
    .table-card {
      background: linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.01) 100%);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 20px;
      overflow: hidden;
      backdrop-filter: blur(10px);
    }
    
    .table-card .card-header { 
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 24px 28px; 
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    
    .table-card .card-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 42px;
      height: 42px;
      background: linear-gradient(135deg, rgba(6, 182, 212, 0.2), rgba(6, 182, 212, 0.1));
      border-radius: 12px;
      color: #22d3ee;
    }
    
    .table-card h3 {
      font-size: 17px;
      font-weight: 600;
    }
    
    table { width: 100%; border-collapse: collapse; }
    
    th { 
      background: rgba(139, 92, 246, 0.08); 
      color: #a78bfa; 
      padding: 16px 20px; 
      text-align: left; 
      font-size: 11px; 
      text-transform: uppercase;
      letter-spacing: 1px;
      font-weight: 600;
    }
    
    td { 
      padding: 18px 20px; 
      border-bottom: 1px solid rgba(255,255,255,0.04); 
      font-size: 14px;
    }
    
    tr:last-child td { border-bottom: none; }
    tr:hover { background: rgba(139, 92, 246, 0.03); }
    
    .progress-bar { 
      height: 10px; 
      background: rgba(255,255,255,0.08); 
      border-radius: 10px; 
      overflow: hidden;
      position: relative;
    }
    
    .progress-fill { 
      height: 100%; 
      background: linear-gradient(90deg, #8b5cf6, #d4af37); 
      border-radius: 10px;
      position: relative;
      transition: width 0.5s ease;
    }
    
    .progress-fill::after {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent);
      animation: shimmer 2s linear infinite;
    }
    
    .footer { 
      text-align: center; 
      padding: 40px;
      margin-top: 20px;
    }
    
    .print-btn { 
      display: inline-flex;
      align-items: center;
      gap: 10px;
      background: linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%);
      color: #fff; 
      border: none; 
      padding: 16px 36px; 
      font-size: 15px; 
      font-weight: 600; 
      border-radius: 14px; 
      cursor: pointer; 
      margin-bottom: 24px;
      transition: all 0.3s ease;
      box-shadow: 0 4px 20px rgba(139, 92, 246, 0.3);
    }
    
    .print-btn:hover { 
      transform: translateY(-2px);
      box-shadow: 0 8px 30px rgba(139, 92, 246, 0.4);
    }
    
    .footer-text {
      color: #64748b;
      font-size: 13px;
    }
    
    .icarus-brand {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 16px;
      margin: 24px auto;
      padding: 20px 32px;
      background: linear-gradient(135deg, rgba(212, 175, 55, 0.08) 0%, rgba(139, 92, 246, 0.08) 100%);
      border: 1px solid rgba(212, 175, 55, 0.2);
      border-radius: 16px;
      max-width: 400px;
    }
    
    .icarus-logo {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 56px;
      height: 56px;
      background: linear-gradient(135deg, rgba(212, 175, 55, 0.2), rgba(212, 175, 55, 0.1));
      border-radius: 14px;
      border: 1px solid rgba(212, 175, 55, 0.3);
    }
    
    .icarus-info {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 4px;
    }
    
    .icarus-title {
      font-size: 16px;
      font-weight: 700;
      color: #d4af37;
      letter-spacing: 2px;
    }
    
    .icarus-subtitle {
      font-size: 11px;
      color: #8b8b9e;
    }
    
    .icarus-contact {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      font-weight: 600;
      color: #22d3ee;
      margin-top: 4px;
    }
    
    .footer-brand {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin-top: 12px;
      color: #94a3b8;
      font-size: 12px;
    }
    
    @media print { 
      .print-btn { display: none !important; }
      body { 
        background: #fff !important; 
        color: #1e293b !important;
        padding: 15px !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      body::before, body::after { display: none; }
      .container { max-width: 100% !important; }
      .stats-grid { 
        grid-template-columns: repeat(5, 1fr) !important; 
        gap: 10px !important;
      }
      .stat-card { padding: 16px !important; }
      .stat-card .value { font-size: 28px !important; }
      .stat-card, .chart-card, .table-card { 
        border-color: #e2e8f0 !important;
        background: #fff !important;
        box-shadow: 0 1px 3px rgba(0,0,0,0.1) !important;
        break-inside: avoid;
      }
      .charts-row { gap: 15px !important; }
      .chart-card { padding: 20px !important; }
      .stat-card .value { color: #1e293b !important; }
      .stat-card.gold .value, .value.gold { color: #b8942e !important; }
      .value.green { color: #059669 !important; }
      .value.blue { color: #2563eb !important; }
      .value.orange { color: #d97706 !important; }
      .value.purple { color: #7c3aed !important; }
      .header { 
        background: linear-gradient(135deg, #f8fafc, #f1f5f9) !important; 
        border-color: #d4af37 !important;
        padding: 30px !important;
        margin-bottom: 20px !important;
      }
      .header h1 { 
        -webkit-text-fill-color: #b8942e !important;
        color: #b8942e !important;
        font-size: 32px !important;
      }
      th { background: #f1f5f9 !important; color: #6366f1 !important; }
      td { border-color: #e2e8f0 !important; padding: 12px 16px !important; }
      .table-card { margin-bottom: 20px !important; }
      .footer { padding: 20px !important; }
      .icarus-brand { 
        background: #f8f8f8 !important; 
        border-color: #d4af37 !important;
      }
      .icarus-title { color: #b8942e !important; }
      .icarus-contact { color: #0891b2 !important; }
      @page { 
        size: A4 landscape; 
        margin: 8mm; 
      }
    }
    
    /* MOBILE RESPONSIVE */
    @media (max-width: 768px) {
      body { padding: 16px; }
      .container { max-width: 100%; }
      .header { padding: 24px 16px; border-radius: 16px; margin-bottom: 16px; }
      .header-icon { width: 56px; height: 56px; }
      .header h1 { font-size: 22px; letter-spacing: 1px; }
      .header .subtitle { font-size: 13px; flex-wrap: wrap; }
      .header .period-badge { font-size: 11px; padding: 8px 14px; flex-wrap: wrap; justify-content: center; }
      .stats-grid { grid-template-columns: repeat(2, 1fr); gap: 10px; }
      .stat-card { padding: 16px; border-radius: 14px; }
      .stat-card .stat-icon { width: 36px; height: 36px; margin-bottom: 10px; }
      .stat-card h3 { font-size: 9px; margin-bottom: 6px; }
      .stat-card .value { font-size: 28px; }
      .charts-row { grid-template-columns: 1fr; gap: 12px; }
      .chart-card { padding: 16px; border-radius: 14px; }
      .chart-card .card-header { margin-bottom: 16px; }
      .chart-card h3 { font-size: 14px; }
      .table-card { border-radius: 14px; }
      .table-card .card-header { padding: 16px; }
      .table-card h3 { font-size: 14px; }
      th { padding: 10px 12px; font-size: 10px; }
      td { padding: 12px; font-size: 12px; }
      .footer { padding: 24px 16px; }
      .print-btn { padding: 14px 24px; font-size: 14px; width: 100%; justify-content: center; }
      .icarus-brand { flex-direction: column; text-align: center; padding: 16px; gap: 12px; }
      .icarus-info { align-items: center; }
      .footer-brand { flex-direction: column; gap: 4px; }
    }
    
    @media (max-width: 480px) {
      .header h1 { font-size: 18px; }
      .stats-grid { grid-template-columns: repeat(2, 1fr); }
      .stat-card .value { font-size: 24px; }
      .stat-card:nth-child(5) { grid-column: span 2; }
    }
    
    @media print { body { background: #fff !important; color: #1e293b !important; } .stat-card { background: #fff !important; border-color: #e2e8f0 !important; } .stat-card .value { color: #1e293b !important; } }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="header-icon">
        ${svgIcons.chart}
      </div>
      <h1>Relatório Dashboard</h1>
      <p class="subtitle">
        <strong>Granja Vitta</strong>
        <span class="dot"></span>
        Sistema Icarus
      </p>
      <div class="period-badge">
        ${svgIcons.clock}
        <span>${periodLabel}</span>
        <span style="opacity: 0.5;">•</span>
        <span>Gerado em ${new Date().toLocaleString('pt-BR')}</span>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-card gold">
        <div class="stat-icon" style="--icon-color: #d4af37;">
          ${svgIcons.target}
        </div>
        <h3>Total de OS</h3>
        <div class="value gold">${total}</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="--icon-color: #f59e0b;">
          ${svgIcons.alert}
        </div>
        <h3>Pendentes</h3>
        <div class="value orange">${pending}</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="--icon-color: #3b82f6;">
          ${svgIcons.activity}
        </div>
        <h3>Em Andamento</h3>
        <div class="value blue">${inProgress}</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="--icon-color: #10b981;">
          ${svgIcons.check}
        </div>
        <h3>Concluídas</h3>
        <div class="value green">${completed}</div>
      </div>
      <div class="stat-card gold">
        <div class="stat-icon" style="--icon-color: #8b5cf6;">
          ${svgIcons.zap}
        </div>
        <h3>Aproveitamento</h3>
        <div class="value purple">${aproveitamento}%</div>
      </div>
    </div>

    <div class="charts-row">
      <div class="chart-card">
        <div class="card-header">
          <div class="card-icon">
            ${svgIcons.trending}
          </div>
          <h3>Desempenho por Executor</h3>
        </div>
        <canvas id="executorChart"></canvas>
      </div>
      <div class="chart-card">
        <div class="card-header">
          <div class="card-icon">
            ${svgIcons.pie}
          </div>
          <h3>Ordens por Setor</h3>
        </div>
        <canvas id="setorChart"></canvas>
      </div>
    </div>

    <div class="table-card">
      <div class="card-header">
        <div class="card-icon">
          ${svgIcons.users}
        </div>
        <h3>Produtividade da Equipe</h3>
      </div>
      <table>
        <thead>
          <tr>
            <th>Executor</th>
            <th>Total</th>
            <th>Concluídas</th>
            <th>Aproveitamento</th>
            <th>Progresso</th>
          </tr>
        </thead>
        <tbody>
          ${Object.entries(byExecutor).map(([name, data]) => {
            const perc = data.total > 0 ? Math.round((data.completed / data.total) * 100) : 0;
            return `
              <tr>
                <td><strong>${name}</strong></td>
                <td>${data.total}</td>
                <td>${data.completed}</td>
                <td><span style="color: ${perc >= 70 ? '#10b981' : perc >= 40 ? '#f59e0b' : '#ef4444'}; font-weight: 600;">${perc}%</span></td>
                <td>
                  <div class="progress-bar">
                    <div class="progress-fill" style="width: ${perc}%"></div>
                  </div>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>

    <!-- SEÇÃO CHECKLISTS -->
    <div class="table-card" style="margin-top: 20px;">
      <div class="card-header">
        <div class="card-icon" style="background: linear-gradient(135deg, #059669, #10b981);">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 11l3 3L22 4"></path>
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
          </svg>
        </div>
        <h3>Checklists de Manutenção</h3>
      </div>
      <div class="stats-row" style="display: flex; gap: 15px; margin: 15px 0; flex-wrap: wrap;">
        <div style="flex: 1; min-width: 120px; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 10px; padding: 15px; text-align: center;">
          <div style="font-size: 24px; font-weight: 700; color: #10b981;">${checklistStats.total}</div>
          <div style="font-size: 11px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px;">Total Checklists</div>
        </div>
        <div style="flex: 1; min-width: 120px; background: rgba(139, 92, 246, 0.1); border: 1px solid rgba(139, 92, 246, 0.3); border-radius: 10px; padding: 15px; text-align: center;">
          <div style="font-size: 24px; font-weight: 700; color: #8b5cf6;">${checklistStats.automaticos}</div>
          <div style="font-size: 11px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px;">Automáticos</div>
        </div>
        <div style="flex: 1; min-width: 120px; background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 10px; padding: 15px; text-align: center;">
          <div style="font-size: 24px; font-weight: 700; color: #3b82f6;">${checklistStats.manuais}</div>
          <div style="font-size: 11px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px;">Manuais</div>
        </div>
      </div>
      ${checklistStats.lista.length > 0 ? `
      <table>
        <thead>
          <tr>
            <th>Checklist</th>
            <th>Setor</th>
            <th>Itens</th>
            <th>Automático</th>
            <th>Frequência</th>
          </tr>
        </thead>
        <tbody>
          ${checklistStats.lista.map(c => `
            <tr>
              <td><strong>${c.name}</strong></td>
              <td>${c.sector}</td>
              <td style="text-align: center;">${c.items}</td>
              <td style="text-align: center;">
                <span style="display: inline-block; padding: 3px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; ${c.auto === 'Sim' ? 'background: rgba(16, 185, 129, 0.2); color: #10b981;' : 'background: rgba(100, 116, 139, 0.2); color: #94a3b8;'}">${c.auto}</span>
              </td>
              <td style="text-align: center; font-size: 12px; color: #94a3b8;">${c.frequency}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      ` : '<p style="text-align: center; color: #64748b; padding: 20px;">Nenhum checklist cadastrado</p>'}
    </div>

    <div class="footer">
      <button onclick="window.print()" class="print-btn">
        ${svgIcons.printer}
        Imprimir / Salvar PDF
      </button>
      <p class="footer-text">Relatório gerado automaticamente pelo Sistema Icarus</p>
      <div class="icarus-brand">
        <div class="icarus-logo">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#d4af37" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
          </svg>
        </div>
        <div class="icarus-info">
          <span class="icarus-title">ICARUS SYSTEM</span>
          <span class="icarus-subtitle">Sistema Inteligente de Gestão de Manutenção</span>
          <span class="icarus-contact">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            +55 62 98493-0056
          </span>
        </div>
      </div>
      <p class="footer-brand">
        ${svgIcons.award}
        Desenvolvido por Guilherme Braga • © 2025
      </p>
    </div>
  </div>

  <script>
    const executorData = ${JSON.stringify(byExecutor)};
    const setorData = ${JSON.stringify(bySetor)};

    // Gráfico de Executores - Estilo futurista
    new Chart(document.getElementById('executorChart'), {
      type: 'bar',
      data: {
        labels: Object.keys(executorData),
        datasets: [{
          label: 'Concluídas',
          data: Object.values(executorData).map(d => d.completed),
          backgroundColor: 'rgba(16, 185, 129, 0.8)',
          borderColor: '#10b981',
          borderWidth: 0,
          borderRadius: 8,
          borderSkipped: false
        }, {
          label: 'Total',
          data: Object.values(executorData).map(d => d.total),
          backgroundColor: 'rgba(139, 92, 246, 0.6)',
          borderColor: '#8b5cf6',
          borderWidth: 0,
          borderRadius: 8,
          borderSkipped: false
        }]
      },
      options: {
        responsive: true,
        plugins: { 
          legend: { 
            labels: { 
              color: '#94a3b8',
              padding: 20,
              font: { family: 'Inter', size: 12 }
            } 
          } 
        },
        scales: {
          x: { 
            ticks: { color: '#64748b', font: { family: 'Inter' } }, 
            grid: { color: 'rgba(255,255,255,0.03)' } 
          },
          y: { 
            ticks: { color: '#64748b', font: { family: 'Inter' } }, 
            grid: { color: 'rgba(255,255,255,0.03)' } 
          }
        }
      }
    });

    // Gráfico de Setores - Estilo futurista
    new Chart(document.getElementById('setorChart'), {
      type: 'doughnut',
      data: {
        labels: Object.keys(setorData),
        datasets: [{
          data: Object.values(setorData),
          backgroundColor: [
            'rgba(139, 92, 246, 0.8)',
            'rgba(6, 182, 212, 0.8)',
            'rgba(16, 185, 129, 0.8)',
            'rgba(245, 158, 11, 0.8)',
            'rgba(212, 175, 55, 0.8)',
            'rgba(239, 68, 68, 0.8)',
            'rgba(236, 72, 153, 0.8)'
          ],
          borderWidth: 0,
          hoverOffset: 8
        }]
      },
      options: {
        responsive: true,
        cutout: '65%',
        plugins: { 
          legend: { 
            position: 'bottom', 
            labels: { 
              color: '#94a3b8',
              padding: 16,
              font: { family: 'Inter', size: 12 },
              usePointStyle: true,
              pointStyle: 'circle'
            } 
          } 
        }
      }
    });
  </script>
</body>
</html>`;

  // Dados estruturados para PDF no servidor
  const dashboardReportData = {
    title: 'Relatório Dashboard - Granja Vitta',
    type: 'table',
    content: {
      headers: ['Métrica', 'Valor'],
      rows: [
        ['Total de Ordens', total],
        ['Concluídas', completed],
        ['Em Andamento', inProgress],
        ['Pendentes', pending],
        ['Taxa de Conclusão', aproveitamento + '%'],
        ['Período', periodLabel]
      ]
    }
  };

  // Renderizar diretamente na página (funciona em APK, mobile e desktop)
  showReportInPage(htmlContent, 'Relatório Dashboard', 'Relatório do Dashboard gerado!', dashboardReportData);
}

// ========== EXPORTAÇÃO ALMOXARIFADO ==========

function exportAlmoxarifadoReport() {
  const items = state.inventory || [];
  
  if (items.length === 0) {
    showNotification('Nenhum item no almoxarifado', 'warning');
    return;
  }
  
  // Agrupar por categoria
  const byCategory = {};
  items.forEach(item => {
    const cat = item.category || 'Sem categoria';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(item);
  });
  
  // Calcular estatísticas
  const totalItems = items.length;
  const lowStock = items.filter(i => i.quantity <= (i.min_stock || 5)).length;
  const totalValue = items.reduce((sum, i) => sum + (i.quantity * (i.unit_cost || 0)), 0);
  const categories = Object.keys(byCategory).length;

  // Gerar relatório HTML interativo (SEM CSV automático)
  const dateStr = new Date().toLocaleString('pt-BR');
  const totalValueStr = 'R$ ' + totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
  const categoryDataJson = JSON.stringify(Object.fromEntries(Object.entries(byCategory).map(function(entry) { return [entry[0], entry[1].length]; })));
  const sortedItems = items.slice().sort(function(a, b) { return b.quantity - a.quantity; });
  const topItemsJson = JSON.stringify(sortedItems.slice(0, 10).map(function(i) { return { name: i.name, qty: i.quantity }; }));
  
  let tableRows = '';
  items.forEach(function(i) {
    const isLow = i.quantity <= (i.min_stock || 5);
    tableRows += '<tr class="' + (isLow ? 'low-stock' : '') + '">' +
      '<td>' + (i.sku || '-') + '</td>' +
      '<td><strong>' + i.name + '</strong></td>' +
      '<td>' + (i.category || '-') + '</td>' +
      '<td>' + (i.brand || '-') + '</td>' +
      '<td>' + i.quantity + '</td>' +
      '<td>' + (i.unit || '-') + '</td>' +
      '<td>' + (i.location || '-') + '</td>' +
      '<td style="color:' + (isLow ? '#ef4444' : '#10b981') + ';font-weight:600">' + (isLow ? 'Baixo' : 'OK') + '</td>' +
      '</tr>';
  });

  const htmlContent = '<!DOCTYPE html>' +
    '<html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Relatório Almoxarifado - Granja Vitta</title>' +
    '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">' +
    '<script src="https://cdn.jsdelivr.net/npm/chart.js"><\/script>' +
    '<style>' +
    '*{margin:0;padding:0;box-sizing:border-box}' +
    'body{font-family:"Inter",system-ui,sans-serif;background:#050510;color:#fff;min-height:100vh;padding:20px}' +
    'body::before{content:"";position:fixed;top:0;left:0;right:0;bottom:0;background:linear-gradient(90deg,rgba(139,92,246,0.03) 1px,transparent 1px),linear-gradient(rgba(139,92,246,0.03) 1px,transparent 1px);background-size:50px 50px;pointer-events:none;z-index:0}' +
    '.container{max-width:1400px;margin:0 auto;position:relative;z-index:1}' +
    '.header{text-align:center;padding:32px 24px;background:linear-gradient(135deg,rgba(139,92,246,0.1) 0%,rgba(139,92,246,0.02) 100%);border:1px solid rgba(139,92,246,0.2);border-radius:20px;margin-bottom:24px}' +
    '.header-icon{display:inline-flex;align-items:center;justify-content:center;width:56px;height:56px;background:linear-gradient(135deg,rgba(139,92,246,0.2),rgba(139,92,246,0.1));border:1px solid rgba(139,92,246,0.3);border-radius:14px;margin-bottom:12px;color:#a78bfa}' +
    '.header h1{font-size:24px;font-weight:800;color:#a78bfa;margin-bottom:6px;letter-spacing:1px}' +
    '.header p{color:#94a3b8;font-size:13px}' +
    '.stats-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px}' +
    '.stat-card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:20px;text-align:center}' +
    '.stat-card.gold{border-color:rgba(212,175,55,0.3);background:linear-gradient(180deg,rgba(212,175,55,0.08) 0%,transparent 100%)}' +
    '.stat-card.danger{border-color:rgba(239,68,68,0.3);background:linear-gradient(180deg,rgba(239,68,68,0.08) 0%,transparent 100%)}' +
    '.stat-card h3{font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;font-weight:600}' +
    '.stat-card .value{font-size:32px;font-weight:800}' +
    '.stat-card .value.gold{color:#d4af37}' +
    '.stat-card .value.red{color:#ef4444}' +
    '.stat-card .value.green{color:#10b981}' +
    '.charts-row{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px}' +
    '.chart-card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:20px}' +
    '.chart-card .chart-header{display:flex;align-items:center;gap:10px;margin-bottom:16px}' +
    '.chart-card .chart-header svg{color:#a78bfa}' +
    '.chart-card h3{font-size:14px;font-weight:600}' +
    '.table-card{background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.08);border-radius:16px;overflow:hidden;margin-bottom:24px}' +
    '.table-header{display:flex;align-items:center;gap:10px;padding:16px 20px;border-bottom:1px solid rgba(255,255,255,0.06)}' +
    '.table-header svg{color:#a78bfa}' +
    '.table-header h3{font-size:14px;font-weight:600}' +
    '.table-scroll{overflow-x:auto}' +
    'table{width:100%;border-collapse:collapse;min-width:700px}' +
    'th{background:rgba(139,92,246,0.1);color:#a78bfa;padding:12px 14px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:600}' +
    'td{padding:12px 14px;border-bottom:1px solid rgba(255,255,255,0.04);font-size:13px}' +
    'tr:hover{background:rgba(139,92,246,0.03)}' +
    '.low-stock{background:rgba(239,68,68,0.08)}' +
    '.footer{text-align:center;padding:24px}' +
    '.icarus-brand{display:flex;align-items:center;justify-content:center;gap:14px;margin:0 auto 16px;padding:16px 24px;background:linear-gradient(135deg,rgba(212,175,55,0.08),rgba(139,92,246,0.08));border:1px solid rgba(212,175,55,0.2);border-radius:14px;max-width:360px}' +
    '.icarus-logo{display:flex;align-items:center;justify-content:center;width:44px;height:44px;background:linear-gradient(135deg,rgba(212,175,55,0.2),rgba(212,175,55,0.1));border-radius:10px;border:1px solid rgba(212,175,55,0.3)}' +
    '.icarus-info{display:flex;flex-direction:column;align-items:flex-start;gap:2px}' +
    '.icarus-title{font-size:13px;font-weight:700;color:#d4af37;letter-spacing:2px}' +
    '.icarus-subtitle{font-size:9px;color:#8b8b9e}' +
    '.icarus-contact{display:flex;align-items:center;gap:4px;font-size:11px;font-weight:600;color:#22d3ee}' +
    '.footer-text{color:#64748b;font-size:11px}' +
    '@media(max-width:768px){.stats-grid{grid-template-columns:repeat(2,1fr)}.stat-card .value{font-size:24px}.charts-row{grid-template-columns:1fr}.header h1{font-size:18px}.icarus-brand{flex-direction:column;text-align:center}.icarus-info{align-items:center}}' +
    '@media print{body{background:#fff!important;color:#1e293b!important;padding:15px!important}body::before{display:none}.stat-card,.chart-card,.table-card{background:#fff!important;border-color:#e2e8f0!important}.stat-card .value{color:#1e293b!important}.value.gold{color:#b8942e!important}th{background:#f1f5f9!important;color:#6366f1!important}td{border-color:#e2e8f0!important}.icarus-brand{background:#f8f8f8!important}@page{size:A4 landscape;margin:8mm}}' +
    '</style></head><body>' +
    '<div class="container">' +
    '<div class="header">' +
    '<div class="header-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg></div>' +
    '<h1>RELATÓRIO ALMOXARIFADO</h1>' +
    '<p><strong>Granja Vitta</strong> — Sistema Icarus</p>' +
    '<p style="margin-top:8px;font-size:12px;color:#64748b">Gerado em ' + dateStr + '</p>' +
    '</div>' +
    '<div class="stats-grid">' +
    '<div class="stat-card gold"><h3>Total de Itens</h3><div class="value gold">' + totalItems + '</div></div>' +
    '<div class="stat-card danger"><h3>Estoque Baixo</h3><div class="value red">' + lowStock + '</div></div>' +
    '<div class="stat-card"><h3>Categorias</h3><div class="value green">' + categories + '</div></div>' +
    '<div class="stat-card gold"><h3>Valor Total</h3><div class="value gold" style="font-size:24px">' + totalValueStr + '</div></div>' +
    '</div>' +
    '<div class="charts-row">' +
    '<div class="chart-card"><div class="chart-header"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.21 15.89A10 10 0 118 2.83"/><path d="M22 12A10 10 0 0012 2v10z"/></svg><h3>Itens por Categoria</h3></div><canvas id="categoryChart"></canvas></div>' +
    '<div class="chart-card"><div class="chart-header"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/></svg><h3>Top 10 - Maior Quantidade</h3></div><canvas id="topItemsChart"></canvas></div>' +
    '</div>' +
    '<div class="table-card"><div class="table-header"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg><h3>Lista Completa de Itens</h3></div>' +
    '<div class="table-scroll"><table><thead><tr><th>SKU</th><th>Nome</th><th>Categoria</th><th>Marca</th><th>Qtd</th><th>Unidade</th><th>Localização</th><th>Status</th></tr></thead>' +
    '<tbody>' + tableRows + '</tbody></table></div></div>' +
    '<div class="footer">' +
    '<div class="icarus-brand">' +
    '<div class="icarus-logo"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#d4af37" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></div>' +
    '<div class="icarus-info"><span class="icarus-title">ICARUS SYSTEM</span><span class="icarus-subtitle">Sistema de Gestão</span><span class="icarus-contact"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>+55 62 98493-0056</span></div>' +
    '</div>' +
    '<p class="footer-text">Desenvolvido por Guilherme Braga © 2025</p>' +
    '</div></div>' +
    '<script>' +
    'var categoryData = ' + categoryDataJson + ';' +
    'var topItems = ' + topItemsJson + ';' +
    'new Chart(document.getElementById("categoryChart"), { type: "doughnut", data: { labels: Object.keys(categoryData), datasets: [{ data: Object.values(categoryData), backgroundColor: ["#8b5cf6","#06b6d4","#10b981","#f59e0b","#d4af37","#ef4444","#ec4899","#3b82f6"], borderWidth: 0 }] }, options: { cutout: "60%", plugins: { legend: { position: "bottom", labels: { color: "#94a3b8", padding: 12, font: { size: 11 } } } } } });' +
    'new Chart(document.getElementById("topItemsChart"), { type: "bar", data: { labels: topItems.map(function(i) { return i.name.substring(0, 18); }), datasets: [{ label: "Quantidade", data: topItems.map(function(i) { return i.qty; }), backgroundColor: "rgba(139, 92, 246, 0.7)", borderRadius: 6 }] }, options: { indexAxis: "y", plugins: { legend: { display: false } }, scales: { x: { ticks: { color: "#64748b" }, grid: { color: "rgba(255,255,255,0.03)" } }, y: { ticks: { color: "#94a3b8" }, grid: { color: "rgba(255,255,255,0.03)" } } } } });' +
    '<\/script></body></html>';

  // Dados estruturados para PDF no servidor
  const almoxarifadoReportData = {
    title: 'Relatório Almoxarifado - Granja Vitta',
    type: 'table',
    content: {
      headers: ['SKU', 'Nome', 'Categoria', 'Quantidade', 'Unidade'],
      rows: inventory.slice(0, 50).map(function(item) {
        return [
          item.sku || '-',
          item.name || '-',
          item.category || '-',
          item.quantity || 0,
          item.unit || '-'
        ];
      })
    }
  };

  // Renderizar diretamente na página (funciona em APK, mobile e desktop)
  showReportInPage(htmlContent, 'Relatório Almoxarifado', 'Relatório do Almoxarifado gerado!', almoxarifadoReportData);
}

// ========== TAREFAS ADITIVAS ==========

async function loadAditiva() {
  try {
    // Esconder/mostrar botão de nova tarefa baseado em permissão
    var headerActions = document.querySelector('#aditiva-view .water-header-actions');
    if (headerActions) {
      headerActions.style.display = state.canEditAditiva ? 'flex' : 'none';
    }
    
    await Promise.all([
      loadAdditiveTasks(),
      loadAdditiveStats()
    ]);
    
    renderAdditiveTasks();
    renderAdditiveStats();
    
  } catch (error) {
    console.error('Erro ao carregar aditiva:', error);
  }
}

async function loadAdditiveTasks() {
  try {
    var archived = state.additiveFilter === 'archived' ? 'true' : 'false';
    var url = API_URL + '/additive-tasks?archived=' + archived;
    
    var response = await fetch(url, {
      headers: { 'Authorization': 'Bearer ' + state.token }
    });
    
    var data = await response.json();
    if (data.ok) {
      state.additiveTasks = data.tasks || [];
    }
  } catch (error) {
    console.error('Erro ao carregar tarefas aditivas:', error);
  }
}

async function loadAdditiveStats() {
  try {
    var response = await fetch(API_URL + '/additive-tasks/stats', {
      headers: { 'Authorization': 'Bearer ' + state.token }
    });
    
    var data = await response.json();
    if (data.ok) {
      state.additiveStats = data.stats;
    }
  } catch (error) {
    console.error('Erro ao carregar stats aditiva:', error);
  }
}

function renderAdditiveStats() {
  var stats = state.additiveStats || {};
  
  var elPending = document.getElementById('aditiva-pending');
  var elProgress = document.getElementById('aditiva-progress');
  var elCompleted = document.getElementById('aditiva-completed');
  
  if (elPending) elPending.textContent = stats.pending || 0;
  if (elProgress) elProgress.textContent = stats.in_progress || 0;
  if (elCompleted) elCompleted.textContent = stats.completed_month || 0;
}

function renderAdditiveTasks() {
  var container = document.getElementById('aditiva-tasks-list');
  if (!container) return;
  
  var tasks = state.additiveTasks || [];
  
  if (tasks.length === 0) {
    container.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--text-secondary);">Nenhuma tarefa encontrada</div>';
    return;
  }
  
  var html = '';
  tasks.forEach(function(task) {
    var dateStr = task.created_at ? new Date(task.created_at).toLocaleDateString('pt-BR') : '';
    var statusLabel = task.status === 'pending' ? 'Pendente' : task.status === 'in_progress' ? 'Em Andamento' : 'Concluída';
    var priorityLabel = task.priority === 'high' ? 'Alta' : task.priority === 'medium' ? 'Média' : 'Baixa';
    var executedByName = task.executed_by_name || '';
    
    html += '<div class="aditiva-task-item" onclick="openAdditiveTask(\'' + task.id + '\')">' +
      '<div class="task-priority-indicator ' + task.priority + '"></div>' +
      '<div class="task-info">' +
        '<div class="task-title">' + escapeHtml(task.title) + '</div>' +
        '<div class="task-meta">' +
          '<span>' + (task.sector || 'Sem setor') + '</span>' +
          '<span>•</span>' +
          '<span>' + dateStr + '</span>' +
          '<span>•</span>' +
          '<span>' + priorityLabel + '</span>' +
          (executedByName ? '<span>•</span><span style="color: var(--success);">✓ ' + escapeHtml(executedByName) + '</span>' : '') +
        '</div>' +
      '</div>' +
      '<span class="task-status-badge ' + task.status + '">' + statusLabel + '</span>' +
      (state.canEditAditiva && task.status !== 'completed' ? '<div class="task-actions">' +
        '<button class="task-action-btn" onclick="event.stopPropagation(); showCompleteAdditiveModal(\'' + task.id + '\')" title="Concluir">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>' +
        '</button>' +
      '</div>' : '') +
    '</div>';
  });
  
  container.innerHTML = html;
}

// Modal para concluir tarefa aditiva com seleção de executor
function showCompleteAdditiveModal(taskId) {
  state.currentAdditiveTaskId = taskId;
  
  // Carregar usuários para o select
  var select = document.getElementById('additive-executor');
  if (select && state.users) {
    var options = '<option value="">Selecione quem executou...</option>';
    state.users.forEach(function(user) {
      options += '<option value="' + user.id + '">' + escapeHtml(user.name) + '</option>';
    });
    select.innerHTML = options;
  }
  
  document.getElementById('complete-additive-modal').classList.add('active');
}

function closeCompleteAdditiveModal() {
  document.getElementById('complete-additive-modal').classList.remove('active');
  state.currentAdditiveTaskId = null;
}

async function confirmCompleteAdditive() {
  var executorId = document.getElementById('additive-executor').value;
  
  if (!executorId) {
    showNotification('Selecione quem executou a tarefa', 'error');
    return;
  }
  
  try {
    var response = await fetch(API_URL + '/additive-tasks/' + state.currentAdditiveTaskId, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + state.token
      },
      body: JSON.stringify({ status: 'completed', executed_by_id: executorId })
    });
    
    var data = await response.json();
    
    if (data.ok) {
      state.additiveTasks = data.tasks || [];
      closeCompleteAdditiveModal();
      renderAdditiveTasks();
      loadAdditiveStats().then(renderAdditiveStats);
      showNotification('Tarefa concluída!', 'success');
    } else {
      showNotification(data.error || 'Erro ao concluir', 'error');
    }
  } catch (error) {
    console.error('Erro ao concluir tarefa:', error);
    showNotification('Erro ao concluir', 'error');
  }
}

function setAditivaFilter(filter) {
  state.additiveFilter = filter;
  
  document.querySelectorAll('.aditiva-filter-btn').forEach(function(btn) {
    btn.classList.remove('active');
  });
  event.target.closest('.aditiva-filter-btn').classList.add('active');
  
  loadAdditiveTasks().then(function() {
    renderAdditiveTasks();
  });
}

function showNewAdditiveModal() {
  if (!state.canEditAditiva) {
    showNotification('Você não tem permissão para criar tarefas', 'error');
    return;
  }
  
  // Limpar formulário
  document.getElementById('additive-title').value = '';
  document.getElementById('additive-description').value = '';
  document.getElementById('additive-sector').value = '';
  document.getElementById('additive-priority').value = 'medium';
  document.getElementById('additive-notes').value = '';
  
  document.getElementById('additive-modal').classList.add('active');
}


function closeAdditiveModal() {
  document.getElementById('additive-modal').classList.remove('active');
}

async function saveAdditiveTask() {
  try {
    var title = document.getElementById('additive-title').value.trim();
    var description = document.getElementById('additive-description').value.trim();
    var sector = document.getElementById('additive-sector').value;
    var priority = document.getElementById('additive-priority').value;
    var notes = document.getElementById('additive-notes').value.trim();
    
    if (!title) {
      showNotification('Título é obrigatório', 'error');
      return;
    }
    
    var response = await fetch(API_URL + '/additive-tasks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + state.token
      },
      body: JSON.stringify({ title: title, description: description, sector: sector, priority: priority, notes: notes })
    });
    
    var data = await response.json();
    
    if (data.ok) {
      state.additiveTasks = data.tasks || [];
      closeAdditiveModal();
      renderAdditiveTasks();
      loadAdditiveStats().then(renderAdditiveStats);
      showNotification('Tarefa criada com sucesso!', 'success');
    } else {
      showNotification(data.error || 'Erro ao criar tarefa', 'error');
    }
  } catch (error) {
    console.error('Erro ao salvar tarefa:', error);
    showNotification('Erro ao salvar tarefa', 'error');
  }
}

async function updateTaskStatus(taskId, status) {
  try {
    var response = await fetch(API_URL + '/additive-tasks/' + taskId, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + state.token
      },
      body: JSON.stringify({ status: status })
    });
    
    var data = await response.json();
    
    if (data.ok) {
      state.additiveTasks = data.tasks || [];
      renderAdditiveTasks();
      loadAdditiveStats().then(renderAdditiveStats);
      showNotification('Tarefa atualizada!', 'success');
    } else {
      showNotification(data.error || 'Erro ao atualizar', 'error');
    }
  } catch (error) {
    console.error('Erro ao atualizar tarefa:', error);
    showNotification('Erro ao atualizar', 'error');
  }
}

function openAdditiveTask(taskId) {
  var task = state.additiveTasks.find(function(t) { return t.id === taskId; });
  if (!task) return;
  
  // Por enquanto só mostra detalhes via alert, pode expandir para modal de edição
  var msg = 'Título: ' + task.title + '\n' +
    'Descrição: ' + (task.description || '-') + '\n' +
    'Setor: ' + (task.sector || '-') + '\n' +
    'Status: ' + task.status + '\n' +
    'Prioridade: ' + task.priority + '\n' +
    'Criado por: ' + (task.created_by_name || '-') + '\n' +
    (task.executed_by_name ? 'Executado por: ' + task.executed_by_name : '');
  alert(msg);
}

// ========== LAVANDERIA V2 - Multi-Cliente ==========

// Configuração dos 4 clientes
var LAV2_CLIENTS = {
  marajoara: {
    id: 'client_marajoara',
    name: 'Marajoara',
    color: '#f472b6',
    pricePerPiece: 3.50,
    markingPrice: 0,
    billingCycle: 'biweekly', // 16 dias
    cycleStartDay: 4,
    fields: [
      { key: 'camisa_masc', label: 'Camisa Masc.' },
      { key: 'calca_masc', label: 'Calça Masc.' },
      { key: 'camisa_fem', label: 'Camisa Fem.' },
      { key: 'calca_fem', label: 'Calça Fem.' }
    ]
  },
  loyola: {
    id: 'client_loyola',
    name: 'Loyola',
    color: '#a855f7',
    pricePerPiece: 3.00,
    markingPrice: 2.00,
    billingCycle: 'monthly',
    fields: [
      { key: 'pecas', label: 'Peças' },
      { key: 'marcacoes', label: 'Marcações', isMarking: true }
    ]
  },
  suplemento: {
    id: 'client_suplemento',
    name: 'Suplemento',
    color: '#3b82f6',
    pricePerPiece: 3.00,
    markingPrice: 0,
    billingCycle: 'monthly',
    fields: [
      { key: 'camisa', label: 'Camisa' },
      { key: 'calca', label: 'Calça' }
    ]
  },
  vitta: {
    id: 'client_vitta',
    name: 'Vitta',
    color: '#f59e0b',
    pricePerPiece: 4.50,
    markingPrice: 2.00,
    billingCycle: 'monthly',
    fields: [
      { key: 'camisa', label: 'Camisa' },
      { key: 'calca', label: 'Calça' },
      { key: 'marcacoes', label: 'Marcações', isMarking: true }
    ]
  }
};

// Estado do Lavanderia V2
var lav2State = {
  currentClient: 'marajoara',
  entries: [],
  stats: {},
  period: null,
  initialized: false
};

async function loadLavanderia() {
  try {
    console.log('[Lavanderia V2] Carregando...');
    
    // Definir data de hoje APENAS se o campo estiver vazio
    var dateInput = document.getElementById('lav2-entry-date');
    if (dateInput && !dateInput.value) {
      var now = new Date();
      var today = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
      dateInput.value = today;
    }
    
    // Só selecionar marajoara na primeira vez (se não tiver cliente selecionado)
    if (!lav2State.initialized) {
      selectLav2Client('marajoara');
      lav2State.initialized = true;
    } else {
      // Apenas recarregar dados do cliente atual
      selectLav2Client(lav2State.currentClient);
    }
    
    // Carregar dados de todos os clientes para o lucro geral
    await loadLav2AllStats();
    
    console.log('[Lavanderia V2] Carregado!');
  } catch (error) {
    console.error('[Lavanderia V2] Erro:', error);
  }
}

function selectLav2Client(clientId) {
  var previousClient = lav2State.currentClient;
  lav2State.currentClient = clientId;
  var client = LAV2_CLIENTS[clientId];
  if (!client) return;
  
  // Atualizar sidebar visual (antigo)
  document.querySelectorAll('.lav2-client-card').forEach(function(card) {
    card.classList.remove('active');
  });
  var activeCard = document.getElementById('lav2-client-' + clientId);
  if (activeCard) activeCard.classList.add('active');
  
  // Atualizar tabs visual (novo design)
  document.querySelectorAll('.lav2-tab').forEach(function(tab) {
    tab.classList.remove('active');
  });
  var activeTab = document.getElementById('lav2-tab-' + clientId);
  if (activeTab) activeTab.classList.add('active');
  
  // Atualizar título do form
  var titleEl = document.getElementById('lav2-entry-title');
  if (titleEl) titleEl.textContent = 'Novo Lançamento';
  
  // Renderizar campos dinâmicos APENAS se o cliente mudou
  if (previousClient !== clientId) {
    renderLav2FormFields(client);
  }
  
  // Calcular e mostrar período
  updateLav2PeriodDisplay(client);
  
  // Carregar entries do cliente
  loadLav2ClientEntries(clientId);
}

function renderLav2FormFields(client) {
  var container = document.getElementById('lav2-form-fields');
  if (!container) return;
  
  var html = '';
  client.fields.forEach(function(field) {
    var markingNote = field.isMarking ? '<small style="color:#a855f7;font-size:9px;display:block;">+R$ ' + client.markingPrice.toFixed(2) + '</small>' : '';
    html += '<div class="lav2-field">' +
      '<label>' + field.label + markingNote + '</label>' +
      '<input type="number" id="lav2-field-' + field.key + '" value="0" min="0" inputmode="numeric" oninput="updateLav2Total()" onfocus="if(this.value===\'0\')this.value=\'\'" onblur="if(this.value===\'\')this.value=\'0\'">' +
    '</div>';
  });
  container.innerHTML = html;
  
  // Mostrar/esconder preview de marcações
  var marcacoesPreview = document.getElementById('lav2-preview-marcacoes');
  if (marcacoesPreview) {
    marcacoesPreview.style.display = client.markingPrice > 0 ? 'block' : 'none';
  }
  
  updateLav2Total();
}

function updateLav2PeriodDisplay(client) {
  var periodText = document.getElementById('lav2-period-text');
  var diasEl = document.getElementById('lav2-stat-dias');
  var now = new Date();
  var startDate, endDate;
  
  if (client.billingCycle === 'biweekly') {
    // Marajoara: ciclo de 16 dias (5-20 ou 21-4)
    var day = now.getDate();
    if (day >= 5 && day <= 20) {
      // Período 5 até 20 do mês atual
      startDate = new Date(now.getFullYear(), now.getMonth(), 5);
      endDate = new Date(now.getFullYear(), now.getMonth(), 20);
    } else if (day >= 21) {
      // Período 21 até 4 do próximo mês
      startDate = new Date(now.getFullYear(), now.getMonth(), 21);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 4);
    } else {
      // Dias 1-4: ainda no período 21-4 (período anterior)
      startDate = new Date(now.getFullYear(), now.getMonth() - 1, 21);
      endDate = new Date(now.getFullYear(), now.getMonth(), 4);
    }
  } else {
    // Mensal
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  }
  
  lav2State.period = { start: startDate, end: endDate };
  
  var formatDate = function(d) {
    return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');
  };
  
  if (periodText) {
    periodText.textContent = formatDate(startDate) + ' - ' + formatDate(endDate);
  }
  
  // Calcular dias restantes
  var daysRemaining = Math.ceil((endDate - now) / (1000 * 60 * 60 * 24));
  var diasEl = document.getElementById('lav2-stat-dias');
  if (diasEl) diasEl.textContent = Math.max(0, daysRemaining);
}

function updateLav2Total() {
  var client = LAV2_CLIENTS[lav2State.currentClient];
  if (!client) return;
  
  var totalPieces = 0;
  var totalMarkings = 0;
  
  client.fields.forEach(function(field) {
    var input = document.getElementById('lav2-field-' + field.key);
    var value = parseInt(input?.value) || 0;
    if (field.isMarking) {
      totalMarkings += value;
    } else {
      totalPieces += value;
    }
  });
  
  var totalValue = (totalPieces * client.pricePerPiece) + (totalMarkings * client.markingPrice);
  
  // Atualizar preview
  var piecesEl = document.getElementById('lav2-preview-pieces');
  var marcacoesEl = document.getElementById('lav2-preview-marcacoes');
  var valorEl = document.getElementById('lav2-preview-valor');
  
  if (piecesEl) piecesEl.textContent = totalPieces;
  if (marcacoesEl && marcacoesEl.querySelector('span')) {
    marcacoesEl.querySelector('span').textContent = totalMarkings;
  }
  if (valorEl) valorEl.textContent = 'R$ ' + totalValue.toFixed(2);
}

async function loadLav2ClientEntries(clientKey) {
  try {
    var client = LAV2_CLIENTS[clientKey];
    if (!client || !lav2State.period) return;
    
    var startDate = lav2State.period.start.toISOString().split('T')[0];
    var endDate = lav2State.period.end.toISOString().split('T')[0];
    
    var response = await fetch(API_URL + '/laundry/v2/entries/' + client.id + '?startDate=' + startDate + '&endDate=' + endDate, {
      headers: { 'Authorization': 'Bearer ' + state.token }
    });
    
    var data = await response.json();
    if (data.ok) {
      lav2State.entries = data.entries || [];
      renderLav2History();
      updateLav2ClientStats();
    }
  } catch (error) {
    console.error('[Lavanderia V2] Erro ao carregar entries:', error);
  }
}

function updateLav2ClientStats() {
  var client = LAV2_CLIENTS[lav2State.currentClient];
  if (!client) return;
  
  var totalPieces = 0;
  var totalMarkings = 0;
  var totalValue = 0;
  
  lav2State.entries.forEach(function(entry) {
    client.fields.forEach(function(field) {
      var value = parseInt(entry[field.key]) || 0;
      if (field.isMarking) {
        totalMarkings += value;
      } else {
        totalPieces += value;
      }
    });
    totalValue += parseFloat(entry.valor_total) || 0;
  });
  
  // Atualizar stats cards
  var pecasEl = document.getElementById('lav2-stat-pecas');
  var marcacoesEl = document.getElementById('lav2-stat-marcacoes');
  var valorEl = document.getElementById('lav2-stat-valor');
  
  if (pecasEl) pecasEl.textContent = totalPieces;
  if (marcacoesEl) marcacoesEl.textContent = totalMarkings;
  if (valorEl) valorEl.textContent = 'R$ ' + totalValue.toFixed(2);
}

async function loadLav2AllStats() {
  try {
    var response = await fetch(API_URL + '/laundry/v2/stats', {
      headers: { 'Authorization': 'Bearer ' + state.token }
    });
    
    var data = await response.json();
    if (data.ok && data.stats) {
      var stats = data.stats;
      
      // Faturamento total
      var lucroEl = document.getElementById('lav2-total-lucro');
      if (lucroEl) lucroEl.textContent = 'R$ ' + (stats.month_value || stats.total_value || 0).toFixed(2);
      
      // Total de peças geral (todos os clientes)
      var pecasGeralEl = document.getElementById('lav2-total-pecas-geral');
      if (pecasGeralEl) pecasGeralEl.textContent = (stats.month_pieces || stats.total_pieces || 0);
    }
  } catch (error) {
    console.error('[Lavanderia V2] Erro ao carregar stats gerais:', error);
  }
}

function renderLav2History() {
  var tbody = document.getElementById('lav2-history-tbody');
  if (!tbody) return;
  
  var client = LAV2_CLIENTS[lav2State.currentClient];
  var entries = lav2State.entries || [];
  
  if (entries.length === 0) {
    tbody.innerHTML = '<div style="padding: 40px 20px; text-align: center; color: rgba(255,255,255,0.4);">' +
        '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom: 12px; opacity: 0.5;">' +
          '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
          '<polyline points="14 2 14 8 20 8"/>' +
        '</svg>' +
        '<div style="font-size: 14px; margin-bottom: 4px;">Nenhum lançamento</div>' +
        '<div style="font-size: 12px;">Adicione o primeiro lançamento do período</div>' +
      '</div>';
    return;
  }
  
  var html = '';
  entries.forEach(function(entry) {
    var date = new Date(entry.entry_date);
    var dateStr = String(date.getDate()).padStart(2, '0') + '/' + 
                  String(date.getMonth() + 1).padStart(2, '0');
    
    // Construir detalhes baseado nos campos
    var totalPieces = 0;
    client.fields.forEach(function(field) {
      var value = parseInt(entry[field.key]) || 0;
      if (!field.isMarking) totalPieces += value;
    });
    
    html += '<div class="lav2-history-item" style="display: flex; justify-content: space-between; align-items: center; padding: 14px 20px; border-bottom: 1px solid rgba(255,255,255,0.04);">' +
      '<div>' +
        '<div style="font-size: 14px; font-weight: 600; color: #fff;">' + dateStr + '</div>' +
        '<div style="font-size: 12px; color: rgba(255,255,255,0.5);">' + totalPieces + ' peças</div>' +
      '</div>' +
      '<div style="display: flex; align-items: center; gap: 12px;">' +
        '<span style="font-size: 15px; font-weight: 600; color: #ec4899;">R$ ' + (parseFloat(entry.valor_total) || 0).toFixed(2) + '</span>' +
        '<button onclick="deleteLav2Entry(\'' + entry.id + '\')" style="padding: 8px; background: rgba(239,68,68,0.1); border: none; border-radius: 8px; color: #ef4444; cursor: pointer;">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>' +
        '</button>' +
      '</div>' +
    '</div>';
  });
  
  tbody.innerHTML = html;
}

async function saveLav2Entry() {
  try {
    var client = LAV2_CLIENTS[lav2State.currentClient];
    if (!client) return;
    
    var entryDate = document.getElementById('lav2-entry-date')?.value;
    if (!entryDate) {
      showToast('Selecione uma data', 'error');
      return;
    }
    
    // Coletar valores dos campos
    var entryData = {
      client_id: client.id,
      entry_date: entryDate
    };
    
    var hasValue = false;
    client.fields.forEach(function(field) {
      var input = document.getElementById('lav2-field-' + field.key);
      var value = parseInt(input?.value) || 0;
      entryData[field.key] = value;
      if (value > 0) hasValue = true;
    });
    
    if (!hasValue) {
      showToast('Preencha ao menos um campo', 'error');
      return;
    }
    
    // Calcular valor total
    var totalPieces = 0;
    var totalMarkings = 0;
    client.fields.forEach(function(field) {
      if (field.isMarking) {
        totalMarkings += entryData[field.key] || 0;
      } else {
        totalPieces += entryData[field.key] || 0;
      }
    });
    entryData.total_value = (totalPieces * client.pricePerPiece) + (totalMarkings * client.markingPrice);
    
    var response = await fetch(API_URL + '/laundry/v2/entries', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + state.token
      },
      body: JSON.stringify(entryData)
    });
    
    var data = await response.json();
    if (data.ok) {
      showToast('Lançamento salvo!', 'success');
      
      // Limpar campos
      client.fields.forEach(function(field) {
        var input = document.getElementById('lav2-field-' + field.key);
        if (input) input.value = '0';
      });
      updateLav2Total();
      
      // Recarregar
      await loadLav2ClientEntries(client.id);
      await loadLav2AllStats();
    } else {
      showToast(data.error || 'Erro ao salvar', 'error');
    }
  } catch (error) {
    console.error('[Lavanderia V2] Erro ao salvar:', error);
    showToast('Erro ao salvar lançamento', 'error');
  }
}

async function deleteLav2Entry(entryId) {
  if (!confirm('Excluir este lançamento?')) return;
  
  try {
    var response = await fetch(API_URL + '/laundry/v2/entries/' + entryId, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + state.token }
    });
    
    var data = await response.json();
    if (data.ok) {
      showToast('Lançamento excluído', 'success');
      await loadLav2ClientEntries(lav2State.currentClient);
      await loadLav2AllStats();
    } else {
      showToast(data.error || 'Erro ao excluir', 'error');
    }
  } catch (error) {
    console.error('[Lavanderia V2] Erro ao excluir:', error);
    showToast('Erro ao excluir', 'error');
  }
}

async function exportLav2PDF() {
  try {
    var client = LAV2_CLIENTS[lav2State.currentClient];
    if (!client) return;
    
    showToast('Gerando PDF...', 'info');
    
    // Criar conteúdo do PDF
    var periodStart = lav2State.period.start;
    var periodEnd = lav2State.period.end;
    var formatDate = function(d) {
      return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
    };
    
    // Calcular totais
    var totalPieces = 0;
    var totalMarkings = 0;
    var totalValue = 0;
    
    lav2State.entries.forEach(function(entry) {
      client.fields.forEach(function(field) {
        var value = parseInt(entry[field.key]) || 0;
        if (field.isMarking) {
          totalMarkings += value;
        } else {
          totalPieces += value;
        }
      });
      totalValue += parseFloat(entry.valor_total) || 0;
    });
    
    var printContent = '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
      '<title>Relatório ' + client.name + '</title>' +
      '<style>' +
        'body { font-family: Arial, sans-serif; padding: 40px; color: #333; }' +
        '.header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid ' + client.color + '; padding-bottom: 20px; }' +
        '.header h1 { color: ' + client.color + '; margin: 0 0 10px; }' +
        '.period { font-size: 14px; color: #666; }' +
        '.summary { display: flex; justify-content: space-around; margin: 30px 0; padding: 20px; background: #f5f5f5; border-radius: 10px; }' +
        '.summary-item { text-align: center; }' +
        '.summary-item .value { font-size: 28px; font-weight: bold; color: ' + client.color + '; }' +
        '.summary-item .label { font-size: 12px; color: #666; }' +
        'table { width: 100%; border-collapse: collapse; margin-top: 20px; }' +
        'th { background: ' + client.color + '; color: white; padding: 12px; text-align: left; }' +
        'td { padding: 10px 12px; border-bottom: 1px solid #eee; }' +
        'tr:hover td { background: #f9f9f9; }' +
        '.total-row { font-weight: bold; background: #f0f0f0; }' +
        '.footer { margin-top: 40px; text-align: center; font-size: 12px; color: #999; }' +
      '</style></head><body>' +
      '<div class="header">' +
        '<h1>Relatório de Lavanderia - ' + client.name + '</h1>' +
        '<div class="period">Período: ' + formatDate(periodStart) + ' a ' + formatDate(periodEnd) + '</div>' +
      '</div>' +
      '<div class="summary">' +
        '<div class="summary-item"><div class="value">' + totalPieces + '</div><div class="label">Total de Peças</div></div>' +
        (client.markingPrice > 0 ? '<div class="summary-item"><div class="value">' + totalMarkings + '</div><div class="label">Marcações</div></div>' : '') +
        '<div class="summary-item"><div class="value">R$ ' + totalValue.toFixed(2) + '</div><div class="label">Valor Total</div></div>' +
      '</div>' +
      '<table><thead><tr><th>Data</th>';
    
    client.fields.forEach(function(field) {
      printContent += '<th>' + field.label + '</th>';
    });
    printContent += '<th>Valor</th></tr></thead><tbody>';
    
    lav2State.entries.forEach(function(entry) {
      var date = new Date(entry.entry_date);
      var dateStr = formatDate(date);
      printContent += '<tr><td>' + dateStr + '</td>';
      client.fields.forEach(function(field) {
        printContent += '<td>' + (entry[field.key] || 0) + '</td>';
      });
      printContent += '<td>R$ ' + (parseFloat(entry.valor_total) || 0).toFixed(2) + '</td></tr>';
    });
    
    printContent += '</tbody></table>' +
      '<div class="footer">' +
        '<p>Gerado por ICARUS - Sistema de Gestão</p>' +
        '<p>' + new Date().toLocaleString('pt-BR') + '</p>' +
      '</div>' +
      '</body></html>';
    
    var printWindow = window.open('', '_blank');
    printWindow.document.write(printContent);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(function() {
      printWindow.print();
    }, 500);
    
    showToast('PDF gerado!', 'success');
  } catch (error) {
    console.error('[Lavanderia V2] Erro ao gerar PDF:', error);
    showToast('Erro ao gerar PDF', 'error');
  }
}

// ========== RELATÓRIOS ==========

async function loadRelatorios() {
  try {
    // Esconder/mostrar botão de novo relatório baseado em permissão
    var writeActions = document.getElementById('relatorios-write-actions');
    if (writeActions) {
      writeActions.style.display = state.canWriteRelatorios ? 'flex' : 'none';
    }
    
    await loadReportsData();
    renderReports();
    
  } catch (error) {
    console.error('Erro ao carregar relatórios:', error);
  }
}

async function loadReportsData() {
  try {
    var url = API_URL + '/maintenance-reports';
    if (state.reportCategory && state.reportCategory !== 'all') {
      url += '?category=' + state.reportCategory;
    }
    
    var response = await fetch(url, {
      headers: { 'Authorization': 'Bearer ' + state.token }
    });
    
    var data = await response.json();
    if (data.ok) {
      state.reports = data.reports || [];
    }
  } catch (error) {
    console.error('Erro ao carregar relatórios:', error);
  }
}

function renderReports() {
  var container = document.getElementById('relatorios-list');
  var postsContainer = document.querySelector('.forum-posts-container');
  var viewer = document.getElementById('report-viewer');
  if (!container) return;
  
  // Se há um relatório aberto, não esconder o viewer
  if (state.currentReport) {
    // Manter viewer visível, apenas atualizar dados internos se necessário
  } else {
    // Mostrar lista, esconder viewer
    container.classList.remove('hidden');
    if (postsContainer) postsContainer.classList.remove('hidden');
    if (viewer) viewer.classList.add('hidden');
  }
  
  var reports = state.reports || [];
  
  // Atualizar stats do header
  var totalEl = document.getElementById('forum-total-posts');
  var monthEl = document.getElementById('forum-this-month');
  if (totalEl) totalEl.textContent = reports.length;
  
  // Contar posts deste mês
  var now = new Date();
  var thisMonth = reports.filter(function(r) {
    var d = new Date(r.created_at);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;
  if (monthEl) monthEl.textContent = thisMonth;
  
  if (reports.length === 0) {
    container.innerHTML = '<div class="forum-empty">' +
      '<div class="forum-empty-icon">' +
        '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">' +
          '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>' +
        '</svg>' +
      '</div>' +
      '<h3>Nenhum post ainda</h3>' +
      '<p>Seja o primeiro a publicar um relatório!</p>' +
    '</div>';
    return;
  }
  
  var categoryLabels = {
    'geral': 'Geral',
    'manutencao': 'Manutenção',
    'incidente': 'Incidente',
    'melhoria': 'Melhoria',
    'orcamento': 'Orçamento'
  };
  
  var html = '';
  reports.forEach(function(report) {
    var dateStr = report.created_at ? formatRelativeDate(new Date(report.created_at)) : '';
    var catLabel = categoryLabels[report.category] || 'Geral';
    var preview = (report.content || '').substring(0, 180);
    var authorName = report.created_by_name || 'Anônimo';
    var initials = authorName.split(' ').map(function(n) { return n[0]; }).join('').substring(0, 2).toUpperCase();
    
    // Ícones extras (visibilidade e anexos)
    var attachments = report.attachments || [];
    var extraIcons = '';
    
    if (report.visibility === 'private') {
      extraIcons += '<span style="color: #ef4444; font-size: 10px; display: flex; align-items: center; gap: 3px;">' +
        '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>' +
        'Privado' +
      '</span>';
    }
    
    if (attachments.length > 0) {
      extraIcons += '<span style="color: #f59e0b; font-size: 10px; display: flex; align-items: center; gap: 3px;">' +
        '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>' +
        attachments.length +
      '</span>';
    }
    
    html += '<div class="forum-post" onclick="openReport(\'' + report.id + '\')">' +
      '<div class="forum-post-avatar">' + initials + '</div>' +
      '<div class="forum-post-content">' +
        '<div class="forum-post-header">' +
          '<span class="forum-post-category ' + (report.category || 'geral') + '">' + catLabel + '</span>' +
          (extraIcons ? '<div style="display: flex; gap: 10px;">' + extraIcons + '</div>' : '') +
          '<span class="forum-post-meta">' + dateStr + '</span>' +
        '</div>' +
        '<h3 class="forum-post-title">' + escapeHtml(report.title) + '</h3>' +
        '<p class="forum-post-preview">' + escapeHtml(preview) + (report.content && report.content.length > 180 ? '...' : '') + '</p>' +
        '<div class="forum-post-footer">' +
          '<div class="forum-post-author">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>' +
            authorName +
          '</div>' +
          '<div class="forum-post-actions">' +
            '<span class="forum-post-action" onclick="event.stopPropagation(); openReport(\'' + report.id + '\')">' +
              '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>' +
              'Ler' +
            '</span>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  });
  
  container.innerHTML = html;
}

// Função para formatar data relativa
function formatRelativeDate(date) {
  var now = new Date();
  var diff = now - date;
  var seconds = Math.floor(diff / 1000);
  var minutes = Math.floor(seconds / 60);
  var hours = Math.floor(minutes / 60);
  var days = Math.floor(hours / 24);
  
  if (days > 7) {
    return date.toLocaleDateString('pt-BR');
  } else if (days > 0) {
    return days === 1 ? 'Ontem' : 'Há ' + days + ' dias';
  } else if (hours > 0) {
    return 'Há ' + hours + (hours === 1 ? ' hora' : ' horas');
  } else if (minutes > 0) {
    return 'Há ' + minutes + ' min';
  } else {
    return 'Agora';
  }
}

function hexToRgb(hex) {
  var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? parseInt(result[1], 16) + ', ' + parseInt(result[2], 16) + ', ' + parseInt(result[3], 16) : '34, 211, 238';
}

function setReportCategory(category, btn) {
  state.reportCategory = category;
  
  document.querySelectorAll('.forum-filter-chip').forEach(function(b) {
    b.classList.remove('active');
  });
  if (btn) btn.classList.add('active');
  
  loadReportsData().then(renderReports);
}

// Buscar relatórios
function searchReports(query) {
  var container = document.getElementById('relatorios-list');
  if (!container) return;
  
  var posts = container.querySelectorAll('.forum-post');
  query = query.toLowerCase();
  
  posts.forEach(function(post) {
    var title = post.querySelector('.forum-post-title');
    var preview = post.querySelector('.forum-post-preview');
    var text = (title ? title.textContent : '') + ' ' + (preview ? preview.textContent : '');
    
    if (text.toLowerCase().indexOf(query) !== -1 || query === '') {
      post.style.display = 'flex';
    } else {
      post.style.display = 'none';
    }
  });
}

function openReport(reportId) {
  var report = state.reports.find(function(r) { return r.id == reportId; });
  if (!report) return;
  
  state.currentReport = report;
  
  var container = document.getElementById('relatorios-list');
  var postsContainer = document.querySelector('.forum-posts-container');
  var toolbar = document.querySelector('.forum-toolbar');
  var viewer = document.getElementById('report-viewer');
  
  if (container) container.classList.add('hidden');
  if (postsContainer) postsContainer.classList.add('hidden');
  if (toolbar) toolbar.classList.add('hidden');
  if (viewer) viewer.classList.remove('hidden');
  
  var categoryLabels = { 'geral': 'Geral', 'manutencao': 'Manutenção', 'incidente': 'Incidente', 'melhoria': 'Melhoria', 'orcamento': 'Orçamento' };
  var dateStr = report.created_at ? new Date(report.created_at).toLocaleDateString('pt-BR', { 
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' 
  }) : '';
  
  var catEl = document.getElementById('viewer-category');
  if (catEl) {
    catEl.textContent = categoryLabels[report.category] || 'Geral';
    catEl.className = 'forum-article-category ' + (report.category || 'geral');
  }
  document.getElementById('viewer-date').textContent = dateStr;
  document.getElementById('viewer-title').textContent = report.title;
  document.getElementById('viewer-author').textContent = report.created_by_name || 'Anônimo';
  document.getElementById('viewer-content').textContent = report.content || '';
  
  // Análise inteligente do conteúdo
  renderSmartAnalysis(report.content);
  
  // Mostrar visibilidade
  var visibilityEl = document.getElementById('viewer-visibility');
  if (visibilityEl) {
    if (report.visibility === 'private') {
      visibilityEl.textContent = 'PRIVADO';
      visibilityEl.style.background = 'rgba(239, 68, 68, 0.15)';
      visibilityEl.style.color = '#ef4444';
      visibilityEl.style.display = 'inline-block';
    } else {
      visibilityEl.textContent = 'PÚBLICO';
      visibilityEl.style.background = 'rgba(34, 197, 94, 0.15)';
      visibilityEl.style.color = '#22c55e';
      visibilityEl.style.display = 'inline-block';
    }
  }
  
  // Mostrar anexos
  var attachmentsContainer = document.getElementById('viewer-attachments');
  var attachmentsList = document.getElementById('viewer-attachments-list');
  var attachments = report.attachments || [];
  
  if (attachments.length > 0 && attachmentsContainer && attachmentsList) {
    attachmentsContainer.style.display = 'block';
    attachmentsList.innerHTML = attachments.map(function(att, i) {
      var isImage = att.url && (att.url.match(/\.(jpg|jpeg|png|gif|webp)$/i) || att.url.includes('imgur') || att.url.includes('drive.google'));
      return '<a href="' + escapeHtml(att.url) + '" target="_blank" style="' +
        'display: flex; align-items: center; gap: 10px; padding: 12px 16px; ' +
        'background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.2); ' +
        'border-radius: 10px; text-decoration: none; transition: all 0.2s;' +
        '" onmouseover="this.style.borderColor=\'rgba(245,158,11,0.5)\'" onmouseout="this.style.borderColor=\'rgba(245,158,11,0.2)\'">' +
        '<div style="width: 36px; height: 36px; background: rgba(245, 158, 11, 0.15); border-radius: 8px; display: flex; align-items: center; justify-content: center; color: #f59e0b;">' +
        (isImage 
          ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>'
          : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>'
        ) +
        '</div>' +
        '<div style="flex: 1;">' +
        '<div style="font-size: 13px; font-weight: 600; color: #f59e0b;">' + escapeHtml(att.name || 'Anexo ' + (i + 1)) + '</div>' +
        '<div style="font-size: 11px; color: rgba(255,255,255,0.5);">Clique para abrir</div>' +
        '</div>' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>' +
        '</a>';
    }).join('');
  } else if (attachmentsContainer) {
    attachmentsContainer.style.display = 'none';
  }
  
  // Mostrar/esconder botão de deletar baseado em permissão (dono ou admin)
  var deleteBtn = document.getElementById('btn-delete-report');
  if (deleteBtn) {
    var isOwner = report.created_by === state.user.id;
    var isAdmin = state.user.roles && (state.user.roles.includes('admin') || state.user.roles.includes('os_manage_all'));
    deleteBtn.style.display = (isOwner || isAdmin) ? 'flex' : 'none';
  }
}

function closeReportViewer() {
  var container = document.getElementById('relatorios-list');
  var postsContainer = document.querySelector('.forum-posts-container');
  var toolbar = document.querySelector('.forum-toolbar');
  var viewer = document.getElementById('report-viewer');
  
  if (container) container.classList.remove('hidden');
  if (postsContainer) postsContainer.classList.remove('hidden');
  if (toolbar) toolbar.classList.remove('hidden');
  if (viewer) viewer.classList.add('hidden');
  
  state.currentReport = null;
}

// Modal de Exportação
function openExportModal() {
  var modal = document.getElementById('export-modal');
  if (modal) modal.classList.add('active');
}

function closeExportModal() {
  var modal = document.getElementById('export-modal');
  if (modal) modal.classList.remove('active');
}

// Copiar relatório para clipboard
function copyReportToClipboard() {
  if (!state.currentReport) return;
  
  var report = state.currentReport;
  var text = report.title + '\n\n' + (report.content || '');
  text += '\n\n---\nGerado pelo Sistema ICARUS\nicarussite.vercel.app';
  
  navigator.clipboard.writeText(text).then(function() {
    showNotification('Conteúdo copiado!', 'success');
  }).catch(function() {
    showNotification('Erro ao copiar', 'error');
  });
}

// Compartilhar relatório
function shareReport() {
  if (!state.currentReport) return;
  
  var report = state.currentReport;
  var text = '*' + report.title + '*\n\n' + (report.content || '').substring(0, 500);
  if (report.content && report.content.length > 500) text += '...';
  text += '\n\n_Gerado pelo Sistema ICARUS_';
  
  var whatsappUrl = 'https://wa.me/?text=' + encodeURIComponent(text);
  
  if (navigator.share) {
    navigator.share({
      title: report.title,
      text: text,
      url: 'https://icarussite.vercel.app'
    }).catch(function() {
      window.open(whatsappUrl, '_blank');
    });
  } else {
    window.open(whatsappUrl, '_blank');
  }
}

// Análise inteligente do conteúdo - detecta valores, quantidades, datas
function analyzeReportContent(content) {
  if (!content) return [];
  
  var tags = [];
  
  // Detectar valores em reais (R$ X,XX ou R$ X.XXX,XX)
  var moneyRegex = /R\$\s*[\d.,]+/gi;
  var moneyMatches = content.match(moneyRegex);
  if (moneyMatches) {
    var total = 0;
    moneyMatches.forEach(function(m) {
      tags.push({ type: 'value', text: m.trim() });
      var numStr = m.replace('R$', '').replace(/\./g, '').replace(',', '.').trim();
      var num = parseFloat(numStr);
      if (!isNaN(num)) total += num;
    });
    if (moneyMatches.length > 1 && total > 0) {
      tags.push({ type: 'total', text: 'Total: R$ ' + total.toFixed(2).replace('.', ',') });
    }
  }
  
  // Detectar quantidades (X unidades, X peças, X un, Qtd: X)
  var qtyRegex = /(\d+)\s*(unidade|unidades|un|peça|peças|pç|pcs|qtd|quantidade)/gi;
  var qtyMatches = content.match(qtyRegex);
  if (qtyMatches) {
    qtyMatches.slice(0, 3).forEach(function(m) {
      tags.push({ type: 'quantity', text: m.trim() });
    });
  }
  
  // Detectar datas (XX/XX/XXXX)
  var dateRegex = /\d{1,2}\/\d{1,2}\/\d{2,4}/g;
  var dateMatches = content.match(dateRegex);
  if (dateMatches) {
    dateMatches.slice(0, 2).forEach(function(m) {
      tags.push({ type: 'date', text: m });
    });
  }
  
  return tags.slice(0, 8); // Limitar a 8 tags
}

// Renderizar análise inteligente
function renderSmartAnalysis(content) {
  var container = document.getElementById('viewer-smart-analysis');
  var contentEl = document.getElementById('smart-analysis-content');
  
  if (!container || !contentEl) return;
  
  var tags = analyzeReportContent(content);
  
  if (tags.length === 0) {
    container.style.display = 'none';
    return;
  }
  
  container.style.display = 'block';
  contentEl.innerHTML = tags.map(function(tag, i) {
    var icons = {
      value: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
      quantity: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/></svg>',
      date: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
      total: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/></svg>'
    };
    return '<span class="smart-tag ' + tag.type + '" style="animation-delay: ' + (i * 0.1) + 's">' + 
      (icons[tag.type] || '') + tag.text + '</span>';
  }).join('');
}

// Função para gerar PDF premium via backend
async function generateReportPDF() {
  if (!state.currentReport) return;
  
  try {
    showNotification('Gerando PDF...', 'info');
    
    var pdfUrl = API_URL + '/maintenance-reports/' + state.currentReport.id + '/pdf';
    
    // Abrir PDF no navegador
    if (typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform()) {
      var Browser = Capacitor.Plugins.Browser;
      if (Browser) {
        await Browser.open({ url: pdfUrl + '?token=' + state.token });
      } else {
        window.open(pdfUrl + '?token=' + state.token, '_blank');
      }
    } else {
      window.open(pdfUrl + '?token=' + state.token, '_blank');
    }
  } catch (error) {
    console.error('Erro ao gerar PDF:', error);
    showNotification('Erro ao gerar PDF', 'error');
  }
}

// Função para imprimir relatório como PDF
function printReport() {
  var article = document.getElementById('forum-article-content');
  if (!article || !state.currentReport) return;
  
  var printWindow = window.open('', '_blank');
  var report = state.currentReport;
  var dateStr = report.created_at ? new Date(report.created_at).toLocaleDateString('pt-BR') : '';
  
  printWindow.document.write('<html><head><title>' + report.title + '</title>');
  printWindow.document.write('<style>');
  printWindow.document.write('body { font-family: Arial, sans-serif; padding: 40px; max-width: 800px; margin: 0 auto; color: #333; }');
  printWindow.document.write('.header { border-bottom: 2px solid #ec4899; padding-bottom: 20px; margin-bottom: 30px; }');
  printWindow.document.write('.logo { font-size: 24px; font-weight: bold; color: #ec4899; margin-bottom: 5px; }');
  printWindow.document.write('.subtitle { font-size: 12px; color: #888; }');
  printWindow.document.write('.category { display: inline-block; padding: 4px 12px; background: #fdf2f8; border-radius: 15px; font-size: 11px; text-transform: uppercase; margin-bottom: 10px; color: #ec4899; }');
  printWindow.document.write('.title { font-size: 28px; font-weight: bold; margin: 0 0 15px 0; color: #111; }');
  printWindow.document.write('.meta { font-size: 13px; color: #666; margin-bottom: 30px; }');
  printWindow.document.write('.content { font-size: 14px; line-height: 1.8; white-space: pre-wrap; }');
  printWindow.document.write('.footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #fce7f3; font-size: 11px; color: #999; }');
  printWindow.document.write('.promo { background: linear-gradient(135deg, #fdf2f8, #fae8ff); padding: 15px; border-radius: 10px; margin-top: 30px; }');
  printWindow.document.write('.promo-title { font-weight: bold; color: #ec4899; }');
  printWindow.document.write('</style></head><body>');
  printWindow.document.write('<div class="header"><div class="logo">✡ ICARUS</div><div class="subtitle">Central de Relatórios • Granja Vitta</div></div>');
  printWindow.document.write('<div class="category">' + (report.category || 'Geral') + '</div>');
  printWindow.document.write('<h1 class="title">' + escapeHtml(report.title) + '</h1>');
  printWindow.document.write('<div class="meta">Por <strong>' + (report.created_by_name || 'Anônimo') + '</strong> em ' + dateStr + '</div>');
  printWindow.document.write('<div class="content">' + escapeHtml(report.content) + '</div>');
  printWindow.document.write('<div class="promo"><div class="promo-title">Sistema ICARUS</div><div>Gestão Inteligente • Contato: (xx) xxxxx-xxxx</div></div>');
  printWindow.document.write('<div class="footer">Relatório gerado pelo Sistema Icarus em ' + new Date().toLocaleDateString('pt-BR') + '</div>');
  printWindow.document.write('</body></html>');
  printWindow.document.close();
  
  setTimeout(function() {
    printWindow.print();
  }, 250);
}

// Função para deletar relatório
async function deleteReport() {
  if (!state.currentReport) return;
  
  // Verificar permissão (dono ou admin)
  var isOwner = state.currentReport.created_by === state.user.id;
  var isAdmin = state.user.roles && (state.user.roles.includes('admin') || state.user.roles.includes('os_manage_all'));
  
  if (!isOwner && !isAdmin) {
    showNotification('Você não tem permissão para excluir este relatório', 'error');
    return;
  }
  
  if (!confirm('Tem certeza que deseja excluir este relatório permanentemente?')) return;
  
  try {
    var response = await fetch(API_URL + '/maintenance-reports/' + state.currentReport.id, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + state.token }
    });
    
    var data = await response.json();
    
    if (data.ok) {
      closeReportViewer();
      await loadReportsData();
      renderReports();
      showNotification('Relatório excluído com sucesso!', 'success');
    } else {
      showNotification(data.error || 'Erro ao excluir relatório', 'error');
    }
  } catch (error) {
    console.error('Erro ao excluir relatório:', error);
    showNotification('Erro ao excluir relatório', 'error');
  }
}

// Array temporário para anexos
var reportAttachments = [];

function showNewReportModal() {
  if (!state.canWriteRelatorios) {
    showNotification('Você não tem permissão para criar relatórios', 'error');
    return;
  }
  
  document.getElementById('report-title').value = '';
  document.getElementById('report-category').value = 'geral';
  document.getElementById('report-content').value = '';
  
  // Reset visibilidade
  var publicRadio = document.getElementById('report-visibility-public');
  if (publicRadio) publicRadio.checked = true;
  
  // Reset anexos
  reportAttachments = [];
  var attachmentsList = document.getElementById('report-attachments-list');
  if (attachmentsList) attachmentsList.innerHTML = '';
  
  document.getElementById('report-modal').classList.add('active');
}

function closeReportModal() {
  document.getElementById('report-modal').classList.remove('active');
}

// Adicionar anexo à lista
function addReportAttachment() {
  var input = document.getElementById('report-attachment-input');
  if (!input) return;
  
  var url = input.value.trim();
  if (!url) {
    showNotification('Cole um link válido', 'error');
    return;
  }
  
  // Validar URL básica
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }
  
  // Extrair nome do arquivo
  var name = url.split('/').pop().split('?')[0] || 'Anexo';
  if (name.length > 30) name = name.substring(0, 30) + '...';
  
  reportAttachments.push({ url: url, name: name });
  input.value = '';
  
  renderReportAttachments();
}

function renderReportAttachments() {
  var list = document.getElementById('report-attachments-list');
  if (!list) return;
  
  list.innerHTML = reportAttachments.map(function(att, i) {
    return '<div style="display: flex; align-items: center; gap: 10px; padding: 10px 12px; background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.2); border-radius: 8px;">' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>' +
      '<span style="flex: 1; font-size: 12px; color: #f59e0b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">' + escapeHtml(att.name) + '</span>' +
      '<button type="button" onclick="removeReportAttachment(' + i + ')" style="background: none; border: none; color: #ef4444; cursor: pointer; padding: 4px;">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
      '</button>' +
      '</div>';
  }).join('');
}

function removeReportAttachment(index) {
  reportAttachments.splice(index, 1);
  renderReportAttachments();
}

async function saveReport() {
  try {
    var title = document.getElementById('report-title').value.trim();
    var category = document.getElementById('report-category').value;
    var content = document.getElementById('report-content').value.trim();
    
    // Visibilidade
    var privateRadio = document.getElementById('report-visibility-private');
    var visibility = (privateRadio && privateRadio.checked) ? 'private' : 'public';
    
    if (!title || !content) {
      showNotification('Título e conteúdo são obrigatórios', 'error');
      return;
    }
    
    var response = await fetch(API_URL + '/maintenance-reports', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + state.token
      },
      body: JSON.stringify({ 
        title: title, 
        category: category, 
        content: content,
        visibility: visibility,
        attachments: reportAttachments
      })
    });
    
    var data = await response.json();
    
    if (data.ok) {
      state.reports = data.reports || [];
      closeReportModal();
      renderReports();
      showNotification('Relatório publicado com sucesso!', 'success');
    } else {
      showNotification(data.error || 'Erro ao publicar relatório', 'error');
    }
  } catch (error) {
    console.error('Erro ao salvar relatório:', error);
    showNotification('Erro ao salvar relatório', 'error');
  }
}

// escapeHtml function moved to top of file for security
