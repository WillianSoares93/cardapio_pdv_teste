// Arquivo: /api/whatsapp-webhook.js
// VERSÃO FINAL: Utiliza o endpoint oficial do Vertex AI com o modelo gemini-1.5-pro-latest.

import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, doc, setDoc, getDoc, deleteDoc, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import fetch from 'node-fetch';
import { SpeechClient } from '@google-cloud/speech';
import { GoogleAuth } from 'google-auth-library';

// --- CONFIGURAÇÃO ---
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

const {
    WHATSAPP_API_TOKEN,
    WHATSAPP_VERIFY_TOKEN,
    WHATSAPP_PHONE_NUMBER_ID,
    GOOGLE_CREDENTIALS_BASE64,
} = process.env;

const GOOGLE_PROJECT_ID = firebaseConfig.projectId;
const GOOGLE_CLOUD_REGION = 'us-central1';

let speechClientInstance = null;

function getSpeechClient() {
    if (speechClientInstance) return speechClientInstance;
    console.log("[LOG] Tentando inicializar o cliente Google Speech...");
    if (GOOGLE_CREDENTIALS_BASE64) {
        try {
            const credentialsJson = Buffer.from(GOOGLE_CREDENTIALS_BASE64, 'base64').toString('utf-8');
            const credentials = JSON.parse(credentialsJson);
            speechClientInstance = new SpeechClient({ credentials });
            console.log("[LOG] Cliente Google Speech inicializado com sucesso.");
            return speechClientInstance;
        } catch (e) {
            console.error("[ERRO CRÍTICO] Falha ao processar as credenciais do Google Cloud:", e);
            return null;
        }
    } else {
        console.warn("[AVISO] Variável de ambiente GOOGLE_CREDENTIALS_BASE64 não encontrada. Transcrição de áudio estará desativada.");
        return null;
    }
}

// --- FUNÇÃO PRINCIPAL DO WEBHOOK ---
export default async function handler(req, res) {
    console.log("--- INÍCIO DA EXECUÇÃO DO WEBHOOK ---");

    if (req.method === 'GET') {
        const mode = req.query['hub.mode'];
        const token = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];
        if (mode === 'subscribe' && token === WHATSAPP_VERIFY_TOKEN) {
            console.log("Verificação do Webhook BEM-SUCEDIDA.");
            return res.status(200).send(challenge);
        } else {
            console.error("Falha na verificação do Webhook: Token ou modo inválido.");
            return res.status(403).send('Forbidden');
        }
    }

    if (req.method === 'POST') {
        const body = req.body;
        if (!body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
            console.log("Webhook recebido, mas sem dados de mensagem. Ignorando.");
            return res.status(200).send('EVENT_RECEIVED');
        }

        const messageData = body.entry[0].changes[0].value.messages[0];
        const userPhoneNumber = messageData.from;
        console.log(`[LOG] Processando mensagem de: ${userPhoneNumber}`);
        await markMessageAsRead(messageData.id);

        try {
            let userMessage = await getUserMessage(messageData, userPhoneNumber);
            if (userMessage === null) {
                console.log("[LOG] Mensagem não processável. Encerrando fluxo.");
                return res.status(200).send('EVENT_RECEIVED');
            }
            console.log(`[LOG] Mensagem do usuário: "${userMessage}"`);

            console.log("[LOG] Carregando estado da conversa e dados do sistema...");
            const [conversationState, systemData] = await Promise.all([
                getConversationState(userPhoneNumber),
                getSystemData(req)
            ]);

            if (!systemData.availableMenu || !systemData.promptTemplate) {
                 throw new Error('Não foi possível carregar os dados do sistema (cardápio ou prompt).');
            }
            console.log("[LOG] Dados carregados com sucesso.");

            conversationState.history.push({ role: 'user', content: userMessage });

            console.log("[LOG] Chamando a API do Gemini via Vertex AI...");
            const responseFromAI = await callVertexAIGemini(userMessage, systemData, conversationState);
            console.log("[LOG] Resposta recebida do Gemini:", JSON.stringify(responseFromAI));

            conversationState.history.push({ role: 'assistant', content: JSON.stringify(responseFromAI) });

            if (responseFromAI.action === "PROCESS_ORDER") {
                console.log("[LOG] Ação da IA: PROCESS_ORDER");
                await processOrderAction(userPhoneNumber, responseFromAI, conversationState);
            } else if (responseFromAI.action === "ANSWER_QUESTION") {
                console.log("[LOG] Ação da IA: ANSWER_QUESTION");
                await saveConversationState(userPhoneNumber, conversationState);
                await sendWhatsAppMessage(userPhoneNumber, responseFromAI.answer);
            } else {
                await sendWhatsAppMessage(userPhoneNumber, "Desculpe, não entendi. Pode repetir, por favor?");
            }

        } catch (error) {
            console.error('[ERRO CRÍTICO NO HANDLER]', error);
            await sendWhatsAppMessage(userPhoneNumber, 'Desculpe, ocorreu um erro inesperado no nosso sistema. A equipe já foi notificada.');
        }

        console.log("--- FIM DA EXECUÇÃO DO WEBHOOK ---");
        return res.status(200).send('EVENT_RECEIVED');
    }

    return res.status(405).send('Method Not Allowed');
}

