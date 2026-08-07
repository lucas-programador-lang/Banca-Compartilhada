import { auth, db, mostrarToast } from './auth.js';
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

/**
 * Escapa caracteres especiais de HTML antes de inserir qualquer dado
 * vindo do Firebase (nome, chave PIX etc.) dentro de innerHTML. Sem
 * isso, alguém poderia se cadastrar com um "nome" contendo tags/script
 * e esse código executaria no navegador de quem visualizar aquele
 * dado — inclusive o admin, ao abrir este painel.
 */
function escapeHTML(texto) {
    return String(texto ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    }[c]));
}

function renderizarTabelaSaques(saques, usuarios) {
    const tbody = document.getElementById('tabelaSaquesAdmin');
    if (!tbody) return;

    if (!saques.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="table-empty">Nenhum saque solicitado ainda.</td></tr>';
    } else {
        tbody.innerHTML = saques.map(saque => `
            <tr>
                <td>${formatarDataHora(saque.dataSolicitacao)}</td>
                <td>${escapeHTML(nomeDoUsuario(usuarios, saque.uid))}</td>
                <td>${escapeHTML(saque.chavePix) || '—'}</td>
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
        tbody.innerHTML = '<tr><td colspan="5" class="table-empty">Nenhum depósito registrado.</td></tr>';
    } else {
        tbody.innerHTML = depositos.map(deposito => {
            const status = (deposito.status || 'pendente').toLowerCase();
            const acoes = status === 'pendente'
                ? `
                    <div class="admin-actions">
                        <button
                            class="btn-approve btn-aprovar-deposito"
                            data-uid="${deposito.uid}"
                            data-id="${deposito.id}"
                            data-valor="${deposito.valorPlano || 0}"
                        >Aprovar</button>
                        <button
                            class="btn-reject btn-recusar-deposito"
                            data-uid="${deposito.uid}"
                            data-id="${deposito.id}"
                        >Recusar</button>
                    </div>
                `
                : '—';

            return `
                <tr>
                    <td>${formatarDataHora(deposito.dataSolicitacao)}</td>
                    <td>${escapeHTML(nomeDoUsuario(usuarios, deposito.uid))}</td>
                    <td>${formatadorMoeda.format(deposito.valorPlano || 0)}</td>
                    <td>${badgeStatus(deposito.status)}</td>
                    <td>${acoes}</td>
                </tr>
            `;
        }).join('');
    }

    const pendentes = depositos.filter(d => (d.status || 'pendente').toLowerCase() === 'pendente').length;
    const elTotal = document.getElementById('totalDepositosPendentes');
    if (elTotal) elTotal.textContent = pendentes;
}

/**
 * Lista de Usuários e Saldos — mostra, para cada cliente cadastrado em
 * usuarios/{uid}, o saldo sacável atual e a comissão de indicação
 * acumulada. Esses dois valores agora moram em financeiro/{uid}
 * (saldoRendimento + saldoComissao para o saldo, comissao para o total
 * histórico) — não mais em usuarios/{uid}, que só guarda dados de
 * perfil (nome, e-mail, chave PIX, isAdmin).
 */
function renderizarTabelaUsuarios(usuariosObj, financeiroObj, filtro) {
    const tbody = document.getElementById('tabelaUsuariosAdmin');
    if (!tbody) return;

    const termo = (filtro || '').trim().toLowerCase();
    let lista = Object.entries(usuariosObj || {}).map(([uid, dados]) => {
        const financeiro = (financeiroObj || {})[uid] || {};
        const saldo = parseFloat(financeiro.saldoRendimento || 0) + parseFloat(financeiro.saldoComissao || 0);
        const comissao = parseFloat(financeiro.comissao || 0);
        return { uid, ...dados, saldo, comissao };
    });

    if (termo) {
        lista = lista.filter(u =>
            (u.nome || '').toLowerCase().includes(termo) ||
            (u.email || '').toLowerCase().includes(termo)
        );
    }

    // Maior saldo primeiro — é normalmente o que o admin quer ver de cara.
    lista.sort((a, b) => b.saldo - a.saldo);

    if (!lista.length) {
        const mensagem = termo ? 'Nenhum usuário encontrado para essa busca.' : 'Nenhum usuário cadastrado ainda.';
        tbody.innerHTML = `<tr><td colspan="5" class="table-empty">${mensagem}</td></tr>`;
    } else {
        tbody.innerHTML = lista.map(u => `
            <tr>
                <td>${escapeHTML(u.nome) || '—'}</td>
                <td>${escapeHTML(u.email) || '—'}</td>
                <td>${formatadorMoeda.format(u.saldo)}</td>
                <td>${formatadorMoeda.format(u.comissao)}</td>
                <td>${u.isAdmin ? '<span class="status-badge status-admin">Admin</span>' : '—'}</td>
            </tr>
        `).join('');
    }

    // Total e contagem sempre refletem TODOS os usuários, não só o
    // resultado filtrado da busca.
    const todosUids = Object.keys(usuariosObj || {});
    const somaSaldos = todosUids.reduce((soma, uid) => {
        const financeiro = (financeiroObj || {})[uid] || {};
        return soma + parseFloat(financeiro.saldoRendimento || 0) + parseFloat(financeiro.saldoComissao || 0);
    }, 0);

    const elTotalSaldo = document.getElementById('totalSaldoUsuarios');
    if (elTotalSaldo) elTotalSaldo.textContent = formatadorMoeda.format(somaSaldos);

    const elTotalUsuarios = document.getElementById('totalUsuariosCadastrados');
    if (elTotalUsuarios) elTotalUsuarios.textContent = todosUids.length;
}

/**
 * URL base do mesmo Worker que já processa o Pix — as ações de admin
 * (aprovar/recusar depósito) agora passam por ele, autenticadas com o
 * ID Token do admin logado, em vez de escrever direto no Firebase pelo
 * SDK do navegador. Isso elimina a duplicação de creditarComissaoIndicacao
 * que existia aqui (schema antigo, causou o bug de comissão não
 * aparecer em Início/Equipe) — agora só existe uma implementação dessa
 * regra, dentro do worker.js, reaproveitada tanto pelo webhook real da
 * Vizzion Pay quanto pela aprovação manual.
 */
const WORKER_BASE_URL = 'https://apidabancacompartilhada.lucas-dev-programador.workers.dev';

/**
 * Aprova um depósito chamando o Worker, que verifica se quem está
 * pedindo é admin de verdade (via ID Token + isAdmin no Firebase),
 * cria o plano, credita a comissão de indicação (se houver) e marca o
 * depósito como aprovado — tudo numa única fonte de verdade.
 */
async function aprovarDeposito(uid, depositoId, valorPlano) {
    try {
        const idToken = await auth.currentUser.getIdToken();

        const resposta = await fetch(`${WORKER_BASE_URL}/api/admin/aprovar-deposito`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`,
            },
            body: JSON.stringify({ uid, depositoId, valorPlano }),
        });

        const dadosResposta = await resposta.json();
        if (!resposta.ok) {
            throw new Error(dadosResposta.error || 'Erro ao aprovar depósito.');
        }

        mostrarToast('✅ Depósito aprovado! O plano já está ativo na Carteira do usuário.', 'success');
    } catch (error) {
        console.error('Erro ao aprovar depósito:', error);
        mostrarToast('❌ Erro ao aprovar depósito: ' + error.message, 'error');
    }
}

