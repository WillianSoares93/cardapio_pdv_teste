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
    // ... (código existente para verificação do GET e POST inicial)
    if (req.method === 'GET') {
        const mode = req.query['hub.mode'];
        const token = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];
        if (mode === 'subscribe' && token === WHATSAPP_VERIFY_TOKEN) {
            console.log("Webhook verificado com sucesso!");
            return res.status(200).send(challenge);
        } else {
            console.error("Falha na verificação do Webhook.");
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

        try {
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

            const pendingOrderRef = doc(db, 'pedidos_pendentes_whatsapp', userPhoneNumber);
            const pendingOrderSnap = await getDoc(pendingOrderRef);
            let conversationState = pendingOrderSnap.exists() ? pendingOrderSnap.data() : { history: [] };
            
            // Adiciona a nova mensagem ao histórico
            conversationState.history = [...(conversationState.history || []), { role: 'user', message: userMessage }];


            const { availableMenu, allIngredients } = await getAvailableMenu();
            if (!availableMenu) throw new Error('Não foi possível carregar o cardápio.');
            
            const responseFromAI = await callGeminiAPI(userMessage, availableMenu, allIngredients, conversationState);

            // Adiciona a resposta da IA ao histórico
            conversationState.history.push({ role: 'assistant', message: responseFromAI });

            if (responseFromAI.action === "PROCESS_ORDER") {
                 await processOrderFlow(userPhoneNumber, responseFromAI, conversationState);
            } else if (responseFromAI.action === "ANSWER_QUESTION") {
                 await setDoc(pendingOrderRef, conversationState); // Salva o histórico da conversa
                 await sendWhatsAppMessage(userPhoneNumber, responseFromAI.answer);
            } else {
                 await sendWhatsAppMessage(userPhoneNumber, "Desculpe, não entendi. Pode repetir, por favor?");
            }

        } catch (error) {
            console.error('Erro ao processar mensagem:', error);
            await sendWhatsAppMessage(userPhoneNumber, 'Desculpe, ocorreu um erro interno. Nossa equipe já foi notificada. Por favor, tente novamente mais tarde.');
            // Não apaga o estado para permitir a depuração
        }

        return res.status(200).send('EVENT_RECEIVED');
    }

    return res.status(405).send('Method Not Allowed');
}


async function processOrderFlow(userPhoneNumber, aiResponse, conversationState) {
    let currentState = conversationState.state || 'initial';
    let currentItens = conversationState.itens || [];
    let currentSubtotal = conversationState.subtotal || 0;

    if (aiResponse.itens && aiResponse.itens.length > 0) {
        currentItens.push(...aiResponse.itens);
        currentSubtotal = currentItens.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        currentState = 'confirming_items';
    }

    if (aiResponse.address) {
        conversationState.endereco = { rua: aiResponse.address };
        currentState = 'awaiting_payment';
    }

    if (aiResponse.paymentMethod) {
        conversationState.pagamento = aiResponse.paymentMethod;
        currentState = 'confirming_order';
    }
    
    conversationState.itens = currentItens;
    conversationState.subtotal = currentSubtotal;
    conversationState.state = currentState;

    const pendingOrderRef = doc(db, 'pedidos_pendentes_whatsapp', userPhoneNumber);

    switch (currentState) {
        case 'confirming_items':
            let confirmationMessage = 'Certo! Adicionei ao seu pedido. O que temos até agora é:\n\n';
            conversationState.itens.forEach(item => {
                confirmationMessage += `*${item.quantity}x* ${item.name} - ${item.price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}\n`;
                if (item.notes) confirmationMessage += `  _Observação: ${item.notes}_\n`;
            });
            confirmationMessage += `\n*Subtotal: ${conversationState.subtotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}*\n\n`;
            confirmationMessage += 'Podemos fechar o pedido ou quer adicionar mais alguma coisa? Se estiver tudo certo, qual o seu endereço para entrega?';
            await setDoc(pendingOrderRef, conversationState);
            await sendWhatsAppMessage(userPhoneNumber, confirmationMessage);
            break;

        case 'awaiting_payment':
            await setDoc(pendingOrderRef, conversationState);
            await sendWhatsAppMessage(userPhoneNumber, 'Endereço anotado! Qual será a forma de pagamento? (Dinheiro, Cartão ou Pix)');
            break;

        case 'confirming_order':
            let finalMessage = 'Perfeito! Por favor, confirme seu pedido final:\n\n';
            finalMessage += '*ITENS:*\n';
            conversationState.itens.forEach(item => {
                finalMessage += `*${item.quantity}x* ${item.name} - ${item.price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}\n`;
            });
            finalMessage += `\n*ENDEREÇO:*\n${conversationState.endereco.rua}\n`;
            finalMessage += `\n*PAGAMENTO:*\n${conversationState.pagamento}\n`;
            finalMessage += `\n*TOTAL: ${conversationState.subtotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}* (taxa de entrega a ser calculada)\n\n`;
            finalMessage += 'Tudo certo para enviar para a cozinha? (Responda "sim" para finalizar)';
            await setDoc(pendingOrderRef, conversationState);
            await sendWhatsAppMessage(userPhoneNumber, finalMessage);
            break;
            
        default:
             await sendWhatsAppMessage(userPhoneNumber, "Não entendi o que quer dizer. Pode tentar novamente?");
    }
}

