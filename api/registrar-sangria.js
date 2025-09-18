// /api/registrar-sangria.js
import { google } from 'googleapis';
import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore, doc, updateDoc, arrayUnion } from "firebase/firestore";

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
// NOTA DO DESENVOLVEDOR: Cada sangria é registrada individualmente na planilha 'sangrias' para um histórico detalhado.
// O resumo consolidado é salvo na planilha 'fechamentos_caixa' apenas no final do dia.
const SHEET_NAME = process.env.SANGRIAS_SHEET_NAME || 'sangrias'; // Espera-se uma aba chamada 'sangrias'

const auth = new google.auth.GoogleAuth({
    credentials: {
        client_email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: GOOGLE_PRIVATE_KEY,
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });

export default async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { amount, reason, userEmail, cashRegisterId } = req.body;

        if (!amount || !reason || !userEmail || !cashRegisterId) {
            return res.status(400).json({ error: 'Dados da sangria incompletos.' });
        }

        const timestamp = new Date();
        const dateInBrazil = timestamp.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

        // 1. Salvar na Planilha Google
        const newRow = [
            timestamp.toISOString(),
            dateInBrazil,
            String(amount.toFixed(2)).replace('.', ','),
            reason,
            userEmail,
            cashRegisterId
        ];

        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A:A`,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [newRow],
            },
        });

        // 2. Salvar no Firestore, dentro do documento do caixa atual
        const cashRegisterRef = doc(db, "caixas", cashRegisterId);
        const sangriaData = {
            amount,
            reason,
            userEmail,
            timestamp
        };
        await updateDoc(cashRegisterRef, {
            sangrias: arrayUnion(sangriaData)
        });

        res.status(200).json({ success: true, message: 'Sangria registrada com sucesso!' });

    } catch (error) {
        console.error('Erro ao registrar sangria:', error);
        res.status(500).json({ error: 'Erro interno no servidor.', details: error.message });
    }
};

