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
    pago: 'Pago',
};

const STATUS_CORES = {
    pendente: 'var(--warning)',
    aprovado: 'var(--success)',
    concluido: 'var(--success)',
    recusado: 'var(--danger)',
    pago: 'var(--success)',
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
        tbody.innerHTML = '<tr><td colspan="6" class="table-empty">Nenhum saque solicitado ainda.</td></tr>';
    } else {
        tbody.innerHTML = saques.map(saque => {
            const status = (saque.status || 'pendente').toLowerCase();
            const acoes = status === 'pendente'
                ? `
                    <div class="admin-actions">
                        <button
                            class="btn-approve btn-marcar-saque-pago"
                            data-uid="${saque.uid}"
                            data-id="${saque.id}"
                        >Marcar como pago</button>
                    </div>
                `
                : `
                    <div class="admin-actions">
                        <button
                            class="btn-reject btn-arquivar"
                            data-colecao="saques"
                            data-uid="${saque.uid}"
                            data-id="${saque.id}"
                        >Excluir</button>
                    </div>
                `;

            return `
                <tr>
                    <td>${formatarDataHora(saque.dataSolicitacao)}</td>
                    <td>${escapeHTML(nomeDoUsuario(usuarios, saque.uid))}</td>
                    <td>${escapeHTML(saque.chavePix) || '—'}</td>
                    <td>${formatadorMoeda.format(saque.valorSolicitado || 0)}</td>
                    <td>${badgeStatus(saque.status)}</td>
                    <td>${acoes}</td>
                </tr>
            `;
        }).join('');
    }

    const pendentes = saques.filter(s => (s.status || 'pendente').toLowerCase() === 'pendente').length;
    const elTotal = document.getElementById('totalSaquesPendentes');
    if (elTotal) elTotal.textContent = pendentes;
}

/**
 * Depósitos travados em 'aprovado_sem_plano' — Pix confirmado de
 * verdade, mas o Worker recusou criar o plano porque o usuário já
 * tinha um ativo do mesmo valor. Precisa de decisão manual do admin.
 */
function renderizarTabelaPendenciasPlano(depositos, usuarios) {
    const tbody = document.getElementById('tabelaPendenciasPlano');
    if (!tbody) return;

    const pendencias = depositos.filter(d => d.status === 'aprovado_sem_plano');

    if (!pendencias.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="table-empty">Nenhuma pendência de plano no momento.</td></tr>';
    } else {
        tbody.innerHTML = pendencias.map(deposito => `
            <tr>
                <td>${formatarDataHora(deposito.dataAprovacao || deposito.dataSolicitacao)}</td>
                <td>${escapeHTML(nomeDoUsuario(usuarios, deposito.uid))}</td>
                <td>${formatadorMoeda.format(deposito.valorPlano || 0)}</td>
                <td style="max-width: 320px; white-space: normal;">${escapeHTML(deposito.obsAdmin) || '—'}</td>
                <td>
                    <div class="admin-actions">
                        <button
                            class="btn-approve btn-criar-plano-mesmo-assim"
                            data-uid="${deposito.uid}"
                            data-id="${deposito.id}"
                        >Criar plano mesmo assim</button>
                        <button
                            class="btn-reject btn-marcar-resolvido"
                            data-uid="${deposito.uid}"
                            data-id="${deposito.id}"
                        >Marcar resolvido (sem plano)</button>
                    </div>
                </td>
            </tr>
        `).join('');
    }

    const elTotal = document.getElementById('totalPendenciasPlano');
    if (elTotal) elTotal.textContent = pendencias.length;
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
                : `
                    <div class="admin-actions">
                        <button
                            class="btn-reject btn-arquivar"
                            data-colecao="depositos"
                            data-uid="${deposito.uid}"
                            data-id="${deposito.id}"
                        >Excluir</button>
                    </div>
                `;

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

/**
 * Resolve uma pendência de plano (depósito com status
 * 'aprovado_sem_plano'), chamando o Worker com a ação escolhida pelo
 * admin: criar o plano mesmo com o limite, ou só marcar como resolvido
 * sem criar plano nenhum.
 */
async function resolverPendenciaPlano(uid, depositoId, acao) {
    try {
        const idToken = await auth.currentUser.getIdToken();

        const resposta = await fetch(`${WORKER_BASE_URL}/api/admin/resolver-pendencia-plano`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`,
            },
            body: JSON.stringify({ uid, depositoId, acao }),
        });

        const dadosResposta = await resposta.json();
        if (!resposta.ok) {
            throw new Error(dadosResposta.error || 'Erro ao resolver pendência.');
        }

        mostrarToast(
            acao === 'criar_plano' ? '✅ Plano criado manualmente.' : '✅ Pendência marcada como resolvida.',
            'success'
        );
    } catch (error) {
        console.error('Erro ao resolver pendência de plano:', error);
        mostrarToast('❌ Erro ao resolver pendência: ' + error.message, 'error');
    }
}

/**
 * Arquiva um depósito ou saque (some da tabela, mas continua salvo no
 * Firebase). "colecao" é 'depositos' ou 'saques' — a mesma função
 * serve pras três tabelas que usam esse botão, porque Pendências de
 * Plano é só um filtro em cima da própria coleção de depósitos.
 */
async function arquivarRegistro(colecao, uid, id) {
    try {
        const idToken = await auth.currentUser.getIdToken();

        const resposta = await fetch(`${WORKER_BASE_URL}/api/admin/arquivar`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`,
            },
            body: JSON.stringify({ colecao, uid, id }),
        });

        const dadosResposta = await resposta.json();
        if (!resposta.ok) {
            throw new Error(dadosResposta.error || 'Erro ao excluir registro.');
        }

        mostrarToast('Registro excluído da lista.', 'warning');
    } catch (error) {
        console.error('Erro ao arquivar registro:', error);
        mostrarToast('❌ Erro ao excluir: ' + error.message, 'error');
    }
}

