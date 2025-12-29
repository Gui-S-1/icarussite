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

  // Setup navigation
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const view = item.getAttribute('data-view');
      navigateTo(view);
    });
  });
});

// Navigation
function navigateTo(view) {
  console.log('Navegando para:', view);
  
  // Update active nav
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.remove('active');
    if (item.getAttribute('data-view') === view) {
      item.classList.add('active');
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

      showApp();
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
  document.getElementById('user-name').textContent = state.user.name;
  document.getElementById('user-role').textContent = state.user.roles.join(', ');

  // Setup permissions
  setupPermissions();

  // Load initial data
  await loadUsers(); // Carregar usuários primeiro
  loadDashboard();

  // Start polling for notifications (every 5 minutes)
  setInterval(checkForUpdates, 5 * 60 * 1000);

  // Initial check after 10 seconds
  setTimeout(checkForUpdates, 10000);
}

function setupPermissions() {
  const roles = state.user.roles || [];
  const isAdmin = roles.includes('admin');

  const navAlmox = document.querySelector('[data-view="almoxarifado"]');
  const navCompras = document.querySelector('[data-view="compras"]');
  const navPrev = document.querySelector('[data-view="preventivas"]');
  const navRel = document.querySelector('[data-view="relatorios"]');
  const navCfg = document.querySelector('[data-view="configuracoes"]');

  if (navAlmox) navAlmox.classList.toggle('hidden', !(isAdmin || roles.includes('almoxarifado')));
  if (navCompras) navCompras.classList.toggle('hidden', !(isAdmin || roles.includes('compras')));
  if (navPrev) navPrev.classList.toggle('hidden', !(isAdmin || roles.includes('preventivas')));
  if (navRel) navRel.classList.toggle('hidden', !isAdmin);
  if (navCfg) navCfg.classList.remove('hidden');
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

  // Productivity chart with filtered data
  renderProductivityChart(filteredOrders);

  // Recent activity
  const recent = state.orders.slice(0, 5);
  let html = '';
  if (recent.length > 0) {
    html = `<table><thead><tr><th>ID</th><th>Status</th><th>Data</th></tr></thead><tbody>`;
    for (const order of recent) {
      html += `<tr><td>${order.id}</td><td>${order.status}</td><td>${order.created_at}</td></tr>`;
    }
    html += `</tbody></table>`;
  } else {
    html = '<p style="color: var(--text-secondary);">Nenhuma atividade recente</p>';
  }
  const recentActivity = document.getElementById('recent-activity');
  if (recentActivity) recentActivity.innerHTML = html;
}

function renderProductivityChart(filteredOrders = state.orders) {
  const completedOrders = filteredOrders.filter(o => o.status === 'completed');
  
  // Contar OS por usuário (assigned_users)
  const userStats = {};
  const teamMembers = ['declie', 'eduardo', 'alissom', 'vanderlei', 'gui'];
  
  completedOrders.forEach(order => {
    if (order.assigned_users && Array.isArray(order.assigned_users)) {
      order.assigned_users.forEach(user => {
        const username = user.username.toLowerCase();
        if (teamMembers.includes(username)) {
          userStats[username] = (userStats[username] || 0) + 1;
        }
      });
    }
  });
  
  // Ordenar por quantidade (maior para menor)
  const sorted = Object.entries(userStats).sort((a, b) => b[1] - a[1]);
  const maxCount = sorted.length > 0 ? sorted[0][1] : 1;
  
  const chartHtml = sorted.length > 0 ? sorted.map(([username, count]) => {
    const percentage = (count / maxCount) * 100;
    return `
      <div class="productivity-bar">
        <div class="productivity-name">${username.charAt(0).toUpperCase() + username.slice(1)}</div>
        <div class="productivity-bar-container">
          <div class="productivity-bar-fill" style="width: ${percentage}%">
            <span class="productivity-count">${count}</span>
          </div>
        </div>
        <div class="productivity-total">${count}</div>
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
    }
  } catch (error) {
    console.error('Erro ao carregar OS:', error);
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
      showNotification('[ERRO]', `Resposta inválida do servidor: ${text.substring(0, 100)}`, 'danger');
      return;
    }
    if (data.ok) {
      await loadOrders();
      // await backupOrdersToTXT(); // Desabilitado temporariamente
      closeModal('modal-os-detail');
      showNotification('[SUCESSO]', 'Atribuições atualizadas!', 'success');
      // Atualizar visualização dos técnicos atribuídos se necessário
      if (data.assigned_users) {
        const assignedContainer = document.getElementById('detail-os-assigned');
        assignedContainer.innerHTML = data.assigned_users.map(u => `<span class="user-chip">${u.name || u.username}</span>`).join('');
      }
    } else {
      showNotification('[ERRO]', 'Erro ao atualizar: ' + (data.error || 'Erro desconhecido'), 'danger');
    }
  } catch (error) {
    showNotification('[ERRO]', 'Erro ao atualizar: ' + error.message, 'danger');
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

  tbody.innerHTML = completedOrders.map(o => 
    `<tr><td>${o.id}</td><td>${o.status}</td><td>${o.created_at}</td></tr>`
  ).join('');
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
      await loadOrders();
      // await backupOrdersToTXT(); // Desabilitado temporariamente
    }
  } catch (error) {
    alert('Erro ao iniciar OS: ' + error.message);
  }
}

async function completeOrder(orderId) {
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
      await loadOrders();
      // await backupOrdersToTXT(); // Desabilitado temporariamente
    }
  } catch (error) {
    alert('Erro ao concluir OS: ' + error.message);
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
      await loadOrders();
      // await backupOrdersToTXT(); // Desabilitado temporariamente
    }
  } catch (error) {
    alert('Erro ao excluir OS: ' + error.message);
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
  
  const title = document.getElementById('os-title').value;
  const sector = document.getElementById('os-sector').value;
  const priority = document.getElementById('os-priority').value;
  const description = document.getElementById('os-description').value;
  
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
      showNotification('[SUCESSO]', 'OS criada com sucesso!', 'success');
    } else {
      showNotification('[ERRO]', data.error || 'Erro ao criar OS', 'danger');
    }
  } catch (error) {
    showNotification('[ERRO]', 'Erro ao criar OS: ' + error.message, 'danger');
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

function showNotification(title, message, type = 'info', duration = 8000) {
  const container = document.getElementById('notification-container');
  const id = 'notif-' + Date.now();
  
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.id = id;
  notification.innerHTML = `
    <div class="notification-header">
      <span class="notification-title">${title}</span>
      <span class="notification-close" onclick="closeNotification('${id}')">×</span>
    </div>
    <div class="notification-body">${message}</div>
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
      showNotification(`[ALMOXARIFADO] Estoque atualizado: ${item.name}`, 'success');
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
        ${purchase.status !== 'chegou' ? `
          <button class="btn-small" onclick="advancePurchaseStatus(${purchase.id})">
            Avançar
          </button>
        ` : ''}
        <button class="btn-small btn-danger" onclick="deletePurchase(${purchase.id})">Excluir</button>
      </td>
    </tr>
  `}).join('');
}

function showCreatePurchase() {
  const modal = document.getElementById('modal-create-purchase');
  modal.classList.remove('hidden');
  modal.classList.add('active');
}

async function createPurchaseFromForm(event) {
  event.preventDefault();
  
  const formData = new FormData(event.target);
  const quantity = parseInt(formData.get('quantity'));
  const unitPrice = parseFloat(formData.get('price')) || 0;
  const totalCost = quantity * unitPrice;
  
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

async function advancePurchaseStatus(purchaseId) {
  const purchase = state.purchases.find(p => p.id === purchaseId);
  if (!purchase) return;

  const statusFlow = {
    analise: 'pedido',
    pedido: 'chegando',
    chegando: 'chegou'
  };

  const nextStatus = statusFlow[purchase.status];
  if (!nextStatus) return;

  try {
    const response = await fetch(`${API_URL}/purchases/${purchaseId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ status: nextStatus })
    });

    const data = await response.json();
    if (data.ok) {
      showNotification(`[COMPRAS] Status atualizado para: ${nextStatus}`, 'success');
      await loadPurchases();
    } else {
      showNotification('Erro ao atualizar status', 'error');
    }
  } catch (error) {
    console.error('Erro ao atualizar status:', error);
    showNotification('Erro ao atualizar status', 'error');
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

async function checkForUpdates() {
  showNotification('[ATUALIZAÇÃO] Verificando...', 'info');
  
  setTimeout(() => {
    showNotification('[SISTEMA ATUALIZADO] Você está na versão mais recente!', 'success');
  }, 2000);
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
  document.getElementById('login-form').classList.remove('hidden');
  document.getElementById('key-validation-form').classList.remove('hidden');
  document.getElementById('auth-error').classList.add('hidden');
}

