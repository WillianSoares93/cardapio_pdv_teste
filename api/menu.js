// Este arquivo é uma função Serverless para o Vercel.
// Ele foi atualizado para ler a nova coluna "preço 10 fatias" da planilha.

import fetch from 'node-fetch';
import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore, doc, getDoc } from "firebase/firestore";

// Suas credenciais do Firebase
const firebaseConfig = {
  apiKey: "AIzaSyBJ44RVDGhBIlQBTx-pyIUp47XDKzRXk84",
  authDomain: "pizzaria-pdv.firebaseapp.com",
  projectId: "pizzaria-pdv",
  storageBucket: "pizzaria-pdv.firebasestorage.app",
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


// URLs das suas planhas Google Sheets publicadas como CSV.
// CORREÇÃO: As URLs de Taxas de Entrega e Ingredientes foram corrigidas.
const CARDAPIO_CSV_URL = 'https://docs.google.com/spreadsheets/d/144LKS4RVcdLgNZUlIie764pQKLJx0G4-zZIIstbszFc/export?format=csv&gid=664943668';          
const PROMOCOES_CSV_URL = 'https://docs.google.com/spreadsheets/d/144LKS4RVcdLgNZUlIie764pQKLJx0G4-zZIIstbszFc/export?format=csv&gid=600393470'; 
const DELIVERY_FEES_CSV_URL = 'https://docs.google.com/spreadsheets/d/144LKS4RVcdLgNZUlIie764pQKLJx0G4-zZIIstbszFc/export?format=csv&gid=1695668250';
const INGREDIENTES_HAMBURGUER_CSV_URL = 'https://docs.google.com/spreadsheets/d/144LKS4RVcdLgNZUlIie764pQKLJx0G4-zZIIstbszFc/export?format=csv&gid=1816106560';
const CONTACT_CSV_URL = 'https://docs.google.com/spreadsheets/d/144LKS4RVcdLgNZUlIie764pQKLJx0G4-zZIIstbszFc/export?format=csv&gid=2043568216';

// Leitor de linha CSV robusto que lida com vírgulas dentro de aspas
function parseCsvLine(line) {
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
function parseCsvData(csvText) {
    const lines = csvText.split('\n').filter(line => line.trim() !== '');
    if (lines.length < 2) return [];

    const headersRaw = parseCsvLine(lines[0]);
    const mappedHeaders = headersRaw.map(header => {
        const headerMapping = {
            'id item (único)': 'id', 'nome do item': 'name', 'descrição': 'description',
            'preço 4 fatias': 'price4Slices', 'preço 6 fatias': 'price6Slices',
            'preço 8 fatias': 'basePrice', 'preço 10 fatias': 'price10Slices', // <-- NOVA COLUNA ADICIONADA
            'categoria': 'category', 'é pizza? (sim/não)': 'isPizza', 'é montável? (sim/não)': 'isCustomizable',
            'disponível (sim/não)': 'available', 'imagem': 'imageUrl', 'id promocao': 'id',
            'nome da promocao': 'name', 'preco promocional': 'promoPrice', 'id item aplicavel': 'itemId',
            'ativo (sim/nao)': 'active', 'bairros': 'neighborhood', 'valor frete': 'deliveryFee',
            'id intem': 'id', 'ingredientes': 'name', 'preço': 'price', 'seleção única': 'isSingleChoice',
            'limite': 'limit', 'limite ingrediente': 'ingredientLimit',
            'é obrigatório?(sim/não)': 'isRequired', 'disponível': 'available',
            'dados': 'data', 'valor': 'value'
        };
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
                // <-- NOVA COLUNA ADICIONADA À LISTA DE PREÇOS
                if (['basePrice', 'price6Slices', 'price4Slices', 'price10Slices', 'promoPrice', 'deliveryFee', 'price'].includes(headerKey)) {
                    item[headerKey] = parseFloat(String(value).replace(',', '.')) || 0;
                } else if (headerKey === 'limit') {
                    const parsedValue = parseInt(value, 10);
                    item[headerKey] = isNaN(parsedValue) ? Infinity : parsedValue;
                } else if (headerKey === 'ingredientLimit') {
                    const parsedValue = parseInt(value, 10);
                    item[headerKey] = isNaN(parsedValue) ? 1 : parsedValue;
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

// Função melhorada para fetch com retry e headers adequados
async function fetchDataWithRetry(url, maxRetries = 3, delay = 1000) {
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/csv, text/plain, */*',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
    };

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`Tentativa ${attempt}/${maxRetries} para ${url}`);
            
            const response = await fetch(url, {
                method: 'GET',
                headers,
                timeout: 15000, // 15 segundos de timeout
                follow: 10 // Seguir até 10 redirects
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const text = await response.text();
            
            // Verificar se o conteúdo é válido (não é uma página de erro do Google)
            if (text.includes('<!DOCTYPE html>') || text.includes('<html')) {
                throw new Error('Recebido HTML em vez de CSV - possível erro de autenticação');
            }

            console.log(`Sucesso na tentativa ${attempt} para ${url}`);
            return text;

        } catch (error) {
            console.error(`Erro na tentativa ${attempt}/${maxRetries} para ${url}:`, error.message);
            
            if (attempt === maxRetries) {
                throw new Error(`Falha após ${maxRetries} tentativas: ${error.message}`);
            }
            
            // Delay exponencial entre tentativas
            await new Promise(resolve => setTimeout(resolve, delay * attempt));
        }
    }
}

export default async (req, res) => {
    res.setHeader('Cache-Control', 's-maxage=5, stale-while-revalidate'); 

    try {
        console.log('Iniciando busca de dados das planilhas...');

        // Buscar dados com tentativas sequenciais para evitar rate limiting
        const results = {};
        const urls = [
            { key: 'cardapio', url: CARDAPIO_CSV_URL, name: 'Cardápio' },
            { key: 'promocoes', url: PROMOCOES_CSV_URL, name: 'Promoções' },
            { key: 'deliveryFees', url: DELIVERY_FEES_CSV_URL, name: 'Taxa de Entrega' },
            { key: 'ingredientesHamburguer', url: INGREDIENTES_HAMBURGUER_CSV_URL, name: 'Ingredientes' },
            { key: 'contact', url: CONTACT_CSV_URL, name: 'Contatos' }
        ];

        // Buscar sequencialmente para evitar rate limiting
        for (const { key, url, name } of urls) {
            try {
                console.log(`Buscando ${name}...`);
                results[key] = await fetchDataWithRetry(url);
                console.log(`✓ ${name} carregado com sucesso`);
                
                // Pequeno delay entre requisições
                await new Promise(resolve => setTimeout(resolve, 200));
            } catch (error) {
                console.error(`✗ Erro ao carregar ${name}:`, error.message);
                // Usar dados vazios como fallback
                results[key] = '';
            }
        }

        let cardapioJson = parseCsvData(results.cardapio);

        // Verificar status dos itens no Firebase
        const itemStatusRef = doc(db, "config", "item_status");
        const itemStatusSnap = await getDoc(itemStatusRef);
        const unavailableItems = itemStatusSnap.exists() ? itemStatusSnap.data() : {};

        cardapioJson = cardapioJson.map(item => {
            if (unavailableItems[item.id] === false) {
                return { ...item, available: false };
            }
            return item;
        });

        const response = {
            cardapio: cardapioJson,
            promocoes: parseCsvData(results.promocoes),
            deliveryFees: parseCsvData(results.deliveryFees),
            ingredientesHamburguer: parseCsvData(results.ingredientesHamburguer),
            contact: parseCsvData(results.contact),
            timestamp: new Date().toISOString(),
            success: true
        };

        console.log('Dados processados com sucesso');
        res.status(200).json(response);

    } catch (error) {
        console.error('Vercel Function: Erro fatal:', error.message);
        console.error('Stack trace:', error.stack);
        
        res.status(500).json({ 
            error: `Erro interno no servidor: ${error.message}`,
            timestamp: new Date().toISOString(),
            success: false
        });
    }
};
