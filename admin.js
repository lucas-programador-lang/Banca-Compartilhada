import { auth, db, mostrarToast } from './auth.js';
import { ref, onValue, update } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

const WORKER_BASE_URL = 'https://apidabancacompartilhada.lucas-dev-programador.workers.dev';

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

function tempoRelativo(isoString) {
    if (!isoString) return '';
    const data = new Date(isoString);
    if (isNaN(data.getTime())) return '';
    const minutos = Math.floor((Date.now() - data.getTime()) / 60000);
    if (minutos < 1) return 'agora';
    if (minutos < 60) return `há ${minutos} min`;
    const horas = Math.floor(minutos / 60);
    if (horas < 24) return `há ${horas} h`;
    const dias = Math.floor(horas / 24);
    return `há ${dias} ${dias === 1 ? 'dia' : 'dias'}`;
}

function escapeHTML(texto) {
    return String(texto ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    }[c]));
}

const ICONE_ROBO_AUTO = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
const ICONE_ROBO_MANUAL = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="M13 13l6 6"/></svg>';

const STATUS_LABELS = {
    pendente: 'Pendente',
    aprovado: 'Aprovado',
    recusado: 'Recusado',
    concluido: 'Concluído',
    pago: 'Pago',
    enviando: 'Enviando...',
    processando: 'Processando (automático)',
    verificar: 'Verificar na Vizzion',
    ativo: 'Ativo',
    finalizado: 'Finalizado',
    cancelado_pelo_admin: 'Cancelado (Admin)',
};

const STATUS_CORES = {
    pendente: 'var(--warning)',
    aprovado: 'var(--success)',
    concluido: 'var(--success)',
    recusado: 'var(--danger)',
    pago: 'var(--success)',
    enviando: 'var(--warning)',
    processando: 'var(--warning)',
    verificar: 'var(--danger)',
    ativo: 'var(--success)',
    finalizado: 'var(--text-muted)',
    cancelado_pelo_admin: 'var(--danger)',
};

function badgeStatus(status) {
    const chave = (status || 'pendente').toLowerCase();
    const label = STATUS_LABELS[chave] || status || 'Pendente';
    const cor = STATUS_CORES[chave] || 'var(--text-muted)';
    return `<span style="color: ${cor}; font-weight: 600;">${escapeHTML(label)}</span>`;
}

function achatarPorUsuario(dadosPorUsuario) {
    if (!dadosPorUsuario) return [];
    const lista = [];
    Object.entries(dadosPorUsuario).forEach(([uid, registros]) => {
        Object.entries(registros || {}).forEach(([id, valor]) => {
            if (valor && typeof valor === 'object') {
                lista.push({ uid, id, ...valor });
            }
        });
    });
    return lista.sort((a, b) => {
        const dataA = new Date(a.dataSolicitacao || a.dataAtivacao || 0).getTime();
        const dataB = new Date(b.dataSolicitacao || b.dataAtivacao || 0).getTime();
        return dataB - dataA;
    });
}

function nomeDoUsuario(usuarios, uid) {
    const dados = usuarios?.[uid];
    if (!dados) return uid || '—';
    return dados.nome || dados.email || uid;
}

/* ==========================================================================
   Estado Global Reativo + Paginação + Seleções em Massa
   ========================================================================== */
const estado = {
    abaAtiva: 'dashboard',
    usuarios: null,
    financeiro: null,
    saques: null,
    depositos: null,
    planos: null,
    execucoesRendimentos: null,
    auditoria: null,

    filtros: {
        usuarios: { busca: '', tipo: 'todos', ordem: 'saldo_desc' },
        saques: { busca: '', status: 'todos', ordem: 'data_desc' },
        depositos: { busca: '', status: 'todos', ordem: 'data_desc' },
        planos: { busca: '', status: 'todos' },
        auditoria: { busca: '', tipo: 'todos' },
        arquivo: { busca: '', colecao: 'todos' },
    },

    paginacao: {
        usuarios: { pagina: 1, porPagina: 10 },
        saques: { pagina: 1, porPagina: 10 },
        depositos: { pagina: 1, porPagina: 10 },
        planos: { pagina: 1, porPagina: 10 },
        auditoria: { pagina: 1, porPagina: 10 },
        arquivo: { pagina: 1, porPagina: 10 },
    },

    selecionados: {
        saques: new Set(),
        depositos: new Set(),
        auditoria: new Set(),
    },
};

/* ==========================================================================
   Modal de Confirmação e Modal de Detalhes
   ========================================================================== */
function confirmarAcao({
    titulo,
    detalhes = [],
    textoConfirmar = 'Confirmar',
    textoCancelar = 'Cancelar',
    perigo = false,
}) {
    return new Promise((resolve) => {
        const focoAnterior = document.activeElement;

        const iconeNormal = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="8 12.5 11 15.5 16 9"/></svg>';
        const iconePerigo = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';

        const linhas = detalhes
            .filter(d => d && d.valor !== undefined && d.valor !== '')
            .map(d => `
                <div class="confirm-modal__row">
                    <span class="confirm-modal__label">${escapeHTML(d.rotulo)}</span>
                    <span class="confirm-modal__value${d.destaque ? ' confirm-modal__value--big' : ''}">${escapeHTML(d.valor)}</span>
                </div>
            `).join('');

        const overlay = document.createElement('div');
        overlay.className = 'confirm-overlay';
        overlay.innerHTML = `
            <div class="confirm-modal${perigo ? ' confirm-modal--danger' : ''}" role="dialog" aria-modal="true" aria-label="${escapeHTML(titulo)}">
                <div class="confirm-modal__head">
                    <span class="confirm-modal__icon">${perigo ? iconePerigo : iconeNormal}</span>
                    <h3 class="confirm-modal__title">${escapeHTML(titulo)}</h3>
                </div>
                <div class="confirm-modal__body">${linhas}</div>
                <div class="confirm-modal__actions">
                    <button type="button" class="confirm-modal__btn confirm-modal__btn--cancel">${escapeHTML(textoCancelar)}</button>
                    <button type="button" class="confirm-modal__btn confirm-modal__btn--ok">${escapeHTML(textoConfirmar)}</button>
                </div>
            </div>
        `;

        const btnCancelar = overlay.querySelector('.confirm-modal__btn--cancel');
        const btnConfirmar = overlay.querySelector('.confirm-modal__btn--ok');

        function fechar(resultado) {
            document.removeEventListener('keydown', aoTeclar, true);
            overlay.classList.add('confirm-overlay--saindo');
            setTimeout(() => {
                overlay.remove();
                if (focoAnterior && typeof focoAnterior.focus === 'function') focoAnterior.focus();
            }, 140);
            resolve(resultado);
        }

        function aoTeclar(e) {
            if (e.key === 'Escape') {
                e.preventDefault();
                fechar(false);
            } else if (e.key === 'Tab') {
                e.preventDefault();
                (document.activeElement === btnCancelar ? btnConfirmar : btnCancelar).focus();
            }
        }

        btnCancelar.addEventListener('click', () => fechar(false));
        btnConfirmar.addEventListener('click', () => fechar(true));
        overlay.addEventListener('mousedown', (e) => {
            if (e.target === overlay) fechar(false);
        });
        document.addEventListener('keydown', aoTeclar, true);

        document.body.appendChild(overlay);
        (perigo ? btnCancelar : btnConfirmar).focus();
    });
}

