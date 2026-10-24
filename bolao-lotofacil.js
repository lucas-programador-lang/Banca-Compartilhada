/* ==========================================================================
   Bolão Lotofácil (aba Início) — substitui o antigo Simulador de lucro.

   ATENÇÃO: este arquivo é só interface. Os números abaixo são EXEMPLOS fixos
   e o botão "Depositar e participar" NÃO cobra nem grava nada. Para valer de
   verdade, o concurso, as cotas vendidas e as participações precisam vir do
   servidor (Firebase RTDB com regras de segurança / função de backend), nunca
   do navegador. Quando a participação estiver pronta, escute o evento
   "bolao:participar" (detail = { numeros, cotas, total }).
   ========================================================================== */
(function () {
    'use strict';

    var raiz = document.getElementById('bolaoLotofacil');
    if (!raiz) return;

    // ---- Dados de exemplo: troque pelos dados reais do concurso ----
    var BOLAO = {
        concurso: 3235,
        sorteio: '2026-10-27',   // AAAA-MM-DD
        premio: 382750,
        valorCota: 5,
        cotasTotal: 1000,
        cotasVendidas: 426,
        qtdNumeros: 15,
        maxPorCompra: 20
    };

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

    $('bolPremio').textContent = BRL.format(BOLAO.premio);
    $('bolEstimado').textContent = BRL.format(BOLAO.premio);
    $('bolConcurso').textContent = textoSorteio();
    $('bolPessoas').textContent = BOLAO.cotasVendidas;
    $('bolDeTotal').textContent = 'de ' + BOLAO.cotasTotal.toLocaleString('pt-BR') + ' cotas';
    $('bolValorCota').textContent = BRL.format(BOLAO.valorCota);
    $('bolDisponiveis').textContent = disponiveis;
    $('bolMeta').textContent = BOLAO.qtdNumeros;

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

    // Participar: só emite o evento. Nada é cobrado ou gravado aqui.
    $('bolParticipar').addEventListener('click', function () {
        var detalhe = {
            numeros: escolhidos.slice().sort(function (a, b) { return a - b; }),
            cotas: qtd,
            total: qtd * BOLAO.valorCota
        };
        document.dispatchEvent(new CustomEvent('bolao:participar', { detail: detalhe }));
        $('bolAviso').textContent = 'Participação ainda não habilitada. Nada foi cobrado.';
    });

    atualizar();
})();
