// /api/whatsapp-webhook.js

import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, doc, setDoc, getDoc, deleteDoc, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import fetch from 'node-fetch';
import { SpeechClient } from '@google-cloud/speech';
import FormData from 'form-data'; // Necessário para enviar ficheiros de áudio

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

const { WHATSAPP_API_TOKEN, WHATSAPP_VERIFY_TOKEN, WHATSAPP_PHONE_NUMBER_ID, GEMINI_API_KEY, GOOGLE_CREDENTIALS_BASE64, OPENAI_API_KEY } = process.env;

let speechClient;
if (GOOGLE_CREDENTIALS_BASE64) {
    try {
        const credentialsJson = Buffer.from(GOOGLE_CREDENTIALS_BASE64, 'base64').toString('utf-8');
        const credentials = JSON.parse(credentialsJson);
        speechClient = new SpeechClient({ credentials });
    } catch (e) {
        console.error("Erro ao inicializar o Google Speech Client:", e);
    }
}

// --- FUNÇÃO PRINCIPAL DO WEBHOOK ---
export default async function handler(req, res) {
    console.log("--- INÍCIO DA EXECUÇÃO DO WEBHOOK ---");

    // Verificação do Webhook (GET)
    if (req.method === 'GET') {
        console.log("Recebida requisição GET para verificação.");
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

    // Processamento de Mensagens (POST)
    if (req.method === 'POST') {
        console.log("Recebida requisição POST com dados da mensagem.");
        const body = req.body;
        if (!body.entry || !body.entry[0].changes || !body.entry[0].changes[0].value.messages) {
            console.log("Webhook recebido, mas sem dados de mensagem. Ignorando.");
            return res.status(200).send('EVENT_RECEIVED');
        }

        const messageData = body.entry[0].changes[0].value.messages[0];
        const userPhoneNumber = messageData.from;
        
        console.log(`[LOG] A processar mensagem de: ${userPhoneNumber}`);

        // Inicia a busca de dados do sistema em segundo plano para otimizar o tempo
        const systemDataPromise = getSystemData();

        try {
            // Etapa 1: Obter o texto da mensagem (seja texto ou áudio)
            let userMessage = await getUserMessage(messageData, userPhoneNumber);
            if (userMessage === null) {
                console.log("[LOG] Mensagem não processável (ex: imagem) ou falha na transcrição. A encerrar o fluxo.");
                return res.status(200).send('EVENT_RECEIVED');
            }
             console.log(`[LOG] Mensagem do utilizador (após transcrição se aplicável): "${userMessage}"`);

            // Etapa 2: Carregar o estado da conversa e aguardar os dados do sistema
            console.log("[LOG] A carregar estado da conversa e dados do sistema...");
            const [conversationState, { availableMenu, allIngredients, promptTemplate }] = await Promise.all([
                getConversationState(userPhoneNumber),
                systemDataPromise
            ]);
            
            if (!availableMenu || !promptTemplate) {
                 throw new Error('Não foi possível carregar os dados do sistema (cardápio ou prompt).');
            }
            console.log("[LOG] Estado da conversa e dados do sistema carregados com sucesso.");

            // Etapa 3: Adicionar a mensagem atual ao histórico
            conversationState.history.push({ role: 'user', message: userMessage });

            // Etapa 4: Chamar a IA para interpretar a intenção e os dados
            console.log("[LOG] A chamar a API do Gemini...");
            const responseFromAI = await callGeminiAPI(userMessage, availableMenu, allIngredients, conversationState, promptTemplate);
            console.log("[LOG] Resposta recebida do Gemini:", JSON.stringify(responseFromAI));
            
            // Etapa 5: Adicionar a resposta da IA ao histórico
            conversationState.history.push({ role: 'assistant', message: JSON.stringify(responseFromAI) });
            
            // Etapa 6: Processar a resposta da IA
            if (responseFromAI.action === "PROCESS_ORDER") {
                console.log("[LOG] Ação da IA: PROCESS_ORDER");
                await processOrderAction(userPhoneNumber, responseFromAI, conversationState);
            } else if (responseFromAI.action === "ANSWER_QUESTION") {
                console.log("[LOG] Ação da IA: ANSWER_QUESTION");
                await saveConversationState(userPhoneNumber, conversationState);
                await sendWhatsAppMessage(userPhoneNumber, responseFromAI.answer);
            } else {
                 console.log("[LOG] Ação da IA desconhecida ou em falta. A enviar resposta padrão.");
                await sendWhatsAppMessage(userPhoneNumber, "Desculpe, não entendi. Pode repetir, por favor?");
            }

        } catch (error) {
            console.error('[ERRO CRÍTICO NO HANDLER]', error);
            await sendWhatsAppMessage(userPhoneNumber, 'Desculpe, ocorreu um erro inesperado. A nossa equipa já foi notificada. Por favor, tente novamente mais tarde.');
        }

        console.log("--- FIM DA EXECUÇÃO DO WEBHOOK ---");
        return res.status(200).send('EVENT_RECEIVED');
    }

    return res.status(405).send('Method Not Allowed');
}


// --- FUNÇÕES AUXILIARES DO FLUXO PRINCIPAL ---

async function getUserMessage(messageData, userPhoneNumber) {
    if (messageData.type === 'text') {
        return messageData.text.body.trim();
    }
    if (messageData.type === 'audio') {
        await sendWhatsAppMessage(userPhoneNumber, 'Ok, a processar o seu áudio...');
        const mediaId = messageData.audio.id;
        // Tenta transcrever com Google, se falhar, tenta com OpenAI
        let transcription = await transcribeWithGoogle(mediaId);
        if (!transcription && OPENAI_API_KEY) {
            console.log("Transcrição com Google falhou, a tentar com OpenAI...");
            transcription = await transcribeWithOpenAI(mediaId);
        }

        if (!transcription) {
            await sendWhatsAppMessage(userPhoneNumber, 'Desculpe, não consegui entender o áudio. Pode tentar novamente ou enviar por texto?');
            return null;
        }
        return transcription;
    }
    // Se não for texto nem áudio
    await sendWhatsAppMessage(userPhoneNumber, 'Desculpe, no momento só consigo processar pedidos por texto ou áudio.');
    return null;
}

async function getConversationState(phoneNumber) {
    const stateRef = doc(db, 'pedidos_pendentes_whatsapp', phoneNumber);
    const docSnap = await getDoc(stateRef);
    return docSnap.exists() ? docSnap.data() : { history: [], itens: [], subtotal: 0 };
}

async function saveConversationState(phoneNumber, state) {
    const stateRef = doc(db, 'pedidos_pendentes_whatsapp', phoneNumber);
    await setDoc(stateRef, state);
}

async function getSystemData() {
    console.log("[LOG] A executar getSystemData (Promise.all)...");
    const [menuData, promptData] = await Promise.all([
        getAvailableMenu(),
        getActivePrompt()
    ]);
     console.log("[LOG] getSystemData concluído.");
    return { ...menuData, ...promptData };
}

async function processOrderAction(userPhoneNumber, aiResponse, conversationState) {
    console.log("[LOG] A entrar em processOrderAction...");
    // Atualiza o estado da conversa com os dados extraídos pela IA
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

    // Lógica para decidir o próximo passo
    if (!conversationState.itens || conversationState.itens.length === 0) {
        nextStepMessage = "Não entendi quais itens você gostaria de pedir. Poderia me dizer?";
    } else if (!conversationState.endereco) {
        nextStepMessage = `Ótimo, seu pedido até agora tem ${conversationState.itens.length} item(ns), totalizando ${conversationState.subtotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}. Qual o seu endereço para entrega?`;
    } else if (!conversationState.pagamento) {
        nextStepMessage = `Endereço anotado! Qual será a forma de pagamento? (Dinheiro, Cartão ou Pix)`;
    } else {
        // Se todas as informações estiverem presentes, finaliza o pedido
        console.log("[LOG] Todas as informações recolhidas. A finalizar o pedido...");
        await finalizeOrder(userPhoneNumber, conversationState);
        return; // Sai da função para não enviar outra mensagem
    }
    
    // Se houver uma pergunta de clarificação da IA, usa-a
    if (aiResponse.clarification_question) {
        nextStepMessage = aiResponse.clarification_question;
    }
    
    console.log(`[LOG] A guardar estado e a enviar próxima mensagem: "${nextStepMessage}"`);
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
            deliveryFee: 0, // A ser implementado
            discount: 0,
            finalTotal: conversationState.subtotal
        },
        pagamento: conversationState.pagamento,
        status: 'Novo',
        criadoEm: serverTimestamp()
    };
    
    console.log("[LOG] A guardar pedido final no Firestore...");
    await addDoc(collection(db, "pedidos"), finalOrder);
    console.log("[LOG] A apagar pedido pendente...");
    await deleteDoc(doc(db, 'pedidos_pendentes_whatsapp', userPhoneNumber));
    console.log("[LOG] A enviar mensagem de confirmação final...");
    await sendWhatsAppMessage(userPhoneNumber, '✅ Pedido confirmado e enviado para a cozinha! Agradecemos a preferência.');
}


