// /api/historico.js
import { google } from 'googleapis';

// --- CONFIGURAÇÃO GOOGLE SHEETS ---
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_NAME = 'encerrados';

const auth = new google.auth.GoogleAuth({
    credentials: {
        client_email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: GOOGLE_PRIVATE_KEY,
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'], // Escopo apenas de leitura é mais seguro
});

const sheets = google.sheets({ version: 'v4', auth });

export default async (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');

    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A2:K`, // Lê da linha 2 em diante para ignorar o cabeçalho
        });

        const rows = response.data.values;
        if (!rows || rows.length === 0) {
            return res.status(200).json([]);
        }
        
        const orders = rows.map(row => {
            // Mapeia os dados da linha para o formato de objeto que o frontend espera
            return {
                id: row[0] || '',
                date: row[1] || '',
                shortId: row[2] || '',
                type: row[3] || '',
                clientData: row[4] || '',
                items: row[5] || '',
                subtotal: parseFloat(String(row[6] || '0').replace(',', '.')) || 0,
                deliveryFee: parseFloat(String(row[7] || '0').replace(',', '.')) || 0,
                total: parseFloat(String(row[8] || '0').replace(',', '.')) || 0,
                payment: row[9] || '',
                observations: row[10] || ''
            };
        }).filter(Boolean); // Remove linhas que possam ter ficado vazias

        res.status(200).json(orders);

    } catch (error) {
        console.error('Erro na API /historico:', error);
        res.status(500).json({ error: `Erro interno no servidor: ${error.message}` });
    }
};

