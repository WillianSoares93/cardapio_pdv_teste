// /api/editar-cardapio.js
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';

// --- CONFIGURAÇÃO DE LOGS ---
const log = (message, ...args) => console.log(`[LOG] ${new Date().toISOString()} - ${message}`, ...args);

// --- AUTENTICAÇÃO E CONFIGURAÇÃO DA PLANILHA ---
const auth = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });
const SPREADSHEET_ID = process.env.MENU_SPREADSHEET_ID;

// --- MAPA DE TRADUÇÃO DE CAMPOS ---
const columnTranslationsToSheet = {
    id: 'ID Item (único)',
    name: 'Nome do Item',
    description: 'Descrição',
    price10Slices: 'Preço 10 fatias',
    basePrice: 'Preço 8 fatias',
    price6Slices: 'Preço 6 fatias',
    price4Slices: 'Preço 4 fatias',
    category: 'Categoria',
    isPizza: 'É Pizza? (SIM/NÃO)',
    isCustomizable: 'É Montável? (SIM/NÃO)',
    available: 'Disponível (SIM/NÃO)',
    imageUrl: 'Imagem',
    promoPrice: 'Preco Promocional',
    itemId: 'ID Item Aplicavel',
    active: 'Ativo (SIM/NAO)',
    neighborhood: 'Bairros',
    deliveryFee: 'Valor Frete',
    price: 'Preço',
    isSingleChoice: 'Seleção Única',
    limit: 'Limite',
    ingredientLimit: 'limite ingrediente',
    isRequired: 'É Obrigatório?(SIM/NÃO)',
    data: 'Dados',
    value: 'Valor'
};


