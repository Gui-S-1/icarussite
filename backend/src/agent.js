/**
 * ICARUS - Agent IA (GPT-4o-mini)
 * Processa mensagens e executa ações reais no banco de dados
 * 
 * MODO FLUXO OS: Perguntas sobre OS são encaminhadas aos responsáveis (sem IA)
 * MODO AGENTE: "Icarus ..." ativa o GPT para executar ações
 * MODO CONSULTA: Perguntas simples usam regex (sem tokens)
 */

const { v4: uuid } = require('uuid');
const osFlow = require('./osFlow');

// Configuração OpenAI - NUNCA colocar chave aqui, usar apenas variável de ambiente
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.warn('[Agent] AVISO: OPENAI_API_KEY não configurada. Modo agente desabilitado.');
}
const OPENAI_MODEL = 'gpt-4o-mini';
const MAX_TOKENS = 300;

// Sessões ativas do modo agente (phone -> { active, lastAction })
const agentSessions = new Map();

// Prompt do sistema para modo AGENTE (executa ações)
const AGENT_SYSTEM_PROMPT = `Você é o ICARUS AGENT, um assistente que EXECUTA ações reais no sistema.

AÇÕES DISPONÍVEIS:
1. ADICIONAR_ESTOQUE - Adicionar item no almoxarifado (nome, quantidade, unidade)
2. CRIAR_NOTA - Criar nota/boleto (empresa, valor, vencimento)
3. CRIAR_OS - Criar ordem de serviço (titulo, setor, urgencia: baixa/media/alta/critica)
4. REGISTRAR_DIESEL - Registrar diesel (tipo: entrada/saida, quantidade)
5. REGISTRAR_AGUA - Registrar leitura água (tanque, valor)

Responda APENAS com JSON:
{"acao":"NOME","dados":{...},"confirmar":true/false,"mensagem":"texto curto"}

REGRAS:
- CRIAR_OS: só precisa de titulo e setor. Urgência padrão é "media" se não informar
- Se faltar info obrigatória, peça (confirmar: false)
- Se tiver o mínimo, execute (confirmar: true)
- Seja direto

EXEMPLOS:
"chegou 200 pregos" → {"acao":"ADICIONAR_ESTOQUE","dados":{"nome":"Pregos","quantidade":200,"unidade":"un"},"confirmar":true,"mensagem":"✅ Adicionado!"}
"abre OS trocar lampada aviario" → {"acao":"CRIAR_OS","dados":{"titulo":"Trocar lâmpada","setor":"aviario","urgencia":"media"},"confirmar":true,"mensagem":"✅ OS criada!"}
"OS urgente - vazamento recria" → {"acao":"CRIAR_OS","dados":{"titulo":"Vazamento","setor":"recria","urgencia":"alta"},"confirmar":true,"mensagem":"✅ OS urgente criada!"}
"nota empresa X 1500 venc 15/02" → {"acao":"CRIAR_NOTA","dados":{"empresa":"X","valor":1500,"vencimento":"15/02"},"confirmar":true,"mensagem":"✅ Nota criada!"}`;

// Intents possíveis (modo consulta - sem tokens)
const INTENTS = {
  SAUDACAO: 'saudacao',
  AJUDA: 'ajuda',
  BUSCAR_ITEM: 'buscar_item',
  VERIFICAR_EMPRESTIMO: 'verificar_emprestimo',
  LEITURA_AGUA: 'leitura_agua',
  CONSUMO_AGUA_MES: 'consumo_agua_mes',
  RELATORIO_AGUA_HTML: 'relatorio_agua_html',
  LISTAR_NOTAS: 'listar_notas',
  CRIAR_NOTA: 'criar_nota',
  ESTOQUE_BAIXO: 'estoque_baixo',
  ORDEM_SERVICO: 'ordem_servico',
  TECNICO: 'tecnico',
  DIESEL: 'diesel',
  GERADOR: 'gerador',
  COMPRAS: 'compras',
  FORUM: 'forum',
  CHECKLISTS: 'checklists',
  SAIR_AGENTE: 'sair_agente',
  DESCONHECIDO: 'desconhecido'
};

// Pergunta final para todas as respostas
const PERGUNTA_FINAL = '\n\n💬 _Posso ajudar com mais alguma coisa?_';

/**
 * Verifica se a mensagem ativa o modo agente
 */
function isAgentCommand(message) {
  const msg = message.toLowerCase().trim();
  return msg.startsWith('icarus ') || msg.startsWith('icarus,');
}

/**
 * Verifica se é comando de sair do modo agente
 */
function isExitCommand(message) {
  const msg = message.toLowerCase().trim();
  return /^(sair|tchau|exit|bye|encerrar|finalizar|obrigado|valeu)(\s|$|!|\?)/.test(msg);
}

/**
 * Verifica se o usuário está em sessão agente ativa
 */
function isAgentSessionActive(phone) {
  const session = agentSessions.get(phone);
  if (!session) return false;
  
  // Sessão expira em 10 minutos
  const TEN_MINUTES = 10 * 60 * 1000;
  if (Date.now() - session.lastAction > TEN_MINUTES) {
    agentSessions.delete(phone);
    return false;
  }
  return session.active;
}

/**
 * Ativa sessão do agente
 */
function activateAgentSession(phone) {
  agentSessions.set(phone, { active: true, lastAction: Date.now(), context: [] });
}

/**
 * Desativa sessão do agente
 */
function deactivateAgentSession(phone) {
  agentSessions.delete(phone);
}

/**
 * Atualiza timestamp da sessão
 */
function touchAgentSession(phone) {
  const session = agentSessions.get(phone);
  if (session) {
    session.lastAction = Date.now();
  }
}

/**
 * Classifica a intenção da mensagem (modo consulta)
 */
function classifyIntent(message) {
  const msg = message.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  
  // Sair do agente
  if (isExitCommand(message)) {
    return INTENTS.SAIR_AGENTE;
  }
  
  // Saudações
  if (/^(oi|ola|hey|eai|e ai|bom dia|boa tarde|boa noite|opa|fala|salve|hello|hi)(\s|$|!|\?)/.test(msg)) {
    return INTENTS.SAUDACAO;
  }
  
  // Ajuda / Menu
  if (/ajuda|help|menu|comandos|o que (voce|vc) faz|como funciona|opcoes/.test(msg)) {
    return INTENTS.AJUDA;
  }
  
  // Buscar item no estoque
  if (/tem\s|temos\s|existe\s|ha\s|possui|estoque de|quantidade de/.test(msg)) {
    return INTENTS.BUSCAR_ITEM;
  }
  
  // Verificar empréstimo
  if (/com quem|quem (esta|pegou|tem)|onde esta|emprestado|emprestimo|devolver/.test(msg)) {
    return INTENTS.VERIFICAR_EMPRESTIMO;
  }
  
  // Relatório de água HTML (manda relatorio agua 01/26)
  if (/relatorio.*agua|manda.*relatorio.*agua|envia.*relatorio.*agua|gera.*relatorio.*agua/.test(msg)) {
    console.log('[Agent] Intent detectado: RELATORIO_AGUA_HTML para mensagem:', msg);
    return INTENTS.RELATORIO_AGUA_HTML;
  }
  
  // Consumo de água mensal
  if (/consumo.*mes|consumo.*mensal|total.*agua.*mes|agua.*mes|gastou.*agua|quanto.*agua/.test(msg)) {
    return INTENTS.CONSUMO_AGUA_MES;
  }
  
  // Leitura de água
  if (/agua|leitura|caixa.*agua|hidrometro/.test(msg)) {
    console.log('[Agent] Intent detectado: LEITURA_AGUA para mensagem:', msg);
    return INTENTS.LEITURA_AGUA;
  }
  
  // Checklists
  if (/checklist|verificacao|rotina|automatico.*checklist|proxim.*checklist/.test(msg)) {
    return INTENTS.CHECKLISTS;
  }
  
  // Notas e boletos
  if (/nota|boleto|vencimento|pagar|pendente.*pag|fatura/.test(msg)) {
    if (/registrar|lancar|criar|adicionar|colocar|por no sistema/.test(msg)) {
      return INTENTS.CRIAR_NOTA;
    }
    return INTENTS.LISTAR_NOTAS;
  }
  
  // Estoque baixo
  if (/estoque baixo|faltando|acabando|repor|minimo/.test(msg)) {
    return INTENTS.ESTOQUE_BAIXO;
  }
  
  // Técnico / Funcionário
  if (/tecnico|funcionario|quantas os.*fez|quantas os.*ele|os (do|da|de) \w|destaque|ranking|quem (mais|fez)|desempenho/.test(msg)) {
    return INTENTS.TECNICO;
  }
  
  // Ordens de serviço
  if (/os\s|ordem|servico|manutencao|pendente|aberto/.test(msg)) {
    return INTENTS.ORDEM_SERVICO;
  }
  
  // Forum / Relatórios
  if (/forum|relatorio|recibo/.test(msg)) {
    return INTENTS.FORUM;
  }
  
  // Diesel
  if (/diesel|combustivel|abastec/.test(msg)) {
    return INTENTS.DIESEL;
  }
  
  // Gerador
  if (/gerador|energia|luz/.test(msg)) {
    return INTENTS.GERADOR;
  }
  
  // Compras
  if (/compra|pedido|fornecedor|orcamento/.test(msg)) {
    return INTENTS.COMPRAS;
  }
  
  return INTENTS.DESCONHECIDO;
}

