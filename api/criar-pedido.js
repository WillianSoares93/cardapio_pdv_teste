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

// --- NOVAS FUNÇÕES HELPER PARA FORMATAÇÃO DA MENSAGEM ---

/**
 * Formata um valor numérico para o padrão BRL (R$ XX,XX).
 * @param {number} value - O valor a ser formatado.
 * @returns {string} - O valor formatado como string.
 */
function formatCurrency(value) {
    if (value === undefined || value === null) return 'R$ 0,00';
    return `R$ ${Number(value).toFixed(2).replace('.', ',')}`;
}

/**
 * Formata o método de pagamento para exibição.
 * @param {string|object} payment - O método de pagamento.
 * @returns {string} - O método de pagamento formatado.
 */
function formatPaymentMethod(payment) {
    if (typeof payment === 'object' && payment !== null) {
        if (payment.method === 'Dinheiro') {
            const trocoPara = Number(payment.trocoPara || 0);
            if (trocoPara > 0) {
                return `*Dinheiro* (Troco para: ${formatCurrency(trocoPara)})`;
            }
            return '*Dinheiro* (Sem troco / Pagamento exato)';
        }
    }
    if (typeof payment === 'string') {
         return `*${payment}*`; // Para Cartão, Pix, etc.
    }
    // Fallback
    return `*${String(payment)}*`;
}

/**
 * Gera a string completa da mensagem do pedido para o WhatsApp.
 * @param {object} data - O corpo da requisição (req.body).
 * @returns {string} - A mensagem formatada e codificada para URL.
 */
