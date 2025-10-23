// api/criar-pedido.js
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const path = require('path'); // Import path module

// --- Configure o caminho para o seu JSON de credenciais do Firebase Admin ---
// Assume que o JSON está na raiz do projeto ou em um local seguro
// IMPORTANTE: Em produção no Vercel, use Variáveis de Ambiente!
let serviceAccount;
try {
    // Tenta carregar a partir de um caminho relativo (para desenvolvimento local)
    // Crie uma pasta 'credentials' na raiz e coloque o arquivo lá, ou ajuste o caminho
    serviceAccount = require(path.join(process.cwd(), 'credentials', 'serviceAccountKey.json'));
    console.log("Service account loaded from file.");
} catch (error) {
    console.warn("Could not load service account from file, attempting environment variables...");
    // Tenta carregar a partir de variáveis de ambiente (para Vercel)
    try {
        if (!process.env.FIREBASE_ADMIN_PRIVATE_KEY || !process.env.FIREBASE_ADMIN_CLIENT_EMAIL) {
            throw new Error("Missing FIREBASE_ADMIN_PRIVATE_KEY or FIREBASE_ADMIN_CLIENT_EMAIL environment variables.");
        }
        serviceAccount = {
          type: "service_account",
          project_id: process.env.FIREBASE_PROJECT_ID || "pizzaria-pdv", // Adicione FIREBASE_PROJECT_ID se necessário
          private_key_id: process.env.FIREBASE_ADMIN_PRIVATE_KEY_ID, // Opcional, mas bom ter
          private_key: process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, '\n'), // Substitui \\n por \n
          client_email: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
          client_id: process.env.FIREBASE_ADMIN_CLIENT_ID, // Opcional
          auth_uri: "https://accounts.google.com/o/oauth2/auth", // Padrão
          token_uri: "https://oauth2.googleapis.com/token", // Padrão
          auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs", // Padrão
          client_x509_cert_url: process.env.FIREBASE_ADMIN_CLIENT_CERT_URL // Opcional
        };
        console.log("Service account configured from environment variables.");
    } catch (envError) {
        console.error("Fatal Error: Could not load Firebase Admin credentials.", envError);
        // Em um cenário real, você poderia lançar um erro ou sair
        // throw new Error("Firebase Admin credentials configuration failed.");
    }
}
// --- ---

// Initialize Firebase Admin SDK (ensure this happens only once)
try {
    // Verifica se já existe uma app inicializada para evitar erro
     if (!getFirestore()._settings.projectId && serviceAccount) { // Só inicializa se tiver credenciais
         initializeApp({
            credential: cert(serviceAccount)
        });
        console.log("Firebase Admin SDK initialized.");
    } else if (!serviceAccount) {
         console.error("Skipping Firebase Admin initialization - no credentials found.");
    }
} catch (e) {
    // Ignora erro se já inicializado ('app/duplicate-app')
    if (e.code !== 'app/duplicate-app') {
        console.error('Firebase Admin initialization error:', e);
    } else {
        console.log("Firebase Admin SDK already initialized.");
    }
}

