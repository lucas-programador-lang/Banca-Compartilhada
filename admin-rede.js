/* ==========================================================================
   Painel Admin — Rede de indicações (abas, busca e filtro de período)
   Usa os mesmos dados que o admin.js já carrega (usuarios, financeiro,
   depositos). Não cria listeners novos no Firebase.
   ========================================================================== */
import {
    construirRede, niveis, cadeiaDeIndicadores, buscar,
    agregarDepositos, recargasDoUsuario, agregarArvore, caixaPorEquipe, calcularComissoes,
    dentroDoPeriodo, PERIODO_TUDO, COMISSAO_PERCENTUAL,
} from './rede-calculos.js';

const PASSO = 20;           // itens por "Mostrar mais"
const PASSO_INTERNO = 10;   // listas dentro de um item expandido
const ABAS_REDE = ['indicacoes', 'equipe', 'recargas', 'caixa', 'comissoes', 'perfil'];

const formatadorMoeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const formatadorData = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const formatadorDataHora = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const brl = (centavos) => formatadorMoeda.format((centavos || 0) / 100);
const dia = (ms) => (ms === null || ms === undefined ? '—' : formatadorData.format(ms));
const diaHora = (ms) => (ms === null || ms === undefined ? '—' : formatadorDataHora.format(ms));
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (id) => document.getElementById(id);

const ui = {
    aba: 'painel',
    busca: '',
    periodo: 'tudo',
    de: '',
    ate: '',
    selecionado: null,
    modoIndicacoes: 'quem',
    limites: new Map(),
    abertos: new Set(),
    fechados: new Set(),
};

let obterEstado = null;
let iniciado = false;
let timer = null;
const cache = { usuarios: undefined, rede: null };

/* ==========================================================================
   Entrada
   ========================================================================== */
export function iniciarRede(funcaoEstado) {
    obterEstado = funcaoEstado;
    if (iniciado) return;
    const nav = $('adminTabs');
    const paineis = $('redePaineis');
    if (!nav || !paineis) return;
    iniciado = true;

    nav.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-aba]');
        if (btn) definirAba(btn.dataset.aba);
    });

    let tBusca = null;
    $('redeBusca')?.addEventListener('input', (e) => {
        clearTimeout(tBusca);
        tBusca = setTimeout(() => { ui.busca = e.target.value.trim(); ui.limites.clear(); renderizar(); }, 180);
    });
    $('redePeriodo')?.addEventListener('change', (e) => {
        ui.periodo = e.target.value;
        $('redeDatas').hidden = ui.periodo !== 'custom';
        ui.limites.clear();
        renderizar();
    });
    ['redeDe', 'redeAte'].forEach((id) => $(id)?.addEventListener('change', (e) => {
        ui[id === 'redeDe' ? 'de' : 'ate'] = e.target.value;
        ui.limites.clear();
        renderizar();
    }));

    // Cliques dentro das abas e do chip "selecionado" (delegação)
    const aoClicar = (e) => {
        const el = e.target.closest('[data-acao]');
        if (!el) return;
        const { acao, uid, chave, modo } = el.dataset;
        if (acao === 'perfil') { ui.selecionado = uid; ui.busca = ''; limparCampoBusca(); definirAba('perfil'); }
        else if (acao === 'selecionar') { ui.selecionado = uid; ui.busca = ''; limparCampoBusca(); renderizar(); }
        else if (acao === 'limpar-selecao') { ui.selecionado = null; renderizar(); }
        else if (acao === 'mais') { ui.limites.set(chave, (ui.limites.get(chave) || (chave.startsWith('i-') ? PASSO_INTERNO : PASSO)) + (chave.startsWith('i-') ? PASSO_INTERNO : PASSO)); renderizar(); }
        else if (acao === 'modo') { ui.modoIndicacoes = modo; ui.limites.clear(); renderizar(); }
        else if (acao === 'limpar-busca') { ui.busca = ''; limparCampoBusca(); renderizar(); }
    };
    paineis.addEventListener('click', aoClicar);
    $('redeSelecionado')?.addEventListener('click', aoClicar);

    // lembra quais <details> ficaram abertos (o evento "toggle" não borbulha)
    paineis.addEventListener('toggle', (e) => {
        const chave = e.target?.dataset?.chave;
        if (!chave) return;
        if (e.target.open) { ui.abertos.add(chave); ui.fechados.delete(chave); }
        else { ui.abertos.delete(chave); ui.fechados.add(chave); }
    }, true);
}

