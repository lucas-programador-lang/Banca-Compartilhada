// Função global para disparar toasts modernos
function mostrarToast(mensagem, tipo = 'success') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast ${tipo}`;
    toast.innerHTML = `<span>${mensagem}</span>`;

    container.appendChild(toast);

    // Remove o elemento após a animação acabar (3 segundos)
    setTimeout(() => {
        toast.remove();
    }, 3000);
}

document.addEventListener('DOMContentLoaded', () => {
    // Validação de regras de saque no painel
    const btnSacar = document.getElementById('btnSacar');
    if (btnSacar) {
        btnSacar.addEventListener('click', () => {
            const hoje = new Date().getDay(); // 0 = Domingo, 1 = Segunda, etc.
            const valorSaque = parseFloat(document.getElementById('valorSaque').value);
            const chavePix = document.getElementById('chavePix').value;

            // Regra: Saques somente de domingo (getDay() === 0)
            if (hoje !== 0) {
                mostrarToast('⚠️ Os saques estão liberados estritamente apenas aos DOMINGOS.', 'warning');
                return;
            }

            // Regra: Saque mínimo de 35 reais
            if (!valorSaque || valorSaque < 35) {
                mostrarToast('⚠️ O valor mínimo para saque é de R$ 35,00.', 'error');
                return;
            }

            if (!chavePix) {
                mostrarToast('⚠️ Por favor, informe a sua chave PIX.', 'warning');
                return;
            }

            const valorComTaxa = valorSaque - (valorSaque * 0.14);
            mostrarToast(`✅ Saque solicitado! Líquido c/ 14% taxa: R$ ${valorComTaxa.toFixed(2)}`, 'success');
            
            // Aqui você adicionaria a chamada para salvar no Firestore do Firebase:
            // db.collection("saques").add({ chavePix, valor: valorSaque, data: new Date(), status: "Pendente" });
        });
    }

    // Ação do Botão de Depósito (PIX API)
    const btnDepositar = document.getElementById('btnDepositar');
    if (btnDepositar) {
        btnDepositar.addEventListener('click', () => {
            const plano = document.getElementById('valorPlano').value;
            mostrarToast(`Gerando PIX via API para o plano de R$ ${plano},00...`, 'success');
            // Integrar com sua API de pagamento PIX (ex: Mercado Pago, OpenPix, SuitPay)
        });
    }
});
