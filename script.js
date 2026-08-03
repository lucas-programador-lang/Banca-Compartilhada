// Configuração base (Substituir com os dados do seu projeto Firebase)
// firebase.initializeApp(firebaseConfig);

document.addEventListener('DOMContentLoaded', () => {
    // Validação de regras no painel
    const btnSacar = document.getElementById('btnSacar');
    if (btnSacar) {
        btnSacar.addEventListener('click', () => {
            const hoje = new Date().getDay(); // 0 = Domingo, 1 = Segunda, etc.
            const valorSaque = parseFloat(document.getElementById('valorSaque').value);
            const chavePix = document.getElementById('chavePix').value;

            // Regra: Saques somente de domingo (getDay() === 0)
            if (hoje !== 0) {
                alert('⚠️ Os saques estão liberados estritamente apenas aos DOMINGOS.');
                return;
            }

            // Regra: Saque mínimo de 35 reais
            if (!valorSaque || valorSaque < 35) {
                alert('⚠️ O valor mínimo para saque é de R$ 35,00.');
                return;
            }

            if (!chavePix) {
                alert('⚠️ Por favor, informe a sua chave PIX.');
                return;
            }

            const valorComTaxa = valorSaque - (valorSaque * 0.14);
            alert(`✅ Saque solicitado com sucesso!\nValor líquido com 14% de taxa: R$ ${valorComTaxa.toFixed(2)}\nO histórico será atualizado.`);
            
            // Aqui você adicionaria a chamada para salvar no Firestore do Firebase:
            // db.collection("saques").add({ chavePix, valor: valorSaque, data: new Date(), status: "Pendente" });
        });
    }

    const btnDepositar = document.getElementById('btnDepositar');
    if (btnDepositar) {
        btnDepositar.addEventListener('click', () => {
            const plano = document.getElementById('valorPlano').value;
            alert(`Gerando PIX de pagamento via API para o plano de R$ ${plano},00...`);
            // Integrar com sua API de pagamento PIX (ex: Mercado Pago, OpenPix, SuitPay)
        });
    }
});
