/* ==========================================================================
   Missões de Indicação — tela do usuário
   --------------------------------------------------------------------------
   Esta tela só MOSTRA e PEDE. Quem conta os indicados, libera a missão e
   credita o dinheiro é o worker (/api/missoes/status e /api/missoes/coletar).
   Nada aqui altera saldo; mesmo que alguém mexa no navegador, o servidor
   confere tudo de novo antes de pagar.
   ========================================================================== */
import { auth, mostrarToast } from './auth.js';

const WORKER_BASE_URL = 'https://apidabancacompartilhada.lucas-dev-programador.workers.dev';
const ATUALIZAR_A_CADA_MS = 60 * 1000;
const HISTORICO_POR_VEZ = 5;

const formatadorMoeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const formatadorDataHora = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = (v) => formatadorMoeda.format(Number(v) || 0);
const dataHora = (iso) => {
    const t = Date.parse(iso);
    return Number.isNaN(t) ? '—' : formatadorDataHora.format(t);
};

const estado = {
    dados: null,          // resposta do /status
    carregando: false,
    erro: null,
    historicoVisivel: HISTORICO_POR_VEZ,
    coletando: new Set(), // missões com clique em andamento (evita clique duplo na tela)
};

let raiz = null;

/* ---------- worker ---------- */
async function chamarWorker(caminho, corpo = {}) {
    const usuario = auth.currentUser;
    if (!usuario) throw new Error('Você precisa estar logado.');
    const token = await usuario.getIdToken();
    const resposta = await fetch(`${WORKER_BASE_URL}${caminho}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(corpo),
    });
    const dados = await resposta.json().catch(() => ({}));
    if (!resposta.ok) {
        const erro = new Error(dados.error || 'Erro ao falar com o servidor.');
        erro.status = resposta.status;
        erro.dados = dados;
        throw erro;
    }
    return dados;
}

async function carregarStatus({ silencioso = false } = {}) {
    if (estado.carregando) return;
    estado.carregando = true;
    if (!silencioso && !estado.dados) renderizar();
    try {
        estado.dados = await chamarWorker('/api/missoes/status');
        estado.erro = null;
    } catch (erro) {
        console.error('Erro ao carregar missões:', erro);
        if (!estado.dados) estado.erro = erro.message;
    } finally {
        estado.carregando = false;
        renderizar();
    }
}

async function coletar(missaoId) {
    if (estado.coletando.has(missaoId)) return;
    estado.coletando.add(missaoId);
    renderizar();
    try {
        const r = await chamarWorker('/api/missoes/coletar', { missaoId });
        mostrarToast(`🏅 Recompensa de ${brl(r.valor)} coletada! Já está no seu saldo de comissão.`, 'success');
    } catch (erro) {
        mostrarToast('❌ ' + erro.message, erro.status === 409 ? 'warning' : 'error');
    } finally {
        estado.coletando.delete(missaoId);
        estado.carregando = false;
        await carregarStatus({ silencioso: true });
    }
}

/* ---------- visual ---------- */
const MEDALHAS = [
    { nome: 'bronze', a: '#e0a66b', b: '#8a5a2b' },
    { nome: 'prata', a: '#f2f5fb', b: '#8f9bb3' },
    { nome: 'ouro', a: '#ffe08a', b: '#c8922a' },
    { nome: 'platina', a: '#dfeaff', b: '#6f8fd1' },
    { nome: 'diamante', a: '#b9f1ff', b: '#3d9fd6' },
    { nome: 'mestre', a: '#fff6d6', b: '#e0a92c' },
];

function definicoesSvg() {
    return `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>
        ${MEDALHAS.map((m) => `<linearGradient id="missaoGrad-${m.nome}" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="${m.a}"/><stop offset="1" stop-color="${m.b}"/></linearGradient>`).join('')}
        <linearGradient id="missaoGrad-bloqueada" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#5b6b8f"/><stop offset="1" stop-color="#2c3a5c"/></linearGradient>
    </defs></svg>`;
}

function escudo(indice, estadoMissao) {
    const bloqueada = estadoMissao === 'bloqueada';
    const medalha = MEDALHAS[indice % MEDALHAS.length];
    const fill = bloqueada ? 'url(#missaoGrad-bloqueada)' : `url(#missaoGrad-${medalha.nome})`;
    const centro = bloqueada
        ? '<path d="M9.5 13v-2a2.5 2.5 0 0 1 5 0v2M8.5 13h7v5h-7z" fill="none" stroke="#c9d3ea" stroke-width="1.4" stroke-linejoin="round"/>'
        : estadoMissao === 'coletada'
            ? '<path d="M8.2 12.6l2.6 2.6 5-5.4" fill="none" stroke="#0b1f4a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'
            : '<path d="M12 7.2l1.5 3.1 3.4.5-2.45 2.4.58 3.4L12 14.9l-3.03 1.7.58-3.4L7.1 10.8l3.4-.5z" fill="#0b1f4a"/>';
    return `<svg class="missao-escudo" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 1.6l8.4 3v6.2c0 5.1-3.5 9.2-8.4 11.6C7.1 20 3.6 15.9 3.6 10.8V4.6z" fill="${fill}" stroke="${bloqueada ? '#7585a9' : '#fff3c4'}" stroke-width="0.9"/>
        <path d="M12 3.6l6.4 2.3v4.9c0 3.9-2.6 7.2-6.4 9.2-3.8-2-6.4-5.3-6.4-9.2V5.9z" fill="none" stroke="rgba(255,255,255,.35)" stroke-width=".6"/>
        ${centro}
    </svg>`;
}

const ROTULO_ESTADO = {
    bloqueada: 'Bloqueada',
    disponivel: 'Disponível',
    processando: 'Processando',
    coletada: 'Recompensa coletada',
};

function cartaoMissao(m, indice, n) {
    const progresso = Math.min(n, m.meta);
    const pct = Math.max(0, Math.min(100, (progresso / m.meta) * 100));
    const emCurso = estado.coletando.has(m.id);

    let botao;
    if (m.estado === 'coletada') {
        botao = '<button type="button" class="missao-btn missao-btn--coletada" disabled>✔ RECOMPENSA COLETADA</button>';
    } else if (m.estado === 'disponivel') {
        botao = `<button type="button" class="missao-btn missao-btn--pronta" data-coletar="${esc(m.id)}" ${emCurso ? 'disabled' : ''}>${emCurso ? 'PROCESSANDO...' : 'COLETAR RECOMPENSA'}</button>`;
    } else if (m.estado === 'processando') {
        botao = '<button type="button" class="missao-btn" disabled>PROCESSANDO...</button>';
    } else {
        botao = '<button type="button" class="missao-btn" disabled>🔒 COLETAR RECOMPENSA</button>';
    }

    const rodape = m.estado === 'coletada' && m.coletadaEm
        ? `<p class="missao-nota">Coletada em ${esc(dataHora(m.coletadaEm))}</p>`
        : m.estado === 'bloqueada'
            ? `<p class="missao-nota">Faltam ${m.meta - n} indicado${m.meta - n === 1 ? '' : 's'} ativo${m.meta - n === 1 ? '' : 's'}</p>`
            : '';

    return `<article class="missao missao--${esc(m.estado)}" data-missao="${esc(m.id)}">
        <div class="missao-topo">
            ${escudo(indice, m.estado)}
            <div class="missao-meta">
                <span class="missao-rotulo">Missão ${indice + 1}</span>
                <strong class="missao-alvo">${m.meta} indicados ativos</strong>
            </div>
            <span class="missao-chip missao-chip--${esc(m.estado)}">${ROTULO_ESTADO[m.estado] || ''}</span>
        </div>
        <div class="missao-premio"><span>Recompensa</span><strong>${brl(m.recompensa)}</strong></div>
        <div class="missao-barra" role="progressbar" aria-valuemin="0" aria-valuemax="${m.meta}" aria-valuenow="${progresso}">
            <span style="width:${pct.toFixed(1)}%"></span>
        </div>
        <div class="missao-contagem"><span>${progresso} / ${m.meta}</span><span>${Math.round(pct)}%</span></div>
        ${botao}
        ${rodape}
    </article>`;
}

function resumoProximaMissao(d) {
    const pendentes = d.missoes.filter((m) => m.estado !== 'coletada');
    if (!d.missoes.length) return { texto: 'Nenhuma missão disponível no momento.', pct: 0 };
    if (!pendentes.length) return { texto: 'Parabéns! Você concluiu todas as missões.', pct: 100 };
    const pronta = pendentes.find((m) => m.estado === 'disponivel');
    if (pronta) return { texto: `Você tem uma recompensa de ${brl(pronta.recompensa)} pronta para coletar!`, pct: 100 };
    const proxima = pendentes[0];
    const faltam = proxima.meta - d.indicadosAtivos;
    return {
        texto: `Faltam ${faltam} indicado${faltam === 1 ? '' : 's'} ativo${faltam === 1 ? '' : 's'} para a próxima recompensa de ${brl(proxima.recompensa)}.`,
        pct: Math.min(100, (d.indicadosAtivos / proxima.meta) * 100),
    };
}

function renderizar() {
    if (!raiz) return;
    const d = estado.dados;

    if (!d) {
        raiz.innerHTML = cabecalho() + (estado.erro
            ? `<div class="missoes-aviso"><p>${esc(estado.erro)}</p><button type="button" class="missao-btn missao-btn--pronta" data-recarregar>Tentar de novo</button></div>`
            : '<p class="missoes-aviso">Carregando suas missões...</p>');
        atualizarPonto();
        return;
    }

    const prox = resumoProximaMissao(d);
    const historico = d.historico || [];
    const visiveis = historico.slice(0, estado.historicoVisivel);
    const resta = historico.length - visiveis.length;

    raiz.innerHTML = `${definicoesSvg()}
        ${cabecalho()}
        <section class="missoes-resumo">
            <div class="missoes-contador">
                <span>Indicados ativos</span>
                <strong>${d.indicadosAtivos}</strong>
                <small>de ${d.totalIndicados} indicado${d.totalIndicados === 1 ? '' : 's'} no total</small>
            </div>
            <div class="missoes-proxima">
                <p>${esc(prox.texto)}</p>
                <div class="missao-barra missao-barra--grande"><span style="width:${prox.pct.toFixed(1)}%"></span></div>
            </div>
        </section>
        <p class="missoes-regra">Conta apenas quem você indicou e que tem um <strong>plano ativo de ${brl(d.valorMinimoPlano)} ou mais</strong>. Cada indicado conta uma única vez. A recompensa vai para o seu saldo de comissão.</p>
        <section class="missoes-grade">
            ${d.missoes.map((m, i) => cartaoMissao(m, i, d.indicadosAtivos)).join('') || '<p class="missoes-aviso">Nenhuma missão disponível no momento.</p>'}
        </section>
        <section class="missoes-historico">
            <h3>Histórico de recompensas</h3>
            ${visiveis.length
                ? `<ul>${visiveis.map((h) => `<li><span><b>${esc(h.meta)} indicados ativos</b><small>${esc(dataHora(h.data))}</small></span><strong>${brl(h.recompensa)}</strong></li>`).join('')}</ul>`
                : '<p class="missoes-vazio">Você ainda não coletou nenhuma recompensa.</p>'}
            ${resta > 0 ? `<button type="button" class="missoes-mais" data-mais-historico>Mostrar mais (${resta} restantes)</button>` : ''}
        </section>`;
    atualizarPonto();
}

function cabecalho() {
    return `<header class="missoes-cabecalho">
        <span class="missoes-selo" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M12 1.6l8.4 3v6.2c0 5.1-3.5 9.2-8.4 11.6C7.1 20 3.6 15.9 3.6 10.8V4.6z" fill="#f3c969" stroke="#fff3c4" stroke-width=".8"/><path d="M12 7.2l1.5 3.1 3.4.5-2.45 2.4.58 3.4L12 14.9l-3.03 1.7.58-3.4L7.1 10.8l3.4-.5z" fill="#0b1f4a"/></svg>
        </span>
        <div>
            <h2 class="missoes-titulo">MISSÕES DE INDICAÇÃO</h2>
            <p>Indique, acompanhe sua evolução e colete recompensas a cada meta.</p>
        </div>
    </header>`;
}

/* bolinha no menu quando há recompensa pronta */
function atualizarPonto() {
    const item = document.querySelector('.sidebar-nav [data-target="view-missoes"]');
    if (!item) return;
    const temPronta = !!(estado.dados && estado.dados.missoes.some((m) => m.estado === 'disponivel'));
    let ponto = item.querySelector('.missoes-ponto');
    if (temPronta && !ponto) {
        ponto = document.createElement('span');
        ponto.className = 'missoes-ponto';
        ponto.setAttribute('aria-label', 'Recompensa disponível');
        item.appendChild(ponto);
    } else if (!temPronta && ponto) {
        ponto.remove();
    }
}

/* ---------- inicialização ---------- */
function secaoVisivel() {
    const secao = document.getElementById('view-missoes');
    return !!secao && secao.style.display !== 'none';
}

function iniciar() {
    raiz = document.getElementById('missoesRaiz');
    if (!raiz) return;

    raiz.addEventListener('click', (e) => {
        const btnColetar = e.target.closest('[data-coletar]');
        if (btnColetar) { coletar(btnColetar.dataset.coletar); return; }
        if (e.target.closest('[data-mais-historico]')) { estado.historicoVisivel += HISTORICO_POR_VEZ; renderizar(); return; }
        if (e.target.closest('[data-recarregar]')) { estado.erro = null; carregarStatus(); }
    });

    // ao abrir a aba, atualiza na hora
    document.addEventListener('click', (e) => {
        if (e.target.closest('.sidebar-nav [data-target="view-missoes"]') && auth.currentUser) {
            setTimeout(() => carregarStatus({ silencioso: !!estado.dados }), 0);
        }
    });

    // enquanto a aba está aberta, atualiza sozinho
    setInterval(() => {
        if (document.visibilityState === 'visible' && secaoVisivel() && auth.currentUser) carregarStatus({ silencioso: true });
    }, ATUALIZAR_A_CADA_MS);

    auth.onAuthStateChanged((usuario) => {
        if (usuario) {
            carregarStatus({ silencioso: true });   // também acende a bolinha do menu
        } else {
            estado.dados = null;
            estado.historicoVisivel = HISTORICO_POR_VEZ;
        }
    });

    renderizar();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
else iniciar();
