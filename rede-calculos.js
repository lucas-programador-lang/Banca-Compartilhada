/* ==========================================================================
   Cálculos da rede de indicações (painel admin)
   - Sem DOM e sem Firebase: recebe objetos simples e devolve números.
   - Todo dinheiro é somado em CENTAVOS (inteiros) para não acumular erro de
     ponto flutuante. Só na hora de exibir é que vira R$.
   ========================================================================== */

/* ---- Regras de negócio (ajuste aqui se o servidor mudar) ---- */
export const COMISSAO_PERCENTUAL = 0.10;      // 10% sobre recargas do 1º nível
// Recarga confirmada = dinheiro recebido e ainda no caixa.
//  - 'aprovado': pago e plano criado.
//  - 'aprovado_sem_plano': pago, mas o plano ficou travado pelo limite (aguarda decisão do admin).
//  - 'resolvido_sem_plano' fica de FORA: o admin marcou como resolvido sem plano
//    (ex.: reembolso feito fora do sistema), então o dinheiro não está mais no caixa.
export const STATUS_CONFIRMADA = ['aprovado', 'aprovado_sem_plano'];
export const STATUS_SEM_PLANO = 'aprovado_sem_plano';
export const STATUS_PENDENTE = ['pendente'];
export const MAX_NIVEIS = 30;                 // trava de segurança
export const PERIODO_TUDO = { tudo: true, inicio: null, fim: null };

