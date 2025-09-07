import { google } from 'googleapis';

const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_NAME = 'encerrados';

const auth = new google.auth.GoogleAuth({
    credentials: {
        client_email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: GOOGLE_PRIVATE_KEY,
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});

const sheets = google.sheets({ version: 'v4', auth });

export default async (req, res) => {
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        if (!SPREADSHEET_ID || !GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY) {
            throw new Error("Credenciais do Google Sheets ou ID da Planilha não configurados no servidor.");
        }

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A2:K`, // Lê até a coluna K (11 colunas)
        });

        const rows = response.data.values || [];
        
        const orders = rows.map(row => {
            // Garante que a linha tem o mínimo de colunas para não dar erro
            if (!row || row.length < 9) return null;

            return {
                id: row[0] || '',
                date: row[1] || '',
                orderNum: row[2] || '',
                type: row[3] || '',
                clientData: row[4] || '',
                items: row[5] || '',
                subtotal: parseFloat(String(row[6]).replace(',', '.') || 0),
                deliveryFee: parseFloat(String(row[7]).replace(',', '.') || 0),
                total: parseFloat(String(row[8]).replace(',', '.') || 0),
                payment: row[9] || 'Não definido', // Corrigido: Mapeia a coluna 10 (índice 9)
                observation: row[10] || ''
            };
        }).filter(Boolean); // Remove linhas nulas/inválidas

        res.status(200).json(orders);

    } catch (error) {
        console.error('Erro na API /api/historico:', error);
        res.status(500).json({ error: 'Erro interno no servidor ao buscar histórico.', details: error.message });
    }
};