/**
 * Marca um saque como pago chamando o Worker, que atualiza tanto o
 * registro em saques/{uid} quanto a entrada correspondente no Extrato
 * do usuário — as duas usam o mesmo id, então ficam sempre em sincronia.
 */
async function marcarSaquePago(uid, saqueId) {
    try {
        const idToken = await auth.currentUser.getIdToken();

        const resposta = await fetch(`${WORKER_BASE_URL}/api/admin/marcar-saque-pago`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`,
            },
            body: JSON.stringify({ uid, saqueId }),
        });

        const dadosResposta = await resposta.json();
        if (!resposta.ok) {
            throw new Error(dadosResposta.error || 'Erro ao marcar saque como pago.');
        }

        mostrarToast('✅ Saque marcado como pago.', 'success');
    } catch (error) {
        console.error('Erro ao marcar saque como pago:', error);
        mostrarToast('❌ Erro ao marcar saque como pago: ' + error.message, 'error');
    }
}

// Delegação de eventos pra tabela de Saques — mesmo padrão das outras
// tabelas (botões recriados a cada render).
function iniciarDelegacaoAcoesSaques() {
    const tbody = document.getElementById('tabelaSaquesAdmin');
    if (!tbody || tbody.dataset.listenerAtivo) return;

    tbody.addEventListener('click', (e) => {
        const btnMarcarPago = e.target.closest('.btn-marcar-saque-pago');
        const btnArquivar = e.target.closest('.btn-arquivar');

        if (btnMarcarPago) {
            const { uid, id } = btnMarcarPago.dataset;
            btnMarcarPago.disabled = true;
            btnMarcarPago.textContent = 'Marcando...';
            marcarSaquePago(uid, id);
        }

        if (btnArquivar) {
            const { colecao, uid, id } = btnArquivar.dataset;
            btnArquivar.disabled = true;
            btnArquivar.textContent = 'Excluindo...';
            arquivarRegistro(colecao, uid, id);
        }
    });

    tbody.dataset.listenerAtivo = 'true';
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

        const btnArquivar = e.target.closest('.btn-arquivar');
        if (btnArquivar) {
            const { colecao, uid, id } = btnArquivar.dataset;
            btnArquivar.disabled = true;
            btnArquivar.textContent = 'Excluindo...';
            arquivarRegistro(colecao, uid, id);
        }
    });

    tbody.dataset.listenerAtivo = 'true';
}

// Mesma ideia da delegação acima, mas pros botões da tabela de
// Pendências de Plano (tbody diferente, recriado a cada render).
function iniciarDelegacaoPendenciasPlano() {
    const tbody = document.getElementById('tabelaPendenciasPlano');
    if (!tbody || tbody.dataset.listenerAtivo) return;

    tbody.addEventListener('click', (e) => {
        const btnCriarPlano = e.target.closest('.btn-criar-plano-mesmo-assim');
        const btnMarcarResolvido = e.target.closest('.btn-marcar-resolvido');

        if (btnCriarPlano) {
            const { uid, id } = btnCriarPlano.dataset;
            btnCriarPlano.disabled = true;
            btnCriarPlano.textContent = 'Criando...';
            resolverPendenciaPlano(uid, id, 'criar_plano');
        }

        if (btnMarcarResolvido) {
            const { uid, id } = btnMarcarResolvido.dataset;
            btnMarcarResolvido.disabled = true;
            btnMarcarResolvido.textContent = 'Marcando...';
            resolverPendenciaPlano(uid, id, 'marcar_resolvido');
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
    auditoria: null,
    filtroUsuarios: '',
};

/**
 * Crédito manual de rendimento: lista de usuários (filtrável por nome ou
 * e-mail) no <select>, histórico dos últimos créditos e envio ao Worker.
 * As opções são montadas com textContent (nunca innerHTML), então um nome
 * malicioso não executa nada.
 */
const LIMITE_OPCOES_USUARIOS_MANUAL = 100;
let chaveOperacaoManual = null; // reaproveitada se o envio falhar, para um reenvio não creditar duas vezes

function gerarChaveOperacao() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return 'op' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}

function atualizarOpcoesRendimentoManual() {
    const select = document.getElementById('rmUsuario');
    if (!select) return;

    const termo = (document.getElementById('rmBusca')?.value || '').trim().toLowerCase();
    const selecionadoAntes = select.value;

    let usuarios = Object.entries(estado.usuarios || {}).map(([uid, dados]) => ({ uid, nome: dados?.nome || '', email: dados?.email || '' }));
    if (termo) {
        usuarios = usuarios.filter(u => u.nome.toLowerCase().includes(termo) || u.email.toLowerCase().includes(termo));
    }
    usuarios.sort((a, b) => (a.nome || a.email).localeCompare(b.nome || b.email, 'pt-BR'));

    select.textContent = '';
    const opcaoVazia = document.createElement('option');
    opcaoVazia.value = '';
    opcaoVazia.textContent = usuarios.length
        ? 'Selecione o usuário...'
        : (termo ? 'Nenhum usuário encontrado' : 'Nenhum usuário cadastrado');
    select.appendChild(opcaoVazia);

    usuarios.slice(0, LIMITE_OPCOES_USUARIOS_MANUAL).forEach((u) => {
        const opcao = document.createElement('option');
        opcao.value = u.uid;
        opcao.textContent = `${u.nome || 'Sem nome'} — ${u.email || u.uid}`;
        select.appendChild(opcao);
    });

    if (usuarios.length > LIMITE_OPCOES_USUARIOS_MANUAL) {
        const aviso = document.createElement('option');
        aviso.value = '';
        aviso.disabled = true;
        aviso.textContent = `… mais ${usuarios.length - LIMITE_OPCOES_USUARIOS_MANUAL} usuários — refine a busca`;
        select.appendChild(aviso);
    }

    // Mantém a seleção quando a lista é redesenhada por uma atualização em tempo real.
    if (selecionadoAntes && usuarios.some(u => u.uid === selecionadoAntes)) {
        select.value = selecionadoAntes;
    }
}

function renderizarTabelaCreditosManuais(auditoriaObj, usuarios) {
    const tbody = document.getElementById('tabelaCreditosManuais');
    if (!tbody) return;

    const creditos = Object.entries(auditoriaObj || {})
        .map(([id, dados]) => ({ id, ...dados }))
        .filter(c => c.tipo === 'rendimento_manual' && c.status === 'concluido')
        .sort((a, b) => new Date(b.data || 0).getTime() - new Date(a.data || 0).getTime())
        .slice(0, 20);

    if (!creditos.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="table-empty">Nenhum crédito manual registrado ainda.</td></tr>';
        return;
    }

    tbody.innerHTML = creditos.map(c => `
        <tr>
            <td>${formatarDataHora(c.data)}</td>
            <td>${escapeHTML(nomeDoUsuario(usuarios, c.uid))}</td>
            <td>${formatadorMoeda.format(parseFloat(c.valor || 0))}</td>
            <td>${escapeHTML(c.motivo) || '—'}</td>
            <td>${escapeHTML(nomeDoUsuario(usuarios, c.adminUid))}</td>
        </tr>
    `).join('');
}

function iniciarFormularioRendimentoManual() {
    const btn = document.getElementById('btnCreditarManual');
    if (!btn || btn.dataset.listenerAtivo) return;

    const campoBusca = document.getElementById('rmBusca');
    const campoUsuario = document.getElementById('rmUsuario');
    const campoValor = document.getElementById('rmValor');
    const campoMotivo = document.getElementById('rmMotivo');

    campoBusca?.addEventListener('input', atualizarOpcoesRendimentoManual);

    // Qualquer mudança no formulário é uma operação nova: gera outra chave.
    [campoUsuario, campoValor, campoMotivo].forEach((campo) => {
        campo?.addEventListener('input', () => { chaveOperacaoManual = null; });
        campo?.addEventListener('change', () => { chaveOperacaoManual = null; });
    });

    btn.addEventListener('click', async () => {
        const uid = campoUsuario?.value || '';
        const valor = Math.round((parseFloat(campoValor?.value) || 0) * 100) / 100;
        const motivo = (campoMotivo?.value || '').trim();

        if (!uid) {
            mostrarToast('⚠️ Selecione o usuário.', 'warning');
            return;
        }
        if (!(valor > 0)) {
            mostrarToast('⚠️ Informe um valor maior que zero.', 'warning');
            return;
        }
        if (motivo.length < 3) {
            mostrarToast('⚠️ Informe o motivo do crédito.', 'warning');
            return;
        }

        const nomeAlvo = nomeDoUsuario(estado.usuarios || {}, uid);
        const confirmado = window.confirm(`Creditar ${formatadorMoeda.format(valor)} de rendimento para "${nomeAlvo}"?\n\nO valor entra no saldo sacável na hora.`);
        if (!confirmado) return;

        if (!chaveOperacaoManual) chaveOperacaoManual = gerarChaveOperacao();

        btn.disabled = true;
        const textoOriginal = btn.textContent;
        btn.textContent = 'Creditando...';

        try {
            const idToken = await auth.currentUser.getIdToken();

            const resposta = await fetch(`${WORKER_BASE_URL}/api/admin/creditar-rendimento-manual`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`,
                },
                body: JSON.stringify({ uid, valor, motivo, chave: chaveOperacaoManual }),
            });

            const dadosResposta = await resposta.json();
            if (!resposta.ok) {
                throw new Error(dadosResposta.error || 'Erro ao creditar rendimento.');
            }

            if (dadosResposta.jaProcessado) {
                mostrarToast('ℹ️ Este crédito já havia sido processado — nada foi somado de novo.', 'warning');
            } else {
                mostrarToast(`✅ ${formatadorMoeda.format(valor)} creditado para ${nomeAlvo}.`, 'success');
            }

            // Operação concluída: limpa o formulário e libera uma chave nova.
            chaveOperacaoManual = null;
            if (campoValor) campoValor.value = '';
            if (campoMotivo) campoMotivo.value = '';
        } catch (error) {
            // A chave é mantida: se o crédito chegou a ser gravado, um novo
            // clique com os mesmos dados não soma duas vezes.
            console.error('Erro ao creditar rendimento manual:', error);
            mostrarToast('❌ ' + error.message, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = textoOriginal;
        }
    });

    btn.dataset.listenerAtivo = 'true';
}

