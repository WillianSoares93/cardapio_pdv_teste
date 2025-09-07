// /api/historico.js
import { google } from 'googleapis';

// --- CONFIGURAÇÃO GOOGLE SHEETS ---
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_NAME = 'encerrados';

export default async (req, res) => {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const auth = new google.auth.GoogleAuth({
            credentials: {
                client_email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
                private_key: GOOGLE_PRIVATE_KEY,
            },
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
        });

        const sheets = google.sheets({ version: 'v4', auth });

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: SHEET_NAME,
        });

        const rows = response.data.values;
        if (!rows || rows.length < 2) {
            return res.status(200).json([]);
        }

        const headers = rows[0];
        const data = rows.slice(1).map(row => {
            return {
                date: row[1],
                clientData: row[4],
                items: row[5],
                type: row[3],
                payment: row[10],
                total: parseFloat(row[8].replace(',', '.')) || 0,
            };
        });
        
        // Cache por 5 minutos
        res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
        return res.status(200).json(data);

    } catch (error) {
        console.error('Erro ao buscar histórico da planilha:', error.message);
        return res.status(500).json({ error: 'Erro interno no servidor ao buscar histórico.', details: error.message });
    }
};
