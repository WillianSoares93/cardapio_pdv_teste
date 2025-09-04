// /api/arquivar-pedido.js
import { google } from 'googleapis';
import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore, doc, deleteDoc, getDoc } from "firebase/firestore";

// --- CONFIGURAÇÃO FIREBASE ---
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

// --- CONFIGURAÇÃO GOOGLE SHEETS ---
// As credenciais devem ser configuradas como Variáveis de Ambiente no Vercel
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_NAME = 'Pedidos Finalizados';

const auth = new google.auth.GoogleAuth({
    credentials: {
        client_email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: GOOGLE_PRIVATE_KEY,
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });

// --- FUNÇÃO PRINCIPAL ---
export default async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { orderId } = req.body;
        if (!orderId) {
            return res.status(400).json({ error: 'ID do pedido não fornecido.' });
        }

        // 1. Buscar os dados completos do pedido no Firestore
        const orderRef = doc(db, "pedidos", orderId);
        const orderSnap = await getDoc(orderRef);

        if (!orderSnap.exists()) {
            return res.status(404).json({ error: 'Pedido não encontrado no banco de dados.' });
        }
        const orderData = orderSnap.data();

        // 2. Formatar os dados para a planilha
        const itemsString = orderData.itens.map(item => `${item.name} (R$ ${item.price.toFixed(2)})`).join('; ');
        const paymentString = typeof orderData.pagamento === 'object' ? `${orderData.pagamento.method} (Troco p/ ${orderData.pagamento.trocoPara})` : orderData.pagamento;
        
        let orderType = 'Delivery';
        if (orderData.endereco.rua === "Retirada no Balcão") orderType = 'Retirada';
        if (orderData.endereco.rua === "Mesa") orderType = 'Mesa';

        const newRow = [
            new Date().toLocaleString('pt-BR'),
            orderId,
            orderType,
            orderData.endereco.clientName || '',
            itemsString,
            orderData.total.subtotal.toFixed(2).replace('.', ','),
            orderData.total.deliveryFee.toFixed(2).replace('.', ','),
            orderData.total.finalTotal.toFixed(2).replace('.', ','),
            paymentString || 'Não definido',
            orderData.observacao || ''
        ];

        // 3. Adicionar a nova linha na planilha
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A:A`,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [newRow],
            },
        });

        // 4. Deletar o pedido do Firestore
        await deleteDoc(orderRef);

        res.status(200).json({ success: true, message: 'Pedido arquivado com sucesso!' });

    } catch (error) {
        console.error('Erro ao arquivar pedido:', error);
        res.status(500).json({ error: 'Erro interno no servidor.', details: error.message });
    }
};
