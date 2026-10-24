/* ==========================================================================
   Bolão Lotofácil (aba Início) — substitui o antigo Simulador de lucro.

   Lê o concurso de bolao/atual e envia a compra para o Worker
   (POST /api/bolao/participar). Ver bolao-backend/README.md.
   ========================================================================== */
import { auth, db, mostrarToast } from './auth.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { ref, onValue } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js';

var WORKER_BASE_URL = 'https://apidabancacompartilhada.lucas-dev-programador.workers.dev';

(function () {
    'use strict';

    var raiz = document.getElementById('bolaoLotofacil');
    if (!raiz) return;

    // Preenchido por bolao/atual (Firebase). Sem esse nó, o painel fica escondido.
    var BOLAO = { concurso: 0, sorteio: '1970-01-01', premio: 0, valorCota: 0,
                  cotasTotal: 0, cotasVendidas: 0, qtdNumeros: 15, maxPorCompra: 20 };
    raiz.hidden = true;

    var BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
    var $ = function (id) { return document.getElementById(id); };
    var botoes = Array.prototype.slice.call(raiz.querySelectorAll('.bolao__num'));
    var escolhidos = [];
    var qtd = 1;

    function diasAte(iso) {
        var p = iso.split('-');
        var alvo = new Date(+p[0], +p[1] - 1, +p[2]);
        var hoje = new Date(); hoje.setHours(0, 0, 0, 0);
        return Math.round((alvo - hoje) / 86400000);
    }

    function textoSorteio() {
        var d = diasAte(BOLAO.sorteio);
        var p = BOLAO.sorteio.split('-');
        var data = p[2] + '/' + p[1] + '/' + p[0];
        var quando = d > 1 ? 'Sorteio em ' + d + ' dias' : d === 1 ? 'Sorteio amanhã' : d === 0 ? 'Sorteio hoje' : 'Sorteio encerrado';
        return 'Concurso ' + BOLAO.concurso + ' · ' + quando + ' · ' + data;
    }

    var disponiveis = Math.max(BOLAO.cotasTotal - BOLAO.cotasVendidas, 0);
    var encerrado = diasAte(BOLAO.sorteio) < 0;

    function preencherTextos() {
    $('bolPremio').textContent = BRL.format(BOLAO.premio);
    $('bolEstimado').textContent = BRL.format(BOLAO.premio);
    $('bolConcurso').textContent = textoSorteio();
    $('bolPessoas').textContent = BOLAO.cotasVendidas;
    $('bolDeTotal').textContent = 'de ' + BOLAO.cotasTotal.toLocaleString('pt-BR') + ' cotas';
    $('bolValorCota').textContent = BRL.format(BOLAO.valorCota);
    $('bolDisponiveis').textContent = disponiveis;
    $('bolMeta').textContent = BOLAO.qtdNumeros;
    }

    function atualizar() {
        var cheio = escolhidos.length >= BOLAO.qtdNumeros;
        botoes.forEach(function (b) {
            var on = escolhidos.indexOf(+b.dataset.n) !== -1;
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
            b.disabled = cheio && !on;
        });
        $('bolSelecionados').textContent = escolhidos.length + '/' + BOLAO.qtdNumeros;
        $('bolQtd').textContent = qtd;
        $('bolTotal').textContent = BRL.format(qtd * BOLAO.valorCota);
        var max = Math.min(BOLAO.maxPorCompra, disponiveis);
        $('bolMenos').disabled = qtd <= 1;
        $('bolMais').disabled = qtd >= max;
        $('bolParticipar').disabled = !(cheio && disponiveis > 0 && !encerrado);
    }

    raiz.querySelector('.bolao__grid').addEventListener('click', function (e) {
        var b = e.target.closest('.bolao__num');
        if (!b || b.disabled) return;
        var n = +b.dataset.n, i = escolhidos.indexOf(n);
        if (i === -1) escolhidos.push(n); else escolhidos.splice(i, 1);
        atualizar();
    });

    $('bolLimpar').addEventListener('click', function () { escolhidos = []; atualizar(); });

    $('bolAleatorio').addEventListener('click', function () {
        var pool = [];
        for (var i = 1; i <= 25; i++) pool.push(i);
        for (var j = pool.length - 1; j > 0; j--) {
            var k = Math.floor(Math.random() * (j + 1)), t = pool[j]; pool[j] = pool[k]; pool[k] = t;
        }
        escolhidos = pool.slice(0, BOLAO.qtdNumeros);
        atualizar();
    });

    $('bolMenos').addEventListener('click', function () { if (qtd > 1) { qtd--; atualizar(); } });
    $('bolMais').addEventListener('click', function () {
        if (qtd < Math.min(BOLAO.maxPorCompra, disponiveis)) { qtd++; atualizar(); }
    });

    // Abas
    var abas = raiz.querySelectorAll('.bolao__tab');
    abas.forEach(function (aba) {
        aba.addEventListener('click', function () {
            abas.forEach(function (a) {
                var on = a === aba;
                a.classList.toggle('is-active', on);
                a.setAttribute('aria-selected', on ? 'true' : 'false');
            });
            raiz.querySelectorAll('.bolao__panel').forEach(function (p) {
                p.hidden = p.dataset.panel !== aba.dataset.tab;
            });
        });
    });

    // Dados reais: bolao/atual (somente leitura para o navegador)
    onValue(ref(db, 'bolao/atual'), function (snap) {
        var d = snap.val();
        if (!d) { raiz.hidden = true; return; }
        raiz.hidden = false;
        BOLAO.concurso = d.concurso; BOLAO.premio = d.premio; BOLAO.valorCota = d.valorCota;
        BOLAO.cotasTotal = d.cotasTotal; BOLAO.cotasVendidas = d.cotasVendidas;
        BOLAO.qtdNumeros = d.qtdNumeros; BOLAO.maxPorCompra = d.maxPorCompra;
        var dt = new Date(d.encerraEm);
        BOLAO.sorteio = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
        encerrado = d.status !== 'aberto' || Date.now() >= d.encerraEm;
        disponiveis = Math.max(d.cotasTotal - d.cotasVendidas, 0);
        preencherTextos();
        atualizar();
        assinarAbas();
    });

    // ---- Abas Participantes e Extrato (leitura; tudo via textContent, nunca innerHTML) ----
    var unsubPart = null, unsubMinhas = null, concursoAssinado = null, uidAssinado = null;

    function preencherLista(painel, linhas, vazio) {
        var alvo = raiz.querySelector('[data-panel="' + painel + '"]');
        alvo.textContent = '';
        if (!linhas.length) {
            var p = document.createElement('p');
            p.className = 'bolao__vazio';
            p.textContent = vazio;
            alvo.appendChild(p);
            return;
        }
        var ul = document.createElement('ul');
        ul.className = 'bolao__lista';
        linhas.forEach(function (l) {
            var li = document.createElement('li');
            var a = document.createElement('span'); a.textContent = l.esq;
            var b = document.createElement('strong'); b.textContent = l.dir;
            li.appendChild(a); li.appendChild(b);
            if (l.sub) { var c = document.createElement('small'); c.textContent = l.sub; li.appendChild(c); }
            ul.appendChild(li);
        });
        alvo.appendChild(ul);
    }

    function assinarAbas() {
        var c = BOLAO.concurso, uid = auth.currentUser && auth.currentUser.uid;
        if (c && c !== concursoAssinado) {
            if (unsubPart) unsubPart();
            concursoAssinado = c;
            unsubPart = onValue(ref(db, 'bolaoParticipantes/' + c), function (snap) {
                var v = snap.val() || {};
                var linhas = Object.keys(v).map(function (k) { return v[k]; })
                    .sort(function (a, b) { return (b.cotas || 0) - (a.cotas || 0); })
                    .map(function (x) { return { esq: String(x.nome || 'Participante'), dir: (x.cotas || 0) + ' cota' + (x.cotas > 1 ? 's' : '') }; });
                preencherLista('participantes', linhas, 'Nenhum participante para mostrar ainda.');
            }, function () { preencherLista('participantes', [], 'Não foi possível carregar os participantes.'); });
        }
        if (c && uid && (c !== concursoAssinado || uid !== uidAssinado || !unsubMinhas)) {
            if (unsubMinhas) unsubMinhas();
            uidAssinado = uid;
            unsubMinhas = onValue(ref(db, 'bolaoMinhas/' + uid + '/' + c), function (snap) {
                var v = snap.val() || {};
                var linhas = Object.keys(v).map(function (k) { return v[k]; })
                    .sort(function (a, b) { return (b.criadoEm || 0) - (a.criadoEm || 0); })
                    .map(function (x) {
                        return {
                            esq: (x.cotas || 0) + ' cota' + (x.cotas > 1 ? 's' : '') + ' · ' + BRL.format(x.valor || 0),
                            dir: new Date(x.criadoEm || 0).toLocaleDateString('pt-BR'),
                            sub: (x.numeros || []).map(function (n) { return String(n).padStart(2, '0'); }).join(' ')
                        };
                    });
                preencherLista('extrato', linhas, 'Você ainda não tem participações neste bolão.');
            }, function () { preencherLista('extrato', [], 'Não foi possível carregar seu extrato.'); });
        }
    }
    onAuthStateChanged(auth, assinarAbas);

    // Participar: o servidor decide tudo (preço, saldo, cotas). Aqui só enviamos o pedido.
    var chaveCompra = null;
    $('bolParticipar').addEventListener('click', async function () {
        var btn = $('bolParticipar');
        if (btn.disabled || !auth.currentUser) return;
        btn.disabled = true;
        chaveCompra = chaveCompra || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
        $('bolAviso').textContent = 'Processando...';
        try {
            var token = await auth.currentUser.getIdToken();
            var r = await fetch(WORKER_BASE_URL + '/api/bolao/participar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                body: JSON.stringify({ numeros: escolhidos, cotas: qtd, chave: chaveCompra })
            });
            var d = await r.json().catch(function () { return {}; });
            if (!r.ok) throw new Error(d.erro || 'Não foi possível participar.');
            chaveCompra = null;
            escolhidos = []; qtd = 1;
            $('bolAviso').textContent = 'Participação confirmada!';
            mostrarToast('Participação confirmada no bolão.', 'success');
        } catch (e) {
            // mantém a mesma chave: se a resposta se perdeu, repetir não cobra duas vezes
            $('bolAviso').textContent = e.message;
            mostrarToast(e.message, 'warning');
        }
        atualizar();
    });

    atualizar();
})();
