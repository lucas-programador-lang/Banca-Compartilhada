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
        // Tecla: "tic" bem baixinho e grave, quase imperceptível
        tecla: function () {
            var agora = Date.now();
            if (agora - ultimoTick < 60) return;
            ultimoTick = agora;
            nota(620 + Math.random() * 60, 0, 0.035, 0.012, 'sine');
        },
        // Clique: "pop" suave de uma nota só
        clique: function () {
            nota(520, 0, 0.09, 0.025, 'sine');
        },
        voltar: function () {
            nota(430, 0, 0.09, 0.02, 'sine');
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

    // Para desligar/ligar pelo console: somModais.desligar() / somModais.ligar()
    window.somModais = {
        ligar: function () { try { localStorage.removeItem('somModais'); } catch (e) {} },
        desligar: function () { try { localStorage.setItem('somModais', 'off'); } catch (e) {} }
    };
})();
