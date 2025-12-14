# Bot WhatsApp para Provedor de Internet - Uazapi

Bot automatizado para atendimento de clientes de provedor de internet via WhatsApp utilizando a API Uazapi.

## 📋 Funcionalidades

- ✅ Verificação de status da conexão
- 💳 Consulta de faturas/boletos
- 🎫 Abertura de chamados técnicos
- ❓ FAQ com perguntas frequentes
- 🤖 Menu interativo

## 🚀 Instalação

1. **Clone ou baixe este repositório**

2. **Instale as dependências:**
```bash
npm install
```

3. **Configure as variáveis de ambiente:**

Crie um arquivo `.env` na raiz do projeto com o seguinte conteúdo:

```env
# Configurações do Uazapi
UAZAPI_SERVER=https://seu-servidor-uazapi.com
UAZAPI_TOKEN=seu-token-de-autenticacao
UAZAPI_INSTANCE=nome-da-sua-instancia

# Configurações do Bot
PORT=3000
LOG_LEVEL=info

# URL do webhook (use ngrok ou similar para desenvolvimento)
WEBHOOK_URL=https://seu-dominio.com/webhook
```

## ⚙️ Configuração do Uazapi

1. **Crie uma instância no seu servidor Uazapi:**
   - Acesse o painel administrativo do Uazapi
   - Crie uma nova instância do WhatsApp
   - Anote o token de autenticação e nome da instância

2. **Configure o webhook:**
   - No painel do Uazapi, configure o webhook para apontar para: `http://seu-servidor:3000/webhook`
   - Para desenvolvimento local, use [ngrok](https://ngrok.com/) para expor sua porta

### Usando ngrok (desenvolvimento local):

```bash
# Instale o ngrok
# Depois execute:
ngrok http 3000

# Use a URL gerada (ex: https://abc123.ngrok.io/webhook) no painel do Uazapi
```

## 🎯 Uso

### Iniciar o bot (produção):

```bash
npm start
```

### Modo desenvolvimento (reinicia automaticamente ao salvar):

```bash
npm run dev
```

Ou:

```bash
npm run watch
```

**⚠️ Use `npm run dev` durante o desenvolvimento** - o bot reinicia automaticamente quando você salvar alterações nos arquivos, sem precisar reiniciar manualmente!

## 📱 Comandos do Bot

Quando um cliente enviar mensagem no WhatsApp, o bot responderá com um menu interativo:

- **1** ou **status** - Verificar status da conexão
- **2** ou **fatura** - Consultar fatura/boleto  
- **3** ou **chamado** - Abrir chamado/suporte
- **4** ou **faq** - Ver perguntas frequentes
- **menu** ou **inicio** - Voltar ao menu principal

## 🔧 Estrutura do Projeto

```
botnovo/
├── src/
│   ├── uazapi.js      # Cliente para API Uazapi
│   └── handlers.js    # Handlers de comandos do bot
├── index.js           # Servidor Express e rotas
├── package.json       # Dependências do projeto
├── .env               # Configurações (criar você mesmo)
└── README.md          # Este arquivo
```

## 📡 Endpoints da API

- `GET /` - Health check do servidor
- `GET /status` - Status da instância Uazapi
- `POST /webhook` - Webhook para receber mensagens do WhatsApp
- `POST /send-test` - Endpoint para enviar mensagens de teste

### Exemplo de envio de teste:

```bash
curl -X POST http://localhost:3000/send-test \
  -H "Content-Type: application/json" \
  -d '{
    "number": "5511999999999",
    "message": "Mensagem de teste"
  }'
```

## 🔌 Integração com Sistemas Externos

Para integrar com seus sistemas (faturamento, monitoramento, etc), edite os handlers em `src/handlers.js`:

- `handleStatus()` - Integre com sistema de monitoramento
- `handleFatura()` - Integre com sistema de faturamento
- `handleChamado()` - Integre com sistema de tickets

## 📚 Documentação Uazapi

Consulte a documentação oficial da Uazapi:
- [Documentação Uazapi](https://docs.uazapi.com)
- [GitHub Uazapi](https://github.com/uazapi/uazapi)

## 🛠️ Desenvolvimento

### Adicionar novos comandos:

1. Edite `src/handlers.js`
2. Adicione a lógica no método `handleMessage()`
3. Crie o handler específico para o comando

### Exemplo:

```javascript
// No handleMessage, adicione:
if (text.startsWith('5') || text === 'meus planos') {
  return await this.handlePlanos(from);
}

// Crie o método:
async handlePlanos(number) {
  const response = `📦 Seus planos...`;
  return await this.uazapi.sendText(number, response);
}
```

## 📝 Licença

MIT

## 🤝 Contribuições

Contribuições são bem-vindas! Sinta-se à vontade para abrir issues ou pull requests.

## ⚠️ Notas Importantes

- Certifique-se de que seu servidor Uazapi está configurado corretamente
- O webhook precisa ser acessível publicamente (use HTTPS em produção)
- Mantenha suas credenciais seguras no arquivo `.env` (não commite no git)
- Para produção, considere usar um serviço de hospedagem como Heroku, Railway, ou VPS

## 🆘 Suporte

Para dúvidas sobre:
- **Uazapi**: Consulte a documentação oficial
- **Este bot**: Abra uma issue no repositório

