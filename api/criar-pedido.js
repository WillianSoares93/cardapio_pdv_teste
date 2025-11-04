// Este arquivo é uma função Serverless para o Vercel.
// Ele foi atualizado para ler a nova coluna "preço 10 fatias" da planilha.

import fetch from 'node-fetch';
import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore, collection, addDoc, serverTimestamp } from "firebase/firestore";

// Suas credenciais do Firebase
const firebaseConfig = {
  apiKey: "AIzaSyB9LJ-7bOvHGYyFE_H2Qd7XFcyjmSPq_ro",
  authDomain: "samia-cardapio.firebaseapp.com",
  projectId: "samia-cardapio",
  storageBucket: "samia-cardapio.firebasestorage.app",
  messagingSenderId: "223260436641",
  appId: "1:223260436641:web:adf78e77a0267f66f1e8e0"
};

// Inicializa o Firebase de forma segura (evita reinicialização)
let app;
if (!getApps().length) {
    app = initializeApp(firebaseConfig);
} else {
    app = getApp();
}
const db = getFirestore(app);

export default async (req, res) => {
    // Permite requisições de qualquer origem (CORS)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Responde a requisições OPTIONS (pre-flight)
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { order, selectedAddress, total, paymentMethod, whatsappNumber, observation } = req.body;

        if (!order || !selectedAddress || !total) {
            return res.status(400).json({ error: 'Dados do pedido incompletos.' });
        }
        
        if (!whatsappNumber) {
            console.error('Erro Crítico: O número do WhatsApp não foi recebido do frontend.');
            return res.status(400).json({ error: 'O número de WhatsApp para receber o pedido não foi configurado.' });
        }

        // Salva o pedido no Firestore
        let pdvSaved = false;
        let pdvError = null;
        try {
			
            // Simulação de erro ao salvar no Firestore (para testes)
            //console.error('[TEST] Simulando erro no Firestore: SIMULATED_FIRESTORE_ERROR');
            //throw new Error('SIMULATED_FIRESTORE_ERROR');
			
            await addDoc(collection(db, "pedidos"), {
                itens: order,
                endereco: selectedAddress,
                total: total,
                pagamento: paymentMethod,
                status: 'Novo',
                criadoEm: serverTimestamp(),
                observacao: observation || ''
            });
            pdvSaved = true;
        } catch (firestoreError) {
            console.error('Falha ao salvar pedido no Firestore (PDV):', firestoreError);
            pdvError = String(firestoreError && firestoreError.message ? firestoreError.message : firestoreError);
            // Continua o fluxo para enviar ao WhatsApp mesmo assim
        }


        // Monta a mensagem para o WhatsApp agrupando por categoria
        const itemsByCategory = order.reduce((acc, item) => {
            const category = item.category || 'Outros';
            if (!acc[category]) {
                acc[category] = [];
            }
            acc[category].push(item);
            return acc;
        }, {});

        let itemsText = '';
        const categoryKeys = Object.keys(itemsByCategory);
        categoryKeys.forEach((category, catIndex) => {
            itemsText += `\n*> ${category.toUpperCase()} <*\n`;
            const items = itemsByCategory[category];
            items.forEach((item, itemIndex) => {
                 if (item.type === 'custom_burger') {
                    itemsText += `  • ${item.name}: R$ ${item.basePrice.toFixed(2).replace('.', ',')}\n`;
                    if (item.ingredients && item.ingredients.length > 0) {
                        const ingredientsString = item.ingredients.map(ing => {
                            const quantityText = ing.quantity > 1 ? ` (x${ing.quantity})` : '';
                            const priceText = ing.price > 0 ? `: R$ ${(ing.price * ing.quantity).toFixed(2).replace('.', ',')}` : '';
                            return `     + _${ing.name}${quantityText}${priceText}_`;
                        }).join('\n');
                        itemsText += `${ingredientsString}\n`;
                    }
                    itemsText += `        *Total C/ Ingredientes: R$ ${item.price.toFixed(2).replace('.', ',')}*\n`;
                } else {
                    let itemBasePrice = item.price;
                    if (item.extras && item.extras.length > 0) {
                        item.extras.forEach(extra => {
                           itemBasePrice -= (extra.price * extra.quantity);
                        });
                    }
                    
                    let itemName = item.name.includes(':') ? item.name.split(': ')[1] : item.name;
                    let itemSize = item.name.includes(':') ? `*${item.name.split(': ')[0]}:* ` : '';

                    itemsText += `  • ${itemSize}${itemName}: R$ ${itemBasePrice.toFixed(2).replace('.', ',')}\n`;
                    
                    if (item.extras && item.extras.length > 0) {
                        const extrasString = item.extras.map(extra => {
                            const quantityText = extra.quantity > 1 ? ` (x${extra.quantity})` : '';
                            return `     + _${extra.name} (${extra.placement})${quantityText}: R$ ${(extra.price * extra.quantity).toFixed(2).replace('.', ',')}_`;
                        }).join('\n');
                        itemsText += `${extrasString}\n`;
                        itemsText += `        *Total C/ Adicionais: R$ ${item.price.toFixed(2).replace('.', ',')}*\n`;
                    }
                }

                if (itemIndex < items.length - 1) {
                    itemsText += '------------------------------------\n';
                }
            });
        });

        let paymentText = '';
        if (typeof paymentMethod === 'object' && paymentMethod.method === 'Dinheiro') {
            paymentText = `Pagamento: *Dinheiro*\nTroco para: *R$ ${paymentMethod.trocoPara.toFixed(2).replace('.', ',')}*\nTroco: *R$ ${paymentMethod.trocoTotal.toFixed(2).replace('.', ',')}*`;
        } else {
            paymentText = `Pagamento: *${paymentMethod}*`;
        }
		
        let discountText = '';
        if (total.discount && total.discount > 0) {
            discountText = `Desconto: - R$ ${total.discount.toFixed(2).replace('.', ',')}\n`;
        }
        
        let observationText = '';
        if (observation && observation.trim() !== '') {
            observationText = `\n*OBSERVAÇÕES:*\n_${observation.trim()}_`;
        }
        
        const addressText = selectedAddress.rua === "Retirada no Balcão" 
            ? `${selectedAddress.rua}, S/N - Retirada`
            : `${selectedAddress.rua}, ${selectedAddress.numero} - ${selectedAddress.bairro}`;

        const fullMessage = `
-- *NOVO PEDIDO* --

*Cliente:* ${selectedAddress.clientName}
*Endereço:* ${addressText}
${selectedAddress.referencia ? `*Referência:* ${selectedAddress.referencia}` : ''}

*------------------------------------*
*PEDIDO:*
${itemsText}
------------------------------------
Subtotal: R$ ${total.subtotal.toFixed(2).replace('.', ',')}
${discountText}Taxa de Entrega: R$ ${total.deliveryFee.toFixed(2).replace('.', ',')}
*Total: R$ ${total.finalTotal.toFixed(2).replace('.', ',')}*
${paymentText}
${observationText}
        `.trim();
        
        const targetNumber = `55${whatsappNumber.replace(/\D/g, '')}`;
        const whatsappUrl = `https://wa.me/${targetNumber}?text=${encodeURIComponent(fullMessage)}`;

        res.status(200).json({ success: true, whatsappUrl, pdvSaved, pdvError });

    } catch (error) {
        console.error('Erro ao processar pedido:', error);
        res.status(500).json({ error: 'Erro interno no servidor.' });
    }
};