// --- FUNÇÕES DE TRANSCRIÇÃO ---

async function transcribeWithGoogle(mediaId) {
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

async function transcribeWithOpenAI(mediaId) {
    try {
        const audioBuffer = await downloadWhatsAppMedia(mediaId);
        const formData = new FormData();
        formData.append('file', audioBuffer, { filename: 'audio.ogg', contentType: 'audio/ogg' });
        formData.append('model', 'whisper-1');

        const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` },
            body: formData
        });
        if (!response.ok) throw new Error(`Falha na API OpenAI: ${await response.text()}`);
        const data = await response.json();
        return data.text;
    } catch (error) {
        console.error("Erro na transcrição com OpenAI:", error);
        return null;
    }
}


// --- FUNÇÕES DE DADOS E API ---

async function downloadWhatsAppMedia(mediaId) {
    const mediaUrlResponse = await fetch(`https://graph.facebook.com/v22.0/${mediaId}`, {
        headers: { 'Authorization': `Bearer ${WHATSAPP_API_TOKEN}` }
    });
    if (!mediaUrlResponse.ok) throw new Error('Falha ao obter URL do média da Meta');
    const { url } = await mediaUrlResponse.json();

    const audioResponse = await fetch(url, {
        headers: { 'Authorization': `Bearer ${WHATSAPP_API_TOKEN}` }
    });
    if (!audioResponse.ok) throw new Error('Falha ao fazer download do áudio da Meta');
    return audioResponse.buffer();
}

