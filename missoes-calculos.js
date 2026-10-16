/* ==========================================================================
   Missões de indicação — cálculos do painel admin (sem DOM, sem Firebase)
   Repete a MESMA regra do worker (worker-missoes.js), só para exibir.
   Quem decide e credita de verdade é sempre o servidor.
   ========================================================================== */
import { paraCentavos, paraMs } from './rede-calculos.js';

export const VALOR_MINIMO_PLANO = 50;
export const MAX_MISSOES = 12;
export const PROCESSANDO_EXPIRA_MS = 10 * 60 * 1000;
export const MISSOES_PADRAO = [
    { id: 'm1', meta: 5, recompensa: 30, ativa: true },
    { id: 'm2', meta: 10, recompensa: 60, ativa: true },
    { id: 'm3', meta: 20, recompensa: 120, ativa: true },
    { id: 'm4', meta: 40, recompensa: 240, ativa: true },
    { id: 'm5', meta: 80, recompensa: 480, ativa: true },
    { id: 'm6', meta: 160, recompensa: 960, ativa: true },
];

const round2 = (n) => Math.round((parseFloat(n) || 0) * 100) / 100;

/* Lista de missões a partir de missoesConfig (igual ao worker) */
export function normalizarMissoes(config, incluirInativas = false) {
    const bruto = config && config.missoes && typeof config.missoes === 'object' ? config.missoes : null;
    if (!bruto) return MISSOES_PADRAO.map((m) => ({ ...m }));
    const lista = [];
    for (const [id, m] of Object.entries(bruto)) {
        if (!m || typeof m !== 'object' || !/^[A-Za-z0-9_-]{1,20}$/.test(id)) continue;
        const meta = Math.floor(Number(m.meta));
        const recompensa = round2(m.recompensa);
        if (!(meta >= 1) || !(recompensa > 0)) continue;
        lista.push({ id, meta, recompensa, ativa: m.ativa !== false });
    }
    lista.sort((a, b) => a.meta - b.meta);
    return incluirInativas ? lista : lista.filter((m) => m.ativa);
}

/* Plano ATIVO de R$ 50 ou mais (finalizado e cancelado não contam) */
export function planoConta(plano) {
    if (!plano || typeof plano !== 'object') return false;
    if (plano.status === 'finalizado' || plano.status === 'cancelado_pelo_admin') return false;
    return (parseFloat(plano.valor) || 0) >= VALOR_MINIMO_PLANO;
}

/* uid -> maior plano válido */
export function mapaPlanosValidos(planos) {
    const mapa = new Map();
    for (const [uid, doUsuario] of Object.entries(planos || {})) {
        if (!doUsuario || typeof doUsuario !== 'object') continue;
        for (const p of Object.values(doUsuario)) {
            if (planoConta(p)) mapa.set(uid, Math.max(mapa.get(uid) || 0, parseFloat(p.valor) || 0));
        }
    }
    return mapa;
}

/* indicador -> { diretos: [uid], ativos: [{ uid, valor }] }
   Só indicados DIRETOS; cada pessoa aparece uma única vez (um indicador por conta). */
export function calcularIndicados(usuarios, mapaPlanos) {
    const porIndicador = new Map();
    for (const [uid, u] of Object.entries(usuarios || {})) {
        const p = u && typeof u === 'object' ? u.indicadoPor : null;
        if (!p || typeof p !== 'string' || p === uid) continue;
        const e = porIndicador.get(p) || porIndicador.set(p, { diretos: [], ativos: [] }).get(p);
        e.diretos.push(uid);
        const valor = mapaPlanos.get(uid) || 0;
        if (valor >= VALOR_MINIMO_PLANO) e.ativos.push({ uid, valor });
    }
    return porIndicador;
}

/* Estado de cada missão para UM usuário */
export function estadoMissoes(missoes, nAtivos, coletasDoUsuario) {
    return missoes.map((m) => {
        const c = coletasDoUsuario ? coletasDoUsuario[m.id] : null;
        let estado = nAtivos >= m.meta ? 'disponivel' : 'bloqueada';
        if (c && c.status === 'coletada') estado = 'coletada';
        else if (c && c.status === 'processando') estado = 'processando';
        return { ...m, estado, coleta: c || null, progresso: Math.min(nAtivos, m.meta) };
    });
}

