// /api/historico.js
import fetch from 'node-fetch';

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_NAME = 'encerrados';

// URL para acessar a planilha como CSV (pública)
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${SHEET_NAME}`;

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


export default async (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');

    try {
        const response = await fetch(CSV_URL);
        if (!response.ok) {
            throw new Error(`Erro ao buscar dados da planilha: ${response.statusText}`);
        }
        
        const csvText = await response.text();
        const lines = csvText.split('\n').slice(1); // Pula o cabeçalho
        
        const orders = lines.map(line => {
            if (!line.trim()) return null;

            const values = parseCsvLine(line);
            
            // Mapeia as colunas baseado na ordem definida no 'arquivar-pedido.js'
            return {
                id: values[0],
                date: values[1],
                shortId: values[2],
                type: values[3],
                clientData: values[4],
                items: values[5],
                subtotal: parseFloat(String(values[6]).replace(',', '.')) || 0,
                deliveryFee: parseFloat(String(values[7]).replace(',', '.')) || 0,
                total: parseFloat(String(values[8]).replace(',', '.')) || 0,
                payment: values[9],
                observations: values[10]
            };
        }).filter(Boolean); // Remove linhas nulas

        res.status(200).json(orders);

    } catch (error) {
        console.error('Erro na API /historico:', error);
        res.status(500).json({ error: `Erro interno no servidor: ${error.message}` });
    }
};

