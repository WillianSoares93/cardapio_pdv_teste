// Este arquivo é uma função Serverless para o Vercel.
// CORRIGIDO: Agora usa o Firebase Admin SDK para ler os status,
// garantindo compatibilidade com navegadores antigos que
// falhavam na autenticação silenciosa do SDK cliente.

import fetch from 'node-fetch';
// --- MUDANÇA: Importando Firebase Admin SDK ---
import { initializeApp, getApps, getApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
// --- FIM DA MUDANÇA ---

// --- INÍCIO DA INICIALIZAÇÃO DO FIREBASE ADMIN ---
let serviceAccountJson;
let firebaseInitialized = false;

if (getApps().length === 0) {
    try {
        const credentialsBase64 = process.env.GOOGLE_CREDENTIALS_BASE64;
        if (!credentialsBase64) {
            throw new Error("Variável de ambiente GOOGLE_CREDENTIALS_BASE64 está ausente.");
        }
        const credentialsJsonString = Buffer.from(credentialsBase64, 'base64').toString('utf-8');
        serviceAccountJson = JSON.parse(credentialsJsonString);
        
        initializeApp({
            credential: cert(serviceAccountJson)
        });
        firebaseInitialized = true;
    } catch (envError) {
        console.error("Erro ao carregar credenciais do Firebase Admin na api/menu.js:", envError.message);
        firebaseInitialized = false;
    }
} else {
    firebaseInitialized = true;
}
// --- FIM DA INICIALIZAÇÃO DO FIREBASE ADMIN ---

// URLs das suas planhas Google Sheets publicadas como CSV.
const CARDAPIO_CSV_URL = 'https://docs.google.com/spreadsheets/d/144LKS4RVcdLgNZUlIie764pQKLJx0G4-zZIIstbszFc/export?format=csv&gid=664943668';          
const PROMOCOES_CSV_URL = 'https://docs.google.com/spreadsheets/d/144LKS4RVcdLgNZUlIie764pQKLJx0G4-zZIIstbszFc/export?format=csv&gid=600393470'; 
const DELIVERY_FEES_CSV_URL = 'https://docs.google.com/spreadsheets/d/144LKS4RVcdLgNZUlIie764pQKLJx0G4-zZIIstbszFc/export?format=csv&gid=1695668250';
const INGREDIENTES_HAMBURGUER_CSV_URL = 'https://docs.google.com/spreadsheets/d/144LKS4RVcdLgNZUlIie764pQKLJx0G4-zZIIstbszFc/export?format=csv&gid=1816106560';
const CONTACT_CSV_URL = 'https://docs.google.com/spreadsheets/d/144LKS4RVcdLgNZUlIie764pQKLJx0G4-zZIIstbszFc/export?format=csv&gid=2043568216';
const INGREDIENTES_PIZZA_CSV_URL = 'https://docs.google.com/spreadsheets/d/144LKS4RVcdLgNZUlIie764pQKLJx0G4-zZIIstbszFc/export?format=csv&gid=1064319795';

// Leitor de linha CSV robusto que lida com vírgulas dentro de aspas
function parseCsvLine(line) {
// ... (código parseCsvLine existente) ...
// ... (código parseCsvLine existente) ...
// ... (código parseCsvLine existente) ...
    const values = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++; // Pula a próxima aspa (escapada)
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            values.push(current.trim());
            current = '';
        } else {
            // Ignora o caractere de retorno de carro
            if (char !== '\r') {
               current += char;
            }
        }
    }
    values.push(current.trim());
    return values;
}

