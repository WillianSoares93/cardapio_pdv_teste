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
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { sheetName, action, rowIndex, data, rowIndexes } = req.body;

        if (!sheetName || !action) {
            return res.status(400).json({ error: 'Nome da planilha e ação são obrigatórios.' });
        }
        
        // CORREÇÃO: Verifica se a planilha (aba) existe antes de tentar ler
        const sheetId = await getSheetIdByName(sheetName);
        if (sheetId === null) {
            return res.status(404).json({ error: `A planilha (aba) com o nome "${sheetName}" não foi encontrada no seu arquivo Google Sheets. Por favor, crie-a para continuar.` });
        }
        
        const headersResponse = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${sheetName}!1:1` });
        
        // Mantém a verificação para o caso da planilha existir mas estar vazia.
        if (!headersResponse.data.values || headersResponse.data.values.length === 0 || headersResponse.data.values[0].length === 0) {
            return res.status(400).json({ error: `A planilha "${sheetName}" parece estar vazia ou não tem uma linha de cabeçalho. Por favor, adicione os cabeçalhos para continuar.` });
        }
        const headers = headersResponse.data.values[0];

        switch (action) {
            case 'update': {
                if (!rowIndex || !data) return res.status(400).json({ error: 'Índice da linha e dados são obrigatórios.' });
                
                const range = `${sheetName}!A${rowIndex}`;
                const values = [headers.map(header => data[header])];

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
                
                const values = [headers.map(header => data[header])];

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
                
                // sheetId já foi verificado no início
                await sheets.spreadsheets.batchUpdate({
                    spreadsheetId: SPREADSHEET_ID,
                    requestBody: { requests: [{ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: rowIndex - 1, endIndex: rowIndex }}}] },
                });
                break;
            }
            
            case 'bulk-update': {
                if (!rowIndexes || !data) return res.status(400).json({ error: 'Índices e dados são obrigatórios para atualização em massa.' });
                
                const dataToUpdate = [];
                for (const rIndex of rowIndexes) {
                    const existingDataResponse = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${sheetName}!A${rIndex}:${rIndex}` });
                    const existingValues = existingDataResponse.data.values[0] || [];
                    const updatedValues = [...existingValues];

                    for (const header of headers) {
                        const headerIndex = headers.indexOf(header);
                        if (headerIndex === -1) continue;

                        if (data[header] !== undefined) {
                            updatedValues[headerIndex] = data[header];
                        }
                        
                        if (data.priceAdjustment) {
                            const priceFields = ['basePrice', 'price4Slices', 'price6Slices', 'price10Slices', 'promoPrice', 'price', 'deliveryFee'];
                            if (priceFields.includes(header)) {
                                let currentValue = parseFloat(String(existingValues[headerIndex] || '0').replace(',', '.')) || 0;
                                const { type, value } = data.priceAdjustment;
                                
                                if (type === 'percent_increase') currentValue *= (1 + value / 100);
                                else if (type === 'percent_decrease') currentValue *= (1 - value / 100);
                                else if (type === 'value_increase') currentValue += value;
                                else if (type === 'value_decrease') currentValue -= value;

                                updatedValues[headerIndex] = Math.max(0, currentValue).toFixed(2).replace('.',',');
                            }
                        }
                    }
                    dataToUpdate.push({ range: `${sheetName}!A${rIndex}`, values: [updatedValues] });
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
                
                // sheetId já foi verificado no início
                // Ordena os índices em ordem decrescente para evitar problemas de deslocamento
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

