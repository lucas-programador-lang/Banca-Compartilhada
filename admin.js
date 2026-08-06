import { auth, db, mostrarToast } from './auth.js';
import { ref, onValue, update, push, set, get } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

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
 * Regras de rendimento por valor de plano, espelhando o que é mostrado
 * na aba "Investir" do index.html:
 *   R$ 30 / R$ 50   -> 3% ao dia, teto de 70% sobre o capital
 *   R$ 100 a 1000   -> 2% ao dia, teto de 60% sobre o capital
 */
function obterConfigPlano(valor) {
    const valorNumerico = parseFloat(valor) || 0;
    if (valorNumerico === 30 || valorNumerico === 50) {
        return { percentualDiario: 0.03, tetoPercentual: 0.70 };
    }
    return { percentualDiario: 0.02, tetoPercentual: 0.60 };
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
 * usuarios/{uid}, o saldo sacável atual (campo "saldo") e a comissão de
 * indicação acumulada (campo "comissao"). Aceita um termo de busca para
 * filtrar por nome ou e-mail sem precisar buscar de novo no Firebase.
 */
function renderizarTabelaUsuarios(usuariosObj, filtro) {
    const tbody = document.getElementById('tabelaUsuariosAdmin');
    if (!tbody) return;

    const termo = (filtro || '').trim().toLowerCase();
    let lista = Object.entries(usuariosObj || {}).map(([uid, dados]) => ({ uid, ...dados }));

    if (termo) {
        lista = lista.filter(u =>
            (u.nome || '').toLowerCase().includes(termo) ||
            (u.email || '').toLowerCase().includes(termo)
        );
    }

    // Maior saldo primeiro — é normalmente o que o admin quer ver de cara.
    lista.sort((a, b) => (parseFloat(b.saldo) || 0) - (parseFloat(a.saldo) || 0));

    if (!lista.length) {
        const mensagem = termo ? 'Nenhum usuário encontrado para essa busca.' : 'Nenhum usuário cadastrado ainda.';
        tbody.innerHTML = `<tr><td colspan="5" class="table-empty">${mensagem}</td></tr>`;
    } else {
        tbody.innerHTML = lista.map(u => `
            <tr>
                <td>${escapeHTML(u.nome) || '—'}</td>
                <td>${escapeHTML(u.email) || '—'}</td>
                <td>${formatadorMoeda.format(parseFloat(u.saldo) || 0)}</td>
                <td>${formatadorMoeda.format(parseFloat(u.comissao) || 0)}</td>
                <td>${u.isAdmin ? '<span class="status-badge status-admin">Admin</span>' : '—'}</td>
            </tr>
        `).join('');
    }

    // Total e contagem sempre refletem TODOS os usuários, não só o
    // resultado filtrado da busca.
    const todos = Object.values(usuariosObj || {});
    const somaSaldos = todos.reduce((soma, u) => soma + (parseFloat(u?.saldo) || 0), 0);

    const elTotalSaldo = document.getElementById('totalSaldoUsuarios');
    if (elTotalSaldo) elTotalSaldo.textContent = formatadorMoeda.format(somaSaldos);

    const elTotalUsuarios = document.getElementById('totalUsuariosCadastrados');
    if (elTotalUsuarios) elTotalUsuarios.textContent = todos.length;
}

/**
 * Percentual de comissão de indicação (1º nível), pago sobre o valor
 * do plano ativado por um indicado.
 */
const PERCENTUAL_COMISSAO_INDICACAO = 0.15;

/**
 * Se o dono do depósito (uid) foi indicado por alguém (campo
 * indicadoPor em usuarios/{uid}), credita 15% do valor do plano para
 * o indicador — tanto na comissão acumulada quanto no saldo sacável —
 * e registra o lançamento em extrato/{uidIndicador}, que é o que faz
 * a comissão aparecer em tempo real na Equipe e no Extrato do
 * indicador.
 */
async function creditarComissaoIndicacao(uidIndicado, valorPlano) {
    try {
        const indicadoSnap = await get(ref(db, 'usuarios/' + uidIndicado));
        const dadosIndicado = indicadoSnap.val();
        const uidIndicador = dadosIndicado?.indicadoPor;
        if (!uidIndicador) return;

        const indicadorRef = ref(db, 'usuarios/' + uidIndicador);
        const indicadorSnap = await get(indicadorRef);
        const dadosIndicador = indicadorSnap.val();
        if (!dadosIndicador) return; // link de indicação inválido / indicador não existe mais

        const valorComissao = (parseFloat(valorPlano) || 0) * PERCENTUAL_COMISSAO_INDICACAO;
        const comissaoAtual = parseFloat(dadosIndicador.comissao || 0);
        const saldoAtual = parseFloat(dadosIndicador.saldo || 0);

        await update(indicadorRef, {
            comissao: comissaoAtual + valorComissao,
            saldo: saldoAtual + valorComissao,
        });

        const extratoRef = ref(db, 'extrato/' + uidIndicador);
        const novoExtratoRef = push(extratoRef);
        await set(novoExtratoRef, {
            data: new Date().toISOString(),
            descricao: `Comissão de indicação (15%) — plano de ${dadosIndicado?.nome || 'um indicado'}`,
            valor: valorComissao,
        });
    } catch (error) {
        console.error('Erro ao creditar comissão de indicação:', error);
    }
}

/**
 * Aprova um depósito: marca o status como "aprovado", cria o plano
 * correspondente em planos/{uid}/{id} (que é o que faz o plano aparecer
 * na aba "Carteira" do usuário) e credita a comissão de indicação para
 * quem o indicou, se houver.
 */
async function aprovarDeposito(uid, depositoId, valorPlano) {
    try {
        const { percentualDiario, tetoPercentual } = obterConfigPlano(valorPlano);

        const planosRef = ref(db, 'planos/' + uid);
        const novoPlanoRef = push(planosRef);

        await set(novoPlanoRef, {
            valor: parseFloat(valorPlano) || 0,
            percentualDiario,
            tetoPercentual,
            dataAtivacao: new Date().toISOString(),
            origemDepositoId: depositoId,
            status: 'ativo',
        });

        const depositoRef = ref(db, 'depositos/' + uid + '/' + depositoId);
        await update(depositoRef, { status: 'aprovado' });

        await creditarComissaoIndicacao(uid, valorPlano);

        mostrarToast('✅ Depósito aprovado! O plano já está ativo na Carteira do usuário.', 'success');
    } catch (error) {
        console.error('Erro ao aprovar depósito:', error);
        mostrarToast('❌ Erro ao aprovar depósito: ' + error.message, 'error');
    }
}

async function recusarDeposito(uid, depositoId) {
    try {
        const depositoRef = ref(db, 'depositos/' + uid + '/' + depositoId);
        await update(depositoRef, { status: 'recusado' });
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
        renderizarTabelaUsuarios(estado.usuarios || {}, estado.filtroUsuarios);
    });

    input.dataset.listenerAtivo = 'true';
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
        renderizarTabelaUsuarios(estado.usuarios, estado.filtroUsuarios);
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
