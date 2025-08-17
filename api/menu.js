// Este arquivo é uma função Serverless para o Vercel.
// Ele foi atualizado para buscar o status de disponibilidade dos itens do Firebase
// e combiná-lo com os dados da planilha antes de enviar ao front-end.

import fetch from 'node-fetch';
import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore, doc, getDoc } from "firebase/firestore";

// Suas credenciais do Firebase
const firebaseConfig = {
  apiKey: "AIzaSyBJ44RVDGhBIlQBTx-pyIUp47XDKzRXk84",
  authDomain: "pizzaria-pdv.firebaseapp.com",
  projectId: "pizzaria-pdv",
  storageBucket: "pizzaria-pdv.appspot.com",
  messagingSenderId: "304171744691",
  appId: "1:304171744691:web:e54d7f9fe55c7a75485fc6"
};

// Inicializa o Firebase de forma segura (evita reinicialização)
let app;
if (!getApps().length) {
    app = initializeApp(firebaseConfig);
} else {
    app = getApp();
}
const db = getFirestore(app);


// URLs das suas planilhas Google Sheets publicadas como CSV.
const CARDAPIO_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQJeo2AAETdXC08x9EQlkIG1FiVLEosMng4IvaQYJAdZnIDHJw8CT8J5RAJNtJ5GWHOKHkUsd5V8OSL/pub?gid=664943668&single=true&output=csv'; 
const PROMOCOES_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQJeo2AAETdXC08x9EQlkIG1FiVLEosMng4IvaQYJAdZnIDHJw8CT8J5RAJNtJ5GWHOKHkUsd5V8OSL/pub?gid=600393470&single=true&output=csv'; 
const DELIVERY_FEES_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQJeo2AAETdXC08x9EQlkIG1FiVLEosMng4IvaQYJAdZnIDHJw8CT8J5RAJNtJ5GWHOKHkUsd5V8OSL/pub?gid=1695668250&single=true&output=csv';
const INGREDIENTES_HAMBURGUER_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQJeo2AAETdXC08x9EQlkIG1FiVLEosMng4IvaQYJAdZnIDHJw8CT8J5RAJNtJ5GWHOKHkUsd5V8OSL/pub?gid=1816106560&single=true&output=csv';
const CONTACT_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQJeo2AAETdXC08x9EQlkIG1FiVLEosMng4IvaQYJAdZnIDHJw8CT8J5RAJNtJ5GWHOKHkUsd5V8OSL/pub?gid=2043568216&single=true&output=csv';

// Função para parsear os dados do CSV para JSON (movida do front-end para cá)
function parseCsvData(csvText) {
    const lines = csvText.split('\n').filter(line => line.trim() !== '');
    if (lines.length === 0) return [];

    const headersRaw = lines[0].split(',').map(h => h.trim().toLowerCase());
    const mappedHeaders = headersRaw.map(header => {
        // Mapeamento de cabeçalhos para nomes de chaves consistentes
        const headerMapping = {
            'id item (único)': 'id', 'nome do item': 'name', 'descrição': 'description',
            'preço 8 fatias': 'basePrice', 'preço 6 fatias': 'price6Slices', 'preço 4 fatias': 'price4Slices',
            'categoria': 'category', 'é pizza? (sim/não)': 'isPizza', 'é montável? (sim/nao)': 'isCustomizable',
            'disponível (sim/não)': 'available', 'imagem': 'imageUrl', 'id promocao': 'id',
            'nome da promocao': 'name', 'preco promocional': 'promoPrice', 'id item aplicavel': 'itemId',
            'ativo (sim/nao)': 'active', 'bairros': 'neighborhood', 'valor frete': 'deliveryFee',
            'id intem': 'id', 'ingredientes': 'name', 'preço': 'price', 'seleção única': 'isSingleChoice',
            'limite': 'limit', 'é obrigatório?(sim/não)': 'isRequired', 'disponível': 'available',
            'dados': 'data', 'valor': 'value'
        };
        return headerMapping[header] || header.replace(/\s/g, '').replace(/[^a-z0-9]/g, '');
    });

    const parsedData = [];
    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, '').replace(/""/g, '"'));
        if (values.length === mappedHeaders.length) {
            let item = {};
            mappedHeaders.forEach((headerKey, j) => {
                let value = values[j];
                if (['basePrice', 'price6Slices', 'price4Slices', 'promoPrice', 'deliveryFee', 'price'].includes(headerKey)) {
                    item[headerKey] = parseFloat(String(value).replace(',', '.')) || 0;
                } else if (['isPizza', 'available', 'active', 'isCustomizable', 'isSingleChoice', 'isRequired'].includes(headerKey)) {
                    item[headerKey] = value.toUpperCase() === 'SIM';
                } else {
                    item[headerKey] = value;
                }
            });
            parsedData.push(item);
        }
    }
    return parsedData;
}


export default async (req, res) => {
    res.setHeader('Cache-Control', 's-maxage=5, stale-while-revalidate'); 

    try {
        const fetchData = async (url) => {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Falha ao buscar dados de ${url}`);
            return response.text();
        };

        const [
            cardapioCsv,
            promocoesCsv,
            deliveryFeesCsv,
            ingredientesHamburguerCsv,
            contactCsv
        ] = await Promise.all([
            fetchData(CARDAPIO_CSV_URL),
            fetchData(PROMOCOES_CSV_URL),
            fetchData(DELIVERY_FEES_CSV_URL),
            fetchData(INGREDIENTES_HAMBURGUER_CSV_URL),
            fetchData(CONTACT_CSV_URL)
        ]);

        // --- LÓGICA DE ATUALIZAÇÃO ---
        // 1. Parseia o cardápio da planilha
        let cardapioJson = parseCsvData(cardapioCsv);

        // 2. Busca o status de disponibilidade do Firebase
        const itemStatusRef = doc(db, "config", "item_status");
        const itemStatusSnap = await getDoc(itemStatusRef);
        const unavailableItems = itemStatusSnap.exists() ? itemStatusSnap.data() : {};

        // 3. Combina as informações
        // Itera sobre o cardápio e, se um item estiver na lista de indisponíveis do Firebase,
        // marca ele como `available: false`.
        cardapioJson = cardapioJson.map(item => {
            if (unavailableItems[item.id] === false) { // Verifica se o ID do item está marcado como indisponível
                return { ...item, available: false };
            }
            return item;
        });

        // Envia a resposta de sucesso com os dados já processados em JSON
        res.status(200).json({
            cardapio: cardapioJson, // Envia o cardápio já em JSON e com a disponibilidade correta
            promocoes: parseCsvData(promocoesCsv),
            deliveryFees: parseCsvData(deliveryFeesCsv),
            ingredientesHamburguer: parseCsvData(ingredientesHamburguerCsv),
            contact: parseCsvData(contactCsv)
        });

    } catch (error) {
        console.error('Vercel Function: Erro fatal:', error.message);
        res.status(500).json({ error: `Erro interno no servidor: ${error.message}` });
    }
};
