/* Efeitos sonoros dos modais de Depósito e Saque (gerados no navegador, sem arquivos de áudio) */
(function () {
    'use strict';

    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;

    var ctx = null;
    var ultimoTick = 0;

    function ligado() {
        try { return localStorage.getItem('somModais') !== 'off'; } catch (e) { return true; }
    }

    function audio() {
        if (!ctx) ctx = new Ctx();
        if (ctx.state === 'suspended') ctx.resume();
        return ctx;
    }

    // Toca uma nota curta com ataque rápido e queda suave
    function nota(freq, inicio, duracao, volume, tipo) {
        var c = audio();
        var t = c.currentTime + inicio;
        var osc = c.createOscillator();
        var gan = c.createGain();
        osc.type = tipo || 'sine';
        osc.frequency.setValueAtTime(freq, t);
        gan.gain.setValueAtTime(0.0001, t);
        gan.gain.exponentialRampToValueAtTime(volume, t + 0.008);
        gan.gain.exponentialRampToValueAtTime(0.0001, t + duracao);
        osc.connect(gan);
        gan.connect(c.destination);
        osc.start(t);
        osc.stop(t + duracao + 0.02);
    }

    var sons = {
        // Tecla: tique curto, com leve variação para não ficar repetitivo
        tecla: function () {
            var agora = Date.now();
            if (agora - ultimoTick < 35) return;
            ultimoTick = agora;
            nota(1500 + Math.random() * 300, 0, 0.05, 0.05, 'triangle');
        },
        // Clique: som de "moeda" (duas notas)
        clique: function () {
            nota(1318, 0, 0.09, 0.07, 'triangle');
            nota(1760, 0.06, 0.16, 0.06, 'sine');
        },
        // Abrir o modal: acorde ascendente
        abrir: function () {
            nota(659, 0, 0.18, 0.05, 'sine');
            nota(880, 0.08, 0.2, 0.05, 'sine');
            nota(1175, 0.16, 0.3, 0.05, 'sine');
        },
        voltar: function () {
            nota(988, 0, 0.1, 0.05, 'triangle');
            nota(740, 0.07, 0.16, 0.05, 'sine');
        }
    };

    function tocar(nome) {
        if (!ligado()) return;
        try { sons[nome](); } catch (e) { /* som é só enfeite: nunca pode quebrar o site */ }
    }

    function dentroDoModal(el) {
        return el && el.closest && el.closest('.modal-ouro');
    }

    // Digitação (campos de texto e número)
    document.addEventListener('input', function (e) {
        if (dentroDoModal(e.target) && e.target.matches('input')) tocar('tecla');
    }, true);

    // Cliques em botões e no seletor de plano
    document.addEventListener('click', function (e) {
        var alvo = e.target;
        if (!dentroDoModal(alvo)) return;
        var btn = alvo.closest('button');
        if (btn) { tocar(btn.classList.contains('modal-close') ? 'voltar' : 'clique'); return; }
        if (alvo.matches('select, input')) tocar('clique');
    }, true);

    document.addEventListener('change', function (e) {
        if (dentroDoModal(e.target) && e.target.matches('select')) tocar('clique');
    }, true);

    // Som ao abrir cada modal (quando o fundo escuro fica visível)
    function observar(id) {
        var el = document.getElementById(id);
        if (!el) return;
        var visivel = false;
        function aberto() { return el.classList.contains('ativo') || getComputedStyle(el).display !== 'none'; }
        new MutationObserver(function () {
            var agora = aberto();
            if (agora && !visivel) tocar('abrir');
            visivel = agora;
        }).observe(el, { attributes: true, attributeFilter: ['class', 'style'] });
    }
    document.addEventListener('DOMContentLoaded', function () {
        observar('modalDepositoSistema');
        observar('modalSaqueSistema');
    });

    // Para desligar/ligar pelo console: somModais.desligar() / somModais.ligar()
    window.somModais = {
        ligar: function () { try { localStorage.removeItem('somModais'); } catch (e) {} },
        desligar: function () { try { localStorage.setItem('somModais', 'off'); } catch (e) {} }
    };
})();