// Helper function to create a canonical string for ingredients/extras
const createSubItemString = (subItems = []) => {
  if (!subItems || subItems.length === 0) return '';
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
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  // Verifica se o SDK Admin foi inicializado corretamente
  let db;
  try {
      db = getFirestore();
      if (!db._settings.projectId) {
          throw new Error("Firestore not initialized. Check Admin SDK credentials.");
      }
  } catch(initError){
       console.error("Firestore access error:", initError);
       return res.status(500).json({ message: 'Erro interno do servidor: Falha na inicialização do DB', error: initError.message });
  }


  try {
    const { order, selectedAddress, total, paymentMethod, whatsappNumber, observation } = req.body;

    // Validação básica dos dados recebidos
    if (!order || order.length === 0 || !selectedAddress || !total || !paymentMethod || !whatsappNumber) {
      console.warn("API /criar-pedido: Dados incompletos recebidos.", { body: req.body });
      return res.status(400).json({ message: 'Dados do pedido incompletos.' });
    }

    // --- Verificação de Duplicidade ---
    const customerName = selectedAddress.clientName?.trim() || 'Nome não informado';
    const customerPhone = selectedAddress.telefone?.trim() || ''; // Usar vazio se não informado
    const isPickup = selectedAddress.bairro === 'Retirada';
    const orderHash = createOrderHash(order); // Gera a 'assinatura' do pedido

    // Define o período para checar duplicidade (ex: últimas 3 horas)
    const checkTimeframe = Timestamp.fromDate(new Date(Date.now() - 3 * 60 * 60 * 1000));

    // Monta a query base no Firestore
    let duplicateQuery = db.collection('pedidos')
      .where('customerName', '==', customerName)
      .where('orderHash', '==', orderHash) // Compara a assinatura dos itens
      .where('timestamp', '>=', checkTimeframe); // Apenas pedidos recentes

     // Adiciona filtro por telefone se ele foi fornecido
     if (customerPhone) {
        duplicateQuery = duplicateQuery.where('customerPhone', '==', customerPhone);
     }

    // Adiciona filtros de endereço específicos para delivery ou retirada
    if (!isPickup) {
        duplicateQuery = duplicateQuery
            .where('address.bairro', '==', selectedAddress.bairro || null) // Usa null se não houver bairro
            .where('address.rua', '==', selectedAddress.rua || null)
            .where('address.numero', '==', selectedAddress.numero || null);
    } else {
        duplicateQuery = duplicateQuery.where('address.bairro', '==', 'Retirada');
    }

    const duplicateSnapshot = await duplicateQuery.limit(1).get(); // Limita a 1 resultado (só precisamos saber se existe)

    if (!duplicateSnapshot.empty) {
      // Duplicidade encontrada! Retorna a resposta específica.
      console.log(`Pedido duplicado detectado - Cliente: ${customerName}, Hash: ${orderHash.substring(0, 50)}...`);
      return res.status(200).json({ duplicateFound: true });
    }
    // --- Fim da Verificação de Duplicidade ---


    // --- Processamento Normal do Pedido (se não for duplicado) ---
    const orderId = generateOrderId(); // Gera ID único para o novo pedido
    const timestamp = Timestamp.now(); // Data/Hora atual

    // Formata a mensagem do pedido para o WhatsApp
    let orderMessage = `*Novo Pedido Sâmia (ID: ${orderId})*\n\n`;
    orderMessage += `*Cliente:* ${customerName}\n`;
    if (customerPhone) {
        orderMessage += `*Contato:* ${customerPhone}\n`;
    }

    if (isPickup) {
        orderMessage += `*Entrega:* Retirada no Balcão\n`;
    } else {
        orderMessage += `*Endereço:* ${selectedAddress.rua || 'Rua não informada'}, Nº ${selectedAddress.numero || 'S/N'}, ${selectedAddress.bairro || 'Bairro não informado'}\n`;
        if (selectedAddress.referencia) {
            orderMessage += `*Referência:* ${selectedAddress.referencia}\n`;
        }
        orderMessage += `*Taxa de Entrega:* R$ ${Number(total.deliveryFee || 0).toFixed(2).replace('.', ',')}\n`;
    }

    orderMessage += "\n*Itens do Pedido:*\n";
    order.forEach(item => {
        orderMessage += `- ${item.name || 'Item sem nome'} - R$ ${Number(item.price || 0).toFixed(2).replace('.', ',')}\n`;
        // Formata ingredientes (se houver)
        if (item.ingredients && item.ingredients.length > 0) {
            item.ingredients.forEach(ing => {
                const qty = (ing.quantity || 1) > 1 ? ` (x${ing.quantity})` : '';
                const price = (ing.price || 0) > 0 ? ` +R$ ${(ing.price * (ing.quantity || 1)).toFixed(2).replace('.', ',')}` : '';
                orderMessage += `  * ${ing.name || 'Ingrediente'}${qty}${price}\n`;
            });
        }
         // Formata extras (se houver)
         if (item.extras && item.extras.length > 0) {
            item.extras.forEach(extra => {
                 const qty = (extra.quantity || 1) > 1 ? ` (x${extra.quantity})` : '';
                 const place = extra.placement && extra.placement !== 'Toda' ? ` (${extra.placement})` : '';
                 const price = (extra.price || 0) > 0 ? ` +R$ ${(extra.price * (extra.quantity || 1)).toFixed(2).replace('.', ',')}` : '';
                 orderMessage += `  + ${extra.name || 'Extra'}${place}${qty}${price}\n`;
             });
         }
    });

    // Formata totais
    orderMessage += `\n*Subtotal:* R$ ${Number(total.subtotal || 0).toFixed(2).replace('.', ',')}\n`;
    if (total.discount > 0) {
        orderMessage += `*Desconto:* - R$ ${Number(total.discount).toFixed(2).replace('.', ',')}\n`;
    }
    orderMessage += `*Total:* R$ ${Number(total.finalTotal || 0).toFixed(2).replace('.', ',')}\n`;

    // Formata forma de pagamento
    let paymentInfo = '';
    if (typeof paymentMethod === 'object' && paymentMethod.method === 'Dinheiro') {
        paymentInfo = `Dinheiro (Troco para R$ ${Number(paymentMethod.trocoPara || 0).toFixed(2).replace('.', ',')} - Levar R$ ${Number(paymentMethod.trocoTotal || 0).toFixed(2).replace('.', ',')})`;
    } else {
        paymentInfo = paymentMethod || 'Não especificado';
    }
    orderMessage += `*Pagamento:* ${paymentInfo}\n`;

    // Adiciona observação se houver
    if (observation) {
      orderMessage += `\n*Observações:* ${observation}\n`;
    }

    // Cria URL do WhatsApp
    const cleanWhatsappNumber = String(whatsappNumber).replace(/\D/g, ''); // Garante apenas números
    const whatsappUrl = `https://wa.me/55${cleanWhatsappNumber}?text=${encodeURIComponent(orderMessage)}`;

    // Tenta salvar o pedido no Firestore
    let pdvSaved = false;
    let pdvError = null;
    try {
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
      console.log(`Novo pedido ${orderId} salvo no Firestore.`);
    } catch (error) {
      console.error("Erro ao salvar pedido no Firestore:", error);
      pdvError = error.message;
      // Não interrompe, apenas registra o erro e informa o frontend
    }

    // Retorna a URL do WhatsApp e o status do salvamento no PDV
    res.status(200).json({ whatsappUrl: whatsappUrl, pdvSaved: pdvSaved, pdvError: pdvError });

  } catch (error) {
    console.error('Erro geral na API /api/criar-pedido:', error);
    res.status(500).json({ message: 'Erro interno do servidor', error: error.message });
  }
}