// --- FUNÇÃO PRINCIPAL DO HANDLER ---
export default async function handler(req, res) {
    log('--- Início da API editar-cardapio ---');
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    if (!SPREADSHEET_ID) {
        return res.status(500).json({ error: 'A variável de ambiente MENU_SPREADSHEET_ID não está configurada.' });
    }

    try {
        const { sheetName, action, rowIndex, data, rowIndexes, itemId, itemIds } = req.body;
        log('Corpo da requisição recebida:', req.body);
        
        if (!sheetName || !action) {
            return res.status(400).json({ error: 'Nome da planilha e ação são obrigatórios.' });
        }
        
        const sheetMetadata = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
        const sheet = sheetMetadata.data.sheets.find(s => s.properties.title.toLowerCase() === sheetName.toLowerCase());

        if (!sheet) {
            return res.status(404).json({ error: `A planilha (aba) com o nome "${sheetName}" não foi encontrada.` });
        }
        log(`Planilha alvo: "${sheet.properties.title}", Ação: "${action}"`);

        const rangeData = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${sheet.properties.title}!A1:Z` });
        const allRows = rangeData.data.values || [];
        const headers = allRows[0];
        log('Cabeçalhos encontrados na planilha:', headers);
        
        // Função auxiliar para encontrar o índice da coluna de ID
        const findIdColumnIndex = (hdrs) => {
            const idHeaderName = columnTranslationsToSheet.id.toLowerCase();
            return hdrs.findIndex(h => h.toLowerCase() === idHeaderName);
        };

        if (action === 'update') {
            if (!rowIndex || !data) return res.status(400).json({ error: 'Índice da linha e dados são obrigatórios.' });
            log('[UPDATE] Atualizando linha', rowIndex, '. Dados recebidos:', data);

            const originalRowDataResponse = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${sheet.properties.title}!A${rowIndex}:Z${rowIndex}` });
            const originalRowData = originalRowDataResponse.data.values ? originalRowDataResponse.data.values[0] : [];
            log('[UPDATE] Dados originais da linha:', originalRowData);
            
            const newRowData = headers.map((header, index) => {
                const lowerCaseHeader = header.toLowerCase();
                const translatedKey = Object.keys(columnTranslationsToSheet).find(key => columnTranslationsToSheet[key].toLowerCase() === lowerCaseHeader);

                if (translatedKey && data.hasOwnProperty(translatedKey)) {
                    let value = data[translatedKey];
                    // Formatação de Booleans
                    if (typeof value === 'boolean') {
                        return value ? 'SIM' : 'NÃO';
                    }
                    // Formatação de Preços
                    const priceFields = ['basePrice', 'price4Slices', 'price6Slices', 'price10Slices', 'promoPrice', 'price', 'deliveryFee'];
                    if (priceFields.includes(translatedKey) && (typeof value === 'number' || (typeof value === 'string' && value.trim() !== ''))) {
                        const numberValue = parseFloat(String(value).replace(',', '.'));
                        return isNaN(numberValue) ? '' : numberValue.toFixed(2).replace('.', ',');
                    }
                    return value;
                }
                return originalRowData[index] || '';
            });
            
            log('[UPDATE] Dados formatados para envio:', newRowData);

            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `${sheet.properties.title}!A${rowIndex}:${String.fromCharCode(65 + headers.length - 1)}${rowIndex}`,
                valueInputOption: 'USER_ENTERED',
                resource: { values: [newRowData] },
            });
            log('[UPDATE] Resposta da API do Google: 200 OK');

        } else if (action === 'add') {
            if (!data) return res.status(400).json({ error: 'Dados são obrigatórios.' });
             log('[ADD] Adicionando nova linha com dados:', data);

            const newRowData = headers.map(header => {
                const lowerCaseHeader = header.toLowerCase();
                const translatedKey = Object.keys(columnTranslationsToSheet).find(key => columnTranslationsToSheet[key].toLowerCase() === lowerCaseHeader);
                let value = translatedKey ? data[translatedKey] : '';
                
                 if (typeof value === 'boolean') {
                    return value ? 'SIM' : 'NÃO';
                }
                
                const priceFields = ['basePrice', 'price4Slices', 'price6Slices', 'price10Slices', 'promoPrice', 'price', 'deliveryFee'];
                if (priceFields.includes(translatedKey) && (typeof value === 'number' || (typeof value === 'string' && value.trim() !== ''))) {
                     const numberValue = parseFloat(String(value).replace(',', '.'));
                     return isNaN(numberValue) ? '' : numberValue.toFixed(2).replace('.', ',');
                }
                return value || '';
            });
            log('[ADD] Dados formatados para envio:', newRowData);

            await sheets.spreadsheets.values.append({
                spreadsheetId: SPREADSHEET_ID,
                range: `${sheet.properties.title}!A:A`,
                valueInputOption: 'USER_ENTERED',
                resource: { values: [newRowData] },
            });
            log('[ADD] Resposta da API do Google: 200 OK');

        } else if (action === 'delete') {
            if (!itemId) return res.status(400).json({ error: 'ID do item (itemId) não foi recebido. O frontend parece estar desatualizado.' });
            
            const idColumnIndex = findIdColumnIndex(headers);
            if (idColumnIndex === -1) {
                return res.status(500).json({ error: `Coluna de ID '${columnTranslationsToSheet.id}' não encontrada na planilha.` });
            }

            const rowToDelete = allRows.findIndex((row, index) => index > 0 && row[idColumnIndex] == itemId);

            if (rowToDelete === -1) {
                return res.status(404).json({ error: `Item com ID ${itemId} não encontrado.` });
            }
            
            const rowIndexToDelete = rowToDelete + 1; // +1 porque findIndex é 0-based
            log('[DELETE] Encontrado item com ID', itemId, 'na linha', rowIndexToDelete);

            await sheets.spreadsheets.batchUpdate({
                spreadsheetId: SPREADSHEET_ID,
                resource: {
                    requests: [{
                        deleteDimension: {
                            range: {
                                sheetId: sheet.properties.sheetId,
                                dimension: 'ROWS',
                                startIndex: rowIndexToDelete - 1,
                                endIndex: rowIndexToDelete
                            }
                        }
                    }]
                }
            });
            log('[DELETE] Resposta da API do Google: 200 OK - Linha deletada');

        } else if (action === 'bulk-delete') {
            if (!itemIds || itemIds.length === 0) return res.status(400).json({ error: 'Lista de IDs (itemIds) não foi recebida. O frontend parece estar desatualizado.' });
            log('[BULK-DELETE] Deletando itens com IDs:', itemIds);
            
            const idColumnIndex = findIdColumnIndex(headers);
            if (idColumnIndex === -1) {
                return res.status(500).json({ error: `Coluna de ID '${columnTranslationsToSheet.id}' não encontrada na planilha.` });
            }

            const rowIndexesToDelete = [];
            itemIds.forEach(idToFind => {
                const rowIndex = allRows.findIndex((row, index) => index > 0 && row[idColumnIndex] == idToFind);
                if (rowIndex !== -1) {
                    rowIndexesToDelete.push(rowIndex + 1); // +1 para ser 1-based
                }
            });

            if (rowIndexesToDelete.length === 0) {
                 return res.status(404).json({ error: `Nenhum dos IDs fornecidos foi encontrado.` });
            }

            log('[BULK-DELETE] Linhas a serem deletadas:', rowIndexesToDelete);
            const sortedRowIndexes = rowIndexesToDelete.sort((a, b) => b - a);

            const requests = sortedRowIndexes.map(index => ({
                deleteDimension: {
                    range: {
                        sheetId: sheet.properties.sheetId,
                        dimension: 'ROWS',
                        startIndex: index - 1,
                        endIndex: index
                    }
                }
            }));

            await sheets.spreadsheets.batchUpdate({
                spreadsheetId: SPREADSHEET_ID,
                resource: { requests }
            });
            log('[BULK-DELETE] Resposta da API do Google: 200 OK - Linhas deletadas');
            
        } else if (action === 'bulk-update') {
            if (!rowIndexes || !data) return res.status(400).json({ error: 'Índices e dados são obrigatórios.' });
            log('[BULK-UPDATE] Atualizando linhas:', rowIndexes, 'com dados:', data);
            
            const updatedRowsData = [];
            
            for (const rIndex of rowIndexes) {
                const originalRow = allRows[rIndex - 1] ? [...allRows[rIndex - 1]] : new Array(headers.length).fill('');
                
                let newRow = headers.map((header, i) => {
                    const lowerCaseHeader = header.toLowerCase();
                    const translatedKey = Object.keys(columnTranslationsToSheet).find(key => columnTranslationsToSheet[key].toLowerCase() === lowerCaseHeader);
                    
                    if (translatedKey && data.hasOwnProperty(translatedKey)) {
                         let value = data[translatedKey];
                         if (typeof value === 'boolean') return value ? 'SIM' : 'NÃO';
                         return value;
                    }
                    return originalRow[i] || '';
                });

                if (data.priceAdjustment) {
                    const { type, value } = data.priceAdjustment;
                    headers.forEach((header, i) => {
                        const priceFields = ['Preço 10 fatias', 'Preço 8 fatias', 'Preço 6 fatias', 'Preço 4 fatias', 'Preco Promocional', 'Preço', 'Valor Frete'];
                        if (priceFields.includes(header)) {
                             let currentValue = parseFloat(String(newRow[i] || '0').replace(',', '.')) || 0;
                            if (type === 'percent_increase') currentValue *= (1 + value / 100);
                            else if (type === 'percent_decrease') currentValue *= (1 - value / 100);
                            else if (type === 'value_increase') currentValue += value;
                            else if (type === 'value_decrease') currentValue -= value;
                            newRow[i] = Math.max(0, currentValue).toFixed(2).replace('.', ',');
                        }
                    });
                }
                 updatedRowsData.push({
                    range: `${sheet.properties.title}!A${rIndex}:${String.fromCharCode(65 + headers.length - 1)}${rIndex}`,
                    values: [newRow.map(val => val === null || val === undefined ? '' : val)]
                });
            }
             log('[BULK-UPDATE] Dados prontos para batchUpdate:', updatedRowsData);

            await sheets.spreadsheets.values.batchUpdate({
                spreadsheetId: SPREADSHEET_ID,
                resource: {
                    valueInputOption: 'USER_ENTERED',
                    data: updatedRowsData
                }
            });
             log('[BULK-UPDATE] Resposta da API do Google: 200 OK');
        } else {
            return res.status(400).json({ error: 'Ação inválida.' });
        }

        res.status(200).json({ success: true });

    } catch (error) {
        console.error('Erro na API editar-cardapio:', error);
        return res.status(500).json({ error: 'Erro interno no servidor.', details: error.message });
    } finally {
        log('--- Fim da API editar-cardapio ---');
    }
}

