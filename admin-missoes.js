/* ==========================================================================
   Painel Admin — Missões de indicação
   Abas internas: Visão geral · Progresso · Recompensas · Conferência · Configurar
   Só lê dados e mostra. Alterar metas/recompensas passa pelo worker
   (salvarConfig), que valida tudo de novo no servidor.
   ========================================================================== */
import { normalizarTexto, paraCentavos } from './rede-calculos.js';
import {
    normalizarMissoes, MISSOES_PADRAO, MAX_MISSOES, VALOR_MINIMO_PLANO,
    mapaPlanosValidos, calcularIndicados, estadoMissoes, resumoGeral,
    listarColetas, conferirCreditos, validarConfig,
} from './missoes-calculos.js';

const PASSO = 20;
const PASSO_INTERNO = 10;
const LIMITE_CONFERENCIA_EXTRATO = 300;
const SUBABAS = ['geral', 'progresso', 'recompensas', 'conferencia', 'configurar'];

const fmtMoeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDataHora = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const brl = (c) => fmtMoeda.format((c || 0) / 100);
const reais = (v) => fmtMoeda.format(Number(v) || 0);
const dataHora = (ms) => (ms === null || ms === undefined ? '—' : fmtDataHora.format(ms));
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (id) => document.getElementById(id);

const ui = {
    visivel: false,
    sub: 'geral',
    busca: '',
    filtro: 'todos',          // Progresso: todos | disponivel | coletaram | Recompensas: id da missão ou 'todas'
    modoRec: 'coletaram',     // coletaram | disponiveis
    limites: new Map(),
    abertos: new Set(),
    draft: null,              // linhas do formulário de configuração
    mensagemCfg: null,
    salvando: false,
    extrato: null,            // { rodando, feitos, total, problemas, concluido }
};

let deps = null;
let iniciado = false;
let timer = null;
const cache = { usuarios: undefined, planos: undefined, indicados: null };

/* ==========================================================================
   Entrada
   ========================================================================== */
export function iniciarMissoesAdmin(dependencias) {
    deps = dependencias;
    if (iniciado) return;
    const conteudo = $('missoes-adm');
    const abas = $('missoesAdmTabs');
    if (!conteudo || !abas) return;
    iniciado = true;

    document.addEventListener('admin-aba', (e) => {
        ui.visivel = e.detail === 'missoes';
        if (ui.visivel) renderizar();
    });

    abas.addEventListener('click', (e) => {
        const b = e.target.closest('[data-sub]');
        if (!b) return;
        ui.sub = b.dataset.sub;
        ui.busca = ''; ui.filtro = ui.sub === 'recompensas' ? 'todas' : 'todos';
        const campo = $('missoesAdmBusca'); if (campo) campo.value = '';
        ui.limites.clear();
        renderizar();
    });

    let tBusca = null;
    $('missoesAdmBusca')?.addEventListener('input', (e) => {
        clearTimeout(tBusca);
        tBusca = setTimeout(() => { ui.busca = e.target.value.trim(); ui.limites.clear(); renderizar(); }, 180);
    });
    $('missoesAdmFiltro')?.addEventListener('change', (e) => { ui.filtro = e.target.value; ui.limites.clear(); renderizar(); });

    conteudo.addEventListener('click', aoClicar);
    conteudo.addEventListener('input', aoDigitar);
    conteudo.addEventListener('change', aoDigitar);
    conteudo.addEventListener('toggle', (e) => {
        const chave = e.target?.dataset?.chave;
        if (!chave) return;
        const ja = ui.abertos.has(chave);
        if (e.target.open && !ja) { ui.abertos.add(chave); renderizar(); }
        else if (!e.target.open && ja) { ui.abertos.delete(chave); }
    }, true);
}

export function atualizarMissoesAdmin() {
    if (!iniciado || !ui.visivel) return;
    clearTimeout(timer);
    timer = setTimeout(renderizar, 200);
}

/* ==========================================================================
   Contexto (cálculos compartilhados pelas abas)
   ========================================================================== */
