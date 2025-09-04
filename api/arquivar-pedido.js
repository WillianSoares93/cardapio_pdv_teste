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
const SHEET_NAME = 'encerrados'; // ATUALIZADO: Nome da aba corrigido para corresponder à sua planilha.

// --- FUNÇÃO PRINCIPAL ---
export default async (req, res) => {
    // Adicionando um log no início da execução
    console.log('[LOG] Função arquivar-pedido iniciada.');

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { orderId } = req.body;
        console.log(`[LOG] Recebido pedido para arquivar ID: ${orderId}`);

        if (!orderId) {
            console.error('[ERRO] ID do pedido não foi fornecido no corpo da requisição.');
            return res.status(400).json({ error: 'ID do pedido não fornecido.' });
        }

        // Verificando a presença das variáveis de ambiente
        console.log(`[LOG] SPREADSHEET_ID presente: ${!!SPREADSHEET_ID}`);
        console.log(`[LOG] GOOGLE_SERVICE_ACCOUNT_EMAIL presente: ${!!GOOGLE_SERVICE_ACCOUNT_EMAIL}`);
        console.log(`[LOG] GOOGLE_PRIVATE_KEY presente: ${!!GOOGLE_PRIVATE_KEY}`);

        // 1. Autenticação com o Google
        console.log('[LOG] Tentando autenticar com a API do Google Sheets...');
        const auth = new google.auth.GoogleAuth({
            credentials: {
                client_email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
                private_key: GOOGLE_PRIVATE_KEY,
            },
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        const sheets = google.sheets({ version: 'v4', auth });
        console.log('[LOG] Autenticação com o Google bem-sucedida.');

        // 2. Buscar os dados completos do pedido no Firestore
        console.log(`[LOG] Buscando dados do pedido ${orderId} no Firestore...`);
        const orderRef = doc(db, "pedidos", orderId);
        const orderSnap = await getDoc(orderRef);

        if (!orderSnap.exists()) {
            console.error(`[ERRO] Pedido com ID ${orderId} não encontrado no Firestore.`);
            return res.status(404).json({ error: 'Pedido não encontrado no banco de dados.' });
        }
        const orderData = orderSnap.data();
        console.log('[LOG] Dados do pedido encontrados no Firestore.');

        // 3. Formatar os dados para a planilha
        const itemsString = orderData.itens.map(item => `${item.name} (R$ ${item.price.toFixed(2)})`).join('; ');
        const paymentString = typeof orderData.pagamento === 'object' ? `${orderData.pagamento.method} (Troco p/ ${orderData.pagamento.trocoPara})` : orderData.pagamento;
        
        let orderType = 'Delivery';
        if (orderData.endereco.rua === "Retirada no Balcão") orderType = 'Retirada';
        if (orderData.endereco.rua === "Mesa") orderType = 'Mesa';

        const newRow = [
            orderId, new Date().toLocaleString('pt-BR'), `#${orderId.substring(0, 5)}`,
            orderType, orderData.endereco.clientName || '', itemsString,
            orderData.total.subtotal.toFixed(2).replace('.', ','),
            orderData.total.deliveryFee.toFixed(2).replace('.', ','),
            orderData.total.finalTotal.toFixed(2).replace('.', ','),
            paymentString || 'Não definido', orderData.observacao || ''
        ];
        console.log('[LOG] Linha de dados formatada para a planilha.');

        // 4. Adicionar a nova linha na planilha
        console.log(`[LOG] Enviando dados para a planilha ID: ${SPREADSHEET_ID}, Aba: ${SHEET_NAME}`);
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A:A`,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [newRow],
            },
        });
        console.log('[LOG] Linha adicionada à planilha com sucesso.');

        // 5. Deletar o pedido do Firestore
        console.log(`[LOG] Deletando o pedido ${orderId} do Firestore...`);
        await deleteDoc(orderRef);
        console.log('[LOG] Pedido deletado do Firestore com sucesso.');

        res.status(200).json({ success: true, message: 'Pedido arquivado com sucesso!' });

    } catch (error) {
        // Log detalhado do erro
        console.error('--- ERRO DETALHADO NA FUNÇÃO DE ARQUIVAMENTO ---');
        console.error('Mensagem:', error.message);
        console.error('Stack Trace:', error.stack);
        console.error('--- FIM DO ERRO DETALHADO ---');
        
        // Retorna um JSON de erro, em vez de deixar a função quebrar
        res.status(500).json({ 
            error: 'Erro interno no servidor ao tentar arquivar.', 
            details: error.message 
        });
    }
};