function formatOrderMessage(data) {
    const { order, selectedAddress, total, paymentMethod, observation } = data;
    const message = [];

    // --- CABEÇALHO ---
    message.push('-- *NOVO PEDIDO* --');
    message.push('');

    // --- CLIENTE E ENDEREÇO ---
    message.push(`*Cliente:* ${selectedAddress.clientName || 'Não informado'}`);

    let addressLine = '*Endereço:* ';
    // O frontend já ajusta o 'bairro' para 'Retirada'
    if (selectedAddress.bairro === 'Retirada') {
        addressLine += 'Retirada no Balcão, S/N - Retirada';
    } else {
        addressLine += `${selectedAddress.rua || 'Rua não informada'}, ${selectedAddress.numero || 'S/N'} - ${selectedAddress.bairro || 'Bairro não informado'}`;
    }
    message.push(addressLine);
    message.push('');
    message.push('*------------------------------------*');
    message.push('*PEDIDO:*');
    message.push('');

    // --- AGRUPAR ITENS POR CATEGORIA ---
    const itemsByCategory = {};
    order.forEach(item => {
        let category = 'OUTROS'; // Categoria padrão
        if (item.type === 'custom_burger') {
            category = 'BURGER MONTAVEL';
        } else if (item.category) {
            // Normaliza o nome da categoria para garantir consistência
            category = item.category.toUpperCase().replace(/\(S\)/gi, '(s)');
        }
        if (!itemsByCategory[category]) {
            itemsByCategory[category] = [];
        }
        itemsByCategory[category].push(item);
    });

    // --- ORDEM DE EXIBIÇÃO DAS CATEGORIAS (para seguir o template) ---
    const categoryOrder = [
        'ENTRADAS',
        'PIZZA(S) DOCES',
        'PIZZA(S) TRADICIONAIS',
        'PIZZA(S) PROMOCIONAIS',
        'BEBIDAS',
        'BURGER',
        'BURGER CLÁSSICOS',
        'BURGER MONTAVEL'
    ];

    // Adiciona quaisquer outras categorias do pedido que não estejam na lista principal
    const allCategoriesInOrder = [...categoryOrder];
    for (const category in itemsByCategory) {
        if (!allCategoriesInOrder.includes(category)) {
            allCategoriesInOrder.push(category);
        }
    }
    
    let categoriesProcessed = 0; // Para controlar o separador

    // --- RENDERIZAR ITENS POR CATEGORIA ---
    allCategoriesInOrder.forEach(category => {
        if (itemsByCategory[category]) {
            
            // Adiciona separador ANTES da categoria (se não for a primeira)
            if (categoriesProcessed > 0) {
                 message.push('------------------------------------');
            }

            message.push(`*> ${category} <*`);
            itemsByCategory[category].forEach(item => {
                const quantity = item.quantity || 1;
                const quantityText = quantity > 1 ? ` (x${quantity})` : '';
                
                // Limpa o nome do item
                let itemName = (item.name || 'Item sem nome').replace(/&/g, 'e');
                if (item.selected_slices) {
                    itemName = itemName.replace(`${item.selected_slices} FATIAS: `, '');
                }

                // Formatação condicional por tipo de item
                if (item.type === 'custom_burger') {
                    // Formato Burger Montável
                    message.push(`  • ${itemName}${quantityText}: ${formatCurrency(item.basePrice || 0)}`);
                    if (item.ingredients && item.ingredients.length > 0) {
                        item.ingredients.forEach(ing => {
                            const ingQuantity = ing.quantity || 1;
                            const ingQuantityText = ingQuantity > 1 ? ` (x${ingQuantity})` : '';
                            const ingPrice = (ing.price || 0) * ingQuantity;
                            message.push(`     + _${ing.name}${ingQuantityText}: ${formatCurrency(ingPrice)}_`);
                        });
                    }
                    message.push(`        *Total C/ Ingredientes: ${formatCurrency(item.price)}*`);
                
                } else if (item.selected_slices) {
                    // Formato Pizza
                    message.push(`  • *${item.selected_slices} FATIAS:* ${itemName}${quantityText}: ${formatCurrency(item.price)}`);
                
                } else if (item.type === 'promotion') {
                    // Formato Promoção
                    message.push(`  • ${itemName}${quantityText} (Promo): ${formatCurrency(item.price)}`);

                } else {
                    // Formato Item Normal
                    message.push(`  • ${itemName}${quantityText}: ${formatCurrency(item.price)}`);
                }

                // Adicionais (Extras) para pizzas (e outros itens, se houver)
                if (item.extras && item.extras.length > 0) {
                     item.extras.forEach(extra => {
                        const extraQty = extra.quantity > 1 ? ` (x${extra.quantity})` : '';
                        const extraPrice = (extra.price || 0) * (extra.quantity || 1);
                        message.push(`     + _Adicional ${extra.name} (${extra.placement})${extraQty}: ${formatCurrency(extraPrice)}_`);
                     });
                }
            });
            categoriesProcessed++;
        }
    });

    // --- TOTAIS ---
    message.push('------------------------------------');
    message.push(`Subtotal: ${formatCurrency(total.subtotal)}`);
    if (total.discount > 0) {
        message.push(`Desconto: - ${formatCurrency(total.discount)}`);
    }

    // Adiciona taxa de entrega (mesmo R$ 0,00) conforme template
    message.push(`Taxa de Entrega: ${formatCurrency(total.deliveryFee)}`);
    
    message.push(`*Total: ${formatCurrency(total.finalTotal)}*`);
    message.push(`Pagamento: ${formatPaymentMethod(paymentMethod)}`);
    message.push('');

    // --- OBSERVAÇÕES ---
    if (observation && observation.trim() !== '') {
        message.push('*OBSERVAÇÕES:*');
        message.push(`_${observation.trim()}_`);
    }

    // Junção e codificação
    return encodeURIComponent(message.join('\n'));
}

