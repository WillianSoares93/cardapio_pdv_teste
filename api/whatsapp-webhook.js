// /api/whatsapp-webhook.js

import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, doc, setDoc, getDoc, deleteDoc, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import fetch from 'node-fetch';
import FormData from 'form-data';
import { Readable } from 'stream';

// Configuração do Firebase
const firebaseConfig = {
  apiKey: "AIzaSyBJ44RVDGhBIlQBTx-pyIUp47XDKzRXk84",
  authDomain: "pizzaria-pdv.firebaseapp.com",
  projectId: "pizzaria-pdv",
  storageBucket: "pizzaria-pdv.firebasestorage.app",
  messagingSenderId: "304171744691",
  appId: "1:304171744691:web:e54d7f9fe55c7a75485fc6"
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(app);

// Carrega as variáveis de ambiente
// IMPORTANTE: Adicione a sua chave da OpenAI nas variáveis de ambiente da Vercel
const { WHATSAPP_API_TOKEN, WHATSAPP_VERIFY_TOKEN, GEMINI_API_KEY, OPENAI_API_KEY } = process.env;

// --- FUNÇÃO PRINCIPAL DO WEBHOOK ---
export default async function handler(req, res) {
    if (req.method === 'GET') {
        const mode = req.query['hub.mode'];
        const token = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];
        if (mode === 'subscribe' && token === WHATSAPP_VERIFY_TOKEN) {
            return res.status(200).send(challenge);
        } else {
            return res.status(403).send('Forbidden');
        }
    }

    if (req.method === 'POST') {
        const body = req.body;
        if (!body.entry || !body.entry[0].changes || !body.entry[0].changes[0].value.messages) {
            return res.status(200).send('EVENT_RECEIVED');
        }

        const messageData = body.entry[0].changes[0].value.messages[0];
        const userPhoneNumber = messageData.from;
        let userMessage = '';

        // V3 Update: Lida com diferentes tipos de mensagem
        if (messageData.type === 'text') {
            userMessage = messageData.text.body.trim();
        } else if (messageData.type === 'audio') {
            await sendWhatsAppMessage(userPhoneNumber, 'Ok, a processar o seu áudio...');
            const mediaId = messageData.audio.id;
            userMessage = await transcribeAudio(mediaId);
            if (!userMessage) {
                await sendWhatsAppMessage(userPhoneNumber, 'Desculpe, não consegui entender o áudio. Pode tentar novamente ou enviar por texto?');
                return res.status(200).send('EVENT_RECEIVED');
            }
        } else {
            await sendWhatsAppMessage(userPhoneNumber, 'Desculpe, no momento só consigo processar pedidos por texto ou áudio.');
            return res.status(200).send('EVENT_RECEIVED');
        }

        try {
            const pendingOrderRef = doc(db, 'pedidos_pendentes_whatsapp', userPhoneNumber);
            const pendingOrderSnap = await getDoc(pendingOrderRef);
            let conversationState = pendingOrderSnap.exists() ? pendingOrderSnap.data() : {};

            switch (conversationState.state) {
                case 'confirming_items':
                    await handleItemsConfirmation(userPhoneNumber, userMessage.toLowerCase(), conversationState);
                    break;
                case 'awaiting_address':
                    await handleAddressCapture(userPhoneNumber, userMessage, conversationState);
                    break;
                case 'awaiting_payment':
                    await handlePaymentCapture(userPhoneNumber, userMessage, conversationState);
                    break;
                case 'confirming_order':
                    await handleFinalConfirmation(userPhoneNumber, userMessage.toLowerCase(), conversationState);
                    break;
                default:
                    await processNewOrder(userPhoneNumber, userMessage);
            }
        } catch (error) {
            console.error('Erro ao processar mensagem:', error);
            await sendWhatsAppMessage(userPhoneNumber, 'Desculpe, ocorreu um erro. Vamos tentar novamente. Por favor, diga o que gostaria de pedir.');
            await deleteDoc(doc(db, 'pedidos_pendentes_whatsapp', userPhoneNumber));
        }

        return res.status(200).send('EVENT_RECEIVED');
    }

    return res.status(405).send('Method Not Allowed');
}

// --- LÓGICA DE TRANSCRIÇÃO DE ÁUDIO ---

