import express from 'express';
import dotenv from 'dotenv';
import { UazapiClient } from './src/uazapi.js';
import { BotHandlers } from './src/handlers.js';
import { IspboxClient } from './src/ispbox.js';

// Carrega variáveis de ambiente
dotenv.config();

const app = express();
app.use(express.json());

// Configuração
const UAZAPI_SERVER = process.env.UAZAPI_SERVER || 'https://free.uazapi.com';
const UAZAPI_TOKEN = process.env.UAZAPI_TOKEN || '43c68689-8bc7-4c86-9b6d-1087901c8ace';
const UAZAPI_ADMIN_TOKEN = process.env.UAZAPI_ADMIN_TOKEN || 'ZaW1qwTEkuq7Ub1cBUuyMiK5bNSu3nnMQ9lh7klElc2clSRV8t';
const UAZAPI_INSTANCE = process.env.UAZAPI_INSTANCE || null; // Opcional no Uazapi
const PORT = process.env.PORT || 3020;

// Configuração ISPBOX
const ISPBOX_BASE_URL = process.env.ISPBOX_BASE_URL || 'https://zcnet.ispbox.com.br';
const ISPBOX_CLIENT_ID = process.env.ISPBOX_CLIENT_ID || 'd435384d82e2ded84b686aeeebe55533';
const ISPBOX_CLIENT_SECRET = process.env.ISPBOX_CLIENT_SECRET || '';

// Inicializa cliente Uazapi
const uazapiClient = new UazapiClient(UAZAPI_SERVER, UAZAPI_TOKEN, UAZAPI_INSTANCE, UAZAPI_ADMIN_TOKEN);

// Inicializa cliente ISPBOX
const ispboxClient = new IspboxClient(ISPBOX_BASE_URL, ISPBOX_CLIENT_ID, ISPBOX_CLIENT_SECRET);

// Inicializa bot handlers
const botHandlers = new BotHandlers(uazapiClient, ispboxClient);

// Rota de health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'online', 
    service: 'Bot Provedor Uazapi',
    timestamp: new Date().toISOString()
  });
});

// Rota para verificar status da instância
app.get('/status', async (req, res) => {
  try {
    const status = await uazapiClient.getStatus();
    res.json({ success: true, status });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Cache para evitar processar a mesma mensagem múltiplas vezes
const processedMessages = new Map();
const CACHE_TTL = 30000; // 30 segundos

// Limpa cache antigo periodicamente
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamp] of processedMessages.entries()) {
    if (now - timestamp > CACHE_TTL) {
      processedMessages.delete(key);
    }
  }
}, 60000); // Limpa a cada minuto

// Webhook para receber mensagens do WhatsApp via Uazapi
app.post('/webhook', async (req, res) => {
  try {
    // Uazapi envia mensagens em diferentes formatos
    const data = req.body;
    let messageProcessed = false;
    
    // Formato Uazapi específico: { EventType: "messages", message: {...}, chat: {...} }
    if (data.EventType === 'messages' && data.message && !messageProcessed) {
      const msg = data.message;
      
      // Gera um ID único para a mensagem para evitar duplicação
      const messageId = msg.id || msg.messageId || `${msg.sender}_${msg.timestamp}_${Date.now()}`;
      
      // Verifica se já processou esta mensagem
      if (processedMessages.has(messageId)) {
        res.status(200).json({ success: true, skipped: true });
        return;
      }
      
      // Ignora mensagens enviadas por nós mesmos
      if (msg.fromMe === false && !msg.wasSentByApi) {
        // Extrai o número do sender (formato: 557591121519@s.whatsapp.net)
        const senderNumber = msg.sender || msg.chatid || msg.sender_pn || '';
        
        // Para botões interativos, prioriza buttonOrListid sobre text/content
        let messageText = '';
        if (msg.buttonOrListid) {
          // Se tem buttonOrListid, usa ele (resposta de botão ou lista)
          messageText = msg.buttonOrListid;
        } else {
          // Caso contrário, usa text, content, vote, body ou tenta extrair do content
          messageText = msg.text || msg.content || msg.vote || msg.body || '';
          
          // Se ainda não tiver texto, tenta extrair do objeto content se existir
          if (!messageText && msg.content && typeof msg.content === 'object') {
            messageText = msg.content.text || msg.content.conversation || msg.content.body || '';
          }
        }
        
        // Garante que messageText é uma string
        messageText = String(messageText || '').trim();
        
        // Permite processar mesmo se messageText estiver vazio (para comandos de botão que não precisam de texto)
        if (senderNumber && (messageText || msg.buttonOrListid)) {
          // Marca como processada ANTES de processar
          processedMessages.set(messageId, Date.now());
          
          const messageData = {
            from: senderNumber,
            body: messageText,
            type: msg.messageType || msg.type || (msg.buttonOrListid ? 'button' : 'text'),
            sender: senderNumber,
            text: messageText.toLowerCase(),
            buttonOrListid: msg.buttonOrListid || '',
            senderName: msg.senderName || data.chat?.name || ''
          };
          
          await botHandlers.handleMessage(messageData);
          messageProcessed = true;
        }
      }
    }
    
    // Formato Uazapi comum: { key: { remoteJid, fromMe }, message: {...}, messageType: 'conversation' }
    if (!messageProcessed && data.key && data.message) {
      const messageId = data.key.id || `${data.key.remoteJid}_${data.key.id}_${Date.now()}`;
      
      if (processedMessages.has(messageId)) {
        res.status(200).json({ success: true, skipped: true });
        return;
      }
      
      // Ignora mensagens enviadas por nós mesmos
      if (!data.key.fromMe) {
        processedMessages.set(messageId, Date.now());
        const messageData = {
          from: data.key.remoteJid,
          body: data.message.conversation || data.message.extendedTextMessage?.text || '',
          type: data.messageType || 'conversation',
          key: data.key,
          message: data.message
        };
        await botHandlers.handleMessage(messageData);
        messageProcessed = true;
      }
    }
    
    // Formato alternativo: array de mensagens
    if (!messageProcessed && data.messages && Array.isArray(data.messages)) {
      for (const message of data.messages) {
        if (!message.key?.fromMe && !message.fromMe) {
          const messageId = message.key?.id || `${message.from}_${Date.now()}`;
          if (!processedMessages.has(messageId)) {
            processedMessages.set(messageId, Date.now());
            await botHandlers.handleMessage(message);
            messageProcessed = true;
            break; // Processa apenas a primeira mensagem do array
          }
        }
      }
    }
    
    // Formato alternativo 2: mensagem direta (só se não foi processada ainda)
    if (!messageProcessed && (data.body || data.message)) {
      const message = data.body || data.message;
      if (!message.fromMe && !data.fromMe) {
        const messageId = message.id || `${message.from}_${Date.now()}`;
        if (!processedMessages.has(messageId)) {
          processedMessages.set(messageId, Date.now());
          await botHandlers.handleMessage(message);
          messageProcessed = true;
        }
      }
    }
    
    // Eventos do Uazapi (conexão, desconexão, etc) - APENAS se não tiver mensagem
    if (!messageProcessed && (data.event || data.EventType)) {
      const eventType = data.event || data.EventType;
      
      // Só processa eventos de mensagem se não tiver sido processado acima
      if ((eventType === 'messages.upsert' || eventType === 'messages') && data.data && !messageProcessed) {
        const messages = Array.isArray(data.data) ? data.data : [data.data];
        for (const msg of messages) {
          if (msg.key && !msg.key.fromMe) {
            const messageId = msg.key.id || `${msg.key.remoteJid}_${msg.key.id}_${Date.now()}`;
            if (!processedMessages.has(messageId)) {
              processedMessages.set(messageId, Date.now());
              await botHandlers.handleMessage({
                from: msg.key.remoteJid,
                body: msg.message?.conversation || msg.message?.extendedTextMessage?.text || '',
                type: 'conversation',
                key: msg.key,
                message: msg.message
              });
              messageProcessed = true;
              break; // Processa apenas a primeira mensagem
            }
          }
        }
      }
    }

    // Sempre responde 200 para o Uazapi
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(200).json({ success: false, error: error.message });
  }
});

