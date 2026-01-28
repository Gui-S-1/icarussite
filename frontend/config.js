// Configuração do Icarus - Frontend
// Versão 1.2.0 - Sem dependência do GitHub

// IP direto do servidor (fallback)
const SERVER_IP = 'http://159.203.8.237:3000';

// URL padrão do túnel Cloudflare
let API_URL_DEFAULT = 'https://finances-absolute-caps-receipt.trycloudflare.com';

// Limpar cache de URLs antigas que não funcionam mais
const OLD_URLS_TO_CLEAR = [
  'troops-minute-missed-alot.trycloudflare.com',
  'kong-dust-analysts-developers.trycloudflare.com'
];

(function clearOldUrlCache() {
  const cached = localStorage.getItem('icarus_api_url');
  if (cached) {
    for (const oldUrl of OLD_URLS_TO_CLEAR) {
      if (cached.includes(oldUrl)) {
        console.log('[Config] Limpando URL antiga do cache:', cached);
        localStorage.removeItem('icarus_api_url');
        localStorage.removeItem('icarus_api_url_time');
        break;
      }
    }
  }
})();

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
    
    // Testar em background
    setTimeout(async () => {
      const works = await testApiUrl(cached);
      if (!works) {
        console.log('[Config] URL do cache não responde, usando padrão...');
        window.ICARUS_API_URL = API_URL_DEFAULT;
        localStorage.setItem('icarus_api_url', API_URL_DEFAULT);
      }
    }, 1000);
    return;
  }
  
  // 3. Sem cache - usar URL padrão
  window.ICARUS_API_URL = API_URL_DEFAULT;
  localStorage.setItem('icarus_api_url', API_URL_DEFAULT);
})();

// URL da API backend (HTTPS via Cloudflare Tunnel)
window.ICARUS_API_URL = window.ICARUS_API_URL || localStorage.getItem('icarus_api_url') || API_URL_DEFAULT;

// Key ID da Granja Vitta
window.ICARUS_KEY_ID = '76453ce2-9e83-4764-bf13-e11125f6b880';

// Chave de acesso
window.ICARUS_KEY = 'GRANJA-VITTA-5590PALU-ICARUS';
