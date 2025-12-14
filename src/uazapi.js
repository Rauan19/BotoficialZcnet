import axios from 'axios';

/**
 * Cliente para integração com Uazapi
 */
export class UazapiClient {
  constructor(server, token, instance = null, adminToken = null) {
    this.server = server.replace(/\/$/, ''); // Remove barra final se houver
    this.token = token;
    this.instance = instance;
    this.adminToken = adminToken || token; // Usa adminToken se fornecido, senão usa o token normal
    // Uazapi usa o token diretamente - se tiver instance, usa /instance/{instance}, senão usa apenas /instance
    this.baseURL = instance 
      ? `${this.server}/instance/${instance}`
      : `${this.server}/instance`;
    
    this.client = axios.create({
      baseURL: this.baseURL,
      headers: {
        'apikey': this.adminToken, // Uazapi usa adminToken no header
        'Authorization': `Bearer ${this.adminToken}`, // Usa adminToken
        'Content-Type': 'application/json'
      },
      // Passa o token também como parâmetro se necessário
      params: instance ? {} : { token: this.token }
    });
  }

  /**
   * Verifica o status da instância
   */
  async getStatus() {
    try {
      // Tenta diferentes formatos de endpoint
      let response;
      try {
        response = await this.client.get('/status');
      } catch (e) {
        // Tenta com /instance/status se o primeiro falhar
        response = await axios.get(`${this.server}/instance/status`, {
          headers: {
            'apikey': this.token,
            'Authorization': `Bearer ${this.token}`
          }
        });
      }
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Envia mensagem de texto
   * @param {string} number - Número no formato 5511999999999 ou ID do chat
   * @param {string} text - Texto da mensagem
   * @param {object} options - Opções adicionais (linkPreview, replyid, mentions, etc)
   */
  async sendText(number, text, options = {}) {
    try {
      // Uazapi usa o endpoint /send/text
      // Pode precisar do instance token no body ou query
      const payload = {
        number: number,
        text: text,
        ...options
      };
      
      // Adiciona o instance token no body também
      if (this.token && !payload.token) {
        payload.token = this.token;
      }
      
      const endpoint = `${this.server}/send/text`;
      
      // Tenta com admin token no header e instance token no body
      let response;
      try {
        response = await axios.post(endpoint, payload, {
          headers: {
            'apikey': this.adminToken, // Admin token no header
            'Authorization': `Bearer ${this.adminToken}`,
            'Content-Type': 'application/json'
          }
        });
      } catch (e1) {
        // Tenta também como query parameter
        try {
          response = await axios.post(endpoint, payload, {
            headers: {
              'apikey': this.adminToken,
              'Authorization': `Bearer ${this.adminToken}`,
              'Content-Type': 'application/json'
            },
            params: {
              token: this.token
            }
          });
        } catch (e2) {
          // Última tentativa: apenas instance token
          response = await axios.post(endpoint, payload, {
            headers: {
              'apikey': this.token,
              'Authorization': `Bearer ${this.token}`,
              'Content-Type': 'application/json'
            }
          });
        }
      }
      
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Envia menu interativo (botões, lista, carrossel ou enquete)
   * @param {string} number - Número no formato 5511999999999
   * @param {object} menuData - Dados do menu (type, text, footerText, listButton, choices, etc)
   */
  async sendMenu(number, menuData) {
    try {
      const payload = {
        number: number,
        ...menuData
      };
      
      // Garante que tem o tipo
      if (!payload.type) {
        payload.type = 'list';
      }
      
      // Adiciona o instance token no body
      if (this.token && !payload.token) {
        payload.token = this.token;
      }
      
      // Usa o endpoint específico para menu: /send/menu
      const endpoint = `${this.server}/send/menu`;
      
      // Tenta com admin token no header e instance token no body
      let response;
      try {
        response = await axios.post(endpoint, payload, {
          headers: {
            'apikey': this.adminToken,
            'Authorization': `Bearer ${this.adminToken}`,
            'Content-Type': 'application/json'
          }
        });
      } catch (e1) {
        // Tenta também como query parameter
        try {
          response = await axios.post(endpoint, payload, {
            headers: {
              'apikey': this.adminToken,
              'Authorization': `Bearer ${this.adminToken}`,
              'Content-Type': 'application/json'
            },
            params: {
              token: this.token
            }
          });
        } catch (e2) {
          // Última tentativa: apenas instance token
          response = await axios.post(endpoint, payload, {
            headers: {
              'apikey': this.token,
              'Authorization': `Bearer ${this.token}`,
              'Content-Type': 'application/json'
            }
          });
        }
      }
      
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Envia mensagem com imagem
   * @param {string} number - Número no formato 5511999999999
   * @param {string} imageUrl - URL da imagem ou base64 (data:image/png;base64,...)
   * @param {string} caption - Legenda da imagem
   */
  async sendImage(number, imageUrl, caption = '') {
    try {
      // Usa o novo endpoint /send/media
      return await this.sendMedia(number, 'image', imageUrl, caption);
    } catch (error) {
      throw error;
    }
  }

  /**
   * Envia mídia usando o endpoint /send/media
   * @param {string} number - Número no formato 5511999999999
   * @param {string} type - Tipo de mídia (image, video, document, audio, etc)
   * @param {string} file - URL ou base64 do arquivo
   * @param {string} text - Legenda/texto (opcional)
   * @param {object} options - Opções adicionais (docName, thumbnail, etc)
   */
  async sendMedia(number, type, file, text = '', options = {}) {
    try {
      const payload = {
        number: number,
        type: type,
        file: file,
        text: text,
        readchat: false,
        readmessages: false,
        ...options
      };

      // Adiciona o instance token no body
      if (this.token && !payload.token) {
        payload.token = this.token;
      }

      const endpoint = `${this.server}/send/media`;
      
      let response;
      try {
        response = await axios.post(endpoint, payload, {
          headers: {
            'apikey': this.adminToken,
            'Authorization': `Bearer ${this.adminToken}`,
            'Content-Type': 'application/json'
          }
        });
      } catch (e1) {
        try {
          response = await axios.post(endpoint, payload, {
            headers: {
              'apikey': this.adminToken,
              'Authorization': `Bearer ${this.adminToken}`,
              'Content-Type': 'application/json'
            },
            params: {
              token: this.token
            }
          });
        } catch (e2) {
          response = await axios.post(endpoint, payload, {
            headers: {
              'apikey': this.token,
              'Authorization': `Bearer ${this.token}`,
              'Content-Type': 'application/json'
            }
          });
        }
      }

      await this.setChatRead(number, false);
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Envia mensagem com documento
   * @param {string} number - Número no formato 5511999999999
   * @param {string} documentUrl - URL do documento ou base64
   * @param {string} fileName - Nome do arquivo
   * @param {string} text - Texto/caption (opcional)
   */
  async sendDocument(number, documentUrl, fileName, text = '') {
    try {
      return await this.sendMedia(number, 'document', documentUrl, text, { docName: fileName });
    } catch (error) {
      throw error;
    }
  }

  /**
   * Envia botão PIX nativo do WhatsApp
   * @param {string} number - Número no formato 5511999999999
   * @param {string} pixType - Tipo da chave PIX: CPF, CNPJ, PHONE, EMAIL, EVP
   * @param {string} pixKey - Valor da chave PIX
   * @param {string} pixName - Nome do recebedor (padrão: "Pix")
   */
  async sendPixButton(number, pixType, pixKey, pixName = 'Pix') {
    try {
      const payload = {
        number: number,
        pixType: pixType,
        pixKey: pixKey,
        pixName: pixName,
        readchat: false,
        readmessages: false
      };

      // Adiciona o instance token no body
      if (this.token && !payload.token) {
        payload.token = this.token;
      }

      const endpoint = `${this.server}/send/pix-button`;
      
      // Tenta com admin token no header
      let response;
      try {
        response = await axios.post(endpoint, payload, {
          headers: {
            'apikey': this.adminToken,
            'Authorization': `Bearer ${this.adminToken}`,
            'Content-Type': 'application/json'
          }
        });
      } catch (e1) {
        // Tenta também como query parameter
        try {
          response = await axios.post(endpoint, payload, {
            headers: {
              'apikey': this.adminToken,
              'Authorization': `Bearer ${this.adminToken}`,
              'Content-Type': 'application/json'
            },
            params: {
              token: this.token
            }
          });
        } catch (e2) {
          // Última tentativa: apenas instance token
          response = await axios.post(endpoint, payload, {
            headers: {
              'apikey': this.token,
              'Authorization': `Bearer ${this.token}`,
              'Content-Type': 'application/json'
            }
          });
        }
      }

      // Marca o chat como não lido após enviar
      await this.setChatRead(number, false);
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Controla o status de leitura do chat
   * @param {string} number - Número no formato 5511999999999 ou 5511999999999@s.whatsapp.net
   * @param {boolean} read - true para marcar como lido, false para marcar como não lido
   */
  async setChatRead(number, read = false) {
    try {
      // Garante que o número está no formato correto (pode incluir @s.whatsapp.net)
      let chatNumber = number;
      if (!chatNumber.includes('@')) {
        chatNumber = `${chatNumber}@s.whatsapp.net`;
      }
      
      const payload = {
        number: chatNumber,
        read: read
      };
      
      // Adiciona o instance token no body
      if (this.token && !payload.token) {
        payload.token = this.token;
      }
      
      const endpoint = `${this.server}/chat/read`;
      
      // Tenta com admin token no header e instance token no body
      let response;
      try {
        response = await axios.post(endpoint, payload, {
          headers: {
            'apikey': this.adminToken,
            'Authorization': `Bearer ${this.adminToken}`,
            'Content-Type': 'application/json'
          }
        });
      } catch (e1) {
        // Tenta também como query parameter
        try {
          response = await axios.post(endpoint, payload, {
            headers: {
              'apikey': this.adminToken,
              'Authorization': `Bearer ${this.adminToken}`,
              'Content-Type': 'application/json'
            },
            params: {
              token: this.token
            }
          });
        } catch (e2) {
          // Última tentativa: apenas instance token
          response = await axios.post(endpoint, payload, {
            headers: {
              'apikey': this.token,
              'Authorization': `Bearer ${this.token}`,
              'Content-Type': 'application/json'
            }
          });
        }
      }
      
      return response.data;
    } catch (error) {
      // Não lança erro, apenas retorna null, pois não é crítico
      return null;
    }
  }

  /**
   * Webhook para receber mensagens
   * Registra webhook na instância
   * Nota: No Uazapi, geralmente o webhook é configurado diretamente no painel web
   * Este método tenta configurar via API, mas pode não estar disponível em todas as versões
   */
  async setWebhook(url) {
    try {
      // Uazapi pode usar diferentes formatos de endpoint
      // Tenta diferentes combinações
      let response;
      const headers = {
        'apikey': this.token,
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json'
      };
      
      // Método 1: POST /webhook/set/{instance} (formato documentado)
      try {
        const endpoint = this.instance 
          ? `${this.server}/webhook/set/${this.instance}`
          : `${this.server}/webhook/set`;
        
        response = await axios.post(endpoint, {
          url: url
        }, { headers });
        return response.data;
      } catch (e1) {
        // Método 2: Usando token como parâmetro
        try {
          response = await axios.post(`${this.server}/webhook/set`, {
            url: url,
            token: this.token
          }, { headers });
          return response.data;
        } catch (e2) {
          // Método 3: Via instância baseURL
          try {
            response = await this.client.post('/webhook', {
              url: url
            });
            return response.data;
          } catch (e3) {
            // Se todos falharem, retorna erro informativo
            throw new Error(`Não foi possível configurar webhook via API. Erro: ${e3.response?.data?.message || e3.message}. Configure manualmente no painel do Uazapi em: ${this.server}`);
          }
        }
      }
    } catch (error) {
      throw error;
    }
  }
}

