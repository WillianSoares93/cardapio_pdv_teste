// api/criar-pedido.js
const { initializeApp, cert, getApps } = require('firebase-admin/app'); // Import getApps
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const path = require('path'); // Import path module

// --- Configure o caminho para o seu JSON de credenciais do Firebase Admin ---
// IMPORTANTE: Em produção no Vercel, use Variáveis de Ambiente!
let serviceAccount;
let firebaseInitialized = false;

console.log("Attempting to initialize Firebase Admin SDK..."); // Log inicial

// Tenta inicializar apenas uma vez
if (getApps().length === 0) { // Verifica se nenhuma app Firebase foi inicializada ainda
    console.log("No existing Firebase Admin app found. Trying to load credentials...");
    try {
        // Tenta carregar a partir de um caminho relativo (para desenvolvimento local)
        serviceAccount = require(path.join(process.cwd(), 'credentials', 'serviceAccountKey.json'));
        console.log("Service account loaded successfully from file.");
    } catch (error) {
        console.warn("Could not load service account from file. Attempting environment variables...");
        // Tenta carregar a partir de variáveis de ambiente (para Vercel)
        try {
            const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY;
            const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
            const projectId = process.env.FIREBASE_PROJECT_ID;

             // Log para verificar se as variáveis de ambiente estão sendo lidas
             console.log(`Env Var Check: Project ID? ${!!projectId}, Client Email? ${!!clientEmail}, Private Key? ${!!privateKey ? 'Exists' : 'MISSING!'}`);


            if (!privateKey || !clientEmail || !projectId) {
                throw new Error("Missing required Firebase Admin environment variables (PROJECT_ID, CLIENT_EMAIL, PRIVATE_KEY).");
            }
            serviceAccount = {
              type: "service_account",
              project_id: projectId,
              private_key_id: process.env.FIREBASE_ADMIN_PRIVATE_KEY_ID, // Opcional
              private_key: privateKey.replace(/\\n/g, '\n'), // Substitui \\n por \n
              client_email: clientEmail,
              client_id: process.env.FIREBASE_ADMIN_CLIENT_ID, // Opcional
              auth_uri: "https://accounts.google.com/o/oauth2/auth", // Padrão
              token_uri: "https://oauth2.googleapis.com/token", // Padrão
              auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs", // Padrão
              client_x509_cert_url: process.env.FIREBASE_ADMIN_CLIENT_CERT_URL // Opcional
            };
            console.log("Service account configured successfully from environment variables.");
        } catch (envError) {
            console.error("Fatal Error: Could not configure Firebase Admin credentials from environment variables.", envError.message);
            serviceAccount = null; // Garante que serviceAccount é null se falhar
        }
    }

    // Initialize Firebase Admin SDK se as credenciais foram carregadas
    if (serviceAccount) {
        try {
             initializeApp({
                credential: cert(serviceAccount)
            });
            console.log("Firebase Admin SDK initialized successfully.");
            firebaseInitialized = true;
        } catch (initError) {
             console.error('Firebase Admin initialization failed:', initError);
             firebaseInitialized = false; // Marca como não inicializado em caso de erro
        }
    } else {
        console.error("Skipping Firebase Admin initialization - no valid credentials found.");
        firebaseInitialized = false;
    }
} else {
    console.log("Firebase Admin SDK was already initialized.");
    // Verifica se a app padrão tem um nome (indicador de inicialização bem-sucedida)
    firebaseInitialized = !!getApps()[0]?.name;
}
// --- ---


// Helper function to create a canonical string for ingredients/extras
const createSubItemString = (subItems = []) => {
  if (!subItems || subItems.length === 0) return '';
  // Garante que subItems é um array antes de processar
  if (!Array.isArray(subItems)) {
      console.warn('createSubItemString received non-array:', subItems);
      return '';
  }
  return subItems
    // Garante estrutura mínima e ordena por nome
    .map(si => ({ name: String(si.name || ''), quantity: si.quantity || 1, price: si.price || 0, placement: si.placement || '' }))
    .sort((a, b) => a.name.localeCompare(b.name))
    // Cria string para cada subitem
    .map(si => `${si.name}:${si.quantity}:${si.price}:${si.placement}`)
    .join(','); // Junta com vírgula
};

// Helper function to create a canonical hash/string for the entire order items
const createOrderHash = (items = []) => {
  if (!items || items.length === 0) return '';
   // Garante que items é um array
   if (!Array.isArray(items)) {
       console.warn('createOrderHash received non-array:', items);
       return '';
   }
  return items
    // Garante estrutura mínima e ordena itens por nome
    .map(item => {
      const name = String(item.name || '');
      const slices = item.selected_slices || '';
      const price = item.price || 0;
      // Cria strings canônicas para ingredientes e extras
      const ingredientsString = createSubItemString(item.ingredients);
      const extrasString = createSubItemString(item.extras);
      // Combina partes para um item
      return `${name}|${slices}|${price}|${ingredientsString}|${extrasString}`;
    })
    .sort((a, b) => a.localeCompare(b)) // Ordena as strings dos itens
    .join(';'); // Junta com ponto e vírgula
};