function contexto() {
    const e = deps.obterEstado();
    if (e.usuarios === null || e.planos === null || e.missoesColetas === null) return { carregando: true, erro: e.missoesErro };
    if (e.usuarios !== cache.usuarios || e.planos !== cache.planos) {
        cache.usuarios = e.usuarios; cache.planos = e.planos;
        cache.indicados = calcularIndicados(e.usuarios, mapaPlanosValidos(e.planos));
    }
    const usuarios = e.usuarios || {};
    const coletas = e.missoesColetas || {};
    const missoes = normalizarMissoes(e.missoesConfig);
    const resumo = resumoGeral(missoes, usuarios, cache.indicados, coletas);
    return { e, usuarios, coletas, missoes, indicados: cache.indicados, resumo, financeiro: e.financeiro || {} };
}

const nomeDe = (ctx, uid) => {
    const u = ctx.usuarios[uid];
    return u ? (String(u.nome || '').trim() || String(u.email || '').trim() || uid) : '(conta removida)';
};
const idDe = (ctx, uid) => {
    const u = ctx.usuarios[uid];
    return (u && u.codigoIndicacao) || uid.slice(0, 8);
};
const textoBusca = (ctx, uid) => {
    const u = ctx.usuarios[uid] || {};
    return normalizarTexto(`${u.nome || ''} ${u.email || ''} ${uid} ${u.codigoIndicacao || ''}`);
};
const casaBusca = (ctx, uid) => !ui.busca || textoBusca(ctx, uid).includes(normalizarTexto(ui.busca));

/* ==========================================================================
   Helpers de HTML (mesmas classes visuais da aba Rede)
   ========================================================================== */
const stat = (rotulo, valor, classe = '') => `<span class="rede-stat ${classe}"><em>${esc(rotulo)}</em><b>${valor}</b></span>`;
const cartao = (rotulo, valor, classe = '') => `<div class="stat-card ${classe}"><h3>${esc(rotulo)}</h3><p>${valor}</p></div>`;
const cartoes = (lista) => `<div class="rede-cards">${lista.join('')}</div>`;
const chip = (estado) => `<span class="madm-chip madm-chip--${esc(estado)}">${{ bloqueada: 'Bloqueada', disponivel: 'Disponível', processando: 'Processando', coletada: 'Coletada' }[estado] || esc(estado)}</span>`;

function identificacao(ctx, uid) {
    return `<div class="rede-item__main"><span class="rede-item__nome">${esc(nomeDe(ctx, uid))}</span>
        <div class="rede-item__sub">${esc((ctx.usuarios[uid] && ctx.usuarios[uid].email) || 'sem e-mail')} · ID ${esc(idDe(ctx, uid))}</div></div>`;
}

function paginar(chave, itens, vazio, passo = PASSO) {
    if (!itens.length) return `<p class="rede-vazio">${esc(vazio)}</p>`;
    const lim = ui.limites.get(chave) || passo;
    const resto = itens.length - lim;
    const contagem = itens.length > passo ? `<p class="rede-contagem">Mostrando ${Math.min(lim, itens.length)} de ${itens.length}</p>` : '';
    const mais = resto > 0 ? `<button type="button" class="rede-mais ${passo === PASSO_INTERNO ? 'rede-mais--pequeno' : ''}" data-acao="mais" data-chave="${esc(chave)}" data-passo="${passo}">Mostrar mais (${Math.min(passo, resto)} de ${resto} restantes)</button>` : '';
    return `${contagem}<div class="rede-lista">${itens.slice(0, lim).join('')}</div>${mais}`;
}

/* ==========================================================================
   Renderização
   ========================================================================== */
function ajustarFiltros(ctx) {
    const comBusca = ui.sub === 'progresso' || ui.sub === 'recompensas';
    $('missoesAdmFiltros').hidden = !comBusca;
    document.querySelectorAll('#missoesAdmTabs [data-sub]').forEach((b) => {
        const ativa = b.dataset.sub === ui.sub;
        b.classList.toggle('ativa', ativa);
        b.setAttribute('aria-selected', ativa ? 'true' : 'false');
    });
    if (!comBusca) return;
    const sel = $('missoesAdmFiltro');
    const opcoes = ui.sub === 'progresso'
        ? [['todos', 'Todos os usuários'], ['disponivel', 'Com recompensa disponível'], ['coletaram', 'Já coletaram alguma']]
        : [['todas', 'Todas as missões'], ...((ctx && ctx.missoes) || []).map((m) => [m.id, `Missão de ${m.meta} indicados`])];
    const assinatura = JSON.stringify(opcoes);
    if (sel.dataset.assinatura !== assinatura) {
        sel.innerHTML = opcoes.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('');
        sel.dataset.assinatura = assinatura;
    }
    sel.value = opcoes.some(([v]) => v === ui.filtro) ? ui.filtro : opcoes[0][0];
    ui.filtro = sel.value;
}

