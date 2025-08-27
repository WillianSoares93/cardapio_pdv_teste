// /api/whatsapp-webhook.js

import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, doc, setDoc, getDoc, deleteDoc, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import fetch from 'node-fetch';

// Configuração do Firebase (consistente com o resto do projeto)
const firebaseConfig = {
  apiKey: "AIzaSyBJ44RVDGhBIlQBTx-pyIUp47XDKzRXk84",
  authDomain: "pizzaria-pdv.firebaseapp.com",
  projectId: "pizzaria-pdv",
  storageBucket: "pizzaria-pdv.firebasestorage.app",
  messagingSenderId: "304171744691",
  appId: "1:304171744691:web:e54d7f9fe55c7a75485fc6"
};

// Inicialização segura do Firebase
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(app);

// Carrega as variáveis de ambiente (injetadas pela Vercel)
const { WHATSAPP_API_TOKEN, WHATSAPP_VERIFY_TOKEN, GEMINI_API_KEY } = process.env;

// --- FUNÇÃO PRINCIPAL DO WEBHOOK ---
export default async function handler(req, res) {
    // Rota GET: Verificação do Webhook pela Meta
    if (req.method === 'GET') {
        const mode = req.query['hub.mode'];
        const token = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];

        if (mode === 'subscribe' && token === WHATSAPP_VERIFY_TOKEN) {
            console.log('Webhook verificado com sucesso!');
            return res.status(200).send(challenge);
        } else {
            console.error('Falha na verificação do Webhook.');
            return res.status(403).send('Forbidden');
        }
    }

    // Rota POST: Recebimento de Mensagens do Cliente
    if (req.method === 'POST') {
        const body = req.body;

        if (!body.entry || !body.entry[0].changes || !body.entry[0].changes[0].value.messages) {
            return res.status(200).send('EVENT_RECEIVED');
        }

        const messageData = body.entry[0].changes[0].value.messages[0];
        const userMessage = messageData.text.body.toLowerCase().trim();
        const userPhoneNumber = messageData.from;

        try {
            if (['sim', 's', 'correto', 'isso', 'pode confirmar'].includes(userMessage)) {
                await handleOrderConfirmation(userPhoneNumber);
            } else if (['não', 'n', 'cancelar', 'errado'].includes(userMessage)) {
                await deleteDoc(doc(db, 'pedidos_pendentes_whatsapp', userPhoneNumber));
                await sendWhatsAppMessage(userPhoneNumber, 'Pedido cancelado. Por favor, diga o que você gostaria de pedir.');
            } else {
                await processNewOrder(userPhoneNumber, userMessage);
            }
        } catch (error) {
            console.error('Erro ao processar mensagem:', error);
            await sendWhatsAppMessage(userPhoneNumber, 'Desculpe, ocorreu um erro ao processar seu pedido. Por favor, tente novamente.');
        }

        return res.status(200).send('EVENT_RECEIVED');
    }

    return res.status(405).send('Method Not Allowed');
}


// --- FUNÇÕES AUXILIARES ---

async function processNewOrder(userPhoneNumber, userMessage) {
    const menu = await fetchMenu();
    if (!menu) throw new Error('Não foi possível carregar o cardápio.');

    const structuredOrder = await callGeminiAPI(userMessage, menu);
    if (!structuredOrder || !structuredOrder.itens || structuredOrder.itens.length === 0) {
        const reply = structuredOrder.clarification_question || 'Desculpe, não consegui entender seu pedido. Poderia tentar novamente? Ex: "Quero uma pizza de calabresa grande e uma coca 2L".';
        await sendWhatsAppMessage(userPhoneNumber, reply);
        return;
    }

    const total = structuredOrder.itens.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    structuredOrder.total = total;

    let confirmationMessage = 'Por favor, confirme seu pedido:\n\n';
    structuredOrder.itens.forEach(item => {
        confirmationMessage += `*${item.quantity}x* ${item.name} - R$ ${item.price.toFixed(2).replace('.', ',')}\n`;
    });
    confirmationMessage += `\n*Total: R$ ${total.toFixed(2).replace('.', ',')}*\n\nEstá correto? (Responda "sim" para confirmar)`;

    await setDoc(doc(db, 'pedidos_pendentes_whatsapp', userPhoneNumber), structuredOrder);
    await sendWhatsAppMessage(userPhoneNumber, confirmationMessage);
}