/* Chamado pelo admin.js sempre que algum dado do Firebase muda */
export function atualizarRede() {
    if (!iniciado || !ABAS_REDE.includes(ui.aba)) return;
    clearTimeout(timer);
    timer = setTimeout(renderizar, 200);
}

function limparCampoBusca() {
    const c = $('redeBusca');
    if (c) c.value = '';
}

function definirAba(aba) {
    ui.aba = aba;
    document.querySelectorAll('#adminTabs [data-aba]').forEach((b) => {
        const ativa = b.dataset.aba === aba;
        b.classList.toggle('ativa', ativa);
        b.setAttribute('aria-selected', ativa ? 'true' : 'false');
    });
    document.querySelectorAll('[data-painel]').forEach((p) => { p.hidden = p.dataset.painel !== aba; });
    $('redeFiltros').hidden = aba === 'painel';
    if (aba !== 'painel') renderizar();
}

/* ==========================================================================
   Período
   ========================================================================== */
function lerPeriodo() {
    const agora = new Date();
    const inicioDoDia = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const fimDoDia = (d) => inicioDoDia(d) + 86400000 - 1;
    switch (ui.periodo) {
        case 'hoje': return { tudo: false, inicio: inicioDoDia(agora), fim: fimDoDia(agora) };
        case '7d': return { tudo: false, inicio: inicioDoDia(agora) - 6 * 86400000, fim: fimDoDia(agora) };
        case '30d': return { tudo: false, inicio: inicioDoDia(agora) - 29 * 86400000, fim: fimDoDia(agora) };
        case 'mes': return { tudo: false, inicio: new Date(agora.getFullYear(), agora.getMonth(), 1).getTime(), fim: fimDoDia(agora) };
        case 'custom': {
            const ini = ui.de ? new Date(ui.de + 'T00:00:00').getTime() : null;
            const fim = ui.ate ? new Date(ui.ate + 'T23:59:59.999').getTime() : null;
            if (ini === null && fim === null) return PERIODO_TUDO;
            return { tudo: false, inicio: ini, fim };
        }
        default: return PERIODO_TUDO;
    }
}

function textoPeriodo(p) {
    if (p.tudo) return 'Todo o período';
    if (p.inicio !== null && p.fim !== null) return `${dia(p.inicio)} a ${dia(p.fim)}`;
    if (p.inicio !== null) return `A partir de ${dia(p.inicio)}`;
    return `Até ${dia(p.fim)}`;
}

/* ==========================================================================
   Renderização
   ========================================================================== */
function montarContexto(e) {
    if (e.usuarios !== cache.usuarios) {
        cache.usuarios = e.usuarios;
        cache.rede = construirRede(e.usuarios || {});
    }
    const rede = cache.rede;
    const periodo = lerPeriodo();
    const dep = agregarDepositos(e.depositos || {}, periodo, rede.por);
    const depTodos = periodo.tudo ? dep : agregarDepositos(e.depositos || {}, PERIODO_TUDO, rede.por);
    const arvore = agregarArvore(rede, dep.porUsuario);
    return { rede, periodo, dep, depTodos, arvore, depositos: e.depositos || {}, financeiro: e.financeiro || {} };
}

function renderizar() {
    if (!obterEstado || !ABAS_REDE.includes(ui.aba)) return;
    const alvo = $('rede-' + ui.aba);
    if (!alvo) return;

    const e = obterEstado();
    if (e.usuarios === null || e.depositos === null) {
        alvo.innerHTML = '<p class="rede-vazio">Carregando dados...</p>';
        return;
    }

    const ctx = montarContexto(e);
    if (ui.selecionado && !ctx.rede.por.has(ui.selecionado)) ui.selecionado = null;
    atualizarChipSelecionado(ctx);

    const aviso = avisoAnomalias(ctx);
    const periodoInfo = ctx.periodo.tudo ? '' : `<p class="rede-periodo-info">Período: <strong>${esc(textoPeriodo(ctx.periodo))}</strong></p>`;
    const corpo = {
        indicacoes: renderIndicacoes,
        equipe: renderEquipe,
        recargas: renderRecargas,
        caixa: renderCaixa,
        comissoes: renderComissoes,
        perfil: renderPerfil,
    }[ui.aba](ctx);

    alvo.innerHTML = periodoInfo + corpo + aviso;
}

function atualizarChipSelecionado(ctx) {
    const chip = $('redeSelecionado');
    if (!chip) return;
    if (!ui.selecionado) { chip.hidden = true; chip.innerHTML = ''; return; }
    chip.hidden = false;
    chip.innerHTML = `<span>Selecionado: <strong>${esc(nomeDe(ctx, ui.selecionado))}</strong></span>
        <button type="button" class="rede-chip__x" data-acao="limpar-selecao" aria-label="Limpar seleção">×</button>`;
}