function renderizar() {
    if (!iniciado || !ui.visivel) return;
    const alvo = $('missoes-adm');
    const ctx = contexto();
    ajustarFiltros(ctx.carregando ? null : ctx);

    if (ctx.carregando) {
        alvo.innerHTML = ctx.erro
            ? `<div class="rede-aviso" open><p style="padding:12px 14px">Não foi possível ler os dados de missões: ${esc(ctx.erro)}. Confira se as novas rules (<code>missoesConfig</code> e <code>missoesColetas</code>) foram publicadas no Firebase.</p></div>`
            : '<p class="rede-vazio">Carregando dados...</p>';
        return;
    }
    const aviso = ctx.e.missoesErro
        ? `<div class="rede-aviso"><p style="padding:10px 14px">Atenção: ${esc(ctx.e.missoesErro)}</p></div>` : '';
    const corpo = {
        geral: renderGeral, progresso: renderProgresso, recompensas: renderRecompensas,
        conferencia: renderConferencia, configurar: renderConfigurar,
    }[ui.sub](ctx);
    alvo.innerHTML = aviso + corpo;
}

/* ---------- Visão geral ---------- */
function renderGeral(ctx) {
    const { resumo, missoes } = ctx;
    const g = resumo.geral;
    const linhas = [...resumo.porMissao.values()].map((l) => `<div class="rede-item rede-item--coluna">
        <div class="rede-item--linha">
            <div class="rede-item__main"><span class="rede-item__nome">${l.missao.meta} indicados ativos</span>
                <div class="rede-item__sub">Recompensa ${reais(l.missao.recompensa)}</div></div>
            <div class="rede-stats">
                ${stat('Atingiram', l.atingiram)}${stat('Coletaram', l.coletaram)}
                ${stat('Disponíveis', l.disponiveis, l.disponiveis ? 'rede-stat--aviso' : '')}
                ${stat('Creditado', brl(l.valorPago), 'rede-stat--destaque')}
            </div></div>
        ${l.disponiveis ? `<div class="rede-nota" style="margin:8px 0 0">A coletar: ${brl(l.valorDisponivel)}</div>` : ''}</div>`);
    return cartoes([
        cartao('Missões ativas', missoes.length),
        cartao('Usuários com indicado ativo', g.usuariosComAtivos),
        cartao('Disponíveis para coletar', `${g.disponiveis} <small>(${brl(g.valorDisponivel)})</small>`),
        cartao('Coletadas e creditadas', `${g.coletaram} <small>(${brl(g.valorPago)})</small>`),
    ])
        + `<p class="rede-nota">Só conta quem tem plano ativo de ${reais(VALOR_MINIMO_PLANO)} ou mais, indicado diretamente, uma vez por pessoa. A coleta credita no saldo de comissão no mesmo instante, então "coletada" e "paga" são a mesma coisa.</p>`
        + (linhas.length ? `<div class="rede-lista">${linhas.join('')}</div>` : '<p class="rede-vazio">Nenhuma missão ativa. Crie na aba Configurar.</p>');
}

