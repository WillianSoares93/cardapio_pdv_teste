// api/criar-pedido.js
// --- IMPORTS (usando ES Module syntax) ---
import { initializeApp, cert, getApps, getApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import path from 'path'; // Usando import padrão para path
import { fileURLToPath } from 'url'; // Necessário para __dirname em ESM
import { dirname } from 'path'; // Necessário para __dirname em ESM

// --- CONFIGURAÇÃO DE LOGS ---
const log = (message, ...args) => console.log(`[LOG ${new Date().toISOString()}] ${message}`, args.length > 0 ? args : '');
const errorLog = (message, error, ...args) => console.error(`[ERROR ${new Date().toISOString()}] ${message}`, error instanceof Error ? error.message : error, args.length > 0 ? args : '');

// Obter __dirname em ambiente ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// --- INICIALIZAÇÃO FIREBASE ADMIN SDK ---
let serviceAccountJson; // Variável para guardar o JSON decodificado
let firebaseInitialized = false;
let initializationError = null;

log("Verificando inicialização do Firebase Admin SDK...");

if (getApps().length === 0) {
    log("Nenhuma app Firebase Admin encontrada. Tentando carregar credenciais...");
    try {
        log("Tentando carregar credenciais da variável de ambiente GOOGLE_CREDENTIALS_BASE64...");
        const credentialsBase64 = process.env.GOOGLE_CREDENTIALS_BASE64;

        if (!credentialsBase64) {
            throw new Error("Variável de ambiente GOOGLE_CREDENTIALS_BASE64 está ausente.");
        }

        // Decodificar Base64 para String JSON
        const credentialsJsonString = Buffer.from(credentialsBase64, 'base64').toString('utf-8');
        log("Variável GOOGLE_CREDENTIALS_BASE64 decodificada.");

        // Parsear a String JSON para um objeto
        serviceAccountJson = JSON.parse(credentialsJsonString);

        // Validar campos essenciais no JSON
        if (!serviceAccountJson.project_id || !serviceAccountJson.client_email || !serviceAccountJson.private_key) {
             throw new Error("JSON decodificado de GOOGLE_CREDENTIALS_BASE64 não contém campos essenciais (project_id, client_email, private_key).");
        }
        log("Credenciais parseadas com sucesso a partir de GOOGLE_CREDENTIALS_BASE64.");

    } catch (envError) {
        errorLog("Erro ao carregar ou processar GOOGLE_CREDENTIALS_BASE64. Verifique se a variável está definida e contém um JSON válido em Base64.", envError);
        initializationError = `Falha ao carregar/processar credenciais Base64: ${envError.message}`;
        serviceAccountJson = null;
    }

    // Inicializar Firebase Admin SDK se o JSON foi carregado e parseado
    if (serviceAccountJson) {
        try {
            log("Inicializando Firebase Admin SDK com credenciais decodificadas...");
             // A chave privada já deve estar correta após o parse do JSON
             // Não precisa mais do .replace(/\\n/g, '\n') aqui se o JSON original estiver correto
            initializeApp({
                credential: cert(serviceAccountJson)
            });
            firebaseInitialized = true;
            log("Firebase Admin SDK inicializado com sucesso.");
        } catch (initError) {
            errorLog('Falha na inicialização do Firebase Admin SDK:', initError);
            initializationError = `Falha na inicialização do Firebase: ${initError.message}`;
            firebaseInitialized = false;
        }
    } else if (!initializationError) {
        initializationError = "Credenciais Firebase Admin não encontradas ou inválidas (Base64).";
        errorLog(initializationError);
    }
} else {
    log("Firebase Admin SDK já estava inicializado.");
    const defaultApp = getApp();
    if (defaultApp && defaultApp.name) {
        firebaseInitialized = true;
    } else {
        errorLog("SDK reportado como inicializado, mas a app padrão parece inválida.");
        initializationError = "Estado de inicialização Firebase inválido.";
        firebaseInitialized = false;
    }
}
// --- FIM DA INICIALIZAÇÃO ---

// --- FUNÇÕES HELPER (ATUALIZADAS COM MAIS VERIFICAÇÕES E LOGS) ---
const createSubItemString = (subItems) => {
  // Verifica se subItems é realmente um array
  if (!Array.isArray(subItems)) {
      log('createSubItemString recebeu algo que não é array:', subItems); // Log do input inválido
      // Retorna uma string vazia ou um placeholder para evitar erro
      return ''; // Ou talvez 'invalid_subitems' se preferir identificar no hash
  }
  // Se for array vazio, retorna string vazia (comportamento anterior mantido)
  if (subItems.length === 0) {
      return '';
  }

  try {
      return subItems
        // Garante estrutura mínima e converte para string ANTES de ordenar
        .map(si => ({
            name: String(si?.name || ''), // Garante que name é string
            quantity: si?.quantity || 1,
            price: si?.price || 0,
            placement: String(si?.placement || '') // Garante que placement é string
        }))
        // Ordena por nome
        .sort((a, b) => a.name.localeCompare(b.name))
        // Cria string para cada subitem
        .map(si => `${si.name}:${si.quantity}:${si.price}:${si.placement}`)
        .join(','); // Junta com vírgula
  } catch (err) {
      errorLog('Erro dentro de createSubItemString ao processar subItems:', err, { subItems });
      return 'error_processing_subitems'; // Retorna string indicando erro
  }
};

// --- FUNÇÃO HELPER createOrderHash (ATUALIZADA) ---
const createOrderHash = (items) => {
  if (!Array.isArray(items)) {
      log('createOrderHash recebeu algo que não é array:', items);
      return '';
  }
   if (items.length === 0) {
       return '';
   }

   try {
      return items
        .map(item => {
          if (typeof item !== 'object' || item === null) {
              log('createOrderHash encontrou um item inválido no array:', item);
              return 'invalid_item';
          }
          const name = String(item.name || '');
          const slices = item.selected_slices || '';
          const price = item.price || 0;
          // MODIFICAÇÃO AQUI: Garante que um array vazio seja passado se a propriedade não existir
          const ingredientsString = createSubItemString(item.ingredients || []);
          const extrasString = createSubItemString(item.extras || []);
          // --- FIM DA MODIFICAÇÃO ---
          return `${name}|${slices}|${price}|${ingredientsString}|${extrasString}`;
        })
        .sort((a, b) => a.localeCompare(b))
        .join(';');
   } catch (err) {
       errorLog('Erro dentro de createOrderHash ao processar items:', err, { items });
       return 'error_processing_items';
   }
};
// --- FIM FUNÇÃO HELPER createOrderHash ATUALIZADA ---

function generateOrderId() {
    const now = new Date();
    // Ajuste para garantir que a data/hora esteja correta, considerando UTC-3
    const datePart = now.getFullYear().toString().slice(-2) +
                     (now.getMonth() + 1).toString().padStart(2, '0') +
                     now.getDate().toString().padStart(2, '0');
    const timePart = now.getHours().toString().padStart(2, '0') +
                     now.getMinutes().toString().padStart(2, '0');
    const randomPart = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `${datePart}-${timePart}-${randomPart}`;
}
// --- FIM FUNÇÕES HELPER ---


// --- HANDLER PRINCIPAL DA API (usando export default) ---
export default async function handler(req, res) {
    log(`--- Requisição recebida para /api/criar-pedido em ${new Date().toISOString()} ---`);
    if (req.method !== 'POST') {
        log(`Método não permitido: ${req.method}`);
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    if (!firebaseInitialized) {
        errorLog("API /criar-pedido: Firebase Admin SDK NÃO INICIALIZADO. Abortando requisição.", initializationError || "Erro desconhecido na inicialização.");
        return res.status(503).json({ message: 'Erro interno: Serviço de banco de dados indisponível.', details: initializationError });
    }

    let db;
    try {
        db = getFirestore();
        log("Instância do Firestore obtida com sucesso.");
    } catch (dbError) {
        errorLog("CRÍTICO: Erro ao obter instância do Firestore:", dbError);
        return res.status(503).json({ message: 'Erro interno: Falha ao conectar ao banco de dados.', details: dbError.message });
    }

    try {
        const { order, selectedAddress, total, paymentMethod, whatsappNumber, observation } = req.body;
        log("Corpo da requisição parseado com sucesso.");

        // Validação básica dos dados recebidos
        if (!order || !Array.isArray(order) || order.length === 0 || !selectedAddress || !total || !paymentMethod || !whatsappNumber) {
            log("Dados incompletos ou inválidos recebidos.");
            return res.status(400).json({ message: 'Dados do pedido incompletos ou inválidos.' });
        }
        log("Validação inicial dos dados passou.");

        // --- Verificação de Duplicidade ---
        log("Iniciando verificação de duplicidade...");
        const customerName = selectedAddress.clientName?.trim() || 'Nome não informado';
        const customerPhone = selectedAddress.telefone?.trim() || ''; // Usar telefone do selectedAddress
        const isPickup = selectedAddress.rua === 'Retirada no Balcão'; // Verificar se é retirada
        const orderHash = createOrderHash(order);

        // Validação do hash
        if (!orderHash || orderHash === 'error_processing_items' || orderHash.includes('invalid_item')) {
            errorLog("Falha ao gerar o hash do pedido para verificação de duplicidade ou hash inválido.", { order, generatedHash: orderHash });
            return res.status(500).json({ message: 'Erro interno ao processar itens do pedido (hash inválido).' });
        }
        log(`Hash do pedido gerado (prefixo): ${orderHash.substring(0, 50)}...`);

        // Verifica duplicidade nos últimos 3 minutos (ajustado para 3 minutos conforme exemplo anterior, poderia ser maior)
        const checkTimeframe = Timestamp.fromDate(new Date(Date.now() - 3 * 60 * 1000));
        log(`Janela de tempo para duplicidade inicia em: ${checkTimeframe.toDate().toISOString()}`);

        // Query baseada nos campos principais e no hash
        let duplicateQuery = db.collection('pedidos')
            .where('endereco.clientName', '==', customerName) // Usar campo aninhado
            .where('orderHash', '==', orderHash)
            .where('criadoEm', '>=', checkTimeframe); // Usar criadoEm

        if (customerPhone) {
            duplicateQuery = duplicateQuery.where('endereco.telefone', '==', customerPhone); // Usar campo aninhado
        }

        if (!isPickup) {
            duplicateQuery = duplicateQuery
                .where('endereco.bairro', '==', selectedAddress.bairro || null)
                .where('endereco.rua', '==', selectedAddress.rua || null)
                .where('endereco.numero', '==', selectedAddress.numero || null);
        } else {
            // Se for retirada, verificar o campo específico
            duplicateQuery = duplicateQuery.where('endereco.rua', '==', 'Retirada no Balcão');
        }

        log("Executando query de verificação de duplicidade...");
        const duplicateSnapshot = await duplicateQuery.limit(1).get();

        if (!duplicateSnapshot.empty) {
            log(`DUPLICIDADE de pedido detectada.`);
            return res.status(200).json({ duplicateFound: true });
        }
        log("Nenhum pedido duplicado encontrado.");
        // --- Fim Verificação de Duplicidade ---

        // --- Processamento Normal ---
        const orderId = generateOrderId();
        const timestamp = Timestamp.now();
        log(`ID do Pedido Gerado: ${orderId}`);

        // --- Montagem da Mensagem WhatsApp (Mantida como antes) ---
        let orderMessage = `*Novo Pedido Sâmia (ID: ${orderId.substring(0,5).toUpperCase()})*\n\n`; // Usa parte do ID gerado
        orderMessage += `*Cliente:* ${customerName}\n`;
        if (customerPhone) { orderMessage += `*Contato:* ${customerPhone}\n`; } // Adiciona telefone se existir
        if (isPickup) { orderMessage += `*Entrega:* Retirada no Balcão\n`; }
        else {
            orderMessage += `*Endereço:* ${selectedAddress.rua || 'Rua não informada'}, Nº ${selectedAddress.numero || 'S/N'}, ${selectedAddress.bairro || 'Bairro não informado'}\n`;
            if (selectedAddress.referencia) { orderMessage += `*Referência:* ${selectedAddress.referencia}\n`; }
            // Usa deliveryFee do objeto total, garantindo que seja número
            orderMessage += `*Taxa de Entrega:* R$ ${Number(total.deliveryFee || 0).toFixed(2).replace('.', ',')}\n`;
        }
        orderMessage += "\n*Itens do Pedido:*\n";
        order.forEach(item => {
            // Formata nome e preço do item principal
            orderMessage += `- ${item.quantity || 1}x ${item.name} (R$ ${Number(item.price || 0).toFixed(2).replace('.', ',')})\n`;
             // Adiciona ingredientes de hambúrguer personalizado
             if (item.ingredients && item.ingredients.length > 0) {
                 item.ingredients.forEach(ing => {
                    const quantityText = (ing.quantity && ing.quantity > 1) ? ` (x${ing.quantity})` : '';
                    orderMessage += `  * ${ing.name}${quantityText}\n`;
                 });
            }
            // Adiciona extras de pizza
             if (item.extras && item.extras.length > 0) {
                 item.extras.forEach(ext => {
                    const quantityText = (ext.quantity && ext.quantity > 1) ? ` (x${ext.quantity})` : '';
                    orderMessage += `  + ${ext.name}${quantityText} (${ext.placement})\n`;
                 });
            }
        });
        // Adiciona totais e pagamento
        orderMessage += `\n*Subtotal:* R$ ${Number(total.subtotal || 0).toFixed(2).replace('.', ',')}\n`;
        if (total.discount > 0) { orderMessage += `*Desconto:* - R$ ${Number(total.discount).toFixed(2).replace('.', ',')}\n`; }
        orderMessage += `*Total:* R$ ${Number(total.finalTotal || 0).toFixed(2).replace('.', ',')}\n`;
        let paymentInfo = '';
        if (typeof paymentMethod === 'object' && paymentMethod.method === 'Dinheiro') { paymentInfo = `Dinheiro (Troco para R$ ${Number(paymentMethod.trocoPara || 0).toFixed(2).replace('.', ',')} - Levar R$ ${Number(paymentMethod.trocoTotal || 0).toFixed(2).replace('.', ',')})`; }
        else { paymentInfo = paymentMethod || 'Não especificado'; }
        orderMessage += `*Pagamento:* ${paymentInfo}\n`;
        if (observation) { orderMessage += `\n*Observações:* ${observation}\n`; }
        log("Mensagem do WhatsApp formatada.");
        // --- Fim Mensagem WhatsApp ---

        const cleanWhatsappNumber = String(whatsappNumber).replace(/\D/g, '');
        const whatsappUrl = `https://wa.me/55${cleanWhatsappNumber}?text=${encodeURIComponent(orderMessage)}`;
        log("URL do WhatsApp gerada.");

        let pdvSaved = false;
        let pdvError = null;

        // --- **NOVA ESTRUTURA PARA SALVAR NO FIRESTORE** ---
        const orderDataToSave = {
            criadoEm: timestamp, // Usar o timestamp gerado no início
            endereco: {
                bairro: selectedAddress.bairro || null,
                clientName: customerName,
                // Garantir que deliveryFee seja número
                deliveryFee: Number(selectedAddress.deliveryFee || 0),
                numero: selectedAddress.numero || null,
                referencia: selectedAddress.referencia || null,
                rua: selectedAddress.rua || null,
                telefone: customerPhone || null // Salvar telefone formatado ou null
            },
            // Mapear itens para garantir a estrutura correta
            itens: order.map(item => ({
                // Incluir campos básicos
                category: item.category || null,
                description: item.description || null,
                // Usar ID interno do item se disponível, senão gerar um (ou manter o gerado pelo frontend se já tiver)
                id: item.id || Date.now() + Math.random(),
                name: item.name || 'Item sem nome',
                // Garantir que o preço seja número
                price: Number(item.price || 0),
                type: item.type || 'full', // 'full', 'split', 'custom_burger', 'promotion'
                // Campos específicos
                ...(item.ingredients && { ingredients: item.ingredients.map(ing => ({ name: ing.name, price: Number(ing.price || 0), quantity: Number(ing.quantity || 1) })) }), // Garantir números
                ...(item.extras && { extras: item.extras.map(ext => ({ name: ext.name, price: Number(ext.price || 0), quantity: Number(ext.quantity || 1), placement: ext.placement })) }), // Garantir números
                ...(item.originalItem && { originalItem: item.originalItem }), // Incluir se for custom_burger
                ...(item.selected_slices && { selected_slices: item.selected_slices }), // Para pizzas
                ...(item.firstHalfData && { firstHalfData: item.firstHalfData }), // Para pizzas split
                ...(item.secondHalfData && { secondHalfData: item.secondHalfData }), // Para pizzas split
                ...(item.basePrice !== undefined && { basePrice: Number(item.basePrice) }), // Para custom_burger
                // Adicionar quantity se não for implícito (ex: se o frontend não mandar quantity para itens normais)
                quantity: Number(item.quantity || 1)
            })),
            observacao: observation || "", // String vazia se nulo
            pagamento: paymentMethod, // Pode ser string ou map
            status: 'Novo', // Status inicial
            total: {
                // Garantir que todos os totais sejam números
                deliveryFee: Number(total.deliveryFee || 0),
                discount: Number(total.discount || 0),
                finalTotal: Number(total.finalTotal || 0),
                subtotal: Number(total.subtotal || 0)
            },
            orderHash: orderHash, // Manter o hash para duplicidade
            // Adicionar o ID gerado também dentro do documento pode ser útil
            orderId: orderId
        };
        // --- **FIM DA NOVA ESTRUTURA** ---

        try {
            log(`Tentando salvar pedido ${orderId} no Firestore...`);
            // Usar o orderId gerado como ID do documento
            const docRef = db.collection('pedidos').doc(orderId);
            await docRef.set(orderDataToSave);
            pdvSaved = true;
            log(`Pedido ${orderId} salvo com sucesso no Firestore.`);
        } catch (dbWriteError) {
            errorLog(`Erro ao salvar pedido ${orderId} no Firestore:`, dbWriteError);
            pdvError = `Erro ao salvar no BD: ${dbWriteError.message}`;
        }

        log(`Retornando resposta: pdvSaved=${pdvSaved}, pdvError=${pdvError}`);
        res.status(200).json({ whatsappUrl: whatsappUrl, pdvSaved: pdvSaved, pdvError: pdvError });

    } catch (generalError) {
        errorLog(`Erro geral CRÍTICO em /api/criar-pedido:`, generalError);
        res.status(500).json({ message: 'Erro interno do servidor ao processar o pedido.', details: generalError.message });
    } finally {
        log(`--- Requisição finalizada para /api/criar-pedido em ${new Date().toISOString()} ---`);
    }
}
