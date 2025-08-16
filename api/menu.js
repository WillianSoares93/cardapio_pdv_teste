// Este arquivo é uma função Serverless para o Vercel.
// Ele é responsável por buscar os dados do cardápio, promoções, taxas de entrega
// e agora os ingredientes de hambúrguer e informações de contato de planilhas Google Sheets publicadas como CSV e retorná-los para a aplicação front-end.
//
// Para garantir que o Node.js no ambiente Vercel trate este arquivo como um módulo ES (permitindo 'import'),
// você deve ter "type": "module" no seu arquivo package.json.

import fetch from 'node-fetch'; // Importa a biblioteca 'node-fetch' para fazer requisições HTTP

// URLs das suas planilhas Google Sheets publicadas como CSV.
// É CRÍTICO que estas URLs estejam corretas e que as planilhas estejam configuradas
// para serem "Visíveis para qualquer pessoa com o link".
const CARDAPIO_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQJeo2AAETdXC08x9EQlkIG1FiVLEosMng4IvaQYJAdZnIDHJw8CT8J5RAJNtJ5GWHOKHkUsd5V8OSL/pub?gid=664943668&single=true&output=csv'; 
const PROMOCOES_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQJeo2AAETdXC08x9EQlkIG1FiVLEosMng4IvaQYJAdZnIDHJw8CT8J5RAJNtJ5GWHOKHkUsd5V8OSL/pub?gid=600393470&single=true&output=csv'; 
const DELIVERY_FEES_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQJeo2AAETdXC08x9EQlkIG1FiVLEosMng4IvaQYJAdZnIDHJw8CT8J5RAJNtJ5GWHOKHkUsd5V8OSL/pub?gid=1695668250&single=true&output=csv';
const INGREDIENTES_HAMBURGUER_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQJeo2AAETdXC08x9EQlkIG1FiVLEosMng4IvaQYJAdZnIDHJw8CT8J5RAJNtJ5GWHOKHkUsd5V8OSL/pub?gid=1816106560&single=true&output=csv';
const CONTACT_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQJeo2AAETdXC08x9EQlkIG1FiVLEosMng4IvaQYJAdZnIDHJw8CT8J5RAJNtJ5GWHOKHkUsd5V8OSL/pub?gid=2043568216&single=true&output=csv';

// A função principal que será exportada e executada pelo Vercel.
// 'req' é o objeto de requisição (request) e 'res' é o objeto de resposta (response).
export default async (req, res) => {
    // Define cabeçalhos de cache para otimizar o desempenho no Vercel.
    res.setHeader('Cache-Control', 's-maxage=5, stale-while-revalidate'); 

    try {
        console.log('Vercel Function: Iniciando processo de busca de dados...');

        // Função auxiliar para buscar dados de uma URL
        const fetchData = async (url, name) => {
            console.log(`Vercel Function: Tentando buscar dados de ${name} da URL:`, url);
            const response = await fetch(url);
            if (!response.ok) {
                const errorText = await response.text(); 
                console.error(`Vercel Function: Erro HTTP ao buscar ${name}. Status: ${response.status}, StatusText: ${response.statusText}. Corpo da Resposta (parcial): ${errorText.substring(0, 200)}...`);
                throw new Error(`Falha ao buscar ${name}: ${response.statusText || 'Erro desconhecido'}`);
            }
            const data = await response.text();
            console.log(`Vercel Function: Dados de ${name} buscados com sucesso.`);
            return data;
        };

        // --- Busca de dados em paralelo para otimizar o tempo de resposta ---
        const [
            cardapioData,
            promocoesData,
            deliveryFeesData,
            ingredientesHamburguerData,
            contactData
        ] = await Promise.all([
            fetchData(CARDAPIO_CSV_URL, 'Cardápio'),
            fetchData(PROMOCOES_CSV_URL, 'Promoções'),
            fetchData(DELIVERY_FEES_CSV_URL, 'Taxas de Entrega'),
            fetchData(INGREDIENTES_HAMBURGUER_CSV_URL, 'Ingredientes de Hambúrguer'),
            fetchData(CONTACT_CSV_URL, 'Informações de Contato')
        ]);

        // --- Envia a resposta de sucesso ---
        console.log('Vercel Function: Todos os dados foram buscados com sucesso. Enviando resposta JSON.');
        res.status(200).json({
            cardapio: cardapioData,
            promocoes: promocoesData,
            deliveryFees: deliveryFeesData,
            ingredientesHamburguer: ingredientesHamburguerData,
            contact: contactData
        });

    } catch (error) {
        // --- Tratamento de Erros ---
        console.error('Vercel Function: Erro fatal capturado no bloco try-catch:', error.message);
        res.status(500).json({ error: `Erro interno no servidor ao carregar dados: ${error.message}` });
    }
};
