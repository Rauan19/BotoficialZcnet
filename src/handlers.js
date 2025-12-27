import { UazapiClient } from './uazapi.js';

/**
 * Handlers de comandos do bot para provedor de internet
 */
export class BotHandlers {
  constructor(uazapiClient, ispboxClient = null) {
    this.uazapi = uazapiClient;
    this.ispbox = ispboxClient;
    // Armazena estado do fluxo de pagamento: { [number]: { etapa: 'cpf', cpf: '...', clienteId: '...', servicosId: '...', cobrancaId: '...' } }
    this.pagamentoState = new Map();
    // Armazena números que tiveram CPF não encontrado - para evitar que o bot continue insistindo
    // { [number]: timestamp } - expira após 1 hora
    this.cpfNaoEncontrado = new Map();
    
    // Limpa entradas antigas de CPF não encontrado periodicamente (a cada 30 minutos)
    setInterval(() => {
      const agora = Date.now();
      const umaHora = 60 * 60 * 1000; // 1 hora em milissegundos
      for (const [number, timestamp] of this.cpfNaoEncontrado.entries()) {
        if (agora - timestamp > umaHora) {
          this.cpfNaoEncontrado.delete(number);
        }
      }
    }, 30 * 60 * 1000); // Executa a cada 30 minutos
  }

  /**
   * Envia texto e marca chat como não lido
   */
  async sendTextUnread(number, text, options = {}) {
    await this.uazapi.sendText(number, text, { ...options, readchat: false, readmessages: false });
    await this.uazapi.setChatRead(number, false);
  }

  /**
   * Envia menu e marca chat como não lido
   */
  async sendMenuUnread(number, menuData) {
    const result = await this.uazapi.sendMenu(number, { ...menuData, readchat: false, readmessages: false });
    await this.uazapi.setChatRead(number, false);
    return result;
  }

