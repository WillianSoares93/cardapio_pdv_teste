// /api/editar-cardapio.js
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { google } from 'googleapis'; // Usando a biblioteca oficial do Google

// Utiliza o mesmo método de autenticação das outras APIs que já funcionam
const auth = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

// Cliente da API do Google Sheets
const sheets = google.sheets({ version: 'v4', auth });

// Utiliza a variável de ambiente específica para a planilha do cardápio.
const SPREADSHEET_ID = process.env.MENU_SPREADSHEET_ID;

// Mapa para traduzir chaves de objeto JS de volta para os cabeçalhos da planilha
const keyToHeaderMap = {
    'id': ['id item (único)', 'id promocao', 'id intem'],
    'name': ['nome do item', 'nome da promocao', 'ingredientes', 'adicionais'],
    'description': ['descrição'],
    'price4Slices': ['preço 4 fatias'],
    'price6Slices': ['preço 6 fatias'],
    'basePrice': ['preço 8 fatias'],
    'price10Slices': ['preço 10 fatias'],
    'category': ['categoria'],
    'isPizza': ['é pizza? (sim/não)'],
    'isCustomizable': ['é montável? (sim/não)'],
    'available': ['disponível (sim/não)', 'disponível'],
    'imageUrl': ['imagem'],
    'acceptsExtras': ['Aceita Adicionais?'],
    'allowHalf': ['Permite Meia-a-meia?'],
    'promoPrice': ['preco promocional'],
    'itemId': ['id item aplicavel'],
    'active': ['ativo (sim/nao)'],
    'neighborhood': ['bairros'],
    'deliveryFee': ['valor frete'],
    'price': ['preço'],
    'isSingleChoice': ['seleção única'],
    'isRequired': ['é obrigatório?(sim/não)'],
    'limit': ['limite', 'limite adicionais'],
    'ingredientLimit': ['limite ingrediente'],
    'categoryLimit': ['limite categoria'],
    'data': ['dados'],
    'value': ['valor']
};


