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
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_NAME = 'encerrados';

// --- FUNÇÃO PRINCIPAL ---
export default async (req, res) => {
    console.log('[LOG] Função arquivar-pedido iniciada.');

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { orderId } = req.body;
        if (!orderId) {
            return res.status(400).json({ error: 'ID do pedido não fornecido.' });
        }

        const auth = new google.auth.GoogleAuth({
            credentials: {
                client_email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
                private_key: GOOGLE_PRIVATE_KEY,
            },
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        const sheets = google.sheets({ version: 'v4', auth });

        const orderRef = doc(db, "pedidos", orderId);
        const orderSnap = await getDoc(orderRef);

        if (!orderSnap.exists()) {
            return res.status(404).json({ error: 'Pedido não encontrado no banco de dados.' });
        }
        const orderData = orderSnap.data();

        // 3. Formatar os dados para a planilha
        const paymentString = typeof orderData.pagamento === 'object' ? `${orderData.pagamento.method} (Troco p/ ${orderData.pagamento.trocoPara})` : orderData.pagamento;

        let orderType = 'Delivery';
        if (orderData.endereco.rua === "Retirada no Balcão") orderType = 'Retirada';
        if (orderData.endereco.rua === "Mesa") orderType = 'Mesa';
        
        // **NOVA LÓGICA PARA DADOS DO CLIENTE CONSOLIDADOS**
        let clientInfoParts = [orderData.endereco.clientName || ''];
        if (orderType === 'Delivery') {
            let fullAddress = `${orderData.endereco.rua || ''}, ${orderData.endereco.numero || ''} - ${orderData.endereco.bairro || ''}`;
            if (orderData.endereco.referencia) {
                fullAddress += ` (Ref: ${orderData.endereco.referencia})`;
            }
            clientInfoParts.push(fullAddress);
        }
        if (orderData.endereco.telefone) {
            clientInfoParts.push(orderData.endereco.telefone);
        }
        const clientDataString = clientInfoParts.join('; ');

        // **NOVA LÓGICA PARA DADOS DOS ITENS DETALHADOS**
        const itemsString = orderData.itens.map(item => {
            let mainString = `${item.name} (R$ ${item.price.toFixed(2).replace('.',',')})`;
            let details = [];

            const itemsToDetail = item.ingredients || item.extras || [];
            if (itemsToDetail.length > 0) {
                 details = itemsToDetail.map(detail => {
                    const quantityText = detail.quantity > 1 ? ` x${detail.quantity}` : '';
                    const priceText = detail.price > 0 ? ` (R$ ${(detail.price * (detail.quantity || 1)).toFixed(2).replace('.',',')})` : '';
                    return `${detail.name}${quantityText}${priceText}`;
                });
            }

            if (details.length > 0) {
                mainString += ` [${details.join(', ')}]`;
            }
            return mainString;
        }).join('; ');


        const newRow = [
            orderId,
            new Date().toLocaleString('pt-BR'),
            `#${orderId.substring(0, 5)}`,
            orderType,
            clientDataString, // DADOS DO CLIENTE CONSOLIDADOS
            itemsString,      // ITENS DETALHADOS
            orderData.total.subtotal.toFixed(2).replace('.', ','),
            orderData.total.deliveryFee.toFixed(2).replace('.', ','),
            orderData.total.finalTotal.toFixed(2).replace('.', ','),
            paymentString || 'Não definido',
            orderData.observacao || ''
        ];

        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A:A`,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [newRow],
            },
        });

        await deleteDoc(orderRef);

        res.status(200).json({ success: true, message: 'Pedido arquivado com sucesso!' });

    } catch (error) {
        console.error('--- ERRO DETALHADO NA FUNÇÃO DE ARQUIVAMENTO ---', {
            message: error.message,
            stack: error.stack,
            requestBody: req.body
        });
        res.status(500).json({ 
            error: 'Erro interno no servidor ao tentar arquivar.', 
            details: error.message 
        });
    }
};