async function transcribeAudio(mediaId) {
    try {
        // 1. Obter a URL do ficheiro de áudio da Meta
        const mediaUrlResponse = await fetch(`https://graph.facebook.com/v22.0/${mediaId}`, {
            headers: { 'Authorization': `Bearer ${WHATSAPP_API_TOKEN}` }
        });
        if (!mediaUrlResponse.ok) throw new Error('Falha ao obter URL do média');
        const mediaData = await mediaUrlResponse.json();
        const audioUrl = mediaData.url;

        // 2. Fazer o download do ficheiro de áudio
        const audioResponse = await fetch(audioUrl, {
            headers: { 'Authorization': `Bearer ${WHATSAPP_API_TOKEN}` }
        });
        if (!audioResponse.ok) throw new Error('Falha ao fazer download do áudio');
        const audioBuffer = await audioResponse.buffer();

        // 3. Enviar para a API da OpenAI (Whisper) para transcrição
        const formData = new FormData();
        formData.append('file', audioBuffer, { filename: 'audio.ogg', contentType: 'audio/ogg' });
        formData.append('model', 'whisper-1');
        formData.append('language', 'pt'); // Especifica o idioma para maior precisão

        const transcriptionResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
                ...formData.getHeaders(),
                'Authorization': `Bearer ${OPENAI_API_KEY}`
            },
            body: formData
        });

        if (!transcriptionResponse.ok) {
            const errorBody = await transcriptionResponse.text();
            throw new Error(`Falha na transcrição: ${errorBody}`);
        }

        const transcriptionData = await transcriptionResponse.json();
        return transcriptionData.text;

    } catch (error) {
        console.error("Erro na transcrição de áudio:", error);
        return null;
    }
}


// --- MÁQUINA DE ESTADOS DA CONVERSA (sem alterações) ---

async function processNewOrder(userPhoneNumber, userMessage) {
    const menu = await fetchMenu();
    if (!menu) throw new Error('Não foi possível carregar o cardápio.');

    const structuredOrder = await callGeminiAPI(userMessage, menu, 'items');
    if (!structuredOrder || !structuredOrder.itens || structuredOrder.itens.length === 0) {
        const reply = structuredOrder.clarification_question || 'Desculpe, não consegui entender seu pedido. Poderia ser mais específico? Ex: "Quero uma pizza grande de calabresa e uma coca 2L".';
        await sendWhatsAppMessage(userPhoneNumber, reply);
        return;
    }

    const total = structuredOrder.itens.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    
    let confirmationMessage = 'Certo! Confirme os itens do seu pedido:\n\n';
    structuredOrder.itens.forEach(item => {
        confirmationMessage += `*${item.quantity}x* ${item.name} - R$ ${item.price.toFixed(2).replace('.', ',')}\n`;
        if (item.notes) {
            confirmationMessage += `  _Observação: ${item.notes}_\n`;
        }
    });
    confirmationMessage += `\n*Subtotal: R$ ${total.toFixed(2).replace('.', ',')}*\n\nEstá correto? (Responda "sim" ou "não")`;

    const pendingOrder = {
        state: 'confirming_items',
        itens: structuredOrder.itens,
        subtotal: total
    };

    await setDoc(doc(db, 'pedidos_pendentes_whatsapp', userPhoneNumber), pendingOrder);
    await sendWhatsAppMessage(userPhoneNumber, confirmationMessage);
}

async function handleItemsConfirmation(userPhoneNumber, userMessage, conversationState) {
    if (['sim', 's', 'correto', 'isso'].includes(userMessage)) {
        conversationState.state = 'awaiting_address';
        await setDoc(doc(db, 'pedidos_pendentes_whatsapp', userPhoneNumber), conversationState);
        await sendWhatsAppMessage(userPhoneNumber, 'Ótimo! Qual o seu endereço completo para entrega? (Rua, número, bairro e ponto de referência, se houver)');
    } else {
        await deleteDoc(doc(db, 'pedidos_pendentes_whatsapp', userPhoneNumber));
        await sendWhatsAppMessage(userPhoneNumber, 'Pedido cancelado. Vamos começar de novo. O que você gostaria de pedir?');
    }
}

async function handleAddressCapture(userPhoneNumber, userMessage, conversationState) {
    conversationState.state = 'awaiting_payment';
    conversationState.endereco = {
        rua: userMessage,
        bairro: "",
        numero: ""
    };
    await setDoc(doc(db, 'pedidos_pendentes_whatsapp', userPhoneNumber), conversationState);
    await sendWhatsAppMessage(userPhoneNumber, 'Endereço anotado! Qual será a forma de pagamento? (Dinheiro, Cartão ou Pix)');
}

async function handlePaymentCapture(userPhoneNumber, userMessage, conversationState) {
    conversationState.state = 'confirming_order';
    conversationState.pagamento = userMessage;
    
    let finalMessage = 'Perfeito! Por favor, confirme seu pedido final:\n\n';
    finalMessage += '*ITENS:*\n';
    conversationState.itens.forEach(item => {
        finalMessage += `*${item.quantity}x* ${item.name} - R$ ${item.price.toFixed(2).replace('.', ',')}\n`;
        if (item.notes) {
            finalMessage += `  _Observação: ${item.notes}_\n`;
        }
    });
    finalMessage += `\n*ENDEREÇO:*\n${conversationState.endereco.rua}\n`;
    finalMessage += `\n*PAGAMENTO:*\n${conversationState.pagamento}\n`;
    finalMessage += `\n*TOTAL: R$ ${conversationState.subtotal.toFixed(2).replace('.', ',')}* (taxa de entrega a ser calculada)\n\n`;
    finalMessage += 'Tudo certo para enviar para a cozinha? (Responda "sim" para finalizar)';

    await setDoc(doc(db, 'pedidos_pendentes_whatsapp', userPhoneNumber), conversationState);
    await sendWhatsAppMessage(userPhoneNumber, finalMessage);
}

