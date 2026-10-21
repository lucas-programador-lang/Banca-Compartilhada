/* ==========================================================================
   Simulador de lucro (aba Início)
   Lê os planos que já estão no index.html (abas Rendimento e Ciclos), então
   os números do simulador acompanham sempre o que está escrito nos cards.
   É apenas uma estimativa visual: não grava nada nem mexe no saldo.
   ========================================================================== */
(function () {
    'use strict';

    var select = document.getElementById('simPlano');
    if (!select) return;

    var BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

    function numero(texto) {
        var limpo = String(texto || '').replace(/[^\d,]/g, '').replace(',', '.');
        var n = parseFloat(limpo);
        return isNaN(n) ? 0 : n;
    }

    function porcentagem(texto, regex) {
        var m = String(texto || '').match(regex);
        return m ? numero(m[1]) : 0;
    }

    function valorDaLinha(card, rotulo) {
        var linhas = card.querySelectorAll('.plan-row');
        for (var i = 0; i < linhas.length; i++) {
            var l = linhas[i].querySelector('.plan-row__label');
            var v = linhas[i].querySelector('.plan-row__value');
            if (l && v && l.textContent.toLowerCase().indexOf(rotulo) !== -1) return v.textContent;
        }
        return '';
    }

    function lerPlanos() {
        var planos = [];

        // Planos de rendimento por dia útil (aba Rendimento)
        document.querySelectorAll('#view-investir .plan-card').forEach(function (card) {
            var titulo = (card.querySelector('.plan-card__title') || {}).textContent || '';
            var badge = (card.querySelector('.plan-badge') || {}).textContent || '';
            var btn = card.querySelector('[data-valor]');
            var aporte = btn ? numero(btn.getAttribute('data-valor')) : 0;
            var pct = porcentagem(badge, /(\d+(?:[.,]\d+)?)\s*%\s*por dia/i);
            var teto = porcentagem(valorDaLinha(card, 'teto'), /(\d+(?:[.,]\d+)?)\s*%/);
            if (!aporte || !pct || !teto) return;
            // Mesma regra do site: paga o rendimento diário até atingir o teto;
            // o último dia paga só o que falta para chegar no teto.
            var diario = aporte * pct / 100;
            var tetoValor = aporte * teto / 100;
            var diasPagos = Math.ceil(tetoValor / diario - 1e-9);
            var ultimoDia = Math.round((tetoValor - diario * (diasPagos - 1)) * 100) / 100;
            var detalhe = 'Teto de ' + teto + '% sobre o aporte (' + BRL.format(tetoValor) + ').';
            if (Math.abs(ultimoDia - diario) > 0.005) {
                detalhe += ' O último dia paga só ' + BRL.format(ultimoDia) + ' para fechar o teto.';
            }
            planos.push({
                grupo: 'rendimento',
                nome: titulo.trim(),
                aporte: aporte,
                diario: diario,
                prazo: diasPagos + ' dias úteis',
                lucro: tetoValor,
                detalhe: detalhe
            });
        });

        // Ciclos de prazo fechado (aba Ciclos)
        document.querySelectorAll('#view-ciclos .plan-card').forEach(function (card) {
            var titulo = (card.querySelector('.plan-card__title') || {}).textContent || '';
            var badge = (card.querySelector('.plan-badge') || {}).textContent || '';
            var btn = card.querySelector('[data-valor]');
            var aporte = btn ? numero(btn.getAttribute('data-valor')) : 0;
            var pct = porcentagem(valorDaLinha(card, 'retorno'), /Capital\s*\+\s*(\d+(?:[.,]\d+)?)\s*%/i);
            if (!aporte || !pct) return;

            var diarioTxt = valorDaLinha(card, 'rendimento di');
            var diario = diarioTxt ? numero(diarioTxt.replace(/ao dia/i, '')) : 0;

            var prazo = '—';
            var dias = badge.match(/(\d+)\s*dias/i);
            var horas = badge.match(/(\d+)\s*horas/i);
            if (dias) prazo = dias[1] + ' dias';
            else if (horas) prazo = horas[1] + ' horas';

            var retornoFinal = aporte + aporte * pct / 100;
            planos.push({
                grupo: 'ciclo',
                nome: titulo.trim(),
                aporte: aporte,
                diario: diario,
                prazo: prazo,
                lucro: aporte * pct / 100,
                detalhe: 'Retorno final de ' + BRL.format(retornoFinal) + ' (aporte + ' + pct + '%) menos o aporte de ' + BRL.format(aporte) + '.'
            });
        });

        return planos;
    }

    var planos = lerPlanos();
    var painel = document.getElementById('simuladorLucro');

    if (!planos.length) {
        if (painel) painel.hidden = true;
        return;
    }

    // Preenche o seletor, separado por grupos
    var grupos = {
        rendimento: document.createElement('optgroup'),
        ciclo: document.createElement('optgroup')
    };
    grupos.rendimento.label = 'Planos de rendimento';
    grupos.ciclo.label = 'Ciclos';

    planos.forEach(function (p, i) {
        var op = document.createElement('option');
        op.value = String(i);
        op.textContent = p.nome + ' — ' + BRL.format(p.aporte);
        grupos[p.grupo].appendChild(op);
    });
    if (grupos.rendimento.children.length) select.appendChild(grupos.rendimento);
    if (grupos.ciclo.children.length) select.appendChild(grupos.ciclo);

    var el = {
        aporte: document.getElementById('simAporte'),
        diario: document.getElementById('simDiario'),
        prazo: document.getElementById('simPrazo'),
        lucro: document.getElementById('simLucro'),
        detalhe: document.getElementById('simDetalhe')
    };

    function animar(node) {
        node.classList.remove('sim-pop');
        void node.offsetWidth; // reinicia a animação
        node.classList.add('sim-pop');
    }

    function atualizar() {
        var p = planos[parseInt(select.value, 10)] || planos[0];
        el.aporte.textContent = BRL.format(p.aporte);
        el.diario.textContent = p.diario ? BRL.format(p.diario) : '—';
        el.prazo.textContent = p.prazo;
        el.lucro.textContent = BRL.format(p.lucro);
        if (el.detalhe) el.detalhe.textContent = p.detalhe || '';
        [el.aporte, el.diario, el.prazo, el.lucro].forEach(animar);
    }

    select.addEventListener('change', atualizar);
    select.selectedIndex = 0;
    atualizar();
})();