function avisoAnomalias(ctx) {
    const a = ctx.rede.anomalias;
    const itens = [];
    if (a.indicadorInexistente) itens.push(`${a.indicadorInexistente} usuário(s) com indicador que não existe mais`);
    if (a.autoIndicacao) itens.push(`${a.autoIndicacao} usuário(s) indicando a si mesmos`);
    if (a.usuariosEmCiclo) itens.push(`${a.usuariosEmCiclo} usuário(s) em indicação circular`);
    if (ctx.dep.semConta.confQtd + ctx.dep.semConta.pendQtd) itens.push(`${ctx.dep.semConta.confQtd + ctx.dep.semConta.pendQtd} recarga(s) de contas que não existem mais`);
    if (!itens.length) return '';
    return `<details class="rede-aviso"><summary>Dados para conferir (${itens.length})</summary>
        <ul>${itens.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
        <p>Esses casos foram ignorados nas árvores de equipe para não gerar contagem em dobro.</p></details>`;
}

/* ---------- helpers de HTML ---------- */
function nomeDe(ctx, uid) {
    const u = ctx.rede.por.get(uid);
    return u ? (u.nome || u.email || uid) : '(conta removida)';
}
function idCurto(u) { return u.codigo || u.uid.slice(0, 8); }

function stat(rotulo, valor, classe = '') {
    return `<span class="rede-stat ${classe}"><em>${esc(rotulo)}</em><b>${valor}</b></span>`;
}
function cartao(rotulo, valor, classe = '') {
    return `<div class="stat-card ${classe}"><h3>${esc(rotulo)}</h3><p>${valor}</p></div>`;
}
function cartoes(lista) { return `<div class="rede-cards">${lista.join('')}</div>`; }

function botaoUsuario(ctx, uid) {
    return `<button type="button" class="rede-link" data-acao="perfil" data-uid="${esc(uid)}">${esc(nomeDe(ctx, uid))}</button>`;
}

function principal(ctx, uid) {
    const u = ctx.rede.por.get(uid);
    return `<div class="rede-item__main">
        ${botaoUsuario(ctx, uid)}
        <div class="rede-item__sub">${esc(u.email || 'sem e-mail')} · ID ${esc(idCurto(u))}</div>
    </div>`;
}

function item(ctx, uid, stats) {
    return `<div class="rede-item">${principal(ctx, uid)}<div class="rede-stats">${stats}</div></div>`;
}

function limiteDe(chave, passo = PASSO) { return ui.limites.get(chave) || passo; }

function paginar(chave, itens, vazio, passo = PASSO) {
    if (!itens.length) return `<p class="rede-vazio">${esc(vazio)}</p>`;
    const lim = limiteDe(chave, passo);
    const resto = itens.length - lim;
    const mais = resto > 0
        ? `<button type="button" class="rede-mais" data-acao="mais" data-chave="${esc(chave)}">Mostrar mais (${Math.min(passo, resto)} de ${resto} restantes)</button>`
        : '';
    const contagem = itens.length > passo ? `<p class="rede-contagem">Mostrando ${Math.min(lim, itens.length)} de ${itens.length}</p>` : '';
    return `${contagem}<div class="rede-lista">${itens.slice(0, lim).join('')}</div>${mais}`;
}

function ordenarPorNome(ctx, uids) {
    return uids.sort((a, b) => nomeDe(ctx, a).localeCompare(nomeDe(ctx, b), 'pt-BR'));
}

