import { auth, db } from './auth.js';
import { ref, onValue } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

const formatadorMoeda = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
});

const formatadorData = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
});

/**
 * Converte um registro do Firebase (objeto com chaves aleatórias) em uma
 * lista ordenada da mais recente para a mais antiga.
 */
function paraListaOrdenada(dados) {
    if (!dados) return [];
    return Object.entries(dados)
        .map(([id, valor]) => ({ id, ...valor }))
        .sort((a, b) => {
            const dataA = new Date(a.dataSolicitacao || 0).getTime();
            const dataB = new Date(b.dataSolicitacao || 0).getTime();
            return dataB - dataA;
        });
}

function formatarDataHora(isoString) {
    if (!isoString) return '—';
    const data = new Date(isoString);
    if (isNaN(data.getTime())) return '—';
    return formatadorData.format(data);
}

const STATUS_LABELS = {
    pendente: 'Pendente',
    aprovado: 'Aprovado',
    recusado: 'Recusado',
    concluido: 'Concluído',
};

const STATUS_CORES = {
    pendente: 'var(--warning)',
    aprovado: 'var(--success)',
    concluido: 'var(--success)',
    recusado: 'var(--danger)',
};

function badgeStatus(status) {
    const chave = (status || 'pendente').toLowerCase();
    const label = STATUS_LABELS[chave] || status || 'Pendente';
    const cor = STATUS_CORES[chave] || 'var(--text-muted)';
    return `<span style="color: ${cor}; font-weight: 600;">${label}</span>`;
}

function renderizarTabelaSaques(saques) {
    const tbody = document.getElementById('tabelaSaques');
    if (!tbody) return;

    if (!saques.length) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">Nenhum saque solicitado ainda.</td></tr>';
        return;
    }

    tbody.innerHTML = saques.map(saque => `
        <tr>
            <td>${formatarDataHora(saque.dataSolicitacao)}</td>
            <td>${saque.chavePix || '—'}</td>
            <td>${formatadorMoeda.format(saque.valorSolicitado || 0)}</td>
            <td>${badgeStatus(saque.status)}</td>
        </tr>
    `).join('');
}

function renderizarTabelaDepositos(depositos) {
    const tbody = document.getElementById('tabelaDepositos');
    if (!tbody) return;

    if (!depositos.length) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: var(--text-muted);">Nenhum depósito registrado.</td></tr>';
        return;
    }

    tbody.innerHTML = depositos.map(deposito => `
        <tr>
            <td>${formatarDataHora(deposito.dataSolicitacao)}</td>
            <td>${formatadorMoeda.format(deposito.valorPlano || 0)}</td>
            <td>${badgeStatus(deposito.status)}</td>
        </tr>
    `).join('');
}

auth.onAuthStateChanged((user) => {
    if (!user) return;
    const userId = user.uid;

    // onValue mantém o listener ativo: qualquer mudança no Firebase
    // (novo saque, aprovação, etc.) atualiza a tabela automaticamente,
    // sem precisar recarregar a página.
    const saquesRef = ref(db, 'saques/' + userId);
    onValue(saquesRef, (snapshot) => {
        const lista = paraListaOrdenada(snapshot.val());
        renderizarTabelaSaques(lista);
    });

    const depositosRef = ref(db, 'depositos/' + userId);
    onValue(depositosRef, (snapshot) => {
        const lista = paraListaOrdenada(snapshot.val());
        renderizarTabelaDepositos(lista);
    });
});
