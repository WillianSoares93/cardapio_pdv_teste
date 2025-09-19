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
        const { sheetName, action, rowIndex, data } = req.body;

        if (!sheetName || !action) {
            return res.status(400).json({ error: 'Nome da planilha e ação são obrigatórios.' });
        }

        switch (action) {
            case 'update':
                if (!rowIndex || !data) {
                    return res.status(400).json({ error: 'Índice da linha e dados são obrigatórios para atualizar.' });
                }
                const range = `${sheetName}!A${rowIndex}`;
                const headers = (await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${sheetName}!1:1` })).data.values[0];
                const values = [headers.map(header => data[header])];

                await sheets.spreadsheets.values.update({
                    spreadsheetId: SPREADSHEET_ID,
                    range,
                    valueInputOption: 'USER_ENTERED',
                    requestBody: { values },
                });
                break;

            case 'add':
                if (!data) {
                    return res.status(400).json({ error: 'Dados são obrigatórios para adicionar.' });
                }
                const appendHeaders = (await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${sheetName}!1:1` })).data.values[0];
                const appendValues = [appendHeaders.map(header => data[header])];

                await sheets.spreadsheets.values.append({
                    spreadsheetId: SPREADSHEET_ID,
                    range: `${sheetName}!A:A`,
                    valueInputOption: 'USER_ENTERED',
                    requestBody: { values: appendValues },
                });
                break;

            case 'delete':
                if (!rowIndex) {
                    return res.status(400).json({ error: 'Índice da linha é obrigatório para deletar.' });
                }
                const sheetId = await getSheetIdByName(sheetName);
                if (sheetId === null) {
                    return res.status(404).json({ error: `Planilha com nome ${sheetName} não encontrada.` });
                }

                await sheets.spreadsheets.batchUpdate({
                    spreadsheetId: SPREADSHEET_ID,
                    requestBody: {
                        requests: [{
                            deleteDimension: {
                                range: {
                                    sheetId: sheetId,
                                    dimension: 'ROWS',
                                    startIndex: rowIndex - 1,
                                    endIndex: rowIndex,
                                },
                            },
                        }],
                    },
                });
                break;

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
