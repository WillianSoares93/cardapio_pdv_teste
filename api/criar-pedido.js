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

        if (!order || !Array.isArray(order) || order.length === 0 || !selectedAddress || !total || !paymentMethod || !whatsappNumber) {
            log("Dados incompletos ou inválidos recebidos.");
            return res.status(400).json({ message: 'Dados do pedido incompletos ou inválidos.' });
        }
        log("Validação inicial dos dados passou.");

        // --- Verificação de Duplicidade ---
        log("Iniciando verificação de duplicidade...");
        const customerName = selectedAddress.clientName?.trim() || 'Nome não informado';
        const customerPhone = selectedAddress.telefone?.trim() || '';
        const isPickup = selectedAddress.bairro === 'Retirada';
        const orderHash = createOrderHash(order);

        // Validação do hash (revisada)
        if (order.length > 0 && (!orderHash || orderHash === 'error_processing_items' || orderHash.includes('invalid_item'))) {
            errorLog("Falha ao gerar o hash do pedido para verificação de duplicidade ou hash inválido.", { order, generatedHash: orderHash });
            return res.status(500).json({ message: 'Erro interno ao processar itens do pedido (hash inválido).' });
        }
         // Log apenas se o hash for válido
        if(orderHash) {
             log(`Hash do pedido gerado (prefixo): ${orderHash.substring(0, 50)}...`);
        } else if (order.length === 0) {
             log("Pedido vazio, pulando geração de hash.");
        }


        const checkTimeframe = Timestamp.fromDate(new Date(Date.now() - 3 * 60 * 60 * 1000));
        log(`Janela de tempo para duplicidade inicia em: ${checkTimeframe.toDate().toISOString()}`);

        let duplicateQuery = db.collection('pedidos')
            .where('customerName', '==', customerName)
            .where('orderHash', '==', orderHash) // Comparação de hash só faz sentido se hash for válido
            .where('timestamp', '>=', checkTimeframe);

        if (customerPhone) {
            duplicateQuery = duplicateQuery.where('customerPhone', '==', customerPhone);
        }

        if (!isPickup) {
            duplicateQuery = duplicateQuery
                .where('address.bairro', '==', selectedAddress.bairro || null)
                .where('address.rua', '==', selectedAddress.rua || null)
                .where('address.numero', '==', selectedAddress.numero || null);
        } else {
            duplicateQuery = duplicateQuery.where('address.bairro', '==', 'Retirada');
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

        let orderMessage = `*Novo Pedido Sâmia (ID: ${orderId})*\n\n`;
        orderMessage += `*Cliente:* ${customerName}\n`;
        if (customerPhone) { orderMessage += `*Contato:* ${customerPhone}\n`; }
        if (isPickup) { orderMessage += `*Entrega:* Retirada no Balcão\n`; }
        else {
            orderMessage += `*Endereço:* ${selectedAddress.rua || 'Rua não informada'}, Nº ${selectedAddress.numero || 'S/N'}, ${selectedAddress.bairro || 'Bairro não informado'}\n`;
            if (selectedAddress.referencia) { orderMessage += `*Referência:* ${selectedAddress.referencia}\n`; }
            orderMessage += `*Taxa de Entrega:* R$ ${Number(total.deliveryFee || 0).toFixed(2).replace('.', ',')}\n`;
        }
        orderMessage += "\n*Itens do Pedido:*\n";
        order.forEach(item => {
            orderMessage += `- ${item.quantity || 1}x ${item.name} (R$ ${Number(item.price || 0).toFixed(2).replace('.', ',')})\n`;
             if (item.ingredients && item.ingredients.length > 0) {
                 item.ingredients.forEach(ing => orderMessage += `  * ${ing.name}\n`);
            }
             if (item.extras && item.extras.length > 0) {
                 item.extras.forEach(ext => orderMessage += `  + ${ext.name} (${ext.placement})\n`);
            }
        });
        orderMessage += `\n*Subtotal:* R$ ${Number(total.subtotal || 0).toFixed(2).replace('.', ',')}\n`;
        if (total.discount > 0) { orderMessage += `*Desconto:* - R$ ${Number(total.discount).toFixed(2).replace('.', ',')}\n`; }
        orderMessage += `*Total:* R$ ${Number(total.finalTotal || 0).toFixed(2).replace('.', ',')}\n`;
        let paymentInfo = '';
        if (typeof paymentMethod === 'object' && paymentMethod.method === 'Dinheiro') { paymentInfo = `Dinheiro (Troco para R$ ${Number(paymentMethod.trocoPara || 0).toFixed(2).replace('.', ',')} - Levar R$ ${Number(paymentMethod.trocoTotal || 0).toFixed(2).replace('.', ',')})`; }
        else { paymentInfo = paymentMethod || 'Não especificado'; }
        orderMessage += `*Pagamento:* ${paymentInfo}\n`;
        if (observation) { orderMessage += `\n*Observações:* ${observation}\n`; }
        log("Mensagem do WhatsApp formatada.");

        const cleanWhatsappNumber = String(whatsappNumber).replace(/\D/g, '');
        const whatsappUrl = `https://wa.me/55${cleanWhatsappNumber}?text=${encodeURIComponent(orderMessage)}`;
        log("URL do WhatsApp gerada.");

        let pdvSaved = false;
        let pdvError = null;
        const orderDataToSave = {
            id: orderId, customerName, customerPhone, address: selectedAddress,
            items: order, total: total.finalTotal, subtotal: total.subtotal,
            discount: total.discount, deliveryFee: total.deliveryFee,
            paymentMethod, observation, status: 'Novo', timestamp, orderHash
        };
        try {
            log(`Tentando salvar pedido ${orderId} no Firestore...`);
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
