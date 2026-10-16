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
const ICONE_CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 12.8l4.2 4.2 8.8-9.4" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICONE_CADEADO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 11V8.5a4.5 4.5 0 0 1 9 0V11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><rect x="5" y="11" width="14" height="10" rx="2.4" fill="currentColor"/></svg>';

const ROTULO_ESTADO = {
    bloqueada: 'Bloqueada',
    disponivel: 'Disponível',
    processando: 'Processando',
    coletada: 'Coletada',
};

function textoTrava(m, indice, missoes, n) {
    const anteriorAtingida = indice === 0 || missoes[indice - 1].meta <= n;
    if (!anteriorAtingida) return 'Complete a meta anterior para desbloquear';
    const faltam = m.meta - n;
    return `Faltam ${faltam} indicado${faltam === 1 ? '' : 's'} ativo${faltam === 1 ? '' : 's'} para desbloquear`;
}

function cartaoMissao(m, indice, missoes, n) {
    const progresso = Math.min(n, m.meta);
    const pct = Math.max(0, Math.min(100, (progresso / m.meta) * 100));
    const bloqueada = m.estado === 'bloqueada';
    const emCurso = estado.coletando.has(m.id);
    const anteriorAtingida = indice === 0 || missoes[indice - 1].meta <= n;

    let acao;
    if (m.estado === 'coletada') {
        acao = '<button type="button" class="m-btn m-btn--coletada" disabled>✔ RECOMPENSA COLETADA</button>';
    } else if (m.estado === 'disponivel') {
        acao = `<button type="button" class="m-btn m-btn--pronta" data-coletar="${esc(m.id)}" ${emCurso ? 'disabled' : ''}>${emCurso ? 'PROCESSANDO...' : 'COLETAR RECOMPENSA'}</button>`;
    } else if (m.estado === 'processando') {
        acao = '<button type="button" class="m-btn" disabled>PROCESSANDO...</button>';
    } else {
        acao = '<button type="button" class="m-btn" disabled>COLETAR RECOMPENSA</button>';
    }

    const medalha = bloqueada ? 'missoes-cavalo-bloqueado.png' : 'missoes-cavalo-ouro.png';
    const trava = bloqueada
        ? `<p class="m-trava">${ICONE_CADEADO}<span>${esc(textoTrava(m, indice, missoes, n))}</span></p>`
        : (m.estado === 'coletada' && m.coletadaEm ? `<p class="m-nota">Coletada em ${esc(dataHora(m.coletadaEm))}</p>` : '');

    const itemClasse = `m-item m-item--${esc(m.estado)}${bloqueada && !anteriorAtingida ? ' m-item--distante' : ''}`;
    return `<li class="${itemClasse}" data-missao="${esc(m.id)}">
        <span class="m-no" aria-hidden="true">${bloqueada ? ICONE_CADEADO : ICONE_CHECK}</span>
        <article class="m-card">
            <img class="m-medalha" src="${medalha}" alt="" width="88" height="88" loading="lazy">
            <div class="m-info">
                <h3 class="m-meta">${m.meta} INDICADOS ATIVOS</h3>
                <p class="m-sub">Indicações com plano ativo</p>
                <div class="m-progresso">
                    <div class="m-barra${bloqueada ? ' m-barra--apagada' : ''}" role="progressbar" aria-valuemin="0" aria-valuemax="${m.meta}" aria-valuenow="${progresso}"><span style="width:${pct.toFixed(1)}%"></span></div>
                    <span class="m-n">${progresso} / ${m.meta}</span>
                </div>
                ${trava}
            </div>
            <div class="m-premio"><span>RECOMPENSA</span><strong>${brl(m.recompensa)}</strong></div>
            <div class="m-acao">${acao}</div>
        </article>
    </li>`;
}

function resumoProximaMissao(d) {
    const pendentes = d.missoes.filter((m) => m.estado !== 'coletada');
    if (!d.missoes.length) return { texto: 'Nenhuma missão disponível no momento.', pct: 0 };
    if (!pendentes.length) return { texto: 'Parabéns! Você concluiu todas as missões.', pct: 100 };
    const pronta = pendentes.find((m) => m.estado === 'disponivel');
    if (pronta) return { texto: `Você tem ${brl(pronta.recompensa)} prontos para coletar!`, pct: 100 };
    const proxima = pendentes[0];
    const faltam = proxima.meta - d.indicadosAtivos;
    return {
        texto: `Faltam ${faltam} indicado${faltam === 1 ? '' : 's'} ativo${faltam === 1 ? '' : 's'} para ${brl(proxima.recompensa)}.`,
        pct: Math.min(100, (d.indicadosAtivos / proxima.meta) * 100),
    };
}

function renderizar() {
    if (!raiz) return;
    const d = estado.dados;

    if (!d) {
        raiz.innerHTML = cabecalho(50) + (estado.erro
            ? `<div class="m-aviso"><p>${esc(estado.erro)}</p><button type="button" class="m-btn m-btn--pronta" data-recarregar>Tentar de novo</button></div>`
            : '<p class="m-aviso">Carregando suas missões...</p>');
        atualizarPonto();
        return;
    }

    const prox = resumoProximaMissao(d);
    const historico = d.historico || [];
    const visiveis = historico.slice(0, estado.historicoVisivel);
    const resta = historico.length - visiveis.length;

    raiz.innerHTML = `${cabecalho(d.valorMinimoPlano)}
        <section class="m-resumo">
            <div class="m-contador"><span>Indicados ativos</span><strong>${d.indicadosAtivos}</strong><small>de ${d.totalIndicados} indicado${d.totalIndicados === 1 ? '' : 's'}</small></div>
            <div class="m-proxima"><p>${esc(prox.texto)}</p><div class="m-barra m-barra--grande"><span style="width:${prox.pct.toFixed(1)}%"></span></div></div>
        </section>
        <ol class="m-linha">
            ${d.missoes.map((m, i) => cartaoMissao(m, i, d.missoes, d.indicadosAtivos)).join('') || '<li class="m-aviso">Nenhuma missão disponível no momento.</li>'}
        </ol>
        <p class="m-regra">Cada indicado conta uma única vez. A recompensa é creditada no seu saldo de comissão.</p>
        <section class="m-hist">
            <h3>Histórico de recompensas</h3>
            ${visiveis.length
                ? `<ul>${visiveis.map((h) => `<li><span><b>${esc(h.meta)} indicados ativos</b><small>${esc(dataHora(h.data))}</small></span><strong>${brl(h.recompensa)}</strong></li>`).join('')}</ul>`
                : '<p class="m-vazio">Você ainda não coletou nenhuma recompensa.</p>'}
            ${resta > 0 ? `<button type="button" class="m-mais" data-mais-historico>Mostrar mais (${resta} restantes)</button>` : ''}
        </section>`;
    atualizarPonto();
}

function cabecalho(valorMinimo) {
    return `<header class="m-cab">
        <img class="m-brasao" src="missoes-brasao.png" alt="" width="150" height="120">
        <h2 class="m-titulo"><span class="m-t1">MISSÕES DE</span><span class="m-t2">INDICAÇÃO</span></h2>
        <p class="m-pill"><span class="m-estrela" aria-hidden="true">✦</span>Só contam planos ativos a partir de ${brl(valorMinimo)}</p>
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