/* ---------- Progresso por usuário ---------- */
function renderProgresso(ctx) {
    const { missoes, indicados, coletas } = ctx;
    let uids = Object.keys(ctx.usuarios);
    if (!ui.busca) uids = uids.filter((u) => (indicados.get(u) || { diretos: [] }).diretos.length > 0);
    uids = uids.filter((u) => casaBusca(ctx, u));

    const linhas = uids.map((uid) => {
        const ind = indicados.get(uid) || { diretos: [], ativos: [] };
        const estados = estadoMissoes(missoes, ind.ativos.length, coletas[uid]);
        return { uid, ind, estados, temPronta: estados.some((s) => s.estado === 'disponivel'), coletou: Object.values(coletas[uid] || {}).some((c) => c && c.status === 'coletada') };
    }).filter((l) => ui.filtro === 'todos' || (ui.filtro === 'disponivel' ? l.temPronta : l.coletou))
        .sort((a, b) => b.ind.ativos.length - a.ind.ativos.length || b.ind.diretos.length - a.ind.diretos.length);

    const itens = linhas.map((l) => {
        const proxima = l.estados.find((s) => s.estado !== 'coletada');
        const pct = proxima ? Math.min(100, (l.ind.ativos.length / proxima.meta) * 100) : 100;
        const resumoLinha = stat('Ativos', l.ind.ativos.length, 'rede-stat--destaque')
            + stat('Indicados', l.ind.diretos.length)
            + stat('Próxima', proxima ? `${Math.min(l.ind.ativos.length, proxima.meta)}/${proxima.meta}` : 'Concluiu tudo')
            + (l.temPronta ? stat('Situação', chip('disponivel')) : '');
        const chave = 'prog-' + l.uid;
        const aberto = ui.abertos.has(chave);
        return `<details class="rede-expansivel" data-chave="${esc(chave)}" ${aberto ? 'open' : ''}>
            <summary><div class="rede-item rede-item--summary">${identificacao(ctx, l.uid)}<div class="rede-stats">${resumoLinha}</div></div></summary>
            ${aberto ? detalheUsuario(ctx, l) : ''}
            <div class="rede-barra" style="margin:0 16px 14px"><span style="width:${pct.toFixed(1)}%"></span></div>
        </details>`;
    });
    return `<p class="rede-nota">${ui.busca ? 'Resultado da busca.' : 'Usuários que já indicaram alguém.'} Abra um usuário para ver as missões, os indicados com plano válido e o histórico.</p>`
        + paginar('progresso', itens, ui.busca ? 'Ninguém encontrado.' : 'Nenhum usuário nesse filtro.');
}

function detalheUsuario(ctx, l) {
    const { uid, ind, estados } = l;
    const missoesHtml = estados.length ? `<ul class="rede-sublista">${estados.map((s, i) => `<li>
            <span>Missão ${i + 1} · ${s.meta} indicados · ${reais(s.recompensa)}</span>
            <span>${chip(s.estado)} <small>${s.coleta && s.coleta.status === 'coletada' ? dataHora(Date.parse(s.coleta.data)) : `${s.progresso}/${s.meta}`}</small></span></li>`).join('')}</ul>`
        : '<p class="rede-vazio">Sem missões ativas.</p>';

    const validos = ind.ativos.slice().sort((a, b) => b.valor - a.valor);
    const limV = ui.limites.get('i-val-' + uid) || PASSO_INTERNO;
    const maisV = validos.length > limV ? `<button type="button" class="rede-mais rede-mais--pequeno" data-acao="mais" data-chave="${esc('i-val-' + uid)}" data-passo="${PASSO_INTERNO}">Mostrar mais (${validos.length - limV} restantes)</button>` : '';
    const validosHtml = validos.length
        ? `<ul class="rede-sublista">${validos.slice(0, limV).map((v) => `<li><span>${esc(nomeDe(ctx, v.uid))} <small>ID ${esc(idDe(ctx, v.uid))}</small></span><b>${reais(v.valor)}</b></li>`).join('')}</ul>${maisV}`
        : '<p class="rede-vazio">Nenhum indicado com plano ativo de R$ 50,00 ou mais.</p>';

    const hist = Object.entries(ctx.coletas[uid] || {}).filter(([, c]) => c && c.status === 'coletada')
        .map(([id, c]) => ({ id, meta: c.meta, cent: paraCentavos(c.recompensa), ms: Date.parse(c.data) }))
        .sort((a, b) => (b.ms || 0) - (a.ms || 0));
    const histHtml = hist.length
        ? `<ul class="rede-sublista">${hist.map((h) => `<li><span>${h.meta} indicados ativos</span><span><b>${brl(h.cent)}</b> <small>${dataHora(h.ms)}</small></span></li>`).join('')}</ul>`
        : '<p class="rede-vazio">Ainda não coletou nenhuma recompensa.</p>';

    return `<div class="madm-detalhe">
        <h4>Progresso das missões</h4>${missoesHtml}
        <h4>Indicados com plano válido (${validos.length} de ${ind.diretos.length})</h4>${validosHtml}
        <h4>Histórico de recompensas</h4>${histHtml}</div>`;
}

