# Comandos para executar no Droplet

## 1. Conectar ao droplet via SSH
```bash
ssh root@159.203.8.237
```

## 2. Baixar e executar o script de instalação
```bash
curl -o install.sh https://raw.githubusercontent.com/Gui-S-1/icarussite/master/install-droplet.sh
DB_PASSWORD=sua_senha_do_postgres bash install.sh
```

> **Nota**: Substitua `sua_senha_do_postgres` pela senha real do PostgreSQL

## 3. Verificar se está funcionando
```bash
# Ver logs
pm2 logs icarus-backend

# Testar API
curl http://localhost:4000/health
```

## 4. IMPORTANTE: Adicionar IP do Droplet no PostgreSQL

Você precisa adicionar o IP do droplet (159.203.8.237) na lista de **Trusted Sources** do PostgreSQL:

1. Entre em https://cloud.digitalocean.com/databases
2. Clique no banco de dados **icarus-empress**
3. Vá em **Settings** → **Trusted Sources**
4. Clique em **Add trusted source**
5. Adicione o IP: `159.203.8.237`

## 5. Após adicionar o IP, reinicie o backend
```bash
pm2 restart icarus-backend
```

## 6. Testar login
```bash
curl -X POST http://localhost:4000/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"123456","tenant_key":"granja-vitta-key"}'
```

Se retornar um token, está funcionando! 🎉

## Comandos úteis PM2

```bash
pm2 status                 # Ver status de todos os processos
pm2 logs icarus-backend    # Ver logs em tempo real
pm2 restart icarus-backend # Reiniciar o backend
pm2 stop icarus-backend    # Parar o backend
pm2 start icarus-backend   # Iniciar o backend
```

## Usuários criados

- **admin** / 123456 - Todas as permissões
- **eduardo** / 123456 - Gerente OS + Preventivas + Almoxarifado
- **declie** / 123456 - Gerente OS + Preventivas + Almoxarifado
- **alisson** / 123456 - Gerente OS + Preventivas + Almoxarifado
- **vanderlei** / 123456 - Gerente OS + Preventivas + Almoxarifado
- **edmilson** / 123456 - Criar/editar apenas suas OS
- **erica** / 123456 - OS + Checklist Ovos
- **irene** / 123456 - OS + Checklist Ovos
- **bruno** / 123456 - OS + Visualizar todas OS
- **josewalter** / 123456 - OS + Visualizar todas + Checklist Granja
- **joacir** / 123456 - OS + Compras