// Rota para configurar webhook
app.post('/setup-webhook', async (req, res) => {
  try {
    const webhookUrl = req.body.url || req.query.url || process.env.WEBHOOK_URL;
    
    if (!webhookUrl) {
      return res.status(400).json({ 
        success: false, 
        error: 'URL do webhook é obrigatória. Envie como: ?url=https://seu-dominio.com/webhook ou no body: {"url": "https://..."}' 
      });
    }

    // Garante que a URL termina com /webhook
    const finalUrl = webhookUrl.endsWith('/webhook') ? webhookUrl : `${webhookUrl}/webhook`;
    
    const result = await uazapiClient.setWebhook(finalUrl);
    
    res.json({ 
      success: true, 
      message: 'Webhook configurado com sucesso!',
      webhook_url: finalUrl,
      result 
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message,
      details: error.response?.data 
    });
  }
});

// Rota GET para configurar webhook facilmente
app.get('/setup-webhook', async (req, res) => {
  try {
    const webhookUrl = req.query.url || process.env.WEBHOOK_URL;
    
    if (!webhookUrl) {
      return res.status(400).send(`
        <h2>Configurar Webhook Uazapi</h2>
        <p>Envie a URL do webhook como parâmetro:</p>
        <code>/setup-webhook?url=https://seu-dominio.com/webhook</code>
        <br><br>
        <p>Ou configure a variável de ambiente WEBHOOK_URL no arquivo .env</p>
      `);
    }

    const finalUrl = webhookUrl.endsWith('/webhook') ? webhookUrl : `${webhookUrl}/webhook`;
    
    const result = await uazapiClient.setWebhook(finalUrl);
    
    res.send(`
      <h2>✅ Webhook Configurado!</h2>
      <p><strong>URL:</strong> ${finalUrl}</p>
      <pre>${JSON.stringify(result, null, 2)}</pre>
      <br>
      <p>Agora configure esta URL no painel do Uazapi também!</p>
    `);
  } catch (error) {
    res.status(500).send(`
      <h2>❌ Erro ao configurar webhook</h2>
      <p><strong>Erro:</strong> ${error.message}</p>
      <pre>${JSON.stringify(error.response?.data || {}, null, 2)}</pre>
    `);
  }
});

// Rota para enviar mensagem de teste
app.post('/send-test', async (req, res) => {
  try {
    const { number, message } = req.body;
    
    if (!number || !message) {
      return res.status(400).json({ 
        success: false, 
        error: 'Número e mensagem são obrigatórios' 
      });
    }

    const result = await uazapiClient.sendText(number, message);
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Inicia servidor
app.listen(PORT, async () => {
  console.log(`🚀 Bot rodando na porta ${PORT}`);
  
  // Tenta verificar status da instância
  try {
    await uazapiClient.getStatus();
  } catch (error) {
    // Status não é crítico, apenas continua
  }
});

// Tratamento de erros não capturados
process.on('unhandledRejection', (error) => {
  // Erro não tratado - silencioso em produção
});