/* Resultado da busca para escolher alguém (abas Equipe e Perfil) */
function seletor(ctx, titulo) {
    const achados = ui.busca ? buscar(ctx.rede, ui.busca, 8) : [];
    if (ui.busca) {
        const lista = achados.length
            ? `<div class="rede-lista">${achados.map((uid) => {
                const u = ctx.rede.por.get(uid);
                return `<button type="button" class="rede-resultado" data-acao="selecionar" data-uid="${esc(uid)}">
                    <strong>${esc(nomeDe(ctx, uid))}</strong><small>${esc(u.email || 'sem e-mail')} · ID ${esc(idCurto(u))}</small></button>`;
            }).join('')}</div>`
            : '<p class="rede-vazio">Ninguém encontrado para essa busca.</p>';
        return `<h3 class="rede-titulo">${esc(titulo)}</h3>${lista}`;
    }
    // sem busca: sugere as maiores equipes
    const maiores = [...ctx.rede.por.keys()]
        .filter((uid) => ctx.arvore.get(uid).membros > 0)
        .sort((a, b) => ctx.arvore.get(b).membros - ctx.arvore.get(a).membros)
        .slice(0, 6);
    const sugestoes = maiores.length
        ? `<h3 class="rede-titulo">Maiores equipes</h3><div class="rede-lista">${maiores.map((uid) => {
            const u = ctx.rede.por.get(uid);
            return `<button type="button" class="rede-resultado" data-acao="selecionar" data-uid="${esc(uid)}">
                <strong>${esc(nomeDe(ctx, uid))}</strong><small>${ctx.arvore.get(uid).membros} pessoa(s) na equipe · ID ${esc(idCurto(u))}</small></button>`;
        }).join('')}</div>`
        : '';
    return `<p class="rede-vazio">Digite um nome, e-mail ou ID na busca acima para escolher um usuário.</p>${sugestoes}`;
}

/* ==========================================================================
   Aba: Indicações
   ========================================================================== */
function renderIndicacoes(ctx) {
    const { rede, periodo } = ctx;
    const porIndicador = new Map();
    let comIndicador = 0;
    let indicacoesNoPeriodo = 0;
    const totalPorIndicador = new Map();

    for (const u of rede.por.values()) {
        const p = rede.pai.get(u.uid);
        if (!p) continue;
        comIndicador++;
        totalPorIndicador.set(p, (totalPorIndicador.get(p) || 0) + 1);
        if (!dentroDoPeriodo(u.cadastro, periodo)) continue;
        indicacoesNoPeriodo++;
        (porIndicador.get(p) || porIndicador.set(p, []).get(p)).push(u.uid);
    }

    const resumo = cartoes([
        cartao('Usuários cadastrados', rede.por.size),
        cartao('Foram indicados', `${comIndicador} <small>(${rede.por.size ? Math.round((comIndicador / rede.por.size) * 100) : 0}%)</small>`),
        cartao(periodo.tudo ? 'Total de indicações' : 'Indicações no período', indicacoesNoPeriodo),
        cartao('Quem já indicou', `${new Set([...totalPorIndicador.keys()]).size}`),
    ]);

    const modos = `<div class="rede-segmento" role="group" aria-label="Visualização">
        <button type="button" class="${ui.modoIndicacoes === 'quem' ? 'ativa' : ''}" data-acao="modo" data-modo="quem">Quem indicou</button>
        <button type="button" class="${ui.modoIndicacoes === 'indicado' ? 'ativa' : ''}" data-acao="modo" data-modo="indicado">Quem foi indicado</button>
    </div>`;

    let lista;
    if (ui.modoIndicacoes === 'quem') {
        let uids = ui.busca ? buscar(rede, ui.busca) : [...porIndicador.keys()];
        uids = uids.sort((a, b) => (porIndicador.get(b)?.length || 0) - (porIndicador.get(a)?.length || 0)
            || nomeDe(ctx, a).localeCompare(nomeDe(ctx, b), 'pt-BR'));
        const itens = uids.map((uid) => {
            const indicados = porIndicador.get(uid) || [];
            const total = totalPorIndicador.get(uid) || 0;
            const pai = rede.pai.get(uid);
            const stats = stat('Indicou', indicados.length)
                + (periodo.tudo ? '' : stat('Total geral', total))
                + stat('Indicado por', pai ? botaoUsuario(ctx, pai) : '—');
            if (!indicados.length) return item(ctx, uid, stats);
            const chave = 'ind-' + uid;
            const sub = indicados.slice().sort((a, b) => (rede.por.get(b).cadastro ?? 0) - (rede.por.get(a).cadastro ?? 0));
            const lim = limiteDe('i-' + chave, PASSO_INTERNO);
            const mais = sub.length > lim
                ? `<button type="button" class="rede-mais rede-mais--pequeno" data-acao="mais" data-chave="${esc('i-' + chave)}">Mostrar mais (${sub.length - lim} restantes)</button>` : '';
            return `<details class="rede-expansivel" data-chave="${esc(chave)}" ${ui.abertos.has(chave) ? 'open' : ''}>
                <summary><div class="rede-item rede-item--summary">${principal(ctx, uid)}<div class="rede-stats">${stats}</div></div></summary>
                <ul class="rede-sublista">${sub.slice(0, lim).map((f) => `<li>${botaoUsuario(ctx, f)}<small>${dia(rede.por.get(f).cadastro)}</small></li>`).join('')}</ul>${mais}
            </details>`;
        });
        lista = paginar('indicacoes-quem', itens, ui.busca ? 'Ninguém encontrado.' : 'Ninguém indicou ninguém neste período.');
    } else {
        let uids = ui.busca
            ? buscar(rede, ui.busca)
            : [...rede.por.keys()].filter((uid) => rede.pai.get(uid) && dentroDoPeriodo(rede.por.get(uid).cadastro, periodo));
        uids = uids.sort((a, b) => (rede.por.get(b).cadastro ?? 0) - (rede.por.get(a).cadastro ?? 0));
        const itens = uids.map((uid) => {
            const u = rede.por.get(uid);
            const pai = rede.pai.get(uid);
            const origem = pai ? botaoUsuario(ctx, pai) : (u.indicadorRemovido ? 'Indicador removido' : 'Sem indicador');
            return item(ctx, uid, stat('Indicado por', origem) + stat('Cadastro', dia(u.cadastro)));
        });
        lista = paginar('indicacoes-indicado', itens, ui.busca ? 'Ninguém encontrado.' : 'Ninguém foi indicado neste período.');
    }
    return resumo + modos + lista;
}

