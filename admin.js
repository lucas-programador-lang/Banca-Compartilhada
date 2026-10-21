import { auth, db, mostrarToast } from './auth.js';
import { ref, onValue, get } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { iniciarRede, atualizarRede } from './admin-rede.js';
import { iniciarMissoesAdmin, atualizarMissoesAdmin } from './admin-missoes.js';
import { calcularTerminoPrevisto } from './termino-plano.js';

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

const ICONE_ROBO_AUTO = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
const ICONE_ROBO_APP = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/></svg>';
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

/* Comprovante do saque no Telegram: aparece só para saques pagos com a exigência ligada */
function notaComprovante(saque) {
    if (!saque || saque.status !== 'pago' || saque.comprovanteObrigatorio !== true) return '';
    const codigo = 'BC-' + String(saque.id || '').slice(-8).toUpperCase();
    let texto = 'Aguardando comprovante';
    let cor = 'var(--warning)';
    if (saque.comprovantePostadoEm) {
        texto = 'Comprovante aprovado';
        cor = 'var(--success)';
    } else if (saque.comprovanteEnviadoEm) {
        texto = 'Comprovante em conferência';
        cor = 'var(--warning)';
    } else if (saque.comprovanteRecusadoEm) {
        texto = 'Comprovante recusado, aguardando novo envio';
        cor = 'var(--danger)';
    }
    return `<div style="font-size: 0.75rem; color: ${cor}; margin-top: 2px;">${texto} <span style="color: var(--text-muted);">${escapeHTML(codigo)}</span></div>`;
}

/* Lista "quem foi pago" de um giro do robô. `pagos` = { uid: valor } (cron/manual)
   ou { uid: { valor, em } } (pagos ao abrir o app). */
function htmlListaPagos(pagos, usuarios) {
    const itens = Object.entries(pagos || {})
        .map(([uid, v]) => ({
            nome: nomeDoUsuario(usuarios, uid),
            valor: (v && typeof v === 'object') ? Number(v.valor) || 0 : Number(v) || 0,
        }))
        .filter((item) => item.valor > 0)
        .sort((a, b) => b.valor - a.valor || String(a.nome).localeCompare(String(b.nome), 'pt-BR'));

    if (!itens.length) return '';

    const total = itens.reduce((soma, item) => soma + item.valor, 0);
    const linhas = itens.map((item) => `
        <li>
            <span class="robo-lista__nome">${escapeHTML(item.nome)}</span>
            <strong class="robo-lista__valor">${formatadorMoeda.format(item.valor)}</strong>
        </li>`).join('');

    return `
        <details class="robo-lista">
            <summary>Ver quem foi pago <span class="robo-lista__total">${formatadorMoeda.format(total)} no total</span></summary>
            <ul class="robo-lista__itens">${linhas}</ul>
        </details>`;
}

function badgeStatus(status) {
    const chave = (status || 'pendente').toLowerCase();
    const label = STATUS_LABELS[chave] || status || 'Pendente';
    const cor = STATUS_CORES[chave] || 'var(--text-muted)';
    return `<span style="color: ${cor}; font-weight: 600;">${label}</span>`;
}