export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    if (!SPREADSHEET_ID) {
        return res.status(500).json({ error: 'A variável de ambiente MENU_SPREADSHEET_ID não está configurada no servidor.' });
    }

    // Usaremos a biblioteca antiga apenas para conveniência de leitura de dados
    const doc = new GoogleSpreadsheet(SPREADSHEET_ID, auth);

    try {
        await doc.loadInfo(); // Carrega as informações da planilha

        const { sheetName, action, rowIndex, data, rowIndexes } = req.body;
        
        if (!sheetName || !action) {
            return res.status(400).json({ error: 'Nome da planilha e ação são obrigatórios.' });
        }
        
        const sheet = doc.sheetsByTitle[sheetName];
        if (!sheet) {
            return res.status(404).json({ error: `A planilha (aba) com o nome "${sheetName}" não foi encontrada.` });
        }

        await sheet.loadHeaderRow();
        const sheetHeaders = sheet.headerValues;

        const getHeaderInSheet = (key) => {
            const possibleHeaders = keyToHeaderMap[key];
            return possibleHeaders ? possibleHeaders.find(h => sheetHeaders.includes(h)) : undefined;
        };

        const priceKeys = ['basePrice', 'price4Slices', 'price6Slices', 'price10Slices', 'promoPrice', 'price', 'deliveryFee'];

        const formatValueForSheet = (key, header, value) => {
            if (header && (header.includes('(sim/não)') || header.includes('(sim/nao)'))) {
                if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
                if (value === 'true') return 'Sim';
                if (value === 'false') return 'Não';
            }
            if (priceKeys.includes(key)) {
                const num = parseFloat(String(value).replace(',', '.'));
                return !isNaN(num) ? num.toFixed(2).replace('.', ',') : value;
            }
            return value;
        };


        switch (action) {
            case 'add': {
                if (!data) return res.status(400).json({ error: 'Dados são obrigatórios.' });
                const newRowData = sheetHeaders.map(header => {
                    const key = Object.keys(keyToHeaderMap).find(k => keyToHeaderMap[k].includes(header));
                    return key ? formatValueForSheet(key, header, data[key]) : '';
                });
                await sheets.spreadsheets.values.append({
                    spreadsheetId: SPREADSHEET_ID,
                    range: sheetName,
                    valueInputOption: 'USER_ENTERED',
                    resource: { values: [newRowData] },
                });
                break;
            }

            case 'update': {
                if (!rowIndex || !data) return res.status(400).json({ error: 'Índice da linha e dados são obrigatórios.' });
                const rows = await sheet.getRows();
                const rowToUpdate = rows[rowIndex - 2];
                if (rowToUpdate) {
                    const updatedRowData = sheetHeaders.map(header => {
                        const key = Object.keys(keyToHeaderMap).find(k => keyToHeaderMap[k].includes(header));
                        return data.hasOwnProperty(key) ? formatValueForSheet(key, header, data[key]) : rowToUpdate.get(header);
                    });
                    await sheets.spreadsheets.values.update({
                        spreadsheetId: SPREADSHEET_ID,
                        range: `${sheetName}!A${rowIndex}`,
                        valueInputOption: 'USER_ENTERED',
                        resource: { values: [updatedRowData] },
                    });
                }
                break;
            }
            
            case 'bulk-update': {
                if (!rowIndexes || !data) return res.status(400).json({ error: 'Índices e dados são obrigatórios.' });
                const rows = await sheet.getRows();
                const dataForUpdate = [];

                for (const rIndex of rowIndexes) {
                    const row = rows[rIndex - 2];
                    if (row) {
                        const updatedRowData = new Map(row.toObject());
                        
                        // Aplica as alterações
                        for (const field in data) {
                            if (field !== 'priceAdjustment') {
                                const header = getHeaderInSheet(field);
                                if (header) {
                                    updatedRowData.set(header, formatValueForSheet(field, header, data[field]));
                                }
                            }
                        }

                        // Aplica ajuste de preço
                        if (data.priceAdjustment) {
                            const { type, value } = data.priceAdjustment;
                            priceKeys.forEach(fieldKey => {
                                const header = getHeaderInSheet(fieldKey);
                                if (header) {
                                    let currentValue = parseFloat(String(updatedRowData.get(header) || '0').replace(',', '.')) || 0;
                                    if (type === 'percent_increase') currentValue *= (1 + value / 100);
                                    else if (type === 'percent_decrease') currentValue *= (1 - value / 100);
                                    else if (type === 'value_increase') currentValue += value;
                                    else if (type === 'value_decrease') currentValue -= value;
                                    updatedRowData.set(header, Math.max(0, currentValue).toFixed(2).replace('.', ','));
                                }
                            });
                        }
                        
                        dataForUpdate.push({
                            range: `${sheetName}!A${rIndex}`,
                            values: [sheetHeaders.map(h => updatedRowData.get(h) || '')],
                        });
                    }
                }
                
                await sheets.spreadsheets.values.batchUpdate({
                    spreadsheetId: SPREADSHEET_ID,
                    resource: {
                        valueInputOption: 'USER_ENTERED',
                        data: dataForUpdate,
                    },
                });
                break;
            }

            case 'delete':
            case 'bulk-delete': {
                const indexesToDelete = action === 'delete' ? [rowIndex] : rowIndexes;
                if (!indexesToDelete || indexesToDelete.length === 0) return res.status(400).json({ error: 'Índices são obrigatórios.' });
                
                const sortedIndexes = indexesToDelete.sort((a, b) => b - a);
                const deleteRequests = sortedIndexes.map(rIndex => ({
                    deleteDimension: {
                        range: {
                            sheetId: sheet.sheetId,
                            dimension: 'ROWS',
                            startIndex: rIndex - 1,
                            endIndex: rIndex
                        }
                    }
                }));

                await sheets.spreadsheets.batchUpdate({
                    spreadsheetId: SPREADSHEET_ID,
                    resource: { requests: deleteRequests }
                });
                break;
            }

            default:
                return res.status(400).json({ error: 'Ação inválida.' });
        }

        return res.status(200).json({ success: true });

    } catch (error) {
        console.error('Erro na API editar-cardapio:', error);
        if (error.response && error.response.status === 403) {
            return res.status(403).json({ error: 'Permissão negada. Verifique se o e-mail da conta de serviço tem permissão de "Editor" na sua planilha.' });
        }
        return res.status(500).json({ error: 'Erro interno no servidor.', details: error.message });
    }
}

