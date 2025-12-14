# 🔗 Como Configurar o Webhook no Uazapi

## ✅ Sua URL do Ngrok

**URL do Webhook:** `https://cd3ff2b42807.ngrok-free.app/webhook`

## 📋 Método 1: Via Painel Web do Uazapi (Recomendado)

1. Acesse o painel do Uazapi: https://free.uazapi.com
2. Faça login com suas credenciais
3. Localize sua instância (token: `44604f7f-946e-4f9a-af0c-39e3aeb27573`)
4. Vá em **Configurações** ou **Webhooks**
5. Cole a URL do webhook: `https://cd3ff2b42807.ngrok-free.app/webhook`
6. Salve as configurações

## 📋 Método 2: Via API (Pode não funcionar em todas as versões)

Se o método via API não funcionar, use o painel web acima.

### Opção A: Via Script
```bash
node setup-webhook.js https://cd3ff2b42807.ngrok-free.app
```

### Opção B: Via Endpoint HTTP
Acesse no navegador ou use curl:
```bash
curl -X POST "http://localhost:3000/setup-webhook?url=https://cd3ff2b42807.ngrok-free.app"
```

Ou acesse diretamente no navegador:
```
http://localhost:3000/setup-webhook?url=https://cd3ff2b42807.ngrok-free.app/webhook
```

## 🧪 Testar o Webhook

1. **Verifique se o bot está rodando:**
   ```bash
   npm start
   ```

2. **Verifique se o ngrok está rodando:**
   - O ngrok precisa estar ativo apontando para a porta 3000
   - URL: `https://cd3ff2b42807.ngrok-free.app`

3. **Teste enviando uma mensagem:**
   - Conecte a instância no WhatsApp (escanear QR Code)
   - Envie "menu" ou "oi" para o número conectado
   - O bot deve responder automaticamente

## ⚠️ Importante

- ⚠️ O webhook **DEVE** terminar com `/webhook`
- ⚠️ O ngrok precisa estar rodando enquanto você testar
- ⚠️ Certifique-se de que a instância está `connected` no painel
- ⚠️ Se o método via API não funcionar, configure manualmente no painel web

## 🔍 Troubleshooting

### Webhook não está recebendo mensagens:
1. Verifique se o URL está correto: `https://cd3ff2b42807.ngrok-free.app/webhook`
2. Verifique se o ngrok está rodando
3. Verifique se o bot está rodando (`npm start`)
4. Verifique os logs do bot para ver se há erros
5. Teste acessando: `https://cd3ff2b42807.ngrok-free.app` (deve retornar status online)

### Erro 405 (Method Not Allowed):
- Isso significa que a API não aceita esse método
- Use o painel web do Uazapi para configurar o webhook manualmente

### Bot não responde:
- Verifique se a instância está `connected`
- Verifique os logs do servidor para erros
- Teste enviando mensagem diretamente e veja se aparece nos logs



