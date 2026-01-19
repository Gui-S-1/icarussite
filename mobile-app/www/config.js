// Configuração do Icarus - Frontend

// URL fixa do GitHub para buscar configuração dinâmica
const CONFIG_URL = 'https://raw.githubusercontent.com/Gui-S-1/icarussite/main/api-config.json';

// URL padrão (fallback)
let API_URL_DEFAULT = 'https://booth-upon-ministers-specializing.trycloudflare.com';

// Tentar carregar URL do backend do GitHub (não bloqueia o app)
(async function loadDynamicConfig() {
  try {
    const cached = localStorage.getItem('icarus_api_url');
    const cachedTime = localStorage.getItem('icarus_api_url_time');
    
    // Usar cache se foi atualizado nas últimas 5 minutos
    if (cached && cachedTime && (Date.now() - parseInt(cachedTime)) < 5 * 60 * 1000) {
      window.ICARUS_API_URL = cached;
      console.log('[Config] Usando URL do cache:', cached);
      return;
    }
    
    const response = await fetch(CONFIG_URL + '?t=' + Date.now(), { cache: 'no-store' });
    if (response.ok) {
      const config = await response.json();
      if (config.apiUrl) {
        window.ICARUS_API_URL = config.apiUrl;
        localStorage.setItem('icarus_api_url', config.apiUrl);
        localStorage.setItem('icarus_api_url_time', Date.now().toString());
        console.log('[Config] URL atualizada do GitHub:', config.apiUrl);
      }
    }
  } catch (e) {
    console.log('[Config] Erro ao buscar config, usando padrão');
  }
})();

// URL da API backend (HTTPS via Cloudflare Tunnel)
window.ICARUS_API_URL = window.ICARUS_API_URL || localStorage.getItem('icarus_api_url') || API_URL_DEFAULT;

// Key ID da Granja Vitta (UUID fixo gerado no backend)
window.ICARUS_KEY_ID = '76453ce2-9e83-4764-bf13-e11125f6b880';

// Chave de acesso (para validação inicial)
window.ICARUS_KEY = 'GRANJA-VITTA-5590PALU-ICARUS';
