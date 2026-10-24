import { auth } from './auth.js';
import { db } from './auth.js';
import { ref, onValue } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/* Mesmas regras do simulador: lucro = aporte x (teto - 1) */
const PLANOS = [
    { n: 'Ciclo Express',   v: 10,   t: 1.40, dias: 2 },
    { n: 'Ciclo Médio 15',  v: 15,   t: 2.00, dias: 40 },
    { n: 'Banca Starter',   v: 30,   t: 1.70, d: 0.03 },
    { n: 'Banca Bronze',    v: 50,   t: 1.70, d: 0.03 },
    { n: 'Ciclo Médio 60',  v: 60,   t: 2.00, dias: 40 },
    { n: 'Banca Prata',     v: 100,  t: 1.60, d: 0.02 },
    { n: 'Ciclo Médio 150', v: 150,  t: 1.80, dias: 40 },
    { n: 'Ciclo Médio 200', v: 200,  t: 1.90, dias: 40 },
    { n: 'Banca Ouro',      v: 300,  t: 1.60, d: 0.02 },
    { n: 'Ciclo Longo 450', v: 450,  t: 2.10, dias: 60 },
    { n: 'Banca Platinum',  v: 500,  t: 1.60, d: 0.02 },
    { n: 'Banca Master',    v: 1000, t: 1.60, d: 0.02 },
];

const lucroDe = (p) => round2(p.v * (p.t - 1));
function diasDe(p) {
    return p.dias || Math.ceil(lucroDe(p) / (p.v * p.d) - 1e-9);
}
function serieDe(p) {
    const lucro = lucroDe(p), dias = diasDe(p), pts = [0];
    for (let d = 1; d <= dias; d++) {
        pts.push(p.dias ? (lucro * d) / dias : Math.min(p.v * p.d * d, lucro));
    }
    return pts;
}