function rerenderizarTudo() {
    atualizarOpcoesRendimentoManual();
    if (estado.auditoria !== null) {
        renderizarTabelaCreditosManuais(estado.auditoria, estado.usuarios || {});
    }
    if (estado.saques !== null) {
        const saquesLista = achatarPorUsuario(estado.saques).filter(s => !s.arquivado);
        renderizarTabelaSaques(saquesLista, estado.usuarios || {});
    }
    if (estado.depositos !== null) {
        const depositosLista = achatarPorUsuario(estado.depositos).filter(d => !d.arquivado);
        renderizarTabelaDepositos(depositosLista, estado.usuarios || {});
        renderizarTabelaPendenciasPlano(depositosLista, estado.usuarios || {});
    }
    if (estado.usuarios !== null) {
        renderizarTabelaUsuarios(estado.usuarios, estado.financeiro || {}, estado.filtroUsuarios);
    }
}

/**
 * Chama o Worker pra rodar o cálculo de rendimentos na hora (mesma
 * lógica do Cron Trigger diário) e mostra o resumo — quantos foram
 * creditados e, principalmente, quem ficou de fora e por quê.
 */
function iniciarBotaoRodarRendimentos() {
    const btn = document.getElementById('btnRodarRendimentos');
    const resumoEl = document.getElementById('resumoRendimentos');
    if (!btn || btn.dataset.listenerAtivo) return;

    btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Rodando...';
        if (resumoEl) {
            resumoEl.style.display = 'none';
            resumoEl.textContent = '';
        }

        try {
            const idToken = await auth.currentUser.getIdToken();

            const resposta = await fetch(`${WORKER_BASE_URL}/api/admin/rodar-rendimentos-agora`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`,
                },
            });

            const dadosResposta = await resposta.json();
            if (!resposta.ok) {
                throw new Error(dadosResposta.error || 'Erro ao rodar cálculo de rendimentos.');
            }

            const { resumo } = dadosResposta;
            mostrarToast(`✅ ${resumo.usuariosCreditados} usuário(s) creditado(s) agora.`, 'success');

            if (resumoEl) {
                const linhas = [`Usuários creditados: ${resumo.usuariosCreditados}`];

                if (resumo.usuariosSemConta?.length) {
                    linhas.push(`\n⚠️ Usuários com plano mas sem conta encontrada (dado órfão): ${resumo.usuariosSemConta.join(', ')}`);
                }
                if (resumo.planosComDataInvalida?.length) {
                    linhas.push(`\n⚠️ Planos com data de ativação inválida (não creditados até corrigir manualmente):`);
                    resumo.planosComDataInvalida.forEach(p => {
                        linhas.push(`  - uid: ${p.uid} | planoId: ${p.planoId} | dataAtivacao: ${JSON.stringify(p.dataAtivacao)}`);
                    });
                }
                if (resumo.usuariosComErro?.length) {
                    linhas.push(`\n❌ Usuários com erro ao creditar:`);
                    resumo.usuariosComErro.forEach(u => {
                        linhas.push(`  - uid: ${u.uid} | erro: ${u.erro}`);
                    });
                }

                resumoEl.textContent = linhas.join('\n');
                resumoEl.style.display = 'block';
            }
        } catch (error) {
            console.error('Erro ao rodar cálculo de rendimentos:', error);
            mostrarToast('❌ ' + error.message, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Rodar cálculo de rendimentos agora';
        }
    });

    btn.dataset.listenerAtivo = 'true';
}

function iniciarListenersAdmin() {
    iniciarDelegacaoAcoesDepositos();
    iniciarDelegacaoAcoesSaques();
    iniciarDelegacaoPendenciasPlano();
    iniciarBuscaUsuarios();
    iniciarBotaoRodarRendimentos();
    iniciarFormularioRendimentoManual();

    const auditoriaRef = ref(db, 'auditoriaCreditos');
    onValue(auditoriaRef, (snapshot) => {
        estado.auditoria = snapshot.val() || {};
        rerenderizarTudo();
    }, (error) => {
        // Sem as Regras novas (auditoriaCreditos) a leitura é negada — o
        // resto do painel continua funcionando normalmente.
        console.error('Erro ao carregar o histórico de créditos manuais (publique as Rules novas):', error);
    });

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
