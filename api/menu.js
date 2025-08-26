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



/*Mini Tutorial: Convertendo Links do Google Sheets para Download Direto em CSV
O objetivo é transformar um link normal do Google Sheets em um link especial que, ao ser acessado, baixa diretamente o arquivo .csv de uma aba específica.

Passo 0: Ajustar o Compartilhamento (Obrigatório)
Antes de tudo, para que o link de download funcione para qualquer pessoa ou sistema, você precisa configurar a permissão de acesso corretamente.

Com a planilha aberta, clique no botão "Compartilhar" no canto superior direito.

Na seção "Acesso geral", mude a opção de "Restrito" para "Qualquer pessoa com o link".

Garanta que o papel ao lado esteja definido como "Leitor".

Clique em "Concluído".

Com a permissão ajustada, agora podemos montar o link. Vamos usar este formato como nosso modelo final:

https://docs.google.com/spreadsheets/d/ID_DA_PLANILHA/export?format=csv&gid=ID_DA_ABA

Passo 1: Encontrar o ID da Planilha
Este é o identificador único de todo o seu arquivo.

Olhe para a URL na barra de endereço do seu navegador.

O ID é a longa sequência de letras e números que fica entre /d/ e /edit.

Exemplo:
Se a sua URL for: https://docs.google.com/spreadsheets/d/144LKS4RVcdLgNZUlIie764pQKLJx0G4-zZIIstbszFc/edit#gid=664943668
O ID_DA_PLANILHA é: 144LKS4RVcdLgNZUlIie764pQKLJx0G4-zZIIstbszFc

Passo 2: Encontrar o GID (ID da Aba)
Cada aba (ou página) dentro da sua planilha tem seu próprio ID, chamado de gid.

Clique na aba específica que você quer compartilhar (Ex: "Cardapio", "Promoções", etc.).

Olhe novamente para a URL. O gid é o número que aparece no final, depois de gid=.

Exemplo:
Se a sua URL for: https://docs.google.com/spreadsheets/d/144LKS4RVcdLgNZUlIie764pQKLJx0G4-zZIIstbszFc/edit#gid=664943668
O ID_DA_ABA é: 664943668

Passo 3: Montar o Link Final
Agora, junte as duas partes que você encontrou no nosso modelo:

Comece com o modelo:
https://docs.google.com/spreadsheets/d/ID_DA_PLANILHA/export?format=csv&gid=ID_DA_ABA

Substitua ID_DA_PLANILHA pelo ID que você pegou no Passo 1.

Substitua ID_DA_ABA pelo gid que você pegou no Passo 2.

Resultado Final (usando nosso exemplo):
https://docs.google.com/spreadsheets/d/144LKS4RVcdLgNZUlIie764pQKLJx0G4-zZIIstbszFc/export?format=csv&gid=664943668

*/


//OBS: CASO NÃO TENHA EXTENSÃO DE CONVERTER O LINK, SIGA O TUTORIAL ACIMA.
// URLs das suas planhas Google Sheets publicadas como CSV.
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

        let cardapioJson = parseCsvData(cardapioCsv);

        const itemStatusRef = doc(db, "config", "item_status");
        const itemStatusSnap = await getDoc(itemStatusRef);
        const unavailableItems = itemStatusSnap.exists() ? itemStatusSnap.data() : {};

        cardapioJson = cardapioJson.map(item => {
            if (unavailableItems[item.id] === false) {
                return { ...item, available: false };
            }
            return item;
        });

        res.status(200).json({
            cardapio: cardapioJson,
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