// --- FIM DAS NOVAS FUNÇÕES HELPER ---


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
        const { order, selectedAddress, total, paymentMethod, whatsappNumber, observation, bypassDuplicateCheck } = req.body; // <-- bypassDuplicateCheck adicionado
        log("Corpo da requisição parseado.");

        if (!order || !Array.isArray(order) || order.length === 0 || !selectedAddress || !total || !paymentMethod || !whatsappNumber) {
            log("Dados incompletos ou inválidos recebidos.");
            return res.status(400).json({ message: 'Dados do pedido incompletos ou inválidos.' });
        }
        log("Validação inicial passou.");

        // --- Verificação de Duplicidade ---
        log("Iniciando verificação de duplicidade...");
        const customerName = selectedAddress.clientName?.trim() || 'Nome não informado';
        const customerPhone = selectedAddress.telefone?.trim().replace(/\D/g, '') || '';
        const orderHash = createOrderHash(order);
        const isPickup = selectedAddress.rua === "Retirada no Balcão"; // Verifica se é retirada
        // Define o bairro corretamente para a verificação de duplicidade
        const bairro = isPickup ? "Retirada" : selectedAddress.bairro || null;

        if (!orderHash || orderHash === 'error_processing_items' || orderHash.includes('invalid_item')) {
            errorLog("Falha ao gerar hash do pedido para duplicidade.", { order, generatedHash: orderHash });
            return res.status(500).json({ message: 'Erro interno ao processar itens (hash inválido).' });
        }
        log(`Hash gerado (prefixo): ${orderHash.substring(0, 50)}...`);

        const checkTimeframe = Timestamp.fromDate(new Date(Date.now() - 3 * 60 * 1000)); // Últimos 3 minutos
        log(`Janela de tempo para duplicidade inicia em: ${checkTimeframe.toDate().toISOString()}`);

        // **AJUSTE NA QUERY PARA CORRESPONDER EXATAMENTE AO ÍNDICE DA IMAGEM**
        let duplicateQuery = db.collection('pedidos')
            .where('endereco.bairro', '==', bairro) // <-- Alterado de address para endereco
            .where('customerName', '==', customerName)
            .where('orderHash', '==', orderHash)
            .where('timestamp', '>=', checkTimeframe);

        // Adiciona o filtro de telefone apenas se ele existir
        if (customerPhone) {
             duplicateQuery = duplicateQuery.where('customerPhone', '==', customerPhone);
        } else {
             duplicateQuery = duplicateQuery.where('customerPhone', '==', null);
        }

        log("Executando query de duplicidade alinhada ao índice...");
        const duplicateSnapshot = await duplicateQuery.limit(1).get();

        // ****** CORREÇÃO APLICADA AQUI ******
        // Só retorna duplicidade se encontrada E se NÃO estiver bypassando
        if (!duplicateSnapshot.empty && !bypassDuplicateCheck) {
        // ****** FIM DA CORREÇÃO ******
            log(`DUPLICIDADE de pedido detectada.`);
             const duplicateDoc = duplicateSnapshot.docs[0];
             const originalTimestamp = duplicateDoc.data().criadoEm; // Pega o Timestamp do Firestore

             // Retorna a duplicidade e o timestamp original em milissegundos
             return res.status(200).json({
                 duplicateFound: true,
                 originalOrderTimestamp: originalTimestamp ? originalTimestamp.toMillis() : null // Converte para milissegundos
             });
        }
        log("Nenhum pedido duplicado encontrado OU bypass solicitado.");
        // --- Fim Verificação de Duplicidade ---

        // --- Processamento Normal ---
        const orderId = generateOrderId();
        const timestamp = Timestamp.now(); // Usar este timestamp consistentemente
        log(`ID do Pedido Gerado: ${orderId}`);

        // --- Montagem da Mensagem WhatsApp (NOVO PADRÃO) ---
        log("Formatando mensagem do WhatsApp com o novo padrão...");
        // A lógica de formatação agora está na função helper
        const orderMessage = formatOrderMessage(req.body);
        log("Mensagem do WhatsApp formatada.");
        // --- Fim Mensagem WhatsApp ---

        const cleanWhatsappNumber = String(whatsappNumber).replace(/\D/g, '');
        const whatsappUrl = `https://wa.me/55${cleanWhatsappNumber}?text=${orderMessage}`;
        log("URL do WhatsApp gerada.");

        let pdvSaved = false;
        let pdvError = null;

        // --- Estrutura para salvar (COM ORDEM E NOMENCLATURA AJUSTADAS) ---
        const orderDataToSave = {
            criadoEm: timestamp, // Primeiro campo
            endereco: { // Segundo campo, nome em português
                // Mantém a lógica anterior para definir bairro e rua corretamente
                bairro: isPickup ? "Retirada" : bairro,
                rua: isPickup ? "Retirada no Balcão" : selectedAddress.rua || null,
                clientName: customerName,
                // Os outros campos dentro de endereco permanecem como estavam
                deliveryFee: Number(selectedAddress.deliveryFee || 0),
                numero: isPickup ? "S/N" : selectedAddress.numero || null,
                referencia: isPickup ? null : selectedAddress.referencia || null,
                telefone: selectedAddress.telefone || null
            },
            // Demais campos na ordem desejada (mantendo os campos de índice também)
            itens: order.map(item => ({
                // Mantém a estrutura interna dos itens como antes
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
            // Campos de índice para duplicidade (mantidos no nível raiz, podem vir depois se preferir, mas a ordem exata aqui não afeta a query se os campos existirem)
            customerName: customerName,
            customerPhone: customerPhone || null,
            orderHash: orderHash,
            timestamp: timestamp,
            orderId: orderId // ID gerado (pode ser o último campo)
        };
        // --- Fim Estrutura Salvar ---

        try {
            log(`Tentando salvar pedido ${orderId} no Firestore...`);
            const docRef = db.collection('pedidos').doc(orderId);

            // ----- INÍCIO DA SIMULAÇÃO DE ERRO -----
            //throw new Error("Erro SIMULADO ao salvar no Firestore"); // <<-- ADICIONADO PARA TESTE
            // ----- FIM DA SIMULAÇÃO DE ERRO -----

            // Esta linha não será executada durante a simulação
            await docRef.set(orderDataToSave);
            pdvSaved = true;
            log(`Pedido ${orderId} salvo com sucesso no Firestore.`);
        } catch (dbWriteError) {
            errorLog(`Erro ao salvar pedido ${orderId} no Firestore:`, dbWriteError);
            pdvError = `Erro ao salvar no BD: ${dbWriteError.message}`;
        }

        log(`Retornando resposta: pdvSaved=${pdvSaved}, pdvError=${pdvError}`);
        // Retorna a URL do WhatsApp mesmo se pdvSaved for false
        res.status(200).json({ whatsappUrl: whatsappUrl, pdvSaved: pdvSaved, pdvError: pdvError });

    } catch (generalError) {
        errorLog(`Erro geral CRÍTICO em /api/criar-pedido:`, generalError);
        // Verificar se o erro ainda é de índice
        if (generalError.code === 9 || (generalError.details && generalError.details.includes('FAILED_PRECONDITION') && generalError.details.includes('requires an index'))) {
             errorLog("Erro de índice PERSISTE. Verifique o painel do Firebase e a query.", generalError.details);
             // Incluir link do índice sugerido no erro, se disponível
             const indexLinkMatch = generalError.message.match(/(https://console\.firebase\.google\.com\/.*?)\)?$/);
             const indexLink = indexLinkMatch ? indexLinkMatch[1] : 'Verifique o console do Firebase.';
             res.status(500).json({ message: `Erro interno: Falha na consulta (índice necessário/inválido). Índice sugerido: ${indexLink}`, details: generalError.message });
        } else {
             res.status(500).json({ message: 'Erro interno do servidor ao processar o pedido.', details: generalError.message });
        }
    } finally {
        log(`--- Requisição finalizada para /api/criar-pedido em ${new Date().toISOString()} ---`);
    }
}