function abrirModalDetalhesUsuario(uid) {
    const u = estado.usuarios?.[uid];
    if (!u) return;

    const fin = estado.financeiro?.[uid] || {};
    const saldoRend = parseFloat(fin.saldoRendimento || 0);
    const saldoCom = parseFloat(fin.saldoComissao || 0);
    const saldoTotal = saldoRend + saldoCom;
    const comissaoTotal = parseFloat(fin.comissao || 0);

    const planosUser = Object.entries(estado.planos?.[uid] || {}).map(([id, p]) => ({ id, ...p }));
    const planosAtivos = planosUser.filter(p => p.status !== 'finalizado' && p.status !== 'cancelado_pelo_admin');

    const padrinhoNome = u.indicadoPor ? nomeDoUsuario(estado.usuarios, u.indicadoPor) : 'Cadastro Direto (Sem indicação)';

    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
        <div class="confirm-modal" style="max-width: 520px; width: 92%;" role="dialog" aria-modal="true">
            <div class="confirm-modal__head">
                <h3 class="confirm-modal__title">👤 Perfil de ${escapeHTML(u.nome || 'Usuário')}</h3>
            </div>
            <div class="confirm-modal__body">
                <div class="confirm-modal__row">
                    <span class="confirm-modal__label">UID</span>
                    <span class="confirm-modal__value" style="font-size: 0.78rem;">${escapeHTML(uid)}</span>
                </div>
                <div class="confirm-modal__row">
                    <span class="confirm-modal__label">E-mail</span>
                    <span class="confirm-modal__value">${escapeHTML(u.email || '—')}</span>
                </div>
                <div class="confirm-modal__row">
                    <span class="confirm-modal__label">Chave PIX (${escapeHTML(u.tipoPix || 'cpf')})</span>
                    <span class="confirm-modal__value">${escapeHTML(u.chavePix || 'Não cadastrada')}</span>
                </div>
                <div class="confirm-modal__row">
                    <span class="confirm-modal__label">Código de Indicação</span>
                    <span class="confirm-modal__value">${escapeHTML(u.codigoIndicacao || '—')}</span>
                </div>
                <div class="confirm-modal__row">
                    <span class="confirm-modal__label">Indicado por</span>
                    <span class="confirm-modal__value">${escapeHTML(padrinhoNome)}</span>
                </div>
                <div class="confirm-modal__row">
                    <span class="confirm-modal__label">Data de Cadastro</span>
                    <span class="confirm-modal__value">${formatarDataHora(u.dataCadastro)}</span>
                </div>

                <div class="adm-user-modal-grid">
                    <div class="adm-user-stat">
                        <span>Saldo Disponível Total</span>
                        <strong style="color: var(--adm-success);">${formatadorMoeda.format(saldoTotal)}</strong>
                    </div>
                    <div class="adm-user-stat">
                        <span>Comissão Acumulada</span>
                        <strong>${formatadorMoeda.format(comissaoTotal)}</strong>
                    </div>
                    <div class="adm-user-stat">
                        <span>Planos Ativos</span>
                        <strong>${planosAtivos.length} de ${planosUser.length}</strong>
                    </div>
                    <div class="adm-user-stat">
                        <span>Último Acesso App</span>
                        <strong>${formatarDataHora(u.ultimoAcessoApp)}</strong>
                    </div>
                </div>
            </div>
            <div class="confirm-modal__actions" style="flex-wrap: wrap; gap: 8px;">
                <button type="button" class="adm-btn adm-btn--ghost" id="btnModalIrSaldo">⚖️ Ajustar Saldo</button>
                <button type="button" class="adm-btn adm-btn--ghost" id="btnModalIrPlano">📈 Gerenciar Plano</button>
                <button type="button" class="confirm-modal__btn confirm-modal__btn--ok" id="btnModalFechar">Fechar</button>
            </div>
        </div>
    `;

    overlay.querySelector('#btnModalFechar').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('#btnModalIrSaldo').addEventListener('click', () => {
        overlay.remove();
        mudarAba('ajustes');
        const select = document.getElementById('rmUsuario');
        if (select) select.value = uid;
        document.getElementById('rmValor')?.focus();
    });

    overlay.querySelector('#btnModalIrPlano').addEventListener('click', () => {
        overlay.remove();
        mudarAba('planos');
        const select = document.getElementById('gpUsuario');
        if (select) select.value = uid;
        document.getElementById('gpValor')?.focus();
    });

    document.body.appendChild(overlay);
}

/* ==========================================================================
   Componente Reutilizável de Paginação
   ========================================================================== */
function aplicarPaginacao(lista, chaveTabela, containerId, aoMudar) {
    const config = estado.paginacao[chaveTabela];
    const totalItens = lista.length;
    const totalPaginas = Math.max(1, Math.ceil(totalItens / config.porPagina));

    if (config.pagina > totalPaginas) config.pagina = totalPaginas;
    if (config.pagina < 1) config.pagina = 1;

    const inicio = (config.pagina - 1) * config.porPagina;
    const fim = inicio + config.porPagina;
    const itensPagina = lista.slice(inicio, fim);

    const container = document.getElementById(containerId);
    if (container) {
        container.innerHTML = `
            <div>
                Mostrando <strong>${totalItens ? inicio + 1 : 0}–${Math.min(fim, totalItens)}</strong> de <strong>${totalItens}</strong> registro(s)
            </div>
            <div class="adm-pagination__controls">
                <label style="font-size: 0.8rem;">Exibir:</label>
                <select class="adm-select adm-page-size" style="padding: 5px 8px;">
                    ${[10, 20, 50, 100].map(n => `<option value="${n}" ${config.porPagina === n ? 'selected' : ''}>${n}</option>`).join('')}
                </select>
                <button type="button" class="adm-btn adm-btn--ghost adm-page-prev" ${config.pagina <= 1 ? 'disabled' : ''}>&larr; Anterior</button>
                <span>Página <strong>${config.pagina}</strong> de <strong>${totalPaginas}</strong></span>
                <button type="button" class="adm-btn adm-btn--ghost adm-page-next" ${config.pagina >= totalPaginas ? 'disabled' : ''}>Próxima &rarr;</button>
            </div>
        `;

        container.querySelector('.adm-page-size')?.addEventListener('change', (e) => {
            config.porPagina = parseInt(e.target.value, 10) || 10;
            config.pagina = 1;
            aoMudar();
        });

        container.querySelector('.adm-page-prev')?.addEventListener('click', () => {
            if (config.pagina > 1) {
                config.pagina--;
                aoMudar();
            }
        });

        container.querySelector('.adm-page-next')?.addEventListener('click', () => {
            if (config.pagina < totalPaginas) {
                config.pagina++;
                aoMudar();
            }
        });
    }

    return itensPagina;
}

/* ==========================================================================
   Navegação entre Abas Independentes
   ========================================================================== */
const TITULOS_ABAS = {
    dashboard: 'Dashboard Geral',
    usuarios: 'Usuários e Saldos',
    saques: 'Gerenciamento de Saques',
    depositos: 'Gerenciamento de Depósitos',
    pendencias: 'Pendências de Plano',
    planos: 'Planos Adquiridos e Ciclos',
    ajustes: 'Ajustes de Saldo e Auditoria',
    arquivo: 'Arquivo e Lixeira',
};

function mudarAba(nomeAba) {
    if (!TITULOS_ABAS[nomeAba]) return;
    estado.abaAtiva = nomeAba;

    document.querySelectorAll('.adm-nav__btn').forEach(btn => {
        btn.classList.toggle('is-active', btn.dataset.tab === nomeAba);
    });

    document.querySelectorAll('.adm-tab-pane').forEach(pane => {
        pane.classList.toggle('is-active', pane.id === `tab-${nomeAba}`);
    });

    const elTitulo = document.getElementById('admPageTitle');
    if (elTitulo) elTitulo.textContent = TITULOS_ABAS[nomeAba];

    // Fecha menu mobile caso esteja aberto
    document.getElementById('admSidebar')?.classList.remove('is-open');
    document.getElementById('admSidebarBackdrop')?.classList.remove('is-open');

    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function iniciarNavegacaoAbas() {
    document.querySelectorAll('.adm-nav__btn').forEach(btn => {
        btn.addEventListener('click', () => mudarAba(btn.dataset.tab));
    });

    document.querySelectorAll('[data-goto-tab]').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            mudarAba(link.dataset.gotoTab);
        });
    });

    const btnToggle = document.getElementById('admMenuToggle');
    const sidebar = document.getElementById('admSidebar');
    const backdrop = document.getElementById('admSidebarBackdrop');

    btnToggle?.addEventListener('click', () => {
        sidebar?.classList.toggle('is-open');
        backdrop?.classList.toggle('is-open');
    });

    backdrop?.addEventListener('click', () => {
        sidebar?.classList.remove('is-open');
        backdrop?.classList.remove('is-open');
    });
}

/* ==========================================================================
   Chamadas à API do Cloudflare Worker e Firebase
   ========================================================================== */
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
        if (!resposta.ok) throw new Error(dadosResposta.error || 'Erro ao aprovar depósito.');

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
        if (!resposta.ok) throw new Error(dadosResposta.error || 'Erro ao recusar depósito.');

        mostrarToast('Depósito recusado.', 'warning');
    } catch (error) {
        console.error('Erro ao recusar depósito:', error);
        mostrarToast('❌ Erro ao recusar depósito: ' + error.message, 'error');
    }
}

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
        if (!resposta.ok) throw new Error(dadosResposta.error || 'Erro ao resolver pendência.');

        mostrarToast(
            acao === 'criar_plano' ? '✅ Plano criado manualmente.' : '✅ Pendência marcada como resolvida.',
            'success'
        );
    } catch (error) {
        console.error('Erro ao resolver pendência de plano:', error);
        mostrarToast('❌ Erro ao resolver pendência: ' + error.message, 'error');
    }
}

async function arquivarRegistro(colecao, uid, id, silencioso = false) {
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
    if (!resposta.ok) throw new Error(dadosResposta.error || 'Erro ao arquivar registro.');

    if (!silencioso) {
        mostrarToast('Registro movido para o Arquivo.', 'warning');
    }
}

async function restaurarRegistroArquivado(colecao, uid, id) {
    try {
        const caminho = colecao === 'auditoriaCreditos'
            ? `auditoriaCreditos/${id}`
            : `${colecao}/${uid}/${id}`;

        await update(ref(db, caminho), { arquivado: null });
        mostrarToast('✅ Registro restaurado para a lista principal!', 'success');
    } catch (error) {
        console.error('Erro ao restaurar registro:', error);
        mostrarToast('❌ Não foi possível restaurar: ' + error.message, 'error');
    }
}

async function executarArquivamentoEmMassa(colecao, listaChaves, setSelecionados) {
    if (!listaChaves.length) return;

    const confirmado = await confirmarAcao({
        titulo: 'Arquivar registros selecionados',
        detalhes: [
            { rotulo: 'Categoria', valor: colecao.toUpperCase() },
            { rotulo: 'Quantidade afetada', valor: `${listaChaves.length} registro(s)`, destaque: true },
            { rotulo: 'Reversível?', valor: 'Sim, através da aba Arquivo / Lixeira' },
        ],
        textoConfirmar: `Arquivar ${listaChaves.length} item(ns)`,
        perigo: true,
    });
    if (!confirmado) return;

    let concluidos = 0;
    let falhas = 0;

    for (const chave of listaChaves) {
        const [uid, id] = chave.includes('::') ? chave.split('::') : ['null', chave];
        try {
            await arquivarRegistro(colecao, uid, id, true);
            setSelecionados.delete(chave);
            concluidos++;
        } catch (err) {
            console.error('Falha ao arquivar item em massa:', chave, err);
            falhas++;
        }
    }

    if (falhas === 0) {
        mostrarToast(`✅ ${concluidos} registro(s) arquivado(s) com sucesso.`, 'success');
    } else {
        mostrarToast(`⚠️ ${concluidos} arquivado(s), ${falhas} falharam.`, 'warning');
    }
    rerenderizarTudo();
}

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
        if (!resposta.ok) throw new Error(dadosResposta.error || 'Erro ao marcar saque como pago.');

        mostrarToast('✅ Saque marcado como pago.', 'success');
    } catch (error) {
        console.error('Erro ao marcar saque como pago:', error);
        mostrarToast('❌ Erro ao marcar saque como pago: ' + error.message, 'error');
    }
}

/* ==========================================================================
   Renderização: USUÁRIOS
   ========================================================================== */
function renderizarTabelaUsuarios() {
    const tbody = document.getElementById('tabelaUsuariosAdmin');
    if (!tbody) return;

    const usuariosObj = estado.usuarios || {};
    const financeiroObj = estado.financeiro || {};
    const depositosObj = estado.depositos || {};
    const saquesObj = estado.saques || {};
    const planosObj = estado.planos || {};
    const { busca, tipo, ordem } = estado.filtros.usuarios;

    const termo = (busca || '').trim().toLowerCase();

    let lista = Object.entries(usuariosObj).map(([uid, dados]) => {
        const financeiro = financeiroObj[uid] || {};
        const saldo = parseFloat(financeiro.saldoRendimento || 0) + parseFloat(financeiro.saldoComissao || 0);
        const comissao = parseFloat(financeiro.comissao || 0);

        let totalDepositado = 0;
        if (depositosObj[uid]) {
            Object.values(depositosObj[uid]).forEach(dep => {
                const st = (dep?.status || '').toLowerCase();
                if (['aprovado', 'aprovado_sem_plano', 'resolvido_sem_plano'].includes(st)) {
                    totalDepositado += parseFloat(dep.valorPlano || 0);
                }
            });
        }

        let totalSacado = 0;
        if (saquesObj[uid]) {
            Object.values(saquesObj[uid]).forEach(saq => {
                if ((saq?.status || '').toLowerCase() === 'pago') {
                    totalSacado += parseFloat(saq.valorSolicitado || 0);
                }
            });
        }

        const planosUsuario = Object.values(planosObj[uid] || {});
        const planosAtivos = planosUsuario.filter(p => p && p.status !== 'finalizado' && p.status !== 'cancelado_pelo_admin');

        return { uid, ...dados, saldo, comissao, totalDepositado, totalSacado, qtdPlanosAtivos: planosAtivos.length };
    });

    // KPIs globais
    const somaSaldos = lista.reduce((acc, u) => acc + u.saldo, 0);
    const elTotalSaldo = document.getElementById('totalSaldoUsuarios');
    if (elTotalSaldo) elTotalSaldo.textContent = formatadorMoeda.format(somaSaldos);

    const elTotalUsuarios = document.getElementById('totalUsuariosCadastrados');
    if (elTotalUsuarios) elTotalUsuarios.textContent = lista.length;

    const navBadge = document.getElementById('navBadgeUsuarios');
    if (navBadge) navBadge.textContent = lista.length;

    // Filtros
    if (termo) {
        lista = lista.filter(u =>
            (u.nome || '').toLowerCase().includes(termo) ||
            (u.email || '').toLowerCase().includes(termo) ||
            (u.uid || '').toLowerCase().includes(termo) ||
            (u.chavePix || '').toLowerCase().includes(termo)
        );
    }

    if (tipo === 'com_plano') lista = lista.filter(u => u.qtdPlanosAtivos > 0);
    else if (tipo === 'sem_plano') lista = lista.filter(u => u.qtdPlanosAtivos === 0);
    else if (tipo === 'com_saldo') lista = lista.filter(u => u.saldo > 0);
    else if (tipo === 'admin') lista = lista.filter(u => u.isAdmin === true);

    // Ordenação
    lista.sort((a, b) => {
        if (ordem === 'depositado_desc') return b.totalDepositado - a.totalDepositado;
        if (ordem === 'sacado_desc') return b.totalSacado - a.totalSacado;
        if (ordem === 'recentes') return new Date(b.dataCadastro || 0).getTime() - new Date(a.dataCadastro || 0).getTime();
        if (ordem === 'nome_asc') return (a.nome || '').localeCompare(b.nome || '', 'pt-BR');
        return b.saldo - a.saldo;
    });

    const pagina = aplicarPaginacao(lista, 'usuarios', 'paginacaoUsuarios', renderizarTabelaUsuarios);

    if (!pagina.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="table-empty">Nenhum usuário encontrado para os filtros aplicados.</td></tr>';
        return;
    }

    tbody.innerHTML = pagina.map(u => {
        const infoPlanos = u.qtdPlanosAtivos > 0
            ? `<div style="font-size: 0.75rem; color: var(--success); margin-top: 2px;">${u.qtdPlanosAtivos} plano(s) ativo(s)</div>`
            : `<div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 2px;">Sem plano ativo</div>`;

        const subPix = u.chavePix
            ? `<div style="font-size: 0.75rem; color: var(--text-muted);">PIX: ${escapeHTML(u.chavePix)}</div>`
            : '';

        return `
            <tr>
                <td><strong>${escapeHTML(u.nome) || '—'}</strong>${infoPlanos}</td>
                <td title="${escapeHTML(u.email)}">${escapeHTML(u.email) || '—'}${subPix}</td>
                <td><strong>${formatadorMoeda.format(u.saldo)}</strong></td>
                <td>${formatadorMoeda.format(u.comissao)}</td>
                <td style="color: var(--success); font-weight: 500;">+ ${formatadorMoeda.format(u.totalDepositado)}</td>
                <td style="color: var(--danger); font-weight: 500;">- ${formatadorMoeda.format(u.totalSacado)}</td>
                <td>${u.isAdmin ? '<span class="status-badge status-admin">Admin</span>' : 'Cliente'}</td>
                <td>
                    <button type="button" class="adm-btn adm-btn--ghost btn-ver-usuario" data-uid="${u.uid}" style="padding: 6px 10px; font-size: 0.78rem;">
                        Detalhes
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

/* ==========================================================================
   Renderização: SAQUES
   ========================================================================== */
function renderizarTabelaSaques() {
    const tbody = document.getElementById('tabelaSaquesAdmin');
    if (!tbody) return;

    const usuarios = estado.usuarios || {};
    const todosSaques = achatarPorUsuario(estado.saques);
    const saquesAtivos = todosSaques.filter(s => !s.arquivado);

    // Soma de saques pagos geral
    let somaPagos = 0;
    todosSaques.forEach(s => {
        if ((s.status || '').toLowerCase() === 'pago') {
            somaPagos += parseFloat(s.valorSolicitado || 0);
        }
    });
    const elGeral = document.getElementById('totalSaquesPagosGeral');
    if (elGeral) elGeral.textContent = formatadorMoeda.format(somaPagos);

    const pendentesCount = saquesAtivos.filter(s => ['pendente', 'processando', 'verificar'].includes((s.status || 'pendente').toLowerCase())).length;
    const elTotal = document.getElementById('totalSaquesPendentes');
    if (elTotal) elTotal.textContent = pendentesCount;
    const navBadge = document.getElementById('navBadgeSaques');
    if (navBadge) navBadge.textContent = pendentesCount;

    // Filtros
    const { busca, status, ordem } = estado.filtros.saques;
    const termo = (busca || '').trim().toLowerCase();

    let filtrados = saquesAtivos.filter(s => {
        const st = (s.status || 'pendente').toLowerCase();
        if (status === 'pendentes_grupo' && !['pendente', 'processando', 'verificar'].includes(st)) return false;
        if (status !== 'todos' && status !== 'pendentes_grupo' && st !== status) return false;

        if (termo) {
            const nome = nomeDoUsuario(usuarios, s.uid).toLowerCase();
            const pix = (s.chavePix || '').toLowerCase();
            return nome.includes(termo) || pix.includes(termo) || s.uid.toLowerCase().includes(termo);
        }
        return true;
    });

    filtrados.sort((a, b) => {
        if (ordem === 'valor_desc') return (parseFloat(b.valorSolicitado) || 0) - (parseFloat(a.valorSolicitado) || 0);
        const tA = new Date(a.dataSolicitacao || 0).getTime();
        const tB = new Date(b.dataSolicitacao || 0).getTime();
        return ordem === 'data_asc' ? tA - tB : tB - tA;
    });

    const pagina = aplicarPaginacao(filtrados, 'saques', 'paginacaoSaques', renderizarTabelaSaques);

    atualizarBarraBulk('Saques', estado.selecionados.saques);

    if (!pagina.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="table-empty">Nenhum saque encontrado para os filtros atuais.</td></tr>';
        return;
    }

    tbody.innerHTML = pagina.map(saque => {
        const st = (saque.status || 'pendente').toLowerCase();
        const chaveItem = `${saque.uid}::${saque.id}`;
        const marcado = estado.selecionados.saques.has(chaveItem) ? 'checked' : '';

        const acoes = st === 'enviando'
            ? '<span style="color: var(--text-muted);">Enviando...</span>'
            : ['pendente', 'processando', 'verificar'].includes(st)
            ? `
                <div class="admin-actions">
                    <button class="btn-approve btn-marcar-saque-pago" data-uid="${saque.uid}" data-id="${saque.id}" data-valor="${saque.valorLiquido || saque.valorSolicitado || 0}">
                        Marcar como pago
                    </button>
                </div>
            `
            : `
                <div class="admin-actions">
                    <button class="btn-reject btn-arquivar" data-colecao="saques" data-uid="${saque.uid}" data-id="${saque.id}">
                        Arquivar
                    </button>
                </div>
            `;

        const horarioPago = saque.dataPagamento
            ? `<div style="font-size: 0.78rem; color: var(--success); margin-top: 2px;">Pago: ${formatarDataHora(saque.dataPagamento)}</div>`
            : '';

        return `
            <tr>
                <td><input type="checkbox" class="adm-check check-item-saque" data-key="${chaveItem}" ${marcado}></td>
                <td>${formatarDataHora(saque.dataSolicitacao)}${horarioPago}</td>
                <td>${escapeHTML(nomeDoUsuario(usuarios, saque.uid))}</td>
                <td>${escapeHTML(saque.chavePix) || '—'}</td>
                <td>
                    <strong style="color: var(--text-primary);">${formatadorMoeda.format(saque.valorSolicitado || 0)}</strong><br>
                    <small style="color: var(--danger); font-size: 0.85em;">Taxa (14%): -${formatadorMoeda.format(saque.taxa || 0)}</small><br>
                    <small style="color: var(--success); font-weight: 600;">Líquido: ${formatadorMoeda.format(saque.valorLiquido || 0)}</small>
                </td>
                <td>${badgeStatus(saque.status)}</td>
                <td>${acoes}</td>
            </tr>
        `;
    }).join('');
}

/* ==========================================================================
   Renderização: DEPÓSITOS E PENDÊNCIAS DE PLANO
   ========================================================================== */
function renderizarTabelaDepositosEPendencias() {
    const usuarios = estado.usuarios || {};
    const todosDepositos = achatarPorUsuario(estado.depositos);
    const depositosAtivos = todosDepositos.filter(d => !d.arquivado);

    // Soma total de depósitos aprovados
    let somaAprovados = 0;
    todosDepositos.forEach(d => {
        if (['aprovado', 'aprovado_sem_plano', 'resolvido_sem_plano'].includes((d.status || '').toLowerCase())) {
            somaAprovados += parseFloat(d.valorPlano || 0);
        }
    });
    const elAprovadosGeral = document.getElementById('totalDepositosAprovadosGeral');
    if (elAprovadosGeral) elAprovadosGeral.textContent = formatadorMoeda.format(somaAprovados);

    // 1. Pendências de Plano
    const tbodyPend = document.getElementById('tabelaPendenciasPlano');
    const pendencias = depositosAtivos.filter(d => d.status === 'aprovado_sem_plano');

    const elTotalPend = document.getElementById('totalPendenciasPlano');
    if (elTotalPend) elTotalPend.textContent = pendencias.length;
    const navBadgePend = document.getElementById('navBadgePendencias');
    if (navBadgePend) navBadgePend.textContent = pendencias.length;

    if (tbodyPend) {
        if (!pendencias.length) {
            tbodyPend.innerHTML = '<tr><td colspan="5" class="table-empty">Nenhuma pendência de plano no momento.</td></tr>';
        } else {
            tbodyPend.innerHTML = pendencias.map(deposito => `
                <tr>
                    <td>${formatarDataHora(deposito.dataAprovacao || deposito.dataSolicitacao)}</td>
                    <td>${escapeHTML(nomeDoUsuario(usuarios, deposito.uid))}</td>
                    <td><strong>${formatadorMoeda.format(deposito.valorPlano || 0)}</strong></td>
                    <td style="max-width: 320px; white-space: normal;">${escapeHTML(deposito.obsAdmin) || '—'}</td>
                    <td>
                        <div class="admin-actions">
                            <button class="btn-approve btn-criar-plano-mesmo-assim" data-uid="${deposito.uid}" data-id="${deposito.id}">
                                Criar plano mesmo assim
                            </button>
                            <button class="btn-reject btn-marcar-resolvido" data-uid="${deposito.uid}" data-id="${deposito.id}">
                                Marcar resolvido (sem plano)
                            </button>
                        </div>
                    </td>
                </tr>
            `).join('');
        }
    }

    // 2. Todos os Depósitos
    const tbodyDep = document.getElementById('tabelaDepositosAdmin');
    if (!tbodyDep) return;

    const pendentesCount = depositosAtivos.filter(d => (d.status || 'pendente').toLowerCase() === 'pendente').length;
    const elTotalDep = document.getElementById('totalDepositosPendentes');
    if (elTotalDep) elTotalDep.textContent = pendentesCount;
    const navBadgeDep = document.getElementById('navBadgeDepositos');
    if (navBadgeDep) navBadgeDep.textContent = pendentesCount;

    const { busca, status, ordem } = estado.filtros.depositos;
    const termo = (busca || '').trim().toLowerCase();

    let filtrados = depositosAtivos.filter(d => {
        const st = (d.status || 'pendente').toLowerCase();
        if (status !== 'todos' && st !== status) return false;
        if (termo) {
            const nome = nomeDoUsuario(usuarios, d.uid).toLowerCase();
            const valStr = String(d.valorPlano || '');
            return nome.includes(termo) || valStr.includes(termo) || d.uid.toLowerCase().includes(termo);
        }
        return true;
    });

    filtrados.sort((a, b) => {
        if (ordem === 'valor_desc') return (parseFloat(b.valorPlano) || 0) - (parseFloat(a.valorPlano) || 0);
        const tA = new Date(a.dataSolicitacao || 0).getTime();
        const tB = new Date(b.dataSolicitacao || 0).getTime();
        return ordem === 'data_asc' ? tA - tB : tB - tA;
    });

    const pagina = aplicarPaginacao(filtrados, 'depositos', 'paginacaoDepositos', renderizarTabelaDepositosEPendencias);

    atualizarBarraBulk('Depositos', estado.selecionados.depositos);

    if (!pagina.length) {
        tbodyDep.innerHTML = '<tr><td colspan="6" class="table-empty">Nenhum depósito encontrado para os filtros aplicados.</td></tr>';
        return;
    }

    tbodyDep.innerHTML = pagina.map(deposito => {
        const st = (deposito.status || 'pendente').toLowerCase();
        const chaveItem = `${deposito.uid}::${deposito.id}`;
        const marcado = estado.selecionados.depositos.has(chaveItem) ? 'checked' : '';

        const acoes = st === 'pendente'
            ? `
                <div class="admin-actions">
                    <button class="btn-approve btn-aprovar-deposito" data-uid="${deposito.uid}" data-id="${deposito.id}" data-valor="${deposito.valorPlano || 0}">
                        Aprovar
                    </button>
                    <button class="btn-reject btn-recusar-deposito" data-uid="${deposito.uid}" data-id="${deposito.id}">
                        Recusar
                    </button>
                </div>
            `
            : `
                <div class="admin-actions">
                    <button class="btn-reject btn-arquivar" data-colecao="depositos" data-uid="${deposito.uid}" data-id="${deposito.id}">
                        Arquivar
                    </button>
                </div>
            `;

        const horarioAprovacao = deposito.dataAprovacao
            ? `<div style="font-size: 0.78rem; color: var(--success); margin-top: 2px;">Adquirido: ${formatarDataHora(deposito.dataAprovacao)}</div>`
            : '';

        const nomeDeposito = escapeHTML(nomeDoUsuario(usuarios, deposito.uid));

        return `
            <tr>
                <td><input type="checkbox" class="adm-check check-item-deposito" data-key="${chaveItem}" ${marcado}></td>
                <td>${formatarDataHora(deposito.dataSolicitacao)}${horarioAprovacao}</td>
                <td title="${nomeDeposito}">${nomeDeposito}</td>
                <td><strong>${formatadorMoeda.format(deposito.valorPlano || 0)}</strong></td>
                <td>${badgeStatus(deposito.status)}</td>
                <td>${acoes}</td>
            </tr>
        `;
    }).join('');
}

/* ==========================================================================
   Renderização: PLANOS ADQUIRIDOS E ROBÔ DE RENDIMENTOS
   ========================================================================== */
function renderizarTabelaPlanosAdmin() {
    const planosPorUsuario = estado.planos || {};
    const usuarios = estado.usuarios || {};
    const execucoesRendimentos = estado.execucoesRendimentos || {};

    const elInfoRobo = document.getElementById('infoUltimaExecucaoRobo');
    if (elInfoRobo) {
        const montarCard = (classe, icone, titulo, execucao) => {
            const total = execucao.usuariosCreditados || 0;
            const obs = execucao.observacao
                ? `<span class="robo-status__obs">${escapeHTML(execucao.observacao)}</span>`
                : '';
            const [dia, hora] = formatarDataHora(execucao.data).split(', ');
            const relativo = tempoRelativo(execucao.data);

            return `
                <div class="robo-status__card ${classe}">
                    <div class="robo-status__top">
                        <span class="robo-status__label">
                            <span class="robo-status__icon">${icone}</span>${titulo}
                        </span>
                        ${relativo ? `<span class="robo-status__ago">${relativo}</span>` : ''}
                    </div>
                    <div class="robo-status__when">
                        <strong class="robo-status__date">${dia}</strong>
                        ${hora ? `<span class="robo-status__time">${hora}</span>` : ''}
                    </div>
                    <div class="robo-status__foot">
                        <span class="robo-status__meta"><strong>${total}</strong> ${total === 1 ? 'cliente pago' : 'clientes pagos'}</span>
                        ${obs}
                    </div>
                </div>
            `;
        };

        const ultimoCron = execucoesRendimentos?.cron;
        const ultimoManual = execucoesRendimentos?.manual;
        const cards = [];

        if (ultimoCron?.data) cards.push(montarCard('robo-status__card--auto', ICONE_ROBO_AUTO, 'Último giro automático (Cron)', ultimoCron));
        if (ultimoManual?.data) cards.push(montarCard('robo-status__card--manual', ICONE_ROBO_MANUAL, 'Último giro manual', ultimoManual));

        elInfoRobo.innerHTML = cards.length
            ? cards.join('')
            : '<div class="robo-status__card robo-status__card--vazio">Robô automático agendado para rodar de segunda a sexta às 23:00 (Brasília).</div>';
    }

    const todosPlanos = achatarPorUsuario(planosPorUsuario);
    const ativosCount = todosPlanos.filter(p => p.status !== 'finalizado' && p.status !== 'cancelado_pelo_admin').length;

    const elTotalAtivos = document.getElementById('totalPlanosAtivosAdmin');
    if (elTotalAtivos) elTotalAtivos.textContent = ativosCount;
    const dashAtivos = document.getElementById('dashTotalPlanosAtivos');
    if (dashAtivos) dashAtivos.textContent = ativosCount;
    const navBadgePlanos = document.getElementById('navBadgePlanos');
    if (navBadgePlanos) navBadgePlanos.textContent = ativosCount;

    const tbody = document.getElementById('tabelaPlanosAdmin');
    if (!tbody) return;

    const { busca, status } = estado.filtros.planos;
    const termo = (busca || '').trim().toLowerCase();

    let filtrados = todosPlanos.filter(p => {
        const st = (p.status || 'ativo').toLowerCase();
        if (status !== 'todos' && st !== status) return false;
        if (termo) {
            const nome = nomeDoUsuario(usuarios, p.uid).toLowerCase();
            return nome.includes(termo) || String(p.valor || '').includes(termo);
        }
        return true;
    });

    const pagina = aplicarPaginacao(filtrados, 'planos', 'paginacaoPlanos', renderizarTabelaPlanosAdmin);

    if (!pagina.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="table-empty">Nenhum plano encontrado para os filtros aplicados.</td></tr>';
        return;
    }

    tbody.innerHTML = pagina.map(plano => {
        const valor = parseFloat(plano.valor || 0);
        const percDiario = parseFloat(plano.percentualDiario || 0);
        const tetoPerc = parseFloat(plano.tetoPercentual || 0);
        const valorDiario = valor * percDiario;
        const valorTeto = valor * tetoPerc;
        const jaCreditado = parseFloat(plano.valorCreditado || 0);

        const horarioAdquiriu = formatarDataHora(plano.dataAtivacao);
        const horarioUltimoPagamento = plano.ultimoRendimentoEm
            ? `<span style="color: var(--success); font-weight: 600;">${formatarDataHora(plano.ultimoRendimentoEm)}</span>`
            : (jaCreditado > 0
                ? `<span style="color: var(--success);">Já pago (${formatadorMoeda.format(jaCreditado)})</span>`
                : `<span style="color: var(--text-muted); font-size: 0.85em;">⏳ Aguardando ciclo (24h)</span>`);

        return `
            <tr>
                <td>${escapeHTML(nomeDoUsuario(usuarios, plano.uid))}</td>
                <td>
                    <strong>${formatadorMoeda.format(valor)}</strong><br>
                    <small style="color: var(--success); font-size: 0.82em;">+${formatadorMoeda.format(valorDiario)}/dia (${(percDiario * 100).toFixed(1)}%)</small>
                </td>
                <td>${horarioAdquiriu}</td>
                <td>${horarioUltimoPagamento}</td>
                <td>
                    <strong>${formatadorMoeda.format(jaCreditado)}</strong>
                    <small style="color: var(--text-muted);"> / ${formatadorMoeda.format(valorTeto)}</small>
                </td>
                <td>${badgeStatus(plano.status || 'ativo')}</td>
            </tr>
        `;
    }).join('');
}

/* ==========================================================================
   Renderização: AUDITORIA DE CRÉDITOS E DÉBITOS MANUAIS
   ========================================================================== */
function renderizarTabelaCreditosManuais() {
    const tbody = document.getElementById('tabelaCreditosManuais');
    if (!tbody) return;

    const auditoriaObj = estado.auditoria || {};
    const usuarios = estado.usuarios || {};
    const { busca, tipo } = estado.filtros.auditoria;
    const termo = (busca || '').trim().toLowerCase();

    let creditos = Object.entries(auditoriaObj)
        .map(([id, dados]) => ({ id, ...dados }))
        .filter(c => (c.tipo === 'rendimento_manual' || c.tipo === 'remocao_manual') && c.status === 'concluido' && !c.arquivado)
        .sort((a, b) => new Date(b.data || 0).getTime() - new Date(a.data || 0).getTime());

    if (tipo !== 'todos') {
        creditos = creditos.filter(c => c.tipo === tipo);
    }

    if (termo) {
        creditos = creditos.filter(c => {
            const nomeCliente = nomeDoUsuario(usuarios, c.uid).toLowerCase();
            const nomeAdmin = nomeDoUsuario(usuarios, c.adminUid).toLowerCase();
            const motivo = (c.motivo || '').toLowerCase();
            return nomeCliente.includes(termo) || nomeAdmin.includes(termo) || motivo.includes(termo);
        });
    }

    const pagina = aplicarPaginacao(creditos, 'auditoria', 'paginacaoAuditoria', renderizarTabelaCreditosManuais);

    atualizarBarraBulk('Auditoria', estado.selecionados.auditoria);

    if (!pagina.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="table-empty">Nenhum ajuste manual registrado.</td></tr>';
        return;
    }

    tbody.innerHTML = pagina.map(c => {
        const cor = c.valor < 0 ? 'var(--danger)' : 'var(--success)';
        const marcado = estado.selecionados.auditoria.has(c.id) ? 'checked' : '';
        return `
        <tr>
            <td><input type="checkbox" class="adm-check check-item-auditoria" data-key="${c.id}" ${marcado}></td>
            <td>${formatarDataHora(c.data)}</td>
            <td>${escapeHTML(nomeDoUsuario(usuarios, c.uid))}</td>
            <td style="color: ${cor}; font-weight: 600;">${formatadorMoeda.format(parseFloat(c.valor || 0))}</td>
            <td>${escapeHTML(c.motivo) || '—'}</td>
            <td>${escapeHTML(nomeDoUsuario(usuarios, c.adminUid))}</td>
            <td>
                <button class="btn-reject btn-arquivar" data-colecao="auditoriaCreditos" data-uid="null" data-id="${c.id}">Arquivar</button>
            </td>
        </tr>
        `;
    }).join('');
}

/* ==========================================================================
   Renderização: ARQUIVO / LIXEIRA
   ========================================================================== */
function renderizarTabelaArquivo() {
    const tbody = document.getElementById('tabelaArquivoAdmin');
    if (!tbody) return;

    const usuarios = estado.usuarios || {};
    const itens = [];

    achatarPorUsuario(estado.saques).filter(s => s.arquivado).forEach(s => {
        itens.push({
            colecao: 'saques',
            rotuloCategoria: '💸 Saque',
            uid: s.uid,
            id: s.id,
            data: s.dataSolicitacao,
            detalhe: `${formatadorMoeda.format(s.valorSolicitado || 0)} (PIX: ${s.chavePix || '—'})`,
            status: s.status || 'pago',
        });
    });

    achatarPorUsuario(estado.depositos).filter(d => d.arquivado).forEach(d => {
        itens.push({
            colecao: 'depositos',
            rotuloCategoria: '💰 Depósito',
            uid: d.uid,
            id: d.id,
            data: d.dataSolicitacao,
            detalhe: `Plano ${formatadorMoeda.format(d.valorPlano || 0)}`,
            status: d.status || 'aprovado',
        });
    });

    Object.entries(estado.auditoria || {}).forEach(([id, c]) => {
        if (c && c.arquivado) {
            itens.push({
                colecao: 'auditoriaCreditos',
                rotuloCategoria: '⚖️ Ajuste Manual',
                uid: c.uid,
                id,
                data: c.data,
                detalhe: `${formatadorMoeda.format(c.valor || 0)} (${c.motivo || '—'})`,
                status: c.status || 'concluido',
            });
        }
    });

    itens.sort((a, b) => new Date(b.data || 0).getTime() - new Date(a.data || 0).getTime());

    const badgeArq = document.getElementById('navBadgeArquivo');
    if (badgeArq) badgeArq.textContent = itens.length;

    const { busca, colecao } = estado.filtros.arquivo;
    const termo = (busca || '').trim().toLowerCase();

    const filtrados = itens.filter(item => {
        if (colecao !== 'todos' && item.colecao !== colecao) return false;
        if (termo) {
            const nome = nomeDoUsuario(usuarios, item.uid).toLowerCase();
            return nome.includes(termo) || item.detalhe.toLowerCase().includes(termo);
        }
        return true;
    });

    const pagina = aplicarPaginacao(filtrados, 'arquivo', 'paginacaoArquivo', renderizarTabelaArquivo);

    if (!pagina.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="table-empty">Nenhum registro arquivado encontrado.</td></tr>';
        return;
    }

    tbody.innerHTML = pagina.map(item => `
        <tr>
            <td><strong>${item.rotuloCategoria}</strong></td>
            <td>${formatarDataHora(item.data)}</td>
            <td>${escapeHTML(nomeDoUsuario(usuarios, item.uid))}</td>
            <td>${escapeHTML(item.detalhe)}</td>
            <td>${badgeStatus(item.status)}</td>
            <td>
                <button type="button" class="adm-btn adm-btn--ghost btn-restaurar-arquivo" data-colecao="${item.colecao}" data-uid="${item.uid}" data-id="${item.id}" style="padding: 6px 10px; font-size: 0.78rem;">
                    ↩️ Restaurar
                </button>
            </td>
        </tr>
    `).join('');
}

/* ==========================================================================
   Helpers de Seleção em Massa (Bulk Actions)
   ========================================================================== */
function atualizarBarraBulk(sufixo, setSelecionados) {
    const bar = document.getElementById(`bulkBar${sufixo}`);
    const count = document.getElementById(`bulkCount${sufixo}`);
    if (bar && count) {
        count.textContent = setSelecionados.size;
        bar.classList.toggle('is-visible', setSelecionados.size > 0);
    }
}

/* ==========================================================================
   Formulários Operacionais (Saldo Manual, Gerenciar Planos, Rodar Rendimentos)
   ========================================================================== */
const LIMITE_OPCOES_USUARIOS_MANUAL = 100;
let chaveOperacaoManual = null;

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
    opcaoVazia.textContent = usuarios.length ? 'Selecione o usuário...' : 'Nenhum usuário encontrado';
    select.appendChild(opcaoVazia);

    usuarios.slice(0, LIMITE_OPCOES_USUARIOS_MANUAL).forEach((u) => {
        const opcao = document.createElement('option');
        opcao.value = u.uid;
        opcao.textContent = `${u.nome || 'Sem nome'} — ${u.email || u.uid}`;
        select.appendChild(opcao);
    });

    if (selecionadoAntes && usuarios.some(u => u.uid === selecionadoAntes)) {
        select.value = selecionadoAntes;
    }
}

function atualizarOpcoesGerenciarPlano() {
    const select = document.getElementById('gpUsuario');
    if (!select) return;

    const termo = (document.getElementById('gpBusca')?.value || '').trim().toLowerCase();
    const selecionadoAntes = select.value;

    let usuarios = Object.entries(estado.usuarios || {}).map(([uid, dados]) => ({ uid, nome: dados?.nome || '', email: dados?.email || '' }));
    if (termo) {
        usuarios = usuarios.filter(u => u.nome.toLowerCase().includes(termo) || u.email.toLowerCase().includes(termo));
    }
    usuarios.sort((a, b) => (a.nome || a.email).localeCompare(b.nome || b.email, 'pt-BR'));

    select.textContent = '';
    const opcaoVazia = document.createElement('option');
    opcaoVazia.value = '';
    opcaoVazia.textContent = usuarios.length ? 'Selecione o usuário...' : 'Nenhum usuário encontrado';
    select.appendChild(opcaoVazia);

    usuarios.slice(0, 100).forEach((u) => {
        const opcao = document.createElement('option');
        opcao.value = u.uid;
        opcao.textContent = `${u.nome || 'Sem nome'} — ${u.email || u.uid}`;
        select.appendChild(opcao);
    });

    if (selecionadoAntes && usuarios.some(u => u.uid === selecionadoAntes)) {
        select.value = selecionadoAntes;
    }
}

function iniciarFormularioRendimentoManual() {
    const btn = document.getElementById('btnCreditarManual');
    if (!btn || btn.dataset.listenerAtivo) return;

    const campoBusca = document.getElementById('rmBusca');
    const campoUsuario = document.getElementById('rmUsuario');
    const campoValor = document.getElementById('rmValor');
    const campoMotivo = document.getElementById('rmMotivo');

    campoBusca?.addEventListener('input', atualizarOpcoesRendimentoManual);

    [campoUsuario, campoValor, campoMotivo].forEach((campo) => {
        campo?.addEventListener('input', () => { chaveOperacaoManual = null; });
        campo?.addEventListener('change', () => { chaveOperacaoManual = null; });
    });

    btn.addEventListener('click', async () => {
        const uid = campoUsuario?.value || '';
        const valor = Math.round((parseFloat(campoValor?.value) || 0) * 100) / 100;
        const motivo = (campoMotivo?.value || '').trim();

        if (!uid) {
            mostrarToast('Selecione o usuário.', 'warning');
            return;
        }
        if (!(valor > 0)) {
            mostrarToast('Informe um valor maior que zero.', 'warning');
            return;
        }
        if (motivo.length < 3) {
            mostrarToast('Informe o motivo da operação.', 'warning');
            return;
        }

        const nomeAlvo = nomeDoUsuario(estado.usuarios || {}, uid);
        const tipoOperacao = document.getElementById('rmTipoOperacao')?.value || 'credito';
        const ehDebito = tipoOperacao === 'debito';

        const confirmado = await confirmarAcao({
            titulo: ehDebito ? 'Remover saldo da conta' : 'Adicionar saldo à conta',
            detalhes: [
                { rotulo: 'Usuário', valor: nomeAlvo },
                { rotulo: 'Operação', valor: ehDebito ? 'Débito (remover)' : 'Crédito (adicionar)' },
                { rotulo: 'Valor', valor: formatadorMoeda.format(valor), destaque: true },
                { rotulo: 'Motivo', valor: motivo },
            ],
            textoConfirmar: ehDebito ? 'Remover saldo' : 'Adicionar saldo',
            perigo: ehDebito,
        });
        if (!confirmado) return;

        if (!chaveOperacaoManual) chaveOperacaoManual = gerarChaveOperacao();

        btn.disabled = true;
        const textoOriginal = btn.textContent;
        btn.textContent = 'Processando...';

        try {
            const idToken = await auth.currentUser.getIdToken();
            const resposta = await fetch(`${WORKER_BASE_URL}/api/admin/creditar-rendimento-manual`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`,
                },
                body: JSON.stringify({ uid, valor, motivo, chave: chaveOperacaoManual, tipoOperacao }),
            });

            const dadosResposta = await resposta.json();
            if (!resposta.ok) throw new Error(dadosResposta.error || 'Erro ao processar operação.');

            if (dadosResposta.jaProcessado) {
                mostrarToast('Esta operação já havia sido processada.', 'warning');
            } else {
                const acaoToast = ehDebito ? 'removido de' : 'creditado para';
                mostrarToast(`${formatadorMoeda.format(valor)} ${acaoToast} ${nomeAlvo}.`, 'success');
            }

            chaveOperacaoManual = null;
            if (campoValor) campoValor.value = '';
            if (campoMotivo) campoMotivo.value = '';
        } catch (error) {
            console.error('Erro na operação manual:', error);
            mostrarToast(error.message, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = textoOriginal;
        }
    });

    btn.dataset.listenerAtivo = 'true';
}