/* Totais por missão e gerais */
export function resumoGeral(missoes, usuarios, indicados, coletas) {
    const porMissao = new Map(missoes.map((m) => [m.id, {
        missao: m, atingiram: 0, coletaram: 0, disponiveis: 0,
        valorPago: 0, valorDisponivel: 0, listaDisponiveis: [],
    }]));
    const geral = { disponiveis: 0, valorDisponivel: 0, coletaram: 0, valorPago: 0, usuariosComAtivos: 0 };

    for (const uid of Object.keys(usuarios || {})) {
        const n = (indicados.get(uid) || { ativos: [] }).ativos.length;
        if (n > 0) geral.usuariosComAtivos++;
        for (const m of missoes) {
            if (n < m.meta) continue;
            const linha = porMissao.get(m.id);
            linha.atingiram++;
            const c = coletas && coletas[uid] ? coletas[uid][m.id] : null;
            if (!c) {
                linha.disponiveis++;
                linha.valorDisponivel += paraCentavos(m.recompensa);
                linha.listaDisponiveis.push(uid);
            }
        }
    }
    // coletas: vale o registro (valor da época), mesmo que a missão tenha mudado depois
    for (const [uid, doUsuario] of Object.entries(coletas || {})) {
        if (!doUsuario || typeof doUsuario !== 'object') continue;
        for (const [id, c] of Object.entries(doUsuario)) {
            if (!c || c.status !== 'coletada') continue;
            const cent = paraCentavos(c.recompensa);
            geral.coletaram++;
            geral.valorPago += cent;
            const linha = porMissao.get(id);
            if (linha) { linha.coletaram++; linha.valorPago += cent; }
        }
    }
    for (const l of porMissao.values()) { geral.disponiveis += l.disponiveis; geral.valorDisponivel += l.valorDisponivel; }
    return { porMissao, geral };
}

/* Todas as coletas concluídas, da mais recente para a mais antiga */
export function listarColetas(coletas) {
    const lista = [];
    for (const [uid, doUsuario] of Object.entries(coletas || {})) {
        if (!doUsuario || typeof doUsuario !== 'object') continue;
        for (const [id, c] of Object.entries(doUsuario)) {
            if (!c || c.status !== 'coletada') continue;
            lista.push({ uid, missaoId: id, meta: c.meta, cent: paraCentavos(c.recompensa), ms: paraMs(c.data), extratoId: c.extratoId || null, indicadosAtivos: c.indicadosAtivos ?? null });
        }
    }
    return lista.sort((a, b) => (b.ms ?? 0) - (a.ms ?? 0));
}

/* Conferência: o que está registrado como coletado bate com o que foi creditado? */
export function conferirCreditos(coletas, financeiro, agora = Date.now()) {
    const somaPorUsuario = new Map();
    const processando = [];
    for (const [uid, doUsuario] of Object.entries(coletas || {})) {
        if (!doUsuario || typeof doUsuario !== 'object') continue;
        for (const [id, c] of Object.entries(doUsuario)) {
            if (!c) continue;
            if (c.status === 'coletada') somaPorUsuario.set(uid, (somaPorUsuario.get(uid) || 0) + paraCentavos(c.recompensa));
            else if (c.status === 'processando') {
                const ini = paraMs(c.iniciadoEm);
                processando.push({ uid, missaoId: id, iniciadoEm: ini, preso: ini !== null && agora - ini > PROCESSANDO_EXPIRA_MS });
            }
        }
    }
    const divergencias = [];
    const uids = new Set([...somaPorUsuario.keys(), ...Object.keys(financeiro || {}).filter((u) => paraCentavos(financeiro[u]?.bonusMissoes) > 0)]);
    let totalRegistrado = 0, totalCreditado = 0;
    for (const uid of uids) {
        const registrado = somaPorUsuario.get(uid) || 0;
        const creditado = paraCentavos((financeiro || {})[uid]?.bonusMissoes);
        totalRegistrado += registrado; totalCreditado += creditado;
        if (registrado !== creditado) divergencias.push({ uid, registrado, creditado, diferenca: creditado - registrado });
    }
    return { divergencias, processando, totalRegistrado, totalCreditado, conferido: divergencias.length === 0 };
}

/* Validação do formulário de configuração (mesmas regras do worker) */
export function validarConfig(linhas) {
    if (!Array.isArray(linhas) || linhas.length < 1) return 'Mantenha pelo menos uma missão.';
    if (linhas.length > MAX_MISSOES) return `No máximo ${MAX_MISSOES} missões.`;
    const metas = new Set();
    for (let i = 0; i < linhas.length; i++) {
        const meta = Number(linhas[i].meta);
        const recompensa = round2(linhas[i].recompensa);
        if (!Number.isInteger(meta) || meta < 1 || meta > 100000) return `Missão ${i + 1}: a meta deve ser um número inteiro de 1 a 100000.`;
        if (!(recompensa > 0) || recompensa > 100000) return `Missão ${i + 1}: a recompensa deve ser maior que zero (até R$ 100.000,00).`;
        if (metas.has(meta)) return `Existem duas missões com a meta ${meta}. Cada meta deve ser única.`;
        metas.add(meta);
    }
    return null;
}
