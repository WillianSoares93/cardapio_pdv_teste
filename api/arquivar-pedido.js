// /api/arquivar-pedido.js
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
// Alterado: Usa o SDK padrão do Firebase, não o Admin
import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore, doc, getDoc } from "firebase/firestore";

// Configuração padrão do Firebase (usada no lado do cliente)
const firebaseConfig = {
  apiKey: "AIzaSyBJ44RVDGhBIlQBTx-pyIUp47XDKzRXk84",
  authDomain: "pizzaria-pdv.firebaseapp.com",
  projectId: "pizzaria-pdv",
  storageBucket: "pizzaria-pdv.firebasestorage.app",
  messagingSenderId: "304171744691",
  appId: "1:304171744691:web:e54d7f9fe55c7a75485fc6"
};

// Inicialização padrão do Firebase
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(app);

// Autenticação com Google Sheets (permanece igual)
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

        // Usa as funções do SDK padrão para ler o documento
        const orderRef = doc(db, 'pedidos', orderId);
        const docSnap = await getDoc(orderRef);

        if (!docSnap.exists()) {
            return res.status(404).json({ error: 'Pedido não encontrado.' });
        }

        const orderData = docSnap.data();

        // Formatação dos dados para a planilha (permanece igual)
        const itemsString = (orderData.itens || []).map(item => {
            let itemDetails = `${item.quantity || 1}x ${item.name || 'Item desconhecido'}`;
            if (item.extras && item.extras.length > 0) {
                const extrasString = item.extras.map(e => `+${e.name}`).join(' ');
                itemDetails += ` (${extrasString})`;
            }
            return itemDetails;
        }).join('; ');

        const clientName = orderData.endereco?.clientName || '';
        const street = orderData.endereco?.rua || '';
        const number = orderData.endereco?.numero || '';
        const neighborhood = orderData.endereco?.bairro || '';
        const payment = orderData.pagamento || {};
        const total = orderData.total?.finalTotal || 0;
        const createdAt = orderData.criadoEm?.seconds ? new Date(orderData.criadoEm.seconds * 1000).toLocaleString('pt-BR') : new Date().toLocaleString('pt-BR');

        const rowData = [
            orderData.orderNumber || '',
            clientName,
            street && street !== "Mesa" ? `${street}, ${number}` : (clientName.startsWith('Mesa') ? 'Consumo no Local' : ''),
            neighborhood,
            itemsString,
            total.toFixed(2).replace('.', ','),
            typeof payment === 'object' ? payment.method : payment,
            createdAt,
            'Finalizado'
        ];

        // Adiciona a linha na planilha de histórico
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            // **CORREÇÃO FINAL**: Especifica um range A1 válido para a operação de append.
            range: `${SHEET_NAME}!A1`,
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [rowData],
            },
        });

        // **REMOVIDO**: A lógica para apagar o pedido foi movida para o frontend.
        // await orderRef.delete();

        res.status(200).json({ success: true, message: `Pedido ${orderId} arquivado na planilha com sucesso.` });

    } catch (error) {
        console.error('Erro ao arquivar pedido na planilha:', error);
        res.status(500).json({ error: 'Erro interno no servidor.', details: error.message });
    }
}