/**
 * Extrai entidades da mensagem
 */
function extractEntities(message, intent) {
  const entities = {};
  const msg = message.toLowerCase();
  
  // Extrair nome de item
  if (intent === INTENTS.BUSCAR_ITEM || intent === INTENTS.VERIFICAR_EMPRESTIMO) {
    const cleaned = msg
      .replace(/tem\s|temos\s|existe\s|ha\s|possui|com quem|quem esta|quem pegou|onde esta|esta\s/g, '')
      .replace(/\?|!|\.|,/g, '')
      .trim();
    if (cleaned) {
      entities.itemName = cleaned;
    }
  }
  
  // Extrair data/horário para água
  if (intent === INTENTS.LEITURA_AGUA) {
    if (/hoje|agora/.test(msg)) {
      entities.date = new Date().toISOString().split('T')[0];
    }
    if (/07:?00|7h|7 h|manha|manhã/.test(msg)) {
      entities.time = '07:00';
    }
    if (/16:?00|16h|16 h|tarde/.test(msg)) {
      entities.time = '16:00';
    }
    if (/aviario|aviários/.test(msg)) {
      entities.tank = 'aviarios';
    }
    if (/recria/.test(msg)) {
      entities.tank = 'recria';
    }
  }
  
  // Extrair empresa para notas
  if (intent === INTENTS.LISTAR_NOTAS || intent === INTENTS.CRIAR_NOTA) {
    let empresaMatch = msg.match(/notas?\s+["']?([\w\s]+)["']?/i);
    if (!empresaMatch) {
      empresaMatch = msg.match(/boletos?\s+["']?([\w\s]+)["']?/i);
    }
    if (empresaMatch) {
      let empresa = empresaMatch[1].replace(/^(do|da|de|pendentes?|vencid[ao]s?)\s*/gi, '').trim();
      if (empresa && empresa.length > 2) {
        entities.empresa = empresa;
        entities.detalhado = true;
      }
    }
  }
  
  // Extrair nome do técnico
  if (intent === INTENTS.TECNICO) {
    let tecMatch = msg.match(/os\s+(do|da|de)\s+([\w]+)/i);
    if (!tecMatch) {
      tecMatch = msg.match(/quantas\s+os\s+o?\s*([\w]+)/i);
    }
    if (!tecMatch) {
      tecMatch = msg.match(/tecnico\s+([\w]+)/i);
    }
    if (tecMatch) {
      entities.tecnicoNome = tecMatch[2] || tecMatch[1];
    }
    
    if (/hoje/.test(msg)) {
      entities.periodo = 'hoje';
    } else if (/mes|mensal/.test(msg)) {
      entities.periodo = 'mes';
    } else if (/semana/.test(msg)) {
      entities.periodo = 'semana';
    } else if (/destaque|ranking|todos/.test(msg)) {
      entities.ranking = true;
    }
  }
  
  // Extrair nome do relatório/recibo no forum
  if (intent === INTENTS.FORUM) {
    // Padrões: "forum recibo dimas", "relatorio dimas", "forum xyZ"
    let forumMatch = msg.match(/(?:forum|relatorio|recibo)\s+(.+)/i);
    if (forumMatch) {
      let termo = forumMatch[1].replace(/^(do|da|de)\s*/gi, '').trim();
      if (termo && termo.length > 1) {
        entities.termo = termo;
        entities.detalhado = true;
      }
    }
  }
  
  return entities;
}

/**
 * Executa query no banco de dados (modo consulta)
 */
async function executeQuery(pool, intent, entities, keyId) {
  try {
    switch (intent) {
      case INTENTS.SAIR_AGENTE: {
        return { 
          found: true, 
          type: 'exit',
          message: `👋 *Até logo!*

Modo agente desativado.
Para ativar novamente, digite:
*Icarus* + seu comando`
        };
      }
      
      case INTENTS.SAUDACAO: {
        return { 
          found: true, 
          type: 'greeting',
          message: `🦅 *Olá! Sou o ICARUS*

Seu assistente de gestão.
Posso consultar estoque, OS, notas, água, diesel e muito mais!

Digite *ajuda* para ver os comandos disponíveis.`
        };
      }
      
      case INTENTS.AJUDA: {
        return { 
          found: true, 
          type: 'help',
          message: `🦅 *ICARUS - COMANDOS*

━━━━━━━━━━━━━━━━━━━━━━

📦 *Estoque:*
• _"tem martelo?"_ → busca item
• _"estoque baixo"_ → itens em falta
• _"com quem está o X?"_ → empréstimos

🔧 *Manutenção:*
• _"OS pendentes"_ → ordens abertas
• _"técnico destaque"_ → ranking
• _"OS do Bruno hoje"_ → estatísticas

💧 *Água:* _"leitura água hoje"_
⛽ *Diesel:* _"quanto diesel?"_
🛒 *Compras:* _"pedidos de compra"_

━━━━━━━━━━━━━━━━━━━━━━

💰 *Notas e Boletos:*
• _"boletos pendentes"_ → lista
• _"nota GYN Service"_ → detalhes + arquivos

📋 *Fórum/Relatórios:*
• _"forum"_ → lista relatórios
• _"forum recibo dimas"_ → detalhes`
        };
      }
      
      case INTENTS.BUSCAR_ITEM: {
        if (!entities.itemName) {
          return { found: false, message: '❓ Especifique o item que deseja buscar' };
        }
        const result = await pool.query(
          `SELECT i.name, i.quantity, i.unit, i.location, i.category,
                  COALESCE(l.in_use, 0) as in_use,
                  COALESCE(l.borrowed_by, '') as borrowed_by
           FROM inventory_items i
           LEFT JOIN (
             SELECT item_id, SUM(quantity) as in_use, 
                    STRING_AGG(borrowed_by_name, ', ') as borrowed_by
             FROM inventory_loans 
             WHERE returned_at IS NULL
             GROUP BY item_id
           ) l ON l.item_id = i.id
           WHERE i.key_id = $1 AND (i.name ILIKE $2 OR i.sku ILIKE $2)
           LIMIT 5`,
          [keyId, `%${entities.itemName}%`]
        );
        
        if (result.rowCount === 0) {
          return { found: false, message: `🔍 *${entities.itemName}*: não encontrado no estoque` };
        }
        
        return { found: true, items: result.rows };
      }
      
      case INTENTS.VERIFICAR_EMPRESTIMO: {
        // Busca empréstimos ativos nas movimentações
        let query = `
          SELECT m.quantity, m.person_name, m.person_sector, m.created_at, m.notes, i.name as item_name, i.sku
          FROM inventory_movements m
          JOIN inventory_items i ON i.id = m.item_id
          WHERE m.usage_type = 'emprestimo' 
            AND m.is_returned = false 
            AND m.movement_type = 'saida'
            AND m.key_id = $1
        `;
        const params = [keyId];
        
        if (entities.itemName) {
          query += ` AND (i.name ILIKE $2 OR i.sku ILIKE $2)`;
          params.push(`%${entities.itemName}%`);
        }
        
        query += ` ORDER BY m.created_at DESC LIMIT 10`;
        
        const result = await pool.query(query, params);
        
        if (result.rowCount === 0) {
          return { found: false, message: '✅ Nenhum empréstimo ativo no momento' };
        }
        
        return { found: true, loans: result.rows };
      }
      
      case INTENTS.LEITURA_AGUA: {
        let query = `
          SELECT tank_name, reading_value, reading_time, reading_date, temperature
          FROM water_readings
          WHERE key_id = $1
        `;
        const params = [keyId];
        let paramCount = 2;
        
        if (entities.date) {
          query += ` AND reading_date = $${paramCount++}`;
          params.push(entities.date);
        }
        if (entities.time) {
          query += ` AND reading_time = $${paramCount++}`;
          params.push(entities.time);
        }
        if (entities.tank) {
          query += ` AND tank_name = $${paramCount++}`;
          params.push(entities.tank);
        }
        
        query += ` ORDER BY reading_date DESC, reading_time DESC LIMIT 10`;
        
        const result = await pool.query(query, params);
        
        if (result.rowCount === 0) {
          return { found: false, message: '💧 Nenhuma leitura de água encontrada' };
        }
        
        return { found: true, readings: result.rows };
      }
      
      case INTENTS.CONSUMO_AGUA_MES: {
        // Calcular consumo total de água do mês atual
        const now = new Date();
        const inicioMes = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
        const fimMes = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
        
        const result = await pool.query(`
          SELECT 
            tank_name,
            COUNT(*) as leituras,
            SUM(reading_value) as total_litros,
            AVG(reading_value) as media_diaria,
            MAX(reading_value) as maior_leitura,
            MIN(reading_value) as menor_leitura
          FROM water_readings
          WHERE key_id = $1 
            AND reading_date >= $2 
            AND reading_date <= $3
          GROUP BY tank_name
          ORDER BY total_litros DESC
        `, [keyId, inicioMes, fimMes]);
        
        if (result.rowCount === 0) {
          return { found: false, message: '💧 Nenhuma leitura de água registrada este mês' };
        }
        
        return { found: true, consumo: result.rows, periodo: { inicio: inicioMes, fim: fimMes } };
      }
      
      case INTENTS.RELATORIO_AGUA_HTML: {
        // Extrair mês/ano da mensagem (ex: "01/26", "02/2026", "janeiro 2026")
        const msg = message.toLowerCase();
        let targetMonth, targetYear;
        
        // Tentar extrair mês/ano no formato MM/YY ou MM/YYYY
        const dateMatch = msg.match(/(\d{1,2})\s*[\/\-]\s*(\d{2,4})/);
        if (dateMatch) {
          targetMonth = parseInt(dateMatch[1]);
          targetYear = parseInt(dateMatch[2]);
          if (targetYear < 100) targetYear += 2000; // 26 -> 2026
        } else {
          // Usar mês atual se não especificado
          const now = new Date();
          targetMonth = now.getMonth() + 1;
          targetYear = now.getFullYear();
        }
        
        const inicioMes = `${targetYear}-${String(targetMonth).padStart(2, '0')}-01`;
        const fimMes = new Date(targetYear, targetMonth, 0).toISOString().split('T')[0];
        
        // Buscar TODAS as leituras do mês para gerar relatório completo
        const result = await pool.query(`
          SELECT 
            id, tank_name, reading_date, reading_time, reading_value, 
            temperature, notes, created_at
          FROM water_readings
          WHERE key_id = $1 
            AND reading_date >= $2 
            AND reading_date <= $3
          ORDER BY reading_date ASC, reading_time ASC
        `, [keyId, inicioMes, fimMes]);
        
        // Buscar resumo por caixa
        const resumo = await pool.query(`
          SELECT 
            tank_name,
            COUNT(*) as leituras,
            MIN(reading_value) as menor_leitura,
            MAX(reading_value) as maior_leitura,
            AVG(temperature) as temp_media
          FROM water_readings
          WHERE key_id = $1 
            AND reading_date >= $2 
            AND reading_date <= $3
          GROUP BY tank_name
        `, [keyId, inicioMes, fimMes]);
        
        // Calcular consumo diário
        const consumoDiario = await pool.query(`
          WITH daily_readings AS (
            SELECT 
              tank_name,
              reading_date,
              MAX(CASE WHEN reading_time = '07:00' THEN reading_value END) as leitura_7h,
              MAX(CASE WHEN reading_time = '16:00' THEN reading_value END) as leitura_16h
            FROM water_readings
            WHERE key_id = $1 
              AND reading_date >= $2 
              AND reading_date <= $3
            GROUP BY tank_name, reading_date
          )
          SELECT * FROM daily_readings ORDER BY reading_date ASC
        `, [keyId, inicioMes, fimMes]);
        
        if (result.rowCount === 0) {
          const mesNome = new Date(targetYear, targetMonth - 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
          return { found: false, message: `💧 Nenhuma leitura de água registrada em ${mesNome}` };
        }
        
        return { 
          found: true, 
          readings: result.rows,
          resumo: resumo.rows,
          consumoDiario: consumoDiario.rows,
          periodo: { 
            inicio: inicioMes, 
            fim: fimMes,
            mes: targetMonth,
            ano: targetYear
          }
        };
      }
      
      case INTENTS.CHECKLISTS: {
        // Buscar checklists com informações de automação
        const result = await pool.query(`
          SELECT 
            c.id, c.name, c.sector, c.frequency,
            c.auto_complete, c.frequency_days, c.auto_time,
            c.next_execution, c.last_auto_execution,
            (SELECT COUNT(*) FROM checklist_items WHERE checklist_id = c.id) as total_itens,
            (SELECT MAX(executed_at) FROM checklist_executions WHERE checklist_id = c.id) as ultima_execucao
          FROM checklists c
          WHERE c.key_id = $1
          ORDER BY c.name
        `, [keyId]);
        
        if (result.rowCount === 0) {
          return { found: false, message: '📋 Nenhum checklist cadastrado' };
        }
        
        return { found: true, checklists: result.rows };
      }
      
      case INTENTS.LISTAR_NOTAS: {
        let query;
        const params = [keyId];
        
        if (entities.empresa && entities.detalhado) {
          query = `
            SELECT id, empresa, descricao, responsavel, setor, 
                   valor_nota, valor_boleto, data_emissao, data_vencimento, 
                   status, nota_anexo, boleto_anexo, observacoes
            FROM notas_boletos
            WHERE key_id = $1 AND (empresa ILIKE $2 OR descricao ILIKE $2)
            ORDER BY data_vencimento ASC LIMIT 5
          `;
          params.push(`%${entities.empresa}%`);
        } else {
          query = `
            SELECT empresa, descricao, valor_boleto, data_vencimento, status
            FROM notas_boletos
            WHERE key_id = $1 AND status != 'pago'
          `;
          
          if (entities.empresa) {
            query += ` AND empresa ILIKE $2`;
            params.push(`%${entities.empresa}%`);
          }
          
          query += ` ORDER BY data_vencimento ASC LIMIT 10`;
        }
        
        const result = await pool.query(query, params);
        
        if (result.rowCount === 0) {
          return { found: false, message: '✅ Nenhuma nota/boleto pendente' };
        }
        
        return { found: true, notas: result.rows };
      }
      
      case INTENTS.ESTOQUE_BAIXO: {
        const result = await pool.query(
          `SELECT name, quantity, unit, min_stock, category
           FROM inventory_items
           WHERE key_id = $1 AND quantity <= COALESCE(min_stock, 0)
           ORDER BY quantity ASC LIMIT 10`,
          [keyId]
        );
        
        if (result.rowCount === 0) {
          return { found: false, message: '✅ Todos os itens com estoque adequado!' };
        }
        
        return { found: true, items: result.rows };
      }
      
      case INTENTS.ORDEM_SERVICO: {
        const result = await pool.query(
          `SELECT title, sector, priority, status, created_at
           FROM orders
           WHERE key_id = $1 AND status != 'completed'
           ORDER BY 
             CASE priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
             created_at DESC
           LIMIT 10`,
          [keyId]
        );
        
        if (result.rowCount === 0) {
          return { found: false, message: '✅ Nenhuma OS pendente!' };
        }
        
        return { found: true, orders: result.rows };
      }
      
      case INTENTS.TECNICO: {
        const hoje = new Date().toISOString().split('T')[0];
        const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
        const inicioSemana = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        
        if (entities.ranking || !entities.tecnicoNome) {
          const result = await pool.query(
            `SELECT u.name, u.role,
                    COUNT(CASE WHEN o.status = 'completed' THEN 1 END) as total_completas,
                    COUNT(CASE WHEN o.status = 'completed' AND DATE(o.finished_at) = $2 THEN 1 END) as hoje,
                    COUNT(CASE WHEN o.status = 'completed' AND DATE(o.finished_at) >= $3 THEN 1 END) as este_mes
             FROM users u
             LEFT JOIN order_assignments oa ON oa.user_id = u.id
             LEFT JOIN orders o ON o.id = oa.order_id
             WHERE u.key_id = $1 AND u.role IN ('tech', 'admin')
             GROUP BY u.id, u.name, u.role
             HAVING COUNT(CASE WHEN o.status = 'completed' THEN 1 END) > 0
             ORDER BY este_mes DESC, total_completas DESC
             LIMIT 10`,
            [keyId, hoje, inicioMes]
          );
          
          if (result.rowCount === 0) {
            return { found: false, message: '📊 Nenhum técnico com OS registradas' };
          }
          
          return { found: true, ranking: result.rows, tipo: 'ranking' };
        }
        
        const tecResult = await pool.query(
          `SELECT u.id, u.name, u.role
           FROM users u
           WHERE u.key_id = $1 AND u.name ILIKE $2
           LIMIT 1`,
          [keyId, `%${entities.tecnicoNome}%`]
        );
        
        if (tecResult.rowCount === 0) {
          return { found: false, message: `❓ Técnico *${entities.tecnicoNome}* não encontrado` };
        }
        
        const tecnico = tecResult.rows[0];
        let dateFilter = '';
        let periodo = '';
        
        if (entities.periodo === 'hoje') {
          dateFilter = `AND DATE(o.finished_at) = '${hoje}'`;
          periodo = 'hoje';
        } else if (entities.periodo === 'semana') {
          dateFilter = `AND DATE(o.finished_at) >= '${inicioSemana}'`;
          periodo = 'esta semana';
        } else {
          dateFilter = `AND DATE(o.finished_at) >= '${inicioMes}'`;
          periodo = 'este mês';
        }
        
        const statsResult = await pool.query(
          `SELECT 
             COUNT(*) FILTER (WHERE o.status = 'completed' ${dateFilter.replace('AND ', '')}) as completas,
             COUNT(*) FILTER (WHERE o.status IN ('pending', 'in_progress')) as pendentes,
             COALESCE(SUM(o.worked_minutes) FILTER (WHERE o.status = 'completed' ${dateFilter.replace('AND ', '')}), 0) as minutos_trabalhados
           FROM order_assignments oa
           JOIN orders o ON o.id = oa.order_id
           WHERE oa.user_id = $1`,
          [tecnico.id]
        );
        
        const osResult = await pool.query(
          `SELECT o.title, o.sector, o.finished_at, o.worked_minutes
           FROM order_assignments oa
           JOIN orders o ON o.id = oa.order_id
           WHERE oa.user_id = $1 AND o.status = 'completed' ${dateFilter}
           ORDER BY o.finished_at DESC
           LIMIT 5`,
          [tecnico.id]
        );
        
        return { 
          found: true, 
          tecnico: tecnico,
          stats: statsResult.rows[0],
          ultimasOS: osResult.rows,
          periodo: periodo,
          tipo: 'individual'
        };
      }
      
      case INTENTS.DIESEL: {
        const result = await pool.query(
          `SELECT record_type, quantity, reason, record_date
           FROM diesel_records
           WHERE key_id = $1
           ORDER BY record_date DESC, created_at DESC
           LIMIT 10`,
          [keyId]
        );
        
        const saldoResult = await pool.query(
          `SELECT 
             COALESCE(SUM(CASE WHEN record_type = 'entrada' THEN quantity ELSE 0 END), 0) -
             COALESCE(SUM(CASE WHEN record_type = 'saida' THEN quantity ELSE 0 END), 0) as saldo
           FROM diesel_records
           WHERE key_id = $1`,
          [keyId]
        );
        
        return { 
          found: true, 
          records: result.rows,
          saldo: saldoResult.rows[0]?.saldo || 0
        };
      }
      
      case INTENTS.COMPRAS: {
        const result = await pool.query(
          `SELECT item_name, quantity, unit, status, supplier
           FROM purchases
           WHERE key_id = $1 AND status NOT IN ('chegou', 'cancelado')
           ORDER BY created_at DESC
           LIMIT 10`,
          [keyId]
        );
        
        if (result.rowCount === 0) {
          return { found: false, message: '✅ Nenhum pedido de compra pendente' };
        }
        
        return { found: true, purchases: result.rows };
      }
      
      case INTENTS.FORUM: {
        // Se busca por termo específico, trazer detalhes
        if (entities.termo && entities.detalhado) {
          const result = await pool.query(
            `SELECT mr.id, mr.title, mr.content, mr.category, mr.created_at, u.name as autor
             FROM maintenance_reports mr
             LEFT JOIN users u ON u.id = mr.created_by
             WHERE mr.key_id = $1 AND (mr.title ILIKE $2 OR mr.content ILIKE $2)
             ORDER BY mr.created_at DESC
             LIMIT 5`,
            [keyId, `%${entities.termo}%`]
          );
          
          if (result.rowCount === 0) {
            return { found: false, message: `🔍 Nenhum relatório encontrado com *"${entities.termo}"*` };
          }
          
          return { found: true, reports: result.rows, detalhado: true };
        }
        
        // Lista geral de relatórios
        const result = await pool.query(
          `SELECT mr.id, mr.title, mr.category, mr.created_at, u.name as autor
           FROM maintenance_reports mr
           LEFT JOIN users u ON u.id = mr.created_by
           WHERE mr.key_id = $1
           ORDER BY mr.created_at DESC
           LIMIT 15`,
          [keyId]
        );
        
        if (result.rowCount === 0) {
          return { found: false, message: '📋 Nenhum relatório no fórum ainda' };
        }
        
        return { found: true, reports: result.rows, detalhado: false };
      }
      
      default:
        return { found: false, message: `❓ Não entendi sua pergunta.

💡 *Dicas:*
• Para consultas: _"tem martelo?"_, _"OS pendentes"_
• Para ações: _"Icarus, chegou 100 pregos"_
• Para ajuda: _"ajuda"_` };
    }
  } catch (error) {
    console.error('[Agent] Erro na query:', error);
    return { found: false, message: '⚠️ Erro interno. Tente novamente.' };
  }
}

/**
 * Formata resposta para envio
 */
function formatResponse(intent, data) {
  if (!data.found) {
    return data.message || '❓ Não encontrado';
  }
  
  if (data.type === 'greeting' || data.type === 'help' || data.type === 'exit') {
    return data.message;
  }
  
  switch (intent) {
    case INTENTS.SAUDACAO:
    case INTENTS.AJUDA:
    case INTENTS.SAIR_AGENTE:
      return data.message;
    
    case INTENTS.BUSCAR_ITEM: {
      let header = `📦 *ESTOQUE*\n━━━━━━━━━━━━━━━━\n`;
      return header + data.items.map(i => {
        let resp = `*${i.name}*: ${i.quantity} ${i.unit}`;
        if (i.in_use > 0) {
          resp += `\n   ⚠️ _${i.in_use} emprestado(s) para ${i.borrowed_by}_`;
        }
        if (i.location) resp += `\n   📍 ${i.location}`;
        return resp;
      }).join('\n\n') + PERGUNTA_FINAL;
    }
    
    case INTENTS.VERIFICAR_EMPRESTIMO: {
      let header = `� *FERRAMENTAS EM USO*\n━━━━━━━━━━━━━━━━━━━━\n`;
      return header + data.loans.map(l => {
        const date = new Date(l.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        let resp = `• *${l.item_name}*: ${l.quantity}x`;
        resp += `\n   👤 ${l.person_name || 'Não informado'}`;
        if (l.person_sector) resp += ` (${l.person_sector})`;
        resp += `\n   📅 ${date}`;
        if (l.notes) resp += `\n   📝 ${l.notes}`;
        return resp;
      }).join('\n\n') + PERGUNTA_FINAL;
    }
    
    case INTENTS.LEITURA_AGUA: {
      let header = `💧 *LEITURAS DE ÁGUA*\n━━━━━━━━━━━━━━━━━━━━\n`;
      return header + data.readings.map(r => {
        const date = new Date(r.reading_date).toLocaleDateString('pt-BR');
        let resp = `*${r.tank_name}*\n   📅 ${date} às ${r.reading_time}\n   📊 ${r.reading_value}m³`;
        if (r.temperature) resp += ` | 🌡️ ${r.temperature}°C`;
        return resp;
      }).join('\n\n') + PERGUNTA_FINAL;
    }
    
    case INTENTS.CONSUMO_AGUA_MES: {
      const mesNome = new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
      let header = `💧 *CONSUMO DE ÁGUA - ${mesNome.toUpperCase()}*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
      
      let totalGeral = 0;
      header += data.consumo.map(c => {
        const total = parseFloat(c.total_litros) || 0;
        totalGeral += total;
        const media = parseFloat(c.media_diaria) || 0;
        return `📊 *${c.tank_name}*\n   💧 Total: *${total.toFixed(1)}m³*\n   📈 Média/dia: ${media.toFixed(1)}m³\n   📉 Min: ${c.menor_leitura}m³ | Max: ${c.maior_leitura}m³\n   📋 ${c.leituras} leituras`;
      }).join('\n\n');
      
      header += `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
      header += `\n💧 *TOTAL GERAL: ${totalGeral.toFixed(1)}m³*`;
      
      return header + PERGUNTA_FINAL;
    }
    
    case INTENTS.RELATORIO_AGUA_HTML: {
      // Este intent retorna um objeto especial que será tratado pelo processMessage
      // para gerar o HTML e enviar como arquivo
      console.log('[Agent] formatResponse: Retornando objeto isHtmlReport para RELATORIO_AGUA_HTML');
      return {
        isHtmlReport: true,
        reportType: 'water',
        data: data
      };
    }
    
    case INTENTS.CHECKLISTS: {
      let header = `📋 *CHECKLISTS*\n━━━━━━━━━━━━━━━━━━━━\n\n`;
      
      const automaticos = data.checklists.filter(c => c.auto_complete);
      const manuais = data.checklists.filter(c => !c.auto_complete);
      
      if (automaticos.length > 0) {
        header += `⚡ *Automáticos (${automaticos.length}):*\n`;
        header += automaticos.map(c => {
          let resp = `• *${c.name}*`;
          if (c.sector) resp += ` (${c.sector})`;
          resp += `\n   ⏰ Hora: ${c.auto_time || '11:00'}`;
          resp += ` | 📆 ${c.frequency_days === 1 ? 'Diário' : c.frequency_days === 2 ? 'Dia sim/não' : `A cada ${c.frequency_days} dias`}`;
          
          if (c.next_execution) {
            const prox = new Date(c.next_execution);
            const agora = new Date();
            const diffMs = prox - agora;
            const diffHoras = Math.floor(diffMs / (1000 * 60 * 60));
            const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
            
            if (diffMs > 0) {
              resp += `\n   ⏳ Próxima: ${diffHoras > 0 ? diffHoras + 'h ' : ''}${diffMins}min`;
            } else {
              resp += `\n   ✅ Executado hoje`;
            }
          }
          return resp;
        }).join('\n\n');
      }
      
      if (manuais.length > 0) {
        header += `\n\n📝 *Manuais (${manuais.length}):*\n`;
        header += manuais.map(c => {
          let resp = `• *${c.name}*`;
          if (c.sector) resp += ` (${c.sector})`;
          resp += ` - ${c.total_itens} itens`;
          if (c.ultima_execucao) {
            const ultima = new Date(c.ultima_execucao);
            resp += `\n   📅 Última: ${ultima.toLocaleDateString('pt-BR')}`;
          }
          return resp;
        }).join('\n');
      }
      
      return header + PERGUNTA_FINAL;
    }
    
    case INTENTS.LISTAR_NOTAS: {
      if (data.notas[0]?.nota_anexo !== undefined) {
        let header = `📄 *DETALHES DA NOTA*\n━━━━━━━━━━━━━━━━━━━━\n`;
        return header + data.notas.map(n => {
          const venc = n.data_vencimento ? new Date(n.data_vencimento).toLocaleDateString('pt-BR') : 'sem venc.';
          const emissao = n.data_emissao ? new Date(n.data_emissao).toLocaleDateString('pt-BR') : '-';
          
          let resp = `🏢 *${n.empresa}*\n`;
          if (n.descricao) resp += `├ 📝 ${n.descricao}\n`;
          if (n.setor) resp += `├ 🏷️ Setor: ${n.setor}\n`;
          if (n.responsavel) resp += `├ 👤 Resp: ${n.responsavel}\n`;
          resp += `├ 💵 Nota: R$ ${n.valor_nota?.toFixed(2) || '0,00'}\n`;
          resp += `├ 💰 Boleto: R$ ${n.valor_boleto?.toFixed(2) || '0,00'}\n`;
          resp += `├ 📅 Emissão: ${emissao}\n`;
          
          const hoje = new Date();
          const vencDate = n.data_vencimento ? new Date(n.data_vencimento) : null;
          const vencido = vencDate && vencDate < hoje;
          
          resp += `├ ⏰ Venc: ${venc} ${vencido ? '🔴 VENCIDO!' : ''}\n`;
          resp += `├ 📊 Status: *${n.status}*\n`;
          
          if (n.nota_anexo) {
            const nota = typeof n.nota_anexo === 'string' ? JSON.parse(n.nota_anexo) : n.nota_anexo;
            if (nota.url) resp += `├ 📎 Nota: ${nota.url}\n`;
          }
          if (n.boleto_anexo) {
            const boleto = typeof n.boleto_anexo === 'string' ? JSON.parse(n.boleto_anexo) : n.boleto_anexo;
            if (boleto.url) resp += `├ 📎 Boleto: ${boleto.url}\n`;
          }
          if (n.observacoes) resp += `└ 💬 ${n.observacoes}`;
          
          return resp;
        }).join('\n\n') + PERGUNTA_FINAL;
      }
      
      let header = `💰 *NOTAS/BOLETOS PENDENTES*\n━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      header += data.notas.map(n => {
        const venc = n.data_vencimento ? new Date(n.data_vencimento).toLocaleDateString('pt-BR') : 'sem venc.';
        const hoje = new Date();
        const vencDate = n.data_vencimento ? new Date(n.data_vencimento) : null;
        const vencido = vencDate && vencDate < hoje;
        const urgente = vencDate && (vencDate - hoje) / (1000 * 60 * 60 * 24) <= 3;
        
        let icon = '📋';
        if (vencido) icon = '🔴';
        else if (urgente) icon = '🟡';
        
        return `${icon} *${n.empresa}*\n   R$ ${n.valor_boleto || 0} | Venc: ${venc}`;
      }).join('\n\n');
      
      header += `\n\n💡 _Para ver detalhes, digite:_\n_"nota [nome da empresa]"_`;
      return header + PERGUNTA_FINAL;
    }
    
    case INTENTS.ESTOQUE_BAIXO: {
      let header = `⚠️ *ESTOQUE BAIXO*\n━━━━━━━━━━━━━━━━━━━━\n`;
      return header + data.items.map(i => 
        `🔴 *${i.name}*\n   Atual: ${i.quantity} | Mínimo: ${i.min_stock} ${i.unit}`
      ).join('\n\n') + PERGUNTA_FINAL;
    }
    
    case INTENTS.ORDEM_SERVICO: {
      let header = `🔧 *ORDENS DE SERVIÇO*\n━━━━━━━━━━━━━━━━━━━━━━\n`;
      return header + data.orders.map(o => {
        let icon = '🟢';
        if (o.priority === 'critical') icon = '🔴';
        else if (o.priority === 'high') icon = '🟠';
        else if (o.priority === 'medium') icon = '🟡';
        
        const statusMap = { pending: '⏳ Pendente', in_progress: '🔄 Em andamento', paused: '⏸️ Pausado' };
        
        return `${icon} *${o.title}*\n   📍 ${o.sector || 'Geral'} | ${statusMap[o.status] || o.status}`;
      }).join('\n\n') + PERGUNTA_FINAL;
    }
    
    case INTENTS.TECNICO: {
      if (data.tipo === 'ranking') {
        let header = `🏆 *RANKING DE TÉCNICOS*\n━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        return header + data.ranking.map((t, i) => {
          const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `*${i+1}.*`;
          return `${medal} *${t.name}*\n   📅 Mês: ${t.este_mes} | 📆 Hoje: ${t.hoje} | 📊 Total: ${t.total_completas}`;
        }).join('\n\n') + PERGUNTA_FINAL;
      }
      
      const stats = data.stats || {};
      const minutos = parseInt(stats.minutos_trabalhados) || 0;
      const horas = Math.floor(minutos / 60);
      const mins = minutos % 60;
      
      let resp = `👷 *${data.tecnico.name}*\n`;
      resp += `━━━━━━━━━━━━━━━━━━━━━━\n`;
      resp += `📊 *Período: ${data.periodo}*\n\n`;
      resp += `✅ OS Completas: *${stats.completas || 0}*\n`;
      resp += `⏳ OS Pendentes: *${stats.pendentes || 0}*\n`;
      resp += `⏱️ Tempo: *${horas}h${mins.toString().padStart(2, '0')}min*\n`;
      
      if (data.ultimasOS && data.ultimasOS.length > 0) {
        resp += `\n📋 *Últimas OS:*\n`;
        data.ultimasOS.forEach(os => {
          const date = os.finished_at ? new Date(os.finished_at).toLocaleDateString('pt-BR') : '-';
          const tempo = os.worked_minutes ? `(${os.worked_minutes}min)` : '';
          resp += `• ${os.title} - ${date} ${tempo}\n`;
        });
      }
      
      return resp + PERGUNTA_FINAL;
    }
    
    case INTENTS.DIESEL: {
      let header = `⛽ *CONTROLE DE DIESEL*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
      header += `💧 *Saldo Atual: ${data.saldo}L*\n\n`;
      
      if (data.records.length > 0) {
        header += `📋 *Últimas Movimentações:*\n`;
        header += data.records.slice(0, 5).map(r => {
          const date = new Date(r.record_date).toLocaleDateString('pt-BR');
          const icon = r.record_type === 'entrada' ? '📥' : '📤';
          return `${icon} ${r.record_type}: ${r.quantity}L (${date})`;
        }).join('\n');
      }
      
      return header + PERGUNTA_FINAL;
    }
    
    case INTENTS.COMPRAS: {
      let header = `🛒 *PEDIDOS DE COMPRA*\n━━━━━━━━━━━━━━━━━━━━━━\n`;
      return header + data.purchases.map(p => {
        const statusIcon = { aguardando: '⏳', aprovado: '✅', pedido: '📦' };
        return `${statusIcon[p.status] || '📋'} *${p.item_name}*\n   ${p.quantity} ${p.unit} | ${p.status}`;
      }).join('\n\n') + PERGUNTA_FINAL;
    }
    
    case INTENTS.FORUM: {
      if (data.detalhado) {
        // Detalhes do relatório
        let header = `📋 *FÓRUM - RELATÓRIO*\n━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        return header + data.reports.map(r => {
          const date = new Date(r.created_at).toLocaleDateString('pt-BR');
          let resp = `📄 *${r.title}*\n`;
          resp += `├ 🏷️ Categoria: ${r.category || 'Geral'}\n`;
          resp += `├ 👤 Autor: ${r.autor || 'Desconhecido'}\n`;
          resp += `├ 📅 Data: ${date}\n`;
          resp += `└ 📝 *Conteúdo:*\n\n${r.content}`;
          return resp;
        }).join('\n\n━━━━━━━━━━━━━━━━━━━━━━━━\n\n') + PERGUNTA_FINAL;
      }
      
      // Lista geral
      let header = `📋 *FÓRUM - RELATÓRIOS*\n━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
      header += data.reports.map((r, i) => {
        const date = new Date(r.created_at).toLocaleDateString('pt-BR');
        return `${i+1}. *${r.title}*\n   📁 ${r.category || 'Geral'} | 📅 ${date}`;
      }).join('\n\n');
      
      header += `\n\n💡 _Para ver detalhes, digite:_\n_"forum [nome do relatório]"_`;
      return header + PERGUNTA_FINAL;
    }
    
    default:
      return '❓ Não encontrado';
  }
}

// ==========================================
// MODO AGENTE - GPT-4o-mini
// ==========================================

/**
 * Processa comando com GPT-4o-mini e executa ação real
 */
async function processAgentCommand(pool, message, keyId, phone) {
  try {
    // Remove "Icarus" do início
    const comando = message.replace(/^icarus[,\s]+/i, '').trim();
    
    console.log(`[Agent GPT] Comando: ${comando}`);
    
    // Chamar GPT-4o-mini
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          { role: 'system', content: AGENT_SYSTEM_PROMPT },
          { role: 'user', content: comando }
        ],
        max_tokens: MAX_TOKENS,
        temperature: 0.2
      })
    });
    
    const gptData = await response.json();
    
    if (!gptData.choices || !gptData.choices[0]) {
      return { 
        response: '⚠️ Erro ao processar comando. Tente novamente.', 
        tokens: 0 
      };
    }
    
    const gptResponse = gptData.choices[0].message.content;
    const tokens = gptData.usage?.total_tokens || 0;
    
    console.log(`[Agent GPT] Resposta: ${gptResponse} (${tokens} tokens)`);
    
    // Tentar parsear JSON
    let parsed;
    try {
      // Limpar resposta (remover markdown se houver)
      const cleanJson = gptResponse.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      parsed = JSON.parse(cleanJson);
    } catch (e) {
      // GPT não retornou JSON válido
      return { 
        response: `🤖 ${gptResponse}`, 
        tokens 
      };
    }
    
    // Se não precisa confirmar, retorna mensagem
    if (!parsed.confirmar) {
      return { 
        response: `🤖 ${parsed.mensagem || 'Preciso de mais informações.'}`, 
        tokens,
        pendingAction: parsed
      };
    }
    
    // Executar ação real
    const result = await executeAgentAction(pool, parsed.acao, parsed.dados, keyId, phone);
    
    return { 
      response: result.message, 
      tokens,
      executed: result.ok
    };
    
  } catch (error) {
    console.error('[Agent GPT] Erro:', error);
    return { 
      response: '⚠️ Erro interno. Tente novamente.', 
      tokens: 0 
    };
  }
}

/**
 * Executa ação real no banco de dados
 */
async function executeAgentAction(pool, acao, dados, keyId, phone) {
  try {
    console.log(`[Agent Action] ${acao}:`, dados);
    
    switch (acao) {
      case 'ADICIONAR_ESTOQUE': {
        const id = uuid();
        const nome = dados.nome || dados.item || 'Item sem nome';
        const quantidade = parseInt(dados.quantidade) || 0;
        const unidade = dados.unidade || 'un';
        const categoria = dados.categoria || 'Geral';
        const localizacao = dados.localizacao || dados.local || null;
        
        // Verificar se item já existe
        const existente = await pool.query(
          `SELECT id, name, quantity, unit FROM inventory_items 
           WHERE key_id = $1 AND name ILIKE $2 LIMIT 1`,
          [keyId, `%${nome}%`]
        );
        
        if (existente.rowCount > 0) {
          // Atualizar quantidade
          const item = existente.rows[0];
          const novaQtd = item.quantity + quantidade;
          
          await pool.query(
            `UPDATE inventory_items SET quantity = $1, updated_at = NOW() WHERE id = $2`,
            [novaQtd, item.id]
          );
          
          // Log
          await pool.query(
            `INSERT INTO audit_logs (id, action, entity_type, entity_id, phone, after_data)
             VALUES ($1, 'UPDATE', 'inventory_item', $2, $3, $4)`,
            [uuid(), item.id, phone, JSON.stringify({ added: quantidade, new_total: novaQtd })]
          );
          
          return { 
            ok: true, 
            message: `✅ *ESTOQUE ATUALIZADO*\n\n📦 *${item.name}*\n├ Adicionado: +${quantidade} ${item.unit}\n└ Total atual: *${novaQtd} ${item.unit}*`
          };
        }
        
        // Criar novo item
        await pool.query(
          `INSERT INTO inventory_items (id, name, quantity, unit, category, location, key_id, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
          [id, nome, quantidade, unidade, categoria, localizacao, keyId]
        );
        
        // Log
        await pool.query(
          `INSERT INTO audit_logs (id, action, entity_type, entity_id, phone, after_data)
           VALUES ($1, 'CREATE', 'inventory_item', $2, $3, $4)`,
          [uuid(), id, phone, JSON.stringify(dados)]
        );
        
        return { 
          ok: true, 
          message: `✅ *ITEM CRIADO NO ESTOQUE*\n\n📦 *${nome}*\n├ Quantidade: ${quantidade} ${unidade}\n├ Categoria: ${categoria}\n└ 📍 ${localizacao || 'Não especificado'}`
        };
      }
      
      case 'CRIAR_NOTA': {
        const id = uuid();
        const empresa = dados.empresa || dados.fornecedor || 'Empresa não informada';
        const descricao = dados.descricao || null;
        const valorNota = parseFloat(dados.valor_nota || dados.valor) || null;
        const valorBoleto = parseFloat(dados.valor_boleto || dados.valor) || null;
        const setor = dados.setor || null;
        const responsavel = dados.responsavel || null;
        
        // Parsear data de vencimento
        let dataVencimento = null;
        if (dados.vencimento) {
          const venc = dados.vencimento;
          // Tentar formatos: dd/mm, dd/mm/yyyy
          const match = venc.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
          if (match) {
            const dia = parseInt(match[1]);
            const mes = parseInt(match[2]) - 1;
            const ano = match[3] ? (match[3].length === 2 ? 2000 + parseInt(match[3]) : parseInt(match[3])) : new Date().getFullYear();
            dataVencimento = new Date(ano, mes, dia).toISOString().split('T')[0];
          }
        }
        
        await pool.query(
          `INSERT INTO notas_boletos (id, empresa, descricao, valor_nota, valor_boleto, setor, responsavel, data_vencimento, status, key_id, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pendente', $9, NOW())`,
          [id, empresa, descricao, valorNota, valorBoleto, setor, responsavel, dataVencimento, keyId]
        );
        
        // Log
        await pool.query(
          `INSERT INTO audit_logs (id, action, entity_type, entity_id, phone, after_data)
           VALUES ($1, 'CREATE', 'nota_boleto', $2, $3, $4)`,
          [uuid(), id, phone, JSON.stringify(dados)]
        );
        
        const vencStr = dataVencimento ? new Date(dataVencimento).toLocaleDateString('pt-BR') : 'Não definido';
        
        return { 
          ok: true, 
          message: `✅ *NOTA CRIADA*\n\n🏢 *${empresa}*\n├ 💵 Valor: R$ ${(valorBoleto || valorNota || 0).toFixed(2)}\n├ 📅 Vencimento: ${vencStr}\n├ 🏷️ Setor: ${setor || 'Não definido'}\n└ 📊 Status: Pendente`
        };
      }
      
      case 'CRIAR_OS': {
        const id = uuid();
        const titulo = dados.titulo || dados.descricao || 'Ordem de Serviço';
        const descricao = dados.descricao || dados.titulo || null;
        const setor = dados.setor || 'geral';
        const prioridade = dados.prioridade || dados.urgente ? 'high' : 'medium';
        
        await pool.query(
          `INSERT INTO orders (id, title, description, sector, priority, status, key_id, created_at)
           VALUES ($1, $2, $3, $4, $5, 'pending', $6, NOW())`,
          [id, titulo, descricao, setor, prioridade, keyId]
        );
        
        // Log
        await pool.query(
          `INSERT INTO audit_logs (id, action, entity_type, entity_id, phone, after_data)
           VALUES ($1, 'CREATE', 'order', $2, $3, $4)`,
          [uuid(), id, phone, JSON.stringify(dados)]
        );
        
        const prioridadeIcon = prioridade === 'critical' ? '🔴' : prioridade === 'high' ? '🟠' : '🟡';
        
        return { 
          ok: true, 
          message: `✅ *OS CRIADA*\n\n🔧 *${titulo}*\n├ 📍 Setor: ${setor}\n├ ${prioridadeIcon} Prioridade: ${prioridade}\n└ ⏳ Status: Pendente`
        };
      }
      
      case 'REGISTRAR_DIESEL': {
        const id = uuid();
        const tipo = dados.tipo || 'entrada';
        const quantidade = parseFloat(dados.quantidade || dados.litros) || 0;
        const motivo = dados.motivo || dados.razao || null;
        const hoje = new Date().toISOString().split('T')[0];
        
        await pool.query(
          `INSERT INTO diesel_records (id, record_type, quantity, reason, record_date, key_id, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
          [id, tipo, quantidade, motivo, hoje, keyId]
        );
        
        // Calcular novo saldo
        const saldoResult = await pool.query(
          `SELECT 
             COALESCE(SUM(CASE WHEN record_type = 'entrada' THEN quantity ELSE 0 END), 0) -
             COALESCE(SUM(CASE WHEN record_type = 'saida' THEN quantity ELSE 0 END), 0) as saldo
           FROM diesel_records WHERE key_id = $1`,
          [keyId]
        );
        const saldo = saldoResult.rows[0]?.saldo || 0;
        
        // Log
        await pool.query(
          `INSERT INTO audit_logs (id, action, entity_type, entity_id, phone, after_data)
           VALUES ($1, 'CREATE', 'diesel_record', $2, $3, $4)`,
          [uuid(), id, phone, JSON.stringify({ ...dados, novo_saldo: saldo })]
        );
        
        const icon = tipo === 'entrada' ? '📥' : '📤';
        
        return { 
          ok: true, 
          message: `✅ *DIESEL REGISTRADO*\n\n${icon} *${tipo.toUpperCase()}*\n├ Quantidade: ${quantidade}L\n├ Motivo: ${motivo || '-'}\n└ 💧 Saldo atual: *${saldo}L*`
        };
      }
      
      case 'REGISTRAR_AGUA': {
        const id = uuid();
        const tanque = dados.tanque || dados.caixa || 'principal';
        const valor = parseFloat(dados.valor || dados.leitura) || 0;
        const horario = dados.horario || '07:00';
        const hoje = new Date().toISOString().split('T')[0];
        const temperatura = dados.temperatura ? parseFloat(dados.temperatura) : null;
        
        await pool.query(
          `INSERT INTO water_readings (id, tank_name, reading_value, reading_time, reading_date, temperature, key_id, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
          [id, tanque, valor, horario, hoje, temperatura, keyId]
        );
        
        // Log
        await pool.query(
          `INSERT INTO audit_logs (id, action, entity_type, entity_id, phone, after_data)
           VALUES ($1, 'CREATE', 'water_reading', $2, $3, $4)`,
          [uuid(), id, phone, JSON.stringify(dados)]
        );
        
        return { 
          ok: true, 
          message: `✅ *LEITURA REGISTRADA*\n\n💧 *${tanque}*\n├ Valor: ${valor}m³\n├ Horário: ${horario}\n└ Data: ${new Date(hoje).toLocaleDateString('pt-BR')}` + (temperatura ? `\n🌡️ Temp: ${temperatura}°C` : '')
        };
      }
      
      default:
        return { 
          ok: false, 
          message: `❓ Ação *${acao}* não reconhecida.\n\nTente novamente com mais detalhes.`
        };
    }
  } catch (error) {
    console.error('[Agent Action] Erro:', error);
    return { 
      ok: false, 
      message: '⚠️ Erro ao executar ação. Verifique os dados e tente novamente.'
    };
  }
}

/**
 * Processa mensagem completa (decide entre fluxo OS, consulta ou agente)
 */
async function processMessage(pool, message, keyId, options = {}) {
  const startTime = Date.now();
  const phone = options.phone || 'unknown';
  const senderName = options.senderName || null;
  const sendWhatsApp = options.sendWhatsApp || null; // função para enviar WhatsApp
  
  // Verificar se é comando de saída
  if (isExitCommand(message) && isAgentSessionActive(phone)) {
    deactivateAgentSession(phone);
    return {
      intent: INTENTS.SAIR_AGENTE,
      response: `👋 *Modo agente desativado*\n\nPara ativar novamente, digite:\n*Icarus* + seu comando`,
      latency: Date.now() - startTime,
      tokens: 0,
      mode: 'exit'
    };
  }
  
  // Verificar se é comando do agente (começa com "Icarus")
  if (isAgentCommand(message)) {
    activateAgentSession(phone);
    
    const result = await processAgentCommand(pool, message, keyId, phone);
    
    return {
      intent: 'agent_command',
      response: result.response,
      latency: Date.now() - startTime,
      tokens: result.tokens,
      mode: 'agent',
      executed: result.executed
    };
  }
  
  // Verificar se está em sessão ativa (continua conversa do agente)
  if (isAgentSessionActive(phone)) {
    touchAgentSession(phone);
    
    // Processar como continuação da conversa do agente
    const result = await processAgentCommand(pool, `Icarus, ${message}`, keyId, phone);
    
    return {
      intent: 'agent_continuation',
      response: result.response,
      latency: Date.now() - startTime,
      tokens: result.tokens,
      mode: 'agent',
      executed: result.executed
    };
  }
  
  // FLUXO DE OS: Verificar pendências e perguntas sobre OS
  if (sendWhatsApp) {
    try {
      const osFlowResult = await osFlow.processOSFlowMessage(
        pool, 
        sendWhatsApp, 
        phone, 
        message, 
        senderName
      );
      
      if (osFlowResult && osFlowResult.handled) {
        return {
          intent: 'os_flow',
          response: osFlowResult.response,
          latency: Date.now() - startTime,
          tokens: 0,
          mode: 'os_flow',
          forward: osFlowResult.forward
        };
      }
    } catch (error) {
      console.error('[OS Flow] Erro:', error);
      // Continua para o modo consulta normal
    }
  }
  
  // Modo consulta (sem tokens)
  const intent = classifyIntent(message);
  const entities = extractEntities(message, intent);
  const data = await executeQuery(pool, intent, entities, keyId);
  const response = formatResponse(intent, data);
  
  return {
    intent,
    entities,
    response,
    latency: Date.now() - startTime,
    tokens: 0,
    mode: 'query'
  };
}

/**
 * Cria nota/boleto (legado)
 */
async function createNota(pool, data, keyId) {
  const id = uuid();
  
  try {
    await pool.query(
      `INSERT INTO notas_boletos (id, empresa, descricao, valor_boleto, data_vencimento, status, key_id)
       VALUES ($1, $2, $3, $4, $5, 'pendente', $6)`,
      [id, data.empresa, data.descricao || null, data.valor || null, data.vencimento || null, keyId]
    );
    
    await pool.query(
      `INSERT INTO audit_logs (id, action, entity_type, entity_id, phone, after_data)
       VALUES ($1, 'CREATE', 'nota_boleto', $2, $3, $4)`,
      [uuid(), id, data.phone || null, JSON.stringify(data)]
    );
    
    return { ok: true, message: `✅ Nota *${data.empresa}* criada!` };
  } catch (error) {
    console.error('[Agent] Erro ao criar nota:', error);
    return { ok: false, message: '⚠️ Erro ao criar nota' };
  }
}

/**
 * Processa com IA (legado)
 */
async function processWithAI(message, context = {}) {
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          { role: 'system', content: AGENT_SYSTEM_PROMPT },
          { role: 'user', content: message }
        ],
        max_tokens: MAX_TOKENS,
        temperature: 0.3
      })
    });
    
    const data = await response.json();
    
    if (data.choices && data.choices[0]) {
      return {
        text: data.choices[0].message.content,
        tokens: data.usage?.total_tokens || 0
      };
    }
    
    return { text: '❓ Não encontrado', tokens: 0 };
  } catch (error) {
    console.error('[Agent] Erro OpenAI:', error);
    return { text: '⚠️ Erro no processamento', tokens: 0 };
  }
}

