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
// **CORREÇÃO**: Apontando para a planilha correta usada pelos relatórios.
const SHEET_NAME = 'encerrados';

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

        // **CORREÇÃO**: Reestruturação dos dados para corresponder ao formato da planilha de histórico.
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

        // Estrutura de 11 colunas para corresponder à api/historico.js
        const rowData = [
            orderId, // id
            createdAt, // date
            orderId.substring(0, 5).toUpperCase(), // shortId
            orderType, // type
            clientDataString, // clientData
            itemsString, // items
            subtotal.toFixed(2).replace('.', ','), // subtotal
            deliveryFee.toFixed(2).replace('.', ','), // deliveryFee
            total.toFixed(2).replace('.', ','), // total
            typeof payment === 'object' ? payment.method : payment, // payment
            observations // observations
        ];

        // Adiciona a linha na planilha de histórico
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A1`,
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [rowData],
            },
        });

        res.status(200).json({ success: true, message: `Pedido ${orderId} arquivado na planilha com sucesso.` });

    } catch (error) {
        console.error('Erro ao arquivar pedido na planilha:', error);
        res.status(500).json({ error: 'Erro interno no servidor.', details: error.message });
    }
}