/* ---------- Recompensas ---------- */
function renderRecompensas(ctx) {
    const { resumo } = ctx;
    const g = resumo.geral;
    const modos = `<div class="rede-segmento" role="group" aria-label="Visualização">
        <button type="button" class="${ui.modoRec === 'coletaram' ? 'ativa' : ''}" data-acao="modo" data-modo="coletaram">Quem coletou</button>
        <button type="button" class="${ui.modoRec === 'disponiveis' ? 'ativa' : ''}" data-acao="modo" data-modo="disponiveis">Disponíveis agora</button></div>`;
    const topo = cartoes([
        cartao('Coletadas', g.coletaram), cartao('Total creditado', brl(g.valorPago)),
        cartao('Disponíveis agora', g.disponiveis), cartao('Valor a coletar', brl(g.valorDisponivel)),
    ]);
    const filtroMissao = (id) => ui.filtro === 'todas' || ui.filtro === id;

    if (ui.modoRec === 'coletaram') {
        const lista = listarColetas(ctx.coletas).filter((c) => filtroMissao(c.missaoId) && casaBusca(ctx, c.uid));
        const total = lista.reduce((s, c) => s + c.cent, 0);
        const itens = lista.map((c) => `<div class="rede-item">${identificacao(ctx, c.uid)}<div class="rede-stats">
            ${stat('Missão', `${esc(c.meta)} indicados`)}${stat('Valor', brl(c.cent), 'rede-stat--destaque')}${stat('Data', dataHora(c.ms))}
            ${c.indicadosAtivos !== null ? stat('Ativos na coleta', c.indicadosAtivos) : ''}</div></div>`);
        return topo + modos + `<p class="rede-nota">${lista.length} coleta(s) · ${brl(total)} creditados${ui.busca || ui.filtro !== 'todas' ? ' (filtrado)' : ''}.</p>`
            + paginar('rec-coletaram', itens, 'Nenhuma recompensa coletada com esse filtro.');
    }

    // disponíveis agora: por usuário
    const porUsuario = new Map();
    for (const l of resumo.porMissao.values()) {
        if (!filtroMissao(l.missao.id)) continue;
        for (const uid of l.listaDisponiveis) {
            const e = porUsuario.get(uid) || porUsuario.set(uid, { metas: [], cent: 0 }).get(uid);
            e.metas.push(l.missao.meta); e.cent += paraCentavos(l.missao.recompensa);
        }
    }
    const itens = [...porUsuario.entries()].filter(([uid]) => casaBusca(ctx, uid)).sort((a, b) => b[1].cent - a[1].cent)
        .map(([uid, e]) => `<div class="rede-item">${identificacao(ctx, uid)}<div class="rede-stats">
            ${stat('Missões', e.metas.sort((x, y) => x - y).join(', '))}${stat('A coletar', brl(e.cent), 'rede-stat--aviso')}</div></div>`);
    return topo + modos + '<p class="rede-nota">Usuários que já cumpriram a meta e ainda não clicaram em coletar.</p>'
        + paginar('rec-disponiveis', itens, 'Ninguém com recompensa pendente de coleta.');
}