async function recusarDeposito(uid, depositoId) {
    try {
        const idToken = await auth.currentUser.getIdToken();

        const resposta = await fetch(`${WORKER_BASE_URL}/api/admin/recusar-deposito`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`,
            },
            body: JSON.stringify({ uid, depositoId }),
        });

        const dadosResposta = await resposta.json();
        if (!resposta.ok) {
            throw new Error(dadosResposta.error || 'Erro ao recusar depósito.');
        }

        mostrarToast('Depósito recusado.', 'warning');
    } catch (error) {
        console.error('Erro ao recusar depósito:', error);
        mostrarToast('❌ Erro ao recusar depósito: ' + error.message, 'error');
    }
}

// Delegação de eventos: os botões de aprovar/recusar são recriados a
// cada render da tabela, então o listener fica no tbody (que existe
// desde o carregamento da página) em vez de nos botões individuais.
function iniciarDelegacaoAcoesDepositos() {
    const tbody = document.getElementById('tabelaDepositosAdmin');
    if (!tbody || tbody.dataset.listenerAtivo) return;

    tbody.addEventListener('click', (e) => {
        const btnAprovar = e.target.closest('.btn-aprovar-deposito');
        const btnRecusar = e.target.closest('.btn-recusar-deposito');

        if (btnAprovar) {
            const { uid, id, valor } = btnAprovar.dataset;
            btnAprovar.disabled = true;
            btnAprovar.textContent = 'Aprovando...';
            aprovarDeposito(uid, id, valor);
        }

        if (btnRecusar) {
            const { uid, id } = btnRecusar.dataset;
            btnRecusar.disabled = true;
            btnRecusar.textContent = 'Recusando...';
            recusarDeposito(uid, id);
        }
    });

    tbody.dataset.listenerAtivo = 'true';
}

// Campo de busca da tabela de Usuários — filtra em memória (sem nova
// consulta ao Firebase) por nome ou e-mail a cada tecla digitada.
function iniciarBuscaUsuarios() {
    const input = document.getElementById('buscaUsuarios');
    if (!input || input.dataset.listenerAtivo) return;

    input.addEventListener('input', (e) => {
        estado.filtroUsuarios = e.target.value;
        renderizarTabelaUsuarios(estado.usuarios || {}, estado.financeiro || {}, estado.filtroUsuarios);
    });

    input.dataset.listenerAtivo = 'true';
}

/**
 * Mantém em memória a última versão de cada fonte de dados (usuários,
 * financeiro, saques, depósitos), já que os quatro chegam de listeners
 * independentes e as tabelas precisam sempre do cruzamento mais
 * recente de todos.
 */
const estado = {
    usuarios: null,
    financeiro: null,
    saques: null,
    depositos: null,
    filtroUsuarios: '',
};

function rerenderizarTudo() {
    if (estado.saques !== null) {
        renderizarTabelaSaques(achatarPorUsuario(estado.saques), estado.usuarios || {});
    }
    if (estado.depositos !== null) {
        renderizarTabelaDepositos(achatarPorUsuario(estado.depositos), estado.usuarios || {});
    }
    if (estado.usuarios !== null) {
        renderizarTabelaUsuarios(estado.usuarios, estado.financeiro || {}, estado.filtroUsuarios);
    }
}

function iniciarListenersAdmin() {
    iniciarDelegacaoAcoesDepositos();
    iniciarBuscaUsuarios();

    const usuariosRef = ref(db, 'usuarios');
    onValue(usuariosRef, (snapshot) => {
        estado.usuarios = snapshot.val();
        rerenderizarTudo();
    });

    const financeiroRef = ref(db, 'financeiro');
    onValue(financeiroRef, (snapshot) => {
        estado.financeiro = snapshot.val();
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
    // que devem bloquear a leitura de "usuarios", "financeiro", "saques"
    // e "depositos" para quem não tiver essa mesma flag marcada no
    // servidor.
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
