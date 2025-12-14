# 🔧 Configuração do Bot Uazapi

## ✅ Credenciais Configuradas

Suas credenciais já estão configuradas no arquivo `.env`:

- **Server URL**: `https://free.uazapi.com`
- **Token**: `44604f7f-946e-4f9a-af0c-39e3aeb27573`
- **Status**: disconnected (precisa conectar)

## 📋 Passos para Configuração Completa

### 1. Conectar a Instância ao WhatsApp

1. Acesse o painel do Uazapi em: https://free.uazapi.com
2. Localize sua instância com o token `44604f7f-946e-4f9a-af0c-39e3aeb27573`
3. Clique em "Conectar" ou "QR Code"
4. Escaneie o QR Code com seu WhatsApp:
   - Abra o WhatsApp no celular
   - Vá em **Configurações** > **Aparelhos Conectados** > **Conectar um Aparelho**
   - Escaneie o QR Code exibido
5. Aguarde o status mudar para `connected`

### 2. Expor seu Bot Publicamente (para Webhook)

Para o Uazapi enviar mensagens para seu bot, ele precisa estar acessível publicamente.

#### Opção A: Usando ngrok (Desenvolvimento Local)

1. **Instale o ngrok:**
   - Baixe em: https://ngrok.com/download
   - Ou via npm: `npm install -g ngrok`

2. **Inicie o bot:**
   ```bash
   npm start
   ```

3. **Em outro terminal, inicie o ngrok:**
   ```bash
   ngrok http 3000
   ```

4. **Copie a URL gerada:**
   - Será algo como: `https://abc123.ngrok.io`
   - Sua URL do webhook será: `https://abc123.ngrok.io/webhook`

#### Opção B: Hospedar em Servidor (Produção)

- Use serviços como Railway, Heroku, Render, ou VPS
- Configure a variável de ambiente `PORT` conforme o serviço
- Use a URL pública do seu servidor

### 3. Configurar Webhook no Uazapi

1. No painel do Uazapi, vá em **Webhooks** ou **Configurações**
2. Cole a URL do webhook (ex: `https://seu-dominio.com/webhook` ou `https://abc123.ngrok.io/webhook`)
3. Salve as configurações

### 4. Testar o Bot

1. **Verifique se o bot está rodando:**
   ```bash
   npm start
   ```

2. **Envie uma mensagem de teste para o número conectado:**
   - Envie "menu" ou "oi" para o WhatsApp conectado
   - O bot deve responder com o menu principal

3. **Teste os comandos:**
   - `1` - Verificar status
   - `2` - Consultar fatura
   - `3` - Abrir chamado
   - `4` - FAQ

## 🔍 Troubleshooting

### Bot não recebe mensagens:
- ✅ Verifique se a instância está `connected`
- ✅ Verifique se o webhook está configurado corretamente
- ✅ Verifique se o servidor está rodando (`npm start`)
- ✅ Verifique os logs do servidor para erros

### Erro ao enviar mensagens:
- ✅ Verifique se o número está no formato correto: `5511999999999` (com código do país)
- ✅ Verifique se o token está correto no `.env`
- ✅ Verifique os logs para ver a mensagem de erro completa

### Verificar Status da Instância:
```bash
# Acesse no navegador:
http://localhost:3000/status
```

## 📝 Endpoints Disponíveis

- `GET /` - Health check
- `GET /status` - Status da instância Uazapi
- `POST /webhook` - Recebe mensagens do WhatsApp
- `POST /send-test` - Envia mensagem de teste

### Exemplo de envio de teste:
```bash
curl -X POST http://localhost:3000/send-test \
  -H "Content-Type: application/json" \
  -d '{"number": "5511999999999", "message": "Teste do bot"}'
```

## 🎯 Próximos Passos

Depois que tudo estiver funcionando:

1. **Personalize os handlers** em `src/handlers.js`:
   - Integre com seu sistema de faturamento
   - Integre com seu sistema de monitoramento
   - Adicione mais comandos personalizados

2. **Configure persistência** (opcional):
   - Adicione banco de dados para salvar conversas
   - Implemente sistema de autenticação de clientes

3. **Melhore as respostas**:
   - Personalize as mensagens para seu provedor
   - Adicione imagens e documentos quando necessário



