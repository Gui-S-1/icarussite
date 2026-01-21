// ========================================
// ICARUS.LAV - APP OFFLINE LAVANDERIA
// ========================================
// Todos os dados são salvos localmente no dispositivo
// Funciona 100% offline

// ===== CONFIGURAÇÃO DOS CLIENTES =====
var CLIENTS = {
  marajoara: {
    id: 'marajoara',
    name: 'Marajoara',
    color: '#f472b6',
    pricePerPiece: 3.50,
    markingPrice: 0,
    billingCycle: 'biweekly', // 16 dias (5-20 ou 21-4)
    fields: [
      { key: 'camisa_masc', label: 'Camisa Masc.' },
      { key: 'calca_masc', label: 'Calça Masc.' },
      { key: 'camisa_fem', label: 'Camisa Fem.' },
      { key: 'calca_fem', label: 'Calça Fem.' }
    ]
  },
  loyola: {
    id: 'loyola',
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
    id: 'suplemento',
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
    id: 'vitta',
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

// ===== ESTADO DO APP =====
var state = {
  currentClient: 'marajoara',
  period: null,
  entries: {}  // { clientId: [entries...] }
};

// ===== STORAGE LOCAL =====
var Storage = {
  // Prefixo para todas as chaves
  PREFIX: 'icarus_lav_',
  
  // Salvar dados de um cliente
  saveClientData: function(clientId, entries) {
    try {
      var key = this.PREFIX + 'entries_' + clientId;
      localStorage.setItem(key, JSON.stringify(entries));
      return true;
    } catch (e) {
      console.error('Erro ao salvar:', e);
      return false;
    }
  },
  
  // Carregar dados de um cliente
  loadClientData: function(clientId) {
    try {
      var key = this.PREFIX + 'entries_' + clientId;
      var data = localStorage.getItem(key);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.error('Erro ao carregar:', e);
      return [];
    }
  },
  
  // Carregar todos os dados
  loadAllData: function() {
    var all = {};
    Object.keys(CLIENTS).forEach(function(clientId) {
      all[clientId] = Storage.loadClientData(clientId);
    });
    return all;
  },
  
  // Limpar dados de um cliente
  clearClientData: function(clientId) {
    var key = this.PREFIX + 'entries_' + clientId;
    localStorage.removeItem(key);
  },
  
  // Salvar última notificação enviada
  saveLastNotification: function(clientId, date) {
    var key = this.PREFIX + 'lastnotif_' + clientId;
    localStorage.setItem(key, date);
  },
  
  getLastNotification: function(clientId) {
    var key = this.PREFIX + 'lastnotif_' + clientId;
    return localStorage.getItem(key);
  }
};

// ===== INICIALIZAÇÃO =====
function init() {
  // Carregar todos os dados salvos
  state.entries = Storage.loadAllData();
  
  // Definir data de hoje no input
  var today = new Date().toISOString().split('T')[0];
  document.getElementById('entryDate').value = today;
  
  // Selecionar primeiro cliente
  selectClient('marajoara');
  
  // Esconder splash após 1.5s
  setTimeout(function() {
    document.getElementById('splash').classList.add('hide');
  }, 1500);
  
  // Verificar notificações
  checkNotifications();
  
  // Atualizar status online/offline
  updateOnlineStatus();
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
}

function updateOnlineStatus() {
  var badge = document.getElementById('statusBadge');
  if (navigator.onLine) {
    badge.innerHTML = '<span>Online</span>';
    badge.classList.remove('offline');
  } else {
    badge.innerHTML = '<span>Offline</span>';
    badge.classList.add('offline');
  }
}

// ===== SELEÇÃO DE CLIENTE =====
function selectClient(clientId) {
  var client = CLIENTS[clientId];
  if (!client) return;
  
  state.currentClient = clientId;
  
  // Atualizar tabs
  document.querySelectorAll('.client-tab').forEach(function(tab) {
    tab.classList.remove('active');
  });
  document.getElementById('tab-' + clientId).classList.add('active');
  
  // Atualizar nome
  document.getElementById('clientName').textContent = client.name;
  
  // Atualizar período
  updatePeriod(client);
  
  // Renderizar campos do formulário
  renderFormFields(client);
  
  // Renderizar histórico
  renderHistory();
  
  // Atualizar estatísticas
  updateStats();
}

// ===== PERÍODO DE FATURAMENTO =====
function updatePeriod(client) {
  var now = new Date();
  var startDate, endDate;
  
  if (client.billingCycle === 'biweekly') {
    // Marajoara: ciclo de 16 dias (5-20 ou 21-4)
    var day = now.getDate();
    if (day >= 5 && day <= 20) {
      startDate = new Date(now.getFullYear(), now.getMonth(), 5);
      endDate = new Date(now.getFullYear(), now.getMonth(), 20);
    } else if (day >= 21) {
      startDate = new Date(now.getFullYear(), now.getMonth(), 21);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 4);
    } else {
      startDate = new Date(now.getFullYear(), now.getMonth() - 1, 21);
      endDate = new Date(now.getFullYear(), now.getMonth(), 4);
    }
  } else {
    // Mensal
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  }
  
  state.period = { start: startDate, end: endDate };
  
  // Formatar datas
  var formatDate = function(d) {
    return String(d.getDate()).padStart(2, '0') + '/' + 
           String(d.getMonth() + 1).padStart(2, '0');
  };
  
  document.getElementById('periodText').textContent = 
    formatDate(startDate) + ' - ' + formatDate(endDate);
  
  // Dias restantes
  var daysRemaining = Math.ceil((endDate - now) / (1000 * 60 * 60 * 24));
  document.getElementById('statDias').textContent = Math.max(0, daysRemaining);
}

// ===== RENDERIZAR CAMPOS =====
function renderFormFields(client) {
  var container = document.getElementById('formFields');
  var html = '';
  
  client.fields.forEach(function(field) {
    var markingNote = field.isMarking 
      ? '<small style="color:#a855f7;font-size:9px;">+R$ ' + client.markingPrice.toFixed(2) + '</small>' 
      : '';
    
    html += '<div class="field">' +
      '<label>' + field.label + ' ' + markingNote + '</label>' +
      '<input type="number" id="field-' + field.key + '" value="0" min="0" ' +
        'inputmode="numeric" oninput="updatePreview()" ' +
        'onfocus="if(this.value===\'0\')this.value=\'\'" ' +
        'onblur="if(this.value===\'\')this.value=\'0\'">' +
    '</div>';
  });
  
  container.innerHTML = html;
  updatePreview();
}

// ===== PREVIEW DO LANÇAMENTO =====
function updatePreview() {
  var client = CLIENTS[state.currentClient];
  if (!client) return;
  
  var totalPieces = 0;
  var totalMarkings = 0;
  
  client.fields.forEach(function(field) {
    var input = document.getElementById('field-' + field.key);
    var value = parseInt(input?.value) || 0;
    if (field.isMarking) {
      totalMarkings += value;
    } else {
      totalPieces += value;
    }
  });
  
  var totalValue = (totalPieces * client.pricePerPiece) + (totalMarkings * client.markingPrice);
  
  document.getElementById('previewPieces').textContent = totalPieces + totalMarkings;
  document.getElementById('previewValue').textContent = 'R$ ' + totalValue.toFixed(2);
}

// ===== SALVAR LANÇAMENTO =====
function saveEntry() {
  var client = CLIENTS[state.currentClient];
  if (!client) return;
  
  var entryDate = document.getElementById('entryDate').value;
  if (!entryDate) {
    showToast('Selecione uma data', 'error');
    return;
  }
  
  // Coletar valores
  var entry = {
    id: Date.now().toString(),
    date: entryDate,
    timestamp: new Date().toISOString()
  };
  
  var hasValue = false;
  var totalPieces = 0;
  var totalMarkings = 0;
  
  client.fields.forEach(function(field) {
    var input = document.getElementById('field-' + field.key);
    var value = parseInt(input?.value) || 0;
    entry[field.key] = value;
    
    if (value > 0) hasValue = true;
    
    if (field.isMarking) {
      totalMarkings += value;
    } else {
      totalPieces += value;
    }
  });
  
  if (!hasValue) {
    showToast('Preencha ao menos um campo', 'error');
    return;
  }
  
  // Calcular valor
  entry.totalPieces = totalPieces + totalMarkings;
  entry.totalValue = (totalPieces * client.pricePerPiece) + (totalMarkings * client.markingPrice);
  
  // Verificar se já existe lançamento para esta data (update)
  var entries = state.entries[state.currentClient] || [];
  var existingIndex = entries.findIndex(function(e) { return e.date === entryDate; });
  
  if (existingIndex >= 0) {
    // Atualizar existente
    entries[existingIndex] = entry;
    showToast('Lançamento atualizado!', 'success');
  } else {
    // Adicionar novo
    entries.push(entry);
    showToast('Lançamento salvo!', 'success');
  }
  
  // Ordenar por data (mais recente primeiro)
  entries.sort(function(a, b) {
    return new Date(b.date) - new Date(a.date);
  });
  
  state.entries[state.currentClient] = entries;
  
  // Salvar no storage local
  Storage.saveClientData(state.currentClient, entries);
  
  // Limpar campos
  client.fields.forEach(function(field) {
    var input = document.getElementById('field-' + field.key);
    if (input) input.value = '0';
  });
  updatePreview();
  
  // Atualizar interface
  renderHistory();
  updateStats();
}

// ===== EXCLUIR LANÇAMENTO =====
function deleteEntry(entryId) {
  if (!confirm('Excluir este lançamento?')) return;
  
  var entries = state.entries[state.currentClient] || [];
  state.entries[state.currentClient] = entries.filter(function(e) {
    return e.id !== entryId;
  });
  
  // Salvar no storage
  Storage.saveClientData(state.currentClient, state.entries[state.currentClient]);
  
  showToast('Lançamento excluído', 'success');
  renderHistory();
  updateStats();
}

// ===== RENDERIZAR HISTÓRICO =====
function renderHistory() {
  var container = document.getElementById('historyList');
  var client = CLIENTS[state.currentClient];
  var entries = state.entries[state.currentClient] || [];
  
  // Filtrar apenas entries do período atual
  var periodStart = state.period.start.toISOString().split('T')[0];
  var periodEnd = state.period.end.toISOString().split('T')[0];
  
  var filteredEntries = entries.filter(function(e) {
    return e.date >= periodStart && e.date <= periodEnd;
  });
  
  if (filteredEntries.length === 0) {
    container.innerHTML = '<div class="history-empty">' +
      '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom: 12px; opacity: 0.5;">' +
        '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
        '<polyline points="14 2 14 8 20 8"/>' +
      '</svg>' +
      '<div>Nenhum lançamento</div>' +
      '<div style="font-size: 12px; margin-top: 4px;">Adicione o primeiro</div>' +
    '</div>';
    return;
  }
  
  var html = '';
  filteredEntries.forEach(function(entry) {
    var date = new Date(entry.date + 'T12:00:00');
    var dateStr = String(date.getDate()).padStart(2, '0') + '/' + 
                  String(date.getMonth() + 1).padStart(2, '0');
    
    html += '<div class="history-item">' +
      '<div>' +
        '<div class="history-date">' + dateStr + '</div>' +
        '<div class="history-pieces">' + entry.totalPieces + ' peças</div>' +
      '</div>' +
      '<div style="display: flex; align-items: center; gap: 12px;">' +
        '<span class="history-value">R$ ' + entry.totalValue.toFixed(2) + '</span>' +
        '<button class="history-delete" onclick="deleteEntry(\'' + entry.id + '\')">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
            '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>' +
          '</svg>' +
        '</button>' +
      '</div>' +
    '</div>';
  });
  
  container.innerHTML = html;
}

// ===== ATUALIZAR ESTATÍSTICAS =====
function updateStats() {
  var client = CLIENTS[state.currentClient];
  var entries = state.entries[state.currentClient] || [];
  
  // Filtrar apenas entries do período atual
  var periodStart = state.period.start.toISOString().split('T')[0];
  var periodEnd = state.period.end.toISOString().split('T')[0];
  
  var filteredEntries = entries.filter(function(e) {
    return e.date >= periodStart && e.date <= periodEnd;
  });
  
  var totalPieces = 0;
  var totalValue = 0;
  
  filteredEntries.forEach(function(entry) {
    totalPieces += entry.totalPieces || 0;
    totalValue += entry.totalValue || 0;
  });
  
  document.getElementById('statPecas').textContent = totalPieces;
  document.getElementById('statValor').textContent = 'R$ ' + totalValue.toFixed(0);
}

// ===== GERAR PDF =====
async function exportPDF() {
  var client = CLIENTS[state.currentClient];
  var entries = state.entries[state.currentClient] || [];
  
  // Filtrar período atual
  var periodStart = state.period.start.toISOString().split('T')[0];
  var periodEnd = state.period.end.toISOString().split('T')[0];
  
  var filteredEntries = entries.filter(function(e) {
    return e.date >= periodStart && e.date <= periodEnd;
  });
  
  if (filteredEntries.length === 0) {
    showToast('Nenhum lançamento no período', 'error');
    return;
  }
  
  showToast('Gerando PDF...', 'info');
  
  // Calcular totais por tipo de peça
  var totalsByField = {};
  var totalPieces = 0;
  var totalMarkings = 0;
  var totalValue = 0;
  
  client.fields.forEach(function(field) {
    totalsByField[field.key] = 0;
  });
  
  filteredEntries.forEach(function(entry) {
    totalPieces += entry.totalPieces || 0;
    totalValue += entry.totalValue || 0;
    
    client.fields.forEach(function(field) {
      var val = entry[field.key] || 0;
      totalsByField[field.key] += val;
      if (field.isMarking) {
        totalMarkings += val;
      }
    });
  });
  
  var formatDate = function(d) {
    return String(d.getDate()).padStart(2, '0') + '/' + 
           String(d.getMonth() + 1).padStart(2, '0') + '/' + 
           d.getFullYear();
  };
  
  var formatDateShort = function(d) {
    return String(d.getDate()).padStart(2, '0') + '/' + 
           String(d.getMonth() + 1).padStart(2, '0');
  };
  
  // Ordenar por data
  var sortedEntries = filteredEntries.slice().sort(function(a, b) {
    return new Date(a.date) - new Date(b.date);
  });
  
  // Criar HTML do PDF - Design Premium
  var printContent = '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>Relatório ' + client.name + '</title>' +
    '<style>' +
      '@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap");' +
      '@page { size: A4; margin: 10mm; }' +
      '* { margin: 0; padding: 0; box-sizing: border-box; }' +
      'body { font-family: "Inter", system-ui, sans-serif; background: linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 100%); color: #fff; min-height: 100vh; padding: 20px; }' +
      
      // Header
      '.header { text-align: center; padding: 30px 20px; background: linear-gradient(135deg, ' + client.color + '22, ' + client.color + '11); border: 1px solid ' + client.color + '44; border-radius: 20px; margin-bottom: 20px; }' +
      '.header-icon { width: 70px; height: 70px; background: linear-gradient(135deg, ' + client.color + '33, ' + client.color + '11); border-radius: 18px; display: flex; align-items: center; justify-content: center; margin: 0 auto 15px; border: 2px solid ' + client.color + '; }' +
      '.header h1 { font-size: 24px; font-weight: 800; color: ' + client.color + '; letter-spacing: 2px; margin-bottom: 8px; }' +
      '.header .subtitle { color: #94a3b8; font-size: 13px; }' +
      '.header .period { display: inline-block; margin-top: 12px; padding: 8px 16px; background: rgba(255,255,255,0.05); border-radius: 20px; font-size: 12px; color: #cbd5e1; }' +
      
      // Stats grid
      '.stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }' +
      '.stat-card { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 16px; text-align: center; }' +
      '.stat-card .icon { font-size: 24px; margin-bottom: 8px; }' +
      '.stat-card .value { font-size: 26px; font-weight: 700; color: ' + client.color + '; }' +
      '.stat-card .label { font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: 1px; margin-top: 4px; }' +
      '.stat-card.total { background: linear-gradient(135deg, ' + client.color + '22, ' + client.color + '11); border-color: ' + client.color + '44; }' +
      
      // Info bar
      '.info-bar { display: flex; justify-content: space-around; background: rgba(255,255,255,0.03); border-radius: 12px; padding: 12px; margin-bottom: 20px; }' +
      '.info-item { text-align: center; }' +
      '.info-item .label { font-size: 9px; color: #64748b; text-transform: uppercase; }' +
      '.info-item .value { font-size: 13px; font-weight: 600; color: #fff; }' +
      
      // Table
      '.table-section { background: rgba(255,255,255,0.02); border-radius: 16px; overflow: hidden; border: 1px solid rgba(255,255,255,0.06); }' +
      '.table-header { display: flex; align-items: center; gap: 10px; padding: 14px 18px; border-bottom: 1px solid rgba(255,255,255,0.06); }' +
      '.table-header svg { color: ' + client.color + '; }' +
      '.table-header h3 { font-size: 14px; font-weight: 600; }' +
      'table { width: 100%; border-collapse: collapse; }' +
      'thead th { background: ' + client.color + '; color: #000; padding: 12px 10px; font-size: 11px; font-weight: 600; text-align: center; }' +
      'thead th:first-child { text-align: left; }' +
      'tbody td { padding: 10px; text-align: center; border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 12px; }' +
      'tbody td:first-child { text-align: left; font-weight: 500; }' +
      'tbody td:last-child { color: ' + client.color + '; font-weight: 600; }' +
      'tfoot td { background: rgba(255,255,255,0.05); padding: 12px 10px; font-weight: 700; text-align: center; font-size: 12px; }' +
      'tfoot td:first-child { text-align: left; }' +
      'tfoot td:last-child { color: ' + client.color + '; font-size: 14px; }' +
      
      // Footer
      '.footer { margin-top: 20px; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.08); display: flex; justify-content: space-between; align-items: center; }' +
      '.footer-brand { display: flex; align-items: center; gap: 10px; }' +
      '.footer-logo { width: 36px; height: 36px; border-radius: 10px; background: linear-gradient(135deg, ' + client.color + '33, ' + client.color + '11); display: flex; align-items: center; justify-content: center; border: 1px solid ' + client.color + '44; }' +
      '.footer-text { }' +
      '.footer-text .name { font-size: 14px; font-weight: 700; color: ' + client.color + '; }' +
      '.footer-text .sub { font-size: 10px; color: #64748b; }' +
      '.footer-info { text-align: right; font-size: 10px; color: #64748b; }' +
      
      // Print button
      '.print-btn { display: block; width: 100%; padding: 14px; background: linear-gradient(135deg, ' + client.color + ', ' + client.color + 'cc); border: none; border-radius: 12px; color: #000; font-size: 14px; font-weight: 600; cursor: pointer; margin-top: 16px; }' +
      
      // Responsive
      '@media (max-width: 480px) { .stats-grid { grid-template-columns: repeat(2, 1fr); } }' +
      '@media print { .print-btn { display: none !important; } body { background: #fff !important; color: #1e293b !important; padding: 10px !important; } .header, .stat-card, .table-section { background: #f8fafc !important; border-color: #e2e8f0 !important; } .stat-card .value, .header h1 { color: ' + client.color + ' !important; } thead th { background: ' + client.color + ' !important; } tbody td, tfoot td { border-color: #e2e8f0 !important; } }' +
    '</style></head><body>' +
    
    // Header
    '<div class="header">' +
      '<div class="header-icon"><svg width="32" height="32" viewBox="0 0 100 100" fill="none"><circle cx="50" cy="50" r="45" stroke="' + client.color + '" stroke-width="3" fill="none"/><path d="M50 15 L56 42 L83 50 L56 58 L50 85 L44 58 L17 50 L44 42 Z" fill="' + client.color + '"/></svg></div>' +
      '<h1>RELATÓRIO ' + client.name.toUpperCase() + '</h1>' +
      '<div class="subtitle">Controle de Lavanderia • Sistema Icarus</div>' +
      '<div class="period">📅 ' + formatDate(state.period.start) + ' a ' + formatDate(state.period.end) + '</div>' +
    '</div>' +
    
    // Stats
    '<div class="stats-grid">' +
      '<div class="stat-card"><div class="icon">👕</div><div class="value">' + totalPieces + '</div><div class="label">Peças</div></div>';
  
  if (client.markingPrice > 0) {
    printContent += '<div class="stat-card"><div class="icon">🏷️</div><div class="value">' + totalMarkings + '</div><div class="label">Marcações</div></div>';
  }
  
  printContent += '<div class="stat-card"><div class="icon">📊</div><div class="value">' + sortedEntries.length + '</div><div class="label">Lançamentos</div></div>' +
      '<div class="stat-card total"><div class="icon">💰</div><div class="value">R$ ' + totalValue.toFixed(0) + '</div><div class="label">Total</div></div>' +
    '</div>' +
    
    // Info bar
    '<div class="info-bar">' +
      '<div class="info-item"><div class="label">Cliente</div><div class="value">' + client.name + '</div></div>' +
      '<div class="info-item"><div class="label">R$/Peça</div><div class="value">R$ ' + client.pricePerPiece.toFixed(2) + '</div></div>';
  
  if (client.markingPrice > 0) {
    printContent += '<div class="info-item"><div class="label">R$/Marcação</div><div class="value">R$ ' + client.markingPrice.toFixed(2) + '</div></div>';
  }
  
  printContent += '<div class="info-item"><div class="label">Ciclo</div><div class="value">' + (client.billingCycle === 'biweekly' ? 'Quinzenal' : 'Mensal') + '</div></div>' +
    '</div>' +
    
    // Table
    '<div class="table-section">' +
      '<div class="table-header">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>' +
        '<h3>Lançamentos do Período</h3>' +
      '</div>' +
      '<table><thead><tr><th>Data</th>';
  
  client.fields.forEach(function(field) {
    printContent += '<th>' + field.label + '</th>';
  });
  printContent += '<th>Valor</th></tr></thead><tbody>';
  
  sortedEntries.forEach(function(entry) {
    var date = new Date(entry.date + 'T12:00:00');
    printContent += '<tr><td>' + formatDateShort(date) + '</td>';
    client.fields.forEach(function(field) {
      printContent += '<td>' + (entry[field.key] || 0) + '</td>';
    });
    printContent += '<td>R$ ' + (entry.totalValue || 0).toFixed(2) + '</td></tr>';
  });
  
  printContent += '</tbody><tfoot><tr><td><strong>TOTAIS</strong></td>';
  client.fields.forEach(function(field) {
    printContent += '<td><strong>' + totalsByField[field.key] + '</strong></td>';
  });
  printContent += '<td><strong>R$ ' + totalValue.toFixed(2) + '</strong></td></tr></tfoot></table></div>' +
    
    // Footer
    '<div class="footer">' +
      '<div class="footer-brand">' +
        '<div class="footer-logo"><svg width="20" height="20" viewBox="0 0 100 100"><path d="M50 10 L58 40 L88 50 L58 60 L50 90 L42 60 L12 50 L42 40 Z" fill="' + client.color + '"/></svg></div>' +
        '<div class="footer-text"><div class="name">ICARUS</div><div class="sub">Guilherme Braga</div></div>' +
      '</div>' +
      '<div class="footer-info"><div>Gerado em ' + new Date().toLocaleString('pt-BR') + '</div><div>icarus.lav v1.0</div></div>' +
    '</div>' +
    
    // Print button
    '<button class="print-btn" onclick="window.print()">🖨️ Imprimir / Salvar PDF</button>' +
    
    '</body></html>';
  
  // Detectar se está no Capacitor (APK Android)
  var isCapacitor = typeof window.Capacitor !== 'undefined' && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
  
  if (isCapacitor) {
    // No Android: criar blob e abrir no navegador do sistema
    try {
      var blob = new Blob([printContent], { type: 'text/html' });
      var url = URL.createObjectURL(blob);
      
      // Tentar abrir com Browser plugin
      if (window.Capacitor.Plugins && window.Capacitor.Plugins.Browser) {
        // Infelizmente blob URLs não funcionam no Browser plugin
        // Vamos usar uma abordagem diferente: criar uma data URL
        var dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(printContent);
        
        await window.Capacitor.Plugins.Browser.open({ 
          url: dataUrl,
          presentationStyle: 'fullscreen'
        });
        showToast('PDF aberto no navegador!', 'success');
        return;
      }
    } catch (e) {
      console.error('Erro ao abrir no navegador:', e);
    }
    
    // Fallback: tentar window.open
    var printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(printContent);
      printWindow.document.close();
      showToast('PDF gerado!', 'success');
    } else {
      showToast('Permita pop-ups', 'error');
    }
  } else {
    // No browser: abrir janela normalmente
    var printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(printContent);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(function() {
        printWindow.print();
      }, 500);
      showToast('PDF gerado!', 'success');
    } else {
      showToast('Permita pop-ups para gerar PDF', 'error');
    }
  }
}