/* ---- Utilitários ---- */
export function paraCentavos(valor) {
    const n = typeof valor === 'number' ? valor : parseFloat(valor);
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function paraMs(data) {
    if (data === null || data === undefined || data === '') return null;
    if (typeof data === 'number') return Number.isFinite(data) ? data : null;
    const t = Date.parse(data);
    return Number.isNaN(t) ? null : t;
}

export function dentroDoPeriodo(ms, periodo) {
    if (!periodo || periodo.tudo) return true;
    if (ms === null || ms === undefined) return false;
    if (periodo.inicio !== null && ms < periodo.inicio) return false;
    if (periodo.fim !== null && ms > periodo.fim) return false;
    return true;
}

export function normalizarTexto(texto) {
    return String(texto ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

/* ==========================================================================
   Árvore de indicações
   Fonte única: usuarios/{uid}/indicadoPor. Cada usuário tem no máximo UM
   indicador, então a rede é uma árvore e ninguém aparece duas vezes.
   Dados estranhos são neutralizados (e contados em `anomalias`):
   - auto-indicação (indicadoPor = o próprio uid)
   - indicador que não existe mais
   - ciclos (A indica B e B indica A)
   ========================================================================== */
export function construirRede(usuarios) {
    const por = new Map();
    for (const [uid, d] of Object.entries(usuarios || {})) {
        if (!d || typeof d !== 'object') continue;
        const nome = String(d.nome || '').trim();
        const email = String(d.email || '').trim();
        const codigo = String(d.codigoIndicacao || '').trim();
        por.set(uid, {
            uid,
            nome,
            email,
            codigo,
            cadastro: paraMs(d.dataCadastro),
            indicadoPorBruto: d.indicadoPor || null,
            indicadorRemovido: false,
            isAdmin: d.isAdmin === true,
            busca: normalizarTexto(`${nome} ${email} ${uid} ${codigo}`),
        });
    }

    const anomalias = { autoIndicacao: 0, indicadorInexistente: 0, usuariosEmCiclo: 0 };

    // 1) pai "bruto": descarta auto-indicação e indicador inexistente
    const paiBruto = new Map();
    for (const u of por.values()) {
        const p = u.indicadoPorBruto;
        if (!p) { paiBruto.set(u.uid, null); continue; }
        if (p === u.uid) { anomalias.autoIndicacao++; paiBruto.set(u.uid, null); continue; }
        if (!por.has(p)) {
            anomalias.indicadorInexistente++;
            u.indicadorRemovido = true;
            paiBruto.set(u.uid, null);
            continue;
        }
        paiBruto.set(u.uid, p);
    }

    // 2) quebra ciclos: só quem realmente está DENTRO de um ciclo perde o pai
    const pai = new Map();
    for (const uid of por.keys()) {
        let atual = paiBruto.get(uid);
        const visto = new Set([uid]);
        let emCiclo = false;
        while (atual) {
            if (atual === uid) { emCiclo = true; break; }
            if (visto.has(atual)) break; // chegou em um ciclo que não inclui este usuário
            visto.add(atual);
            atual = paiBruto.get(atual);
        }
        if (emCiclo) {
            anomalias.usuariosEmCiclo++;
            pai.set(uid, null);
        } else {
            pai.set(uid, paiBruto.get(uid));
        }
    }

    // 3) filhos, raízes e ordem de varredura (pais sempre antes dos filhos)
    const filhos = new Map();
    for (const uid of por.keys()) filhos.set(uid, []);
    for (const [uid, p] of pai) if (p) filhos.get(p).push(uid);

    const porCadastro = (a, b) => (por.get(a).cadastro ?? Infinity) - (por.get(b).cadastro ?? Infinity);
    for (const lista of filhos.values()) lista.sort(porCadastro);

    const raizes = [...por.keys()].filter(uid => !pai.get(uid));
    raizes.sort(porCadastro);

    const ordem = [];
    const fila = [...raizes];
    for (let i = 0; i < fila.length; i++) {
        ordem.push(fila[i]);
        for (const f of filhos.get(fila[i])) fila.push(f);
    }

    const raiz = new Map();
    for (const uid of ordem) {
        const p = pai.get(uid);
        raiz.set(uid, p ? raiz.get(p) : uid);
    }

    return { por, pai, filhos, raizes, ordem, raiz, anomalias };
}

/* Indicados agrupados por nível: [[nível 1], [nível 2], ...] */
export function niveis(rede, uid, max = MAX_NIVEIS) {
    const out = [];
    const visto = new Set([uid]);
    let atual = rede.filhos.get(uid) || [];
    while (atual.length && out.length < max) {
        const nivel = [];
        for (const c of atual) {
            if (visto.has(c)) continue;
            visto.add(c);
            nivel.push(c);
        }
        if (!nivel.length) break;
        out.push(nivel);
        atual = nivel.flatMap(c => rede.filhos.get(c) || []);
    }
    return out;
}

/* Quem está acima do usuário: [indicador, indicador do indicador, ...] */
export function cadeiaDeIndicadores(rede, uid, max = MAX_NIVEIS) {
    const out = [];
    const visto = new Set([uid]);
    let atual = rede.pai.get(uid);
    while (atual && !visto.has(atual) && out.length < max) {
        out.push(atual);
        visto.add(atual);
        atual = rede.pai.get(atual);
    }
    return out;
}

/* Busca por nome, e-mail, uid ou código de indicação (sem acento/maiúscula) */
export function buscar(rede, termo, limite = Infinity) {
    const t = normalizarTexto(termo);
    if (!t) return [];
    const achados = [];
    for (const u of rede.por.values()) {
        if (u.busca.includes(t)) achados.push(u.uid);
    }
    const exato = (uid) => {
        const u = rede.por.get(uid);
        return u.codigo.toLowerCase() === t || u.uid.toLowerCase() === t ? 0 : 1;
    };
    achados.sort((a, b) => exato(a) - exato(b)
        || (rede.por.get(a).nome || rede.por.get(a).email).localeCompare(rede.por.get(b).nome || rede.por.get(b).email, 'pt-BR'));
    return achados.slice(0, limite);
}

/* ==========================================================================
   Recargas (depósitos)
   - "confirmada": dinheiro recebido (STATUS_CONFIRMADA). Data = aprovação.
   - "pendente": aguardando confirmação. Data = solicitação.
   - Recusadas e outras situações não entram em nenhuma soma.
   Cada recarga é um registro único (depositos/{uid}/{id}): contada uma vez.
   ========================================================================== */
export function agregarDepositos(depositos, periodo, usuariosMap) {
    const porUsuario = new Map();
    const total = { conf: 0, confQtd: 0, pend: 0, pendQtd: 0, semPlano: 0 };
    const semConta = { conf: 0, confQtd: 0, pend: 0, pendQtd: 0, semPlano: 0 };

    for (const [uid, registros] of Object.entries(depositos || {})) {
        if (!registros || typeof registros !== 'object') continue;
        const existe = usuariosMap ? usuariosMap.has(uid) : true;
        const alvo = existe
            ? (porUsuario.get(uid) || porUsuario.set(uid, { conf: 0, confQtd: 0, pend: 0, pendQtd: 0, semPlano: 0 }).get(uid))
            : semConta;

        for (const d of Object.values(registros)) {
            if (!d || typeof d !== 'object') continue;
            const cent = paraCentavos(d.valorPlano);
            if (cent <= 0) continue;
            const status = String(d.status || 'pendente').toLowerCase();

            if (STATUS_CONFIRMADA.includes(status)) {
                const ms = paraMs(d.dataAprovacao) ?? paraMs(d.dataSolicitacao);
                if (!dentroDoPeriodo(ms, periodo)) continue;
                alvo.conf += cent; alvo.confQtd++;
                total.conf += cent; total.confQtd++;
                if (status === STATUS_SEM_PLANO) { alvo.semPlano += cent; total.semPlano += cent; }
            } else if (STATUS_PENDENTE.includes(status)) {
                const ms = paraMs(d.dataSolicitacao);
                if (!dentroDoPeriodo(ms, periodo)) continue;
                alvo.pend += cent; alvo.pendQtd++;
                total.pend += cent; total.pendQtd++;
            }
        }
    }
    return { porUsuario, total, semConta };
}

/* Lista das recargas de UM usuário (mais recentes primeiro) */
export function recargasDoUsuario(depositos, uid, periodo) {
    const lista = [];
    for (const [id, d] of Object.entries((depositos || {})[uid] || {})) {
        if (!d || typeof d !== 'object') continue;
        const cent = paraCentavos(d.valorPlano);
        if (cent <= 0) continue;
        const status = String(d.status || 'pendente').toLowerCase();
        const confirmada = STATUS_CONFIRMADA.includes(status);
        const pendente = STATUS_PENDENTE.includes(status);
        if (!confirmada && !pendente) continue;
        const ms = confirmada
            ? (paraMs(d.dataAprovacao) ?? paraMs(d.dataSolicitacao))
            : paraMs(d.dataSolicitacao);
        if (!dentroDoPeriodo(ms, periodo)) continue;
        lista.push({ id, cent, status, confirmada, semPlano: status === STATUS_SEM_PLANO, ms });
    }
    lista.sort((a, b) => (b.ms ?? 0) - (a.ms ?? 0));
    return lista;
}

/* Soma própria + toda a equipe (todos os níveis) de cada usuário.
   Percorre a árvore de baixo para cima: cada pessoa entra uma única vez. */
export function agregarArvore(rede, porUsuario) {
    const r = new Map();
    for (const uid of rede.ordem) {
        const p = porUsuario.get(uid) || { conf: 0, confQtd: 0, pend: 0, pendQtd: 0 };
        r.set(uid, {
            confProprio: p.conf, pendProprio: p.pend,
            confEquipe: 0, pendEquipe: 0,
            membros: 0,
        });
    }
    for (let i = rede.ordem.length - 1; i >= 0; i--) {
        const uid = rede.ordem[i];
        const pai = rede.pai.get(uid);
        if (!pai) continue;
        const a = r.get(uid);
        const b = r.get(pai);
        b.confEquipe += a.confProprio + a.confEquipe;
        b.pendEquipe += a.pendProprio + a.pendEquipe;
        b.membros += 1 + a.membros;
    }
    return r;
}

/* ==========================================================================
   Caixa por equipe
   Cada recarga cai em UMA equipe só: a do líder de topo (quem não tem
   indicador). Assim a soma das equipes + os "sem equipe" + "sem conta"
   é exatamente o total do caixa, sem contar nada em dobro.
   ========================================================================== */
export function caixaPorEquipe(rede, arvore, dep) {
    const equipes = [];
    let semEquipe = { usuarios: 0, conf: 0 };

    for (const uid of rede.raizes) {
        const a = arvore.get(uid);
        const conf = a.confProprio + a.confEquipe;
        if (a.membros === 0) {
            semEquipe.usuarios++;
            semEquipe.conf += conf;
        } else {
            equipes.push({ uid, membros: a.membros + 1, conf });
        }
    }
    equipes.sort((a, b) => b.conf - a.conf);

    const somaEquipes = equipes.reduce((s, e) => s + e.conf, 0);
    const soma = somaEquipes + semEquipe.conf + dep.semConta.conf;
    return {
        equipes,
        semEquipe,
        semConta: dep.semConta.conf,
        totalCaixa: dep.total.conf,
        conferido: soma === dep.total.conf,
    };
}

/* ==========================================================================
   Planos ativados (base da comissão)
   O worker credita a comissão no momento em que o PLANO é criado: pelo Pix
   pago, pela aprovação manual, pela resolução de pendência ("criar plano") e
   pelo "Gerenciar planos" do admin. Cancelar o plano depois NÃO devolve a
   comissão. Por isso a base é o valor de todos os planos, em qualquer status,
   na data de ativação.
   ========================================================================== */
export function agregarPlanos(planos, periodo, usuariosMap) {
    const porUsuario = new Map();
    for (const [uid, registros] of Object.entries(planos || {})) {
        if (!registros || typeof registros !== 'object') continue;
        if (usuariosMap && !usuariosMap.has(uid)) continue;
        for (const p of Object.values(registros)) {
            if (!p || typeof p !== 'object') continue;
            const cent = paraCentavos(p.valor);
            if (cent <= 0) continue;
            if (!dentroDoPeriodo(paraMs(p.dataAtivacao), periodo)) continue;
            const a = porUsuario.get(uid) || porUsuario.set(uid, { valor: 0, qtd: 0 }).get(uid);
            a.valor += cent;
            a.qtd++;
        }
    }
    return porUsuario;
}

/* ==========================================================================
   Comissões (regra do worker: 10% do valor do plano, só para o indicador direto)
   - ganha:      10% dos planos ativados pelos indicados DIRETOS, no período
   - recebida:   o que já saiu em saques  = creditada + bônus de missões − saldo de comissão
   - pendente:   o que ainda está no saldo de comissão (não sacado)
   - aguardando: 10% de depósitos pagos cujo plano ficou travado pelo limite;
                 a comissão só sai se o admin escolher "criar plano mesmo assim"
   - creditada:  financeiro/{uid}/comissao (acumulado de sempre, sem datas)
   - divergência: creditada − ganha(todo o histórico). Diferente de zero = conferir.
   ========================================================================== */
export function calcularComissoes(rede, planosPeriodo, planosTodos, depPeriodo, financeiro) {
    const linhas = new Map();
    const tot = { ganha: 0, creditada: 0, recebida: 0, pendente: 0, aguardando: 0, divergentes: 0 };

    for (const uid of rede.por.keys()) {
        let basePer = 0, baseTodos = 0, semPlano = 0;
        for (const f of rede.filhos.get(uid)) {
            basePer += planosPeriodo.get(f)?.valor || 0;
            baseTodos += planosTodos.get(f)?.valor || 0;
            semPlano += depPeriodo.porUsuario.get(f)?.semPlano || 0;
        }
        const fin = (financeiro || {})[uid] || {};
        const ganha = Math.round(basePer * COMISSAO_PERCENTUAL);
        const ganhaTotal = Math.round(baseTodos * COMISSAO_PERCENTUAL);
        const aguardando = Math.round(semPlano * COMISSAO_PERCENTUAL);
        const creditada = paraCentavos(fin.comissao);
        // bônus das missões entra no mesmo saldo de comissão, mas NÃO é comissão de
        // indicação: por isso fica fora da conferência (creditada x ganhaTotal)
        const bonus = paraCentavos(fin.bonusMissoes);
        const pendente = Math.max(paraCentavos(fin.saldoComissao), 0);
        const recebida = Math.max(creditada + bonus - pendente, 0);
        const divergencia = creditada - ganhaTotal;
        const divergente = Math.abs(divergencia) >= 1;

        linhas.set(uid, { ganha, ganhaTotal, creditada, bonus, recebida, pendente, aguardando, divergencia, divergente });
        tot.ganha += ganha;
        tot.creditada += creditada;
        tot.recebida += recebida;
        tot.pendente += pendente;
        tot.aguardando += aguardando;
        if (divergente) tot.divergentes++;
    }
    return { linhas, total: tot };
}
