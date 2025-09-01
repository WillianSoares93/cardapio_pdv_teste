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
function parseCsvData(csvText, type) {
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
        let cardapioJson = parseCsvData(cardapioCsv, 'cardapio');
        let promocoesJson = parseCsvData(promocoesCsv, 'promocoes');
        let deliveryFeesJson = parseCsvData(deliveryFeesCsv, 'delivery');
        let ingredientesHamburguerJson = parseCsvData(ingredientesHamburguerCsv, 'burger_ingredients');
        let ingredientesPizzaJson = parseCsvData(ingredientesPizzaCsv, 'pizza_ingredients');
        let contactJson = parseCsvData(contactCsv, 'contact');

        // Busca todos os documentos de status do Firestore
        const [
            itemStatusSnap, 
            itemVisibilitySnap,
            itemExtrasSnap, 
            pizzaHalfStatusSnap,
            ingredientStatusSnap,
            ingredientVisibilitySnap,
            extraStatusSnap,
            extraVisibilitySnap
        ] = await Promise.all([
             getDoc(doc(db, "config", "item_status")),
             getDoc(doc(db, "config", "item_visibility")),
             getDoc(doc(db, "config", "item_extras_status")),
             getDoc(doc(db, "config", "pizza_half_status")),
             getDoc(doc(db, "config", "ingredient_status")),
             getDoc(doc(db, "config", "ingredient_visibility")),
             getDoc(doc(db, "config", "extra_status")),
             getDoc(doc(db, "config", "extra_visibility"))
        ]);
        
        const itemStatus = itemStatusSnap.exists() ? itemStatusSnap.data() : {};
        const itemVisibility = itemVisibilitySnap.exists() ? itemVisibilitySnap.data() : {};
        const itemExtrasStatus = itemExtrasSnap.exists() ? itemExtrasSnap.data() : {};
        const pizzaHalfStatus = pizzaHalfStatusSnap.exists() ? pizzaHalfStatusSnap.data() : {};
        const ingredientStatus = ingredientStatusSnap.exists() ? ingredientStatusSnap.data() : {};
        const ingredientVisibility = ingredientVisibilitySnap.exists() ? ingredientVisibilitySnap.data() : {};
        const extraStatus = extraStatusSnap.exists() ? extraStatusSnap.data() : {};
        const extraVisibility = extraVisibilitySnap.exists() ? extraVisibilitySnap.data() : {};
        
        // Filtra e atualiza os itens principais do cardápio
        cardapioJson = cardapioJson
            .filter(item => itemVisibility[item.id] !== false) 
            .map(item => ({
                ...item, 
                available: itemStatus[item.id] !== false,
                acceptsExtras: itemExtrasStatus[item.id] === undefined ? item.isPizza : itemExtrasStatus[item.id],
                allowHalf: item.isPizza ? (pizzaHalfStatus[item.id] !== false) : false
            }));

        // Filtra e atualiza os ingredientes de hambúrguer
        ingredientesHamburguerJson = ingredientesHamburguerJson
            .filter(item => ingredientVisibility[item.id] !== false)
            .map(item => ({ ...item, available: ingredientStatus[item.id] !== false }));

        // Filtra e atualiza os adicionais de pizza
        ingredientesPizzaJson = ingredientesPizzaJson
            .filter(item => extraVisibility[item.id] !== false)
            .map(item => ({ ...item, available: extraStatus[item.id] !== false }));

        res.status(200).json({
            cardapio: cardapioJson,
            promocoes: promocoesJson,
            deliveryFees: deliveryFeesJson,
            ingredientesHamburguer: ingredientesHamburguerJson,
            ingredientesPizza: ingredientesPizzaJson,
            contact: contactJson
        });

    } catch (error) {
        console.error('Vercel Function: Erro fatal:', error.message);
        res.status(500).json({ error: `Erro interno no servidor: ${error.message}` });
    }
};