/* ---------- Conferência ---------- */
function renderConferencia(ctx) {
    const cf = conferirCreditos(ctx.coletas, ctx.financeiro);
    const ex = ui.extrato;
    const cards = cartoes([
        cartao('Registrado nas coletas', brl(cf.totalRegistrado)),
        cartao('Creditado (bônus de missões)', brl(cf.totalCreditado)),
        cartao('Situação', cf.conferido ? '<span class="rede-ok">✓ Confere</span>' : `<span class="rede-erro">${cf.divergencias.length} divergência(s)</span>`),
        cartao('Coletas travadas', cf.processando.filter((p) => p.preso).length, cf.processando.some((p) => p.preso) ? 'rede-card--alerta' : ''),
    ]);
    const diverg = cf.divergencias.length
        ? `<h3 class="rede-titulo">Divergências</h3><div class="rede-lista">${cf.divergencias.map((d) => `<div class="rede-item">${identificacao(ctx, d.uid)}<div class="rede-stats">
            ${stat('Registrado', brl(d.registrado))}${stat('Creditado', brl(d.creditado))}${stat('Diferença', brl(d.diferenca), 'rede-stat--aviso')}</div></div>`).join('')}</div>`
        : '<p class="rede-vazio">O total registrado em cada coleta bate com o bônus creditado de cada usuário.</p>';
    const proc = cf.processando.length
        ? `<h3 class="rede-titulo">Coletas em processamento</h3><div class="rede-lista">${cf.processando.map((p) => `<div class="rede-item">${identificacao(ctx, p.uid)}<div class="rede-stats">
            ${stat('Missão', esc(p.missaoId))}${stat('Iniciada', dataHora(p.iniciadoEm))}${stat('Situação', p.preso ? '<span class="rede-erro">Travada (mais de 10 min)</span>' : 'Normal')}</div></div>`).join('')}</div>
            <p class="rede-nota">Uma coleta travada nada credita. Se o usuário clicar de novo depois de 10 minutos, o servidor a retoma sozinho.</p>` : '';

    let blocoExtrato = `<h3 class="rede-titulo">Lançamentos no extrato</h3>
        <p class="rede-nota">Confere, uma a uma, se cada coleta tem o lançamento correspondente no extrato do usuário, com o mesmo valor (até as ${LIMITE_CONFERENCIA_EXTRATO} mais recentes).</p>`;
    if (ex && ex.rodando) blocoExtrato += `<p class="rede-nota">Conferindo... ${ex.feitos} de ${ex.total}</p>`;
    else {
        blocoExtrato += `<button type="button" class="rede-mais" data-acao="conferir-extrato">${ex ? 'Conferir de novo' : 'Conferir lançamentos no extrato'}</button>`;
        if (ex && ex.concluido) {
            blocoExtrato += ex.problemas.length
                ? `<div class="rede-lista" style="margin-top:12px">${ex.problemas.map((p) => `<div class="rede-item">${identificacao(ctx, p.uid)}<div class="rede-stats">
                    ${stat('Missão', `${esc(p.meta)} indicados`)}${stat('Esperado', brl(p.cent))}${stat('Problema', `<span class="rede-erro">${esc(p.motivo)}</span>`)}</div></div>`).join('')}</div>`
                : `<p class="rede-nota" style="margin-top:12px"><span class="rede-ok">✓</span> ${ex.total} coleta(s) conferidas: todas têm o lançamento certo no extrato.</p>`;
        }
    }
    return cards + diverg + proc + blocoExtrato;
}

async function conferirExtrato() {
    const ctx = contexto();
    if (ctx.carregando) return;
    const lista = listarColetas(ctx.coletas).slice(0, LIMITE_CONFERENCIA_EXTRATO);
    ui.extrato = { rodando: true, feitos: 0, total: lista.length, problemas: [], concluido: false };
    renderizar();
    let i = 0;
    const trabalhador = async () => {
        while (i < lista.length) {
            const c = lista[i++];
            let motivo = null;
            try {
                if (!c.extratoId) motivo = 'sem lançamento';
                else {
                    const lanc = await deps.lerExtrato(c.uid, c.extratoId);
                    if (!lanc) motivo = 'lançamento ausente';
                    else if (paraCentavos(lanc.valor) !== c.cent) motivo = `valor diferente (${brl(paraCentavos(lanc.valor))})`;
                }
            } catch (erro) { motivo = 'erro ao ler'; }
            if (motivo) ui.extrato.problemas.push({ ...c, motivo });
            ui.extrato.feitos++;
        }
    };
    await Promise.all(Array.from({ length: 6 }, trabalhador));
    ui.extrato.rodando = false; ui.extrato.concluido = true;
    renderizar();
}

/* ---------- Configurar ---------- */
function rascunhoInicial(ctx) {
    return normalizarMissoes(ctx.e.missoesConfig, true).map((m) => ({ id: m.id, meta: m.meta, recompensa: m.recompensa, ativa: m.ativa }));
}

