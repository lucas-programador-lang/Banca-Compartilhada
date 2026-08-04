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

/**
 * Achata a estrutura saques/{uid}/{id} ou depositos/{uid}/{id} em uma
 * lista plana, já incluindo o uid de cada registro (necessário para
 * cruzar com o nome/email do usuário depois).
 */
function achatarPorUsuario(dadosPorUsuario) {
    if (!dadosPorUsuario) return [];
    const lista = [];
    Object.entries(dadosPorUsuario).forEach(([uid, registros]) => {
        Object.entries(registros || {}).forEach(([id, valor]) => {
            lista.push({ uid, id, ...valor });
        });
    });
    return lista.sort((a, b) => {
        const dataA = new Date(a.dataSolicitacao || 0).getTime();
        const dataB = new Date(b.dataSolicitacao || 0).getTime();
        return dataB - dataA;
    });
}

function nomeDoUsuario(usuarios, uid) {
    const dados = usuarios?.[uid];
    if (!dados) return uid;
    return dados.nome || dados.email || uid;
}

function renderizarTabelaSaques(saques, usuarios) {
    const tbody = document.getElementById('tabelaSaquesAdmin');
    if (!tbody) return;

    if (!saques.length) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">Nenhum saque solicitado ainda.</td></tr>';
    } else {
        tbody.innerHTML = saques.map(saque => `
            <tr>
                <td>${formatarDataHora(saque.dataSolicitacao)}</td>
                <td>${nomeDoUsuario(usuarios, saque.uid)}</td>
                <td>${saque.chavePix || '—'}</td>
                <td>${formatadorMoeda.format(saque.valorSolicitado || 0)}</td>
                <td>${badgeStatus(saque.status)}</td>
            </tr>
        `).join('');
    }

    const pendentes = saques.filter(s => (s.status || 'pendente').toLowerCase() === 'pendente').length;
    const elTotal = document.getElementById('totalSaquesPendentes');
    if (elTotal) elTotal.textContent = pendentes;
}

function renderizarTabelaDepositos(depositos, usuarios) {
    const tbody = document.getElementById('tabelaDepositosAdmin');
    if (!tbody) return;

    if (!depositos.length) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">Nenhum depósito registrado.</td></tr>';
    } else {
        tbody.innerHTML = depositos.map(deposito => `
            <tr>
                <td>${formatarDataHora(deposito.dataSolicitacao)}</td>
                <td>${nomeDoUsuario(usuarios, deposito.uid)}</td>
                <td>${formatadorMoeda.format(deposito.valorPlano || 0)}</td>
                <td>${badgeStatus(deposito.status)}</td>
            </tr>
        `).join('');
    }

    const pendentes = depositos.filter(d => (d.status || 'pendente').toLowerCase() === 'pendente').length;
    const elTotal = document.getElementById('totalDepositosPendentes');
    if (elTotal) elTotal.textContent = pendentes;
}

/**
 * Mantém em memória a última versão de cada fonte de dados (usuários,
 * saques, depósitos), já que os três chegam de listeners independentes
 * e as tabelas precisam sempre do cruzamento mais recente dos três.
 */
const estado = {
    usuarios: null,
    saques: null,
    depositos: null,
};

function rerenderizarTudo() {
    if (estado.saques !== null) {
        renderizarTabelaSaques(achatarPorUsuario(estado.saques), estado.usuarios || {});
    }
    if (estado.depositos !== null) {
        renderizarTabelaDepositos(achatarPorUsuario(estado.depositos), estado.usuarios || {});
    }
}

function iniciarListenersAdmin() {
    const usuariosRef = ref(db, 'usuarios');
    onValue(usuariosRef, (snapshot) => {
        estado.usuarios = snapshot.val();
        rerenderizarTudo();
    });

    const saquesRef = ref(db, 'saques');
    onValue(saquesRef, (snapshot) => {
        estado.saques = snapshot.val();
        rerenderizarTudo();
    });

    const depositosRef = ref(db, 'depositos');
    onValue(depositosRef, (snapshot) => {
        estado.depositos = snapshot.val();
        rerenderizarTudo();
    });
}

auth.onAuthStateChanged((user) => {
    if (!user) return;

    const acessoNegado = document.getElementById('acessoNegado');
    const conteudoAdmin = document.getElementById('conteudoAdmin');

    // Verifica a flag isAdmin do usuário logado antes de exibir qualquer
    // dado. Isto é só uma camada de conveniência de interface — a
    // segurança de verdade precisa vir das Regras do Realtime Database,
    // que devem bloquear a leitura de "usuarios", "saques" e "depositos"
    // para quem não tiver essa mesma flag marcada no servidor.
    const perfilRef = ref(db, 'usuarios/' + user.uid + '/isAdmin');
    onValue(perfilRef, (snapshot) => {
        const ehAdmin = snapshot.val() === true;

        if (ehAdmin) {
            if (acessoNegado) acessoNegado.style.display = 'none';
            if (conteudoAdmin) conteudoAdmin.style.display = 'block';
            iniciarListenersAdmin();
        } else {
            if (acessoNegado) acessoNegado.style.display = 'block';
            if (conteudoAdmin) conteudoAdmin.style.display = 'none';
        }
    }, (error) => {
        // Se as Regras do Firebase corretamente negarem a leitura para
        // não-admins, o Firebase dispara um erro de permissão aqui —
        // tratamos isso da mesma forma que "não é admin".
        console.error('Erro ao verificar permissão de admin:', error);
        if (acessoNegado) acessoNegado.style.display = 'block';
        if (conteudoAdmin) conteudoAdmin.style.display = 'none';
    });
});
