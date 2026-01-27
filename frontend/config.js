// Configuração do Icarus - Frontend

// URLs de configuração
const CONFIG_URL = 'https://raw.githubusercontent.com/Gui-S-1/icarussite/main/api-config.json';
const SERVER_IP = 'http://159.203.8.237:3000'; // IP direto do servidor

// URL padrão (fallback) - sempre via tunnel seguro
let API_URL_DEFAULT = 'https://troops-minute-missed-alot.trycloudflare.com';

// Buscar URL do túnel diretamente do servidor via IP
async function fetchTunnelUrlFromServer() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(SERVER_IP + '/tunnel-url', { 
      signal: controller.signal,
      cache: 'no-store'
    });
    clearTimeout(timeout);
    if (response.ok) {
      const data = await response.json();
      if (data.ok && data.url) {
        console.log('[Config] URL obtida do servidor:', data.url);
        return data.url;
      }
    }
  } catch (e) {
    console.log('[Config] Erro ao buscar URL do servidor via IP');
  }
  return null;
}

// Buscar URL do GitHub (fallback)
async function fetchNewApiUrl() {
  try {
    const response = await fetch(CONFIG_URL + '?t=' + Date.now(), { cache: 'no-store' });
    if (response.ok) {
      const config = await response.json();
      if (config.apiUrl) {
        console.log('[Config] URL obtida do GitHub:', config.apiUrl);
        return config.apiUrl;
      }
    }
  } catch (e) {
    console.log('[Config] Erro ao buscar config do GitHub');
  }
  return null;
}

async function testApiUrl(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(url + '/health', { 
      signal: controller.signal,
      cache: 'no-store'
    });
    clearTimeout(timeout);
    return response.ok;
  } catch (e) {
    return false;
  }
}

// Carregar e validar URL
(async function loadDynamicConfig() {
  // 1. Primeiro tenta buscar a URL diretamente do servidor
  const serverUrl = await fetchTunnelUrlFromServer();
  if (serverUrl) {
    window.ICARUS_API_URL = serverUrl;
    localStorage.setItem('icarus_api_url', serverUrl);
    localStorage.setItem('icarus_api_url_time', Date.now().toString());
    console.log('[Config] URL do servidor aplicada:', serverUrl);
    return;
  }
  
  // 2. Se falhar, tenta URL do cache
  const cached = localStorage.getItem('icarus_api_url');
  if (cached) {
    window.ICARUS_API_URL = cached;
    console.log('[Config] Usando URL do cache:', cached);
    
    // Testar em background - se falhar, busca nova do GitHub
    setTimeout(async () => {
      const works = await testApiUrl(cached);
      if (!works) {
        console.log('[Config] URL do cache não responde, buscando nova...');
        const newUrl = await fetchNewApiUrl();
        if (newUrl && newUrl !== cached) {
          window.ICARUS_API_URL = newUrl;
          localStorage.setItem('icarus_api_url', newUrl);
          localStorage.setItem('icarus_api_url_time', Date.now().toString());
          console.log('[Config] Nova URL aplicada:', newUrl);
          if (document.readyState === 'complete') {
            location.reload();
          }
        }
      }
    }, 1000);
    return;
  }
  
  // 3. Sem cache - buscar URL do GitHub
  const newUrl = await fetchNewApiUrl();
  if (newUrl) {
    window.ICARUS_API_URL = newUrl;
    localStorage.setItem('icarus_api_url', newUrl);
    localStorage.setItem('icarus_api_url_time', Date.now().toString());
  }
})();

// URL da API backend (HTTPS via Cloudflare Tunnel)
window.ICARUS_API_URL = window.ICARUS_API_URL || localStorage.getItem('icarus_api_url') || API_URL_DEFAULT;

// Key ID da Granja Vitta (UUID fixo gerado no backend)
window.ICARUS_KEY_ID = '76453ce2-9e83-4764-bf13-e11125f6b880';

// Chave de acesso (para validação inicial)
window.ICARUS_KEY = 'GRANJA-VITTA-5590PALU-ICARUS';
