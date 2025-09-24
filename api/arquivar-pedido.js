// /api/arquivar-pedido.js
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Garante que o app do Firebase Admin seja inicializado apenas uma vez
if (!process.env.FIREBASE_ADMIN_INITIALIZED) {
    const serviceAccount = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf-8'));
    initializeApp({
        credential: cert(serviceAccount)
    });
    process.env.FIREBASE_ADMIN_INITIALIZED = 'true';
}

const db = getFirestore();

// Autenticação com Google Sheets
const auth = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });
const SPREADSHEET_ID = process.env.SPREADSHEET_ID; 
const SHEET_NAME = 'historico_pedidos';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { orderId } = req.body;
        if (!orderId) {
            return res.status(400).json({ error: 'orderId é obrigatório.' });
        }

        const orderRef = db.collection('pedidos').doc(orderId);
        const doc = await orderRef.get();

        if (!doc.exists) {
            return res.status(404).json({ error: 'Pedido não encontrado.' });
        }

        const orderData = doc.data();

        // Formata os itens para uma única string
        const itemsString = orderData.itens.map(item => {
            let itemDetails = `${item.quantity || 1}x ${item.name}`;
            if (item.extras && item.extras.length > 0) {
                const extrasString = item.extras.map(e => `+${e.name}`).join(' ');
                itemDetails += ` (${extrasString})`;
            }
            return itemDetails;
        }).join('; ');

        // Prepara a linha para a planilha
        const rowData = [
            orderData.orderNumber || '',
            orderData.endereco.clientName || `Mesa ${orderData.endereco.clientName.replace(/\D/g, '')}` || '',
            orderData.endereco.rua && orderData.endereco.rua !== "Mesa" ? `${orderData.endereco.rua}, ${orderData.endereco.numero}` : '',
            orderData.endereco.bairro || '',
            itemsString,
            (orderData.total.finalTotal || 0).toFixed(2).replace('.', ','),
            typeof orderData.pagamento === 'object' ? orderData.pagamento.method : orderData.pagamento || '',
            new Date(orderData.criadoEm.seconds * 1000).toLocaleString('pt-BR'),
            'Finalizado'
        ];

        // Adiciona a linha na planilha de histórico
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A:A`,
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [rowData],
            },
        });

        // Deleta o pedido do Firestore
        await orderRef.delete();

        res.status(200).json({ success: true, message: `Pedido ${orderId} arquivado com sucesso.` });

    } catch (error) {
        console.error('Erro ao arquivar pedido:', error);
        res.status(500).json({ error: 'Erro interno no servidor.', details: error.message });
    }
}
