import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore, collection, addDoc, serverTimestamp } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBJ44RVDGhBIlQBTx-pyIUp47XDKzRXk84",
  authDomain: "pizzaria-pdv.firebaseapp.com",
  projectId: "pizzaria-pdv",
  storageBucket: "pizzaria-pdv.appspot.com",
  messagingSenderId: "304171744691",
  appId: "1:304171744691:web:e54d7f9fe55c7a75485fc6"
};

let app;
if (!getApps().length) {
    app = initializeApp(firebaseConfig);
} else {
    app = getApp();
}
const db = getFirestore(app);

export default async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { order, selectedAddress, total, paymentMethod, whatsappNumber } = req.body;

        if (!order || !selectedAddress || !total) {
            return res.status(400).json({ error: 'Dados do pedido incompletos.' });
        }

        // Salva o pedido no Firestore
        await addDoc(collection(db, "pedidos"), {
            itens: order,
            endereco: selectedAddress,
            total: total,
            pagamento: paymentMethod,
            status: 'Novo',
            criadoEm: serverTimestamp()
        });

        // Monta a mensagem para o WhatsApp
        let itemsText = order.map(item => {
            let itemDescription = `*${item.name}* - R$ ${item.price.toFixed(2).replace('.', ',')}\n`;
            if (item.type === 'custom_burger' && item.ingredients) {
                itemDescription += item.ingredients.map(ing => {
                    const formattedName = ing.name.replace(/\(x\d+\)/g, match => `*${match}*`);
                    return `  - ${formattedName}\n`;
                }).join('');
            }
            return itemDescription;
        }).join('');

        let paymentText = '';
        if (typeof paymentMethod === 'object' && paymentMethod.method === 'Dinheiro') {
            paymentText = `Pagamento: *Dinheiro*\nTroco para: *R$ ${paymentMethod.trocoPara.toFixed(2).replace('.', ',')}*\nTroco: *R$ ${paymentMethod.trocoTotal.toFixed(2).replace('.', ',')}*`;
        } else {
            paymentText = `Pagamento: *${paymentMethod}*`;
        }

        const fullMessage = `
*-- NOVO PEDIDO --*

*Cliente:* ${selectedAddress.clientName}
*Endereço:* ${selectedAddress.rua}, ${selectedAddress.numero} - ${selectedAddress.bairro}
${selectedAddress.referencia ? `*Referência:* ${selectedAddress.referencia}` : ''}

------------------------------------
*PEDIDO:*
${itemsText}
------------------------------------
Subtotal: R$ ${total.subtotal.toFixed(2).replace('.', ',')}
Taxa de Entrega: R$ ${total.deliveryFee.toFixed(2).replace('.', ',')}
*Total: R$ ${total.finalTotal.toFixed(2).replace('.', ',')}*

${paymentText}
        `;
        
        // Usa o número de WhatsApp recebido do frontend ou um número padrão como fallback.
        const targetNumber = whatsappNumber ? `55${whatsappNumber.replace(/\D/g, '')}` : '5587996070638';
        const whatsappUrl = `https://wa.me/${targetNumber}?text=${encodeURIComponent(fullMessage.trim())}`;

        res.status(200).json({ success: true, whatsappUrl });

    } catch (error) {
        console.error('Erro ao processar pedido:', error);
        res.status(500).json({ error: 'Erro interno no servidor.' });
    }
};