/* ==========================================================================
   Aba: Equipe (níveis expansíveis)
   ========================================================================== */
function renderEquipe(ctx) {
    if (ui.busca || !ui.selecionado) return seletor(ctx, 'Escolha o usuário');
    const { rede, periodo, arvore } = ctx;
    const raiz = ui.selecionado;
    const lv = niveis(rede, raiz);
    const total = arvore.get(raiz).membros;
    const noPeriodo = lv.reduce((s, n) => s + n.filter((uid) => dentroDoPeriodo(rede.por.get(uid).cadastro, periodo)).length, 0);

    const resumo = cartoes([
        cartao('Equipe total', total),
        cartao('Indicados diretos', lv[0]?.length || 0),
        cartao('Níveis', lv.length),
        cartao(periodo.tudo ? 'Recargas da equipe' : 'Recargas da equipe (período)', brl(arvore.get(raiz).confEquipe)),
    ]);
    const filtroInfo = periodo.tudo ? '' : `<p class="rede-contagem">Listas mostram quem se cadastrou no período: ${noPeriodo} de ${total}.</p>`;

    if (!lv.length) return resumo + '<p class="rede-vazio">Este usuário ainda não indicou ninguém.</p>';

    const blocos = lv.map((uids, i) => {
        const chave = `nivel-${raiz}-${i + 1}`;
        const visiveis = uids
            .filter((uid) => dentroDoPeriodo(rede.por.get(uid).cadastro, periodo))
            .sort((a, b) => (rede.por.get(b).cadastro ?? 0) - (rede.por.get(a).cadastro ?? 0));
        const conf = uids.reduce((s, uid) => s + arvore.get(uid).confProprio, 0);
        const itens = visiveis.map((uid) => {
            const u = rede.por.get(uid);
            const pai = rede.pai.get(uid);
            return item(ctx, uid,
                (i > 0 && pai ? stat('Indicado por', botaoUsuario(ctx, pai)) : '')
                + stat('Cadastro', dia(u.cadastro))
                + stat('Recargas', brl(arvore.get(uid).confProprio)));
        });
        const contagem = periodo.tudo ? `${uids.length}` : `${visiveis.length} de ${uids.length}`;
        return `<details class="rede-nivel" data-chave="${esc(chave)}" ${(ui.abertos.has(chave) || (i === 0 && !ui.fechados.has(chave))) ? 'open' : ''}>
            <summary><span class="rede-nivel__titulo">Nível ${i + 1}</span>
                <span class="rede-nivel__meta">${contagem} pessoa(s) · ${brl(conf)}</span></summary>
            ${paginar(chave, itens, 'Ninguém neste nível no período.')}
        </details>`;
    }).join('');
    return resumo + filtroInfo + `<div class="rede-niveis">${blocos}</div>`;
}

/* ==========================================================================
   Aba: Recargas (próprias e da equipe)
   ========================================================================== */
