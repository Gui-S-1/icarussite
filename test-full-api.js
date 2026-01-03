// Script para testar toda a API
const http = require('http');
const https = require('https');

const KEY = 'GRANJA-VITTA-5590PALU-ICARUS';
const KEY_ID = '76453ce2-9e83-4764-bf13-e11125f6b880';

// Testar validate-key
console.log('=== TESTANDO VALIDATE-KEY ===');
const validateData = JSON.stringify({ key: KEY });

const validateReq = http.request({
  hostname: 'localhost',
  port: 4000,
  path: '/auth/validate-key',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': validateData.length
  }
}, (res) => {
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => {
    console.log('Validate-key response:', body);
    
    // Testar login
    console.log('\n=== TESTANDO LOGIN ===');
    const loginData = JSON.stringify({
      username: 'manutencao',
      password: 'egg2000',
      key_id: KEY_ID
    });
    
    const loginReq = http.request({
      hostname: 'localhost',
      port: 4000,
      path: '/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': loginData.length
      }
    }, (res2) => {
      let body2 = '';
      res2.on('data', (chunk) => body2 += chunk);
      res2.on('end', () => {
        console.log('Login response:', body2.substring(0, 300));
        
        try {
          const data = JSON.parse(body2);
          if (data.ok && data.token) {
            console.log('\n=== TESTANDO WATER-READINGS ===');
            
            const waterReq = http.request({
              hostname: 'localhost',
              port: 4000,
              path: '/water-readings',
              method: 'GET',
              headers: {
                'Authorization': 'Bearer ' + data.token
              }
            }, (res3) => {
              let body3 = '';
              res3.on('data', (chunk) => body3 += chunk);
              res3.on('end', () => {
                console.log('Water readings:', body3.substring(0, 500));
              });
            });
            waterReq.end();
          }
        } catch (e) {
          console.log('Erro:', e.message);
        }
      });
    });
    loginReq.write(loginData);
    loginReq.end();
  });
});

validateReq.write(validateData);
validateReq.end();
