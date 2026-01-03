// Script para testar API via túnel Cloudflare
const https = require('https');

const TUNNEL_URL = 'miami-using-capability-accounts.trycloudflare.com';
const KEY = 'GRANJA-VITTA-5590PALU-ICARUS';
const KEY_ID = '76453ce2-9e83-4764-bf13-e11125f6b880';

console.log('=== TESTANDO VIA TÚNEL CLOUDFLARE ===');
console.log('URL:', TUNNEL_URL);

// Testar health
const healthReq = https.request({
  hostname: TUNNEL_URL,
  port: 443,
  path: '/health',
  method: 'GET'
}, (res) => {
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => {
    console.log('\n1. Health:', body);
    
    // Testar validate-key
    const validateData = JSON.stringify({ key: KEY });
    const validateReq = https.request({
      hostname: TUNNEL_URL,
      port: 443,
      path: '/auth/validate-key',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(validateData)
      }
    }, (res2) => {
      let body2 = '';
      res2.on('data', (chunk) => body2 += chunk);
      res2.on('end', () => {
        console.log('\n2. Validate-key:', body2);
        
        // Testar login
        const loginData = JSON.stringify({
          username: 'manutencao',
          password: 'egg2000',
          key_id: KEY_ID
        });
        const loginReq = https.request({
          hostname: TUNNEL_URL,
          port: 443,
          path: '/auth/login',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(loginData)
          }
        }, (res3) => {
          let body3 = '';
          res3.on('data', (chunk) => body3 += chunk);
          res3.on('end', () => {
            console.log('\n3. Login:', body3.substring(0, 200));
            console.log('\n=== TESTES CONCLUÍDOS ===');
          });
        });
        loginReq.write(loginData);
        loginReq.end();
      });
    });
    validateReq.write(validateData);
    validateReq.end();
  });
});
healthReq.end();
