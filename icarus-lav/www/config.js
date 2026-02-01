// Configuracao do Icarus - Frontend
// Versao 1.4.0 - Segurança melhorada

// URL do tunel Cloudflare (atualizar quando mudar)
const API_URL_DEFAULT = 'https://benz-tunes-gardens-spokesman.trycloudflare.com';

// Usar sempre a URL padrao do tunel
window.ICARUS_API_URL = API_URL_DEFAULT;

// NOTA: Credenciais são definidas após login pelo servidor
// Não armazenar chaves diretamente no código fonte
window.ICARUS_KEY_ID = null;
window.ICARUS_KEY = null;
