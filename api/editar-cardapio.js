// /api/editar-cardapio.js
import { google } from 'googleapis';

const auth = new google.auth.GoogleAuth({
    credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });
const SPREADSHEET_ID = process.env.MENU_SPREADSHEET_ID;

// Função auxiliar para obter todos os nomes de abas para diagnóstico
async function getAllSheetNames() {
    try {
        if (!SPREADSHEET_ID) return ['ERRO: Váriavel de ambiente MENU_SPREADSHEET_ID não configurada.'];
        const response = await sheets.spreadsheets.get({
            spreadsheetId: SPREADSHEET_ID,
        });
        return response.data.sheets.map((s) => s.properties.title);
    } catch (e) {
        console.error("Erro ao buscar nomes das abas:", e.message);
        return [`ERRO ao acessar planilha: ${e.message}`];
    }
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    if (!SPREADSHEET_ID) {
        return res.status(500).json({ error: 'A variável de ambiente MENU_SPREADSHEET_ID não está configurada no servidor.' });
    }

    try {
        const { sheetName, action, rowIndex, data, rowIndexes } = req.body;

        if (!sheetName || !action) {
            return res.status(400).json({ error: 'Nome da planilha e ação são obrigatórios.' });
        }
        
        const allSheetNames = await getAllSheetNames();
        console.log(`[DIAGNÓSTICO] Requisição para a aba: "${sheetName}" na planilha de cardápio.`);
        console.log(`[DIAGNÓSTICO] Abas encontradas na planilha de cardápio:`, allSheetNames);
        
        const sheetId = await getSheetIdByName(sheetName);
        if (sheetId === null) {
            return res.status(404).json({ error: `A planilha (aba) com o nome "${sheetName}" não foi encontrada na sua Planilha de Cardápio. Verifique os logs do servidor para a lista de abas encontradas.` });
        }
        
        const headersResponse = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${sheetName}!1:1` });
        
        if (!headersResponse.data.values || headersResponse.data.values.length === 0 || headersResponse.data.values[0].length === 0) {
            return res.status(400).json({ error: `A planilha "${sheetName}" parece estar vazia ou não tem uma linha de cabeçalho. Por favor, adicione os cabeçalhos para continuar.` });
        }
        const headers = headersResponse.data.values[0];

        // Função auxiliar para mapear os dados na ordem correta dos cabeçalhos
        const mapDataToHeaders = (dataObject) => {
            return headers.map(header => dataObject[header] !== undefined ? dataObject[header] : null);
        };
        
        switch (action) {
            case 'update': {
                if (!rowIndex || !data) return res.status(400).json({ error: 'Índice da linha e dados são obrigatórios.' });
                
                const range = `${sheetName}!A${rowIndex}`;
                const values = [mapDataToHeaders(data)]; // CORREÇÃO AQUI

                await sheets.spreadsheets.values.update({
                    spreadsheetId: SPREADSHEET_ID,
                    range,
                    valueInputOption: 'USER_ENTERED',
                    requestBody: { values },
                });
                break;
            }

            case 'add': {
                if (!data) return res.status(400).json({ error: 'Dados são obrigatórios.' });
                
                const values = [mapDataToHeaders(data)]; // CORREÇÃO AQUI

                await sheets.spreadsheets.values.append({
                    spreadsheetId: SPREADSHEET_ID,
                    range: `${sheetName}!A:A`,
                    valueInputOption: 'USER_ENTERED',
                    requestBody: { values },
                });
                break;
            }

            case 'delete': {
                if (!rowIndex) return res.status(400).json({ error: 'Índice da linha é obrigatório.' });
                
                await sheets.spreadsheets.batchUpdate({
                    spreadsheetId: SPREADSHEET_ID,
                    requestBody: { requests: [{ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: rowIndex - 1, endIndex: rowIndex }}}] },
                });
                break;
            }
            
            case 'bulk-update': {
                if (!rowIndexes || !data) return res.status(400).json({ error: 'Índices e dados são obrigatórios para atualização em massa.' });
                
                const dataToUpdate = [];
                const readRanges = rowIndexes.map(rIndex => `${sheetName}!A${rIndex}:${rIndex}`);
                const existingDataBatch = await sheets.spreadsheets.values.batchGet({ spreadsheetId: SPREADSHEET_ID, ranges: readRanges });

                for (let i = 0; i < rowIndexes.length; i++) {
                    const rIndex = rowIndexes[i];
                    const existingValues = existingDataBatch.data.valueRanges[i].values ? existingDataBatch.data.valueRanges[i].values[0] : [];
                    
                    const updatedData = {};
                    headers.forEach((header, idx) => {
                        updatedData[header] = existingValues[idx] !== undefined ? existingValues[idx] : null;
                    });
                    
                    for (const field in data) {
                        if (field !== 'priceAdjustment') {
                             updatedData[field] = data[field];
                        }
                    }
                    
                    if (data.priceAdjustment) {
                        const { type, value } = data.priceAdjustment;
                        const priceFields = ['basePrice', 'price4Slices', 'price6Slices', 'price10Slices', 'promoPrice', 'price', 'deliveryFee'];
                        
                        priceFields.forEach(field => {
                            if (updatedData[field] !== undefined && updatedData[field] !== null) {
                                let currentValue = parseFloat(String(updatedData[field] || '0').replace(',', '.')) || 0;
                                
                                if (type === 'percent_increase') currentValue *= (1 + value / 100);
                                else if (type === 'percent_decrease') currentValue *= (1 - value / 100);
                                else if (type === 'value_increase') currentValue += value;
                                else if (type === 'value_decrease') currentValue -= value;

                                updatedData[field] = Math.max(0, currentValue).toFixed(2).replace('.',',');
                            }
                        });
                    }
                    
                    dataToUpdate.push({
                        range: `${sheetName}!A${rIndex}`,
                        values: [mapDataToHeaders(updatedData)] // CORREÇÃO AQUI
                    });
                }

                await sheets.spreadsheets.values.batchUpdate({
                    spreadsheetId: SPREADSHEET_ID,
                    requestBody: {
                        valueInputOption: 'USER_ENTERED',
                        data: dataToUpdate
                    }
                });
                break;
            }
            
             case 'bulk-delete': {
                if (!rowIndexes || rowIndexes.length === 0) return res.status(400).json({ error: 'Índices são obrigatórios para exclusão em massa.' });
                
                const sortedIndexes = rowIndexes.sort((a, b) => b - a);
                const deleteRequests = sortedIndexes.map(rIndex => ({
                    deleteDimension: {
                        range: {
                            sheetId,
                            dimension: 'ROWS',
                            startIndex: rIndex - 1,
                            endIndex: rIndex
                        }
                    }
                }));

                await sheets.spreadsheets.batchUpdate({
                    spreadsheetId: SPREADSHEET_ID,
                    requestBody: { requests: deleteRequests }
                });
                break;
            }

            default:
                return res.status(400).json({ error: 'Ação inválida.' });
        }

        return res.status(200).json({ success: true });

    } catch (error) {
        console.error('Erro na API editar-cardapio:', error);
        return res.status(500).json({ error: 'Erro interno no servidor.', details: error.message });
    }
}

async function getSheetIdByName(sheetName) {
    const response = await sheets.spreadsheets.get({
        spreadsheetId: SPREADSHEET_ID,
    });
    const sheet = response.data.sheets.find(
        (s) => s.properties.title === sheetName
    );
    return sheet ? sheet.properties.sheetId : null;
}