function svgLinha(vals) {
    const W = 600, H = 170, pad = 8, n = vals.length;
    const max = Math.max(...vals, 0.01);
    const x = (i) => pad + (n === 1 ? 0 : (i * (W - 2 * pad)) / (n - 1));
    const y = (v) => H - pad - (v / max) * (H - 2 * pad);
    const linha = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const area = `${x(0).toFixed(1)},${H - pad} ${linha} ${x(n - 1).toFixed(1)},${H - pad}`;
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="ix-svg" role="img">
        <polygon points="${area}" class="ix-area"/>
        <polyline points="${linha}" class="ix-line" fill="none"/>
    </svg>`;
}

/* ---------- 1) Projeção + comparativo ---------- */
function planoSelecionado() {
    const sel = document.getElementById('simPlano');
    if (!sel || !sel.selectedOptions[0]) return PLANOS[2];
    const m = sel.selectedOptions[0].textContent.match(/R\$\s*([\d.]+),(\d{2})/);
    if (!m) return PLANOS[2];
    const valor = parseFloat(m[1].replace(/\./g, '') + '.' + m[2]);
    return PLANOS.find((p) => p.v === valor) || PLANOS[2];
}

function renderProjecao() {
    const box = document.getElementById('ixProjecao');
    if (!box) return;
    const p = planoSelecionado();
    const serie = serieDe(p);
    const dias = serie.length - 1;
    const lucro = lucroDe(p);
    const unidade = p.dias ? 'dias' : 'dias úteis';

    // Barras: lucro em % sobre o aporte (compara planos de valores diferentes)
    const maxPct = Math.max(...PLANOS.map((q) => lucroDe(q) / q.v));
    const barras = PLANOS.map((q) => {
        const pct = (lucroDe(q) / q.v) * 100;
        const larg = Math.max(6, (pct / (maxPct * 100)) * 100);
        return `
        <div class="ix-bar ${q.v === p.v ? 'ix-bar--sel' : ''}">
            <span class="ix-bar__nome">${q.n}</span>
            <div class="ix-bar__trilho"><div class="ix-bar__fill" style="width:${larg.toFixed(1)}%"></div></div>
            <span class="ix-bar__val">${moeda.format(lucroDe(q))} <small>${pct.toFixed(0)}%</small></span>
        </div>`;
    }).join('');

    box.innerHTML = `
        <h3 class="ix-title">Projeção do plano escolhido</h3>
        <p class="ix-sub">${p.n}: lucro estimado de ${moeda.format(lucro)} em ${dias} ${unidade}</p>
        <div class="ix-chart">
            <div class="ix-chart__y">
                <span>${moeda.format(lucro)}</span>
                <span>${moeda.format(lucro / 2)}</span>
                <span>R$ 0,00</span>
            </div>
            <div class="ix-chart__plot">${svgLinha(serie)}</div>
        </div>
        <div class="ix-axis ix-axis--chart"><span>Dia 0</span><span>Dia ${Math.round(dias / 2)}</span><span>Dia ${dias}</span></div>
        ${p.dias ? '<p class="ix-note">Nos ciclos o valor é pago ao final do prazo; a linha mostra a evolução proporcional.</p>' : ''}

        <h3 class="ix-title ix-title--mt">Comparativo entre planos</h3>
        <p class="ix-sub">Lucro estimado de cada plano (R$ e % sobre o aporte)</p>
        <div class="ix-bars">${barras}</div>
        <p class="ix-note">Estimativa baseada nas regras de cada plano. Não é garantia de ganhos.</p>`;
}

function iniciarProjecao() {
    renderProjecao();
    document.addEventListener('change', (e) => { if (e.target && e.target.id === 'simPlano') renderProjecao(); });
    const sel = document.getElementById('simPlano');
    if (sel) new MutationObserver(renderProjecao).observe(sel, { childList: true });
}

/* ---------- 2) Rendimento real do usuário (extrato) ---------- */
function ehRendimento(r) {
    const tipo = String(r.tipo || '').toLowerCase();
    if (tipo === 'rendimento' || tipo === 'ciclo') return true;
    return !tipo && parseFloat(r.valor) > 0 && /rendimento|retorno final/i.test(r.descricao || '');
}

function renderMeuRendimento(extrato) {
    const box = document.getElementById('ixMeuRendimento');
    if (!box) return;
    const DIAS = 14;
    const chave = (d) => d.toLocaleDateString('en-CA');
    const porDia = {};
    let totalGeral = 0;

    Object.values(extrato || {}).forEach((r) => {
        if (!r || !ehRendimento(r)) return;
        const d = new Date(r.data);
        if (isNaN(d.getTime())) return;
        const v = parseFloat(r.valor) || 0;
        totalGeral += v;
        porDia[chave(d)] = (porDia[chave(d)] || 0) + v;
    });

    const hoje = new Date();
    const dias = [];
    for (let i = DIAS - 1; i >= 0; i--) {
        const d = new Date(hoje); d.setDate(hoje.getDate() - i);
        dias.push(chave(d));
    }
    const noPeriodo = dias.reduce((s, k) => s + (porDia[k] || 0), 0);
    let acum = totalGeral - noPeriodo;
    const serie = dias.map((k) => (acum += porDia[k] || 0));

    if (totalGeral <= 0) {
        box.innerHTML = `<h3 class="ix-title">Seu rendimento acumulado</h3>
            <p class="ix-sub">Quando você receber seus primeiros rendimentos, o gráfico aparece aqui.</p>`;
        return;
    }
    box.innerHTML = `
        <h3 class="ix-title">Seu rendimento acumulado</h3>
        <div class="ix-kpis">
            <div><small>Total recebido</small><strong>${moeda.format(totalGeral)}</strong></div>
            <div><small>Últimos ${DIAS} dias</small><strong>${moeda.format(noPeriodo)}</strong></div>
        </div>
        ${svgLinha(serie)}
        <div class="ix-axis"><span>${dias[0].slice(8)}/${dias[0].slice(5, 7)}</span><span>Hoje</span></div>
        <p class="ix-note">Dados reais da sua conta (extrato de rendimentos e ciclos).</p>`;
}

function iniciarMeuRendimento() {
    renderMeuRendimento({});
    auth.onAuthStateChanged((user) => {
        if (!user) return;
        onValue(ref(db, 'extrato/' + user.uid), (snap) => renderMeuRendimento(snap.val()));
    });
}

/* ---------- 3) Cotações informativas ---------- */
async function atualizarCotacoes() {
    const box = document.getElementById('ixCotacoes');
    if (!box) return;
    try {
        const r = await fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL,BTC-BRL');
        if (!r.ok) throw new Error('http ' + r.status);
        const d = await r.json();
        const item = (rotulo, c) => {
            const pct = parseFloat(c.pctChange) || 0;
            return `<div class="ix-quote">
                <small>${rotulo}</small>
                <strong>${moeda.format(parseFloat(c.bid))}</strong>
                <span class="${pct >= 0 ? 'ix-up' : 'ix-down'}">${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(2)}%</span>
            </div>`;
        };
        box.innerHTML = `
            <h3 class="ix-title">Cotações</h3>
            <div class="ix-quotes">${item('Dólar (USD)', d.USDBRL)}${item('Bitcoin (BTC)', d.BTCBRL)}</div>
            <p class="ix-note">Cotação informativa, sem relação com os rendimentos dos planos.</p>`;
    } catch (e) {
        box.innerHTML = `<h3 class="ix-title">Cotações</h3>
            <p class="ix-sub">Cotações indisponíveis no momento.</p>
            <p class="ix-note">Cotação informativa, sem relação com os rendimentos dos planos.</p>`;
    }
}

function iniciarCotacoes() {
    atualizarCotacoes();
    setInterval(() => { if (!document.hidden) atualizarCotacoes(); }, 60000);
}

document.addEventListener('DOMContentLoaded', () => {
    iniciarProjecao();
    iniciarMeuRendimento();
    iniciarCotacoes();
});
