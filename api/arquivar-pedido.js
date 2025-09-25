// /api/arquivar-pedido.js
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
// Lógica restaurada para usar o SDK padrão do Firebase, não o Admin.
import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore, doc, getDoc } from "firebase/firestore";

// Configuração padrão do Firebase
const firebaseConfig = {
  apiKey: "AIzaSyBJ44RVDGhBIlQBTx-pyIUp47XDKzRXk84",
  authDomain: "pizzaria-pdv.firebaseapp.com",
  projectId: "pizzaria-pdv",
  storageBucket: "pizzaria-pdv.firebasestorage.app",
  messagingSenderId: "304171744691",
  appId: "1:304171744691:web:e54d7f9fe55c7a75485fc6"
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(app);

// Autenticação com Google Sheets
const auth = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_NAME = 'encerrados';

// --- FUNÇÃO PRINCIPAL ---
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { orderId } = req.body;
        if (!orderId) {
            return res.status(400).json({ error: 'orderId é obrigatório.' });
        }

        const orderRef = doc(db, 'pedidos', orderId);
        const docSnap = await getDoc(orderRef);

        if (!docSnap.exists()) {
            return res.status(404).json({ error: 'Pedido não encontrado.' });
        }

        const orderData = docSnap.data();

        // Formatação dos dados para a planilha
        const getOrderType = (endereco) => {
            if (!endereco || !endereco.rua) return 'N/A';
            if (endereco.rua === 'Mesa') return 'Mesa';
            if (endereco.rua === 'Retirada no Balcão') return 'Retirada';
            return 'Delivery';
        };

        const itemsString = (orderData.itens || []).map(item => {
            let itemDetails = `${item.quantity || 1}x ${item.name || 'Item desconhecido'}`;
            if (item.extras && item.extras.length > 0) {
                const extrasString = item.extras.map(e => `+${e.name}`).join(' ');
                itemDetails += ` (${extrasString})`;
            }
            itemDetails += ` (R$ ${parseFloat(item.price || 0).toFixed(2).replace('.', ',')})`;
            return itemDetails;
        }).join('; ');

        const clientName = orderData.endereco?.clientName || '';
        const clientPhone = orderData.endereco?.telefone || '';
        const street = orderData.endereco?.rua || '';
        const number = orderData.endereco?.numero || '';
        const neighborhood = orderData.endereco?.bairro || '';

        let clientDataString = clientName;
        if (clientPhone) clientDataString += `; ${clientPhone}`;
        if (street && street !== "Mesa" && street !== "Retirada no Balcão") {
            clientDataString += `; ${street}, ${number} - ${neighborhood}`;
        }
        
        const payment = orderData.pagamento || {};
        const subtotal = orderData.total?.subtotal || 0;
        const deliveryFee = orderData.total?.deliveryFee || 0;
        const total = orderData.total?.finalTotal || 0;
        const createdAt = orderData.criadoEm?.seconds ? new Date(orderData.criadoEm.seconds * 1000).toLocaleString('pt-BR', {timeZone: 'America/Sao_Paulo'}) : new Date().toLocaleString('pt-BR', {timeZone: 'America/Sao_Paulo'});
        const orderType = getOrderType(orderData.endereco);
        const observations = orderData.observacao || '';

        const rowData = [
            orderId,
            createdAt,
            orderId.substring(0, 5).toUpperCase(),
            orderType,
            clientDataString,
            itemsString,
            subtotal.toFixed(2).replace('.', ','),
            deliveryFee.toFixed(2).replace('.', ','),
            total.toFixed(2).replace('.', ','),
            typeof payment === 'object' ? payment.method : payment,
            observations
        ];

        // 1. Adiciona a linha na planilha de histórico
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A1`,
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [rowData],
            },
        });

        // 2. Retorna sucesso para o frontend, que fará a exclusão.
        res.status(200).json({ success: true, message: `Pedido ${orderId} arquivado na planilha. Exclusão será feita pelo cliente.` });

    } catch (error) {
        console.error('Erro ao arquivar pedido:', error);
        res.status(500).json({ error: 'Erro interno no servidor.', details: error.message });
    }
}

