import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore, collection, addDoc, serverTimestamp } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyB9LJ-7bOvHGYyFE_H2Qd7XFcyjmSPq_ro",
  authDomain: "samia-cardapio.firebaseapp.com",
  projectId: "samia-cardapio",
  storageBucket: "samia-cardapio.firebasestorage.app",
  messagingSenderId: "223260436641",
  appId: "1:223260436641:web:adf78e77a0267f66f1e8e0"
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
        
        if (!whatsappNumber) {
            console.error('Erro Crítico: O número do WhatsApp não foi recebido do frontend.');
            return res.status(400).json({ error: 'O número de WhatsApp para receber o pedido não foi configurado.' });
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
            let itemDescription = `- *${item.name}* - R$ ${item.price.toFixed(2).replace('.', ',')}\n`;
            if (item.type === 'custom_burger' && item.ingredients) {
                // CORREÇÃO: Adiciona mais espaços para indentar a lista de ingredientes
                itemDescription += item.ingredients.map(ing => {
                    const formattedName = ing.name.replace(/\(x\d+\)/g, match => `*${match}*`);
                    return `        - ${formattedName}\n`; // 8 espaços criam o recuo
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
		
// NOVO: Cria a linha de desconto apenas se houver um desconto
        let discountText = '';
        if (total.discount && total.discount > 0) {
            discountText = `Desconto: - R$ ${total.discount.toFixed(2).replace('.', ',')}\n`;
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
${discountText}Taxa de Entrega: R$ ${total.deliveryFee.toFixed(2).replace('.', ',')}
*Total: R$ ${total.finalTotal.toFixed(2).replace('.', ',')}*

${paymentText}
        `;
        
        const targetNumber = `55${whatsappNumber.replace(/\D/g, '')}`;
        const whatsappUrl = `https://wa.me/${targetNumber}?text=${encodeURIComponent(fullMessage.trim())}`;

        res.status(200).json({ success: true, whatsappUrl });

    } catch (error) {
        console.error('Erro ao processar pedido:', error);
        res.status(500).json({ error: 'Erro interno no servidor.' });
    }
};