// Função principal para converter texto CSV em um array de objetos JSON
function parseCsvData(csvText, type) {
// ... (código parseCsvData existente) ...
// ... (código parseCsvData existente) ...
// ... (código parseCsvData existente) ...
    const lines = csvText.split('\n').filter(line => line.trim() !== '');
    if (lines.length < 2) return [];

    const headersRaw = parseCsvLine(lines[0]);
    const headerMapping = {
        'id item (único)': 'id', 'nome do item': 'name', 'descrição': 'description',
        'preço 4 fatias': 'price4Slices', 'preço 6 fatias': 'price6Slices',
        'preço 8 fatias': 'basePrice', 'preço 10 fatias': 'price10Slices',
        'categoria': 'category', 'é pizza? (sim/não)': 'isPizza', 'é montável? (sim/não)': 'isCustomizable',
        'disponível (sim/não)': 'available', 'imagem': 'imageUrl',
        'id promocao': 'id', 'nome da promocao': 'name', 'preco promocional': 'promoPrice',
        'id item aplicavel': 'itemId', 'ativo (sim/nao)': 'active',
        'bairros': 'neighborhood', 'valor frete': 'deliveryFee',
        'id intem': 'id', 'ingredientes': 'name', 'preço': 'price', 'seleção única': 'isSingleChoice',
        'limite': 'limit', 'limite ingrediente': 'ingredientLimit',
        'é obrigatório?(sim/não)': 'isRequired', 'disponível': 'available',
        'dados': 'data', 'valor': 'value',
        // Mapeamento para Ingredientes da Pizza
        'adicionais': 'name', 'limite adicionais': 'limit', 'limite categoria': 'categoryLimit'
    };
    if (type === 'pizza_ingredients' || type === 'burger_ingredients') {
        headerMapping['id intem'] = 'id';
        headerMapping['id item (único)'] = 'id';
    }


    const mappedHeaders = headersRaw.map(header => {
        const cleanHeader = header.trim().toLowerCase();
        return headerMapping[cleanHeader] || cleanHeader.replace(/\s/g, '').replace(/[^a-z0-9]/g, '');
    });

    const parsedData = [];
    for (let i = 1; i < lines.length; i++) {
        const values = parseCsvLine(lines[i]);
        if (values.length === mappedHeaders.length) {
            let item = {};
            mappedHeaders.forEach((headerKey, j) => {
                let value = values[j];
                if (['basePrice', 'price6Slices', 'price4Slices', 'price10Slices', 'promoPrice', 'deliveryFee', 'price'].includes(headerKey)) {
                    item[headerKey] = parseFloat(String(value).replace(',', '.')) || 0;
                } else if (['limit', 'categoryLimit', 'ingredientLimit'].includes(headerKey)) {
                    const parsedValue = parseInt(value, 10);
                    item[headerKey] = isNaN(parsedValue) ? Infinity : parsedValue;
                } else if (['isPizza', 'available', 'active', 'isCustomizable', 'isSingleChoice', 'isRequired'].includes(headerKey)) {
                    item[headerKey] = value.toUpperCase() === 'SIM';
                } else {
                    item[headerKey] = value;
                }
            });
            
            // CORREÇÃO: Adiciona prefixo para garantir IDs únicos
            if (type === 'burger_ingredients' && item.id) {
                item.id = `ing-${item.id}`;
            } else if (type === 'pizza_ingredients' && item.id) {
                item.id = `extra-${item.id}`;
            }

            parsedData.push(item);
        }
    }
    return parsedData;
}

