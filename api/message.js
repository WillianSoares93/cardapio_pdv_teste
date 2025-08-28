// /api/test-message.js

export default async function handler(req, res) {
    const { WHATSAPP_API_TOKEN, WHATSAPP_PHONE_NUMBER_ID } = process.env;

    // IMPORTANTE: Substitua pelo seu número de teste pessoal no formato internacional (ex: 5587996070638)
    const TEST_RECIPIENT_PHONE_NUMBER = '5587996070638';

    const whatsappURL = `https://graph.facebook.com/v22.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

    console.log('Tentando enviar mensagem de teste para:', TEST_RECIPIENT_PHONE_NUMBER);
    console.log('Usando Phone Number ID:', WHATSAPP_PHONE_NUMBER_ID);

    try {
        const response = await fetch(whatsappURL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${WHATSAPP_API_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                to: TEST_RECIPIENT_PHONE_NUMBER,
                text: { body: 'Olá! Este é um teste direto da API. Se você recebeu isso, suas credenciais estão funcionando.' }
            })
        });

        const responseBody = await response.json();

        if (!response.ok) {
            console.error('Erro da API do WhatsApp:', JSON.stringify(responseBody, null, 2));
            return res.status(400).json({
                success: false,
                message: 'Falha ao enviar mensagem.',
                error: responseBody
            });
        }

        console.log('Mensagem de teste enviada com sucesso:', responseBody);
        return res.status(200).json({
            success: true,
            message: 'Mensagem de teste enviada com sucesso!',
            response: responseBody
        });

    } catch (error) {
        console.error('Erro crítico ao tentar enviar mensagem de teste:', error);
        return res.status(500).json({
            success: false,
            message: 'Erro interno no servidor.',
            error: error.message
        });
    }
}