async function getAvailableMenu() {
    try {
        console.log("[LOG] A buscar /api/menu...");
        const response = await fetch(`https://cardapiopdv.vercel.app/api/menu`);
        if (!response.ok) throw new Error('API do Menu retornou status não-OK');
        
        const fullMenu = await response.json();
        console.log("[LOG] /api/menu obtido com sucesso. A buscar estados no Firestore...");

        const [itemStatusSnap, itemVisibilitySnap, ingredientStatusSnap, ingredientVisibilitySnap] = await Promise.all([
            getDoc(doc(db, "config", "item_status")),
            getDoc(doc(db, "config", "item_visibility")),
            getDoc(doc(db, "config", "ingredient_status")),
            getDoc(doc(db, "config", "ingredient_visibility"))
        ]);
        console.log("[LOG] Estados do Firestore obtidos. A filtrar o cardápio...");

        const unavailableItems = itemStatusSnap.exists() ? itemStatusSnap.data() : {};
        const hiddenItems = itemVisibilitySnap.exists() ? itemVisibilitySnap.data() : {};
        const unavailableIngredients = ingredientStatusSnap.exists() ? ingredientStatusSnap.data() : {};
        const hiddenIngredients = ingredientVisibilitySnap.exists() ? ingredientVisibilitySnap.data() : {};

        const availableMenu = fullMenu.cardapio.filter(item =>
            !unavailableItems[item.id] && !hiddenItems[item.id]
        );
        
        const allIngredients = fullMenu.ingredientesHamburguer
            .filter(ing => !unavailableIngredients[ing.id] && !hiddenIngredients[ing.id]);
        
        console.log(`[LOG] Cardápio filtrado. Itens disponíveis: ${availableMenu.length}. Ingredientes disponíveis: ${allIngredients.length}.`);
        return { availableMenu, allIngredients };
    } catch (error) {
        console.error('Erro ao buscar ou filtrar o cardápio:', error);
        return { availableMenu: null, allIngredients: null };
    }
}