function renderRecargas(ctx) {
    const { rede, dep, arvore } = ctx;
    const resumo = cartoes([
        cartao('Confirmadas', brl(dep.total.conf)),
        cartao('Pendentes', brl(dep.total.pend)),
        cartao('Nº de recargas confirmadas', dep.total.confQtd),
        cartao('Usuários que recarregaram', [...dep.porUsuario.values()].filter((p) => p.confQtd > 0).length),
    ]);
    let uids = ui.busca ? buscar(rede, ui.busca) : [...rede.por.keys()].filter((uid) => {
        const a = arvore.get(uid);
        return a.confProprio + a.confEquipe + a.pendProprio + a.pendEquipe > 0;
    });
    uids = uids.sort((a, b) => {
        const A = arvore.get(a), B = arvore.get(b);
        return (B.confProprio + B.confEquipe) - (A.confProprio + A.confEquipe);
    });
    const itens = uids.map((uid) => {
        const a = arvore.get(uid);
        const pend = a.pendProprio + a.pendEquipe;
        return item(ctx, uid,
            stat('Próprias', brl(a.confProprio))
            + stat('Equipe', brl(a.confEquipe))
            + stat('Total', brl(a.confProprio + a.confEquipe), 'rede-stat--destaque')
            + (pend ? stat('Pendente', brl(pend), 'rede-stat--aviso') : ''));
    });
    return resumo
        + '<p class="rede-nota">Valores confirmados. "Equipe" soma todos os níveis abaixo do usuário. Uma mesma recarga aparece na equipe de cada pessoa acima de quem recarregou, por isso não some as linhas entre si (veja a aba Caixa).</p>'
        + paginar('recargas', itens, ui.busca ? 'Ninguém encontrado.' : 'Nenhuma recarga neste período.');
}

/* ==========================================================================
   Aba: Caixa (cada recarga em uma única equipe)
   ========================================================================== */
function renderCaixa(ctx) {
    const { rede, dep, arvore } = ctx;
    const cx = caixaPorEquipe(rede, arvore, dep);
    const resumo = cartoes([
        cartao('Caixa (confirmadas)', brl(cx.totalCaixa)),
        cartao('Equipes com indicados', cx.equipes.length),
        cartao('Sem equipe', brl(cx.semEquipe.conf)),
        cartao('Conferência', cx.conferido ? '<span class="rede-ok">✓ Fecha</span>' : '<span class="rede-erro">Não fecha</span>'),
    ]);
    let equipes = cx.equipes;
    if (ui.busca) {
        const achados = new Set(buscar(rede, ui.busca));
        equipes = equipes.filter((e) => achados.has(e.uid) || [...achados].some((uid) => rede.raiz.get(uid) === e.uid));
    }
    const itens = equipes.map((e) => {
        const pct = cx.totalCaixa ? (e.conf / cx.totalCaixa) * 100 : 0;
        const largura = Math.max(0, Math.min(100, pct)).toFixed(1);
        return `<div class="rede-item rede-item--coluna">
            <div class="rede-item--linha">${principal(ctx, e.uid)}
                <div class="rede-stats">${stat('Pessoas', e.membros)}${stat('No caixa', brl(e.conf), 'rede-stat--destaque')}${stat('% do caixa', pct.toFixed(1).replace('.', ',') + '%')}</div></div>
            <div class="rede-barra" aria-hidden="true"><span style="width:${largura}%"></span></div>
        </div>`;
    });
    const rodape = `<div class="rede-lista rede-lista--rodape">
        <div class="rede-item"><div class="rede-item__main"><span class="rede-item__nome">Usuários sem indicados</span>
            <div class="rede-item__sub">${cx.semEquipe.usuarios} usuário(s) que não indicaram ninguém e não foram indicados</div></div>
            <div class="rede-stats">${stat('Recargas', brl(cx.semEquipe.conf))}</div></div>
        ${cx.semConta ? `<div class="rede-item"><div class="rede-item__main"><span class="rede-item__nome">Contas removidas</span>
            <div class="rede-item__sub">Recargas confirmadas de contas que não existem mais</div></div>
            <div class="rede-stats">${stat('Recargas', brl(cx.semConta))}</div></div>` : ''}
    </div>`;
    return resumo
        + '<p class="rede-nota">Só recargas confirmadas. Cada recarga conta em uma única equipe: a do líder de topo (quem não foi indicado por ninguém). Por isso a soma das equipes, mais os grupos abaixo, fecha exatamente com o caixa.</p>'
        + paginar('caixa', itens, ui.busca ? 'Nenhuma equipe encontrada.' : 'Ainda não há equipes com recargas neste período.')
        + (ui.busca ? '' : rodape);
}

/* ==========================================================================
   Aba: Comissões
   ========================================================================== */