function renderConfigurar(ctx) {
    if (!ui.draft) ui.draft = rascunhoInicial(ctx);
    const linhas = ui.draft.map((l, i) => `<div class="madm-cfg-linha" data-idx="${i}">
        <span class="madm-cfg-num">${i + 1}</span>
        <label>Meta (indicados ativos)<input type="number" class="rede-input" data-campo="meta" min="1" step="1" inputmode="numeric" value="${esc(l.meta)}"></label>
        <label>Recompensa (R$)<input type="number" class="rede-input" data-campo="recompensa" min="0.01" step="0.01" inputmode="decimal" value="${esc(l.recompensa)}"></label>
        <label class="madm-cfg-ativa"><input type="checkbox" data-campo="ativa" ${l.ativa ? 'checked' : ''}> Ativa</label>
        <button type="button" class="madm-cfg-x" data-acao="cfg-remover" data-idx="${i}" aria-label="Remover missão ${i + 1}">×</button></div>`).join('');
    return `<p class="rede-nota">Altere metas e valores das recompensas. Quem já coletou uma missão continua com o valor da época e não coleta de novo; missão desativada some para os usuários. A regra de ${reais(VALOR_MINIMO_PLANO)} por plano é fixa no servidor.</p>
        <div class="madm-cfg">${linhas}</div>
        <div class="madm-cfg-acoes">
            <button type="button" class="rede-mais" data-acao="cfg-adicionar" ${ui.draft.length >= MAX_MISSOES ? 'disabled' : ''}>+ Adicionar missão</button>
            <button type="button" class="rede-mais" data-acao="cfg-padrao">Restaurar padrão</button>
            <button type="button" class="btn madm-cfg-salvar" data-acao="cfg-salvar" ${ui.salvando ? 'disabled' : ''}>${ui.salvando ? 'Salvando...' : 'Salvar missões'}</button></div>
        ${ui.mensagemCfg ? `<p class="rede-nota ${ui.mensagemCfg.erro ? 'rede-erro' : 'rede-ok'}">${esc(ui.mensagemCfg.texto)}</p>` : ''}`;
}

/* ==========================================================================
   Eventos
   ========================================================================== */
function aoDigitar(e) {
    const campo = e.target.closest('[data-campo]');
    if (!campo || !ui.draft) return;
    const linha = campo.closest('[data-idx]');
    const l = ui.draft[Number(linha.dataset.idx)];
    if (!l) return;
    const nome = campo.dataset.campo;
    l[nome] = nome === 'ativa' ? campo.checked : campo.value;
    ui.mensagemCfg = null;
}

async function aoClicar(e) {
    const el = e.target.closest('[data-acao]');
    if (!el) return;
    const { acao, chave, modo, idx, passo } = el.dataset;
    if (acao === 'mais') { ui.limites.set(chave, (ui.limites.get(chave) || Number(passo)) + Number(passo)); renderizar(); }
    else if (acao === 'modo') { ui.modoRec = modo; ui.limites.clear(); renderizar(); }
    else if (acao === 'conferir-extrato') conferirExtrato();
    else if (acao === 'cfg-adicionar') {
        const maior = Math.max(0, ...ui.draft.map((l) => Number(l.meta) || 0));
        ui.draft.push({ id: null, meta: maior * 2 || 5, recompensa: '', ativa: true }); ui.mensagemCfg = null; renderizar();
    }
    else if (acao === 'cfg-remover') { ui.draft.splice(Number(idx), 1); ui.mensagemCfg = null; renderizar(); }
    else if (acao === 'cfg-padrao') { ui.draft = MISSOES_PADRAO.map((m) => ({ ...m })); ui.mensagemCfg = null; renderizar(); }
    else if (acao === 'cfg-salvar') salvar();
}

async function salvar() {
    if (ui.salvando || !ui.draft) return;
    const linhas = ui.draft.map((l) => ({ id: l.id, meta: Number(l.meta), recompensa: Number(l.recompensa), ativa: l.ativa !== false }));
    const erro = validarConfig(linhas);
    if (erro) { ui.mensagemCfg = { erro: true, texto: erro }; renderizar(); return; }

    const confirmado = await deps.confirmar({
        titulo: 'Salvar missões',
        detalhes: [
            { rotulo: 'Missões', valor: `${linhas.length} (${linhas.filter((l) => l.ativa).length} ativas)` },
            { rotulo: 'Metas', valor: linhas.slice().sort((a, b) => a.meta - b.meta).map((l) => `${l.meta}→${reais(l.recompensa)}`).join(' · ') },
        ],
        textoConfirmar: 'Salvar',
    });
    if (!confirmado) return;

    ui.salvando = true; ui.mensagemCfg = null; renderizar();
    try {
        await deps.salvarConfig(linhas);
        ui.draft = null;
        ui.mensagemCfg = { erro: false, texto: 'Missões salvas. Os usuários já veem os novos valores.' };
    } catch (e) {
        ui.mensagemCfg = { erro: true, texto: e.message || 'Erro ao salvar.' };
    } finally {
        ui.salvando = false; renderizar();
    }
}