function achatarPorUsuario(dadosPorUsuario) {
    if (!dadosPorUsuario) return [];
    const lista = [];
    Object.entries(dadosPorUsuario).forEach(([uid, registros]) => {
        Object.entries(registros || {}).forEach(([id, valor]) => {
            lista.push({ uid, id, ...valor });
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
    if (!dados) return uid;
    return dados.nome || dados.email || uid;
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

/* ==========================================================================
   Modal de confirmação (substitui window.confirm)
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

function renderizarTabelaSaques(saques, usuarios) {
    const tbody = document.getElementById('tabelaSaquesAdmin');
    if (!tbody) return;

    if (!saques.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="table-empty">Nenhum saque solicitado ainda.</td></tr>';
    } else {
        tbody.innerHTML = saques.map(saque => {
            const status = (saque.status || 'pendente').toLowerCase();
            const acoes = status === 'enviando'
                ? '<span style="color: var(--text-muted);">Enviando...</span>'
                : ['pendente', 'processando', 'verificar'].includes(status)
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

            const horarioPago = saque.dataPagamento
                ? `<div style="font-size: 0.78rem; color: var(--success); margin-top: 2px;">Pago: ${formatarDataHora(saque.dataPagamento)}</div>`
                : '';

            return `
                <tr>
                    <td>${formatarDataHora(saque.dataSolicitacao)}${horarioPago}</td>
                    <td>${escapeHTML(nomeDoUsuario(usuarios, saque.uid))}</td>
                    <td>${escapeHTML(saque.chavePix) || '—'}</td>
                    <td>
                        <strong style="color: var(--text-primary);">${formatadorMoeda.format(saque.valorSolicitado || 0)}</strong><br>
                        <small style="color: var(--danger); font-size: 0.85em;">Taxa (14%): -${formatadorMoeda.format(saque.taxa || 0)}</small><br>
                        <small style="color: var(--success); font-weight: 600;">Líquido: ${formatadorMoeda.format(saque.valorLiquido || 0)}</small>
                    </td>
                    <td>${badgeStatus(saque.status)}${notaComprovante(saque)}</td>
                    <td>${acoes}</td>
                </tr>
            `;
        }).join('');
    }

    const pendentes = saques.filter(s => ['pendente', 'processando', 'verificar'].includes((s.status || 'pendente').toLowerCase())).length;
    const elTotal = document.getElementById('totalSaquesPendentes');
    if (elTotal) elTotal.textContent = pendentes;
}

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
                <td title="${escapeHTML(nomeDoUsuario(usuarios, deposito.uid))}">${escapeHTML(nomeDoUsuario(usuarios, deposito.uid))}</td>
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

            const horarioAprovacao = deposito.dataAprovacao
                ? `<div style="font-size: 0.78rem; color: var(--success); margin-top: 2px;">Adquirido: ${formatarDataHora(deposito.dataAprovacao)}</div>`
                : '';

            const nomeDeposito = escapeHTML(nomeDoUsuario(usuarios, deposito.uid));

            return `
                <tr>
                    <td>${formatarDataHora(deposito.dataSolicitacao)}${horarioAprovacao}</td>
                    <td title="${nomeDeposito}">${nomeDeposito}</td>
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

/* ==========================================================================
   Planos Adquiridos e Horários de Rendimento
   ========================================================================== */
const ICONE_AGUARDANDO = '<svg class="pl-ico" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';

// Estilo da tabela de planos: risca os planos encerrados, mostra o texto inteiro no
// computador e vira lista de cartões organizada no celular.
function garantirEstiloPlanos() {
    if (document.getElementById('estiloPlanosAdmin')) return;
    const estilo = document.createElement('style');
    estilo.id = 'estiloPlanosAdmin';
    estilo.textContent = `
        /* ---------- Cartões do robô: lista de quem foi pago ---------- */
        .admin-page .robo-lista { margin-top: 12px; }
        .admin-page .robo-lista > summary {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            cursor: pointer;
            list-style: none;
            font-size: 0.8rem;
            font-weight: 600;
            color: var(--primary, #d4a853);
        }
        .admin-page .robo-lista > summary::-webkit-details-marker { display: none; }
        .admin-page .robo-lista > summary::after {
            content: "";
            flex: 0 0 auto;
            width: 7px;
            height: 7px;
            margin-left: 4px;
            border-right: 2px solid currentColor;
            border-bottom: 2px solid currentColor;
            transform: rotate(45deg);
            transition: transform 0.2s ease;
        }
        .admin-page .robo-lista[open] > summary::after { transform: rotate(-135deg); }
        .admin-page .robo-lista__total { margin-left: auto; font-weight: 500; color: var(--text-muted); }
        .admin-page .robo-lista__itens {
            list-style: none;
            margin: 10px 0 0;
            padding: 0;
            max-height: 240px;
            overflow-y: auto;
            border-top: 1px solid var(--border-color);
        }
        .admin-page .robo-lista__itens li {
            display: flex;
            justify-content: space-between;
            gap: 12px;
            padding: 8px 0;
            border-bottom: 1px solid var(--border-color);
            font-size: 0.82rem;
        }
        .admin-page .robo-lista__nome { min-width: 0; overflow-wrap: anywhere; }
        .admin-page .robo-lista__valor { flex: 0 0 auto; color: var(--success, #10b981); white-space: nowrap; }

        /* ---------- Planos encerrados (finalizado / cancelado): riscados e esmaecidos ---------- */
        .admin-page .pl-v { text-decoration: none; }
        .admin-page tr.plano-linha--encerrado td:not(.pl-status) { opacity: 0.55; }
        .admin-page tr.plano-linha--encerrado .pl-v {
            text-decoration: line-through;
            text-decoration-thickness: 1.5px;
            text-decoration-color: var(--text-muted, #888);
        }

        /* ---------- Barra de progresso do teto ---------- */
        .admin-page .pl-barra {
            height: 5px;
            margin-top: 7px;
            border-radius: 999px;
            background: var(--border-color, rgba(255, 255, 255, 0.12));
            overflow: hidden;
        }
        .admin-page .pl-barra > span {
            display: block;
            height: 100%;
            border-radius: inherit;
            background: var(--success, #10b981);
        }
        .admin-page tr.plano-linha--encerrado .pl-barra > span { background: var(--text-muted, #888); }
        .admin-page .pl-ico { display: inline-block; vertical-align: -2px; margin-right: 4px; }

        /* ---------- Computador: mostra o texto inteiro (antes era cortado com "...") ---------- */
        @media (min-width: 992px) {
            .admin-page table:has(> #tabelaPlanosAdmin) { min-width: 1000px; }
            .admin-page table:has(> #tabelaPlanosAdmin) td {
                white-space: normal;
                overflow: visible;
                text-overflow: clip;
                overflow-wrap: anywhere;
            }
        }

        /* ---------- Celular e tablet: cada plano vira um cartão ---------- */
        @media (max-width: 991px) {
            .admin-page table:has(> #tabelaPlanosAdmin) tbody tr.plano-linha {
                grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
                grid-template-areas:
                    "cliente  status"
                    "plano    credito"
                    "adquiriu termino"
                    "ultimo   ultimo";
                align-items: start;
                gap: 14px 16px;
            }
            .admin-page table:has(> #tabelaPlanosAdmin) tr.plano-linha--encerrado {
                background: transparent;
                border-style: dashed;
            }
            .admin-page table:has(> #tabelaPlanosAdmin) td.pl-cliente {
                grid-area: cliente;
                font-size: 1rem;
                font-weight: 600;
                line-height: 1.3;
            }
            .admin-page table:has(> #tabelaPlanosAdmin) td.pl-status { grid-area: status; text-align: right; }
            .admin-page table:has(> #tabelaPlanosAdmin) td.pl-plano { grid-area: plano; }
            .admin-page table:has(> #tabelaPlanosAdmin) td.pl-credito { grid-area: credito; text-align: right; }
            .admin-page table:has(> #tabelaPlanosAdmin) td.pl-adquiriu { grid-area: adquiriu; }
            .admin-page table:has(> #tabelaPlanosAdmin) td.pl-termino { grid-area: termino; text-align: right; }
            .admin-page table:has(> #tabelaPlanosAdmin) td.pl-ultimo {
                grid-area: ultimo;
                padding-top: 12px;
                border-top: 1px solid var(--border-color);
            }
            /* nome e status não precisam de rótulo: o cartão já deixa claro */
            .admin-page table:has(> #tabelaPlanosAdmin) td.pl-cliente::before,
            .admin-page table:has(> #tabelaPlanosAdmin) td.pl-status::before { display: none; }
        }

        /* ---------- Celular bem estreito: uma coluna só ---------- */
        @media (max-width: 380px) {
            .admin-page table:has(> #tabelaPlanosAdmin) tbody tr.plano-linha {
                grid-template-columns: minmax(0, 1fr);
                grid-template-areas: "cliente" "status" "plano" "credito" "adquiriu" "termino" "ultimo";
            }
            .admin-page table:has(> #tabelaPlanosAdmin) td.pl-status,
            .admin-page table:has(> #tabelaPlanosAdmin) td.pl-credito,
            .admin-page table:has(> #tabelaPlanosAdmin) td.pl-termino { text-align: left; }
        }
    `;
    document.head.appendChild(estilo);
}

function garantirSecaoPlanosNoHTML() {
    if (document.getElementById('tabelaPlanosAdmin')) return;

    const conteudoAdmin = document.getElementById('conteudoAdmin');
    if (!conteudoAdmin) return;

    const tabelaRef = document.getElementById('tabelaDepositosAdmin')?.closest('table');
    const wrapperRef = tabelaRef?.parentElement;
    const classeTabela = tabelaRef?.className || 'table';
    const classeWrapper = wrapperRef?.className || 'table-responsive';

    const secao = document.createElement('div');
    secao.className = 'planos-section';
    secao.innerHTML = `
        <div class="planos-head">
            <div class="planos-head__top">
                <h2 class="planos-head__title">Planos Adquiridos e Horários de Pagamento</h2>
                <span class="planos-head__count"><strong id="totalPlanosAtivosAdmin">0</strong> ativos</span>
            </div>
            <div id="infoUltimaExecucaoRobo" class="robo-status">
                <div class="robo-status__card robo-status__card--vazio">Carregando status do robô de rendimentos...</div>
            </div>
        </div>
        <div class="${classeWrapper}">
            <table class="${classeTabela}">
                <thead>
                    <tr>
                        <th>CLIENTE</th>
                        <th>PLANO / DIÁRIO</th>
                        <th>HORÁRIO QUE ADQUIRIU</th>
                        <th>TÉRMINO PREVISTO</th>
                        <th>ÚLTIMO RENDIMENTO PAGO</th>
                        <th>JÁ CREDITADO / TETO</th>
                        <th>STATUS</th>
                    </tr>
                </thead>
                <tbody id="tabelaPlanosAdmin">
                    <tr><td colspan="7" class="table-empty">Carregando planos...</td></tr>
                </tbody>
            </table>
        </div>
    `;

    const blocoDepositos = wrapperRef?.parentElement || wrapperRef;
    if (blocoDepositos && blocoDepositos.parentNode) {
        blocoDepositos.parentNode.insertBefore(secao, blocoDepositos);
    } else {
        conteudoAdmin.appendChild(secao);
    }
}

function renderizarTabelaPlanosAdmin(planosPorUsuario, usuarios, execucoesRendimentos) {
    garantirSecaoPlanosNoHTML();
    garantirEstiloPlanos();

    const tbody = document.getElementById('tabelaPlanosAdmin');
    const elTotalAtivos = document.getElementById('totalPlanosAtivosAdmin');
    const elInfoRobo = document.getElementById('infoUltimaExecucaoRobo');

    if (elInfoRobo) {
        const montarCard = (classe, icone, titulo, execucao) => {
            const total = execucao.usuariosCreditados || 0;
            const listaPagos = htmlListaPagos(execucao.pagos, usuarios);
            let avisoLista = '';
            if (!listaPagos && total === 0) {
                avisoLista = '<span class="robo-status__obs">Ninguém tinha rendimento pendente neste giro. Quem abre o app já recebe na hora.</span>';
            } else if (!listaPagos && total > 0) {
                avisoLista = '<span class="robo-status__obs">Os nomes aparecem a partir do próximo giro.</span>';
            }
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
                        ${avisoLista}
                    </div>
                    ${listaPagos}
                </div>
            `;
        };

        const ultimoCron = execucoesRendimentos?.cron;
        const ultimoManual = execucoesRendimentos?.manual;
        const cards = [];

        if (ultimoCron?.data) {
            cards.push(montarCard('robo-status__card--auto', ICONE_ROBO_AUTO, 'Último giro automático (Cron)', ultimoCron));
        }
        if (ultimoManual?.data) {
            cards.push(montarCard('robo-status__card--manual', ICONE_ROBO_MANUAL, 'Último giro manual', ultimoManual));
        }

        // Rendimentos pagos na hora em que o cliente abre o site/app (acumulado do dia)
        const aoAbrir = execucoesRendimentos?.aoAbrir;
        if (aoAbrir?.atualizadoEm && aoAbrir.pagos) {
            const hojeBrasilia = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
            const [ano, mes, dia] = String(aoAbrir.dia || '').split('-');
            const rotuloDia = aoAbrir.dia === hojeBrasilia ? 'hoje' : (dia && mes ? `dia ${dia}/${mes}` : '');
            cards.push(montarCard(
                'robo-status__card--app',
                ICONE_ROBO_APP,
                `Pagos ao abrir o app${rotuloDia ? ` (${rotuloDia})` : ''}`,
                {
                    data: aoAbrir.atualizadoEm,
                    usuariosCreditados: Object.keys(aoAbrir.pagos).length,
                    pagos: aoAbrir.pagos,
                }
            ));
        }

        elInfoRobo.innerHTML = cards.length
            ? cards.join('')
            : '<div class="robo-status__card robo-status__card--vazio">Robô automático agendado para rodar de segunda a sexta às 23:00 (Brasília).</div>';
    }

    if (!tbody) return;

    const todosPlanos = achatarPorUsuario(planosPorUsuario);
    const ativosCount = todosPlanos.filter(p => p.status !== 'finalizado' && p.status !== 'cancelado_pelo_admin').length;
    if (elTotalAtivos) elTotalAtivos.textContent = ativosCount;

    if (!todosPlanos.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="table-empty">Nenhum plano adquirido ainda.</td></tr>';
        return;
    }

    tbody.innerHTML = todosPlanos.map(plano => {
        const valor = parseFloat(plano.valor || 0);
        const percDiario = parseFloat(plano.percentualDiario || 0);
        const tetoPerc = parseFloat(plano.tetoPercentual || 0);
        const valorDiario = valor * percDiario;
        const valorTeto = valor * tetoPerc;
        const jaCreditado = parseFloat(plano.valorCreditado || 0);

        const horarioAdquiriu = formatarDataHora(plano.dataAtivacao);
        const terminoPrevisto = formatarDataHora(calcularTerminoPrevisto(plano) || plano.dataExpiracao);

        const horarioUltimoPagamento = plano.ultimoRendimentoEm
            ? `<span style="color: var(--success); font-weight: 600;">${formatarDataHora(plano.ultimoRendimentoEm)}</span>`
            : (jaCreditado > 0
                ? `<span style="color: var(--success);">Já pago (${formatadorMoeda.format(jaCreditado)})</span>`
                : `<span style="color: var(--text-muted); font-size: 0.85em;">${ICONE_AGUARDANDO}Aguardando ciclo (24h)</span>`);

        // Plano encerrado (finalizado ou cancelado): a linha fica riscada e esmaecida
        const statusPlano = String(plano.status || 'ativo').toLowerCase();
        const encerrado = statusPlano === 'finalizado' || statusPlano === 'cancelado_pelo_admin';
        const percentualDoTeto = valorTeto > 0 ? Math.min(100, Math.round((jaCreditado / valorTeto) * 100)) : 0;

        return `
            <tr class="plano-linha${encerrado ? ' plano-linha--encerrado' : ''}">
                <td class="pl-cliente" data-label="Cliente"><span class="pl-v">${escapeHTML(nomeDoUsuario(usuarios, plano.uid))}</span></td>
                <td class="pl-plano" data-label="Plano / diário">
                    <span class="pl-v">
                        <strong>${formatadorMoeda.format(valor)}</strong><br>
                        <small style="color: var(--success); font-size: 0.82em;">+${formatadorMoeda.format(valorDiario)}/dia (${(percDiario * 100).toFixed(1)}%)</small>
                    </span>
                </td>
                <td class="pl-adquiriu" data-label="Adquirido em"><span class="pl-v">${horarioAdquiriu}</span></td>
                <td class="pl-termino" data-label="Término previsto"><span class="pl-v"><strong style="color: var(--adm-primary, #10b981);">${terminoPrevisto}</strong></span></td>
                <td class="pl-ultimo" data-label="Último rendimento pago"><span class="pl-v">${horarioUltimoPagamento}</span></td>
                <td class="pl-credito" data-label="Já creditado / teto">
                    <span class="pl-v">
                        <strong>${formatadorMoeda.format(jaCreditado)}</strong>
                        <small style="color: var(--text-muted);"> / ${formatadorMoeda.format(valorTeto)}</small>
                    </span>
                    <div class="pl-barra" role="img" aria-label="${percentualDoTeto}% do teto"><span style="width: ${percentualDoTeto}%;"></span></div>
                </td>
                <td class="pl-status">${badgeStatus(plano.status || 'ativo')}</td>
            </tr>
        `;
    }).join('');
}

function renderizarTabelaUsuarios(usuariosObj, financeiroObj, depositosObj, saquesObj, planosObj, filtro) {
    const tbody = document.getElementById('tabelaUsuariosAdmin');
    if (!tbody) return;

    const termo = (filtro || '').trim().toLowerCase();
    let lista = Object.entries(usuariosObj || {}).map(([uid, dados]) => {
        const financeiro = (financeiroObj || {})[uid] || {};
        const saldo = parseFloat(financeiro.saldoRendimento || 0) + parseFloat(financeiro.saldoComissao || 0);
        const comissao = parseFloat(financeiro.comissao || 0);

        let totalDepositado = 0;
        if (depositosObj && depositosObj[uid]) {
            Object.values(depositosObj[uid]).forEach(dep => {
                const status = (dep.status || '').toLowerCase();
                if (['aprovado', 'aprovado_sem_plano', 'resolvido_sem_plano'].includes(status)) {
                    totalDepositado += parseFloat(dep.valorPlano || 0);
                }
            });
        }

        let totalSacado = 0;
        if (saquesObj && saquesObj[uid]) {
            Object.values(saquesObj[uid]).forEach(saq => {
                const status = (saq.status || '').toLowerCase();
                if (status === 'pago') {
                    totalSacado += parseFloat(saq.valorSolicitado || 0);
                }
            });
        }

        const planosUsuario = Object.values((planosObj || {})[uid] || {});
        const planosAtivos = planosUsuario.filter(p => p.status !== 'finalizado' && p.status !== 'cancelado_pelo_admin');

        return { uid, ...dados, saldo, comissao, totalDepositado, totalSacado, qtdPlanosAtivos: planosAtivos.length };
    });

    if (termo) {
        lista = lista.filter(u =>
            (u.nome || '').toLowerCase().includes(termo) ||
            (u.email || '').toLowerCase().includes(termo)
        );
    }

    lista.sort((a, b) => b.saldo - a.saldo);

    if (!lista.length) {
        const mensagem = termo ? 'Nenhum usuário encontrado para essa busca.' : 'Nenhum usuário cadastrado ainda.';
        tbody.innerHTML = `<tr><td colspan="7" class="table-empty">${mensagem}</td></tr>`;
    } else {
        tbody.innerHTML = lista.map(u => {
            const infoPlanos = u.qtdPlanosAtivos > 0
                ? `<div style="font-size: 0.75rem; color: var(--success); margin-top: 2px;">${u.qtdPlanosAtivos} plano(s) ativo(s)</div>`
                : `<div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 2px;">Sem plano ativo</div>`;

            return `
                <tr>
                    <td>${escapeHTML(u.nome) || '—'}${infoPlanos}</td>
                    <td title="${escapeHTML(u.email)}">${escapeHTML(u.email) || '—'}</td>
                    <td><strong>${formatadorMoeda.format(u.saldo)}</strong></td>
                    <td>${formatadorMoeda.format(u.comissao)}</td>
                    <td style="color: var(--success); font-weight: 500;">+ ${formatadorMoeda.format(u.totalDepositado)}</td>
                    <td style="color: var(--danger); font-weight: 500;">- ${formatadorMoeda.format(u.totalSacado)}</td>
                    <td>${u.isAdmin ? '<span class="status-badge status-admin">Admin</span>' : '—'}</td>
                </tr>
            `;
        }).join('');
    }

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

const WORKER_BASE_URL = 'https://apidabancacompartilhada.lucas-dev-programador.workers.dev';

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

        mostrarToast('Depósito aprovado! O plano já está ativo na Carteira do usuário.', 'success');
    } catch (error) {
        console.error('Erro ao aprovar depósito:', error);
        mostrarToast('Erro ao aprovar depósito: ' + error.message, 'error');
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
        mostrarToast('Erro ao recusar depósito: ' + error.message, 'error');
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
            acao === 'criar_plano' ? 'Plano criado manualmente.' : 'Pendência marcada como resolvida.',
            'success'
        );
    } catch (error) {
        console.error('Erro ao resolver pendência de plano:', error);
        mostrarToast('Erro ao resolver pendência: ' + error.message, 'error');
    }
}

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
        if (!resposta.ok) throw new Error(dadosResposta.error || 'Erro ao excluir registro.');

        mostrarToast('Registro excluído da lista.', 'warning');
    } catch (error) {
        console.error('Erro ao arquivar registro:', error);
        mostrarToast('Erro ao excluir: ' + error.message, 'error');
    }
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

        mostrarToast('Saque marcado como pago.', 'success');
    } catch (error) {
        console.error('Erro ao marcar saque como pago:', error);
        mostrarToast('Erro ao marcar saque como pago: ' + error.message, 'error');
    }
}

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

