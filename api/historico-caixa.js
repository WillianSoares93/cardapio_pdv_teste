// /api/historico-caixa.js
import { google } from 'googleapis';

// --- CONFIGURAÇÃO GOOGLE SHEETS ---
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_NAME = process.env.CASH_CLOSURES_SHEET_NAME || 'fechamentos_caixa';

const auth = new google.auth.GoogleAuth({
    credentials: {
        client_email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: GOOGLE_PRIVATE_KEY,
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});

const sheets = google.sheets({ version: 'v4', auth });

export default async (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');

    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A2:P`, // Lê da linha 2 em diante para ignorar o cabeçalho, até a coluna P
        });

        const rows = response.data.values;
        if (!rows || rows.length === 0) {
            return res.status(200).json([]);
        }
        
        const closures = rows.map(row => {
            // Mapeia os dados da linha para um objeto JSON
            return {
                id: row[0] || '',
                openDate: row[1] || '',
                openUser: row[2] || '',
                initialValue: parseFloat(String(row[3] || '0').replace(',', '.')) || 0,
                closeDate: row[4] || '',
                closeUser: row[5] || '',
                finalValue: parseFloat(String(row[6] || '0').replace(',', '.')) || 0,
                difference: parseFloat(String(row[7] || '0').replace(',', '.')) || 0,
                totalSales: parseFloat(String(row[8] || '0').replace(',', '.')) || 0,
                totalDelivery: parseFloat(String(row[9] || '0').replace(',', '.')) || 0,
                totalPickup: parseFloat(String(row[10] || '0').replace(',', '.')) || 0,
                totalTables: parseFloat(String(row[11] || '0').replace(',', '.')) || 0,
                totalDeliveryFees: parseFloat(String(row[12] || '0').replace(',', '.')) || 0,
                totalCash: parseFloat(String(row[13] || '0').replace(',', '.')) || 0,
                totalCard: parseFloat(String(row[14] || '0').replace(',', '.')) || 0,
                totalPix: parseFloat(String(row[15] || '0').replace(',', '.')) || 0,
            };
        }).filter(Boolean); // Remove linhas vazias

        res.status(200).json(closures);

    } catch (error) {
        console.error('Erro na API /historico-caixa:', error);
        res.status(500).json({ error: `Erro interno no servidor: ${error.message}` });
    }
};
