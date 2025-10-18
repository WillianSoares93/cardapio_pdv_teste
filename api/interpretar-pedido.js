// Arquivo: /api/interpretar-pedido.js
// Nova API para interpretar um texto de conversa e retornar um pedido estruturado.

import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import fetch from 'node-fetch';
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

const { GOOGLE_CREDENTIALS_BASE64 } = process.env;
const GOOGLE_PROJECT_ID = firebaseConfig.projectId;
const GOOGLE_CLOUD_REGION = 'us-central1';

// --- FUNÇÃO PRINCIPAL DO HANDLER ---
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }

    try {
        const { conversationText } = req.body;
        if (!conversationText) {
            return res.status(400).json({ error: 'O texto da conversa é obrigatório.' });
        }

        const systemData = await getSystemData(req);
        if (!systemData.availableMenu || !systemData.promptTemplate) {
            throw new Error('Não foi possível carregar os dados do sistema (cardápio ou prompt).');
        }

        const responseFromAI = await callVertexAIGemini(conversationText, systemData);
        
        if (responseFromAI.action !== "PROCESS_ORDER" || !responseFromAI.itens) {
            return res.status(400).json({ error: "Não consegui identificar um pedido no texto fornecido. Tente novamente com mais detalhes." });
        }

        const validatedOrder = validateAndStructureOrder(responseFromAI, systemData.availableMenu);
        
        res.status(200).json(validatedOrder);

    } catch (error) {
        console.error('[ERRO EM /api/interpretar-pedido]', error);
        res.status(500).json({ error: `Ocorreu um erro interno: ${error.message}` });
    }
}

// --- FUNÇÃO DE CHAMADA À API (Vertex AI) ---
async function callVertexAIGemini(userMessage, systemData) {
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
        .replace(/\${HISTORICO}/g, '[]') // Sem histórico para análise única
        .replace(/\${ESTADO_PEDIDO}/g, '[]') // Começa com o pedido vazio
        .replace(/\${MENSAGEM_CLIENTE}/g, userMessage);

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
            throw new Error(`Erro na API Vertex AI: ${response.status}. Detalhes: ${errorBody}`);
        }

        const data = await response.json();
        
        if (!data[0]?.candidates?.[0]?.content?.parts?.[0]?.text) {
             throw new Error("Resposta inesperada ou vazia da API Vertex AI.");
        }

        const jsonString = data[0].candidates[0].content.parts[0].text;
        return JSON.parse(jsonString);

    } catch (error) {
        console.error("Erro ao chamar ou processar a resposta do Vertex AI Gemini:", error);
        throw new Error("Falha na comunicação com a IA.");
    }
}

// --- FUNÇÕES DE APOIO ---
async function getSystemData(req) {
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers.host;
    const apiUrl = `${protocol}://${host}/api/menu`;
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

async function getActivePrompt() {
    const promptRef = doc(db, "config", "bot_prompt_active");
    const docSnap = await getDoc(promptRef);
    if (docSnap.exists() && docSnap.data().template) {
        return { promptTemplate: docSnap.data().template };
    }
    throw new Error("Prompt da IA não encontrado no Firestore.");
}

function validateAndStructureOrder(aiResponse, menu) {
    const validatedItems = aiResponse.itens.map(aiItem => {
        // Lógica simples de matching: encontra o item no menu cujo nome está contido no nome do item da IA
        const foundItem = menu.find(menuItem => 
            aiItem.name.toLowerCase().includes(menuItem.name.toLowerCase())
        );

        if (foundItem) {
            // Se encontrou, usa os dados do menu, que são a fonte da verdade
            return {
                ...foundItem, // Pega todos os dados do item do menu (id, category, etc)
                name: aiItem.name, // Mantém o nome completo que a IA gerou (ex: com tamanho ou "meia a meia")
                price: foundItem.basePrice, // Usa o preço base do menu como padrão
                quantity: aiItem.quantity || 1,
                notes: aiItem.notes || "",
                type: foundItem.isCustomizable ? 'custom_burger' : (foundItem.isPizza ? 'full' : 'full'),
                 // Adiciona dados originais para referência no frontend
                originalItem: foundItem 
            };
        }
        return null; // Descarta itens que não foram encontrados no cardápio
    }).filter(Boolean); // Remove os nulos

    return {
        itens: validatedItems,
        clientData: {
            name: aiResponse.clientName || null,
            address: aiResponse.address || null,
            // A IA pode não extrair o contato, então deixamos como nulo
            contact: aiResponse.contact || null 
        },
        paymentMethod: aiResponse.paymentMethod || null
    };
}

