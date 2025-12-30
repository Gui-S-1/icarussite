const http = require("http");

// Dados da planilha - leituras das 7h e 16h
const readings = [
  // 22/12
  { date: "2025-12-22", time: "07:00", tank: "recria", value: 5706 },
  { date: "2025-12-22", time: "16:00", tank: "recria", value: 5738 },
  { date: "2025-12-22", time: "07:00", tank: "aviarios", value: 3199 },
  { date: "2025-12-22", time: "16:00", tank: "aviarios", value: 3202 },
  // 23/12
  { date: "2025-12-23", time: "07:00", tank: "recria", value: 5752 },
  { date: "2025-12-23", time: "16:00", tank: "recria", value: 5781 },
  { date: "2025-12-23", time: "07:00", tank: "aviarios", value: 3209 },
  { date: "2025-12-23", time: "16:00", tank: "aviarios", value: 3209 },
  // 24/12
  { date: "2025-12-24", time: "07:00", tank: "recria", value: 5798 },
  { date: "2025-12-24", time: "16:00", tank: "recria", value: 5812 },
  { date: "2025-12-24", time: "07:00", tank: "aviarios", value: 3208 },
  { date: "2025-12-24", time: "16:00", tank: "aviarios", value: 3214 },
  // 25/12
  { date: "2025-12-25", time: "07:00", tank: "recria", value: 5811 },
  { date: "2025-12-25", time: "16:00", tank: "recria", value: 5832 },
  { date: "2025-12-25", time: "07:00", tank: "aviarios", value: 3209 },
  { date: "2025-12-25", time: "16:00", tank: "aviarios", value: 3210 },
  // 26/12
  { date: "2025-12-26", time: "07:00", tank: "recria", value: 5868 },
  { date: "2025-12-26", time: "16:00", tank: "recria", value: 5898 },
  { date: "2025-12-26", time: "07:00", tank: "aviarios", value: 3214 },
  { date: "2025-12-26", time: "16:00", tank: "aviarios", value: 3229 },
  // 27/12
  { date: "2025-12-27", time: "07:00", tank: "recria", value: 5898 },
  { date: "2025-12-27", time: "16:00", tank: "recria", value: 5919 },
  { date: "2025-12-27", time: "07:00", tank: "aviarios", value: 3297 },
  { date: "2025-12-27", time: "16:00", tank: "aviarios", value: 3326 },
  // 28/12
  { date: "2025-12-28", time: "07:00", tank: "recria", value: 5918 },
  { date: "2025-12-28", time: "16:00", tank: "recria", value: 5921 },
  { date: "2025-12-28", time: "07:00", tank: "aviarios", value: 3387 },
  { date: "2025-12-28", time: "16:00", tank: "aviarios", value: 3410 },
  // 29/12
  { date: "2025-12-29", time: "07:00", tank: "recria", value: 5927 },
  { date: "2025-12-29", time: "16:00", tank: "recria", value: 5943 },
  { date: "2025-12-29", time: "07:00", tank: "aviarios", value: 3454 },
  { date: "2025-12-29", time: "16:00", tank: "aviarios", value: 3473 },
  // 30/12
  { date: "2025-12-30", time: "07:00", tank: "recria", value: 5944 },
  { date: "2025-12-30", time: "07:00", tank: "aviarios", value: 3512 }
];

const API_HOST = "159.203.8.237";
const API_PORT = 4000;

// Primeiro validar a key para obter key_id
const validateData = JSON.stringify({ 
  key: "GRANJA-VITTA-5590PALU-ICARUS" 
});

const validateReq = http.request({
  hostname: API_HOST,
  port: API_PORT,
  path: "/auth/validate-key",
  method: "POST",
  headers: { "Content-Type": "application/json" }
}, (res) => {
  let data = "";
  res.on("data", chunk => data += chunk);
  res.on("end", () => {
    try {
      const result = JSON.parse(data);
      if (result.ok && result.key_id) {
        console.log("Key validada, fazendo login...");
        doLogin(result.key_id);
      } else {
        console.log("Erro validar key:", data);
      }
    } catch(e) { 
      console.log("Erro:", e, data); 
    }
  });
});
validateReq.write(validateData);
validateReq.end();

function doLogin(keyId) {
  const loginData = JSON.stringify({ 
    username: "manutencao", 
    password: "123456", 
    key_id: keyId 
  });

  const loginReq = http.request({
    hostname: API_HOST,
    port: API_PORT,
    path: "/auth/login",
    method: "POST",
    headers: { "Content-Type": "application/json" }
  }, (res) => {
    let data = "";
    res.on("data", chunk => data += chunk);
    res.on("end", async () => {
      try {
        const result = JSON.parse(data);
        if (result.token) {
          console.log("Login OK, inserindo dados...");
          insertReadings(result.token);
        } else {
          console.log("Erro login:", data);
        }
      } catch(e) { 
        console.log("Erro:", e, data); 
      }
    });
  });
  loginReq.write(loginData);
  loginReq.end();
}

function insertReadings(token) {
  let completed = 0;
  readings.forEach((r, i) => {
    setTimeout(() => {
      const body = JSON.stringify({
        tank_name: r.tank,
        reading_value: r.value,
        reading_time: r.time,
        reading_date: r.date,
        notes: "Importado da planilha"
      });
      
      const req = http.request({
        hostname: API_HOST,
        port: API_PORT,
        path: "/water-readings",
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": "Bearer " + token
        }
      }, (res) => {
        let respData = "";
        res.on("data", chunk => respData += chunk);
        res.on("end", () => {
          completed++;
          console.log(`[${completed}/${readings.length}] ${r.date} ${r.time} ${r.tank} => ${res.statusCode}`);
          if (completed === readings.length) {
            console.log("\n✓ Todos os dados foram importados!");
          }
        });
      });
      req.on("error", (e) => console.log("Erro:", e.message));
      req.write(body);
      req.end();
    }, i * 200);
  });
}
