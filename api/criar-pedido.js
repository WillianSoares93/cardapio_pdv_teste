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
        const credentialsJsonString = Buffer.from(credentialsBase64, 'base64').toString('utf-8');
        serviceAccountJson = JSON.parse(credentialsJsonString);
        if (!serviceAccountJson.project_id || !serviceAccountJson.client_email || !serviceAccountJson.private_key) {
             throw new Error("JSON decodificado de GOOGLE_CREDENTIALS_BASE64 não contém campos essenciais.");
        }
        log("Credenciais parseadas com sucesso a partir de GOOGLE_CREDENTIALS_BASE64.");
    } catch (envError) {
        errorLog("Erro ao carregar ou processar GOOGLE_CREDENTIALS_BASE64.", envError);
        initializationError = `Falha ao carregar/processar credenciais Base64: ${envError.message}`;
        serviceAccountJson = null;
    }

    if (serviceAccountJson) {
        try {
            log("Inicializando Firebase Admin SDK com credenciais decodificadas...");
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

// --- FUNÇÕES HELPER ---
const createSubItemString = (subItems) => {
  if (!Array.isArray(subItems) || subItems.length === 0) return '';
  try {
      return subItems
        .map(si => ({ name: String(si?.name || ''), quantity: si?.quantity || 1, price: si?.price || 0, placement: String(si?.placement || '') }))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(si => `${si.name}:${si.quantity}:${si.price}:${si.placement}`)
        .join(',');
  } catch (err) { errorLog('Erro em createSubItemString:', err, { subItems }); return 'error_processing_subitems'; }
};

const createOrderHash = (items) => {
   if (!Array.isArray(items) || items.length === 0) return '';
   try {
      return items
        .map(item => {
          if (typeof item !== 'object' || item === null) return 'invalid_item';
          const name = String(item.name || '');
          const slices = item.selected_slices || '';
          const price = item.price || 0;
          const ingredientsString = createSubItemString(item.ingredients || []);
          const extrasString = createSubItemString(item.extras || []);
          return `${name}|${slices}|${price}|${ingredientsString}|${extrasString}`;
        })
        .sort((a, b) => a.localeCompare(b))
        .join(';');
   } catch (err) { errorLog('Erro em createOrderHash:', err, { items }); return 'error_processing_items'; }
};

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


// --- HANDLER PRINCIPAL DA API ---
export default async function handler(req, res) {
    log(`--- Requisição recebida para /api/criar-pedido em ${new Date().toISOString()} ---`);
    if (req.method !== 'POST') {
        log(`Método não permitido: ${req.method}`);
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    if (!firebaseInitialized) {
        errorLog("API /criar-pedido: Firebase Admin SDK NÃO INICIALIZADO.", initializationError || "Erro desconhecido.");
        return res.status(503).json({ message: 'Erro interno: Serviço de banco de dados indisponível.', details: initializationError });
    }

    let db;
    try {
        db = getFirestore();
        log("Instância do Firestore obtida.");
    } catch (dbError) {
        errorLog("CRÍTICO: Erro ao obter instância do Firestore:", dbError);
        return res.status(503).json({ message: 'Erro interno: Falha ao conectar ao banco de dados.', details: dbError.message });
    }

    try {
        const { order, selectedAddress, total, paymentMethod, whatsappNumber, observation } = req.body;
        log("Corpo da requisição parseado.");

        if (!order || !Array.isArray(order) || order.length === 0 || !selectedAddress || !total || !paymentMethod || !whatsappNumber) {
            log("Dados incompletos ou inválidos recebidos.");
            return res.status(400).json({ message: 'Dados do pedido incompletos ou inválidos.' });
        }
        log("Validação inicial passou.");

        // --- Verificação de Duplicidade ---
        log("Iniciando verificação de duplicidade...");
        const customerName = selectedAddress.clientName?.trim() || 'Nome não informado';
        // **AJUSTE:** Usar telefone não formatado para consistência com o que pode estar no índice
        const customerPhone = selectedAddress.telefone?.trim().replace(/\D/g, '') || '';
        const orderHash = createOrderHash(order);

        if (!orderHash || orderHash === 'error_processing_items' || orderHash.includes('invalid_item')) {
            errorLog("Falha ao gerar hash do pedido para duplicidade.", { order, generatedHash: orderHash });
            return res.status(500).json({ message: 'Erro interno ao processar itens (hash inválido).' });
        }
        log(`Hash gerado (prefixo): ${orderHash.substring(0, 50)}...`);

        const checkTimeframe = Timestamp.fromDate(new Date(Date.now() - 3 * 60 * 1000)); // Últimos 3 minutos
        log(`Janela de tempo para duplicidade inicia em: ${checkTimeframe.toDate().toISOString()}`);

        // **AJUSTE NA QUERY PARA USAR CAMPOS DO ÍNDICE EXISTENTE**
        let duplicateQuery = db.collection('pedidos')
            .where('customerName', '==', customerName) // <-- Campo do índice
            .where('orderHash', '==', orderHash)
            .where('timestamp', '>=', checkTimeframe); // <-- Campo do índice

        if (customerPhone) {
            duplicateQuery = duplicateQuery.where('customerPhone', '==', customerPhone); // <-- Campo do índice
        }

        // Simplificado: não usa rua/numero/bairro na query de duplicidade para garantir uso do índice
        // A combinação de nome, telefone (opcional), hash do pedido e tempo é suficiente

        log("Executando query de duplicidade simplificada...");
        const duplicateSnapshot = await duplicateQuery.limit(1).get();

        if (!duplicateSnapshot.empty) {
            log(`DUPLICIDADE de pedido detectada.`);
            return res.status(200).json({ duplicateFound: true });
        }
        log("Nenhum pedido duplicado encontrado.");
        // --- Fim Verificação de Duplicidade ---

        // --- Processamento Normal ---
        const orderId = generateOrderId();
        const timestamp = Timestamp.now(); // Usar este timestamp consistentemente
        log(`ID do Pedido Gerado: ${orderId}`);

        // --- Montagem da Mensagem WhatsApp (Mantida) ---
        const isPickup = selectedAddress.rua === 'Retirada no Balcão';
        let orderMessage = `*Novo Pedido Sâmia (ID: ${orderId.substring(0,5).toUpperCase()})*\n\n`;
        orderMessage += `*Cliente:* ${customerName}\n`;
        if (selectedAddress.telefone) { orderMessage += `*Contato:* ${selectedAddress.telefone}\n`; } // Usar telefone formatado aqui
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
                 item.ingredients.forEach(ing => { const quantityText = (ing.quantity && ing.quantity > 1) ? ` (x${ing.quantity})` : ''; orderMessage += `  * ${ing.name}${quantityText}\n`; });
            }
             if (item.extras && item.extras.length > 0) {
                 item.extras.forEach(ext => { const quantityText = (ext.quantity && ext.quantity > 1) ? ` (x${ext.quantity})` : ''; orderMessage += `  + ${ext.name}${quantityText} (${ext.placement})\n`; });
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
        // --- Fim Mensagem WhatsApp ---

        const cleanWhatsappNumber = String(whatsappNumber).replace(/\D/g, '');
        const whatsappUrl = `https://wa.me/55${cleanWhatsappNumber}?text=${encodeURIComponent(orderMessage)}`;
        log("URL do WhatsApp gerada.");

        let pdvSaved = false;
        let pdvError = null;

        // --- **ESTRUTURA AJUSTADA PARA SALVAR NO FIRESTORE (ALINHADA COM O ÍNDICE)** ---
        const orderDataToSave = {
            // Campos indexados no nível raiz
            customerName: customerName,
            customerPhone: customerPhone || null, // Salvar telefone não formatado ou null
            orderHash: orderHash,
            timestamp: timestamp, // <-- Usar o campo do índice

            // Manter a estrutura aninhada para outros usos
            criadoEm: timestamp, // Manter por consistência se o PDV usar
            endereco: {
                bairro: selectedAddress.bairro || null,
                clientName: customerName, // Repetir aqui para o PDV
                deliveryFee: Number(selectedAddress.deliveryFee || 0),
                numero: selectedAddress.numero || null,
                referencia: selectedAddress.referencia || null,
                rua: selectedAddress.rua || null,
                telefone: selectedAddress.telefone || null // Manter telefone formatado aqui para o PDV
            },
            itens: order.map(item => ({
                category: item.category || null,
                description: item.description || null,
                id: item.id || Date.now() + Math.random(),
                name: item.name || 'Item sem nome',
                price: Number(item.price || 0),
                type: item.type || 'full',
                ...(item.ingredients && { ingredients: item.ingredients.map(ing => ({ name: ing.name, price: Number(ing.price || 0), quantity: Number(ing.quantity || 1) })) }),
                ...(item.extras && { extras: item.extras.map(ext => ({ name: ext.name, price: Number(ext.price || 0), quantity: Number(ext.quantity || 1), placement: ext.placement })) }),
                ...(item.originalItem && { originalItem: item.originalItem }),
                ...(item.selected_slices && { selected_slices: item.selected_slices }),
                ...(item.firstHalfData && { firstHalfData: item.firstHalfData }),
                ...(item.secondHalfData && { secondHalfData: item.secondHalfData }),
                ...(item.basePrice !== undefined && { basePrice: Number(item.basePrice) }),
                quantity: Number(item.quantity || 1)
            })),
            observacao: observation || "",
            pagamento: paymentMethod,
            status: 'Novo',
            total: {
                deliveryFee: Number(total.deliveryFee || 0),
                discount: Number(total.discount || 0),
                finalTotal: Number(total.finalTotal || 0),
                subtotal: Number(total.subtotal || 0)
            },
            orderId: orderId // ID gerado
        };
        // --- **FIM DA ESTRUTURA AJUSTADA** ---

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
        // Verificar se o erro é de índice, mesmo após as mudanças
        if (generalError.code === 9 || (generalError.details && generalError.details.includes('FAILED_PRECONDITION') && generalError.details.includes('requires an index'))) {
             errorLog("Erro de índice PERSISTE mesmo após ajustes. Verifique o painel do Firebase e a query novamente.", generalError.details);
             res.status(500).json({ message: 'Erro interno: Falha na consulta ao banco de dados (índice ainda necessário ou inválido).', details: generalError.message });
        } else {
             res.status(500).json({ message: 'Erro interno do servidor ao processar o pedido.', details: generalError.message });
        }
    } finally {
        log(`--- Requisição finalizada para /api/criar-pedido em ${new Date().toISOString()} ---`);
    }
}