function iniciarBuscaUsuarios() {
    const input = document.getElementById('buscaUsuarios');
    if (!input || input.dataset.listenerAtivo) return;

    input.addEventListener('input', (e) => {
        estado.filtroUsuarios = e.target.value;
        renderizarTabelaUsuarios(
            estado.usuarios || {},
            estado.financeiro || {},
            estado.depositos || {},
            estado.saques || {},
            estado.planos || {},
            estado.filtroUsuarios
        );
    });

    input.dataset.listenerAtivo = 'true';
}

const estado = {
    usuarios: null,
    financeiro: null,
    saques: null,
    depositos: null,
    planos: null,
    missoesConfig: null,
    missoesColetas: null,
    missoesErro: null,
    execucoesRendimentos: null,
    auditoria: null,
    filtroUsuarios: '',
};

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
    opcaoVazia.textContent = usuarios.length ? 'Selecione o usuário...' : (termo ? 'Nenhum usuário encontrado' : 'Nenhum usuário cadastrado');
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

    if (selecionadoAntes && usuarios.some(u => u.uid === selecionadoAntes)) {
        select.value = selecionadoAntes;
    }
}

function renderizarTabelaCreditosManuais(auditoriaObj, usuarios) {
    const tbody = document.getElementById('tabelaCreditosManuais');
    if (!tbody) return;

    const creditos = Object.entries(auditoriaObj || {})
        .map(([id, dados]) => ({ id, ...dados }))
        .filter(c => (c.tipo === 'rendimento_manual' || c.tipo === 'remocao_manual') && c.status === 'concluido' && !c.arquivado)
        .sort((a, b) => new Date(b.data || 0).getTime() - new Date(a.data || 0).getTime())
        .slice(0, 20);

    if (!creditos.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="table-empty">Nenhum ajuste manual registrado.</td></tr>';
        return;
    }

    tbody.innerHTML = creditos.map(c => {
        const cor = c.valor < 0 ? 'var(--danger)' : 'var(--success)';
        return `
        <tr>
            <td>${formatarDataHora(c.data)}</td>
            <td>${escapeHTML(nomeDoUsuario(usuarios, c.uid))}</td>
            <td style="color: ${cor}; font-weight: 600;">${formatadorMoeda.format(parseFloat(c.valor || 0))}</td>
            <td>${escapeHTML(c.motivo) || '—'}</td>
            <td>${escapeHTML(nomeDoUsuario(usuarios, c.adminUid))}</td>
            <td>
                <button class="btn-reject btn-arquivar" data-colecao="auditoriaCreditos" data-uid="null" data-id="${c.id}">Excluir</button>
            </td>
        </tr>
    `}).join('');
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
            if (!resposta.ok) {
                throw new Error(dadosResposta.error || 'Erro ao processar operação.');
            }

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
            if (!resposta.ok) {
                throw new Error(dadosResposta.error || 'Erro ao processar plano.');
            }

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

function aplicarRotulosMobile() {
    document.querySelectorAll('.table-container table').forEach((tabela) => {
        const titulos = [...tabela.querySelectorAll('thead th')].map(th => th.textContent.trim());
        tabela.querySelectorAll('tbody tr').forEach((tr) => {
            [...tr.children].forEach((td, i) => {
                if (!td.classList.contains('table-empty')) td.dataset.label = titulos[i] || '';
            });
        });
    });
}

function rerenderizarTudo() {
    atualizarOpcoesRendimentoManual();
    atualizarOpcoesGerenciarPlano();

    if (estado.auditoria !== null) {
        renderizarTabelaCreditosManuais(estado.auditoria, estado.usuarios || {});
    }

    if (estado.saques !== null) {
        const saquesLista = achatarPorUsuario(estado.saques).filter(s => !s.arquivado);
        renderizarTabelaSaques(saquesLista, estado.usuarios || {});

        let somaTotalSaquesPagos = 0;
        achatarPorUsuario(estado.saques).forEach(s => {
            if ((s.status || '').toLowerCase() === 'pago') {
                somaTotalSaquesPagos += parseFloat(s.valorSolicitado || 0);
            }
        });
        const elGeral = document.getElementById('totalSaquesPagosGeral');
        if (elGeral) elGeral.textContent = formatadorMoeda.format(somaTotalSaquesPagos);
    }

    if (estado.depositos !== null) {
        const depositosLista = achatarPorUsuario(estado.depositos).filter(d => !d.arquivado);
        renderizarTabelaDepositos(depositosLista, estado.usuarios || {});
        renderizarTabelaPendenciasPlano(depositosLista, estado.usuarios || {});
    }

    if (estado.planos !== null || estado.execucoesRendimentos !== null) {
        renderizarTabelaPlanosAdmin(
            estado.planos || {},
            estado.usuarios || {},
            estado.execucoesRendimentos || {}
        );
    }

    if (estado.usuarios !== null) {
        renderizarTabelaUsuarios(
            estado.usuarios,
            estado.financeiro || {},
            estado.depositos || {},
            estado.saques || {},
            estado.planos || {},
            estado.filtroUsuarios
        );
    }

    aplicarRotulosMobile();
    atualizarRede();
    atualizarMissoesAdmin();
}

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
            mostrarToast(`${resumo.usuariosCreditados} usuário(s) creditado(s) agora.`, 'success');

            if (resumoEl) {
                const linhas = [`Usuários creditados: ${resumo.usuariosCreditados}`];

                if (resumo.usuariosSemConta?.length) {
                    linhas.push(`\nUsuários com plano mas sem conta encontrada (dado órfão): ${resumo.usuariosSemConta.join(', ')}`);
                }
                if (resumo.planosComDataInvalida?.length) {
                    linhas.push(`\nPlanos com data de ativação inválida (não creditados até corrigir manualmente):`);
                    resumo.planosComDataInvalida.forEach(p => {
                        linhas.push(`  - uid: ${p.uid} | planoId: ${p.planoId} | dataAtivacao: ${JSON.stringify(p.dataAtivacao)}`);
                    });
                }
                if (resumo.usuariosComErro?.length) {
                    linhas.push(`\nUsuários com erro ao creditar:`);
                    resumo.usuariosComErro.forEach(u => {
                        linhas.push(`  - uid: ${u.uid} | erro: ${u.erro}`);
                    });
                }

                resumoEl.textContent = linhas.join('\n');
                resumoEl.style.display = 'block';
            }
        } catch (error) {
            console.error('Erro ao rodar cálculo de rendimentos:', error);
            mostrarToast('' + error.message, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Rodar cálculo de rendimentos agora';
        }
    });

    btn.dataset.listenerAtivo = 'true';
}