function iniciarFormularioGerenciarPlano() {
    const btn = document.getElementById('btnGerenciarPlano');
    if (!btn || btn.dataset.listenerAtivo) return;

    const campoBusca = document.getElementById('gpBusca');
    const campoUsuario = document.getElementById('gpUsuario');
    const campoValor = document.getElementById('gpValor');
    const campoAcao = document.getElementById('gpAcao');

    campoBusca?.addEventListener('input', atualizarOpcoesGerenciarPlano);

    btn.addEventListener('click', async () => {
        const uid = campoUsuario?.value || '';
        const valorPlano = parseFloat(campoValor?.value) || 0;
        const acao = campoAcao?.value || 'adicionar';

        if (!uid) {
            mostrarToast('Selecione o usuário.', 'warning');
            return;
        }
        if (!(valorPlano > 0)) {
            mostrarToast('Selecione o valor do plano.', 'warning');
            return;
        }

        const nomeAlvo = nomeDoUsuario(estado.usuarios || {}, uid);
        const ehRemocao = acao !== 'adicionar';
        const nomePlano = campoValor?.selectedOptions?.[0]?.textContent?.split(' - ')[0]?.trim();

        const confirmado = await confirmarAcao({
            titulo: ehRemocao ? 'Cancelar plano ativo' : 'Ativar plano para o usuário',
            detalhes: [
                { rotulo: 'Usuário', valor: nomeAlvo },
                { rotulo: 'Operação', valor: ehRemocao ? 'Remover plano ativo (cancelar)' : 'Adicionar plano (ativar)' },
                { rotulo: 'Plano', valor: nomePlano },
                { rotulo: 'Valor', valor: formatadorMoeda.format(valorPlano), destaque: true },
            ],
            textoConfirmar: ehRemocao ? 'Cancelar plano' : 'Ativar plano',
            textoCancelar: 'Voltar',
            perigo: ehRemocao,
        });
        if (!confirmado) return;

        btn.disabled = true;
        const textoOriginal = btn.textContent;
        btn.textContent = 'Processando...';

        try {
            const idToken = await auth.currentUser.getIdToken();
            const resposta = await fetch(`${WORKER_BASE_URL}/api/admin/gerenciar-plano`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`,
                },
                body: JSON.stringify({ uid, acao, valorPlano }),
            });

            const dadosResposta = await resposta.json();
            if (!resposta.ok) throw new Error(dadosResposta.error || 'Erro ao processar plano.');

            mostrarToast(dadosResposta.mensagem || 'Operação realizada com sucesso!', 'success');
            if (campoValor) campoValor.value = '';
        } catch (error) {
            console.error('Erro ao gerenciar plano:', error);
            mostrarToast(error.message, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = textoOriginal;
        }
    });

    btn.dataset.listenerAtivo = 'true';
}

function iniciarBotaoRodarRendimentos() {
    const btn = document.getElementById('btnRodarRendimentos');
    const resumoEl = document.getElementById('resumoRendimentos');
    if (!btn || btn.dataset.listenerAtivo) return;

    btn.addEventListener('click', async () => {
        const confirmado = await confirmarAcao({
            titulo: 'Executar cálculo de rendimentos agora',
            detalhes: [
                { rotulo: 'Operação', valor: 'Disparo manual do cálculo diário de rendimentos' },
                { rotulo: 'Regra', valor: 'Apenas planos elegíveis no ciclo de 24h (Seg a Sex)' },
            ],
            textoConfirmar: 'Rodar agora',
        });
        if (!confirmado) return;

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
            if (!resposta.ok) throw new Error(dadosResposta.error || 'Erro ao rodar cálculo de rendimentos.');

            const { resumo } = dadosResposta;
            mostrarToast(`✅ ${resumo.usuariosCreditados} usuário(s) creditado(s) agora.`, 'success');

            if (resumoEl) {
                const linhas = [`Usuários creditados: ${resumo.usuariosCreditados}`];
                if (resumo.usuariosSemConta?.length) {
                    linhas.push(`\n⚠️ Usuários com plano mas sem conta encontrada: ${resumo.usuariosSemConta.join(', ')}`);
                }
                if (resumo.planosComDataInvalida?.length) {
                    linhas.push(`\n⚠️ Planos com data de ativação inválida:`);
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
            btn.textContent = '⚡ Rodar cálculo de rendimentos agora';
        }
    });

    btn.dataset.listenerAtivo = 'true';
}

/* ==========================================================================
   Eventos de Tabelas, Filtros e Ações em Massa
   ========================================================================== */
function iniciarEventosTabelasEFiltros() {
    // 1. Filtros de Usuários
    document.getElementById('buscaUsuarios')?.addEventListener('input', (e) => {
        estado.filtros.usuarios.busca = e.target.value;
        estado.paginacao.usuarios.pagina = 1;
        renderizarTabelaUsuarios();
    });
    document.getElementById('filtroUsuariosTipo')?.addEventListener('change', (e) => {
        estado.filtros.usuarios.tipo = e.target.value;
        estado.paginacao.usuarios.pagina = 1;
        renderizarTabelaUsuarios();
    });
    document.getElementById('ordemUsuarios')?.addEventListener('change', (e) => {
        estado.filtros.usuarios.ordem = e.target.value;
        renderizarTabelaUsuarios();
    });
    document.getElementById('btnLimparFiltrosUsuarios')?.addEventListener('click', () => {
        estado.filtros.usuarios = { busca: '', tipo: 'todos', ordem: 'saldo_desc' };
        document.getElementById('buscaUsuarios').value = '';
        document.getElementById('filtroUsuariosTipo').value = 'todos';
        document.getElementById('ordemUsuarios').value = 'saldo_desc';
        renderizarTabelaUsuarios();
    });

    document.getElementById('tabelaUsuariosAdmin')?.addEventListener('click', (e) => {
        const btnVer = e.target.closest('.btn-ver-usuario');
        if (btnVer) abrirModalDetalhesUsuario(btnVer.dataset.uid);
    });

    // 2. Filtros e Ações de Saques
    document.getElementById('buscaSaques')?.addEventListener('input', (e) => {
        estado.filtros.saques.busca = e.target.value;
        estado.paginacao.saques.pagina = 1;
        renderizarTabelaSaques();
    });
    document.getElementById('filtroStatusSaques')?.addEventListener('change', (e) => {
        estado.filtros.saques.status = e.target.value;
        estado.paginacao.saques.pagina = 1;
        renderizarTabelaSaques();
    });
    document.getElementById('ordemSaques')?.addEventListener('change', (e) => {
        estado.filtros.saques.ordem = e.target.value;
        renderizarTabelaSaques();
    });
    document.getElementById('btnLimparFiltrosSaques')?.addEventListener('click', () => {
        estado.filtros.saques = { busca: '', status: 'todos', ordem: 'data_desc' };
        document.getElementById('buscaSaques').value = '';
        document.getElementById('filtroStatusSaques').value = 'todos';
        document.getElementById('ordemSaques').value = 'data_desc';
        renderizarTabelaSaques();
    });

    document.getElementById('checkAllSaques')?.addEventListener('change', (e) => {
        document.querySelectorAll('.check-item-saque').forEach(chk => {
            chk.checked = e.target.checked;
            if (e.target.checked) estado.selecionados.saques.add(chk.dataset.key);
            else estado.selecionados.saques.delete(chk.dataset.key);
        });
        atualizarBarraBulk('Saques', estado.selecionados.saques);
    });

    document.getElementById('btnBulkDesmarcarSaques')?.addEventListener('click', () => {
        estado.selecionados.saques.clear();
        const chkAll = document.getElementById('checkAllSaques');
        if (chkAll) chkAll.checked = false;
        renderizarTabelaSaques();
    });

    document.getElementById('btnBulkArquivarSaques')?.addEventListener('click', () => {
        executarArquivamentoEmMassa('saques', Array.from(estado.selecionados.saques), estado.selecionados.saques);
    });

    document.getElementById('btnLimparSaquesConcluidos')?.addEventListener('click', () => {
        const pagos = achatarPorUsuario(estado.saques)
            .filter(s => !s.arquivado && (s.status || '').toLowerCase() === 'pago')
            .map(s => `${s.uid}::${s.id}`);
        if (!pagos.length) {
            mostrarToast('Não há saques pagos na lista para arquivar.', 'warning');
            return;
        }
        executarArquivamentoEmMassa('saques', pagos, estado.selecionados.saques);
    });

    document.getElementById('tabelaSaquesAdmin')?.addEventListener('click', async (e) => {
        const chk = e.target.closest('.check-item-saque');
        if (chk) {
            if (chk.checked) estado.selecionados.saques.add(chk.dataset.key);
            else estado.selecionados.saques.delete(chk.dataset.key);
            atualizarBarraBulk('Saques', estado.selecionados.saques);
            return;
        }

        const btnPago = e.target.closest('.btn-marcar-saque-pago');
        if (btnPago) {
            const { uid, id, valor } = btnPago.dataset;
            const confirmado = await confirmarAcao({
                titulo: 'Confirmar pagamento de saque',
                detalhes: [
                    { rotulo: 'Usuário', valor: nomeDoUsuario(estado.usuarios, uid) },
                    { rotulo: 'Valor Líquido', valor: formatadorMoeda.format(parseFloat(valor || 0)), destaque: true },
                ],
                textoConfirmar: 'Marcar como Pago',
            });
            if (!confirmado) return;
            btnPago.disabled = true;
            btnPago.textContent = 'Marcando...';
            marcarSaquePago(uid, id);
            return;
        }

        const btnArq = e.target.closest('.btn-arquivar');
        if (btnArq) {
            const { colecao, uid, id } = btnArq.dataset;
            const confirmado = await confirmarAcao({
                titulo: 'Arquivar registro de saque',
                detalhes: [
                    { rotulo: 'Usuário', valor: nomeDoUsuario(estado.usuarios, uid) },
                    { rotulo: 'Ação', valor: 'O saque será movido para a aba Arquivo / Lixeira.' },
                ],
                textoConfirmar: 'Arquivar',
                perigo: true,
            });
            if (!confirmado) return;
            btnArq.disabled = true;
            btnArq.textContent = 'Arquivando...';
            arquivarRegistro(colecao, uid, id);
        }
    });

    // 3. Filtros e Ações de Depósitos
    document.getElementById('buscaDepositos')?.addEventListener('input', (e) => {
        estado.filtros.depositos.busca = e.target.value;
        estado.paginacao.depositos.pagina = 1;
        renderizarTabelaDepositosEPendencias();
    });
    document.getElementById('filtroStatusDepositos')?.addEventListener('change', (e) => {
        estado.filtros.depositos.status = e.target.value;
        estado.paginacao.depositos.pagina = 1;
        renderizarTabelaDepositosEPendencias();
    });
    document.getElementById('ordemDepositos')?.addEventListener('change', (e) => {
        estado.filtros.depositos.ordem = e.target.value;
        renderizarTabelaDepositosEPendencias();
    });
    document.getElementById('btnLimparFiltrosDepositos')?.addEventListener('click', () => {
        estado.filtros.depositos = { busca: '', status: 'todos', ordem: 'data_desc' };
        document.getElementById('buscaDepositos').value = '';
        document.getElementById('filtroStatusDepositos').value = 'todos';
        document.getElementById('ordemDepositos').value = 'data_desc';
        renderizarTabelaDepositosEPendencias();
    });

    document.getElementById('checkAllDepositos')?.addEventListener('change', (e) => {
        document.querySelectorAll('.check-item-deposito').forEach(chk => {
            chk.checked = e.target.checked;
            if (e.target.checked) estado.selecionados.depositos.add(chk.dataset.key);
            else estado.selecionados.depositos.delete(chk.dataset.key);
        });
        atualizarBarraBulk('Depositos', estado.selecionados.depositos);
    });

    document.getElementById('btnBulkDesmarcarDepositos')?.addEventListener('click', () => {
        estado.selecionados.depositos.clear();
        const chkAll = document.getElementById('checkAllDepositos');
        if (chkAll) chkAll.checked = false;
        renderizarTabelaDepositosEPendencias();
    });

    document.getElementById('btnBulkArquivarDepositos')?.addEventListener('click', () => {
        executarArquivamentoEmMassa('depositos', Array.from(estado.selecionados.depositos), estado.selecionados.depositos);
    });

    document.getElementById('btnLimparDepositosConcluidos')?.addEventListener('click', () => {
        const finalizados = achatarPorUsuario(estado.depositos)
            .filter(d => !d.arquivado && ['aprovado', 'recusado'].includes((d.status || '').toLowerCase()))
            .map(d => `${d.uid}::${d.id}`);
        if (!finalizados.length) {
            mostrarToast('Não há depósitos aprovados/recusados para arquivar.', 'warning');
            return;
        }
        executarArquivamentoEmMassa('depositos', finalizados, estado.selecionados.depositos);
    });

    document.getElementById('tabelaDepositosAdmin')?.addEventListener('click', async (e) => {
        const chk = e.target.closest('.check-item-deposito');
        if (chk) {
            if (chk.checked) estado.selecionados.depositos.add(chk.dataset.key);
            else estado.selecionados.depositos.delete(chk.dataset.key);
            atualizarBarraBulk('Depositos', estado.selecionados.depositos);
            return;
        }

        const btnAprovar = e.target.closest('.btn-aprovar-deposito');
        if (btnAprovar) {
            const { uid, id, valor } = btnAprovar.dataset;
            const confirmado = await confirmarAcao({
                titulo: 'Aprovar depósito e ativar plano',
                detalhes: [
                    { rotulo: 'Usuário', valor: nomeDoUsuario(estado.usuarios, uid) },
                    { rotulo: 'Valor do Plano', valor: formatadorMoeda.format(parseFloat(valor || 0)), destaque: true },
                ],
                textoConfirmar: 'Aprovar Depósito',
            });
            if (!confirmado) return;
            btnAprovar.disabled = true;
            btnAprovar.textContent = 'Aprovando...';
            aprovarDeposito(uid, id, valor);
            return;
        }

        const btnRecusar = e.target.closest('.btn-recusar-deposito');
        if (btnRecusar) {
            const { uid, id } = btnRecusar.dataset;
            const confirmado = await confirmarAcao({
                titulo: 'Recusar solicitação de depósito',
                detalhes: [
                    { rotulo: 'Usuário', valor: nomeDoUsuario(estado.usuarios, uid) },
                ],
                textoConfirmar: 'Recusar',
                perigo: true,
            });
            if (!confirmado) return;
            btnRecusar.disabled = true;
            btnRecusar.textContent = 'Recusando...';
            recusarDeposito(uid, id);
            return;
        }

        const btnArq = e.target.closest('.btn-arquivar');
        if (btnArq) {
            const { colecao, uid, id } = btnArq.dataset;
            const confirmado = await confirmarAcao({
                titulo: 'Arquivar depósito',
                detalhes: [
                    { rotulo: 'Usuário', valor: nomeDoUsuario(estado.usuarios, uid) },
                    { rotulo: 'Ação', valor: 'O depósito será movido para a aba Arquivo / Lixeira.' },
                ],
                textoConfirmar: 'Arquivar',
                perigo: true,
            });
            if (!confirmado) return;
            btnArq.disabled = true;
            btnArq.textContent = 'Arquivando...';
            arquivarRegistro(colecao, uid, id);
        }
    });

    // 4. Pendências de Plano
    document.getElementById('tabelaPendenciasPlano')?.addEventListener('click', async (e) => {
        const btnCriar = e.target.closest('.btn-criar-plano-mesmo-assim');
        if (btnCriar) {
            const { uid, id } = btnCriar.dataset;
            const confirmado = await confirmarAcao({
                titulo: 'Criar plano extra manualmente',
                detalhes: [
                    { rotulo: 'Usuário', valor: nomeDoUsuario(estado.usuarios, uid) },
                    { rotulo: 'Ação', valor: 'Ativa o plano ignorando o limite de planos repetidos.' },
                ],
                textoConfirmar: 'Criar Plano',
            });
            if (!confirmado) return;
            btnCriar.disabled = true;
            btnCriar.textContent = 'Criando...';
            resolverPendenciaPlano(uid, id, 'criar_plano');
            return;
        }

        const btnResolvido = e.target.closest('.btn-marcar-resolvido');
        if (btnResolvido) {
            const { uid, id } = btnResolvido.dataset;
            const confirmado = await confirmarAcao({
                titulo: 'Marcar pendência como resolvida (sem criar plano)',
                detalhes: [
                    { rotulo: 'Usuário', valor: nomeDoUsuario(estado.usuarios, uid) },
                    { rotulo: 'Ação', valor: 'Remove da fila de pendências sem criar novo plano.' },
                ],
                textoConfirmar: 'Marcar Resolvido',
                perigo: true,
            });
            if (!confirmado) return;
            btnResolvido.disabled = true;
            btnResolvido.textContent = 'Marcando...';
            resolverPendenciaPlano(uid, id, 'marcar_resolvido');
        }
    });

    // 5. Filtros de Planos
    document.getElementById('buscaPlanos')?.addEventListener('input', (e) => {
        estado.filtros.planos.busca = e.target.value;
        estado.paginacao.planos.pagina = 1;
        renderizarTabelaPlanosAdmin();
    });
    document.getElementById('filtroStatusPlanos')?.addEventListener('change', (e) => {
        estado.filtros.planos.status = e.target.value;
        estado.paginacao.planos.pagina = 1;
        renderizarTabelaPlanosAdmin();
    });
    document.getElementById('btnLimparFiltrosPlanos')?.addEventListener('click', () => {
        estado.filtros.planos = { busca: '', status: 'todos' };
        document.getElementById('buscaPlanos').value = '';
        document.getElementById('filtroStatusPlanos').value = 'todos';
        renderizarTabelaPlanosAdmin();
    });

    // 6. Filtros e Bulk de Auditoria
    document.getElementById('buscaAuditoria')?.addEventListener('input', (e) => {
        estado.filtros.auditoria.busca = e.target.value;
        estado.paginacao.auditoria.pagina = 1;
        renderizarTabelaCreditosManuais();
    });
    document.getElementById('filtroTipoAuditoria')?.addEventListener('change', (e) => {
        estado.filtros.auditoria.tipo = e.target.value;
        estado.paginacao.auditoria.pagina = 1;
        renderizarTabelaCreditosManuais();
    });

    document.getElementById('checkAllAuditoria')?.addEventListener('change', (e) => {
        document.querySelectorAll('.check-item-auditoria').forEach(chk => {
            chk.checked = e.target.checked;
            if (e.target.checked) estado.selecionados.auditoria.add(chk.dataset.key);
            else estado.selecionados.auditoria.delete(chk.dataset.key);
        });
        atualizarBarraBulk('Auditoria', estado.selecionados.auditoria);
    });

    document.getElementById('btnBulkDesmarcarAuditoria')?.addEventListener('click', () => {
        estado.selecionados.auditoria.clear();
        const chkAll = document.getElementById('checkAllAuditoria');
        if (chkAll) chkAll.checked = false;
        renderizarTabelaCreditosManuais();
    });

    document.getElementById('btnBulkArquivarAuditoria')?.addEventListener('click', () => {
        executarArquivamentoEmMassa('auditoriaCreditos', Array.from(estado.selecionados.auditoria), estado.selecionados.auditoria);
    });

    document.getElementById('tabelaCreditosManuais')?.addEventListener('click', async (e) => {
        const chk = e.target.closest('.check-item-auditoria');
        if (chk) {
            if (chk.checked) estado.selecionados.auditoria.add(chk.dataset.key);
            else estado.selecionados.auditoria.delete(chk.dataset.key);
            atualizarBarraBulk('Auditoria', estado.selecionados.auditoria);
            return;
        }

        const btnArquivar = e.target.closest('.btn-arquivar');
        if (!btnArquivar) return;

        const { colecao, id } = btnArquivar.dataset;
        const uid = btnArquivar.dataset.uid || 'null';

        const confirmado = await confirmarAcao({
            titulo: 'Arquivar registro de ajuste manual',
            detalhes: [
                { rotulo: 'Ação', valor: 'O registro será movido para a aba Arquivo / Lixeira.' },
            ],
            textoConfirmar: 'Arquivar',
            perigo: true,
        });
        if (!confirmado) return;

        btnArquivar.disabled = true;
        btnArquivar.textContent = 'Arquivando...';
        arquivarRegistro(colecao, uid, id);
    });

    // 7. Filtros e Restauração do Arquivo / Lixeira
    document.getElementById('buscaArquivo')?.addEventListener('input', (e) => {
        estado.filtros.arquivo.busca = e.target.value;
        estado.paginacao.arquivo.pagina = 1;
        renderizarTabelaArquivo();
    });
    document.getElementById('filtroColecaoArquivo')?.addEventListener('change', (e) => {
        estado.filtros.arquivo.colecao = e.target.value;
        estado.paginacao.arquivo.pagina = 1;
        renderizarTabelaArquivo();
    });

    document.getElementById('tabelaArquivoAdmin')?.addEventListener('click', async (e) => {
        const btnRestaurar = e.target.closest('.btn-restaurar-arquivo');
        if (!btnRestaurar) return;

        const { colecao, uid, id } = btnRestaurar.dataset;
        btnRestaurar.disabled = true;
        btnRestaurar.textContent = 'Restaurando...';
        await restaurarRegistroArquivado(colecao, uid, id);
    });
}

/* ==========================================================================
   Rerenderização Geral e Listeners do Firebase
   ========================================================================== */
function rerenderizarTudo() {
    atualizarOpcoesRendimentoManual();
    atualizarOpcoesGerenciarPlano();

    if (estado.usuarios !== null) renderizarTabelaUsuarios();
    if (estado.saques !== null) renderizarTabelaSaques();
    if (estado.depositos !== null) renderizarTabelaDepositosEPendencias();
    if (estado.planos !== null || estado.execucoesRendimentos !== null) renderizarTabelaPlanosAdmin();
    if (estado.auditoria !== null) renderizarTabelaCreditosManuais();

    renderizarTabelaArquivo();
}

let listenersIniciados = false;

function iniciarListenersAdmin() {
    if (listenersIniciados) return;
    listenersIniciados = true;

    iniciarNavegacaoAbas();
    iniciarEventosTabelasEFiltros();
    iniciarBotaoRodarRendimentos();
    iniciarFormularioRendimentoManual();
    iniciarFormularioGerenciarPlano();

    onValue(ref(db, 'auditoriaCreditos'), (snapshot) => {
        estado.auditoria = snapshot.val() || {};
        rerenderizarTudo();
    });

    onValue(ref(db, 'usuarios'), (snapshot) => {
        estado.usuarios = snapshot.val() || {};
        const meuUid = auth.currentUser?.uid;
        if (meuUid && estado.usuarios[meuUid]) {
            const elNome = document.getElementById('admHeaderAdminName');
            if (elNome) elNome.textContent = estado.usuarios[meuUid].nome || estado.usuarios[meuUid].email || 'Admin';
        }
        rerenderizarTudo();
    });

    onValue(ref(db, 'financeiro'), (snapshot) => {
        estado.financeiro = snapshot.val() || {};
        rerenderizarTudo();
    });

    onValue(ref(db, 'saques'), (snapshot) => {
        estado.saques = snapshot.val() || {};
        rerenderizarTudo();
    });

    onValue(ref(db, 'depositos'), (snapshot) => {
        estado.depositos = snapshot.val() || {};
        rerenderizarTudo();
    });

    onValue(ref(db, 'planos'), (snapshot) => {
        estado.planos = snapshot.val() || {};
        rerenderizarTudo();
    });

    onValue(ref(db, 'controle/execucoesRendimentos'), (snapshot) => {
        estado.execucoesRendimentos = snapshot.val() || {};
        rerenderizarTudo();
    });
}

auth.onAuthStateChanged((user) => {
    if (!user) return;

    const acessoNegado = document.getElementById('acessoNegado');
    const conteudoAdmin = document.getElementById('conteudoAdmin');

    const perfilRef = ref(db, 'usuarios/' + user.uid + '/isAdmin');
    onValue(perfilRef, (snapshot) => {
        const ehAdmin = snapshot.val() === true;

        if (ehAdmin) {
            if (acessoNegado) acessoNegado.style.display = 'none';
            if (conteudoAdmin) conteudoAdmin.style.display = 'flex';
            iniciarListenersAdmin();
        } else {
            if (acessoNegado) acessoNegado.style.display = 'block';
            if (conteudoAdmin) conteudoAdmin.style.display = 'none';
        }
    }, (error) => {
        console.error('Erro ao verificar permissão de admin:', error);
        if (acessoNegado) acessoNegado.style.display = 'block';
        if (conteudoAdmin) conteudoAdmin.style.display = 'none';
    });
});