function renderComissoes(ctx) {
    const { rede, dep, depTodos, financeiro } = ctx;
    const cm = calcularComissoes(rede, dep, depTodos, financeiro);
    const pct = Math.round(COMISSAO_PERCENTUAL * 100);
    const resumo = cartoes([
        cartao('Ganhou (período)', brl(cm.total.ganha)),
        cartao('Já recebeu (total)', brl(cm.total.recebida)),
        cartao('Pendente', brl(cm.total.pendente)),
        cartao('Para conferir', cm.total.divergentes, cm.total.divergentes ? 'rede-card--alerta' : ''),
    ]);
    let uids = ui.busca ? buscar(rede, ui.busca) : [...rede.por.keys()].filter((uid) => {
        const l = cm.linhas.get(uid);
        return l.ganha > 0 || l.recebida > 0 || l.pendente > 0;
    });
    uids = uids.sort((a, b) => cm.linhas.get(b).ganha - cm.linhas.get(a).ganha
        || cm.linhas.get(b).recebida - cm.linhas.get(a).recebida);
    const itens = uids.map((uid) => {
        const l = cm.linhas.get(uid);
        const alerta = l.divergente
            ? `<div class="rede-item__alerta">Conferir: o sistema creditou ${brl(l.recebida)} e o cálculo pelas recargas dá ${brl(l.ganhaTotal)} (diferença ${brl(l.divergencia)}).</div>` : '';
        return `<div class="rede-item rede-item--coluna">
            <div class="rede-item--linha">${principal(ctx, uid)}<div class="rede-stats">
                ${stat('Ganhou', brl(l.ganha), 'rede-stat--destaque')}
                ${stat('Já recebeu', brl(l.recebida))}
                ${stat('Pendente', brl(l.pendente), l.pendente ? 'rede-stat--aviso' : '')}
            </div></div>${alerta}</div>`;
    });
    return resumo
        + `<details class="rede-aviso rede-aviso--info"><summary>Como é calculado</summary>
            <ul><li><b>Ganhou:</b> ${pct}% das recargas confirmadas dos indicados diretos (1º nível), dentro do período.</li>
            <li><b>Já recebeu:</b> o que o sistema já creditou na conta (acumulado de sempre; não muda com o filtro de período).</li>
            <li><b>Pendente:</b> ${pct}% das recargas dos indicados diretos que ainda aguardam confirmação.</li>
            <li><b>Conferir:</b> aparece quando o creditado difere do cálculo pelas recargas de todo o histórico.</li></ul></details>`
        + paginar('comissoes', itens, ui.busca ? 'Ninguém encontrado.' : 'Nenhuma comissão neste período.');
}

/* ==========================================================================
   Aba: Perfil (resumo individual)
   ========================================================================== */
