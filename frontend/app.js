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
  currentView: 'dashboard',
  dashboardFilter: 'daily', // daily, weekly, monthly
  lastOrderCount: 0,
  lastPreventiveCheck: new Date()
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
      case 'relatorios':
        await loadReports();
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
  const selectedOperator = localStorage.getItem('selectedOperator');
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
  statusBar.innerHTML = '🔄 Auto-refresh ativo';
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
  const canSeeDashboard = isAdmin || roles.includes('os_manage_all') || roles.includes('os_view_all');

  const navDashboard = document.querySelector('[data-view="dashboard"]');
  const navOS = document.querySelector('[data-view="os"]');
  const navAlmox = document.querySelector('[data-view="almoxarifado"]');
  const navCompras = document.querySelector('[data-view="compras"]');
  const navPrev = document.querySelector('[data-view="preventivas"]');
  const navRel = document.querySelector('[data-view="relatorios"]');
  const navCfg = document.querySelector('[data-view="configuracoes"]');

  if (navDashboard) navDashboard.classList.toggle('hidden', !canSeeDashboard);
  if (navOS) navOS.classList.remove('hidden'); // OS sempre visível para todos
  if (navAlmox) navAlmox.classList.toggle('hidden', !(isAdmin || roles.includes('almoxarifado')));
  if (navCompras) navCompras.classList.toggle('hidden', !(isAdmin || roles.includes('compras')));
  if (navPrev) navPrev.classList.toggle('hidden', !(isAdmin || roles.includes('preventivas')));
  if (navRel) navRel.classList.toggle('hidden', !isAdmin);
  if (navCfg) navCfg.classList.remove('hidden');
  
  console.log('Permissões configuradas. Roles:', roles);
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
  const filterBtn = document.getElementById(`filter-${filter}`);
  
  if (filterDaily) filterDaily.classList.remove('btn-primary');
  if (filterWeekly) filterWeekly.classList.remove('btn-primary');
  if (filterMonthly) filterMonthly.classList.remove('btn-primary');
  if (filterBtn) filterBtn.classList.add('btn-primary');
  
  // Update labels
  const labels = {
    daily: { period: 'Hoje', period2: 'do Dia', productivity: '(Hoje)' },
    weekly: { period: 'na Semana', period2: 'da Semana', productivity: '(Esta Semana)' },
    monthly: { period: 'no Mês', period2: 'do Mês', productivity: '(Este Mês)' }
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

function getDateRange() {
  const now = new Date();
  let startDate, endDate;
  
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
    pending: '⏳',
    in_progress: '🔧',
    completed: '✅'
  };

  const statusColors = {
    pending: 'var(--warning)',
    in_progress: 'var(--info)',
    completed: 'var(--success)'
  };

  container.innerHTML = recent.map(order => {
    const icon = statusIcons[order.status] || '📋';
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
          <strong style="color: var(--danger);">⚠️ ${lowStock.length} itens com estoque baixo!</strong>
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

async function createPurchaseFromForm(event) {
  event.preventDefault();
  
  const formData = new FormData(event.target);
  const quantity = parseInt(formData.get('quantity'));
  const unitPrice = parseFloat(formData.get('price')) || null;
  const totalCost = unitPrice ? quantity * unitPrice : null;
  
  const purchaseData = {
    item_name: formData.get('item'),
    quantity: quantity,
    unit: formData.get('unit'),
    unit_price: unitPrice,
    total_cost: totalCost,
    supplier: formData.get('supplier') || null,
    notes: formData.get('notes') || null
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

  tbody.innerHTML = state.preventives.map(prev => {
    const nextDate = new Date(prev.next_date);
    const today = new Date();
    const daysUntil = Math.ceil((nextDate - today) / (1000 * 60 * 60 * 24));
    
    let statusClass = 'badge-low';
    let statusText = 'Em Dia';
    
    if (daysUntil < 0) {
      statusClass = 'badge-high';
      statusText = `Atrasada ${Math.abs(daysUntil)}d`;
    } else if (daysUntil <= 7) {
      statusClass = 'badge-medium';
      statusText = `${daysUntil}d restantes`;
    }

    return `
    <tr>
      <td><strong>${prev.equipment_name}</strong></td>
      <td><span class="badge badge-info">${typeLabels[prev.maintenance_type] || prev.maintenance_type}</span></td>
      <td>${frequencyLabels[prev.frequency] || prev.frequency}</td>
      <td>${nextDate.toLocaleDateString('pt-BR')}</td>
      <td>${prev.last_date ? new Date(prev.last_date).toLocaleDateString('pt-BR') : '-'}</td>
      <td><span class="badge ${statusClass}">${statusText}</span></td>
      <td>
        <button class="btn-small" onclick="completePreventive(${prev.id})">Concluir</button>
        <button class="btn-small btn-danger" onclick="deletePreventive(${prev.id})">Excluir</button>
      </td>
    </tr>
  `}).join('');
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