async function handleOrderConfirmation(userPhoneNumber) {
    const pendingOrderRef = doc(db, 'pedidos_pendentes_whatsapp', userPhoneNumber);
    const pendingOrderSnap = await getDoc(pendingOrderRef);

    if (!pendingOrderSnap.exists()) {
        await sendWhatsAppMessage(userPhoneNumber, 'Não encontrei um pedido pendente para confirmar. Por favor, diga o que você gostaria de pedir.');
        return;
    }

    const pendingOrder = pendingOrderSnap.data();
    const finalOrder = {
        itens: pendingOrder.itens,
        endereco: {
            clientName: `Cliente WhatsApp ${userPhoneNumber.slice(-4)}`,
            telefone: userPhoneNumber,
            rua: "Pedido via WhatsApp",
            bairro: "",
            numero: ""
        },
        total: {
            subtotal: pendingOrder.total,
            deliveryFee: 0,
            discount: 0,
            finalTotal: pendingOrder.total
        },
        pagamento: 'A Definir',
        status: 'Novo',
        criadoEm: serverTimestamp()
    };

    await addDoc(collection(db, "pedidos"), finalOrder);
    await deleteDoc(pendingOrderRef);
    await sendWhatsAppMessage(userPhoneNumber, '✅ Pedido confirmado e enviado para a cozinha! Agradecemos a preferência.');
}

async function fetchMenu() {
    try {
        // A Vercel fornece esta variável de ambiente automaticamente.
        const vercelUrl = `https://${process.env.VERCEL_URL}`;
        const response = await fetch(`${vercelUrl}/api/menu`);
        if (!response.ok) return null;
        return await response.json();
    } catch (error) {
        console.error('Erro ao buscar o cardápio:', error);
        return null;
    }
}

async function callGeminiAPI(userMessage, menu) {
    const geminiURL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}`;
    
    const simplifiedMenu = menu.cardapio.map(item => ({
        name: item.name,
        price: item.basePrice || item.price8Slices || item.price6Slices || item.price4Slices,
        category: item.category
    }));

    const prompt = `
        Você é um atendente de pizzaria. Sua tarefa é analisar a mensagem de um cliente e extrair o pedido, usando estritamente os itens do cardápio fornecido.
        O endereço e pagamento serão tratados depois. Foque apenas nos itens.
        Se o cliente pedir algo que não está no cardápio, informe que o item não está disponível na sua resposta de esclarecimento.
        Se o pedido estiver claro, retorne o status "success". Se precisar de mais informações (ex: "qual o tamanho da pizza?"), retorne "needs_clarification" e faça a pergunta.
        Retorne o resultado APENAS em formato JSON.

        CARDÁPIO DISPONÍVEL:
        ${JSON.stringify(simplifiedMenu, null, 2)}

        MENSAGEM DO CLIENTE:
        "${userMessage}"

        FORMATO DE SAÍDA JSON ESPERADO:
        {
          "itens": [
            { "name": "Nome Completo do Item do Cardápio", "price": 55.00, "quantity": 1, "notes": "sem cebola" }
          ],
          "status": "success|needs_clarification",
          "clarification_question": "Se o status for 'needs_clarification', faça a pergunta aqui."
        }
    `;

    try {
        const response = await fetch(geminiURL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Erro na API do Gemini: ${response.status} ${errorBody}`);
        }

        const data = await response.json();
        const jsonString = data.candidates[0].content.parts[0].text;
        const cleanedJsonString = jsonString.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleanedJsonString);

    } catch (error) {
        console.error("Erro ao chamar a API do Gemini:", error);
        return { status: 'error', clarification_question: 'Desculpe, estou com problemas para processar seu pedido agora.' };
    }
}

async function sendWhatsAppMessage(to, text) {
    const whatsappURL = `https://graph.facebook.com/v22.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

    try {
        await fetch(whatsappURL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.WHATSAPP_API_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                to: to,
                text: { body: text }
            })
        });
    } catch (error) {
        console.error('Erro ao enviar mensagem pelo WhatsApp:', error);
    }
}