// --- FUNÇÃO DE CHAMADA À API (CORRIGIDA) ---
async function callVertexAIGemini(userMessage, systemData, conversationState) {
    if (!GOOGLE_CREDENTIALS_BASE64) {
        throw new Error("Credenciais do Google Cloud (GOOGLE_CREDENTIALS_BASE64) não estão configuradas na Vercel.");
    }
    const credentialsJson = Buffer.from(GOOGLE_CREDENTIALS_BASE64, 'base64').toString('utf-8');
    const credentials = JSON.parse(credentialsJson);

    const auth = new GoogleAuth({
        credentials,
        scopes: 'https://www.googleapis.com/auth/cloud-platform'
    });

    const client = await auth.getClient();
    const accessToken = (await client.getAccessToken()).token;

    const { availableMenu, allIngredients, promptTemplate } = systemData;

    const simplifiedMenu = availableMenu.map(item => ({
        name: item.name, category: item.category, description: item.description,
        prices: item.isPizza
            ? { '4 fatias': item.price4Slices, '6 fatias': item.price6Slices, '8 fatias': item.basePrice, '10 fatias': item.price10Slices }
            : { 'padrão': item.basePrice }
    }));

    const prompt = promptTemplate
        .replace(/\${CARDAPIO}/g, JSON.stringify(simplifiedMenu))
        .replace(/\${INGREDIENTES}/g, JSON.stringify(allIngredients))
        .replace(/\${HISTORICO}/g, JSON.stringify(conversationState.history.slice(-6)))
        .replace(/\${ESTADO_PEDIDO}/g, JSON.stringify(conversationState.itens || []))
        .replace(/\${MENSAGEM_CLIENTE}/g, userMessage);

    // --- CORREÇÃO APLICADA AQUI ---
    const modelId = "gemini-1.5-pro-latest";
    const apiEndpoint = `https://${GOOGLE_CLOUD_REGION}-aiplatform.googleapis.com/v1/projects/${GOOGLE_PROJECT_ID}/locations/${GOOGLE_CLOUD_REGION}/publishers/google/models/${modelId}:streamGenerateContent`;

    try {
        const response = await fetch(apiEndpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    responseMimeType: "application/json",
                }
            })
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error("Erro da API Vertex AI (corpo da resposta):", errorBody);
            throw new Error(`Erro na API Vertex AI: ${response.status}. Verifique se a API "Vertex AI" está ATIVA no seu projeto Google Cloud e se o faturamento está configurado.`);
        }

        const data = await response.json();
        
        if (!data[0]?.candidates?.[0]?.content?.parts?.[0]?.text) {
             throw new Error("Resposta inesperada ou vazia da API Vertex AI.");
        }

        const jsonString = data[0].candidates[0].content.parts[0].text;
        return JSON.parse(jsonString);

    } catch (error) {
        console.error("Erro ao chamar ou processar a resposta do Vertex AI Gemini:", error);
        return { action: "ANSWER_QUESTION", answer: 'Desculpe, tive um problema para processar sua solicitação. Pode tentar de outra forma?' };
    }
}


// --- DEMAIS FUNÇÕES (permanecem as mesmas) ---
// ... (código anterior omitido por brevidade) ...

async function getUserMessage(messageData, userPhoneNumber) {
    if (messageData.type === 'text') {
        return messageData.text.body.trim();
    }
    if (messageData.type === 'audio') {
        await sendWhatsAppMessage(userPhoneNumber, 'Ok, processando seu áudio...');
        const mediaId = messageData.audio.id;
        const transcription = await transcribeWithGoogle(mediaId);
        if (!transcription) {
            await sendWhatsAppMessage(userPhoneNumber, 'Desculpe, não consegui entender o áudio. Pode tentar de novo ou enviar por texto?');
            return null;
        }
        return transcription;
    }
    await sendWhatsAppMessage(userPhoneNumber, 'Desculpe, no momento só consigo processar pedidos por texto ou áudio.');
    return null;
}

async function getConversationState(phoneNumber) {
    const stateRef = doc(db, 'pedidos_pendentes_whatsapp', phoneNumber);
    const docSnap = await getDoc(stateRef);
    return docSnap.exists() ? docSnap.data() : { history: [], itens: [], subtotal: 0, endereco: null, pagamento: null };
}

async function saveConversationState(phoneNumber, state) {
    if (state.history.length > 20) {
        state.history = state.history.slice(-20);
    }
    const stateRef = doc(db, 'pedidos_pendentes_whatsapp', phoneNumber);
    await setDoc(stateRef, state);
}

async function getSystemData(req) {
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers.host;
    const apiUrl = `${protocol}://${host}/api/menu`;
    console.log(`[LOG] Buscando dados do sistema em: ${apiUrl}`);
    const [menuData, promptData] = await Promise.all([
        fetch(apiUrl).then(res => res.json()),
        getActivePrompt()
    ]);
    return {
        availableMenu: menuData.cardapio,
        allIngredients: menuData.ingredientesHamburguer,
        promptTemplate: promptData.promptTemplate
    };
}

