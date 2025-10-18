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
        .replace(/\${INGREDIENTES}/g, JSON.stringify(allIngredients || [])) // Fallback para array vazio
        .replace(/\${HISTORICO}/g, '[]') // Sem histórico para análise única
        .replace(/\${ESTADO_PEDIDO}/g, '[]') // Começa com o pedido vazio
        .replace(/\${MENSAGEM_CLIENTE}/g, userMessage);

    const modelId = "gemini-1.5-flash-latest"; // CORREÇÃO: Usando um modelo estável e disponível.
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
            throw new Error(`Erro na API Vertex AI: ${response.status}. Verifique se a API "Vertex AI" está ATIVA e se o FATURAMENTO está configurado no seu projeto Google Cloud.`);
        }

        const data = await response.json();
        
        if (!data[0]?.candidates?.[0]?.content?.parts?.[0]?.text) {
             throw new Error("Resposta inesperada ou vazia da API Vertex AI.");
        }

        const jsonString = data[0].candidates[0].content.parts[0].text;
        return JSON.parse(jsonString);

    } catch (error) {
        console.error("Erro detalhado ao chamar a API Vertex AI:", error);
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
        const sizeMap = {
            '4 fatias': 'price4Slices',
            '6 fatias': 'price6Slices',
            '8 fatias': 'basePrice',
            '10 fatias': 'price10Slices'
        };

        let itemNameLower = aiItem.name.toLowerCase();
        
        // --- LÓGICA MELHORADA PARA PIZZA MEIA A MEIA ---
        if (itemNameLower.includes('meia ') && (itemNameLower.includes('&') || itemNameLower.includes(' e '))) {
            let sizeKey = 'basePrice'; // Padrão
            let sizeLabel = '8 Fatias';
            for (const sizeText in sizeMap) {
                if (itemNameLower.includes(sizeText)) {
                    sizeKey = sizeMap[sizeText];
                    sizeLabel = sizeText.charAt(0).toUpperCase() + sizeText.slice(1);
                    break;
                }
            }

            // Extrair os nomes dos sabores
            const nameParts = aiItem.name.split(/&| e /);
            const flavor1Name = nameParts[0].replace(/.*meia/i, '').trim();
            const flavor2Name = nameParts[1].replace(/meia/i, '').trim();

            const flavor1Item = menu.find(m => m.name.toLowerCase() === flavor1Name.toLowerCase());
            const flavor2Item = menu.find(m => m.name.toLowerCase() === flavor2Name.toLowerCase());

            if (flavor1Item && flavor2Item) {
                const price1 = flavor1Item[sizeKey] || 0;
                const price2 = flavor2Item[sizeKey] || 0;

                if (price1 === 0 || price2 === 0) return null; // Tamanho inválido para um dos sabores

                const finalPrice = (price1 / 2) + (price2 / 2);

                return {
                    ...flavor1Item, // Usa o primeiro item como base
                    name: aiItem.name,
                    price: finalPrice,
                    quantity: aiItem.quantity || 1,
                    notes: aiItem.notes || "",
                    type: 'split',
                    originalItem: null, // É uma combinação, não um item único
                    firstHalfData: { ...flavor1Item, selectedSize: { label: sizeLabel, priceKey: sizeKey } },
                    secondHalfData: { ...flavor2Item, selectedSize: { label: sizeLabel, priceKey: sizeKey } }
                };
            } else {
                return null; // Um ou ambos os sabores não foram encontrados
            }
        }

        // --- LÓGICA EXISTENTE PARA ITENS NORMAIS ---
        let foundItem = menu.find(menuItem => 
            itemNameLower.includes(menuItem.name.toLowerCase())
        );

        if (!foundItem) {
            return null; // Item não existe no cardápio
        }

        let itemPrice = 0;
        // Se encontrou, determina o preço correto
        if (foundItem.isPizza) {
            let sizeKey = 'basePrice'; // Padrão para 8 fatias se nenhum tamanho for encontrado
            for (const sizeText in sizeMap) {
                if (itemNameLower.includes(sizeText)) {
                    sizeKey = sizeMap[sizeText];
                    break;
                }
            }
            itemPrice = foundItem[sizeKey] || foundItem.basePrice;
        } else {
            itemPrice = foundItem.basePrice;
        }

        // Retorna o item estruturado com o preço correto
        return {
            ...foundItem,
            name: aiItem.name,
            price: itemPrice,
            quantity: aiItem.quantity || 1,
            notes: aiItem.notes || "",
            type: foundItem.isCustomizable ? 'custom_burger' : 'full',
            originalItem: foundItem 
        };

    }).filter(Boolean); // Remove os nulos

    return {
        itens: validatedItems,
        clientData: {
            name: aiResponse.clientName || null,
            address: aiResponse.address || null,
            contact: aiResponse.contact || null 
        },
        paymentMethod: aiResponse.paymentMethod || null
    };
}

