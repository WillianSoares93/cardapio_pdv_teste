// /api/whatsapp-webhook.js

import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, doc, setDoc, getDoc, deleteDoc, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import fetch from 'node-fetch';
import { SpeechClient } from '@google-cloud/speech';

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
const { WHATSAPP_API_TOKEN, WHATSAPP_VERIFY_TOKEN, GEMINI_API_KEY, GOOGLE_CREDENTIALS_BASE64 } = process.env;

// Configuração do cliente Google Speech-to-Text
let speechClient;
if (GOOGLE_CREDENTIALS_BASE64) {
    const credentialsJson = Buffer.from(GOOGLE_CREDENTIALS_BASE64, 'base64').toString('utf-8');
    const credentials = JSON.parse(credentialsJson);
    speechClient = new SpeechClient({ credentials });
}

// --- FUNÇÃO PRINCIPAL DO WEBHOOK ---
export default async function handler(req, res) {
    if (req.method === 'GET') {
        // Lógica de verificação do Webhook...
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
            let conversationState = pendingOrderSnap.exists() ? pendingOrderSnap.data() : { history: [] };

            // V5 Update: Roteador de Intenções
            const intent = await determineUserIntent(userMessage, conversationState);

            switch (intent) {
                case 'ADD_ITEMS':
                    await processNewOrder(userPhoneNumber, userMessage, conversationState);
                    break;
                case 'PROVIDE_ADDRESS':
                    await handleAddressCapture(userPhoneNumber, userMessage, conversationState);
                    break;
                case 'PROVIDE_PAYMENT':
                    await handlePaymentCapture(userPhoneNumber, userMessage, conversationState);
                    break;
                case 'CONFIRMATION_YES':
                    await handleConfirmation(userPhoneNumber, conversationState);
                    break;
                case 'CONFIRMATION_NO':
                    await handleCancellation(userPhoneNumber, conversationState);
                    break;
                default: // GENERAL_QUERY ou UNKNOWN
                    await sendWhatsAppMessage(userPhoneNumber, "Desculpe, não entendi. Você pode reformular seu pedido ou dúvida?");
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

// --- V5: ROTEADOR DE INTENÇÕES ---
async function determineUserIntent(userMessage, conversationState) {
    const prompt = `
        Analise a mensagem do cliente e o estado atual da conversa para determinar a intenção principal.
        Responda APENAS com uma das seguintes categorias:
        - ADD_ITEMS: O cliente está a pedir, adicionar ou alterar itens do pedido.
        - PROVIDE_ADDRESS: O cliente está a fornecer um endereço.
        - PROVIDE_PAYMENT: O cliente está a informar uma forma de pagamento.
        - CONFIRMATION_YES: O cliente está a confirmar ("sim", "correto", "pode mandar").
        - CONFIRMATION_NO: O cliente está a negar ou cancelar ("não", "errado", "cancelar").
        - GENERAL_QUERY: O cliente está a fazer uma pergunta geral.

        Estado da Conversa: ${conversationState.state || 'novo_pedido'}
        Histórico: ${JSON.stringify(conversationState.history.slice(-4))}
        Mensagem do Cliente: "${userMessage}"

        Intenção:
    `;
    const intent = await callGeminiForText(prompt);
    return intent.trim();
}

// --- MÁQUINA DE ESTADOS DA CONVERSA (V5) ---

async function processNewOrder(userPhoneNumber, userMessage, conversationState) {
    const menu = await fetchMenu();
    if (!menu) throw new Error('Não foi possível carregar o cardápio.');

    const structuredOrder = await callGeminiForOrder(userMessage, menu, conversationState.history);
    if (!structuredOrder || !structuredOrder.itens || structuredOrder.itens.length === 0) {
        const reply = structuredOrder.clarification_question || 'Desculpe, não consegui entender seu pedido. Poderia ser mais específico?';
        await sendWhatsAppMessage(userPhoneNumber, reply);
        return;
    }

    const total = structuredOrder.itens.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    
    let confirmationMessage = 'Certo! Confirme os itens do seu pedido:\n\n';
    structuredOrder.itens.forEach(item => {
        confirmationMessage += `*${item.quantity}x* ${item.name} - ${item.price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}\n`;
        if (item.notes) confirmationMessage += `  _Obs: ${item.notes}_\n`;
    });
    confirmationMessage += `\n*Subtotal: ${total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}*\n\nEstá correto? (Responda "sim" ou "não")`;

    const newConversationState = {
        ...conversationState,
        state: 'confirming_items',
        itens: structuredOrder.itens,
        subtotal: total,
        history: [...conversationState.history, { role: 'user', text: userMessage }, { role: 'bot', text: confirmationMessage }]
    };

    await setDoc(doc(db, 'pedidos_pendentes_whatsapp', userPhoneNumber), newConversationState);
    await sendWhatsAppMessage(userPhoneNumber, confirmationMessage);
}

// V5: Lógica de confirmação unificada
async function handleConfirmation(userPhoneNumber, conversationState) {
    switch (conversationState.state) {
        case 'confirming_items':
            conversationState.state = 'awaiting_address';
            await setDoc(doc(db, 'pedidos_pendentes_whatsapp', userPhoneNumber), conversationState);
            await sendWhatsAppMessage(userPhoneNumber, 'Ótimo! Qual o seu endereço completo para entrega?');
            break;
        case 'confirming_order':
            await handleFinalConfirmation(userPhoneNumber, conversationState);
            break;
        default:
            await sendWhatsAppMessage(userPhoneNumber, "Obrigado por confirmar! Qual o próximo passo?");
    }
}

// V5: Lógica de cancelamento unificada
async function handleCancellation(userPhoneNumber, conversationState) {
     await deleteDoc(doc(db, 'pedidos_pendentes_whatsapp', userPhoneNumber));
     await sendWhatsAppMessage(userPhoneNumber, 'Pedido cancelado. Quando quiser, é só começar de novo.');
}


async function handleAddressCapture(userPhoneNumber, userMessage, conversationState) {
    conversationState.state = 'awaiting_payment';
    conversationState.endereco = { rua: userMessage, bairro: "", numero: "" };
    await setDoc(doc(db, 'pedidos_pendentes_whatsapp', userPhoneNumber), conversationState);
    await sendWhatsAppMessage(userPhoneNumber, 'Endereço anotado! Qual será a forma de pagamento? (Dinheiro, Cartão ou Pix)');
}

async function handlePaymentCapture(userPhoneNumber, userMessage, conversationState) {
    conversationState.state = 'confirming_order';
    conversationState.pagamento = userMessage;
    
    let finalMessage = 'Perfeito! Por favor, confirme seu pedido final:\n\n';
    finalMessage += '*ITENS:*\n';
    conversationState.itens.forEach(item => {
        finalMessage += `*${item.quantity}x* ${item.name} - ${item.price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}\n`;
        if (item.notes) finalMessage += `  _Obs: ${item.notes}_\n`;
    });
    finalMessage += `\n*ENDEREÇO:*\n${conversationState.endereco.rua}\n`;
    finalMessage += `\n*PAGAMENTO:*\n${conversationState.pagamento}\n`;
    finalMessage += `\n*TOTAL: ${conversationState.subtotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}* (taxa de entrega a ser calculada)\n\n`;
    finalMessage += 'Tudo certo para enviar para a cozinha? (Responda "sim" para finalizar)';

    await setDoc(doc(db, 'pedidos_pendentes_whatsapp', userPhoneNumber), conversationState);
    await sendWhatsAppMessage(userPhoneNumber, finalMessage);
}

async function handleFinalConfirmation(userPhoneNumber, conversationState) {
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
}


// --- FUNÇÕES DE INTEGRAÇÃO ---

async function transcribeAudio(mediaId) {
    // ... (código de transcrição com Google Speech-to-Text permanece o mesmo)
}

async function fetchMenu() {
    // ... (código para buscar o menu permanece o mesmo)
}

// V5: Função Gemini genérica para texto
async function callGeminiForText(prompt) {
    const geminiURL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`;
    try {
        const response = await fetch(geminiURL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        if (!response.ok) throw new Error(`Erro na API do Gemini: ${response.status}`);
        const data = await response.json();
        return data.candidates[0].content.parts[0].text;
    } catch (error) {
        console.error("Erro ao chamar a API do Gemini para texto:", error);
        return 'UNKNOWN';
    }
}

// V5: Função Gemini especializada para extrair pedidos
async function callGeminiForOrder(userMessage, menu, history) {
    const geminiURL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`;
    
    const simplifiedMenu = menu.cardapio.map(item => {
        let prices = {};
        if (item.isPizza) {
            if (item.price4Slices > 0) prices['4 fatias'] = item.price4Slices;
            if (item.price6Slices > 0) prices['6 fatias'] = item.price6Slices;
            if (item.basePrice > 0) prices['8 fatias'] = item.basePrice;
            if (item.price10Slices > 0) prices['10 fatias'] = item.price10Slices;
        } else {
            prices['padrão'] = item.basePrice;
        }
        return { name: item.name, category: item.category, isCustomizable: item.isCustomizable, prices: prices };
    });

    const prompt = `
        Você é um atendente de pizzaria. Sua tarefa é analisar a MENSAGEM ATUAL DO CLIENTE e extrair o pedido, usando o CARDÁPIO e o HISTÓRICO da conversa como contexto.
        
        **REGRAS PARA PIZZA MEIO A MEIO:**
        1. Se o cliente pedir dois sabores para uma pizza (ex: "metade calabresa, metade 4 queijos"), crie um único item.
        2. O nome do item deve ser "Pizza [Tamanho] Meio a Meio: [Sabor 1] / [Sabor 2]".
        3. O preço da pizza meio a meio é o preço da pizza inteira que for MAIS CARA entre as duas metades. Calcule este valor.

        **REGRAS GERAIS:**
        - Se o cliente pedir um tamanho de pizza (pequena, média, grande, 4 fatias, etc.), use o preço correspondente. Se não especificar, pergunte o tamanho na "clarification_question".
        - Se o item for customizável (isCustomizable: true), extraia as observações (ex: "sem cebola") para o campo "notes".
        - Retorne o resultado APENAS em formato JSON.

        **CARDÁPIO DISPONÍVEL:**
        ${JSON.stringify(simplifiedMenu, null, 2)}

        **HISTÓRICO DA CONVERSA (últimas mensagens):**
        ${JSON.stringify(history.slice(-4))}

        **MENSAGEM ATUAL DO CLIENTE:**
        "${userMessage}"

        **FORMATO DE SAÍDA JSON ESPERADO:**
        {
          "itens": [
            { "name": "Nome do Item - Tamanho", "price": 55.00, "quantity": 1, "notes": "sem cebola" }
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
        console.error("Erro ao chamar a API do Gemini para extrair pedido:", error);
        return { clarification_question: 'Desculpe, estou com problemas para processar seu pedido agora.' };
    }
}

async function sendWhatsAppMessage(to, text) {
    // ... (código para enviar mensagem permanece o mesmo)
}