// Helper function to generate Order ID
function generateOrderId() {
    const now = new Date();
    // Formato: AA MMDD - HHMM - XXXX (Ano, MêsDia, HoraMinuto, 4 Aleatórios)
    const datePart = now.getFullYear().toString().slice(-2) +
                     (now.getMonth() + 1).toString().padStart(2, '0') +
                     now.getDate().toString().padStart(2, '0');
    const timePart = now.getHours().toString().padStart(2, '0') +
                     now.getMinutes().toString().padStart(2, '0');
    const randomPart = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `${datePart}-${timePart}-${randomPart}`;
}


export default async function handler(req, res) {
  console.log(`\n--- Request received for /api/criar-pedido at ${new Date().toISOString()} ---`); // Log de início da requisição
  if (req.method !== 'POST') {
     console.log(`Method Not Allowed: ${req.method}`);
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  // **VERIFICAÇÃO INICIAL CRUCIAL:** Garante que o Firebase foi inicializado
  if (!firebaseInitialized) {
      console.error("/api/criar-pedido: Firebase Admin SDK NOT INITIALIZED. Aborting request. Check credentials setup.");
      return res.status(500).json({ message: 'Erro interno crítico: Falha na configuração do banco de dados.' });
  }

  let db;
  try {
      db = getFirestore(); // Pega a instância do Firestore
       console.log("Firestore instance obtained successfully.");
  } catch(e) {
       console.error("CRITICAL: Error getting Firestore instance even after initialization check:", e);
       return res.status(500).json({ message: 'Erro interno crítico: Não foi possível conectar ao banco de dados.' });
  }


  try {
    const { order, selectedAddress, total, paymentMethod, whatsappNumber, observation } = req.body;
    console.log("Request body parsed successfully.");

    // Validação básica dos dados recebidos
    if (!order || !Array.isArray(order) || order.length === 0 || !selectedAddress || !total || !paymentMethod || !whatsappNumber) {
      console.warn("API /criar-pedido: Dados incompletos ou inválidos recebidos.");
      // Log detalhado do que foi recebido
      console.log("Received Data:", { order_type: typeof order, order_length: order?.length, selectedAddress_exists: !!selectedAddress, total_exists: !!total, paymentMethod_exists: !!paymentMethod, whatsappNumber_exists: !!whatsappNumber });
      return res.status(400).json({ message: 'Dados do pedido incompletos ou inválidos.' });
    }
     console.log("Input data validation passed.");

    // --- Verificação de Duplicidade ---
     console.log("Starting duplicate check...");
    const customerName = selectedAddress.clientName?.trim() || 'Nome não informado';
    const customerPhone = selectedAddress.telefone?.trim() || ''; // Usar vazio se não informado
    const isPickup = selectedAddress.bairro === 'Retirada';
    const orderHash = createOrderHash(order); // Gera a 'assinatura' do pedido

    // Adiciona validação para o hash (não deve ser vazio se a ordem não for)
    if (order.length > 0 && !orderHash) {
        console.error("Falha ao gerar o hash do pedido para verificação de duplicidade.", { order });
        // Retorna erro pois a verificação de duplicidade é importante
        return res.status(500).json({ message: 'Erro interno ao processar itens do pedido.' });
    }
    console.log(`Generated Order Hash (prefix): ${orderHash.substring(0, 50)}...`);

    // Define o período para checar duplicidade (ex: últimas 3 horas)
    const checkTimeframe = Timestamp.fromDate(new Date(Date.now() - 3 * 60 * 60 * 1000));
     console.log(`Duplicate check timeframe starts at: ${checkTimeframe.toDate().toISOString()}`);

    // Monta a query base no Firestore
    let duplicateQuery = db.collection('pedidos')
      .where('customerName', '==', customerName)
      .where('orderHash', '==', orderHash) // Compara a assinatura dos itens
      .where('timestamp', '>=', checkTimeframe); // Apenas pedidos recentes

     // Adiciona filtro por telefone se ele foi fornecido
     if (customerPhone) {
        console.log("Adding phone filter to duplicate check:", customerPhone);
        duplicateQuery = duplicateQuery.where('customerPhone', '==', customerPhone);
     } else {
        console.log("No phone provided, skipping phone filter.");
     }

    // Adiciona filtros de endereço específicos para delivery ou retirada
    if (!isPickup) {
        console.log("Adding address filter (Delivery):", selectedAddress.bairro, selectedAddress.rua, selectedAddress.numero);
        duplicateQuery = duplicateQuery
            .where('address.bairro', '==', selectedAddress.bairro || null) // Usa null se não houver bairro
            .where('address.rua', '==', selectedAddress.rua || null)
            .where('address.numero', '==', selectedAddress.numero || null);
    } else {
         console.log("Adding address filter (Pickup).");
        duplicateQuery = duplicateQuery.where('address.bairro', '==', 'Retirada');
    }

    console.log("Executing duplicate check query...");
    const duplicateSnapshot = await duplicateQuery.limit(1).get(); // Limita a 1 resultado

    if (!duplicateSnapshot.empty) {
      // Duplicidade encontrada! Retorna a resposta específica.
      console.log(`DUPLICATE order detected - Client: ${customerName}, Hash: ${orderHash.substring(0, 50)}...`);
      return res.status(200).json({ duplicateFound: true });
    }
     console.log("No duplicate order found. Proceeding to create order.");
    // --- Fim da Verificação de Duplicidade ---


    // --- Processamento Normal do Pedido (se não for duplicado) ---
    const orderId = generateOrderId(); // Gera ID único para o novo pedido
    const timestamp = Timestamp.now(); // Data/Hora atual
     console.log(`Generated Order ID: ${orderId}`);

    // Formata a mensagem do pedido para o WhatsApp (código omitido para brevidade, assumindo que está correto)
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
    order.forEach(item => { /* ... (formatação dos itens) ... */ });
    orderMessage += `\n*Subtotal:* R$ ${Number(total.subtotal || 0).toFixed(2).replace('.', ',')}\n`;
    if (total.discount > 0) { orderMessage += `*Desconto:* - R$ ${Number(total.discount).toFixed(2).replace('.', ',')}\n`; }
    orderMessage += `*Total:* R$ ${Number(total.finalTotal || 0).toFixed(2).replace('.', ',')}\n`;
    let paymentInfo = '';
    if (typeof paymentMethod === 'object' && paymentMethod.method === 'Dinheiro') { paymentInfo = `Dinheiro (Troco para R$ ${Number(paymentMethod.trocoPara || 0).toFixed(2).replace('.', ',')} - Levar R$ ${Number(paymentMethod.trocoTotal || 0).toFixed(2).replace('.', ',')})`; }
    else { paymentInfo = paymentMethod || 'Não especificado'; }
    orderMessage += `*Pagamento:* ${paymentInfo}\n`;
    if (observation) { orderMessage += `\n*Observações:* ${observation}\n`; }
     console.log("WhatsApp message formatted.");

    // Cria URL do WhatsApp
    const cleanWhatsappNumber = String(whatsappNumber).replace(/\D/g, ''); // Garante apenas números
    const whatsappUrl = `https://wa.me/55${cleanWhatsappNumber}?text=${encodeURIComponent(orderMessage)}`;
     console.log("WhatsApp URL generated.");

    // Tenta salvar o pedido no Firestore
    let pdvSaved = false;
    let pdvError = null;
    try {
        console.log(`Attempting to save order ${orderId} to Firestore...`);
        await db.collection('pedidos').doc(orderId).set({
            id: orderId,
            customerName: customerName,
            customerPhone: customerPhone, // Salva o telefone
            address: selectedAddress,
            items: order, // Salva os itens originais
            total: total.finalTotal,
            subtotal: total.subtotal,
            discount: total.discount,
            deliveryFee: total.deliveryFee,
            paymentMethod: paymentMethod, // Salva objeto (Dinheiro) ou string
            observation: observation,
            status: 'Novo', // Status inicial
            timestamp: timestamp, // Data/Hora do Firestore
            orderHash: orderHash // Salva a assinatura/hash para futuras verificações
        });
        pdvSaved = true;
        console.log(`Order ${orderId} saved successfully to Firestore.`);
    } catch (dbError) {
      console.error(`Error saving order ${orderId} to Firestore:`, dbError);
      pdvError = dbError.message;
      // Não interrompe, apenas registra o erro e informa o frontend
    }

    // Retorna a URL do WhatsApp e o status do salvamento no PDV
     console.log(`Returning response: pdvSaved=${pdvSaved}, pdvError=${pdvError}`);
    res.status(200).json({ whatsappUrl: whatsappUrl, pdvSaved: pdvSaved, pdvError: pdvError });

  } catch (error) {
     // Captura erros gerais que podem ocorrer durante o processamento
    console.error(`CRITICAL general error in /api/criar-pedido:`, error);
    // Retorna um erro JSON claro para o frontend
    res.status(500).json({ message: 'Erro interno do servidor ao processar o pedido.', error: error.message });
  } finally {
      console.log(`--- Request finished for /api/criar-pedido at ${new Date().toISOString()} ---`); // Log de fim da requisição
  }
}

