import { initializeApp } from "firebase/app";
import { getFirestore, collection, addDoc, serverTimestamp } from "firebase/firestore";
import fetch from 'node-fetch';

// Suas credenciais do Firebase já inseridas
const firebaseConfig = {
  apiKey: "AIzaSyBJ44RVDGhBIlQBTx-pyIUp47XDKzRXk84",
  authDomain: "pizzaria-pdv.firebaseapp.com",
  projectId: "pizzaria-pdv",
  storageBucket: "pizzaria-pdv.appspot.com",
  messagingSenderId: "304171744691",
  appId: "1:304171744691:web:e54d7f9fe55c7a75485fc6"
};

const CONTACT_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQJeo2AAETdXC08x9EQlkIG1FiVLEosMng4IvaQYJAdZnIDHJw8CT8J5RAJNtJ5GWHOKHkUsd5V8OSL/pub?gid=2043568216&single=true&output=csv';

// Inicializa o Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Função para parsear CSV
function parseCsvData(csvText) {
    const lines = csvText.split('\n').filter(line => line.trim() !== '');
    if (lines.length < 2) return [];

    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/\s/g, ''));
    const data = [];
    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim());
        let entry = {};
        headers.forEach((header, index) => {
            entry[header] = values[index];
        });
        data.push(entry);
    }
    return data;
}


export default async (req, res) => {
  // Permite que o seu site acesse esta API
  res.setHeader('Access-Control-Allow-Origin', '*'); 
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  try {
    // Busca os dados de contato primeiro
    const contactResponse = await fetch(CONTACT_CSV_URL);
    if (!contactResponse.ok) {
        throw new Error('Falha ao buscar dados de contato.');
    }
    const contactCsvText = await contactResponse.text();
    const contactData = parseCsvData(contactCsvText);
    
    const contactInfo = contactData.reduce((acc, curr) => {
        if (curr.dados && curr.valor) {
            acc[curr.dados.toLowerCase().replace(/[^a-z0-9]/g, '')] = curr.valor;
        }
        return acc;
    }, {});
    
    const whatsappNumber = contactInfo.whatsapp ? `55${contactInfo.whatsapp.replace(/\D/g, '')}` : '5587996070638'; // Fallback

    const { order, selectedAddress, total, paymentMethod } = req.body;
    
    if (!order || !selectedAddress || !total || !paymentMethod) {
        return res.status(400).json({ error: 'Dados do pedido incompletos.' });
    }

    // Adiciona informações extras ao pedido antes de salvar
    const pedidoCompleto = {
        itens: order,
        endereco: selectedAddress,
        total: total,
        pagamento: paymentMethod, // Salva a forma de pagamento
        status: 'Novo', 
        criadoEm: serverTimestamp()
    };

    // Salva o pedido no banco de dados Firestore, na coleção "pedidos"
    const docRef = await addDoc(collection(db, "pedidos"), pedidoCompleto);
    console.log("Pedido salvo com ID: ", docRef.id);

    // Lógica para gerar a mensagem do WhatsApp
    let message = `Olá! Gostaria de fazer o seguinte pedido (Nº ${docRef.id.substring(0, 5)}):\n\n`;
    
    order.forEach(item => {
        message += `- ${item.name}: R$ ${item.price.toFixed(2).replace('.', ',')}\n`;
    });
    
    message += `\nSubtotal: R$ ${total.subtotal.toFixed(2).replace('.', ',')}`;
    if (total.discount > 0) {
      message += `\nDesconto: -R$ ${total.discount.toFixed(2).replace('.', ',')}`;
    }
    message += `\nTaxa de entrega: R$ ${total.deliveryFee.toFixed(2).replace('.', ',')}`;
    message += `\n*Total: R$ ${total.finalTotal.toFixed(2).replace('.', ',')}*`;
    
    // Adiciona forma de pagamento na mensagem
    let paymentText = '';
    if (typeof paymentMethod === 'object' && paymentMethod.method === 'Dinheiro') {
        paymentText = `Dinheiro (Troco para R$ ${paymentMethod.trocoPara.toFixed(2).replace('.', ',')})`;
    } else {
        paymentText = paymentMethod;
    }
    message += `\n*Pagamento:* ${paymentText}`;

    message += `\n\n*Dados da Entrega:*\n`;
    message += `Nome: ${selectedAddress.clientName}\n`;
    message += `Endereço: ${selectedAddress.rua}, Nº ${selectedAddress.numero}, ${selectedAddress.bairro}\n`;
    if (selectedAddress.referencia) {
        message += `Ponto de Referência: ${selectedAddress.referencia}\n`;
    }

    const whatsappUrl = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`;

    res.status(200).json({ success: true, whatsappUrl: whatsappUrl });

  } catch (error) {
    console.error("Erro ao salvar pedido: ", error);
    res.status(500).json({ error: "Erro interno ao processar o pedido." });
  }
};
