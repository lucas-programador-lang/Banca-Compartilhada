import { auth, db } from './auth.js';
import { ref, push, set, onValue } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

// Função de Toast (Mantida)
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
    setTimeout(() => toast.remove(), 3000);
}

document.addEventListener('DOMContentLoaded', () => {
    // Monitorar usuário autenticado
    auth.onAuthStateChanged((user) => {
        if (user) {
            const userId = user.uid;

            // 1. Carregar Dados do Usuário em Tempo Real (Saldos, etc)
            const userRef = ref(db, 'usuarios/' + userId);
            onValue(userRef, (snapshot) => {
                const dados = snapshot.val();
                if (dados) {
                    document.getElementById('saldoDisponivel').innerText = `R$ ${(dados.saldo || 0).toFixed(2)}`;
                    document.getElementById('rendimentoTotal').innerText = `R$ ${(dados.rendimento || 0).toFixed(2)}`;
                    document.getElementById('comissaoTotal').innerText = `R$ ${(dados.comissao || 0).toFixed(2)}`;
                }
            });

            // 2. Ação de Solicitar Saque
            const btnSacar = document.getElementById('btnSacar');
            if (btnSacar) {
                btnSacar.addEventListener('click', () => {
                    const hoje = new Date().getDay(); // 0 = Domingo
                    const valorSaque = parseFloat(document.getElementById('valorSaque').value);
                    const chavePix = document.getElementById('chavePix').value;

                    if (hoje !== 0) {
                        mostrarToast('⚠️ Os saques estão liberados apenas aos DOMINGOS.', 'warning');
                        return;
                    }
                    if (!valorSaque || valorSaque < 35) {
                        mostrarToast('⚠️ O valor mínimo para saque é de R$ 35,00.', 'error');
                        return;
                    }
                    if (!chavePix) {
                        mostrarToast('⚠️ Por favor, informe a sua chave PIX.', 'warning');
                        return;
                    }

                    // Salvando o saque no Realtime Database na pasta do usuário
                    const saquesRef = ref(db, 'saques/' + userId);
                    const novoSaqueRef = push(saquesRef);
                    
                    set(novoSaqueRef, {
                        chavePix: chavePix,
                        valor: valorSaque,
                        dataHora: new Date().toLocaleString('pt-BR'),
                        status: 'Pendente'
                    }).then(() => {
                        mostrarToast('✅ Saque solicitado com sucesso!', 'success');
                        document.getElementById('valorSaque').value = '';
                        document.getElementById('chavePix').value = '';
                    }).catch((error) => {
                        mostrarToast('❌ Erro ao solicitar saque: ' + error.message, 'error');
                    });
                });
            }
        }
    });

    // Ação do Botão de Depósito (API PIX)
    const btnDepositar = document.getElementById('btnDepositar');
    if (btnDepositar) {
        btnDepositar.addEventListener('click', () => {
            const plano = document.getElementById('valorPlano').value;
            mostrarToast(`Gerando PIX via API para o plano de R$ ${plano},00...`, 'success');
            // Aqui você chamará a sua API de pagamento (Mercado Pago, OpenPix, etc.)
        });
    }
});