async function processOrderAction(userPhoneNumber, aiResponse, conversationState) {
    console.log("[LOG] Processando ação de pedido...");
    if (aiResponse.itens && aiResponse.itens.length > 0) {
        conversationState.itens.push(...aiResponse.itens);
    }
    if (aiResponse.address) {
        conversationState.endereco = { rua: aiResponse.address };
    }
    if (aiResponse.paymentMethod) {
        conversationState.pagamento = aiResponse.paymentMethod;
    }
    conversationState.subtotal = conversationState.itens.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    let nextStepMessage = '';
    if (!conversationState.itens || conversationState.itens.length === 0) {
        nextStepMessage = "Não entendi quais itens você gostaria de pedir. Poderia me dizer?";
    } else if (!conversationState.endereco) {
        nextStepMessage = `Ótimo, seu pedido até agora tem ${conversationState.itens.length} item(ns), totalizando ${conversationState.subtotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}. Qual o seu endereço para entrega?`;
    } else if (!conversationState.pagamento) {
        nextStepMessage = `Endereço anotado! Qual será a forma de pagamento? (Dinheiro, Cartão ou Pix)`;
    } else {
        console.log("[LOG] Todas as informações foram coletadas. Finalizando o pedido...");
        await finalizeOrder(userPhoneNumber, conversationState);
        return;
    }
    if (aiResponse.clarification_question) {
        nextStepMessage = aiResponse.clarification_question;
    }
    console.log(`[LOG] Salvando estado e enviando próxima mensagem: "${nextStepMessage}"`);
    await saveConversationState(userPhoneNumber, conversationState);
    await sendWhatsAppMessage(userPhoneNumber, nextStepMessage);
}

async function finalizeOrder(userPhoneNumber, conversationState) {
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
    console.log("[LOG] Salvando pedido final no Firestore...");
    await addDoc(collection(db, "pedidos"), finalOrder);
    console.log("[LOG] Apagando pedido pendente...");
    await deleteDoc(doc(db, 'pedidos_pendentes_whatsapp', userPhoneNumber));
    console.log("[LOG] Enviando mensagem de confirmação final...");
    await sendWhatsAppMessage(userPhoneNumber, '✅ Pedido confirmado e enviado para a cozinha! Agradecemos a preferência.');
}

async function transcribeWithGoogle(mediaId) {
    const speechClient = getSpeechClient();
    if (!speechClient) return null;
    try {
        const audioBuffer = await downloadWhatsAppMedia(mediaId);
        const request = {
            audio: { content: audioBuffer.toString('base64') },
            config: { encoding: 'OGG_OPUS', sampleRateHertz: 16000, languageCode: 'pt-BR' },
        };
        const [response] = await speechClient.recognize(request);
        return response.results.map(r => r.alternatives[0].transcript).join('\n');
    } catch (error) {
        console.error("Erro na transcrição com Google:", error);
        return null;
    }
}

async function downloadWhatsAppMedia(mediaId) {
    const mediaUrlResponse = await fetch(`https://graph.facebook.com/v20.0/${mediaId}`, {
        headers: { 'Authorization': `Bearer ${WHATSAPP_API_TOKEN}` }
    });
    if (!mediaUrlResponse.ok) throw new Error('Falha ao obter URL da mídia da Meta');
    const { url } = await mediaUrlResponse.json();
    const audioResponse = await fetch(url, {
        headers: { 'Authorization': `Bearer ${WHATSAPP_API_TOKEN}` }
    });
    if (!audioResponse.ok) throw new Error('Falha ao fazer download do áudio da Meta');
    return audioResponse.buffer();
}

async function getActivePrompt() {
    console.log("[LOG] Buscando prompt ativo no Firestore...");
    const promptRef = doc(db, "config", "bot_prompt_active");
    const docSnap = await getDoc(promptRef);
    if (docSnap.exists() && docSnap.data().template) {
        console.log("[LOG] Prompt ativo encontrado no Firestore.");
        return { promptTemplate: docSnap.data().template };
    }
    throw new Error("Prompt da IA não encontrado no Firestore. Configure-o na página 'memoria.html'.");
}

async function sendWhatsAppMessage(to, text) {
    const whatsappURL = `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
    console.log(`[LOG] Enviando mensagem para ${to}: "${text}"`);
    try {
        await fetch(whatsappURL, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${WHATSAPP_API_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ messaging_product: 'whatsapp', to, text: { body: text } })
        });
        console.log("[LOG] Mensagem enviada com sucesso.");
    } catch (error) {
        console.error('Erro detalhado ao enviar mensagem pelo WhatsApp:', error);
    }
}

async function markMessageAsRead(messageId) {
    const whatsappURL = `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
    try {
        await fetch(whatsappURL, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${WHATSAPP_API_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: messageId })
        });
    } catch (error) {
        console.warn('Não foi possível marcar a mensagem como lida:', error);
    }
}

