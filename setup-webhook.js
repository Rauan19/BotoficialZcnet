import dotenv from 'dotenv';
import { UazapiClient } from './src/uazapi.js';

dotenv.config();

const UAZAPI_SERVER = process.env.UAZAPI_SERVER || 'https://free.uazapi.com';
const UAZAPI_TOKEN = process.env.UAZAPI_TOKEN || '';
const UAZAPI_INSTANCE = process.env.UAZAPI_INSTANCE || null;
const WEBHOOK_URL = process.argv[2] || process.env.WEBHOOK_URL || 'https://cd3ff2b42807.ngrok-free.app/webhook';

async function setupWebhook() {
  try {
    const uazapiClient = new UazapiClient(UAZAPI_SERVER, UAZAPI_TOKEN, UAZAPI_INSTANCE);
    
    // Garante que termina com /webhook
    const finalUrl = WEBHOOK_URL.endsWith('/webhook') ? WEBHOOK_URL : `${WEBHOOK_URL}/webhook`;
    
    await uazapiClient.setWebhook(finalUrl);
    
  } catch (error) {
    process.exit(1);
  }
}

setupWebhook();