// ===== NOTIFICAÇÕES =====
function checkNotifications() {
  // Verificar se está no final do período de algum cliente
  var now = new Date();
  
  Object.keys(CLIENTS).forEach(function(clientId) {
    var client = CLIENTS[clientId];
    var endDate;
    
    if (client.billingCycle === 'biweekly') {
      var day = now.getDate();
      if (day >= 5 && day <= 20) {
        endDate = new Date(now.getFullYear(), now.getMonth(), 20);
      } else if (day >= 21) {
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 4);
      } else {
        endDate = new Date(now.getFullYear(), now.getMonth(), 4);
      }
    } else {
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    }
    
    var daysRemaining = Math.ceil((endDate - now) / (1000 * 60 * 60 * 24));
    
    // Verificar se deve notificar (1 ou 2 dias restantes)
    if (daysRemaining <= 2 && daysRemaining >= 0) {
      var lastNotif = Storage.getLastNotification(clientId);
      var today = now.toISOString().split('T')[0];
      
      if (lastNotif !== today) {
        // Tentar enviar notificação local
        sendLocalNotification(client.name, daysRemaining);
        Storage.saveLastNotification(clientId, today);
      }
    }
  });
}

function sendLocalNotification(clientName, daysRemaining) {
  // Verificar se tem suporte a notificações
  if ('Notification' in window) {
    if (Notification.permission === 'granted') {
      var message = daysRemaining === 0 
        ? 'Período de ' + clientName + ' encerra HOJE! Hora de gerar o PDF.'
        : 'Falta' + (daysRemaining === 1 ? '' : 'm') + ' ' + daysRemaining + ' dia' + (daysRemaining === 1 ? '' : 's') + ' para encerrar o período de ' + clientName;
      
      new Notification('Icarus.LAV', {
        body: message,
        icon: 'icons/icon-192.png',
        badge: 'icons/icon-72.png'
      });
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission();
    }
  }
}

// ===== TOAST =====
function showToast(message, type) {
  var toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast ' + (type || '');
  toast.classList.add('show');
  
  setTimeout(function() {
    toast.classList.remove('show');
  }, 2500);
}

// ===== INICIAR APP =====
document.addEventListener('DOMContentLoaded', init);
