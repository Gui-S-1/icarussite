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
  waterPeriod: 'week',
  waterStats: null,
  currentView: 'dashboard',
  dashboardFilter: 'daily', // daily, weekly, monthly
  dashboardMonth: null, // null = mês atual, ou 'YYYY-MM' para mês específico
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
  // Relatórios
  reports: [],
  reportCategory: 'all',
  currentReport: null
};

const API_URL = (typeof window !== 'undefined' && window.ICARUS_API_URL)
  ? window.ICARUS_API_URL
  : 'http://localhost:4000';

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

  if (savedToken && savedUser) {
    try {
      state.token = savedToken;
      state.user = JSON.parse(savedUser);
      document.getElementById('loading-screen').classList.add('hidden');
      showApp();
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

  // Update active view
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
      localStorage.setItem('icarus_key', key);
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
      localStorage.setItem('icarus_username', username);
    
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));

      // Check if salaovos user - show operator selection popup
      if (username.toLowerCase() === 'salaovos') {
        window.afterUserSelection = showApp;
        openUserSelectionPopup();
      } else {
        showApp();
      }
    } else {
      showError(data.error || 'Login inválido');
    }
  } catch (error) {
    showError('Erro ao fazer login: ' + error.message);
  }
}

async function showApp() {
  document.getElementById('auth-screen').classList.add('hidden');
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

  // Load initial data
  await loadUsers(); // Carregar usuários primeiro
  
  // Usuários simples vão direto para OS ao invés do dashboard
  const roles = state.user.roles || [];
  const canSeeDashboard = roles.includes('admin') || roles.includes('os_manage_all') || roles.includes('os_view_all');
  
  if (canSeeDashboard) {
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
  
  // Inicializar busca rápida (Ctrl+K)
  initQuickSearch();
  
  // Adicionar indicador de atualização automática
  const statusBar = document.createElement('div');
  statusBar.id = 'auto-refresh-indicator';
  statusBar.innerHTML = '◎ Sync ativo';
  statusBar.style.cssText = 'position: fixed; bottom: 10px; right: 10px; padding: 6px 12px; background: rgba(212, 175, 55, 0.1); border: 1px solid var(--accent-gold); border-radius: 6px; font-size: 11px; color: var(--accent-gold); z-index: 1000;';
  document.body.appendChild(statusBar);
  
  // Animar indicador quando atualizar
  let lastUpdate = Date.now();
  setInterval(() => {
    const indicator = document.getElementById('auto-refresh-indicator');
    if (indicator && Date.now() - lastUpdate < 1000) {
      indicator.style.animation = 'pulse 0.5s';
      setTimeout(() => indicator.style.animation = '', 500);
    }
    lastUpdate = Date.now();
  }, 5000);
}

function setupPermissions() {
  const roles = state.user.roles || [];
  const isAdmin = roles.includes('admin');
  
  // ========== SISTEMA DE PERMISSÕES POR ABA ==========
  // Cada aba tem uma role específica para VER e outra para EDITAR
  // Role 'admin' tem acesso total a tudo
  
  // Dashboard: dashboard (ver)
  const canSeeDashboard = isAdmin || roles.includes('dashboard') || roles.includes('os_manage_all') || roles.includes('os_view_all');
  
  // Ordens de Serviço: os (ver/criar), os_manage_all (gerenciar todas)
  // OS sempre visível para todos os usuários
  
  // Almoxarifado: almoxarifado_view (ver), almoxarifado (editar)
  const canSeeAlmox = isAdmin || roles.includes('almoxarifado') || roles.includes('almoxarifado_view');
  const canEditAlmox = isAdmin || roles.includes('almoxarifado');
  
  // Compras: compras_view (ver), compras (editar)
  const canSeeCompras = isAdmin || roles.includes('compras') || roles.includes('compras_view');
  const canEditCompras = isAdmin || roles.includes('compras');
  
  // Preventivas: preventivas_view (ver), preventivas (editar)
  const canSeePrev = isAdmin || roles.includes('preventivas') || roles.includes('preventivas_view');
  const canEditPrev = isAdmin || roles.includes('preventivas');
  
  // Checklists: checklist (ver), checklist_manage (editar)
  const canSeeChecklists = isAdmin || roles.includes('checklist') || roles.includes('checklist_manage') || roles.includes('os_manage_all') || roles.includes('os_view_all');
  const canEditChecklists = isAdmin || roles.includes('checklist_manage') || roles.includes('os_manage_all');
  
  // Controle de Água: agua (ver), agua_manage (editar)
  const canSeeWater = isAdmin || roles.includes('agua') || roles.includes('agua_manage') || roles.includes('preventivas') || roles.includes('os_manage_all') || roles.includes('os_view_all');
  const canEditWater = isAdmin || roles.includes('agua_manage') || roles.includes('preventivas') || roles.includes('os_manage_all');
  
  // Controle de Diesel: diesel (ver), diesel_manage (editar)
  const canSeeDiesel = isAdmin || roles.includes('diesel') || roles.includes('diesel_manage') || roles.includes('preventivas') || roles.includes('os_manage_all') || roles.includes('os_view_all');
  const canEditDiesel = isAdmin || roles.includes('diesel_manage') || roles.includes('preventivas') || roles.includes('os_manage_all');
  
  // Gerador: gerador (ver), gerador_manage (editar)
  const canSeeGerador = isAdmin || roles.includes('gerador') || roles.includes('gerador_manage') || roles.includes('preventivas') || roles.includes('os_manage_all') || roles.includes('os_view_all');
  const canEditGerador = isAdmin || roles.includes('gerador_manage') || roles.includes('preventivas') || roles.includes('os_manage_all');

  // Aditiva: aditiva_view (ver), aditiva (editar - só manutenção)
  const canSeeAditiva = isAdmin || roles.includes('aditiva') || roles.includes('aditiva_view') || roles.includes('os_manage_all') || roles.includes('os_view_all');
  const canEditAditiva = isAdmin || roles.includes('aditiva') || roles.includes('os_manage_all');

  // Relatórios: relatorios (ver), relatorios_write (escrever - só manutenção)
  const canSeeRelatorios = isAdmin || roles.includes('relatorios') || roles.includes('relatorios_write') || roles.includes('os_manage_all') || roles.includes('os_view_all');
  const canWriteRelatorios = isAdmin || roles.includes('relatorios_write') || roles.includes('os_manage_all');

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
  const navRel = document.querySelector('[data-view="relatorios"]');
  const navCfg = document.querySelector('[data-view="configuracoes"]');

  // Aplicar visibilidade das abas
  if (navDashboard) navDashboard.classList.toggle('hidden', !canSeeDashboard);
  if (navOS) navOS.classList.remove('hidden'); // OS sempre visível para todos
  if (navAlmox) navAlmox.classList.toggle('hidden', !canSeeAlmox);
  if (navCompras) navCompras.classList.toggle('hidden', !canSeeCompras);
  if (navPrev) navPrev.classList.toggle('hidden', !canSeePrev);
  if (navChecklists) navChecklists.classList.toggle('hidden', !canSeeChecklists);
  if (navWater) navWater.classList.toggle('hidden', !canSeeWater);
  if (navDiesel) navDiesel.classList.toggle('hidden', !canSeeDiesel);
  if (navGerador) navGerador.classList.toggle('hidden', !canSeeGerador);
  if (navAditiva) navAditiva.classList.toggle('hidden', !canSeeAditiva);
  if (navRel) navRel.classList.toggle('hidden', !canSeeRelatorios);
  if (navCfg) navCfg.classList.remove('hidden');
  
  // Salvar permissões de edição no state para uso nas funções save
  state.canEditDiesel = canEditDiesel;
  state.canEditGerador = canEditGerador;
  state.canEditWater = canEditWater;
  state.canEditAlmox = canEditAlmox;
  state.canEditCompras = canEditCompras;
  state.canEditPreventivas = canEditPrev;
  state.canEditChecklists = canEditChecklists;
  state.canEditAditiva = canEditAditiva;
  state.canWriteRelatorios = canWriteRelatorios;
  
  console.log('Permissões configuradas. Roles:', roles, 'Pode editar diesel:', canEditDiesel, 'Pode editar gerador:', canEditGerador);
}

function showError(message) {
  const errorDiv = document.getElementById('auth-error');
  errorDiv.textContent = message;
  errorDiv.classList.remove('hidden');
}

// Dashboard
function setDashboardFilter(filter) {
  state.dashboardFilter = filter;
  
  // Update button states (with null checks)
  const filterDaily = document.getElementById('filter-daily');
  const filterWeekly = document.getElementById('filter-weekly');
  const filterMonthly = document.getElementById('filter-monthly');
  
  if (filterDaily) filterDaily.classList.remove('active');
  if (filterWeekly) filterWeekly.classList.remove('active');
  if (filterMonthly) filterMonthly.classList.remove('active');
  
  const filterBtn = document.getElementById(`filter-${filter}`);
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
    document.getElementById('filter-daily').classList.remove('active');
    document.getElementById('filter-weekly').classList.remove('active');
    document.getElementById('filter-monthly').classList.add('active');
    
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
  
  const completedInPeriod = filteredOrders.filter(o => 
    o.status === 'completed' && o.finished_at
  ).length;

  const createdInPeriod = filteredOrders.length;

  const statPending = document.getElementById('stat-pending');
  const statProgress = document.getElementById('stat-progress');
  const statCompleted = document.getElementById('stat-completed');
  const statTotal = document.getElementById('stat-total');

  if (statPending) statPending.textContent = pending;
  if (statProgress) statProgress.textContent = inProgress;
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

  // Productivity chart with filtered data
  renderProductivityChart(filteredOrders);

  // Update summary stats
  updateDashboardSummary(filteredOrders, completedInPeriod, createdInPeriod);

  // Recent activity - compact format
  renderRecentActivity();
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
  const recent = state.orders.slice(0, 6);
  const container = document.getElementById('recent-activity');
  if (!container) return;

  if (recent.length === 0) {
    container.innerHTML = '<div style="color: var(--text-secondary); font-size: 12px; padding: 20px; text-align: center;">Nenhuma atividade</div>';
    return;
  }

  const statusIcons = {
    pending: '○',
    in_progress: '◔',
    completed: '●'
  };

  const statusColors = {
    pending: 'var(--warning)',
    in_progress: 'var(--info)',
    completed: 'var(--success)'
  };

  container.innerHTML = recent.map(order => {
    const icon = statusIcons[order.status] || '○';
    const color = statusColors[order.status] || 'var(--accent-gold)';
    const time = formatTimeAgo(order.created_at);
    const title = order.title.length > 30 ? order.title.substring(0, 30) + '...' : order.title;
    
    return `
      <div class="activity-item" onclick="showOSDetail('${order.id}')" style="cursor: pointer;">
        <div class="activity-icon" style="background: ${color}20; color: ${color};">${icon}</div>
        <div class="activity-content">
          <div class="activity-title">${title}</div>
          <div class="activity-time">${time}</div>
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

function renderProductivityChart(filteredOrders = state.orders) {
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
    const response = await fetch(`${API_URL}/orders`, {
      headers: {
        'Authorization': `Bearer ${state.token}`
      }
    });

    const data = await response.json();
    if (data.ok) {
      state.orders = data.orders;
      renderOrdersTable();
      updateOSBadge(); // Atualizar badge no header
    }
  } catch (error) {
    console.error('Erro ao carregar OS:', error);
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

function renderOrdersTable() {
  const tbody = document.querySelector('#os-table tbody');
  
  // Filtrar apenas OS ativas (não concluídas)
  const activeOrders = state.orders.filter(o => o.status !== 'completed');
  
  if (activeOrders.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-secondary);">Nenhuma OS ativa</td></tr>';
    return;
  }

  tbody.innerHTML = activeOrders.map(order => {
    const assigned = order.assigned_users && order.assigned_users.length > 0
      ? (order.assigned_users[0].name || order.assigned_users[0].username)
      : '-';
    return `
      <tr onclick="showOSDetail('${order.id}')" style="cursor: pointer;">
        <td>
          <div><strong>${order.title}</strong></div>
          <div style="font-size: 12px; color: var(--text-secondary);">${order.sector || '-'}</div>
        </td>
        <td><span class="badge ${order.priority}">${getPriorityText(order.priority)}</span></td>
        <td>${assigned}</td>
        <td>${formatDate(order.created_at)}</td>
        <td><span class="badge ${order.status}">${getStatusText(order.status)}</span></td>
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
  
  const statusBadge = document.getElementById('detail-os-status');
  statusBadge.textContent = getStatusText(order.status);
  statusBadge.className = `badge ${order.status}`;
  
  const priorityBadge = document.getElementById('detail-os-priority');
  priorityBadge.textContent = getPriorityText(order.priority);
  priorityBadge.className = `badge ${order.priority}`;

  // Nota de progresso/comentário
  const noteField = document.getElementById('detail-os-note');
  if (noteField) {
    noteField.value = order.progress_note || order.description || '';
  }
  
  // Mostrar usuários atribuídos
  const assignedContainer = document.getElementById('detail-os-assigned');
  if (order.assigned_users && order.assigned_users.length > 0) {
    assignedContainer.innerHTML = order.assigned_users.map(u => 
      `<span class="user-chip">${u.name || u.username}</span>`
    ).join('');
  } else {
    assignedContainer.innerHTML = '<span style="color: var(--text-secondary);">Nenhum técnico atribuído</span>';
  }
  
  // Checkboxes para editar atribuições (se for o criador ou admin)
  const canEdit = state.user.roles.includes('admin') || state.user.roles.includes('os_manage_all') || order.requested_by === state.user.id;
  const checkboxContainer = document.getElementById('detail-assign-checkboxes');
  
  if (canEdit && order.status !== 'completed') {
    const assignedIds = order.assigned_users ? order.assigned_users.map(u => u.id) : [];
    checkboxContainer.innerHTML = `
      <label style="font-size: 13px; font-weight: 600; color: var(--text-secondary); margin-bottom: 8px;">Alterar atribuições:</label>
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
  
  if (canEdit && order.status !== 'completed') {
    actions += `<button type="button" class="btn-small btn-primary" onclick="updateOSAssignments('${order.id}')">Salvar Alterações</button>`;
  }
  
  if (canEdit && order.status === 'pending') {
    actions += `<button type="button" class="btn-small btn-primary" onclick="startOrder('${order.id}'); closeModal('modal-os-detail')">Iniciar</button>`;
  }
  
  if (canEdit && order.status === 'in_progress') {
    actions += `<button type="button" class="btn-small btn-primary" onclick="completeOrder('${order.id}'); closeModal('modal-os-detail')">Concluir</button>`;
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
        assignedContainer.innerHTML = data.assigned_users.map(u => `<span class="user-chip">${u.name || u.username}</span>`).join('');
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
    
    // Calcular tempo total
    let tempoTotal = '-';
    if (startedAt && finishedAt) {
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
      ? o.assigned_users.map(u => u.name || u.username).join(', ')
      : '-';
    
    return `
      <tr onclick="showOSDetail('${o.id}')" style="cursor: pointer;">
        <td>
          <div><strong>${o.title}</strong></div>
          <div style="font-size: 11px; color: var(--text-secondary);">Executado por: ${executores}</div>
        </td>
        <td>${o.sector || '-'}</td>
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
    btnAtivas.classList.add('btn-primary');
    btnAtivas.classList.remove('btn-secondary');
    btnHistorico.classList.remove('btn-primary');
    btnHistorico.classList.add('btn-secondary');
    contentAtivas.classList.remove('hidden');
    contentHistorico.classList.add('hidden');
  } else {
    btnHistorico.classList.add('btn-primary');
    btnHistorico.classList.remove('btn-secondary');
    btnAtivas.classList.remove('btn-primary');
    btnAtivas.classList.add('btn-secondary');
    contentHistorico.classList.remove('hidden');
    contentAtivas.classList.add('hidden');
    loadHistoryInOS(); // Carregar histórico ao mostrar
  }
}

async function startOrder(orderId) {
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
      showNotification('OS iniciada com sucesso!', 'success');
      await loadOrders();
    } else {
      showNotification(data.error || 'Erro ao iniciar OS', 'error');
    }
  } catch (error) {
    showNotification('Erro ao iniciar OS: ' + error.message, 'error');
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
    const response = await fetch(`${API_URL}/orders/${orderId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${state.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status: 'completed' })
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
// Inventory (Almoxarifado)
async function loadInventory() {
  try {
    const response = await fetch(`${API_URL}/inventory`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await response.json();
    if (data.ok) {
      state.inventory = data.items || [];
      renderInventory();
    }
  } catch (error) {
    console.error('Erro ao carregar inventário:', error);
  }
}

function renderInventory() {
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

// Purchases (Compras)
async function loadPurchases() {
  // TODO: Criar endpoint /purchases no backend
  const view = document.getElementById('compras-view');
  view.innerHTML = `
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Requisições de Compra</h3>
        <button class="btn-small btn-primary" onclick="alert('Nova requisição em breve')">+ Nova Requisição</button>
      </div>
      <p style="color: var(--text-secondary);">Módulo de compras será implementado em breve...</p>
    </div>
  `;
}

// Preventives (Preventivas)
async function loadPreventives() {
  // TODO: Criar endpoint /preventives no backend
  const view = document.getElementById('preventivas-view');
  view.innerHTML = `
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Manutenções Preventivas</h3>
        <button class="btn-small btn-primary" onclick="alert('Nova preventiva em breve')">+ Nova Preventiva</button>
      </div>
      <p style="color: var(--text-secondary);">Módulo de preventivas será implementado em breve...</p>
    </div>
  `;
}

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
          
          // Calcular tempo
          if (order.started_at && order.finished_at) {
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

function showNotification(message, type = 'info', duration = 5000) {
  const container = document.getElementById('notification-container');
  if (!container) return;
  
  const id = 'notif-' + Date.now();
  
  const typeIcons = {
    success: '✓',
    error: '✗',
    warning: '⚠',
    info: 'ℹ'
  };
  
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.id = id;
  notification.innerHTML = `
    <div class="notification-content">
      <span class="notification-icon">${typeIcons[type] || typeIcons.info}</span>
      <span class="notification-message">${message}</span>
      <span class="notification-close" onclick="closeNotification('${id}')">×</span>
    </div>
  `;
  
  container.appendChild(notification);
  
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
    const response = await fetch(`${API_URL}/inventory`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });

    const data = await response.json();
    if (data.ok) {
      state.inventory = data.items;
      renderInventoryTable();
    }
  } catch (error) {
    console.error('Erro ao carregar almoxarifado:', error);
    showNotification('Erro ao carregar almoxarifado', 'error');
  }
}

function renderInventoryTable() {
  const tbody = document.querySelector('#almoxarifado-table tbody');
  if (!tbody) return;

  if (state.inventory.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center">Nenhum item cadastrado</td></tr>';
    return;
  }

  const categoryLabels = {
    eletrico: 'Elétrico',
    pneumatico: 'Pneumático',
    hidraulico: 'Hidráulico',
    mecanico: 'Mecânico',
    rolamento: 'Rolamento',
    ferramenta: 'Ferramenta',
    epi: 'EPI',
    limpeza: 'Limpeza',
    outro: 'Outro'
  };

  tbody.innerHTML = state.inventory.map(item => `
    <tr onclick="showItemDetail(${item.id})" style="cursor: pointer;" title="Clique para ver detalhes">
      <td>${item.sku || '-'}</td>
      <td>${item.name}</td>
      <td><span class="badge badge-info">${categoryLabels[item.category] || item.category || '-'}</span></td>
      <td>${item.brand || '-'}</td>
      <td>
        <div style="display:flex; align-items:center; gap:6px;">
          <strong>${item.quantity}</strong>
          <span style="color: var(--text-secondary); font-size:12px;">min ${item.min_stock || 0}${item.max_stock ? ` / max ${item.max_stock}` : ''}</span>
        </div>
      </td>
      <td>${item.unit}</td>
      <td>${item.location || '-'}</td>
      <td>
        <span class="badge ${item.quantity <= (item.min_stock || 0) ? 'badge-high' : 'badge-low'}">
          ${item.quantity <= (item.min_stock || 0) ? 'Baixo' : 'OK'}
        </span>
      </td>
      <td onclick="event.stopPropagation()">
        <button class="btn-small" onclick="adjustStock(${item.id}, -1)" title="Remover 1">▼</button>
        <button class="btn-small" onclick="adjustStock(${item.id}, 1)" title="Adicionar 1">▲</button>
        <button class="btn-small btn-danger" onclick="deleteItem(${item.id})">Excluir</button>
      </td>
    </tr>
  `).join('');
}

function showItemDetail(itemId) {
  const item = state.inventory.find(i => i.id === itemId);
  if (!item) return;
  
  const specs = item.specs || 'Nenhuma especificação cadastrada';
  alert(`DETALHES DO ITEM\n\n` +
    `SKU: ${item.sku}\n` +
    `Nome: ${item.name}\n` +
    `Categoria: ${item.category}\n` +
    `Marca: ${item.brand || 'N/A'}\n` +
    `Quantidade: ${item.quantity} ${item.unit}\n` +
    `Estoque Mínimo: ${item.min_stock}\n` +
    `Estoque Máximo: ${item.max_stock || 'N/A'}\n` +
    `Localização: ${item.location || 'N/A'}\n\n` +
    `ESPECIFICAÇÕES TÉCNICAS:\n${specs}`
  );
}

function showCreateItem() {
  const modal = document.getElementById('modal-create-item');
  modal.classList.remove('hidden');
  modal.classList.add('active');
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
    const response = await fetch(`${API_URL}/purchases`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });

    const data = await response.json();
    if (data.ok) {
      state.purchases = data.purchases;
      renderPurchasesTable();
      updateFinancialDashboard();
      // await backupPurchasesToTXT(); // Desabilitado temporariamente
    }
  } catch (error) {
    console.error('Erro ao carregar compras:', error);
    showNotification('Erro ao carregar compras', 'error');
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
    return `
    <tr>
      <td>${purchase.item_name}</td>
      <td>${purchase.quantity} ${purchase.unit}</td>
      <td>R$ ${unitPrice.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</td>
      <td><strong>R$ ${totalCost.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</strong></td>
      <td>${purchase.requested_by_name || 'N/A'}</td>
      <td>
        <span class="badge ${statusClasses[purchase.status]}">
          ${statusLabels[purchase.status]}
        </span>
      </td>
      <td>${new Date(purchase.created_at).toLocaleDateString('pt-BR')}</td>
      <td>
        ${purchase.status !== 'chegou' && (state.user.username === 'joacir' || state.user.roles.includes('admin')) ? `
          <button class="btn-small" onclick="showAdvancePurchaseModal('${purchase.id}')">
            Avançar
          </button>
        ` : ''}
        ${purchase.requested_by === state.user.id || state.user.roles.includes('admin') ? `
          <button class="btn-small btn-danger" onclick="deletePurchase('${purchase.id}')">Excluir</button>
        ` : ''}
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
  
  // Converter foto para base64 se existir
  let photoUrl = null;
  const photoInput = document.getElementById('purchase-photo');
  if (photoInput && photoInput.files && photoInput.files[0]) {
    const file = photoInput.files[0];
    // Limitar tamanho a 500KB para não sobrecarregar
    if (file.size > 500 * 1024) {
      showNotification('Imagem muito grande. Máximo 500KB.', 'error');
      return;
    }
    photoUrl = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(file);
    });
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
    const response = await fetch(`${API_URL}/preventives`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });

    const data = await response.json();
    if (data.ok) {
      state.preventives = data.preventives || [];
      renderPreventivesTable();
      updatePreventiveDashboard();
    }
  } catch (error) {
    console.error('Erro ao carregar preventivas:', error);
    showNotification('Erro ao carregar preventivas', 'error');
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
          <span style="color: var(--accent-gold); font-weight: bold;">[${r.type}]</span> ${r.title}
          ${r.id ? `<span style="color: var(--text-secondary); font-size: 12px;"> • ${r.id}</span>` : ''}
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
    createBtn.style.display = canEdit ? 'block' : 'none';
  }
  
  if (state.checklists.length === 0) {
    container.innerHTML = '<p style="color: var(--text-secondary); padding: 20px; text-align: center;">Nenhum checklist cadastrado</p>';
    return;
  }
  
  const frequencyLabels = {
    diario: 'Diário',
    semanal: 'Semanal',
    mensal: 'Mensal'
  };
  
  container.innerHTML = state.checklists.map(cl => `
    <div class="checklist-card" style="background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 10px; padding: 16px; margin-bottom: 12px;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
        <div>
          <h4 style="margin: 0 0 4px 0; color: var(--text-primary);">${cl.name}</h4>
          <p style="margin: 0; font-size: 12px; color: var(--text-secondary);">
            ${cl.sector || 'Sem setor'} • ${frequencyLabels[cl.frequency] || cl.frequency} • ${cl.items?.length || 0} itens
          </p>
        </div>
        <span class="badge" style="background: rgba(212, 175, 55, 0.2); color: var(--accent-gold);">
          ${frequencyLabels[cl.frequency] || cl.frequency}
        </span>
      </div>
      
      ${cl.description ? `<p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 12px;">${cl.description}</p>` : ''}
      
      <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px;">
        ${(cl.items || []).slice(0, 4).map(item => `
          <span style="font-size: 11px; padding: 4px 8px; background: var(--bg-card); border-radius: 4px; color: var(--text-secondary);">
            ☐ ${item.description}
          </span>
        `).join('')}
        ${(cl.items?.length || 0) > 4 ? `<span style="font-size: 11px; padding: 4px 8px; color: var(--text-secondary);">+${cl.items.length - 4} mais</span>` : ''}
      </div>
      
      <div style="display: flex; gap: 8px;">
        <button class="btn-small btn-primary" onclick="openExecuteChecklist('${cl.id}')">☑ Executar</button>
        <button class="btn-small" onclick="viewChecklistHistory('${cl.id}')">Histórico</button>
        ${canEdit ? `
          <button class="btn-small" onclick="editChecklist('${cl.id}')">Editar</button>
          <button class="btn-small btn-danger" onclick="deleteChecklist('${cl.id}')">Excluir</button>
        ` : ''}
      </div>
    </div>
  `).join('');
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
  
  const container = document.getElementById('execute-checklist-items');
  container.innerHTML = (checklist.items || []).map((item, idx) => `
    <div class="checkbox-item" style="margin-bottom: 8px;">
      <input type="checkbox" id="exec-item-${idx}" data-item-id="${item.id}">
      <label for="exec-item-${idx}" style="flex: 1;">${item.description}</label>
    </div>
  `).join('');
  
  const modal = document.getElementById('modal-execute-checklist');
  modal.classList.remove('hidden');
  modal.classList.add('active');
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
      closeModal('modal-execute-checklist');
      showNotification('Checklist executado com sucesso!', 'success');
    } else {
      showNotification(data.error || 'Erro ao executar checklist', 'error');
    }
  } catch (error) {
    showNotification('Erro ao executar checklist: ' + error.message, 'error');
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
                <strong>${exec.executed_by_name || 'Usuário'}</strong>
                <span style="font-size: 12px; color: var(--text-secondary);">${formatDate(exec.executed_at)}</span>
              </div>
              <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                ${(exec.items || []).map(item => `
                  <span style="font-size: 11px; padding: 3px 6px; background: ${item.checked ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)'}; color: ${item.checked ? 'var(--success)' : 'var(--danger)'}; border-radius: 4px;">
                    ${item.checked ? '✓' : '✗'} ${item.description}
                  </span>
                `).join('')}
              </div>
              ${exec.notes ? `<p style="font-size: 12px; color: var(--text-secondary); margin-top: 8px;">${exec.notes}</p>` : ''}
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
state.waterPeriod = 'week';
state.waterStats = null;

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
    
    // Definir data de hoje no input (formato local correto)
    if (canEdit) {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const today = `${year}-${month}-${day}`;
      
      const dateInput = document.getElementById('water-reading-date');
      if (dateInput) dateInput.value = today;
      
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
    const response = await fetch(`${API_URL}/water-readings`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    
    const data = await response.json();
    if (data.ok) {
      state.waterReadings = data.readings || [];
    }
  } catch (error) {
    console.error('Erro ao carregar leituras:', error);
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
  
  // Obter data mais recente das leituras
  const sortedReadings = [...readings].sort((a, b) => {
    const dateCompare = getDateKey(b.reading_date).localeCompare(getDateKey(a.reading_date));
    if (dateCompare !== 0) return dateCompare;
    return b.reading_time.localeCompare(a.reading_time);
  });
  
  // Data de hoje
  const today = new Date();
  const todayKey = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
  
  ['aviarios', 'recria'].forEach(tank => {
    const tankReadings = sortedReadings.filter(r => r.tank_name === tank);
    
    // Pegar data mais recente do tanque
    const latestDate = tankReadings.length > 0 ? getDateKey(tankReadings[0].reading_date) : null;
    const isToday = latestDate === todayKey;
    
    // Pegar leituras da data mais recente
    const leitura7h = tankReadings.find(r => r.reading_time === '07:00' && getDateKey(r.reading_date) === latestDate);
    const leitura16h = tankReadings.find(r => r.reading_time === '16:00' && getDateKey(r.reading_date) === latestDate);
    
    // Atualizar leituras
    const el7h = document.getElementById(`${tank}-leitura-7h`);
    const el16h = document.getElementById(`${tank}-leitura-16h`);
    
    if (el7h) {
      if (leitura7h) {
        el7h.textContent = Math.round(leitura7h.reading_value).toLocaleString('pt-BR');
      } else if (isToday) {
        el7h.innerHTML = '<span style="color: #eab308;">Pendente</span>';
      } else {
        el7h.textContent = '--';
      }
    }
    if (el16h) {
      if (leitura16h) {
        el16h.textContent = Math.round(leitura16h.reading_value).toLocaleString('pt-BR');
      } else if (isToday || (leitura7h && !leitura16h)) {
        // Pendente se é hoje ou se tem 7h mas não tem 16h
        el16h.innerHTML = '<span style="color: #eab308;">Pendente</span>';
      } else {
        el16h.textContent = '--';
      }
    }
    
    // Calcular consumo do período de trabalho (7h-16h = 9 horas) - só se ambos existem
    let consumoTrabalho = '--';
    let ltHoraTrabalho = '--';
    if (leitura7h && leitura16h && getDateKey(leitura7h.reading_date) === getDateKey(leitura16h.reading_date)) {
      const diff = leitura16h.reading_value - leitura7h.reading_value;
      if (diff >= 0) {
        consumoTrabalho = diff.toFixed(0);
        ltHoraTrabalho = Math.round((diff * 1000) / 9).toLocaleString('pt-BR');
      }
    }
    
    const elConsumoTrab = document.getElementById(`${tank}-consumo-trabalho`);
    const elLtHoraTrab = document.getElementById(`${tank}-lt-hora-trabalho`);
    if (elConsumoTrab) elConsumoTrab.textContent = consumoTrabalho;
    if (elLtHoraTrab) elLtHoraTrab.textContent = ltHoraTrabalho;
    
    // Calcular consumo 24h do ÚLTIMO DIA COMPLETO
    // Consumo do dia X = Leitura 7h do dia (X+1) - Leitura 7h do dia X
    // Se hoje é 31, mostramos consumo do dia 30 (leitura 7h dia 31 - leitura 7h dia 30)
    // Só mostramos se latestDate é hoje (temos leitura de hoje) para calcular o dia anterior
    let consumo24h = '--';
    let ltHora24h = '--';
    
    const today = new Date().toISOString().split('T')[0];
    
    if (leitura7h && latestDate === today) {
      // Calcular consumo do dia anterior (ontem)
      const parts = latestDate.split('-');
      const latestDateObj = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]), 12, 0, 0);
      latestDateObj.setDate(latestDateObj.getDate() - 1);
      const prevDayKey = latestDateObj.getFullYear() + '-' + String(latestDateObj.getMonth() + 1).padStart(2, '0') + '-' + String(latestDateObj.getDate()).padStart(2, '0');
      
      const leitura7hOntem = tankReadings.find(r => r.reading_time === '07:00' && getDateKey(r.reading_date) === prevDayKey);
      
      if (leitura7hOntem) {
        // Consumo do dia de ONTEM = leitura 7h HOJE - leitura 7h ONTEM
        const diff = leitura7h.reading_value - leitura7hOntem.reading_value;
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
  
  // Comparativo - usar leituras do período selecionado
  const aviariosReadings = sortedReadings.filter(r => r.tank_name === 'aviarios');
  const recriaReadings = sortedReadings.filter(r => r.tank_name === 'recria');
  
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
  
  // Atualizar card de Maior Consumo (Pico)
  const elPicoAviariosValor = document.getElementById('pico-aviarios-valor');
  const elPicoAviariosData = document.getElementById('pico-aviarios-data');
  const elPicoRecriaValor = document.getElementById('pico-recria-valor');
  const elPicoRecriaData = document.getElementById('pico-recria-data');
  
  if (elPicoAviariosValor) elPicoAviariosValor.textContent = picoAviarios.valor > 0 ? picoAviarios.valor.toFixed(0) : '--';
  if (elPicoAviariosData) elPicoAviariosData.textContent = picoAviarios.data;
  if (elPicoRecriaValor) elPicoRecriaValor.textContent = picoRecria.valor > 0 ? picoRecria.valor.toFixed(0) : '--';
  if (elPicoRecriaData) elPicoRecriaData.textContent = picoRecria.data;
  
  // Mini charts - gerar a partir das leituras filtradas pelo período
  const period = state.waterPeriod || 'today';
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
  
  // Calcular consumo diário a partir das leituras 7h
  function calcularConsumos(tank) {
    var tankReadings = readings
      .filter(function(r) { return r.tank_name === tank && r.reading_time === '07:00'; })
      .sort(function(a, b) { return getDateKey(a.reading_date).localeCompare(getDateKey(b.reading_date)); });
    
    var consumos = {};
    for (var i = 1; i < tankReadings.length; i++) {
      var diff = tankReadings[i].reading_value - tankReadings[i-1].reading_value;
      if (diff >= 0) {
        var dateKey = getDateKey(tankReadings[i].reading_date);
        consumos[dateKey] = diff;
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
  
  // Calcular consumo 24h para cada leitura das 7h
  // Consumo 24h do dia X = Leitura 7h do dia (X+1) - Leitura 7h do dia X
  // Ou seja, só podemos mostrar consumo 24h se tivermos a leitura do dia SEGUINTE
  const today = new Date().toISOString().split('T')[0];
  
  // Criar mapa de datas únicas para cores alternadas
  const uniqueDates = [...new Set(sorted.map(r => r.reading_date.split('T')[0]))];
  const dateColorMap = {};
  uniqueDates.forEach((date, index) => {
    dateColorMap[date] = index % 2 === 0 ? 'day-even' : 'day-odd';
  });
  
  tbody.innerHTML = sorted.slice(0, 50).map((reading) => {
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
    } else {
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
    
    return '<tr class="' + dayClass + '">' +
      '<td>' + date + '</td>' +
      '<td><span style="color: var(--text-secondary); font-size: 11px;">' + dayOfWeek + '</span></td>' +
      '<td>' + reading.reading_time + '</td>' +
      '<td><span class="tank-badge ' + tankClass + '">' + tankLabel + '</span></td>' +
      '<td><strong>' + reading.reading_value.toFixed(0) + '</strong></td>' +
      '<td>' + consumption + '</td>' +
      '<td>' + (reading.recorded_by_name || '-') + '</td>' +
      '<td>' + (reading.notes || '-') + '</td>' +
      '</tr>';
  }).join('');
}

// Filtrar histórico
function filterWaterHistory() {
  renderWaterHistory();
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
  const notes = document.getElementById('water-reading-notes').value;
  
  if (!date || !time) {
    showNotification('Preencha a data e horário', 'error');
    return;
  }
  
  if (!aviariosValue && !recriaValue) {
    showNotification('Preencha pelo menos uma leitura', 'error');
    return;
  }
  
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
    document.getElementById('water-reading-notes').value = '';
    
    // Recarregar dados
    await loadWaterReadings();
    await loadWaterStats();
    renderWaterStats();
    renderWaterChart();
    renderWaterHistory();
    checkWaterAlerts();
    
    showNotification('Leitura salva com sucesso! 💧', 'success');
    
  } catch (error) {
    showNotification('Erro ao salvar leitura: ' + error.message, 'error');
  }
}

// Exportar relatório PDF
function exportWaterReportPDF() {
  // Preparar dados
  const stats = state.waterStats;
  const readings = state.waterReadings || [];
  
  if (readings.length === 0) {
    showNotification('Nenhum dado para exportar', 'warning');
    return;
  }
  
  // Função para formatar data corretamente (evitar timezone issues)
  function formatDatePDF(dateStr) {
    var parts = dateStr.split('T')[0].split('-');
    var year = parseInt(parts[0]);
    var month = parseInt(parts[1]) - 1;
    var day = parseInt(parts[2]);
    var date = new Date(year, month, day, 12, 0, 0);
    var dayOfWeek = date.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '').toUpperCase();
    var formatted = date.toLocaleDateString('pt-BR');
    return { formatted: formatted, dayOfWeek: dayOfWeek, dateObj: date };
  }
  
  // Calcular período real baseado nas leituras
  var sortedReadings = [...readings].sort(function(a, b) {
    return formatDatePDF(a.reading_date).dateObj - formatDatePDF(b.reading_date).dateObj;
  });
  
  var firstDateInfo = sortedReadings.length > 0 ? formatDatePDF(sortedReadings[0].reading_date) : { formatted: new Date().toLocaleDateString('pt-BR') };
  var lastDateInfo = sortedReadings.length > 0 ? formatDatePDF(sortedReadings[sortedReadings.length - 1].reading_date) : { formatted: new Date().toLocaleDateString('pt-BR') };
  
  var periodStr = firstDateInfo.formatted === lastDateInfo.formatted ? firstDateInfo.formatted : firstDateInfo.formatted + ' a ' + lastDateInfo.formatted;
  
  // Calcular consumos corretamente (leitura nova - leitura antiga por tanque)
  var calculateConsumption = function(tank) {
    var tankReadings = sortedReadings
      .filter(function(r) { return r.tank_name === tank && r.reading_time === '07:00'; })
      .sort(function(a, b) { return formatDatePDF(a.reading_date).dateObj - formatDatePDF(b.reading_date).dateObj; });
    
    if (tankReadings.length < 2) return { total: 0, avg: 0, days: 0 };
    
    var total = 0;
    var count = 0;
    for (var i = 1; i < tankReadings.length; i++) {
      var diff = tankReadings[i].reading_value - tankReadings[i-1].reading_value;
      if (diff >= 0) {
        total += diff;
        count++;
      }
    }
    
    return { total: total, avg: count > 0 ? total / count : 0, days: count };
  };
  
  var aviariosCalc = calculateConsumption('aviarios');
  var recriaCalc = calculateConsumption('recria');
  var totalConsumo = aviariosCalc.total + recriaCalc.total;
  
  // Usar dados calculados diretamente
  var aviariosAvg = aviariosCalc.avg;
  var recriaAvg = recriaCalc.avg;
  var aviariosTotal = aviariosCalc.total;
  var recriaTotal = recriaCalc.total;
  
  // Criar conteúdo HTML para impressão
  const content = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Relatório de Controle de Água - Granja Vitta</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 40px; color: #333; }
        .header { text-align: center; margin-bottom: 40px; border-bottom: 3px solid #1a1a2e; padding-bottom: 20px; }
        .header h1 { color: #1a1a2e; margin: 0; font-size: 28px; }
        .header .subtitle { color: #666; margin: 10px 0 0 0; font-size: 14px; }
        .header .period { color: #888; font-size: 12px; margin-top: 5px; }
        .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 30px; }
        .stat-box { background: #f8f9fa; border: 1px solid #e0e0e0; border-radius: 8px; padding: 15px; text-align: center; }
        .stat-box h3 { margin: 0 0 10px 0; color: #333; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
        .stat-box .value { font-size: 28px; font-weight: bold; color: #1a1a2e; }
        .stat-box .label { font-size: 10px; color: #666; margin-top: 5px; }
        .section-title { color: #333; border-bottom: 2px solid #eee; padding-bottom: 10px; font-size: 16px; margin-top: 30px; }
        table { width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 10px; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background: #1a1a2e; color: white; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px; }
        tr:nth-child(even) { background: #f8f9fa; }
        .footer { margin-top: 40px; text-align: center; font-size: 10px; color: #999; border-top: 1px solid #eee; padding-top: 20px; }
        .tank-aviarios { color: #1a1a2e; font-weight: 600; }
        .tank-recria { color: #2d5a27; font-weight: 600; }
        @media print { body { padding: 20px; } @page { size: A4; margin: 15mm; } }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>RELATÓRIO DE CONTROLE DE ÁGUA</h1>
        <p class="subtitle"><strong>Granja Vitta</strong> — Sistema Icarus</p>
        <p class="period">Período: ${periodStr} | Gerado em: ${new Date().toLocaleString('pt-BR')}</p>
      </div>
      
      <h2 class="section-title">RESUMO DE CONSUMO</h2>
      <div class="stats-grid">
        <div class="stat-box">
          <h3>Aviários (Média)</h3>
          <div class="value">${aviariosAvg.toFixed(2)}</div>
          <div class="label">m³/dia</div>
        </div>
        <div class="stat-box">
          <h3>Recria (Média)</h3>
          <div class="value">${recriaAvg.toFixed(2)}</div>
          <div class="label">m³/dia</div>
        </div>
        <div class="stat-box">
          <h3>Total Aviários</h3>
          <div class="value">${aviariosTotal.toFixed(2)}</div>
          <div class="label">m³ consumidos</div>
        </div>
        <div class="stat-box">
          <h3>Total Recria</h3>
          <div class="value">${recriaTotal.toFixed(2)}</div>
          <div class="label">m³ consumidos</div>
        </div>
      </div>
      
      <div class="stats-grid" style="grid-template-columns: 1fr;">
        <div class="stat-box" style="background: #1a1a2e; color: white;">
          <h3 style="color: #d4af37;">CONSUMO TOTAL DO PERÍODO</h3>
          <div class="value" style="color: #d4af37; font-size: 42px;">${(aviariosTotal + recriaTotal).toFixed(2)} m³</div>
          <div class="label" style="color: #aaa;">${readings.length} leituras registradas</div>
        </div>
      </div>
      
      <h2 class="section-title">HISTÓRICO DE LEITURAS</h2>
      <table>
        <thead>
          <tr>
            <th>Data</th>
            <th>Dia</th>
            <th>Horário</th>
            <th>Caixa</th>
            <th>Leitura (m³)</th>
            <th>Registrado por</th>
            <th>Observações</th>
          </tr>
        </thead>
        <tbody>
          ${sortedReadings.slice(-50).reverse().map(function(r) {
            var dateInfo = formatDatePDF(r.reading_date);
            return '<tr>' +
              '<td>' + dateInfo.formatted + '</td>' +
              '<td style="color: #888; font-size: 9px;">' + dateInfo.dayOfWeek + '</td>' +
              '<td>' + r.reading_time + '</td>' +
              '<td class="tank-' + r.tank_name + '">' + (r.tank_name === 'aviarios' ? 'Aviários' : 'Recria') + '</td>' +
              '<td><strong>' + r.reading_value.toFixed(3) + '</strong></td>' +
              '<td>' + (r.recorded_by_name || '-') + '</td>' +
              '<td>' + (r.notes || '-') + '</td>' +
            '</tr>';
          }).join('')}
        </tbody>
      </table>
      
      <div class="footer">
        <p>Relatório gerado automaticamente pelo Sistema Icarus | Granja Vitta</p>
        <p>Desenvolvido por Guilherme Braga | © 2025</p>
      </div>
    </body>
    </html>
  `;
  
  // Abrir janela de impressão
  const printWindow = window.open('', '_blank');
  printWindow.document.write(content);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => {
    printWindow.print();
  }, 500);
  
  showNotification('Relatório PDF gerado!', 'success');
}

// Exportar relatório Excel (CSV) - Formato oficial Granja Vitta
function exportWaterReportExcel() {
  var readings = state.waterReadings;
  
  if (readings.length === 0) {
    showNotification('Nenhum dado para exportar', 'warning');
    return;
  }
  
  // Função para formatar data corretamente (evitar timezone issues)
  function formatDateExcel(dateStr) {
    var parts = dateStr.split('T')[0].split('-');
    var year = parseInt(parts[0]);
    var month = parseInt(parts[1]) - 1;
    var day = parseInt(parts[2]);
    var date = new Date(year, month, day, 12, 0, 0);
    var dayOfWeek = date.toLocaleDateString('pt-BR', { weekday: 'long' }).toUpperCase().split('-')[0];
    var formatted = date.toLocaleDateString('pt-BR');
    return { formatted: formatted, dayOfWeek: dayOfWeek, dateObj: date, key: parts.join('-') };
  }
  
  // Agrupar leituras por dia e calcular consumo
  var dailyData = {};
  var sortedReadings = [...readings].sort(function(a, b) {
    return formatDateExcel(a.reading_date).key.localeCompare(formatDateExcel(b.reading_date).key);
  });
  
  sortedReadings.forEach(function(r) {
    var dateInfo = formatDateExcel(r.reading_date);
    var dateKey = dateInfo.key;
    
    if (!dailyData[dateKey]) {
      dailyData[dateKey] = { aviarios: {}, recria: {}, dateFormatted: dateInfo.formatted, dayOfWeek: dateInfo.dayOfWeek };
    }
    var timeKey = r.reading_time === '07:00' ? 'am' : 'pm';
    dailyData[dateKey][r.tank_name][timeKey] = r.reading_value;
  });
  
  // Gerar linhas no formato da planilha oficial
  var rows = [];
  var dates = Object.keys(dailyData).sort();
  
  dates.forEach(function(dateStr, idx) {
    var data = dailyData[dateStr];
    var formattedDate = data.dateFormatted;
    var dayOfWeek = data.dayOfWeek;
    
    // Próximo dia para calcular consumo 24h
    var nextDate = dates[idx + 1];
    var nextData = nextDate ? dailyData[nextDate] : null;
    
    // RECRIA - 7AM-4PM (período de trabalho)
    if (data.recria.am !== undefined && data.recria.pm !== undefined) {
      const consumoM3 = data.recria.pm - data.recria.am;
      const consumoLitros = consumoM3 * 1000;
      const ltPorHora = Math.round(consumoLitros / 9); // 9 horas de trabalho
      rows.push([
        formattedDate, dayOfWeek, 'RECRIA', '7AM - 4PM',
        `${Math.round(data.recria.am)} - ${Math.round(data.recria.pm)}`,
        ltPorHora,
        consumoLitros.toFixed(0),
        'TRABALHO'
      ]);
    }
    
    // AVIARIOS - 7AM-4PM (período de trabalho)
    if (data.aviarios.am !== undefined && data.aviarios.pm !== undefined) {
      const consumoM3 = data.aviarios.pm - data.aviarios.am;
      const consumoLitros = consumoM3 * 1000;
      const ltPorHora = Math.round(consumoLitros / 9);
      rows.push([
        formattedDate, dayOfWeek, 'AVIARIOS', '7AM - 4PM',
        `${Math.round(data.aviarios.am)} - ${Math.round(data.aviarios.pm)}`,
        ltPorHora,
        consumoLitros.toFixed(0),
        'TRABALHO'
      ]);
    }
    
    // RECRIA - 24H (7h dia X até 7h dia X+1 = consumo do dia X)
    if (data.recria.am !== undefined && nextData?.recria?.am !== undefined) {
      const consumoM3 = nextData.recria.am - data.recria.am;
      const consumoLitros = consumoM3 * 1000;
      const ltPorHora = Math.round(consumoLitros / 24);
      rows.push([
        formattedDate, dayOfWeek, 'RECRIA', '24H',
        `${Math.round(data.recria.am)} - ${Math.round(nextData.recria.am)}`,
        ltPorHora,
        consumoLitros.toFixed(0),
        'DIARIO'
      ]);
    }
    
    // AVIARIOS - 24H (7h dia X até 7h dia X+1 = consumo do dia X)
    if (data.aviarios.am !== undefined && nextData?.aviarios?.am !== undefined) {
      const consumoM3 = nextData.aviarios.am - data.aviarios.am;
      const consumoLitros = consumoM3 * 1000;
      const ltPorHora = Math.round(consumoLitros / 24);
      rows.push([
        formattedDate, dayOfWeek, 'AVIARIOS', '24H',
        `${Math.round(data.aviarios.am)} - ${Math.round(nextData.aviarios.am)}`,
        ltPorHora,
        consumoLitros.toFixed(0),
        'DIARIO'
      ]);
    }
  });
  
  // Criar CSV no formato oficial
  const headers = ['DATA', 'DIA/SEMANA', 'CAIXA', 'HORAS', 'ENTRADA H (M³)', 'LT POR HORA', 'LT TOTAL', 'PERIODO'];
  
  const csv = [
    headers.join(';'),
    ...rows.map(row => row.join(';'))
  ].join('\n');
  
  // Criar blob e baixar
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `CONTROLE_DE_AGUA_GRANJA_VITTA_${new Date().toISOString().split('T')[0]}.csv`;
  link.click();
  
  showNotification('Planilha exportada com sucesso!', 'success');
  
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
    
    // Definir data de hoje no input
    var now = new Date();
    var year = now.getFullYear();
    var month = String(now.getMonth() + 1).padStart(2, '0');
    var day = String(now.getDate()).padStart(2, '0');
    var today = year + '-' + month + '-' + day;
    
    var dateInput = document.getElementById('diesel-date');
    if (dateInput) dateInput.value = today;
    
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
  
  // Limites de alerta
  var LIMITE_CRITICO = 50;   // Crítico - vermelho
  var LIMITE_BAIXO = 100;    // Baixo - amarelo/laranja
  var LIMITE_ATENCAO = 200;  // Atenção - amarelo
  
  if (saldo <= 0) {
    container.innerHTML = '<div class="water-alert" style="background: linear-gradient(135deg, #f93943, #dc2626); border: 1px solid #f93943;"><div class="alert-icon">🚨</div><div class="alert-content"><strong>DIESEL ACABOU!</strong><span>Estoque zerado! Abasteça imediatamente.</span></div></div>';
  } else if (saldo <= LIMITE_CRITICO) {
    container.innerHTML = '<div class="water-alert" style="background: linear-gradient(135deg, #f93943, #dc2626); border: 1px solid #f93943;"><div class="alert-icon">⚠️</div><div class="alert-content"><strong>Estoque CRÍTICO!</strong><span>Apenas ' + saldo.toLocaleString('pt-BR') + ' L restantes. Abasteça urgente!</span></div></div>';
  } else if (saldo <= LIMITE_BAIXO) {
    container.innerHTML = '<div class="water-alert" style="background: linear-gradient(135deg, #f97316, #ea580c); border: 1px solid #f97316;"><div class="alert-icon">⚠️</div><div class="alert-content"><strong>Estoque BAIXO</strong><span>' + saldo.toLocaleString('pt-BR') + ' L restantes. Programe abastecimento.</span></div></div>';
  } else if (saldo <= LIMITE_ATENCAO) {
    container.innerHTML = '<div class="water-alert" style="background: linear-gradient(135deg, #eab308, #ca8a04); border: 1px solid #eab308;"><div class="alert-icon">📊</div><div class="alert-content"><strong>Estoque em atenção</strong><span>' + saldo.toLocaleString('pt-BR') + ' L restantes.</span></div></div>';
  } else {
    container.innerHTML = '<div class="water-alert" style="background: linear-gradient(135deg, #22c55e, #16a34a); border: 1px solid #22c55e;"><div class="alert-icon">✅</div><div class="alert-content"><strong>Estoque OK</strong><span>' + saldo.toLocaleString('pt-BR') + ' L disponíveis.</span></div></div>';
  }
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
    
    html += '<tr>';
    html += '<td>' + formattedDate + '</td>';
    html += '<td><span style="color: var(--text-secondary); font-size: 11px;">' + diaSemana + '</span></td>';
    html += '<td><span class="badge ' + typeClass + '">' + typeLabel + '</span></td>';
    html += '<td><strong>' + (parseFloat(r.quantity) || 0).toLocaleString('pt-BR') + ' L</strong></td>';
    html += '<td>' + (r.reason || '-') + '</td>';
    html += '<td>' + (r.recorded_by_name || '-') + '</td>';
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
  
  // Ordenar registros
  var sorted = records.slice().sort(function(a, b) {
    return (a.record_date || '').localeCompare(b.record_date || '');
  });
  
  // Cabeçalhos
  var headers = ['DATA', 'TIPO', 'QUANTIDADE (L)', 'MOTIVO', 'REGISTRADO POR', 'OBSERVACOES'];
  
  // Linhas de dados
  var rows = sorted.map(function(r) {
    var dateStr = r.record_date ? r.record_date.split('T')[0] : '';
    var parts = dateStr.split('-');
    var formattedDate = parts.length === 3 ? (parts[2] + '/' + parts[1] + '/' + parts[0]) : dateStr;
    var typeLabel = r.record_type === 'entrada' ? 'ENTRADA' : 'SAIDA';
    
    return [
      formattedDate,
      typeLabel,
      (parseFloat(r.quantity) || 0).toString(),
      r.reason || '',
      r.recorded_by_name || '',
      r.notes || ''
    ].join(';');
  });
  
  var csv = headers.join(';') + '\n' + rows.join('\n');
  
  // Criar blob e baixar
  var blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  var link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'CONTROLE_DIESEL_GRANJA_VITTA_' + new Date().toISOString().split('T')[0] + '.csv';
  link.click();
  
  showNotification('Planilha exportada com sucesso!', 'success');
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
  const filter = state.dashboardFilter || 'daily';
  
  // Calcular estatísticas
  const today = new Date();
  let startDate = new Date(today);
  let periodLabel = 'Hoje';
  
  if (filter === 'weekly') {
    startDate.setDate(today.getDate() - 7);
    periodLabel = 'Última Semana';
  } else if (filter === 'monthly') {
    startDate.setMonth(today.getMonth() - 1);
    periodLabel = 'Último Mês';
  }
  
  const filteredOrders = orders.filter(o => {
    const created = new Date(o.created_at);
    return created >= startDate;
  });
  
  const pending = filteredOrders.filter(o => o.status === 'pendente').length;
  const inProgress = filteredOrders.filter(o => o.status === 'em_andamento').length;
  const completed = filteredOrders.filter(o => o.status === 'concluida').length;
  const total = filteredOrders.length;
  const aproveitamento = total > 0 ? Math.round((completed / total) * 100) : 0;
  
  // Agrupar por executor
  const byExecutor = {};
  filteredOrders.forEach(o => {
    const name = o.executor_name || 'Não atribuído';
    if (!byExecutor[name]) byExecutor[name] = { total: 0, completed: 0 };
    byExecutor[name].total++;
    if (o.status === 'concluida') byExecutor[name].completed++;
  });
  
  // Agrupar por setor
  const bySetor = {};
  filteredOrders.forEach(o => {
    const setor = o.setor || 'Não especificado';
    if (!bySetor[setor]) bySetor[setor] = 0;
    bySetor[setor]++;
  });

  const htmlContent = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Relatório Dashboard - Granja Vitta</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: 'Segoe UI', system-ui, sans-serif; 
      background: linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 100%);
      color: #fff;
      min-height: 100vh;
      padding: 40px;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    .header {
      text-align: center;
      padding: 40px;
      background: linear-gradient(135deg, rgba(212, 175, 55, 0.15) 0%, rgba(212, 175, 55, 0.02) 100%);
      border: 1px solid rgba(212, 175, 55, 0.3);
      border-radius: 20px;
      margin-bottom: 30px;
    }
    .header h1 { font-size: 36px; color: #d4af37; margin-bottom: 10px; letter-spacing: 2px; }
    .header p { color: #888; }
    .stats-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 15px; margin-bottom: 30px; }
    .stat-card {
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 16px;
      padding: 25px;
      text-align: center;
    }
    .stat-card.gold { border-color: rgba(212, 175, 55, 0.5); }
    .stat-card h3 { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
    .stat-card .value { font-size: 42px; font-weight: 700; }
    .stat-card .value.gold { color: #d4af37; }
    .stat-card .value.green { color: #10b981; }
    .stat-card .value.blue { color: #3b82f6; }
    .stat-card .value.orange { color: #f59e0b; }
    .charts-row { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; }
    .chart-card {
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 16px;
      padding: 25px;
    }
    .chart-card h3 { margin-bottom: 20px; color: #fff; font-size: 16px; }
    .table-card {
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 16px;
      overflow: hidden;
    }
    .table-card h3 { padding: 20px 25px; border-bottom: 1px solid rgba(255,255,255,0.1); }
    table { width: 100%; border-collapse: collapse; }
    th { background: rgba(212, 175, 55, 0.15); color: #d4af37; padding: 12px 15px; text-align: left; font-size: 11px; text-transform: uppercase; }
    td { padding: 12px 15px; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 13px; }
    .progress-bar { height: 8px; background: rgba(255,255,255,0.1); border-radius: 4px; overflow: hidden; }
    .progress-fill { height: 100%; background: linear-gradient(90deg, #d4af37, #f0d060); border-radius: 4px; }
    .footer { text-align: center; padding: 30px; color: #666; font-size: 12px; }
    @media print { body { background: #fff; color: #333; } .stat-card { border-color: #ddd; } }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📊 RELATÓRIO DASHBOARD</h1>
      <p><strong>Granja Vitta</strong> • Sistema Icarus • ${periodLabel}</p>
      <p style="margin-top: 10px; color: #666;">Gerado em ${new Date().toLocaleString('pt-BR')}</p>
    </div>

    <div class="stats-grid">
      <div class="stat-card gold">
        <h3>Total de OS</h3>
        <div class="value gold">${total}</div>
      </div>
      <div class="stat-card">
        <h3>Pendentes</h3>
        <div class="value orange">${pending}</div>
      </div>
      <div class="stat-card">
        <h3>Em Andamento</h3>
        <div class="value blue">${inProgress}</div>
      </div>
      <div class="stat-card">
        <h3>Concluídas</h3>
        <div class="value green">${completed}</div>
      </div>
      <div class="stat-card gold">
        <h3>Aproveitamento</h3>
        <div class="value gold">${aproveitamento}%</div>
      </div>
    </div>

    <div class="charts-row">
      <div class="chart-card">
        <h3>📈 Desempenho por Executor</h3>
        <canvas id="executorChart"></canvas>
      </div>
      <div class="chart-card">
        <h3>📊 Ordens por Setor</h3>
        <canvas id="setorChart"></canvas>
      </div>
    </div>

    <div class="table-card">
      <h3>👥 Produtividade da Equipe</h3>
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
                <td>${perc}%</td>
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

    <div class="footer">
      <button onclick="window.print()" class="print-btn">🖨️ Imprimir / Salvar PDF</button>
      <p>Relatório gerado automaticamente pelo Sistema Icarus • Granja Vitta</p>
      <p>Desenvolvido por Guilherme Braga • © 2025</p>
    </div>
  </div>

  <style>
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
      transition: transform 0.2s;
    }
    .print-btn:hover { transform: scale(1.05); }
    @media print { 
      .print-btn { display: none; }
      body { background: #fff !important; color: #333 !important; }
      .stat-card, .chart-card, .table-card { border-color: #ddd !important; }
      .stat-card .value { color: #333 !important; }
      .stat-card.gold .value, .value.gold { color: #b8942e !important; }
      .header { background: #f5f5f5 !important; border-color: #b8942e !important; }
      .header h1 { color: #b8942e !important; }
    }
  </style>

  <script>
    const executorData = ${JSON.stringify(byExecutor)};
    const setorData = ${JSON.stringify(bySetor)};

    // Gráfico de Executores
    new Chart(document.getElementById('executorChart'), {
      type: 'bar',
      data: {
        labels: Object.keys(executorData),
        datasets: [{
          label: 'Concluídas',
          data: Object.values(executorData).map(d => d.completed),
          backgroundColor: 'rgba(16, 185, 129, 0.7)',
          borderRadius: 6
        }, {
          label: 'Total',
          data: Object.values(executorData).map(d => d.total),
          backgroundColor: 'rgba(212, 175, 55, 0.7)',
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { labels: { color: '#888' } } },
        scales: {
          x: { ticks: { color: '#888' }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: { ticks: { color: '#888' }, grid: { color: 'rgba(255,255,255,0.05)' } }
        }
      }
    });

    // Gráfico de Setores
    new Chart(document.getElementById('setorChart'), {
      type: 'doughnut',
      data: {
        labels: Object.keys(setorData),
        datasets: [{
          data: Object.values(setorData),
          backgroundColor: ['#d4af37', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4']
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'bottom', labels: { color: '#888' } } }
      }
    });
  </script>
</body>
</html>`;

  const newWindow = window.open('', '_blank');
  newWindow.document.write(htmlContent);
  newWindow.document.close();
  
  showNotification('Relatório do Dashboard gerado!', 'success');
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

  // Gerar CSV
  const csvHeaders = ['SKU', 'Nome', 'Categoria', 'Marca', 'Quantidade', 'Unidade', 'Localização', 'Custo Unit.', 'Valor Total'];
  const csvRows = items.map(i => [
    i.sku || '',
    i.name || '',
    i.category || '',
    i.brand || '',
    i.quantity || 0,
    i.unit || '',
    i.location || '',
    (i.unit_cost || 0).toFixed(2),
    ((i.quantity || 0) * (i.unit_cost || 0)).toFixed(2)
  ]);
  
  const csv = [csvHeaders.join(';'), ...csvRows.map(r => r.join(';'))].join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'ALMOXARIFADO_GRANJA_VITTA_' + new Date().toISOString().split('T')[0] + '.csv';
  link.click();

  // Gerar relatório HTML interativo
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
      '<td>' + (isLow ? '⚠️ Baixo' : '✅ OK') + '</td>' +
      '</tr>';
  });

  const htmlContent = '<!DOCTYPE html>' +
    '<html lang="pt-BR"><head><meta charset="UTF-8">' +
    '<title>Relatório Almoxarifado - Granja Vitta</title>' +
    '<script src="https://cdn.jsdelivr.net/npm/chart.js"><\/script>' +
    '<style>' +
    '* { margin: 0; padding: 0; box-sizing: border-box; }' +
    'body { font-family: "Segoe UI", system-ui, sans-serif; background: linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 100%); color: #fff; min-height: 100vh; padding: 40px; }' +
    '.container { max-width: 1400px; margin: 0 auto; }' +
    '.header { text-align: center; padding: 40px; background: linear-gradient(135deg, rgba(212, 175, 55, 0.15) 0%, rgba(212, 175, 55, 0.02) 100%); border: 1px solid rgba(212, 175, 55, 0.3); border-radius: 20px; margin-bottom: 30px; }' +
    '.header h1 { font-size: 36px; color: #d4af37; margin-bottom: 10px; }' +
    '.stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 30px; }' +
    '.stat-card { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 25px; text-align: center; }' +
    '.stat-card.gold { border-color: rgba(212, 175, 55, 0.5); }' +
    '.stat-card.danger { border-color: rgba(220, 53, 69, 0.5); }' +
    '.stat-card h3 { font-size: 11px; color: #888; text-transform: uppercase; margin-bottom: 8px; }' +
    '.stat-card .value { font-size: 42px; font-weight: 700; }' +
    '.stat-card .value.gold { color: #d4af37; }' +
    '.stat-card .value.red { color: #ef4444; }' +
    '.stat-card .value.green { color: #10b981; }' +
    '.charts-row { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; }' +
    '.chart-card { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 25px; }' +
    '.chart-card h3 { margin-bottom: 20px; }' +
    '.table-card { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; overflow: hidden; }' +
    '.table-card h3 { padding: 20px 25px; border-bottom: 1px solid rgba(255,255,255,0.1); }' +
    'table { width: 100%; border-collapse: collapse; }' +
    'th { background: rgba(212, 175, 55, 0.15); color: #d4af37; padding: 12px 15px; text-align: left; font-size: 11px; text-transform: uppercase; }' +
    'td { padding: 12px 15px; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 13px; }' +
    '.low-stock { background: rgba(220, 53, 69, 0.15); }' +
    '.footer { text-align: center; padding: 30px; color: #666; font-size: 12px; }' +
    '</style></head><body>' +
    '<div class="container">' +
    '<div class="header"><h1>📦 RELATÓRIO ALMOXARIFADO</h1><p><strong>Granja Vitta</strong> • Sistema Icarus</p><p style="margin-top: 10px; color: #666;">Gerado em ' + dateStr + '</p></div>' +
    '<div class="stats-grid">' +
    '<div class="stat-card gold"><h3>Total de Itens</h3><div class="value gold">' + totalItems + '</div></div>' +
    '<div class="stat-card danger"><h3>Estoque Baixo</h3><div class="value red">' + lowStock + '</div></div>' +
    '<div class="stat-card"><h3>Categorias</h3><div class="value green">' + categories + '</div></div>' +
    '<div class="stat-card gold"><h3>Valor Total</h3><div class="value gold">' + totalValueStr + '</div></div>' +
    '</div>' +
    '<div class="charts-row">' +
    '<div class="chart-card"><h3>📊 Itens por Categoria</h3><canvas id="categoryChart"></canvas></div>' +
    '<div class="chart-card"><h3>📈 Top 10 - Maior Quantidade</h3><canvas id="topItemsChart"></canvas></div>' +
    '</div>' +
    '<div class="table-card"><h3>📋 Lista Completa de Itens</h3>' +
    '<table><thead><tr><th>SKU</th><th>Nome</th><th>Categoria</th><th>Marca</th><th>Qtd</th><th>Unidade</th><th>Localização</th><th>Status</th></tr></thead>' +
    '<tbody>' + tableRows + '</tbody></table></div>' +
    '<div class="footer"><p>Relatório gerado automaticamente pelo Sistema Icarus • Granja Vitta</p></div>' +
    '</div>' +
    '<script>' +
    'var categoryData = ' + categoryDataJson + ';' +
    'var topItems = ' + topItemsJson + ';' +
    'new Chart(document.getElementById("categoryChart"), { type: "doughnut", data: { labels: Object.keys(categoryData), datasets: [{ data: Object.values(categoryData), backgroundColor: ["#d4af37", "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444", "#06b6d4", "#ec4899"] }] }, options: { plugins: { legend: { position: "bottom", labels: { color: "#888" } } } } });' +
    'new Chart(document.getElementById("topItemsChart"), { type: "bar", data: { labels: topItems.map(function(i) { return i.name.substring(0, 20); }), datasets: [{ label: "Quantidade", data: topItems.map(function(i) { return i.qty; }), backgroundColor: "rgba(212, 175, 55, 0.7)", borderRadius: 6 }] }, options: { indexAxis: "y", plugins: { legend: { display: false } }, scales: { x: { ticks: { color: "#888" }, grid: { color: "rgba(255,255,255,0.05)" } }, y: { ticks: { color: "#888" }, grid: { color: "rgba(255,255,255,0.05)" } } } } });' +
    '<\/script></body></html>';

  const newWindow = window.open('', '_blank');
  newWindow.document.write(htmlContent);
  newWindow.document.close();
  
  showNotification('Relatório e planilha exportados!', 'success');
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
        '</div>' +
      '</div>' +
      '<span class="task-status-badge ' + task.status + '">' + statusLabel + '</span>' +
      (state.canEditAditiva ? '<div class="task-actions">' +
        '<button class="task-action-btn" onclick="event.stopPropagation(); updateTaskStatus(\'' + task.id + '\', \'completed\')" title="Concluir">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>' +
        '</button>' +
      '</div>' : '') +
    '</div>';
  });
  
  container.innerHTML = html;
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
  var viewer = document.getElementById('report-viewer');
  if (!container) return;
  
  // Mostrar lista, esconder viewer
  container.classList.remove('hidden');
  if (viewer) viewer.classList.add('hidden');
  
  var reports = state.reports || [];
  
  if (reports.length === 0) {
    container.innerHTML = '<div style="padding: 60px; text-align: center; color: var(--text-secondary); grid-column: 1/-1;">Nenhum relatório encontrado</div>';
    return;
  }
  
  var categoryColors = {
    'geral': '#22d3ee',
    'manutencao': '#a855f7',
    'incidente': '#ef4444',
    'melhoria': '#22c55e'
  };
  
  var categoryLabels = {
    'geral': 'Geral',
    'manutencao': 'Manutenção',
    'incidente': 'Incidente',
    'melhoria': 'Melhoria'
  };
  
  var html = '';
  reports.forEach(function(report) {
    var dateStr = report.created_at ? new Date(report.created_at).toLocaleDateString('pt-BR') : '';
    var catColor = categoryColors[report.category] || '#22d3ee';
    var catLabel = categoryLabels[report.category] || 'Geral';
    var preview = (report.content || '').substring(0, 150);
    
    html += '<div class="report-card" onclick="openReport(\'' + report.id + '\')">' +
      '<div class="report-card-header">' +
        '<span class="report-card-category" style="background: rgba(' + hexToRgb(catColor) + ', 0.15); color: ' + catColor + ';">' +
          '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/></svg>' +
          catLabel +
        '</span>' +
        '<h3 class="report-card-title">' + escapeHtml(report.title) + '</h3>' +
      '</div>' +
      '<div class="report-card-body">' +
        '<p class="report-card-preview">' + escapeHtml(preview) + (report.content.length > 150 ? '...' : '') + '</p>' +
      '</div>' +
      '<div class="report-card-footer">' +
        '<div class="report-card-author">' +
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>' +
          (report.created_by_name || 'Anônimo') +
        '</div>' +
        '<span class="report-card-date">' + dateStr + '</span>' +
      '</div>' +
    '</div>';
  });
  
  container.innerHTML = html;
}

function hexToRgb(hex) {
  var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? parseInt(result[1], 16) + ', ' + parseInt(result[2], 16) + ', ' + parseInt(result[3], 16) : '34, 211, 238';
}

function setReportCategory(category) {
  state.reportCategory = category;
  
  document.querySelectorAll('.relatorios-filter-btn').forEach(function(btn) {
    btn.classList.remove('active');
  });
  event.target.classList.add('active');
  
  loadReportsData().then(renderReports);
}

function openReport(reportId) {
  var report = state.reports.find(function(r) { return r.id === reportId; });
  if (!report) return;
  
  state.currentReport = report;
  
  var container = document.getElementById('relatorios-list');
  var viewer = document.getElementById('report-viewer');
  
  if (container) container.classList.add('hidden');
  if (viewer) viewer.classList.remove('hidden');
  
  var categoryLabels = { 'geral': 'Geral', 'manutencao': 'Manutenção', 'incidente': 'Incidente', 'melhoria': 'Melhoria' };
  var dateStr = report.created_at ? new Date(report.created_at).toLocaleDateString('pt-BR') : '';
  
  document.getElementById('viewer-category').textContent = categoryLabels[report.category] || 'Geral';
  document.getElementById('viewer-date').textContent = dateStr;
  document.getElementById('viewer-title').textContent = report.title;
  document.getElementById('viewer-author').textContent = report.created_by_name || 'Anônimo';
  document.getElementById('viewer-content').textContent = report.content || '';
}

function closeReportViewer() {
  var container = document.getElementById('relatorios-list');
  var viewer = document.getElementById('report-viewer');
  
  if (container) container.classList.remove('hidden');
  if (viewer) viewer.classList.add('hidden');
  
  state.currentReport = null;
}

function showNewReportModal() {
  if (!state.canWriteRelatorios) {
    showNotification('Você não tem permissão para criar relatórios', 'error');
    return;
  }
  
  document.getElementById('report-title').value = '';
  document.getElementById('report-category').value = 'geral';
  document.getElementById('report-content').value = '';
  
  document.getElementById('report-modal').classList.add('active');
}

function closeReportModal() {
  document.getElementById('report-modal').classList.remove('active');
}

async function saveReport() {
  try {
    var title = document.getElementById('report-title').value.trim();
    var category = document.getElementById('report-category').value;
    var content = document.getElementById('report-content').value.trim();
    
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
      body: JSON.stringify({ title: title, category: category, content: content })
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

// Helper para escapar HTML
function escapeHtml(text) {
  if (!text) return '';
  var div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

