import axios from 'axios';

/**
 * Cliente para integração com API ISPBOX V2
 */
export class IspboxClient {
  constructor(baseUrl, clientId, clientSecret) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove barra final se houver
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpiry = null;
  }

  /**
   * Obtém access token
   */
  async getAccessToken() {
    // Verifica se client_secret está configurado
    if (!this.clientSecret || this.clientSecret.trim() === '') {
      throw new Error('ISPBOX_CLIENT_SECRET não está configurado no arquivo .env');
    }

    // Se já tem token válido, retorna ele
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    try {
      const requestId = 'ispbox';
      const response = await axios.post(
        `${this.baseUrl}/api/v2/auth/token/ispbox`,
        new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: 'client_credentials',
          scope: 'clientes.ler clientes.servicos.ler clientes.servicos.status.atualizar clientes.servicos.internet.status clientes.servicos.internet.desconectar clientes.servicos.internet.filtro.mac.remover clientes.servicos.desbloqueio.temporario clientes.servicos.movel.consumo.ler clientes.servicos.cobrancas.ler clientes.servicos.cobrancas.pagamento.formas.ler clientes.servicos.cobrancas.pagamento.pdf.gerar clientes.servicos.cobrancas.pagamento.qrcode.gerar clientes.servicos.notas.fiscais.ler clientes.servicos.notas.fiscais.pdf.gerar clientes.servicos.relatorios.acessos.ler clientes.servicos.relatorios.franquia.dados.ler clientes.servicos.relatorios.grafico.banda.ler clientes.servicos.relatorios.ligacoes.ler clientes.servicos.relatorios.recargas.ler clientes.servicos.relatorios.portabilidades.ler'
        }),
        {
          headers: {
            'X-Request-ID': requestId,
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );

      if (response.data.status === 'error') {
        throw new Error(response.data.message || 'Erro na autenticação');
      }

      this.accessToken = response.data.access_token;
      this.refreshToken = response.data.refresh_token;
      
      // Token geralmente expira em 3600 segundos, vamos usar 3500 para segurança
      this.tokenExpiry = Date.now() + (3500 * 1000);

      return this.accessToken;
    } catch (error) {
      if (error.response?.status === 400 && error.response?.data?.message === 'Client authentication failed') {
        throw new Error('Autenticação falhou. Verifique se ISPBOX_CLIENT_SECRET está correto no arquivo .env');
      }
      throw error;
    }
  }

  /**
   * Busca cliente por CPF
   * Tenta diferentes variações do CPF para lidar com zeros à esquerda
   */
  async buscarClientePorCpf(cpf) {
    try {
      const token = await this.getAccessToken();
      const requestId = 'ispbox';
      
      // Remove formatação do CPF
      let cpfLimpo = cpf.replace(/\D/g, '');

      // Garante que o CPF tenha exatamente 11 dígitos (preenche com zeros à esquerda se necessário)
      if (cpfLimpo.length < 11) {
        cpfLimpo = cpfLimpo.padStart(11, '0');
      }

      if (cpfLimpo.length !== 11) {
        throw new Error('CPF deve ter 11 dígitos');
      }

      // Função auxiliar para buscar cliente com um CPF específico
      const buscarComCpf = async (cpfParaBuscar) => {
        const response = await axios.get(
          `${this.baseUrl}/api/v2/clientes`,
          {
            headers: {
              'X-Request-ID': requestId,
              'Authorization': `Bearer ${token}`
            },
            params: {
              pesquisa: cpfParaBuscar
            }
          }
        );

        // Verifica se há erro na resposta
        if (response.data && response.data.status === 'error') {
          return null;
        }

        // Os dados podem estar em response.data.data (array) ou response.data (array direto)
        let clientes = [];
        if (response.data && response.data.data && Array.isArray(response.data.data)) {
          clientes = response.data.data;
        } else if (Array.isArray(response.data)) {
          clientes = response.data;
        } else if (response.data && response.data.data && !Array.isArray(response.data.data)) {
          // Caso especial: pode vir como objeto único
          clientes = [response.data.data];
        }
        
        if (clientes.length === 0) {
          return null;
        }

        // Retorna o primeiro cliente encontrado
        return clientes[0];
      };

      // TENTATIVA 1: Busca com o CPF exatamente como foi informado
      let cliente = await buscarComCpf(cpfLimpo);
      if (cliente) {
        return cliente;
      }

      // TENTATIVA 2: Busca parcial - tenta com os últimos 10 dígitos (remove primeiro)
      // Isso ajuda quando há diferença no primeiro dígito
      // Exemplo: cliente digita "12345678901", na base pode estar "01234567890"
      // Buscar "2345678901" pode encontrar ambos
      if (cpfLimpo.length === 11) {
        const cpfUltimos10 = cpfLimpo.substring(1);
        cliente = await buscarComCpf(cpfUltimos10);
        if (cliente) {
          return cliente;
        }
      }

      // TENTATIVA 3: Se o CPF começa com zero, tenta SEM zero à esquerda (busca parcial)
      // Exemplo: cliente digita "01234567890" -> tenta buscar "1234567890" (10 dígitos)
      // Isso ajuda quando na base está salvo sem o zero à esquerda
      if (cpfLimpo.startsWith('0') && cpfLimpo.length === 11) {
        const cpfSemZeroEsquerda = cpfLimpo.replace(/^0+/, '');
        // Só tenta se ficou com pelo menos 10 dígitos
        if (cpfSemZeroEsquerda.length >= 10) {
          cliente = await buscarComCpf(cpfSemZeroEsquerda);
          if (cliente) {
            return cliente;
          }
        }
      }

      // TENTATIVA 4: Busca parcial - tenta com os últimos 9 dígitos
      // Para casos onde há diferença nos dois primeiros dígitos
      if (cpfLimpo.length === 11) {
        const cpfUltimos9 = cpfLimpo.substring(2);
        cliente = await buscarComCpf(cpfUltimos9);
        if (cliente) {
          return cliente;
        }
      }

      // Se nenhuma tentativa funcionou, retorna null
      return null;
    } catch (error) {
      if (error.response?.status === 401) {
        throw new Error('Token de autenticação inválido. Verifique as credenciais.');
      }
      throw error;
    }
  }

  /**
   * Lista serviços do cliente
   */
  async listarServicos(clientesId) {
    try {
      const token = await this.getAccessToken();
      const requestId = 'ispbox';

      // Primeiro tenta buscar apenas INTERNET
      let response = await axios.get(
        `${this.baseUrl}/api/v2/clientes/${clientesId}/servicos`,
        {
          headers: {
            'X-Request-ID': requestId,
            'Authorization': `Bearer ${token}`
          },
          params: {
            tipoServico: 'INTERNET'
          }
        }
      );

      if (response.data && response.data.status === 'error') {
        throw new Error(response.data.message || 'Erro ao listar serviços');
      }

      // Os dados podem estar em response.data.data (array) ou response.data (array direto)
      let servicos = [];
      if (response.data && response.data.data && Array.isArray(response.data.data)) {
        servicos = response.data.data;
      } else if (Array.isArray(response.data)) {
        servicos = response.data;
      }

      // Se não encontrou serviços de INTERNET, busca todos os tipos
      if (servicos.length === 0) {
        response = await axios.get(
          `${this.baseUrl}/api/v2/clientes/${clientesId}/servicos`,
          {
            headers: {
              'X-Request-ID': requestId,
              'Authorization': `Bearer ${token}`
            }
            // Sem filtro de tipoServico para buscar todos
          }
        );

        if (response.data && response.data.status === 'error') {
          throw new Error(response.data.message || 'Erro ao listar serviços');
        }

        // Extrair array de serviços
        if (response.data && response.data.data && Array.isArray(response.data.data)) {
          servicos = response.data.data;
        } else if (Array.isArray(response.data)) {
          servicos = response.data;
        }
      }

      return servicos;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Lista cobranças do serviço
   */
  async listarCobrancas(clientesId, servicosId) {
    try {
      const token = await this.getAccessToken();
      const requestId = 'ispbox';

      const url = `${this.baseUrl}/api/v2/clientes/${clientesId}/servicos/${servicosId}/cobrancas`;
      
      // Busca todas as páginas de cobranças
      let todasCobrancas = [];
      let paginaAtual = 1;
      let totalPaginas = 1;
      let response;
      try {
        do {
          const params = {
            tipoServico: 'INTERNET',
            pagina: paginaAtual,
            limite: 100  // Tenta buscar mais por página
          };
          
          response = await axios.get(url, {
            headers: {
              'X-Request-ID': requestId,
              'Authorization': `Bearer ${token}`
            },
            params: params
          });
          
          // Extrai cobranças desta página
          let cobrancasPagina = [];
          if (response.data && response.data.data && Array.isArray(response.data.data)) {
            cobrancasPagina = response.data.data;
          } else if (Array.isArray(response.data)) {
            cobrancasPagina = response.data;
          }
          
          todasCobrancas = todasCobrancas.concat(cobrancasPagina);
          
          // Verifica informações de paginação no meta
          if (response.data && response.data.meta) {
            totalPaginas = response.data.meta.totalPaginas || 1;
          }
          
          paginaAtual++;
          
          // Se não conseguir determinar total de páginas, para após a primeira página se não vier mais cobranças
          if (cobrancasPagina.length === 0) {
            break;
          }
          
        } while (paginaAtual <= totalPaginas);
        
        // Cria uma resposta fake para manter compatibilidade com o código existente
        response = {
          data: {
            data: todasCobrancas,
            meta: {
              total: todasCobrancas.length,
              pagina: 1,
              totalPaginas: 1,
              limite: todasCobrancas.length
            }
          }
        };
      } catch (error) {
        // Se der erro, tenta sem o parâmetro tipoServico (busca apenas primeira página)
        response = await axios.get(url, {
          headers: {
            'X-Request-ID': requestId,
            'Authorization': `Bearer ${token}`
          }
          // Sem filtro de tipoServico
        });
      }

      if (response.data && response.data.status === 'error') {
        throw new Error(response.data.message || 'Erro ao listar cobranças');
      }

      // Os dados podem estar em response.data.data (array) ou response.data (array direto)
      let cobrancas = [];
      if (response.data && response.data.data && Array.isArray(response.data.data)) {
        cobrancas = response.data.data;
      } else if (Array.isArray(response.data)) {
        cobrancas = response.data;
      }
      
      return cobrancas;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Lista formas de pagamento disponíveis
   */
  async listarFormasPagamento(clientesId, servicosId, tipoServico = 'INTERNET') {
    try {
      const token = await this.getAccessToken();
      const requestId = 'ispbox';

      const response = await axios.get(
        `${this.baseUrl}/api/v2/clientes/${clientesId}/servicos/${servicosId}/cobrancas/pagamento/formas`,
        {
          headers: {
            'X-Request-ID': requestId,
            'Authorization': `Bearer ${token}`
          },
          params: {
            tipoServico: tipoServico
          }
        }
      );

      if (response.data && response.data.status === 'error') {
        throw new Error(response.data.message || 'Erro ao listar formas de pagamento');
      }

      // Os dados podem estar em response.data.data (array) ou response.data (array direto) ou como objeto
      let formasPagamento = [];
      if (response.data && response.data.data && Array.isArray(response.data.data)) {
        formasPagamento = response.data.data;
      } else if (Array.isArray(response.data)) {
        formasPagamento = response.data;
      } else if (response.data && typeof response.data === 'object') {
        // Se for um objeto, pode ter propriedades como 'formas', 'tipos', etc.
        formasPagamento = response.data.formas || response.data.tipos || Object.values(response.data).filter(v => Array.isArray(v))[0] || [];
      }
      
      return formasPagamento;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Gera QR Code PIX para pagamento
   */
  async gerarQrcodePix(clientesId, servicosId, cobrancasId) {
    try {
      const token = await this.getAccessToken();
      const requestId = 'ispbox';

      const response = await axios.post(
        `${this.baseUrl}/api/v2/clientes/${clientesId}/servicos/${servicosId}/cobrancas/${cobrancasId}/pagamento/qrcode/gerar`,
        null,
        {
          headers: {
            'X-Request-ID': requestId,
            'Authorization': `Bearer ${token}`
          },
          params: {
            tipo: 'PIX'
          }
        }
      );

      if (response.data && response.data.status === 'error') {
        throw new Error(response.data.message || 'Erro ao gerar QR Code PIX');
      }

      // Os dados estão em response.data.data
      const qrCodeData = response.data.data || null;
      
      return qrCodeData;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Gera PDF do boleto
   */
  async gerarPdfBoleto(clientesId, servicosId, cobrancasId) {
    try {
      const token = await this.getAccessToken();
      const requestId = 'ispbox';

      const response = await axios.get(
        `${this.baseUrl}/api/v2/clientes/${clientesId}/servicos/${servicosId}/cobrancas/${cobrancasId}/pagamento/pdf`,
        {
          headers: {
            'X-Request-ID': requestId,
            'Authorization': `Bearer ${token}`
          },
          params: {
            formato: 'base64'
          },
          responseType: 'json'
        }
      );

      if (response.data && response.data.status === 'error') {
        throw new Error(response.data.message || 'Erro ao gerar PDF do boleto');
      }

      // Os dados estão em response.data.data
      return response.data.data || null;
    } catch (error) {
      throw error;
    }
  }
}

