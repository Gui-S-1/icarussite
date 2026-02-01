const fs = require('fs');
let data = fs.readFileSync('c:\\Users\\Gui\\Desktop\\Icarus\\frontend\\app.js', 'utf8');

// Encontrar inicio e fim da funcao showQuickWithdrawal ate antes de showQuickEntry
const startMatch = data.indexOf('function showQuickWithdrawal()');
const endMatch = data.indexOf('// Modal de Entrada Rapida');

if (startMatch === -1 || endMatch === -1) {
  console.log('Nao encontrou marcadores. start:', startMatch, 'end:', endMatch);
  process.exit(1);
}

console.log('Encontrou de caractere', startMatch, 'ate', endMatch);
console.log('Substituindo...');

const newCode = `// Estado para retirada multipla
let withdrawalItems = [];

function showQuickWithdrawal() {
  withdrawalItems = [];
  const items = state.inventory.filter(i => i.quantity > 0);
  
  const modalHtml = \`
    <div id="modal-quick-withdrawal" class="modal-overlay active" onclick="if(event.target === this) closeModal('modal-quick-withdrawal')" style="backdrop-filter: blur(12px); background: linear-gradient(135deg, rgba(0,0,0,0.8), rgba(30,20,60,0.7));">
      <div class="modal" style="max-width: 600px; max-height: 90vh; overflow-y: auto; background: linear-gradient(180deg, rgba(45,25,85,0.98) 0%, rgba(25,15,55,0.98) 100%); border: 1px solid rgba(168,85,247,0.35); box-shadow: 0 30px 60px rgba(0,0,0,0.5); border-radius: 20px; padding: 0;">
        
        <div style="background: linear-gradient(135deg, rgba(236,72,153,0.2), rgba(168,85,247,0.1)); padding: 24px 28px; border-bottom: 1px solid rgba(255,255,255,0.06);">
          <div style="display: flex; align-items: center; gap: 16px;">
            <div style="width: 52px; height: 52px; background: linear-gradient(135deg, rgba(236,72,153,0.3), rgba(168,85,247,0.2)); border-radius: 14px; display: flex; align-items: center; justify-content: center;">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#f472b6" stroke-width="2">
                <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>
              </svg>
            </div>
            <div>
              <h3 style="margin: 0; font-size: 20px; font-weight: 700; color: #fff;">Registrar Retirada</h3>
              <p style="margin: 4px 0 0; font-size: 13px; color: rgba(255,255,255,0.5);">Adicione um ou mais itens para a mesma pessoa</p>
            </div>
          </div>
        </div>
        
        <div style="padding: 24px 28px;">
          <div style="margin-bottom: 20px;">
            <label style="display: block; font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.7); margin-bottom: 8px; text-transform: uppercase;">BUSCAR ITEM</label>
            <div style="position: relative;">
              <input type="text" id="withdrawal-search" placeholder="Digite para buscar..." autocomplete="off"
                style="width: 100%; padding: 14px 16px; background: rgba(255,255,255,0.05); border: 1px solid rgba(168,85,247,0.3); border-radius: 12px; color: #fff; font-size: 14px;"
                oninput="filterWithdrawalItems(this.value)">
              <div id="withdrawal-suggestions" style="display: none; position: absolute; top: 100%; left: 0; right: 0; background: #1a1a2e; border: 1px solid rgba(168,85,247,0.3); border-radius: 12px; margin-top: 4px; max-height: 200px; overflow-y: auto; z-index: 100;"></div>
            </div>
          </div>
          
          <div id="withdrawal-selected-items" style="margin-bottom: 20px; min-height: 60px; background: rgba(0,0,0,0.2); border-radius: 12px; padding: 12px;">
            <p style="color: rgba(255,255,255,0.4); text-align: center; margin: 0; font-size: 13px;">Nenhum item adicionado</p>
          </div>
          
          <div style="margin-bottom: 16px;">
            <label style="display: block; font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.7); margin-bottom: 8px; text-transform: uppercase;">QUEM ESTA RETIRANDO?</label>
            <input type="text" id="withdrawal-person" placeholder="Nome da pessoa" 
              style="width: 100%; padding: 14px 16px; background: rgba(255,255,255,0.05); border: 1px solid rgba(236,72,153,0.3); border-radius: 12px; color: #fff; font-size: 14px;">
          </div>
          
          <div style="margin-bottom: 16px;">
            <label style="display: block; font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.7); margin-bottom: 8px; text-transform: uppercase;">SETOR / DESTINO</label>
            <select id="withdrawal-sector" style="width: 100%; padding: 14px 16px; background: #1a1a2e; border: 1px solid rgba(168,85,247,0.3); border-radius: 12px; color: #fff; font-size: 14px;">
              <option value="">Selecione o setor...</option>
              <option value="Manutencao">Manutencao</option>
              <option value="Aviario 1">Aviario 1</option>
              <option value="Aviario 2">Aviario 2</option>
              <option value="Aviario 3">Aviario 3</option>
              <option value="Aviario 4">Aviario 4</option>
              <option value="Recria">Recria</option>
              <option value="Fabrica de Racao">Fabrica de Racao</option>
              <option value="Escritorio">Escritorio</option>
              <option value="Almoxarifado">Almoxarifado</option>
              <option value="Externo">Externo</option>
            </select>
          </div>
          
          <div style="margin-bottom: 20px;">
            <label style="display: block; font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.7); margin-bottom: 8px; text-transform: uppercase;">OBSERVACAO (OPCIONAL)</label>
            <textarea id="withdrawal-notes" rows="2" placeholder="Anotacoes adicionais..." 
              style="width: 100%; padding: 14px 16px; background: rgba(255,255,255,0.05); border: 1px solid rgba(168,85,247,0.3); border-radius: 12px; color: #fff; font-size: 14px; resize: none;"></textarea>
          </div>
          
          <div style="display: flex; gap: 12px;">
            <button type="button" onclick="closeModal('modal-quick-withdrawal')" 
              style="flex: 1; padding: 14px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; color: #fff; cursor: pointer; font-weight: 500;">
              Cancelar
            </button>
            <button type="button" onclick="submitMultipleWithdrawal()" 
              style="flex: 1.5; padding: 14px; background: linear-gradient(135deg, #ec4899, #be185d); border: none; border-radius: 12px; color: #fff; cursor: pointer; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 8px;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/></svg>
              Confirmar Retirada
            </button>
          </div>
        </div>
      </div>
    </div>
  \`;
  
  const existing = document.getElementById('modal-quick-withdrawal');
  if (existing) existing.remove();
  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function filterWithdrawalItems(query) {
  const suggestionsDiv = document.getElementById('withdrawal-suggestions');
  if (!query || query.length < 1) {
    suggestionsDiv.style.display = 'none';
    return;
  }
  
  const items = state.inventory.filter(i => 
    i.quantity > 0 && 
    (i.name.toLowerCase().includes(query.toLowerCase()) || 
     (i.sku && i.sku.toLowerCase().includes(query.toLowerCase())))
  ).slice(0, 8);
  
  if (items.length === 0) {
    suggestionsDiv.style.display = 'none';
    return;
  }
  
  suggestionsDiv.innerHTML = items.map(item => \`
    <div onclick="addWithdrawalItem('\${item.id}')" 
      style="padding: 12px 16px; cursor: pointer; border-bottom: 1px solid rgba(255,255,255,0.05); transition: background 0.2s;"
      onmouseover="this.style.background='rgba(168,85,247,0.2)'" onmouseout="this.style.background='transparent'">
      <div style="font-weight: 600; color: #fff;">\${escapeHtml(item.name)}</div>
      <div style="font-size: 12px; color: rgba(255,255,255,0.5);">\${item.quantity} \${item.unit || 'un'} disponiveis - \${item.category || ''}</div>
    </div>
  \`).join('');
  suggestionsDiv.style.display = 'block';
}

function addWithdrawalItem(itemId) {
  const item = state.inventory.find(i => i.id === itemId || i.id === parseInt(itemId));
  if (!item) return;
  
  const existing = withdrawalItems.find(w => w.id == itemId);
  if (existing) {
    if (existing.qty < item.quantity) {
      existing.qty++;
      renderWithdrawalItems();
    }
    return;
  }
  
  withdrawalItems.push({ id: item.id, name: item.name, qty: 1, maxQty: item.quantity, unit: item.unit || 'un' });
  renderWithdrawalItems();
  
  document.getElementById('withdrawal-search').value = '';
  document.getElementById('withdrawal-suggestions').style.display = 'none';
}

function renderWithdrawalItems() {
  const container = document.getElementById('withdrawal-selected-items');
  
  if (withdrawalItems.length === 0) {
    container.innerHTML = '<p style="color: rgba(255,255,255,0.4); text-align: center; margin: 0; font-size: 13px;">Nenhum item adicionado</p>';
    return;
  }
  
  container.innerHTML = withdrawalItems.map((item, idx) => \`
    <div style="display: flex; align-items: center; gap: 12px; padding: 10px; background: rgba(168,85,247,0.1); border-radius: 8px; margin-bottom: 8px;">
      <div style="flex: 1;">
        <div style="font-weight: 600; color: #fff; font-size: 14px;">\${escapeHtml(item.name)}</div>
        <div style="font-size: 11px; color: rgba(255,255,255,0.5);">Max: \${item.maxQty} \${item.unit}</div>
      </div>
      <div style="display: flex; align-items: center; gap: 8px;">
        <button type="button" onclick="changeWithdrawalQty(\${idx}, -1)" style="width: 28px; height: 28px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.2); background: transparent; color: #fff; cursor: pointer; font-size: 16px;">-</button>
        <span style="color: #fff; font-weight: 700; min-width: 30px; text-align: center;">\${item.qty}</span>
        <button type="button" onclick="changeWithdrawalQty(\${idx}, 1)" style="width: 28px; height: 28px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.2); background: transparent; color: #fff; cursor: pointer; font-size: 16px;">+</button>
      </div>
      <button type="button" onclick="removeWithdrawalItem(\${idx})" style="width: 28px; height: 28px; border-radius: 6px; border: none; background: rgba(239,68,68,0.2); color: #ef4444; cursor: pointer;">X</button>
    </div>
  \`).join('');
}

function changeWithdrawalQty(idx, delta) {
  const item = withdrawalItems[idx];
  const newQty = item.qty + delta;
  if (newQty >= 1 && newQty <= item.maxQty) {
    item.qty = newQty;
    renderWithdrawalItems();
  }
}

function removeWithdrawalItem(idx) {
  withdrawalItems.splice(idx, 1);
  renderWithdrawalItems();
}

async function submitMultipleWithdrawal() {
  const personName = document.getElementById('withdrawal-person').value.trim();
  const sector = document.getElementById('withdrawal-sector').value;
  const notes = document.getElementById('withdrawal-notes').value.trim();
  
  if (withdrawalItems.length === 0) {
    showNotification('Adicione pelo menos um item', 'error');
    return;
  }
  
  if (!personName) {
    showNotification('Informe quem esta retirando', 'error');
    return;
  }
  
  try {
    for (const item of withdrawalItems) {
      await fetch(\`\${API_URL}/inventory/movements\`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': \`Bearer \${state.token}\`
        },
        body: JSON.stringify({
          item_id: item.id,
          movement_type: 'saida',
          quantity: item.qty,
          usage_type: 'emprestimo',
          person_name: personName,
          person_sector: sector || null,
          notes: notes || null
        })
      });
    }
    
    const itemNames = withdrawalItems.map(i => \`\${i.qty}x \${i.name}\`).join(', ');
    showNotification(\`Retirada registrada: \${itemNames}\`, 'success');
    closeModal('modal-quick-withdrawal');
    loadInventory();
    if (almox2State.currentTab === 'movimentos') loadAlmoxMovements();
  } catch (error) {
    console.error('Erro ao registrar retirada:', error);
    showNotification('Erro ao registrar retirada', 'error');
  }
}

`;

const result = data.substring(0, startMatch) + newCode + data.substring(endMatch);
fs.writeFileSync('c:\\Users\\Gui\\Desktop\\Icarus\\frontend\\app.js', result, 'utf8');
console.log('Substituicao concluida!');