function renderPerfil(ctx) {
    if (ui.busca || !ui.selecionado) return seletor(ctx, 'Escolha o usuário');
    const { rede, periodo, arvore, dep, depTodos, financeiro, depositos } = ctx;
    const uid = ui.selecionado;
    const u = rede.por.get(uid);
    const a = arvore.get(uid);
    const lv = niveis(rede, uid);
    const cm = calcularComissoes(rede, dep, depTodos, financeiro).linhas.get(uid);
    const cadeia = cadeiaDeIndicadores(rede, uid);
    const diretos = rede.filhos.get(uid) || [];
    const diretosPeriodo = diretos.filter((f) => dentroDoPeriodo(rede.por.get(f).cadastro, periodo));
    const proprias = dep.porUsuario.get(uid) || { conf: 0, confQtd: 0, pend: 0, pendQtd: 0 };

    const pai = rede.pai.get(uid);
    const indicadoPor = pai ? botaoUsuario(ctx, pai) : (u.indicadorRemovido ? 'Indicador removido' : 'Ninguém');

    const cabecalho = `<div class="rede-perfil__topo">
        <h3 class="rede-perfil__nome">${esc(u.nome || u.email || uid)}${u.isAdmin ? ' <span class="status-badge status-admin">Admin</span>' : ''}</h3>
        <div class="rede-item__sub">${esc(u.email || 'sem e-mail')} · ID ${esc(idCurto(u))}</div>
        <div class="rede-item__sub">Cadastro: ${dia(u.cadastro)} · Indicado por: ${indicadoPor}</div>
    </div>`;

    const secao = (chave, titulo, resumoTxt, conteudo, aberta = false) => `
        <details class="rede-nivel" data-chave="${esc('perfil-' + uid + '-' + chave)}" ${(ui.abertos.has('perfil-' + uid + '-' + chave) || (aberta && !ui.fechados.has('perfil-' + uid + '-' + chave))) ? 'open' : ''}>
            <summary><span class="rede-nivel__titulo">${titulo}</span><span class="rede-nivel__meta">${resumoTxt}</span></summary>
            <div class="rede-secao">${conteudo}</div></details>`;

    // Indicações
    const listaDiretos = diretosPeriodo.slice().sort((x, y) => (rede.por.get(y).cadastro ?? 0) - (rede.por.get(x).cadastro ?? 0));
    const limD = limiteDe('i-perfil-dir-' + uid, PASSO_INTERNO);
    const secIndic = `<div class="rede-stats rede-stats--bloco">${stat('Indicou (diretos)', diretos.length)}${periodo.tudo ? '' : stat('No período', diretosPeriodo.length)}${stat('Indicado por', indicadoPor)}</div>`
        + (cadeia.length ? `<p class="rede-nota">Cadeia acima: ${cadeia.map((c) => botaoUsuario(ctx, c)).join(' → ')}</p>` : '')
        + (listaDiretos.length
            ? `<ul class="rede-sublista">${listaDiretos.slice(0, limD).map((f) => `<li>${botaoUsuario(ctx, f)}<small>${dia(rede.por.get(f).cadastro)}</small></li>`).join('')}</ul>`
              + (listaDiretos.length > limD ? `<button type="button" class="rede-mais rede-mais--pequeno" data-acao="mais" data-chave="${esc('i-perfil-dir-' + uid)}">Mostrar mais (${listaDiretos.length - limD} restantes)</button>` : '')
            : '<p class="rede-vazio">Nenhum indicado direto.</p>');

    // Equipe
    const secEquipe = lv.length
        ? `<div class="rede-stats rede-stats--bloco">${lv.map((n, i) => stat('Nível ' + (i + 1), n.length)).join('')}</div>
           <p class="rede-nota">Para ver cada pessoa por nível, use a aba Equipe.</p>`
        : '<p class="rede-vazio">Sem equipe.</p>';

    // Recargas
    const recentes = recargasDoUsuario(depositos, uid, periodo);
    const limR = limiteDe('i-perfil-rec-' + uid, PASSO_INTERNO);
    const secRecargas = `<div class="rede-stats rede-stats--bloco">
            ${stat('Próprias confirmadas', brl(proprias.conf))}${stat('Próprias pendentes', brl(proprias.pend), proprias.pend ? 'rede-stat--aviso' : '')}
            ${stat('Equipe confirmadas', brl(a.confEquipe))}${stat('Equipe pendentes', brl(a.pendEquipe), a.pendEquipe ? 'rede-stat--aviso' : '')}</div>`
        + (recentes.length
            ? `<ul class="rede-sublista">${recentes.slice(0, limR).map((r) => `<li><span>${brl(r.cent)} <small>${r.confirmada ? 'confirmada' : 'pendente'}</small></span><small>${diaHora(r.ms)}</small></li>`).join('')}</ul>`
              + (recentes.length > limR ? `<button type="button" class="rede-mais rede-mais--pequeno" data-acao="mais" data-chave="${esc('i-perfil-rec-' + uid)}">Mostrar mais (${recentes.length - limR} restantes)</button>` : '')
            : '<p class="rede-vazio">Nenhuma recarga no período.</p>');

    // Comissões
    const secCom = `<div class="rede-stats rede-stats--bloco">${stat('Ganhou', brl(cm.ganha), 'rede-stat--destaque')}${stat('Já recebeu', brl(cm.recebida))}${stat('Pendente', brl(cm.pendente), cm.pendente ? 'rede-stat--aviso' : '')}${stat('Saldo de comissão', brl(cm.saldo))}</div>`
        + (cm.divergente ? `<div class="rede-item__alerta">Conferir: o sistema creditou ${brl(cm.recebida)} e o cálculo pelas recargas dá ${brl(cm.ganhaTotal)} (diferença ${brl(cm.divergencia)}).</div>` : '');

    return cabecalho
        + cartoes([
            cartao('Indicou', diretos.length),
            cartao('Equipe', a.membros),
            cartao('Recargas (própria + equipe)', brl(a.confProprio + a.confEquipe)),
            cartao('Comissão ganha', brl(cm.ganha)),
        ])
        + secao('indic', 'Indicações', `${diretos.length} direta(s)`, secIndic, true)
        + secao('equipe', 'Equipe', `${a.membros} pessoa(s)`, secEquipe)
        + secao('recargas', 'Recargas', brl(proprias.conf + a.confEquipe), secRecargas)
        + secao('comissoes', 'Comissões', brl(cm.ganha), secCom);
}