async function handleFinalConfirmation(userPhoneNumber, userMessage, conversationState) {
    if (['sim', 's', 'correto', 'isso'].includes(userMessage)) {
        const finalOrder = {
            itens: conversationState.itens,
            endereco: {
                clientName: `Cliente WhatsApp ${userPhoneNumber.slice(-4)}`,
                telefone: userPhoneNumber,
                ...conversationState.endereco
            },
            total: {
                subtotal: conversationState.subtotal,
                deliveryFee: 0,
                discount: 0,
                finalTotal: conversationState.subtotal
            },
            pagamento: conversationState.pagamento,
            status: 'Novo',
            criadoEm: serverTimestamp()
        };

        await addDoc(collection(db, "pedidos"), finalOrder);
        await deleteDoc(doc(db, 'pedidos_pendentes_whatsapp', userPhoneNumber));
        await sendWhatsAppMessage(userPhoneNumber, '✅ Pedido confirmado e enviado para a cozinha! Agradecemos a preferência.');
    } else {
        await deleteDoc(doc(db, 'pedidos_pendentes_whatsapp', userPhoneNumber));
        await sendWhatsAppMessage(userPhoneNumber, 'Entendido. Pedido cancelado. Quando quiser, é só começar de novo.');
    }
}


// --- FUNÇÕES DE INTEGRAÇÃO (sem alterações) ---

async function fetchMenu() {
    try {
        const productionUrl = 'https://cardapiopdv.vercel.app';
        const response = await fetch(`${productionUrl}/api/menu`);
        if (!response.ok) return null;
        return await response.json();
    } catch (error) {
        console.error('Erro ao buscar o cardápio:', error);
        return null;
    }
}

async function callGeminiAPI(userMessage, menu, context) {
    const geminiURL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`;
    
    const simplifiedMenu = menu.cardapio.map(item => {
        let prices = {};
        if (item.isPizza) {
            if (item.price4Slices > 0) prices['4 fatias (pequena)'] = item.price4Slices;
            if (item.price6Slices > 0) prices['6 fatias (média)'] = item.price6Slices;
            if (item.basePrice > 0) prices['8 fatias (grande)'] = item.basePrice;
            if (item.price10Slices > 0) prices['10 fatias (gigante)'] = item.price10Slices;
        } else {
            prices['padrão'] = item.basePrice;
        }
        return {
            name: item.name,
            category: item.category,
            isCustomizable: item.isCustomizable,
            prices: prices
        };
    });

    const prompt = `
        Você é um atendente de pizzaria. Sua tarefa é analisar a mensagem de um cliente e extrair o pedido, usando estritamente os itens e preços do cardápio fornecido.
        Se o cliente pedir um tamanho de pizza (pequena, média, grande, gigante, 4 fatias, etc.), use o preço correspondente. Se não especificar, pergunte o tamanho.
        Se o item for customizável (isCustomizable: true), extraia as observações (ex: "sem cebola", "com bacon") para o campo "notes".
        Foque apenas nos itens do pedido. Endereço e pagamento serão tratados depois.
        Retorne o resultado APENAS em formato JSON.

        CARDÁPIO DISPONÍVEL (com tamanhos e preços):
        ${JSON.stringify(simplifiedMenu, null, 2)}

        MENSAGEM DO CLIENTE:
        "${userMessage}"

        FORMATO DE SAÍDA JSON ESPERADO:
        {
          "itens": [
            { "name": "Nome do Item - Tamanho (se aplicável)", "price": 55.00, "quantity": 1, "notes": "sem cebola" }
          ],
          "clarification_question": "Se precisar de mais informações, faça a pergunta aqui."
        }
    `;

    try {
        const response = await fetch(geminiURL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        if (!response.ok) throw new Error(`Erro na API do Gemini: ${response.status}`);
        const data = await response.json();
        const jsonString = data.candidates[0].content.parts[0].text;
        const cleanedJsonString = jsonString.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleanedJsonString);
    } catch (error) {
        console.error("Erro ao chamar a API do Gemini:", error);
        return { clarification_question: 'Desculpe, estou com problemas para processar seu pedido agora.' };
    }
}

async function sendWhatsAppMessage(to, text) {
    const whatsappURL = `https://graph.facebook.com/v22.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
    try {
        const response = await fetch(whatsappURL, {
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
        if (!response.ok) {
            const errorBody = await response.json();
            console.error('Erro da API do WhatsApp:', JSON.stringify(errorBody, null, 2));
        }
    } catch (error) {
        console.error('Erro detalhado ao enviar mensagem pelo WhatsApp:', error);
    }
}