// --- LÓGICA DE TRANSCRIÇÃO DE ÁUDIO ---
async function transcribeAudio(mediaId) {
    if (!speechClient) {
        console.error("Cliente Google Speech-to-Text não inicializado.");
        return null;
    }
    try {
        const mediaUrlResponse = await fetch(`https://graph.facebook.com/v22.0/${mediaId}`, {
            headers: { 'Authorization': `Bearer ${WHATSAPP_API_TOKEN}` }
        });
        if (!mediaUrlResponse.ok) throw new Error('Falha ao obter URL do média');
        const mediaData = await mediaUrlResponse.json();
        const audioUrl = mediaData.url;

        const audioResponse = await fetch(audioUrl, {
            headers: { 'Authorization': `Bearer ${WHATSAPP_API_TOKEN}` }
        });
        if (!audioResponse.ok) throw new Error('Falha ao fazer download do áudio');
        const audioBuffer = await audioResponse.buffer();

        const audio = { content: audioBuffer.toString('base64') };
        const config = {
            encoding: 'OGG_OPUS',
            sampleRateHertz: 16000,
            languageCode: 'pt-BR',
        };
        const request = { audio: audio, config: config };

        const [response] = await speechClient.recognize(request);
        const transcription = response.results
            .map(result => result.alternatives[0].transcript)
            .join('\n');
        
        return transcription;

    } catch (error) {
        console.error("Erro na transcrição de áudio com Google:", error);
        return null;
    }
}

// --- FUNÇÕES DE INTEGRAÇÃO ---

async function getAvailableMenu() {
    try {
        const productionUrl = 'https://cardapiopdv.vercel.app';
        const response = await fetch(`${productionUrl}/api/menu`);
        if (!response.ok) return { availableMenu: null, allIngredients: null };
        
        const fullMenu = await response.json();

        const itemStatusSnap = await getDoc(doc(db, "config", "item_status"));
        const itemVisibilitySnap = await getDoc(doc(db, "config", "item_visibility"));
        const ingredientStatusSnap = await getDoc(doc(db, "config", "ingredient_status"));
        const ingredientVisibilitySnap = await getDoc(doc(db, "config", "ingredient_visibility"));

        const unavailableItems = itemStatusSnap.exists() ? itemStatusSnap.data() : {};
        const hiddenItems = itemVisibilitySnap.exists() ? itemVisibilitySnap.data() : {};
        const unavailableIngredients = ingredientStatusSnap.exists() ? ingredientStatusSnap.data() : {};
        const hiddenIngredients = ingredientVisibilitySnap.exists() ? ingredientVisibilitySnap.data() : {};

        const availableMenu = fullMenu.cardapio.filter(item => 
            unavailableItems[item.id] !== false && hiddenItems[item.id] !== false
        );

        const allIngredients = {};
        if (fullMenu.ingredientesHamburguer) {
             for (const category of Object.keys(fullMenu.ingredientesHamburguer)) {
                const filteredIngredients = fullMenu.ingredientesHamburguer[category].filter(ing => 
                    unavailableIngredients[ing.id] !== false && hiddenIngredients[ing.id] !== false
                );
                if (filteredIngredients.length > 0) {
                    allIngredients[category] = filteredIngredients;
                }
            }
        }

        return { availableMenu, allIngredients };

    } catch (error) {
        console.error('Erro ao buscar ou filtrar o cardápio:', error);
        return { availableMenu: null, allIngredients: null };
    }
}