async function lerExtratoMissao(uid, extratoId) {
    const snap = await get(ref(db, `extrato/${uid}/${extratoId}`));
    return snap.val();
}

async function salvarConfigMissoes(missoes) {
    const idToken = await auth.currentUser.getIdToken();
    const resposta = await fetch(`${WORKER_BASE_URL}/api/admin/missoes/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({ missoes }),
    });
    const dados = await resposta.json().catch(() => ({}));
    if (!resposta.ok) throw new Error(dados.error || 'Erro ao salvar as missões.');
    mostrarToast('Missões salvas.', 'success');
    return dados;
}

function iniciarListenersAdmin() {
    iniciarRede(() => estado);
    iniciarMissoesAdmin({
        obterEstado: () => estado,
        lerExtrato: lerExtratoMissao,
        salvarConfig: salvarConfigMissoes,
        confirmar: confirmarAcao,
    });
    iniciarDelegacaoAcoesDepositos();
    iniciarDelegacaoAcoesSaques();
    iniciarDelegacaoPendenciasPlano();
    iniciarBuscaUsuarios();
    iniciarBotaoRodarRendimentos();
    iniciarFormularioRendimentoManual();
    iniciarFormularioGerenciarPlano();

    const auditoriaRef = ref(db, 'auditoriaCreditos');
    onValue(auditoriaRef, (snapshot) => {
        estado.auditoria = snapshot.val() || {};
        rerenderizarTudo();
    }, (error) => {
        console.error('Erro ao carregar o histórico de créditos manuais:', error);
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
        estado.saques = snapshot.val() || {};
        rerenderizarTudo();
    });

    const depositosRef = ref(db, 'depositos');
    onValue(depositosRef, (snapshot) => {
        estado.depositos = snapshot.val() || {};
        rerenderizarTudo();
    });

    const planosRef = ref(db, 'planos');
    onValue(planosRef, (snapshot) => {
        estado.planos = snapshot.val() || {};
        rerenderizarTudo();
    }, (error) => {
        console.error('Erro ao carregar planos no admin:', error);
    });

    onValue(ref(db, 'missoesConfig'), (snapshot) => {
        estado.missoesConfig = snapshot.val() || {};
        rerenderizarTudo();
    }, (error) => {
        console.error('Erro ao carregar a configuração das missões:', error);
        estado.missoesConfig = {};
        estado.missoesErro = 'sem permissão para ler missoesConfig';
        rerenderizarTudo();
    });

    onValue(ref(db, 'missoesColetas'), (snapshot) => {
        estado.missoesColetas = snapshot.val() || {};
        rerenderizarTudo();
    }, (error) => {
        console.error('Erro ao carregar as coletas de missões:', error);
        estado.missoesColetas = {};
        estado.missoesErro = 'sem permissão para ler missoesColetas';
        rerenderizarTudo();
    });

    const execucoesRef = ref(db, 'controle/execucoesRendimentos');
    onValue(execucoesRef, (snapshot) => {
        estado.execucoesRendimentos = snapshot.val() || {};
        rerenderizarTudo();
    }, (error) => {
        console.warn('Não foi possível ler controle/execucoesRendimentos (opcional):', error.message);
    });

    const tbodyCreditos = document.getElementById('tabelaCreditosManuais');
    if (tbodyCreditos && !tbodyCreditos.dataset.listenerAtivo) {
        tbodyCreditos.addEventListener('click', async (e) => {
            const btnArquivar = e.target.closest('.btn-arquivar');
            if (!btnArquivar) return;

            const { colecao, id } = btnArquivar.dataset;
            const uid = btnArquivar.dataset.uid || 'null';

            const confirmado = await confirmarAcao({
                titulo: 'Excluir registro do histórico',
                detalhes: [
                    { rotulo: 'Ação', valor: 'O registro deixa de aparecer na lista de ajustes manuais.' },
                ],
                textoConfirmar: 'Excluir',
                perigo: true,
            });
            if (!confirmado) return;

            btnArquivar.disabled = true;
            btnArquivar.textContent = 'Excluindo...';
            arquivarRegistro(colecao, uid, id);
        });
        tbodyCreditos.dataset.listenerAtivo = 'true';
    }
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
            if (conteudoAdmin) conteudoAdmin.style.display = 'block';
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
