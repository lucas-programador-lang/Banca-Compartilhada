/* ==========================================================================
   Modal de Saque — teclado numérico, etapas (Valor → Revisar) e resumo.

   Este arquivo cuida SÓ da interface. As regras e o envio do saque continuam
   no script.js, que:
     - chama SaqueUI.abrir({...}) ao abrir o modal (passando saldo, taxa, etc.)
     - chama SaqueUI.fechar() ao fechar
     - lê o valor do campo oculto #modalValorSaque (mesmo id de antes)
     - trata o clique em #btnConfirmarModalSacar (chamada ao Worker)
     - trata os atalhos de #saqueRapidos (Mínimo / 50 / 100 / Tudo)
   ========================================================================== */
(function () {
    'use strict';

    var overlay = document.getElementById('modalSaqueSistema');
    if (!overlay) return;

    var card = overlay.querySelector('.saque-v2');
    var $ = function (id) { return document.getElementById(id); };

    var el = {
        campo: $('modalValorSaque'),
        display: $('saqueDisplay'),
        regra: $('saqueRegra'),
        aviso: $('saqueAviso'),
        liquido: $('saqueLiquido'),
        taxa: $('saqueTaxa'),
        taxaRotulo: $('saqueTaxaRotulo'),
        pixCard: $('saquePixCard'),
        pixTexto: $('saquePixTexto'),
        btnRevisar: $('btnRevisarSaque'),
        btnVoltar: $('btnVoltarSaque'),
        btnConfirmar: $('btnConfirmarModalSacar'),
        teclado: $('saqueTeclado'),
        rapidos: $('saqueRapidos'),
        revValor: $('revValor'),
        revTaxa: $('revTaxa'),
        revTaxaRotulo: $('revTaxaRotulo'),
        revLiquido: $('revLiquido'),
        revPix: $('revPix'),
        btnFechar: $('fecharModalSaque')
    };

    var moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
    var DIAS = ['domingos', 'segundas', 'terças', 'quartas', 'quintas', 'sextas', 'sábados'];

    // Valores padrão (o script.js sobrescreve ao abrir, com os do CONFIG dele)
    var cfg = { saldo: 0, minimo: 32.5, taxa: 0.14, diaPermitido: 0, saquePermitido: true, chave: '', tipoPix: 'CPF' };
    var texto = '';       // o que foi digitado, no formato brasileiro (ex.: "150,5")
    var interno = false;  // evita loop quando nós mesmos disparamos o evento "input"

    /* ---------- Utilidades ---------- */

    function valorAtual() {
        if (!texto) return 0;
        var n = parseFloat(texto.replace(',', '.'));
        return isNaN(n) ? 0 : n;
    }

    function pct() { return Math.round(cfg.taxa * 100) + '%'; }

    function mascararChave(tipo, chave) {
        chave = String(chave || '').trim();
        if (!chave) return '';
        var t = String(tipo || '').toLowerCase();
        var dig = chave.replace(/\D/g, '');

        if (t === 'cpf' || (!t && dig.length === 11)) {
            if (dig.length === 11) return 'CPF •••.•••.' + dig.slice(6, 9) + '-' + dig.slice(9);
            return 'CPF ' + chave;
        }
        if (t.indexOf('mail') !== -1) {
            var partes = chave.split('@');
            if (partes.length === 2) return partes[0].slice(0, 2) + '•••@' + partes[1];
            return chave;
        }
        if (t === 'telefone') {
            return dig.length >= 4 ? 'Telefone ••••• ' + dig.slice(-4) : 'Telefone ' + chave;
        }
        // Chave aleatória e outras
        return chave.length > 10 ? 'Aleatória ' + chave.slice(0, 4) + '••••' + chave.slice(-4) : chave;
    }

    function formatarDisplay() {
        if (!texto) return 'R$ 0,00';
        var partes = texto.split(',');
        var inteiro = partes[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        return 'R$ ' + inteiro + (partes.length > 1 ? ',' + partes[1] : '');
    }

    function problema(valor) {
        if (!cfg.saquePermitido) return 'dia';
        if (!cfg.chave) return 'chave';
        if (valor <= 0) return 'vazio';
        if (valor < cfg.minimo) return 'minimo';
        if (valor > cfg.saldo) return 'saldo';
        return null;
    }

    /* ---------- Atualização da tela ---------- */

    function atualizar() {
        var valor = valorAtual();
        var taxa = valor * cfg.taxa;
        var liquido = valor - taxa;
        var erro = problema(valor);

        el.display.textContent = formatarDisplay();
        el.display.classList.toggle('is-vazio', !texto);
        el.display.classList.toggle('is-longo', formatarDisplay().length > 12);
        el.display.classList.toggle('is-erro', erro === 'minimo' || erro === 'saldo');

        el.liquido.textContent = moeda.format(valor > 0 ? liquido : 0);
        el.taxa.textContent = '- ' + moeda.format(valor > 0 ? taxa : 0);

        // Linha de regra / mensagem de erro
        var regra = 'Mínimo ' + moeda.format(cfg.minimo) + ' · taxa de serviço ' + pct();
        if (erro === 'minimo') regra = 'Valor abaixo do mínimo de ' + moeda.format(cfg.minimo);
        if (erro === 'saldo') regra = 'Valor maior que o saldo disponível';
        el.regra.textContent = regra;
        el.regra.classList.toggle('is-erro', erro === 'minimo' || erro === 'saldo');

        el.btnRevisar.disabled = !!erro;
    }

    function atualizarAviso() {
        var msg = '';
        if (!cfg.saquePermitido) msg = 'Saques liberados apenas aos ' + (DIAS[cfg.diaPermitido] || 'domingos');
        el.aviso.textContent = msg;
        el.aviso.hidden = !msg;
    }

    function atualizarChave() {
        var mascarada = mascararChave(cfg.tipoPix, cfg.chave);
        el.pixCard.classList.toggle('is-missing', !cfg.chave);
        el.pixTexto.textContent = mascarada || 'Cadastrar chave PIX';
        el.revPix.textContent = mascarada || '—';
    }

    function limparChips() {
        if (!el.rapidos) return;
        el.rapidos.querySelectorAll('button').forEach(function (b) { b.classList.remove('ativo'); });
    }

    /* ---------- Escrita no campo oculto (lido pelo script.js) ---------- */

    function gravarCampo() {
        var v = valorAtual();
        el.campo.value = v > 0 ? v.toFixed(2) : '';
        interno = true;
        el.campo.dispatchEvent(new Event('input', { bubbles: true }));
        interno = false;
    }

    // Quando o valor muda por fora (chips Mínimo/50/100/Tudo, tratados no script.js)
    el.campo.addEventListener('input', function () {
        if (interno) return;
        var v = parseFloat(el.campo.value);
        texto = v > 0 ? v.toFixed(2).replace('.', ',') : '';
        atualizar();
    });

    /* ---------- Teclado ---------- */

    function tecla(t) {
        if (t === 'apagar') {
            texto = texto.slice(0, -1);
        } else if (t === ',') {
            if (texto.indexOf(',') !== -1) return;
            texto = (texto || '0') + ',';
        } else {
            var partes = texto.split(',');
            if (partes.length > 1 && partes[1].length >= 2) return;   // no máximo 2 casas
            if (partes.length === 1 && partes[0].length >= 7) return; // limite de tamanho
            texto = (texto === '0') ? t : texto + t;
        }
        limparChips();
        gravarCampo();
        atualizar();
    }

    el.teclado.addEventListener('click', function (e) {
        var btn = e.target.closest('button[data-tecla]');
        if (btn) tecla(btn.getAttribute('data-tecla'));
    });

    // Teclado físico (computador)
    document.addEventListener('keydown', function (e) {
        if (overlay.style.display !== 'flex' && !overlay.classList.contains('ativo')) return;
        if (e.key === 'Escape') { el.btnFechar.click(); return; }
        if (card.getAttribute('data-etapa') !== '1') return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;

        var alvo = e.target;
        if (alvo && alvo.closest && alvo.closest('input, select, textarea')) return;

        if (/^[0-9]$/.test(e.key)) { e.preventDefault(); tecla(e.key); }
        else if (e.key === ',' || e.key === '.') { e.preventDefault(); tecla(','); }
        else if (e.key === 'Backspace') { e.preventDefault(); tecla('apagar'); }
        else if (e.key === 'Enter' && !(alvo && alvo.closest && alvo.closest('button'))) {
            e.preventDefault();
            avancar();
        }
    });

    /* ---------- Etapas ---------- */

    function irParaEtapa(n) {
        card.setAttribute('data-etapa', String(n));
        card.querySelectorAll('[data-painel]').forEach(function (p) {
            p.hidden = p.getAttribute('data-painel') !== String(n);
        });
        card.querySelectorAll('.sv-passo').forEach(function (p) {
            var num = parseInt(p.getAttribute('data-passo'), 10);
            p.classList.toggle('is-ativo', num === n);
            p.classList.toggle('is-feito', num < n);
        });
        card.scrollTop = 0;
    }

    function avancar() {
        var valor = valorAtual();
        if (problema(valor)) return;

        var taxa = valor * cfg.taxa;
        el.revValor.textContent = moeda.format(valor);
        el.revTaxa.textContent = '- ' + moeda.format(taxa);
        el.revLiquido.textContent = moeda.format(valor - taxa);
        irParaEtapa(2);
        if (el.btnConfirmar) el.btnConfirmar.focus({ preventScroll: true });
    }

    el.btnRevisar.addEventListener('click', avancar);
    el.btnVoltar.addEventListener('click', function () { irParaEtapa(1); });

    // Cartão da chave PIX: leva ao Perfil para cadastrar/alterar
    el.pixCard.addEventListener('click', function () {
        el.btnFechar.click();
        var navPerfil = document.querySelector('.sidebar-nav .nav-item[data-target="view-perfil"]');
        if (navPerfil) navPerfil.click();
    });

    /* ---------- API usada pelo script.js ---------- */

    function reiniciar() {
        texto = '';
        el.campo.value = '';
        limparChips();
        irParaEtapa(1);
    }

    window.SaqueUI = {
        abrir: function (dados) {
            for (var k in dados) { if (Object.prototype.hasOwnProperty.call(dados, k)) cfg[k] = dados[k]; }
            var rotulo = 'Taxa (' + pct() + ')';
            el.taxaRotulo.textContent = rotulo;
            el.revTaxaRotulo.textContent = rotulo;
            reiniciar();
            atualizarAviso();
            atualizarChave();
            atualizar();
        },
        fechar: function () {
            reiniciar();
            atualizar();
        }
    };
})();