async function getActivePrompt() {
    console.log("[LOG] A buscar prompt ativo no Firestore...");
    const promptRef = doc(db, "config", "bot_prompt_active");
    const docSnap = await getDoc(promptRef);
    if (docSnap.exists() && docSnap.data().template) {
        console.log("[LOG] Prompt ativo encontrado no Firestore.");
        return { promptTemplate: docSnap.data().template };
    }
    console.log("[LOG] Nenhum prompt ativo encontrado no Firestore. A usar fallback.");
    // Fallback se o documento não existir
    return { promptTemplate: `Você é um atendente. Analise a mensagem: "\${MENSAGEM_CLIENTE}" e o cardápio: \${CARDAPIO}. Retorne JSON: { "action": "PROCESS_ORDER", "itens": [...] }` };
}

async function callGeminiAPI(userMessage, menu, ingredients, conversationState, promptTemplate) {
    const geminiURL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`;
    
    const simplifiedMenu = menu.map(item => ({
        name: item.name, category: item.category, description: item.description,
        isPromotional: item.category === 'Promocionais', isCustomizable: item.isCustomizable,
        prices: item.isPizza
            ? { '4 fatias': item.price4Slices, '6 fatias': item.price6Slices, '8 fatias': item.basePrice, '10 fatias': item.price10Slices }
            : { 'padrão': item.basePrice }
    }));

    const prompt = promptTemplate
        .replace(/\${CARDAPIO}/g, JSON.stringify(simplifiedMenu))
        .replace(/\${INGREDIENTES}/g, JSON.stringify(ingredients))
        .replace(/\${HISTORICO}/g, JSON.stringify(conversationState.history.slice(-4))) // Envia apenas as últimas 4 interações
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
        
        if (!data.candidates || !data.candidates[0].content || !data.candidates[0].content.parts[0].text) {
             throw new Error("Resposta inesperada ou vazia da API do Gemini.");
        }
        const jsonString = data.candidates[0].content.parts[0].text;
        const cleanedJsonString = jsonString.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleanedJsonString);
    } catch (error) {
        console.error("Erro ao chamar a API do Gemini:", error);
        return { action: "ANSWER_QUESTION", answer: 'Desculpe, tive um problema para entender o que disse. Pode tentar de outra forma?' };
    }
}

async function sendWhatsAppMessage(to, text) {
    const whatsappURL = `https://graph.facebook.com/v22.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
    console.log(`[LOG] A enviar mensagem para ${to}: "${text}"`);
    try {
        await fetch(whatsappURL, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${WHATSAPP_API_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ messaging_product: 'whatsapp', to: to, text: { body: text } })
        });
        console.log("[LOG] Mensagem enviada com sucesso.");
    } catch (error) {
        console.error('Erro detalhado ao enviar mensagem pelo WhatsApp:', error);
    }
}