/**
 * Gera HTML do relatório de água para envio via WhatsApp
 */
function generateWaterReportHtml(data) {
  const { readings, resumo, consumoDiario, periodo } = data;
  const mesNome = new Date(periodo.ano, periodo.mes - 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  
  // Calcular consumo total por caixa
  let consumoAviarios = 0, consumoRecria = 0;
  const aviariosDaily = consumoDiario.filter(d => d.tank_name === 'aviarios');
  const recriaDaily = consumoDiario.filter(d => d.tank_name === 'recria');
  
  // Calcular consumo baseado na diferença entre leituras 7h consecutivas
  for (let i = 1; i < aviariosDaily.length; i++) {
    if (aviariosDaily[i].leitura_7h && aviariosDaily[i-1].leitura_7h) {
      const diff = aviariosDaily[i].leitura_7h - aviariosDaily[i-1].leitura_7h;
      if (diff > 0) consumoAviarios += diff;
    }
  }
  for (let i = 1; i < recriaDaily.length; i++) {
    if (recriaDaily[i].leitura_7h && recriaDaily[i-1].leitura_7h) {
      const diff = recriaDaily[i].leitura_7h - recriaDaily[i-1].leitura_7h;
      if (diff > 0) consumoRecria += diff;
    }
  }
  
  const totalGeral = consumoAviarios + consumoRecria;
  const diasComDados = Math.max(aviariosDaily.length, recriaDaily.length);
  const mediaAviarios = diasComDados > 1 ? consumoAviarios / (diasComDados - 1) : 0;
  const mediaRecria = diasComDados > 1 ? consumoRecria / (diasComDados - 1) : 0;
  
  // Gerar dados para o gráfico
  const chartLabels = [...new Set(consumoDiario.map(d => {
    const date = new Date(d.reading_date);
    return date.getDate().toString().padStart(2, '0');
  }))];
  
  const aviariosData = chartLabels.map(day => {
    const dayData = aviariosDaily.find(d => new Date(d.reading_date).getDate().toString().padStart(2, '0') === day);
    return dayData?.leitura_7h || 0;
  });
  
  const recriaData = chartLabels.map(day => {
    const dayData = recriaDaily.find(d => new Date(d.reading_date).getDate().toString().padStart(2, '0') === day);
    return dayData?.leitura_7h || 0;
  });
  
  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Relatório de Água - ${mesNome}</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background: linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 100%);
      color: #fff;
      min-height: 100vh;
      padding: 20px;
    }
    .container { max-width: 900px; margin: 0 auto; }
    .header {
      background: linear-gradient(135deg, rgba(212,175,55,0.2), rgba(212,175,55,0.05));
      border: 1px solid rgba(212,175,55,0.3);
      border-radius: 16px;
      padding: 24px;
      margin-bottom: 24px;
      text-align: center;
    }
    .header h1 {
      font-size: 28px;
      color: #d4af37;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
    }
    .header .subtitle {
      color: #888;
      font-size: 14px;
    }
    .header .periodo {
      background: rgba(20,184,166,0.2);
      color: #14b8a6;
      padding: 8px 20px;
      border-radius: 20px;
      display: inline-block;
      margin-top: 12px;
      font-weight: 500;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .stat-card {
      background: rgba(30,30,30,0.8);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 12px;
      padding: 20px;
      text-align: center;
    }
    .stat-card.aviarios { border-left: 4px solid #3b82f6; }
    .stat-card.recria { border-left: 4px solid #10b981; }
    .stat-card.total { border-left: 4px solid #d4af37; }
    .stat-label { color: #888; font-size: 12px; text-transform: uppercase; margin-bottom: 8px; }
    .stat-value { font-size: 32px; font-weight: bold; color: #fff; }
    .stat-unit { font-size: 14px; color: #666; }
    .chart-container {
      background: rgba(30,30,30,0.8);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 24px;
    }
    .chart-title { color: #d4af37; font-size: 18px; margin-bottom: 16px; }
    .table-container {
      background: rgba(30,30,30,0.8);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 12px;
      overflow: hidden;
    }
    .table-title { 
      color: #d4af37; 
      font-size: 18px; 
      padding: 16px 20px;
      border-bottom: 1px solid rgba(255,255,255,0.1);
    }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 12px 16px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.05); }
    th { background: rgba(212,175,55,0.1); color: #d4af37; font-weight: 600; font-size: 12px; text-transform: uppercase; }
    tr:hover { background: rgba(255,255,255,0.02); }
    .footer {
      text-align: center;
      padding: 20px;
      color: #666;
      font-size: 12px;
    }
    .badge { 
      padding: 4px 10px; 
      border-radius: 12px; 
      font-size: 11px;
      font-weight: 500;
    }
    .badge.aviarios { background: rgba(59,130,246,0.2); color: #3b82f6; }
    .badge.recria { background: rgba(16,185,129,0.2); color: #10b981; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>💧 CONTROLE DE ÁGUA</h1>
      <p class="subtitle">Granja Vitta – Sistema Icarus</p>
      <div class="periodo">📅 ${periodo.inicio.split('-').reverse().join('/')} a ${periodo.fim.split('-').reverse().join('/')}</div>
    </div>
    
    <div class="stats-grid">
      <div class="stat-card aviarios">
        <div class="stat-label">Aviários (Média)</div>
        <div class="stat-value">${mediaAviarios.toFixed(2)}</div>
        <div class="stat-unit">m³/dia</div>
      </div>
      <div class="stat-card recria">
        <div class="stat-label">Recria (Média)</div>
        <div class="stat-value">${mediaRecria.toFixed(2)}</div>
        <div class="stat-unit">m³/dia</div>
      </div>
      <div class="stat-card aviarios">
        <div class="stat-label">Total Aviários</div>
        <div class="stat-value">${consumoAviarios.toFixed(2)}</div>
        <div class="stat-unit">m³ período</div>
      </div>
      <div class="stat-card recria">
        <div class="stat-label">Total Recria</div>
        <div class="stat-value">${consumoRecria.toFixed(2)}</div>
        <div class="stat-unit">m³ período</div>
      </div>
    </div>
    
    <div class="stats-grid">
      <div class="stat-card total" style="grid-column: 1 / -1;">
        <div class="stat-label">Consumo Total do Mês</div>
        <div class="stat-value" style="font-size: 48px; color: #14b8a6;">${totalGeral.toFixed(2)}m³</div>
        <div class="stat-unit">${readings.length} leituras registradas</div>
      </div>
    </div>
    
    <div class="chart-container">
      <div class="chart-title">📊 Evolução das Leituras (7h)</div>
      <canvas id="waterChart" height="200"></canvas>
    </div>
    
    <div class="table-container">
      <div class="table-title">📋 Histórico de Leituras</div>
      <table>
        <thead>
          <tr>
            <th>Data</th>
            <th>Horário</th>
            <th>Caixa</th>
            <th>Leitura (m³)</th>
            <th>Temp.</th>
          </tr>
        </thead>
        <tbody>
          ${readings.slice(-30).reverse().map(r => `
            <tr>
              <td>${new Date(r.reading_date).toLocaleDateString('pt-BR')}</td>
              <td>${r.reading_time}</td>
              <td><span class="badge ${r.tank_name}">${r.tank_name}</span></td>
              <td><strong>${parseFloat(r.reading_value).toFixed(2)}</strong></td>
              <td>${r.temperature ? r.temperature + '°C' : '-'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    
    <div class="footer">
      Gerado automaticamente pelo Sistema Icarus • ${new Date().toLocaleString('pt-BR')}
    </div>
  </div>
  
  <script>
    const ctx = document.getElementById('waterChart').getContext('2d');
    new Chart(ctx, {
      type: 'line',
      data: {
        labels: ${JSON.stringify(chartLabels)},
        datasets: [
          {
            label: 'Aviários',
            data: ${JSON.stringify(aviariosData)},
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            tension: 0.3,
            fill: true
          },
          {
            label: 'Recria',
            data: ${JSON.stringify(recriaData)},
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            tension: 0.3,
            fill: true
          }
        ]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { labels: { color: '#888' } }
        },
        scales: {
          x: { ticks: { color: '#888' }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: { ticks: { color: '#888' }, grid: { color: 'rgba(255,255,255,0.05)' } }
        }
      }
    });
  </script>
</body>
</html>`;

  return html;
}

module.exports = {
  classifyIntent,
  extractEntities,
  executeQuery,
  formatResponse,
  processMessage,
  processWithAI,
  processAgentCommand,
  executeAgentAction,
  createNota,
  isAgentCommand,
  isAgentSessionActive,
  activateAgentSession,
  deactivateAgentSession,
  generateWaterReportHtml,
  INTENTS,
  AGENT_SYSTEM_PROMPT
};