  /**
   * Extrai chave PIX do payload para usar no botão nativo
   * @param {string} payload - Payload PIX completo
   * @returns {object} { pixKey: string, pixType: string } ou null
   */
  extrairChavePixDoPayload(payload) {
    if (!payload || typeof payload !== 'string') {
      return null;
    }

    try {
      // O payload PIX segue o padrão EMV e pode conter informações sobre a chave
      // Exemplo: 00020101021226830014BR.GOV.BCB.PIX...
      
      // PRIORIDADE 1: Procura por padrões no payload que são comuns em QR codes PIX
      // Procura por /v2/[código] primeiro (comum em QR codes dinâmicos)
      // O código pode ser hexadecimal (a-f0-9) e ter 32 ou mais caracteres
      const v2Match = payload.match(/\/v2\/([a-f0-9]{32,})/i);
      if (v2Match && v2Match[1]) {
        return { pixKey: v2Match[1], pixType: 'EVP' };
      }
      
      // Tenta também sem restrição de tamanho mínimo (caso o código seja menor)
      const v2MatchFlex = payload.match(/\/v2\/([a-z0-9-]+)/i);
      if (v2MatchFlex && v2MatchFlex[1].length >= 10) {
        return { pixKey: v2MatchFlex[1], pixType: 'EVP' };
      }

      // PRIORIDADE 2: CPF - mas NÃO pega números do início do payload EMV
      // O payload EMV começa com "00" e tem códigos de identificação, então ignora os primeiros caracteres
      // Procura CPF mais adiante no payload (após "BR.GOV.BCB.PIX" ou similar)
      const payloadSemInicio = payload.replace(/^00\d{20,}/, ''); // Remove início do payload EMV
      const cpfMatch = payloadSemInicio.match(/\d{11}/);
      if (cpfMatch) {
        const cpf = cpfMatch[0];
        // Valida se parece ser um CPF válido (não começa com 00, não todos iguais)
        if (!cpf.startsWith('00') && cpf !== '00000000000' && !/^(\d)\1{10}$/.test(cpf)) {
          return { pixKey: cpf, pixType: 'CPF' };
        }
      }

      // PRIORIDADE 3: CNPJ - também ignora início do payload EMV
      const cnpjMatch = payloadSemInicio.match(/\d{14}/);
      if (cnpjMatch) {
        const cnpj = cnpjMatch[0];
        // Valida se parece ser um CNPJ válido
        if (!cnpj.startsWith('00') && cnpj !== '00000000000000' && !/^(\d)\1{13}$/.test(cnpj)) {
          return { pixKey: cnpj, pixType: 'CNPJ' };
        }
      }

      // EMAIL: padrão de email no payload
      const emailMatch = payload.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/);
      if (emailMatch) {
        return { pixKey: emailMatch[1], pixType: 'EMAIL' };
      }

      // PHONE: número de telefone (10 ou 11 dígitos após código do país)
      // Formato: +55 seguido de 10 ou 11 dígitos
      const phoneMatch = payload.match(/\+?55(\d{10,11})/);
      if (phoneMatch) {
        return { pixKey: `+55${phoneMatch[1]}`, pixType: 'PHONE' };
      }

      // PRIORIDADE 4: Procura por códigos hexadecimais longos (32+ caracteres) que podem ser IDs de transação
      const hexMatch = payload.match(/([a-f0-9]{32,})/i);
      if (hexMatch) {
        return { pixKey: hexMatch[1], pixType: 'EVP' };
      }

      // Procura por UUIDs no payload
      const uuidMatch = payload.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
      if (uuidMatch) {
        return { pixKey: uuidMatch[1], pixType: 'EVP' };
      }

      // Como último recurso, retorna null (não usa payload completo como chave)
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Processa resposta da API e extrai payload e imagem do QR Code PIX
   * @param {object} apiResponse - Resposta da API do ISPBOX
   * @returns {object} { payload: string, imageBase64: string }
   */
  parsePixPayload(apiResponse) {
    // Extrai objeto de dados (pode estar em response.data ou direto)
    const obj = apiResponse && apiResponse.data ? apiResponse.data : apiResponse;
    
    let payload = null;
    let imageBase64 = null;
    
    if (!obj) return { payload, imageBase64 };

    // Busca payload (código PIX) em diferentes campos possíveis
    // Prioriza 'payload' que é o campo correto retornado pela API
    const payloadCandidates = [
      'payload', 'emv', 
      'qrcode', 'qrCode', 'qr_code', 
      'codigo', 'chave', 'copyPaste', 'copiaecola', 'copiaECola'
    ];
    
    for (const key of payloadCandidates) {
      if (typeof obj[key] === 'string' && obj[key].length > 10) {
        payload = obj[key];
        break;
      }
    }
    

    // Busca imagem base64 em diferentes campos possíveis
    // PRIORIDADE: base64 (campo correto que vem da API)
    const imageCandidates = [
      'base64', 'imagem', 'imagemQrcode', 'image', 'imageBase64'
    ];
    
    for (const key of imageCandidates) {
      if (typeof obj[key] === 'string' && obj[key].length > 100) {
        // Verifica se já tem header data:image
        const hasHeader = obj[key].startsWith('data:image');
        imageBase64 = hasHeader 
          ? obj[key] 
          : `data:image/png;base64,${obj[key]}`;
        break;
      }
    }
    

    return { payload, imageBase64 };
  }

  /**
   * Garante que temos uma imagem de QR Code PIX
   * Se API retornou imagem, usa ela. Se não, gera manualmente usando biblioteca qrcode.
   * @param {object} apiResponse - Resposta da API do ISPBOX
   * @returns {Promise<object>} { payload: string, buffer: Buffer, base64: string }
   */
  async garantirQRCodePIX(apiResponse) {
    // 1. Processar resposta da API
    const { payload, imageBase64 } = this.parsePixPayload(apiResponse);
    
    let qrCodeBuffer = null;
    let qrCodeBase64 = null;
    
    // 2. Se API retornou imagem, usar ela DIRETAMENTE (o base64 já é uma imagem de QR code)
    if (imageBase64) {
      // Converter base64 para Buffer (caso precise para salvar arquivo)
      let base64Data = imageBase64;
      if (base64Data.includes(',')) {
        // Remove header "data:image/png;base64," para converter para Buffer
        base64Data = base64Data.split(',')[1];
      }
      
      qrCodeBuffer = Buffer.from(base64Data, 'base64');
      // Usa o base64 COMPLETO com header (data:image/png;base64,...) para enviar como imagem
      qrCodeBase64 = imageBase64;
    }
    // 3. Se não veio imagem mas tem payload, gerar manualmente
    else if (payload) {
      try {
        // Importar biblioteca qrcode
        const QRCode = await import('qrcode');
        
        // Gerar QR Code a partir do payload usando biblioteca qrcode
        qrCodeBuffer = await QRCode.default.toBuffer(payload, {
          type: 'png',
          width: 500,
          margin: 2,
          color: {
            dark: '#000000',  // Cor do QR Code
            light: '#FFFFFF'  // Cor do fundo
          },
          errorCorrectionLevel: 'M'
        });
        
        // Gerar também como base64 com header
        qrCodeBase64 = await QRCode.default.toDataURL(payload, {
          type: 'image/png',
          width: 500,
          margin: 2,
          color: {
            dark: '#000000',
            light: '#FFFFFF'
          },
          errorCorrectionLevel: 'M'
        });
        
      } catch (qrcodeError) {
        throw qrcodeError;
      }
    }
    else {
      throw new Error('Nenhum dado válido retornado pela API para gerar QR Code');
    }
    
    return {
      payload: payload,           // Código PIX para copiar/colar
      buffer: qrCodeBuffer,       // Buffer da imagem PNG
      base64: qrCodeBase64        // Base64 com header "data:image/png;base64,..."
    };
  }

  /**
   * Detecta saudações na mensagem (mesmo no meio de uma frase)
   * @param {string} text - Texto da mensagem
   * @returns {boolean} true se contém saudação
   */
  detectarSaudacao(text) {
    if (!text || typeof text !== 'string') {
      return false;
    }
    
    const saudacoes = [
      'oi', 'oii', 'oiii', 'olá', 'ola', 'ola!', 'olá!',
      'bom dia', 'bomdia', 'bom dia!', 'bomdia!', 'bom diaa', 'bomdiaa',
      'boa tarde', 'boatarde', 'boa tarde!', 'boatarde!',
      'boa noite', 'boanoite', 'boa noite!', 'boanoite!',
      'e aí', 'e ai', 'e aí?', 'e ai?', 'eae', 'e aê',
      'opa', 'opa!', 'eita', 'eita!',
      'salve', 'salve!', 'fala', 'fala!', 'fala aí', 'fala ai'
    ];
    
    const textLower = text.toLowerCase().trim();
    
    // Verifica se o texto é exatamente uma saudação
    if (saudacoes.includes(textLower)) {
      return true;
    }
    
    // Verifica se contém alguma saudação no início ou no meio da frase
    for (const saudacao of saudacoes) {
      // Verifica no início da frase
      if (textLower.startsWith(saudacao + ' ') || textLower.startsWith(saudacao + '!') || textLower.startsWith(saudacao + '?')) {
        return true;
      }
      
      // Verifica no meio da frase (com espaço antes e depois, ou pontuação)
      const regex = new RegExp(`(^|\\s)${saudacao.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|!|\\?|$|\\.|,|:)`, 'i');
      if (regex.test(textLower)) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Normaliza número de telefone
   */
  normalizePhone(number) {
    // Verifica se o número existe
    if (!number) {
      return null;
    }
    
    // Converte para string se necessário
    const phoneStr = String(number);
    
    // Remove caracteres não numéricos
    let phone = phoneStr.replace(/\D/g, '');
    
    // Se não começar com código do país, assume Brasil (55)
    if (phone && !phone.startsWith('55')) {
      phone = '55' + phone;
    }
    
    return phone;
  }

  /**
   * Handler para mensagem recebida
   */
  async handleMessage(message) {
    // Extrai o número de origem de diferentes formatos possíveis
    let fromRaw = message.from || message.key?.remoteJid || message.fromNumber || message.number || message.sender || message.chatid || message.sender_pn;

    // Aceita mensagens de contatos (@s.whatsapp.net) e contas empresariais (@lid)
    // Ignora APENAS grupos (@g.us)
    if (fromRaw && typeof fromRaw === 'string') {
      const fromString = String(fromRaw);

      // Se for grupo, nem processa
      if (fromString.includes('@g.us')) {
        return;
      }

      // Se o número vem no formato WhatsApp (ex: 557591121519@s.whatsapp.net ou 557591121519@lid),
      // extrai apenas os números antes do @
      if (fromString.includes('@')) {
        fromRaw = fromString.split('@')[0];
      }
    }
    
    const from = this.normalizePhone(fromRaw);
    
    if (!from) {
      return; // Não processa se não tiver número
    }
    
    // Prioriza buttonOrListid se existir (resposta de botão/list)
    let text = '';
    const isButtonClick = !!message.buttonOrListid;
    
    if (isButtonClick) {
      text = String(message.buttonOrListid).toLowerCase().trim();
    } else {
      text = String(message.body || message.text || message.content || message.message?.conversation || message.message?.extendedTextMessage?.text || '').toLowerCase().trim();
    }
    
    const messageType = message.type || message.messageType;

    
    // Verifica se está aguardando CPF no fluxo de pagamento
    if (!isButtonClick && this.pagamentoState.has(from) && this.pagamentoState.get(from).etapa === 'cpf') {
      const state = this.pagamentoState.get(from);
      
      // Lista de comandos que cancelam o fluxo de CPF (cliente mudou de assunto)
      const comandosQueCancelamCpf = [
        'menu', 'inicio', 'voltar ao menu',
        'atendente', 'falar com atendente', 'atendimento',
        'suporte', 'suporte técnico', 'suporte tecnico', 'abrir chamado', 'chamado',
        'fatura', 'boleto', 'pagamento',
        'planos', 'nossos planos', 'planos disponíveis', 'preços'
      ];
      
      // Verifica se a mensagem é um comando que cancela o fluxo de CPF
      const isComandoQueCancela = comandosQueCancelamCpf.some(cmd => {
        const textLower = text.toLowerCase().trim();
        return textLower === cmd || textLower.startsWith(cmd + ' ');
      });
      
      // Se for uma saudação, também cancela o fluxo de CPF
      const isSaudacao = this.detectarSaudacao(text);
      
      // REGRA 7: Se o cliente mudou de assunto (comando ou saudação), mantém estado sem insistir
      if (isComandoQueCancela || isSaudacao) {
        this.pagamentoState.delete(from);
        this.cpfNaoEncontrado.delete(from);
        // Continua processando o comando normalmente (não retorna aqui)
      } else {
        // REGRA 1: O bot SÓ deve responder se a mensagem parecer um CPF (11 dígitos)
        // Extrai apenas números da mensagem
        let cpf = text.replace(/\D/g, '');
        
        // Se não tem números ou tem muitos caracteres não numéricos, não é CPF
        const caracteresNaoNumericos = text.replace(/\d/g, '').trim().length;
        const temApenasNumeros = cpf.length > 0 && caracteresNaoNumericos <= 2; // Permite até 2 caracteres não numéricos (pontos, traços)
        
        // REGRA 2: Se NÃO parecer CPF, o bot NÃO responde nada
        if (!temApenasNumeros || cpf.length === 0) {
          // Ignora silenciosamente - cliente provavelmente mudou de assunto
          return;
        }
        
        // Garante que o CPF tenha exatamente 11 dígitos (preenche com zeros à esquerda se necessário)
        if (cpf.length > 0 && cpf.length <= 11) {
          cpf = cpf.padStart(11, '0');
        }
        
        // Verifica se tem exatamente 11 dígitos
        if (cpf.length !== 11) {
          // CPF malformado - REGRA 3: responder apenas UMA vez "CPF inválido"
          if (!state.erroCpfFormato) {
            state.erroCpfFormato = true;
            state.ultimoCpfTentado = null; // Reset último CPF
            this.pagamentoState.set(from, state);
            await this.sendTextUnread(from, '❌ CPF inválido. Por favor, informe um CPF com 11 dígitos.');
          }
          // Se já deu erro de formato, não responde novamente
          return;
        }
        
        // REGRA 6: Se o cliente enviar um CPF diferente, resetar os erros e reprocessar
        if (state.ultimoCpfTentado && state.ultimoCpfTentado !== cpf) {
          // CPF diferente do anterior - reseta flags de erro
          state.erroCpfFormato = false;
          state.erroCpfNaoEncontrado = false;
          state.ultimoCpfTentado = cpf;
          this.pagamentoState.set(from, state);
          // Processa o novo CPF
          return await this.processarCpfPagamento(from, cpf);
        }
        
        // Se é o mesmo CPF que já deu erro, não processa novamente
        if (state.erroCpfNaoEncontrado && state.ultimoCpfTentado === cpf) {
          // Já deu erro para este CPF - não responde novamente
          return;
        }
        
        // Se é o mesmo CPF que já deu erro de formato, não processa novamente
        if (state.erroCpfFormato && state.ultimoCpfTentado === cpf) {
          // Já deu erro de formato para este CPF - não responde novamente
          return;
        }
        
        // CPF válido (11 dígitos) - processa
        state.ultimoCpfTentado = cpf;
        this.pagamentoState.set(from, state);
        return await this.processarCpfPagamento(from, cpf);
      }
    }

    // Detecta saudações (mesmo no meio de uma frase)
    if (!isButtonClick && text && this.detectarSaudacao(text)) {
      return await this.sendMenu(from);
    }

    // Se NÃO for clique em botão e o texto não corresponder exatamente a comandos conhecidos,
    // ignora silenciosamente (comportamento original: só responde para saudações e comandos conhecidos)
    if (!isButtonClick && text) {
      // Lista de comandos permitidos por texto (apenas comandos básicos)
      const allowedTextCommands = [
        'menu', 'inicio', 'voltar ao menu',
        'fatura', 'boleto', 'pagamento',
        'suporte', 'suporte técnico', 'suporte tecnico', 'abrir chamado', 'chamado',
        'atendente', 'falar com atendente', 'atendimento',
        'planos', 'nossos planos', 'planos disponíveis', 'preços'
      ];
      
      // Verifica se o texto corresponde exatamente a algum comando permitido
      const isAllowedCommand = allowedTextCommands.some(cmd => text === cmd || text.startsWith(cmd + ' '));
      
      if (!isAllowedCommand) {
        // Se não for um comando permitido, ignora silenciosamente (não responde nada)
        return; // Não responde nada
      }
    }

    // Menu principal (apenas para comandos permitidos ou cliques em botão)
    if (text === 'menu' || text === 'inicio' || text === 'voltar ao menu') {
      return await this.sendMenu(from);
    }

    // Verifica se está no fluxo de pagamento antes de processar comandos de boleto/pagamento
    const pagamentoState = this.pagamentoState.get(from);
    const estaNoFluxoPagamento = pagamentoState && (pagamentoState.etapa === 'pagamento' || pagamentoState.etapa === 'cobranca');
    
    // Se está no fluxo de pagamento e pediu boleto, processa diretamente
    if (estaNoFluxoPagamento && text === 'boleto') {
      return await this.processarBoleto(from);
    }
    
    // Comandos do bot (inclui IDs dos botões interativos)
    // Se não estiver no fluxo, "boleto" inicia o fluxo de pagamento
    if (text === 'fatura' || text === 'boleto' || text === 'pagamento' || (isButtonClick && text.startsWith('1'))) {
      return await this.handleFatura(from, text);
    }

    // Suporte Técnico - verifica várias variações possíveis
    if (text === 'suporte' || text === 'suporte técnico' || text === 'suporte tecnico' || text === 'abrir chamado' || text === 'chamado' || (isButtonClick && text.startsWith('2'))) {
      return await this.handleSuporte(from, text);
    }

    // Submenu de Suporte Técnico (apenas cliques em botão)
    if (isButtonClick) {
      if (text === 'internet_lenta' || text === 'internet lenta' || text === 'lenta') {
        return await this.handleInternetLenta(from, text);
      }

      if (text === 'sem_conexao' || text === 'sem conexão' || text === 'sem conexao' || text === 'sem internet') {
        return await this.handleSemConexao(from, text);
      }

      if (text === 'ja_paguei' || text === 'já paguei' || text === 'ja paguei' || text === 'paguei') {
        return await this.handleJaPaguei(from, text);
      }

      if (text === 'atendente' || text === 'falar com atendente') {
        return await this.handleAtendente(from, text);
      }

      if (text === 'planos' || text === 'nossos planos' || text === 'planos disponíveis' || text === 'preços') {
        return await this.handlePlanos(from, text);
      }

      // Submenu de Planos - Assinar (apenas cliques)
      if (text === 'assinar_200' || text === 'assinar plano 200' || text === 'plano 200') {
        return await this.handleAssinar200(from, text);
      }

      if (text === 'assinar_300' || text === 'assinar plano 300' || text === 'plano 300') {
        return await this.handleAssinar300(from, text);
      }

      if (text === 'assinar_500' || text === 'assinar plano 500' || text === 'plano 500') {
        return await this.handleAssinar500(from, text);
      }

      // Pagamento - escolha de cobrança
      if (text.startsWith('cobranca_')) {
        return await this.processarEscolhaCobranca(from, text);
      }

      // Pagamento - opções de forma de pagamento
      if (text === 'pix') {
        return await this.processarPagamentoPix(from);
      }

      if (text === 'boleto') {
        return await this.processarBoleto(from);
      }
    }

    // Comandos de texto permitidos (sem necessidade de botão)
    if (text === 'atendente' || text === 'falar com atendente' || text === 'atendimento') {
      return await this.handleAtendente(from, text);
    }

    if (text === 'planos' || text === 'nossos planos' || text === 'planos disponíveis' || text === 'preços') {
      return await this.handlePlanos(from, text);
    }

    // Se chegou aqui e não foi processado, ignora silenciosamente (não responde)
    return; // Não responde nada
  }

  /**
   * Envia menu principal interativo (botões - aparecem diretamente)
   */
  async sendMenu(number) {
    const menuData = {
      type: 'button',
      text: 'Olá! Como posso ajudá-lo hoje?\n\nEscolha uma opção:',
      footerText: 'ZC NET - Seu provedor de internet',
      choices: [
        'Pagamento|fatura',
        '🔧 Suporte Técnico|suporte',
        '👤 Falar com Atendente|atendente',
        '📦 Nossos Planos|planos'
      ],
      readchat: true,
      readmessages: true
    };

    try {
      const result = await this.uazapi.sendMenu(number, menuData);
      // Marca o chat como não lido após enviar o menu
      await this.uazapi.setChatRead(number, false);
      return result;
    } catch (error) {
      // Se falhar, envia menu de texto simples como fallback
      const menuTexto = `Olá! Como posso ajudá-lo hoje?

Digite o *número* da opção desejada:

*1* ou *fatura* - Pagamento
*2* ou *suporte* - 🔧 Suporte Técnico
*3* ou *atendente* - 👤 Falar com Atendente
*4* ou *planos* - 📦 Nossos Planos

_Digite MENU a qualquer momento para voltar_`;

      await this.uazapi.sendText(number, menuTexto, { readchat: false, readmessages: false });
      await this.uazapi.setChatRead(number, false);
    }
  }

  /**
   * Handler para Suporte Técnico - Mostra submenu
   */
  async handleSuporte(number, message) {
    const menuData = {
      type: 'button',
      text: '🔧 *Suporte Técnico*\n\nQual problema você está enfrentando?',
      footerText: 'ZC NET',
      choices: [
        '🐌 Internet Lenta|internet_lenta',
        '📵 Sem Conexão|sem_conexao',
        'Já Paguei|ja_paguei',
        'Voltar ao Menu|menu'
      ],
      readchat: false,
      readmessages: false
    };

    try {
      const result = await this.uazapi.sendMenu(number, menuData);
      // Marca o chat como não lido após enviar o menu
      await this.uazapi.setChatRead(number, false);
      return result;
    } catch (error) {
      // Fallback para texto
      const menuTexto = `🔧 *Suporte Técnico*

Qual problema você está enfrentando?

*1* - 🐌 Internet Lenta
*2* - 📵 Sem Conexão
*3* - Já Paguei
*0* - Voltar ao Menu`;

      await this.uazapi.sendText(number, menuTexto);
      return await this.sendVoltarMenu(number);
    }
  }

  /**
   * Handler para Internet Lenta - Mostra submenu
   */
  async handleInternetLenta(number, message) {
    const menuData = {
      type: 'button',
      text: '🐌 *Internet Lenta*\n\nSiga as instruções abaixo:\n\nDesligue e ligue os equipamentos, aguarde alguns minutos e teste a conexão.',
      footerText: 'ZC NET',
      choices: [
        '👤 Falar com Atendente|atendente',
        'Voltar ao Menu Principal|menu'
      ],
      readchat: false,
      readmessages: false
    };

    try {
      const result = await this.uazapi.sendMenu(number, menuData);
      // Marca o chat como não lido após enviar o menu
      await this.uazapi.setChatRead(number, false);
      return result;
    } catch (error) {
      // Fallback para texto
      const menuTexto = `🐌 *Internet Lenta*

Siga as instruções abaixo:

Desligue e ligue os equipamentos, aguarde alguns minutos e teste a conexão.

*1* - 👤 Falar com Atendente
*0* - Voltar ao Menu Principal`;

      await this.sendTextUnread(number, menuTexto);
      return await this.sendVoltarMenu(number);
    }
  }

  /**
   * Handler para Sem Conexão - Mostra submenu
   */
  async handleSemConexao(number, message) {
    const menuData = {
      type: 'button',
      text: '📵 *Sem Conexão*\n\n*Verificações iniciais:*\n\nVerifique se o roteador está ligado\nVeja se os LEDs estão piscando normalmente\nReinicie o roteador\n\nSe não voltou sua conexão:',
      footerText: 'ZC NET',
      choices: [
        '👤 Falar com Atendente|atendente',
        'Voltar ao Menu Principal|menu'
      ],
      readchat: false,
      readmessages: false
    };

    try {
      const result = await this.uazapi.sendMenu(number, menuData);
      // Marca o chat como não lido após enviar o menu
      await this.uazapi.setChatRead(number, false);
      return result;
    } catch (error) {
      // Fallback para texto
      const menuTexto = `📵 *Sem Conexão*

*Verificações iniciais:*

Verifique se o roteador está ligado
Veja se os LEDs estão piscando normalmente
Reinicie o roteador

Se não voltou sua conexão:

*1* - 👤 Falar com Atendente
*0* - Voltar ao Menu Principal`;

      await this.sendTextUnread(number, menuTexto);
      return await this.sendVoltarMenu(number);
    }
  }

  /**
   * Handler para Já Paguei - Mostra submenu
   */
  async handleJaPaguei(number, message) {
    const menuData = {
      type: 'button',
      text: '*Já Paguei*\n\nSe você já realizou o pagamento, reinicie os equipamentos e espere 4 minutos.\n\nSe não voltar sua conexão:',
      footerText: 'ZC NET',
      choices: [
        '👤 Falar com Atendente|atendente',
        'Voltar ao Menu Principal|menu'
      ],
      readchat: false,
      readmessages: false
    };

    try {
      const result = await this.uazapi.sendMenu(number, menuData);
      // Marca o chat como não lido após enviar o menu
      await this.uazapi.setChatRead(number, false);
      return result;
    } catch (error) {
      // Fallback para texto
      const menuTexto = `*Já Paguei*

Se você já realizou o pagamento, reinicie os equipamentos e espere 4 minutos.

Se não voltar sua conexão:

*1* - 👤 Falar com Atendente
*0* - Voltar ao Menu Principal`;

      await this.sendTextUnread(number, menuTexto);
      return await this.sendVoltarMenu(number);
    }
  }

  /**
   * Handler para Falar com Atendente
   */
  async handleAtendente(number, message) {
    const response = `Em breve um atendente humano irá dar continuidade ao atendimento.`;

    await this.sendTextUnread(number, response);
    // Envia botão para voltar ao menu
    return await this.sendVoltarMenu(number);
  }

  /**
   * Handler para Nossos Planos - Mostra submenu
   */
  async handlePlanos(number, message) {
    const planosTexto = `📦 *NOSSOS PLANOS*

💎 *PLANO 200 MEGAS*
💰 A partir de R$ 69,99/mês
⚡ 200 Megas de velocidade
📶 Roteador incluso
🆘 Suporte 24/7

⭐ *PLANO 300 MEGAS* 🏆 *MAIS POPULAR*
💰 A partir de R$ 84,99/mês
⚡ 300 Megas de velocidade
📶 Roteador incluso
📺 TV + Filmes e Séries
🆘 Suporte 24/7

👑 *PLANO 500 MEGAS*
💰 A partir de R$ 110,00/mês
⚡ 500 Megas de velocidade
📶 Roteador incluso
📺 TV + Filmes e Séries
🎬 Premiere incluso
⭐ Suporte prioritário

Escolha o plano ideal para você! 👇`;

    const menuData = {
      type: 'button',
      text: planosTexto,
      footerText: 'ZC NET - Sua conexão com o futuro',
      choices: [
        '💎 Assinar Plano 200|assinar_200',
        '⭐ Assinar Plano 300|assinar_300',
        '👑 Assinar Plano 500|assinar_500',
        'Voltar ao Menu|menu'
      ],
      readchat: true,
      readmessages: true
    };

    try {
      const result = await this.uazapi.sendMenu(number, menuData);
      return result;
    } catch (error) {
      // Fallback para texto
      await this.sendTextUnread(number, planosTexto);
      const menuTexto = `\n\n*Escolha uma opção:*
*1* - ✅ Assinar Plano 200
*2* - ✅ Assinar Plano 300
*3* - ✅ Assinar Plano 500
*0* - Voltar ao Menu`;

      await this.sendTextUnread(number, menuTexto);
      return await this.sendVoltarMenu(number);
    }
  }

  /**
   * Handler para Assinar Plano 200
   */
  async handleAssinar200(number, message) {
    const response = `✅ *PLANO SELECIONADO*

💎 *PLANO 200 MEGAS*
💰 Valor: R$ 69,99/mês

📋 *Benefícios inclusos:*
⚡ 200 Megas de velocidade
📶 Roteador incluso
🆘 Suporte 24/7

⏳ Em breve um atendente entrará em contato para finalizar a contratação!`;

    await this.sendTextUnread(number, response);
    return await this.sendVoltarMenu(number);
  }

  /**
   * Handler para Assinar Plano 300
   */
  async handleAssinar300(number, message) {
    const response = `✅ *PLANO SELECIONADO*

⭐ *PLANO 300 MEGAS* 🏆 *MAIS POPULAR*
💰 Valor: R$ 84,99/mês

📋 *Benefícios inclusos:*
⚡ 300 Megas de velocidade
📶 Roteador incluso
📺 TV + Filmes e Séries
🆘 Suporte 24/7

⏳ Em breve um atendente entrará em contato para finalizar a contratação!`;

    await this.sendTextUnread(number, response);
    return await this.sendVoltarMenu(number);
  }

  /**
   * Handler para Assinar Plano 500
   */
  async handleAssinar500(number, message) {
    const response = `✅ *PLANO SELECIONADO*

👑 *PLANO 500 MEGAS*
💰 Valor: R$ 110,00/mês

📋 *Benefícios inclusos:*
⚡ 500 Megas de velocidade
📶 Roteador incluso
📺 TV + Filmes e Séries
🎬 Premiere incluso
⭐ Suporte prioritário

⏳ Em breve um atendente entrará em contato para finalizar a contratação!`;

    await this.sendTextUnread(number, response);
    return await this.sendVoltarMenu(number);
  }

  /**
   * Envia botão para voltar ao menu
   */
  async sendVoltarMenu(number) {
    const menuButton = {
      type: 'button',
      text: 'Deseja voltar ao menu principal?',
      footerText: 'ZC NET',
      choices: [
        'Voltar ao Menu|menu'
      ],
      readchat: false,
      readmessages: false
    };

    try {
      const result = await this.uazapi.sendMenu(number, menuButton);
      // Marca o chat como não lido após enviar o menu
      await this.uazapi.setChatRead(number, false);
      return result;
    } catch (error) {
      // Fallback: apenas texto
      await this.uazapi.sendText(number, '\n💡 Digite *MENU* para voltar ao menu principal.', { readchat: false, readmessages: false });
      await this.uazapi.setChatRead(number, false);
    }
  }

  /**
   * Handler para Pagamento - Solicita CPF
   */
  async handleFatura(number, message) {
    if (!this.ispbox) {
      await this.sendTextUnread(number, '❌ Serviço de pagamento temporariamente indisponível.');
      return await this.sendVoltarMenu(number);
    }

    // Remove flag de CPF não encontrado se existir (permite tentar novamente)
    this.cpfNaoEncontrado.delete(number);
    
    // Inicia fluxo de pagamento solicitando CPF com flags de controle de erro
    this.pagamentoState.set(number, { 
      etapa: 'cpf',
      erroCpfFormato: false,
      erroCpfNaoEncontrado: false,
      ultimoCpfTentado: null
    });
    
    const response = `Me informe seu CPF para consultar o pagamento.

Digite apenas os números do CPF (11 dígitos):`;

    await this.sendTextUnread(number, response);
  }

  /**
   * Processa CPF informado e busca cliente
   */
  async processarCpfPagamento(number, cpf) {
    try {
      if (!this.ispbox) {
        await this.sendTextUnread(number, '❌ Serviço de pagamento temporariamente indisponível.');
        this.pagamentoState.delete(number);
        return await this.sendVoltarMenu(number);
      }

      const state = this.pagamentoState.get(number);
      if (!state) {
        return; // Estado foi removido, não processa
      }

      await this.sendTextUnread(number, '🔍 Consultando informações...');

      const cliente = await this.ispbox.buscarClientePorCpf(cpf);
      
      // REGRA 4: CPF válido mas não encontrado → responder apenas UMA vez "CPF não encontrado"
      if (!cliente) {
        // Marca flag de erro e atualiza estado
        state.erroCpfNaoEncontrado = true;
        state.erroCpfFormato = false; // Reset erro de formato
        this.pagamentoState.set(number, state);
        
        // REGRA 5: Nunca repetir mensagens de erro (usar flags/lock no estado)
        // Só envia mensagem se ainda não foi enviada para este CPF
        if (!this.cpfNaoEncontrado.has(number) || this.cpfNaoEncontrado.get(number) !== cpf) {
          await this.sendTextUnread(number, '❌ Cliente não encontrado com este CPF.\n\nPor favor, verifique o CPF informado ou entre em contato com nosso atendimento.');
          this.cpfNaoEncontrado.set(number, cpf); // Armazena o CPF que não foi encontrado
        }
        // Mantém o estado para permitir que cliente tente outro CPF (REGRA 6)
        return await this.sendVoltarMenu(number);
      }
      
      // REGRA 8: Ao encontrar CPF válido e existente, avançar o fluxo normalmente
      // Se encontrou o cliente, reseta todas as flags de erro
      state.erroCpfFormato = false;
      state.erroCpfNaoEncontrado = false;
      this.cpfNaoEncontrado.delete(number);


      // Busca serviços do cliente
      const servicos = await this.ispbox.listarServicos(cliente.id);
      
      
      if (!servicos || servicos.length === 0) {
        await this.sendTextUnread(number, '❌ Nenhum serviço encontrado para este cliente.');
        this.pagamentoState.delete(number);
        return await this.sendVoltarMenu(number);
      }

      // Usa o primeiro serviço (geralmente Internet)
      const servico = servicos[0];
      // Pega o tipo do serviço (INTERNET, TELEFONE, etc)
      const tipoServico = servico.tipoServico || servico.tipo || 'INTERNET';

      // Busca cobranças pendentes
      const cobrancas = await this.ispbox.listarCobrancas(cliente.id, servico.id);
      
      // Filtra apenas cobranças NÃO PAGAS
      // Critério único: dataPagamento === null (se for null, não foi paga)
      const cobrancasPendentes = cobrancas.filter(c => {
        if (!c || !c.id) {
          return false; // Ignora cobranças inválidas
        }

        // Verifica campo dataPagamento (pode vir em diferentes formatos)
        const dataPagamento = c.dataPagamento || c.data_pagamento;
        
        // Se dataPagamento for null/undefined/vazio, a cobrança NÃO foi paga (inclui na lista)
        // Se dataPagamento tiver valor, a cobrança FOI paga (exclui da lista)
        if (dataPagamento !== null && dataPagamento !== undefined && dataPagamento !== '') {
          return false; // Tem data de pagamento, está pago (exclui)
        }

        // Se dataPagamento é null/undefined/vazio, não foi paga (inclui)
        return true;
      });
      
      if (cobrancasPendentes.length === 0) {
        await this.sendTextUnread(number, '✅ Nenhuma cobrança pendente encontrada.\n\nVocê está em dia! 🎉');
        this.pagamentoState.delete(number);
        return await this.sendVoltarMenu(number);
      }

      // Ordena cobranças pendentes por data de vencimento (mais antigas primeiro)
      cobrancasPendentes.sort((a, b) => {
        const dataVencA = a.dataVencimento || a.data_vencimento || a.vencimento;
        const dataVencB = b.dataVencimento || b.data_vencimento || b.vencimento;
        
        // Se uma não tem data, coloca no final
        if (!dataVencA && !dataVencB) return 0;
        if (!dataVencA) return 1;
        if (!dataVencB) return -1;
        
        // Converte para Date e compara
        const dateA = new Date(dataVencA);
        const dateB = new Date(dataVencB);
        
        return dateA.getTime() - dateB.getTime(); // Ordem crescente (mais antiga primeiro)
      });

      // Salva estado e mostra cobranças (inclui nome do cliente e tipo do serviço no estado)
      const nomeCliente = cliente.nome || cliente.razaoSocial || 'Cliente';
      this.pagamentoState.set(number, {
        etapa: 'cobranca',
        clienteId: cliente.id,
        servicosId: servico.id,
        tipoServico: tipoServico,
        cpf: cpf,
        nomeCliente: nomeCliente,
        cobrancas: cobrancasPendentes
      });

      // Mostra cobranças disponíveis com nome do cliente
      let mensagem = `💰 *Cobranças Pendentes*\n\n`;
      mensagem += `👤 *Cliente:* ${nomeCliente}\n\n`;
      
      cobrancasPendentes.forEach((cob, index) => {
        // Pega data de vencimento (pode vir em diferentes formatos)
        const dataVencimento = cob.dataVencimento || cob.data_vencimento || cob.vencimento;
        const vencimento = dataVencimento 
          ? new Date(dataVencimento).toLocaleDateString('pt-BR')
          : 'Não informado';
        
        // Tenta criar descrição melhor usando tipo e referenciaMensalidade
        let descricao = cob.descricao || cob.descricaoServico;
        
        // Se não tem descricao, tenta criar a partir de tipo e referenciaMensalidade
        if (!descricao || descricao === 'N/A') {
          const tipo = cob.tipo || '';
          const referenciaMensalidade = cob.referenciaMensalidade;
          
          if (referenciaMensalidade) {
            // Formata a data de referência para exibir o mês/ano
            try {
              const dataRef = new Date(referenciaMensalidade);
              const mesAno = dataRef.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
              descricao = tipo ? `${tipo} - ${mesAno.charAt(0).toUpperCase() + mesAno.slice(1)}` : `Mensalidade - ${mesAno.charAt(0).toUpperCase() + mesAno.slice(1)}`;
            } catch (e) {
              descricao = tipo || 'Mensalidade';
            }
          } else {
            descricao = tipo || 'Cobrança';
          }
        }
        
        const valor = parseFloat(cob.valor || 0).toFixed(2).replace('.', ',');
        
        mensagem += `*${index + 1}.* ${descricao}\n`;
        mensagem += `   💵 R$ ${valor}\n`;
        mensagem += `   Vencimento: ${vencimento}\n\n`;
      });

      mensagem += `Escolha uma opção para pagar:`;

      const menuData = {
        type: 'button',
        text: mensagem,
        footerText: 'ZC NET',
        choices: []
      };

      // Adiciona opções de cobranças (máximo 3 primeiras) com data de vencimento
      const cobrancasParaMenu = cobrancasPendentes.slice(0, 3);
      cobrancasParaMenu.forEach((cob, index) => {
        const valorFormatado = parseFloat(cob.valor).toFixed(2).replace('.', ',');
        const dataVencimento = cob.dataVencimento || cob.data_vencimento || cob.vencimento;
        const vencimento = dataVencimento 
          ? new Date(dataVencimento).toLocaleDateString('pt-BR')
          : 'Data não informada';
        
        menuData.choices.push(`R$ ${valorFormatado} - Venc: ${vencimento}|cobranca_${index}`);
      });

      menuData.choices.push('Voltar ao Menu|menu');
      menuData.readchat = false;
      menuData.readmessages = false;

      try {
        const result = await this.uazapi.sendMenu(number, menuData);
        await this.uazapi.setChatRead(number, false);
        return result;
      } catch (error) {
        // Fallback para texto
        let texto = mensagem + '\n\n';
        cobrancasParaMenu.forEach((cob, index) => {
          const valorFormatado = parseFloat(cob.valor).toFixed(2).replace('.', ',');
          const dataVencimento = cob.dataVencimento || cob.data_vencimento || cob.vencimento;
          const vencimento = dataVencimento 
            ? new Date(dataVencimento).toLocaleDateString('pt-BR')
            : 'Data não informada';
          texto += `*${index + 1}* - Pagar R$ ${valorFormatado} - Venc: ${vencimento}\n`;
        });
        texto += `*0* - Voltar ao Menu`;
        
        await this.sendTextUnread(number, texto);
        return await this.sendVoltarMenu(number);
      }

    } catch (error) {
      await this.sendTextUnread(number, '❌ Erro ao consultar pagamentos. Por favor, tente novamente mais tarde.');
      this.pagamentoState.delete(number);
      return await this.sendVoltarMenu(number);
    }
  }

  /**
   * Processa escolha de cobrança e mostra opções de pagamento
   */
  async processarEscolhaCobranca(number, text) {
    const state = this.pagamentoState.get(number);
    if (!state || !state.cobrancas) {
      this.pagamentoState.delete(number);
      return await this.handleFatura(number, '');
    }

    // Extrai índice da cobrança
    let cobrancaIndex = -1;
    if (text.startsWith('cobranca_')) {
      cobrancaIndex = parseInt(text.replace('cobranca_', ''));
    } else if (text.match(/^\d+$/)) {
      cobrancaIndex = parseInt(text) - 1;
    }

    if (cobrancaIndex < 0 || cobrancaIndex >= state.cobrancas.length) {
      await this.sendTextUnread(number, '❌ Opção inválida. Por favor, escolha uma das opções disponíveis.');
      return;
    }

    const cobranca = state.cobrancas[cobrancaIndex];
    
    // Atualiza o estado mantendo todos os dados anteriores
    state.cobrancaId = cobranca.id;
    state.etapa = 'pagamento';
    
    // Atualiza o estado no Map explicitamente
    this.pagamentoState.set(number, state);

    // Busca formas de pagamento disponíveis
    try {
      const tipoServico = state.tipoServico || 'INTERNET';
      const formasPagamento = await this.ispbox.listarFormasPagamento(state.clienteId, state.servicosId, tipoServico);
      
      const valorFormatado = parseFloat(cobranca.valor).toFixed(2).replace('.', ',');
      // Pega data de vencimento (pode vir em diferentes formatos)
      const dataVencimento = cobranca.dataVencimento || cobranca.data_vencimento || cobranca.vencimento;
      const vencimento = dataVencimento 
        ? new Date(dataVencimento).toLocaleDateString('pt-BR')
        : 'Data não informada';
      
      const nomeCliente = state.nomeCliente || 'Cliente';

      let mensagem = `*Pagamento*\n\n`;
      mensagem += `👤 *Cliente:* ${nomeCliente}\n`;
      mensagem += `*Cobrança:* ${cobranca.descricao || cobranca.descricaoServico || 'Cobrança'}\n`;
      mensagem += `*Valor:* R$ ${valorFormatado}\n`;
      mensagem += `*Vencimento:* ${vencimento}\n\n`;
      mensagem += `Escolha a forma de pagamento:`;

      const menuData = {
        type: 'button',
        text: mensagem,
        footerText: 'ZC NET',
        choices: []
      };

      // Adiciona opções de pagamento baseado nas formas disponíveis
      // Garante que formasPagamento é um array
      const formasArray = Array.isArray(formasPagamento) ? formasPagamento : [];
      
      // Verifica se tem PIX (pode vir como string ou objeto)
      const temPix = formasArray.includes('PIX') || 
                     formasArray.includes('pix') ||
                     formasArray.some(f => {
                       if (typeof f === 'string') return f.toUpperCase().includes('PIX');
                       if (typeof f === 'object' && f !== null) {
                         return (f.tipo || f.nome || f.forma || '').toUpperCase().includes('PIX');
                       }
                       return false;
                     });
      
      // Verifica se tem BOLETO (pode vir como string ou objeto)
      const temBoleto = formasArray.includes('BOLETO') || 
                        formasArray.includes('boleto') ||
                        formasArray.some(f => {
                          if (typeof f === 'string') return f.toUpperCase().includes('BOLETO');
                          if (typeof f === 'object' && f !== null) {
                            return (f.tipo || f.nome || f.forma || '').toUpperCase().includes('BOLETO');
                          }
                          return false;
                        });
      
      if (temPix) {
        menuData.choices.push('Pagar com PIX|pix');
      }
      if (temBoleto) {
        menuData.choices.push('📄 Gerar Boleto|boleto');
      }
      
      // Se não encontrou nenhuma forma, oferece pelo menos PIX e BOLETO como padrão
      if (!temPix && !temBoleto) {
        menuData.choices.push('Pagar com PIX|pix');
        menuData.choices.push('📄 Gerar Boleto|boleto');
      }
      
      menuData.choices.push('Voltar ao Menu|menu');
      menuData.readchat = false;
      menuData.readmessages = false;

      try {
        const result = await this.uazapi.sendMenu(number, menuData);
        await this.uazapi.setChatRead(number, false);
        return result;
      } catch (error) {
        // Fallback
        let texto = mensagem + '\n\n';
        texto += `*1* - Pagar com PIX\n`;
        texto += `*2* - 📄 Gerar Boleto\n`;
        texto += `*0* - Voltar ao Menu`;
        await this.sendTextUnread(number, texto);
        return await this.sendVoltarMenu(number);
      }

    } catch (error) {
      await this.sendTextUnread(number, '❌ Erro ao carregar formas de pagamento.');
      this.pagamentoState.delete(number);
      return await this.sendVoltarMenu(number);
    }
  }

  /**
   * Processa pagamento PIX
   */
  async processarPagamentoPix(number) {
    const state = this.pagamentoState.get(number);
    
    // Verifica se tem estado válido com clienteId e servicosId
    if (!state || !state.clienteId || !state.servicosId) {
      this.pagamentoState.delete(number);
      return await this.handleFatura(number, '');
    }

    // Se não tem cobrancaId mas tem cobranças disponíveis, verifica se pode usar a primeira
    if (!state.cobrancaId && state.cobrancas && state.cobrancas.length > 0) {
      // Se tem apenas uma cobrança, usa ela automaticamente
      if (state.cobrancas.length === 1) {
        state.cobrancaId = state.cobrancas[0].id;
      } else {
        // Se tem múltiplas cobranças, precisa escolher uma - mostra menu de cobranças
        let mensagem = `💰 *Escolha uma cobrança para pagar com PIX*\n\n`;
        mensagem += `👤 *Cliente:* ${state.nomeCliente || 'Cliente'}\n\n`;
        
        state.cobrancas.forEach((cob, index) => {
          const dataVencimento = cob.dataVencimento || cob.data_vencimento || cob.vencimento;
          const vencimento = dataVencimento 
            ? new Date(dataVencimento).toLocaleDateString('pt-BR')
            : 'Não informado';
          const descricao = cob.descricao || cob.descricaoServico || 'Cobrança';
          const valor = parseFloat(cob.valor || 0).toFixed(2).replace('.', ',');
          
          mensagem += `*${index + 1}.* ${descricao}\n`;
          mensagem += `   💵 R$ ${valor}\n`;
          mensagem += `   Vencimento: ${vencimento}\n\n`;
        });
        
        mensagem += `Escolha uma opção:`;
        
        const menuData = {
          type: 'button',
          text: mensagem,
          footerText: 'ZC NET',
          choices: []
        };
        
        // Adiciona opções de cobranças (máximo 3 primeiras)
        const cobrancasParaMenu = state.cobrancas.slice(0, 3);
        cobrancasParaMenu.forEach((cob, index) => {
          const valorFormatado = parseFloat(cob.valor).toFixed(2).replace('.', ',');
          const dataVencimento = cob.dataVencimento || cob.data_vencimento || cob.vencimento;
          const vencimento = dataVencimento 
            ? new Date(dataVencimento).toLocaleDateString('pt-BR')
            : 'Data não informada';
          
          menuData.choices.push(`R$ ${valorFormatado} - Venc: ${vencimento}|cobranca_${index}`);
        });
        
        menuData.choices.push('Voltar ao Menu|menu');
        
        await this.sendMenuUnread(number, menuData);
        return;
      }
    }

    // Se ainda não tem cobrancaId após tentar resolver, mostra mensagem
    if (!state.cobrancaId) {
      await this.sendTextUnread(number, '⚠️ Nenhuma cobrança disponível para gerar o PIX.');
      this.pagamentoState.delete(number);
      return await this.sendVoltarMenu(number);
    }

    try {
      await this.sendTextUnread(number, '⏳ Gerando o PIX...');

      const qrcode = await this.ispbox.gerarQrcodePix(state.clienteId, state.servicosId, state.cobrancaId);
      
      if (!qrcode) {
        await this.sendTextUnread(number, '❌ Erro ao gerar QR Code PIX. Tente novamente mais tarde.');
        this.pagamentoState.delete(number);
        return await this.sendVoltarMenu(number);
      }

      const valorFormatado = parseFloat(state.cobrancas.find(c => c.id === state.cobrancaId).valor).toFixed(2).replace('.', ',');

      // PRIMEIRO: Processa e extrai o payload completo do PIX
      let qrCodeResult = null;
      try {
        qrCodeResult = await this.garantirQRCodePIX(qrcode);
      } catch (qrCodeError) {
        await this.sendTextUnread(number, '❌ Erro ao processar QR Code PIX. Tente novamente.');
        this.pagamentoState.delete(number);
        return await this.sendVoltarMenu(number);
      }

      // O payload completo é o código PIX para copiar e colar
      const pixPayload = qrCodeResult?.payload || qrcode.payload || '';

      if (!pixPayload || pixPayload.length < 50) {
        await this.sendTextUnread(number, '❌ Erro: Código PIX não encontrado ou inválido. Tente novamente.');
        this.pagamentoState.delete(number);
        return await this.sendVoltarMenu(number);
      }

      // NO PIX: Envia QR code como imagem, depois instruções e depois o payload sozinho
      if (qrCodeResult?.base64) {
        try {
          // Caption mais curta para o QR code
          const caption = `*PIX Gerado com Sucesso!*\n\n💰 *Valor:* R$ ${valorFormatado}\n\n📱 *Escaneie o QR code acima para efetuar o pagamento*`;
          
          // 1. Envia QR code como imagem
          await this.uazapi.sendMedia(number, 'image', qrCodeResult.base64, caption);
          
          // 2. Envia instrução sozinha
          await this.sendTextUnread(number, '👇 *Copie e cole, vá na opção do banco lá "copia e cola" e faz o pagamento na hora*');
          
          // 3. Envia o payload COMPLETO sozinho em uma mensagem separada
          await this.sendTextUnread(number, pixPayload);
          
          // 4. Envia mensagem final sozinha
          await this.sendTextUnread(number, '✅ Após o pagamento sua rede será liberada automaticamente\n\n🔧 Caso não volte a conexão, reinicie os equipamentos');
          
          this.pagamentoState.delete(number);
          return await this.sendVoltarMenu(number);
        } catch (imageError) {
          await this.sendTextUnread(number, '❌ Erro ao enviar QR code PIX. Por favor, tente novamente.');
          this.pagamentoState.delete(number);
          return await this.sendVoltarMenu(number);
        }
      } else {
        await this.sendTextUnread(number, '❌ Erro: QR code PIX não disponível. Por favor, tente novamente.');
        this.pagamentoState.delete(number);
        return await this.sendVoltarMenu(number);
      }
      this.pagamentoState.delete(number);
      return await this.sendVoltarMenu(number);

    } catch (error) {
      await this.sendTextUnread(number, '❌ Erro ao gerar QR Code PIX. Por favor, tente novamente.');
      this.pagamentoState.delete(number);
      return await this.sendVoltarMenu(number);
    }
  }

  /**
   * Processa geração de boleto
   */
  async processarBoleto(number) {
    const state = this.pagamentoState.get(number);
    
    // Verifica se tem estado válido
    if (!state) {
      return await this.handleFatura(number, '');
    }

    // Se não tem cobrancaId, mas está na etapa 'cobranca', precisa escolher uma cobrança primeiro
    if (!state.cobrancaId && state.etapa === 'cobranca') {
      await this.sendTextUnread(number, '❌ Por favor, escolha uma cobrança para gerar o boleto.');
      return;
    }

    // Se não tem cobrancaId e não está na etapa correta, volta para início
    if (!state.cobrancaId) {
      this.pagamentoState.delete(number);
      return await this.handleFatura(number, '');
    }

    // Verifica se tem dados necessários
    if (!state.clienteId || !state.servicosId) {
      this.pagamentoState.delete(number);
      return await this.handleFatura(number, '');
    }

    try {
      await this.sendTextUnread(number, '⏳ Gerando boleto e PIX...');

      // Gera PDF do boleto
      const pdf = await this.ispbox.gerarPdfBoleto(state.clienteId, state.servicosId, state.cobrancaId);
      
      if (!pdf) {
        await this.sendTextUnread(number, '❌ Erro ao gerar boleto. Tente novamente mais tarde.');
        this.pagamentoState.delete(number);
        return await this.sendVoltarMenu(number);
      }

      // Gera QR code PIX
      const qrCodeData = await this.ispbox.gerarQrcodePix(state.clienteId, state.servicosId, state.cobrancaId);
      
      if (!qrCodeData) {
        await this.sendTextUnread(number, '❌ Erro ao gerar QR code. Tente novamente mais tarde.');
        this.pagamentoState.delete(number);
        return await this.sendVoltarMenu(number);
      }

      // Encontra a cobrança selecionada para pegar o valor
      const cobranca = state.cobrancas?.find(c => c.id === state.cobrancaId);
      const valorFormatado = cobranca 
        ? parseFloat(cobranca.valor || 0).toFixed(2).replace('.', ',')
        : '0,00';

      // Gera ou obtém QR code em base64 usando função garantida
      let qrCodeResult = null;
      try {
        qrCodeResult = await this.garantirQRCodePIX(qrCodeData);
      } catch (qrCodeError) {
        await this.sendTextUnread(number, '❌ Erro ao gerar QR code. Tente novamente mais tarde.');
        this.pagamentoState.delete(number);
        return await this.sendVoltarMenu(number);
      }

      // NO BOLETO: Envia APENAS o PDF do boleto como documento (SEM QR code)
      try {
        // Envia o PDF do boleto como documento (SEM caption/mensagem)
        let pdfBase64 = null;
        
        // Verifica diferentes formatos de retorno do PDF
        if (typeof pdf === 'string') {
          // Se retornar direto como string base64
          pdfBase64 = pdf;
        } else if (pdf && pdf.base64) {
          pdfBase64 = pdf.base64;
        } else if (pdf && pdf.pdf) {
          pdfBase64 = pdf.pdf;
        } else if (pdf && pdf.data) {
          pdfBase64 = pdf.data;
        }
        
        if (pdfBase64) {
          const pdfDataUri = pdfBase64.startsWith('data:') 
            ? pdfBase64 
            : `data:application/pdf;base64,${pdfBase64}`;
          
          // Envia PDF SEM caption (vazio)
          await this.uazapi.sendMedia(
            number,
            'document',
            pdfDataUri,
            '',
            { docName: `boleto_${state.cobrancaId}.pdf` }
          );
        } else if (pdf && pdf.url) {
          // Envia PDF SEM caption (vazio)
          await this.uazapi.sendMedia(
            number,
            'document',
            pdf.url,
            '',
            { docName: `boleto_${state.cobrancaId}.pdf` }
          );
        } else {
          await this.sendTextUnread(number, '❌ Erro: PDF do boleto não disponível. Por favor, tente novamente.');
          this.pagamentoState.delete(number);
          return await this.sendVoltarMenu(number);
        }

        // Envia mensagem separada após o PDF
        const mensagem = `📄 *Boleto Gerado!*

💰 *Valor:* R$ ${valorFormatado}

✅ Após o pagamento sua rede será liberada automaticamente

🔧 Caso não volte a conexão, reinicie os equipamentos`;

        await this.sendTextUnread(number, mensagem);

        this.pagamentoState.delete(number);
        return await this.sendVoltarMenu(number);
      } catch (error) {
        await this.sendTextUnread(number, '❌ Erro ao enviar boleto. Por favor, tente novamente.');
        this.pagamentoState.delete(number);
        return await this.sendVoltarMenu(number);
      }
      
      this.pagamentoState.delete(number);
      return await this.sendVoltarMenu(number);

    } catch (error) {
      await this.sendTextUnread(number, '❌ Erro ao gerar boleto. Por favor, tente novamente.');
      // Não deleta o estado em caso de erro, para permitir tentar novamente
      return await this.sendVoltarMenu(number);
    }
  }

  /**
   * Resposta para comando desconhecido
   */
  async sendUnknownCommand(number) {
    const response = `❓ Não entendi o comando. 

Digite *MENU* ou *OI* para ver as opções disponíveis.`;

    await this.sendTextUnread(number, response);
    // Envia botão para voltar ao menu
    return await this.sendVoltarMenu(number);
  }
}


