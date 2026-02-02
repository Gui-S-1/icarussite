/**
 * ICARUS - Módulo WhatsApp via Z-API
 * Integração com Z-API para receber/enviar mensagens
 */

const { v4: uuid } = require('uuid');

// Configurações Z-API
const ZAPI_INSTANCE_ID = process.env.ZAPI_INSTANCE_ID || '3EE16E79D38C6242CCE29E6F45A4D3D8';
const ZAPI_TOKEN = process.env.ZAPI_TOKEN || 'F36EE07771CFC4E8C9E0BBFA';
const ZAPI_CLIENT_TOKEN = process.env.ZAPI_CLIENT_TOKEN || 'F4dee952c8dac46de880556b46b024f68S';
const ZAPI_BASE_URL = `https://api.z-api.io/instances/${ZAPI_INSTANCE_ID}/token/${ZAPI_TOKEN}`;

/**
 * Envia mensagem de texto via WhatsApp
 * @param {string} phone - Número do destinatário (ex: 5511999999999)
 * @param {string} message - Texto da mensagem
 * @returns {Promise<object>} Resposta da API
 */
async function sendText(phone, message) {
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (ZAPI_CLIENT_TOKEN) {
      headers['Client-Token'] = ZAPI_CLIENT_TOKEN;
    }
    
    const response = await fetch(`${ZAPI_BASE_URL}/send-text`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        phone: phone.replace(/\D/g, ''),
        message: message
      })
    });
    
    const data = await response.json();
    console.log(`[WhatsApp] Mensagem enviada para ${phone}:`, data);
    return { ok: true, data };
  } catch (error) {
    console.error('[WhatsApp] Erro ao enviar mensagem:', error);
    return { ok: false, error: error.message };
  }
}

/**
 * Envia imagem via WhatsApp
 * @param {string} phone - Número do destinatário
 * @param {string} imageUrl - URL da imagem ou base64
 * @param {string} caption - Legenda opcional
 * @returns {Promise<object>} Resposta da API
 */
async function sendImage(phone, imageUrl, caption = '') {
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (ZAPI_CLIENT_TOKEN) {
      headers['Client-Token'] = ZAPI_CLIENT_TOKEN;
    }
    
    const response = await fetch(`${ZAPI_BASE_URL}/send-image`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        phone: phone.replace(/\D/g, ''),
        image: imageUrl,
        caption: caption
      })
    });
    
    const data = await response.json();
    console.log(`[WhatsApp] Imagem enviada para ${phone}:`, data);
    return { ok: true, data };
  } catch (error) {
    console.error('[WhatsApp] Erro ao enviar imagem:', error);
    return { ok: false, error: error.message };
  }
}

/**
 * Envia documento/arquivo via WhatsApp
 * @param {string} phone - Número do destinatário
 * @param {string} documentUrl - URL do documento ou base64
 * @param {string} filename - Nome do arquivo
 * @returns {Promise<object>} Resposta da API
 */
async function sendDocument(phone, documentUrl, filename) {
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (ZAPI_CLIENT_TOKEN) {
      headers['Client-Token'] = ZAPI_CLIENT_TOKEN;
    }
    
    const response = await fetch(`${ZAPI_BASE_URL}/send-document/pdf`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        phone: phone.replace(/\D/g, ''),
        document: documentUrl,
        fileName: filename
      })
    });
    
    const data = await response.json();
    console.log(`[WhatsApp] Documento enviado para ${phone}:`, data);
    return { ok: true, data };
  } catch (error) {
    console.error('[WhatsApp] Erro ao enviar documento:', error);
    return { ok: false, error: error.message };
  }
}

/**
 * Envia documento HTML como base64 via WhatsApp
 * @param {string} phone - Número do destinatário
 * @param {string} htmlContent - Conteúdo HTML
 * @param {string} filename - Nome do arquivo (sem extensão)
 * @returns {Promise<object>} Resposta da API
 */
async function sendHtmlDocument(phone, htmlContent, filename) {
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (ZAPI_CLIENT_TOKEN) {
      headers['Client-Token'] = ZAPI_CLIENT_TOKEN;
    }
    
    // Converter HTML para base64
    const base64Content = Buffer.from(htmlContent, 'utf8').toString('base64');
    const base64WithMime = `data:text/html;base64,${base64Content}`;
    
    const response = await fetch(`${ZAPI_BASE_URL}/send-document`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        phone: phone.replace(/\D/g, ''),
        document: base64WithMime,
        fileName: `${filename}.html`
      })
    });
    
    const data = await response.json();
    console.log(`[WhatsApp] Documento HTML enviado para ${phone}:`, data);
    return { ok: true, data };
  } catch (error) {
    console.error('[WhatsApp] Erro ao enviar documento HTML:', error);
    return { ok: false, error: error.message };
  }
}

/**
 * Processa webhook recebido da Z-API
 * @param {object} payload - Payload do webhook
 * @returns {object} Dados normalizados da mensagem
 */
function parseWebhookPayload(payload) {
  // Z-API envia diferentes formatos dependendo do tipo de mensagem
  const isMessage = payload.isStatusReply === false || payload.fromMe === false;
  
  if (!isMessage) {
    return null; // Ignorar confirmações de status
  }
  
  const result = {
    id: payload.messageId || uuid(),
    phone: (payload.phone || payload.from || '').replace(/\D/g, ''),
    name: payload.senderName || payload.pushName || 'Usuário',
    text: null,
    hasMedia: false,
    mediaType: null,
    mediaUrl: null,
    timestamp: payload.momment || Date.now()
  };
  
  // Mensagem de texto
  if (payload.text && payload.text.message) {
    result.text = payload.text.message;
  } else if (payload.body) {
    result.text = payload.body;
  } else if (typeof payload.message === 'string') {
    result.text = payload.message;
  }
  
  // Mensagem com mídia (imagem, documento)
  if (payload.image) {
    result.hasMedia = true;
    result.mediaType = 'image';
    result.mediaUrl = payload.image.imageUrl || payload.image.url;
    result.text = payload.image.caption || result.text;
  }
  
  if (payload.document) {
    result.hasMedia = true;
    result.mediaType = 'document';
    result.mediaUrl = payload.document.documentUrl || payload.document.url;
    result.mediaFilename = payload.document.fileName;
    result.text = payload.document.caption || result.text;
  }
  
  return result;
}

/**
 * Baixa mídia do WhatsApp
 * @param {string} mediaUrl - URL da mídia
 * @returns {Promise<Buffer>} Buffer do arquivo
 */
async function downloadMedia(mediaUrl) {
  try {
    const response = await fetch(mediaUrl);
    if (!response.ok) throw new Error('Falha ao baixar mídia');
    const buffer = await response.arrayBuffer();
    return Buffer.from(buffer);
  } catch (error) {
    console.error('[WhatsApp] Erro ao baixar mídia:', error);
    return null;
  }
}

module.exports = {
  sendText,
  sendImage,
  sendDocument,
  sendHtmlDocument,
  parseWebhookPayload,
  downloadMedia,
  ZAPI_INSTANCE_ID,
  ZAPI_TOKEN
};
