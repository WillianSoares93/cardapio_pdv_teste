// api/criar-pedido.js
// --- IMPORTS (usando ES Module syntax) ---
import { initializeApp, cert, getApps, getApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import path from 'path'; // Usando import padrão para path
import { fileURLToPath } from 'url'; // Necessário para __dirname em ESM
import { dirname } from 'path'; // Necessário para __dirname em ESM

// --- CONFIGURAÇÃO DE LOGS ---
const log = (message, ...args) => console.log(`[LOG ${new Date().toISOString()}] ${message}`, args.length > 0 ? args : '');
const errorLog = (message, error, ...args) => console.error(`[ERROR ${new Date().toISOString()}] ${message}`, error, args.length > 0 ? args : '');

// Obter __dirname em ambiente ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// --- INICIALIZAÇÃO FIREBASE ADMIN SDK ---
let serviceAccount;
let firebaseInitialized = false;
let initializationError = null;

log("Verificando inicialização do Firebase Admin SDK...");

if (getApps().length === 0) {
    log("Nenhuma app Firebase Admin encontrada. Tentando carregar credenciais...");
    try {
        log("Tentando carregar credenciais das variáveis de ambiente...");
        const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY;
        const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
        const projectId = process.env.FIREBASE_PROJECT_ID;

        log(`Verificação Env Var: Project ID? ${!!projectId}, Client Email? ${!!clientEmail}, Private Key? ${!!privateKey ? 'Existe' : 'AUSENTE!'}`);

        if (!privateKey || !clientEmail || !projectId) {
            throw new Error("Variáveis de ambiente Firebase Admin (PROJECT_ID, CLIENT_EMAIL, PRIVATE_KEY) ausentes ou incompletas.");
        }
        serviceAccount = {
            type: "service_account",
            project_id: projectId,
            private_key_id: process.env.FIREBASE_ADMIN_PRIVATE_KEY_ID,
            private_key: privateKey.replace(/\\n/g, '\n'),
            client_email: clientEmail,
            client_id: process.env.FIREBASE_ADMIN_CLIENT_ID,
            auth_uri: "https://accounts.google.com/o/oauth2/auth",
            token_uri: "https://oauth2.googleapis.com/token",
            auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
            client_x509_cert_url: process.env.FIREBASE_ADMIN_CLIENT_CERT_URL
        };
        log("Credenciais configuradas a partir das variáveis de ambiente.");

    } catch (envError) {
        errorLog("Erro ao configurar credenciais das variáveis de ambiente. Tentando carregar de arquivo local (dev)...", envError);
        try {
            // **IMPORTANTE:** Para carregar JSON em ESM, usamos import assertion
            const credentialsPath = path.join(process.cwd(), 'credentials', 'serviceAccountKey.json');
            log(`Tentando carregar credenciais do arquivo: ${credentialsPath}`);
            // Note que `require` não funciona aqui. Se precisar carregar dinamicamente,
            // seria necessário ler o arquivo com 'fs' e fazer JSON.parse.
            // Por simplicidade, vamos assumir que as env vars são o método principal no Vercel.
            // Se o arquivo local for estritamente necessário para dev,
            // pode ser preciso usar `fs.readFileSync` e `JSON.parse`.
            // Ou, alternativamente, renomear este arquivo para .cjs se o require for essencial.
            // Por enquanto, vamos priorizar as env vars.
            log("Carregamento de arquivo local não implementado diretamente via import em ESM padrão Vercel, priorizando env vars.");
            throw new Error("Carregamento de arquivo local pulado em favor de env vars."); // Força a falha se env vars falharam
        } catch (fileError) {
            errorLog("Erro fatal: Não foi possível carregar credenciais das env vars.", fileError);
            initializationError = "Falha ao carregar credenciais Firebase Admin (Env Vars).";
            serviceAccount = null;
        }
    }

    if (serviceAccount) {
        try {
            log("Inicializando Firebase Admin SDK...");
            initializeApp({
                credential: cert(serviceAccount)
            });
            firebaseInitialized = true;
            log("Firebase Admin SDK inicializado com sucesso.");
        } catch (initError) {
            errorLog('Falha na inicialização do Firebase Admin SDK:', initError);
            initializationError = `Falha na inicialização do Firebase: ${initError.message}`;
            firebaseInitialized = false;
        }
    } else if (!initializationError) {
        initializationError = "Credenciais Firebase Admin não encontradas (Env Vars).";
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

// --- FUNÇÕES HELPER --- (Inalteradas, já estavam corretas)
const createSubItemString = (subItems = []) => {
  if (!subItems || subItems.length === 0) return '';
  if (!Array.isArray(subItems)) {
      console.warn('createSubItemString received non-array:', subItems);
      return '';
  }
  return subItems
    .map(si => ({ name: String(si.name || ''), quantity: si.quantity || 1, price: si.price || 0, placement: si.placement || '' }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(si => `${si.name}:${si.quantity}:${si.price}:${si.placement}`)
    .join(',');
};

const createOrderHash = (items = []) => {
   if (!items || items.length === 0) return '';
   if (!Array.isArray(items)) {
       console.warn('createOrderHash received non-array:', items);
       return '';
   }
  return items
    .map(item => {
      const name = String(item.name || '');
      const slices = item.selected_slices || '';
      const price = item.price || 0;
      const ingredientsString = createSubItemString(item.ingredients);
      const extrasString = createSubItemString(item.extras);
      return `${name}|${slices}|${price}|${ingredientsString}|${extrasString}`;
    })
    .sort((a, b) => a.localeCompare(b))
    .join(';');
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
        errorLog("CRÍTICO: Erro ao obter instância do Firestore mesmo após verificação de inicialização:", dbError);
        return res.status(503).json({ message: 'Erro interno: Falha ao conectar ao banco de dados.', details: dbError.message });
    }

    try {
        const { order, selectedAddress, total, paymentMethod, whatsappNumber, observation } = req.body;
        log("Corpo da requisição parseado com sucesso.");

        if (!order || !Array.isArray(order) || order.length === 0 || !selectedAddress || !total || !paymentMethod || !whatsappNumber) {
            log("Dados incompletos ou inválidos recebidos.", { /* ... dados ... */ });
            return res.status(400).json({ message: 'Dados do pedido incompletos ou inválidos.' });
        }
        log("Validação inicial dos dados passou.");

        // --- Verificação de Duplicidade (lógica inalterada) ---
        log("Iniciando verificação de duplicidade...");
        const customerName = selectedAddress.clientName?.trim() || 'Nome não informado';
        const customerPhone = selectedAddress.telefone?.trim() || '';
        const isPickup = selectedAddress.bairro === 'Retirada';
        const orderHash = createOrderHash(order);

        if (order.length > 0 && !orderHash) {
             errorLog("Falha ao gerar o hash do pedido para verificação de duplicidade.", { order });
            return res.status(500).json({ message: 'Erro interno ao processar itens do pedido (hash).' });
        }
        log(`Hash do pedido gerado (prefixo): ${orderHash.substring(0, 50)}...`);

        const checkTimeframe = Timestamp.fromDate(new Date(Date.now() - 3 * 60 * 60 * 1000));
        log(`Janela de tempo para duplicidade inicia em: ${checkTimeframe.toDate().toISOString()}`);

        let duplicateQuery = db.collection('pedidos')
            .where('customerName', '==', customerName)
            .where('orderHash', '==', orderHash)
            .where('timestamp', '>=', checkTimeframe);

        if (customerPhone) {
            log("Adicionando filtro de telefone:", customerPhone);
            duplicateQuery = duplicateQuery.where('customerPhone', '==', customerPhone);
        }

        if (!isPickup) {
             log("Adicionando filtros de endereço (Delivery):", selectedAddress.bairro, selectedAddress.rua, selectedAddress.numero);
            duplicateQuery = duplicateQuery
                .where('address.bairro', '==', selectedAddress.bairro || null)
                .where('address.rua', '==', selectedAddress.rua || null)
                .where('address.numero', '==', selectedAddress.numero || null);
        } else {
             log("Adicionando filtro de endereço (Retirada).");
            duplicateQuery = duplicateQuery.where('address.bairro', '==', 'Retirada');
        }

        log("Executando query de verificação de duplicidade...");
        const duplicateSnapshot = await duplicateQuery.limit(1).get();

        if (!duplicateSnapshot.empty) {
            log(`DUPLICIDADE de pedido detectada - Cliente: ${customerName}, Hash: ${orderHash.substring(0, 50)}...`);
            return res.status(200).json({ duplicateFound: true });
        }
        log("Nenhum pedido duplicado encontrado.");
        // --- Fim Verificação de Duplicidade ---


        // --- Processamento Normal (lógica inalterada) ---
        const orderId = generateOrderId();
        const timestamp = Timestamp.now();
        log(`ID do Pedido Gerado: ${orderId}`);

        let orderMessage = `*Novo Pedido Sâmia (ID: ${orderId})*\n\n`;
        // ... (restante da formatação da mensagem - inalterado) ...
         orderMessage += `*Cliente:* ${customerName}\n`;
        if (customerPhone) { orderMessage += `*Contato:* ${customerPhone}\n`; }
        if (isPickup) { orderMessage += `*Entrega:* Retirada no Balcão\n`; }
        else {
            orderMessage += `*Endereço:* ${selectedAddress.rua || 'Rua não informada'}, Nº ${selectedAddress.numero || 'S/N'}, ${selectedAddress.bairro || 'Bairro não informado'}\n`;
            if (selectedAddress.referencia) { orderMessage += `*Referência:* ${selectedAddress.referencia}\n`; }
            orderMessage += `*Taxa de Entrega:* R$ ${Number(total.deliveryFee || 0).toFixed(2).replace('.', ',')}\n`;
        }
        orderMessage += "\n*Itens do Pedido:*\n";
        // Loop para formatar itens (supondo que já existe)
        order.forEach(item => {
            orderMessage += `- ${item.quantity || 1}x ${item.name} (R$ ${Number(item.price || 0).toFixed(2).replace('.', ',')})\n`;
            // Adicionar detalhes de ingredientes/extras se necessário
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
            id: orderId,
            customerName: customerName,
            customerPhone: customerPhone,
            address: selectedAddress,
            items: order,
            total: total.finalTotal,
            subtotal: total.subtotal,
            discount: total.discount,
            deliveryFee: total.deliveryFee,
            paymentMethod: paymentMethod,
            observation: observation,
            status: 'Novo',
            timestamp: timestamp,
            orderHash: orderHash
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