async function callGeminiAPI(userMessage, menu, ingredients, conversationState) {
    const geminiURL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`;
    
    // ALTERAÇÃO: Busca o template do prompt do Firestore
    const promptRef = doc(db, "config", "bot_prompt");
    const docSnap = await getDoc(promptRef);
    let promptTemplate = '';

    if (docSnap.exists() && docSnap.data().template) {
        promptTemplate = docSnap.data().template;
    } else {
        // Fallback para o prompt padrão caso não encontre no Firestore
        promptTemplate = `
Você é um atendente de pizzaria inteligente e conversacional. Sua tarefa é analisar a mensagem de um cliente e decidir uma ação.
**AÇÕES POSSÍVEIS:** 1. PROCESS_ORDER: Se o cliente está pedindo, adicionando ou modificando itens, ou fornecendo informações de entrega/pagamento. 2. ANSWER_QUESTION: Se o cliente está fazendo uma pergunta geral.
**REGRAS DE NEGÓCIO:** - Pizza Meio a Meio: O preço é a SOMA da METADE do preço de cada sabor. O nome deve ser "Pizza [Tamanho] Meio a Meio: [Sabor 1] e [Sabor 2]". Pizzas promocionais só combinam com outras promocionais. - Hambúrguer Montável: Calcule o preço somando o valor base com o preço de cada ingrediente escolhido.
**CONTEXTO:** - CARDÁPIO: \${CARDAPIO} - INGREDIENTES DO HAMBÚRGUER: \${INGREDIENTES} - HISTÓRICO DA CONVERSA: \${HISTORICO} - ESTADO ATUAL DO PEDIDO: \${ESTADO_PEDIDO}
**MENSAGEM ATUAL DO CLIENTE:** "\${MENSAGEM_CLIENTE}"
**FORMATO DE SAÍDA JSON:** - Para Ação 1: { "action": "PROCESS_ORDER", "itens": [...], "address": "...", "paymentMethod": "..." } - Para Ação 2: { "action": "ANSWER_QUESTION", "answer": "..." }
Analise a mensagem e retorne o JSON com a ação apropriada.
        `;
    }

    const simplifiedMenu = menu.map(item => ({
        name: item.name,
        category: item.category,
        description: item.description,
        isCustomizable: item.isCustomizable,
        prices: item.isPizza 
            ? { '4 fatias': item.price4Slices, '6 fatias': item.price6Slices, '8 fatias': item.basePrice, '10 fatias': item.price10Slices }
            : { 'padrão': item.basePrice }
    }));
    
    // Preenche o template com os dados dinâmicos
    const prompt = promptTemplate
        .replace(/\${CARDAPIO}/g, JSON.stringify(simplifiedMenu))
        .replace(/\${INGREDIENTES}/g, JSON.stringify(ingredients))
        .replace(/\${HISTORICO}/g, JSON.stringify(conversationState.history || []))
        .replace(/\${ESTADO_PEDIDO}/g, JSON.stringify(conversationState.itens || []))
        .replace(/\${MENSAGEM_CLIENTE}/g, userMessage);


    try {
        const response = await fetch(geminiURL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        if (!response.ok) {
            console.error(await response.text());
            throw new Error(`Erro na API do Gemini: ${response.status}`);
        }
        const data = await response.json();
        
        if (!data.candidates || !data.candidates[0].content.parts[0].text) {
             throw new Error("Resposta inesperada da API do Gemini.");
        }

        const jsonString = data.candidates[0].content.parts[0].text;
        const cleanedJsonString = jsonString.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleanedJsonString);
    } catch (error) {
        console.error("Erro ao chamar a API do Gemini:", error);
        return { action: "ANSWER_QUESTION", answer: 'Desculpe, estou com problemas para processar seu pedido agora.' };
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
            throw new Error(`Falha ao enviar mensagem: ${response.status}`);
        }
    } catch (error) {
        console.error('Erro detalhado ao enviar mensagem pelo WhatsApp:', error);
    }
}