export default async (req, res) => {
    // Cache removido para garantir que as alterações de status sejam sempre as mais recentes
    res.setHeader('Cache-Control', 'no-cache');

    // --- MUDANÇA: Verificar inicialização do Admin SDK ---
    if (!firebaseInitialized) {
        console.error('Vercel Function: Firebase Admin SDK não está inicializado.');
        return res.status(503).json({ error: 'Erro interno no servidor: Serviço de configuração indisponível.' });
    }
    // --- FIM DA MUDANÇA ---

    try {
        // --- MUDANÇA: Obter instância do Firestore Admin ---
        const db = getFirestore();
        // --- FIM DA MUDANÇA ---

        const fetchData = async (url) => {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Falha ao buscar dados de ${url}`);
            return response.text();
        };

        const [
            cardapioCsv,
// ... (código de fetch existente) ...
// ... (código de fetch existente) ...
// ... (código de fetch existente) ...
            promocoesCsv,
            deliveryFeesCsv,
            ingredientesHamburguerCsv,
            ingredientesPizzaCsv,
            contactCsv
        ] = await Promise.all([
            fetchData(CARDAPIO_CSV_URL),
            fetchData(PROMOCOES_CSV_URL),
            fetchData(DELIVERY_FEES_CSV_URL),
            fetchData(INGREDIENTES_HAMBURGUER_CSV_URL),
            fetchData(INGREDIENTES_PIZZA_CSV_URL),
            fetchData(CONTACT_CSV_URL)
        ]);
        
        // Processa os dados das planilhas
// ... (código de parseCsvData existente) ...
// ... (código de parseCsvData existente) ...
// ... (código de parseCsvData existente) ...
        let cardapioJson = parseCsvData(cardapioCsv, 'cardapio');
        let promocoesJson = parseCsvData(promocoesCsv, 'promocoes');
        let deliveryFeesJson = parseCsvData(deliveryFeesCsv, 'delivery');
        let ingredientesHamburguerJson = parseCsvData(ingredientesHamburguerCsv, 'burger_ingredients');
        let ingredientesPizzaJson = parseCsvData(ingredientesPizzaCsv, 'pizza_ingredients');
        let contactJson = parseCsvData(contactCsv, 'contact');

        // --- MUDANÇA: Buscar documentos de status usando Admin SDK ---
        const [
            itemStatusSnap, 
            itemVisibilitySnap,
// ... (código de getDoc existente) ...
// ... (código de getDoc existente) ...
// ... (código de getDoc existente) ...
            itemExtrasSnap, 
            pizzaHalfStatusSnap,
            ingredientStatusSnap,
            ingredientVisibilitySnap,
            extraStatusSnap,
            extraVisibilitySnap
        ] = await Promise.all([
             db.collection("config").doc("item_status").get(),
             db.collection("config").doc("item_visibility").get(),
             db.collection("config").doc("item_extras_status").get(),
             db.collection("config").doc("pizza_half_status").get(),
             db.collection("config").doc("ingredient_status").get(),
             db.collection("config").doc("ingredient_visibility").get(),
             db.collection("config").doc("extra_status").get(),
             db.collection("config").doc("extra_visibility").get()
        ]);
        // --- FIM DA MUDANÇA ---
        
        const itemStatus = itemStatusSnap.exists ? itemStatusSnap.data() : {};
// ... (código de processamento de status existente) ...
// ... (código de processamento de status existente) ...
// ... (código de processamento de status existente) ...
        const itemVisibility = itemVisibilitySnap.exists ? itemVisibilitySnap.data() : {};
        const itemExtrasStatus = itemExtrasSnap.exists ? itemExtrasSnap.data() : {};
        const pizzaHalfStatus = pizzaHalfStatusSnap.exists ? pizzaHalfStatusSnap.data() : {};
        const ingredientStatus = ingredientStatusSnap.exists ? ingredientStatusSnap.data() : {};
        const ingredientVisibility = ingredientVisibilitySnap.exists ? ingredientVisibilitySnap.data() : {};
        const extraStatus = extraStatusSnap.exists ? extraStatusSnap.data() : {};
        const extraVisibility = extraVisibilitySnap.exists ? extraVisibilitySnap.data() : {};
        
        // Filtra e atualiza os itens principais do cardápio
// ... (código de filtragem existente) ...
// ... (código de filtragem existente) ...
// ... (código de filtragem existente) ...
        cardapioJson = cardapioJson
            .filter(item => itemVisibility[item.id] !== false) 
            .map(item => ({
                ...item, 
                available: itemStatus[item.id] !== false,
                acceptsExtras: itemExtrasStatus[item.id] === undefined ? item.isPizza : itemExtrasStatus[item.id],
                allowHalf: item.isPizza ? (pizzaHalfStatus[item.id] !== false) : false
            }));

        // Filtra e atualiza os ingredientes de hambúrguer
// ... (código de filtragem existente) ...
// ... (código de filtragem existente) ...
// ... (código de filtragem existente) ...
        ingredientesHamburguerJson = ingredientesHamburguerJson
            .filter(item => ingredientVisibility[item.id] !== false)
            .map(item => ({ ...item, available: ingredientStatus[item.id] !== false }));

        // Filtra e atualiza os adicionais de pizza
// ... (código de filtragem existente) ...
// ... (código de filtragem existente) ...
// ... (código de filtragem existente) ...
        ingredientesPizzaJson = ingredientesPizzaJson
            .filter(item => extraVisibility[item.id] !== false)
            .map(item => ({ ...item, available: extraStatus[item.id] !== false }));

        res.status(200).json({
// ... (código de resposta JSON existente) ...
// ... (código de resposta JSON existente) ...
// ... (código de resposta JSON existente) ...
            cardapio: cardapioJson,
            promocoes: promocoesJson,
            deliveryFees: deliveryFeesJson,
            ingredientesHamburguer: ingredientesHamburguerJson,
            ingredientesPizza: ingredientesPizzaJson,
            contact: contactJson
        });

    } catch (error) {
// ... (código de tratamento de erro existente) ...
// ... (código de tratamento de erro existente) ...
// ... (código de tratamento de erro existente) ...
        console.error('Vercel Function: Erro fatal:', error.message);
        res.status(500).json({ error: `Erro interno no servidor: ${error.message}` });
    }
};

