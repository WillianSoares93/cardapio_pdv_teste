// /api/registrar-sangria.js
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

// --- FUNÇÃO PRINCIPAL ---
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

        // Salva a sangria no Firestore, dentro do documento do caixa atual
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

