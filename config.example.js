// Arquivo de configuração - Copie para config.js e preencha com suas credenciais
export const config = {
  uazapi: {
    server: process.env.UAZAPI_SERVER || 'https://seu-servidor-uazapi.com',
    token: process.env.UAZAPI_TOKEN || 'seu-token-aqui',
    instance: process.env.UAZAPI_INSTANCE || 'sua-instancia'
  },
  bot: {
    port: process.env.PORT || 3000,
    logLevel: process.env.LOG_LEVEL || 'info'
  }
};



