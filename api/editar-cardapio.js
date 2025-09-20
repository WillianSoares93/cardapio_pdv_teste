// /api/editar-cardapio.js
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';

// Utiliza o mesmo método de autenticação das outras APIs que já funcionam
const auth = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

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

    const doc = new GoogleSpreadsheet(SPREADSHEET_ID, auth);

    try {
        await doc.loadInfo(); // Carrega as informações da planilha

        const { sheetName, action, rowIndex, data, rowIndexes } = req.body;
        
        if (!sheetName || !action) {
            return res.status(400).json({ error: 'Nome da planilha e ação são obrigatórios.' });
        }
        
        const sheet = doc.sheetsByTitle[sheetName];
        if (!sheet) {
            const allSheetNames = Object.keys(doc.sheetsByTitle);
            console.log(`[DIAGNÓSTICO] Aba "${sheetName}" não encontrada. Abas disponíveis:`, allSheetNames);
            return res.status(404).json({ error: `A planilha (aba) com o nome "${sheetName}" não foi encontrada na sua Planilha de Cardápio.` });
        }

        await sheet.loadHeaderRow(); // Carrega a linha de cabeçalho da aba específica
        const sheetHeaders = sheet.headerValues;

        // Função auxiliar para encontrar o cabeçalho correto na planilha
        const getHeaderInSheet = (key) => {
            const possibleHeaders = keyToHeaderMap[key];
            if (possibleHeaders) {
                return possibleHeaders.find(h => sheetHeaders.includes(h));
            }
            return sheetHeaders.includes(key) ? key : undefined;
        };

        const priceKeys = ['basePrice', 'price4Slices', 'price6Slices', 'price10Slices', 'promoPrice', 'price', 'deliveryFee'];

        const formatValueForSheet = (key, header, value) => {
            // Lida com valores booleanos
            if (header && (header.includes('(sim/não)') || header.includes('(sim/nao)'))) {
                if (typeof value === 'boolean') {
                    return value ? 'Sim' : 'Não';
                }
                 // Lida com strings 'true'/'false' vindas do formulário
                if (value === 'true') return 'Sim';
                if (value === 'false') return 'Não';
            }
            // Lida com valores de preço
            if (priceKeys.includes(key)) {
                const num = parseFloat(String(value).replace(',', '.'));
                if (!isNaN(num)) {
                    return num.toFixed(2).replace('.', ',');
                }
            }
            return value;
        };


        switch (action) {
            case 'update': {
                if (!rowIndex || !data) return res.status(400).json({ error: 'Índice da linha e dados são obrigatórios.' });
                const rows = await sheet.getRows();
                const row = rows[rowIndex - 2]; // rowIndex (1-based, com cabeçalho) para array (0-based)
                if (row) {
                    Object.keys(data).forEach(key => {
                        const header = getHeaderInSheet(key);
                        if (header) {
                            const valueToSet = formatValueForSheet(key, header, data[key]);
                            row.set(header, valueToSet);
                        }
                    });
                    await row.save(); // save() é a melhor abordagem para uma única linha
                }
                break;
            }

            case 'add': {
                if (!data) return res.status(400).json({ error: 'Dados são obrigatórios.' });
                const newRowData = {};
                Object.keys(data).forEach(key => {
                    const header = getHeaderInSheet(key);
                    if (header) {
                       const valueToSet = formatValueForSheet(key, header, data[key]);
                       newRowData[header] = valueToSet;
                    }
                });
                await sheet.addRow(newRowData);
                break;
            }

            case 'delete': {
                if (!rowIndex) return res.status(400).json({ error: 'Índice da linha é obrigatório.' });
                const rows = await sheet.getRows();
                const row = rows[rowIndex - 2];
                if (row) await row.delete();
                break;
            }
            
            case 'bulk-update': {
                if (!rowIndexes || !data) return res.status(400).json({ error: 'Índices e dados são obrigatórios.' });
                const rows = await sheet.getRows();
                
                for (const rIndex of rowIndexes) {
                    const row = rows[rIndex - 2];
                    if (row) {
                        for (const field in data) {
                            if (field !== 'priceAdjustment') {
                                const header = getHeaderInSheet(field);
                                if (header) {
                                    const valueToSet = formatValueForSheet(field, header, data[field]);
                                    row.set(header, valueToSet);
                                }
                            }
                        }
                        
                        if (data.priceAdjustment) {
                            const { type, value } = data.priceAdjustment;
                            
                            priceKeys.forEach(fieldKey => {
                                const header = getHeaderInSheet(fieldKey);
                                if (header) {
                                    let currentValue = parseFloat(String(row.get(header) || '0').replace(',', '.')) || 0;
                                    
                                    if (type === 'percent_increase') currentValue *= (1 + value / 100);
                                    else if (type === 'percent_decrease') currentValue *= (1 - value / 100);
                                    else if (type === 'value_increase') currentValue += value;
                                    else if (type === 'value_decrease') currentValue -= value;

                                    row.set(header, Math.max(0, currentValue).toFixed(2).replace('.',','));
                                }
                            });
                        }
                        // Não salva aqui, deixa para o batch no final
                    }
                }
                await sheet.saveUpdatedCells(); // Salva todas as células modificadas de uma vez
                break;
            }
            
             case 'bulk-delete': {
                if (!rowIndexes || rowIndexes.length === 0) return res.status(400).json({ error: 'Índices são obrigatórios.' });
                const rows = await sheet.getRows();
                const sortedIndexes = rowIndexes.sort((a, b) => b - a); // Ordem decrescente
                for (const rIndex of sortedIndexes) {
                    const row = rows[rIndex - 2];
                    if (row) await row.delete();
                }
                break;
            }

            default:
                return res.status(400).json({ error: 'Ação inválida.' });
        }

        return res.status(200).json({ success: true });

    } catch (error) {
        console.error('Erro na API editar-cardapio:', error);
        // Retorna uma mensagem de erro mais específica se for um erro de permissão
        if (error.response && error.response.status === 403) {
            return res.status(403).json({ error: 'Permissão negada. Verifique se o e-mail da conta de serviço tem permissão de "Editor" na sua planilha de cardápio.' });
        }
        return res.status(500).json({ error: 'Erro interno no servidor.', details: error.message });
    }
}

