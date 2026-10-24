/* ==========================================================================
   Modal de Depósito — resumo do plano, máscaras e validação de CPF/telefone.

   Só interface. A abertura/fechamento, a validação final e a geração do Pix
   continuam no script.js (mesmos IDs de antes). Este arquivo:
     - monta o cartão "Plano escolhido" a partir do <select id="modalValorPlano">
     - aplica máscara em CPF e telefone e valida enquanto a pessoa digita
     - só habilita "Gerar QR Code Pix" quando CPF e telefone estão válidos
     - preenche o CPF (se vier do Perfil) e lembra o telefone neste aparelho
   ========================================================================== */
(function () {
    'use strict';

    var overlay = document.getElementById('modalDepositoSistema');
    if (!overlay) return;

    var $ = function (id) { return document.getElementById(id); };
    var select = $('modalValorPlano');
    var inCpf = $('modalDepositoCpf');
    var inTel = $('modalDepositoTelefone');
    var erroCpf = $('dpErroCpf');
    var erroTel = $('dpErroTel');
    var btn = $('btnConfirmarModalDepositar');
    var CHAVE_TEL = 'depositoTelefone';

    var moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

    /* ---------- Resumo do plano ---------- */

    function atualizarPlano() {
        if (!select) return;
        var opt = select.options[select.selectedIndex];
        if (!opt) return;

        var partes = opt.textContent.split('—');
        var nome = (partes[1] || partes[0] || '').trim();
        var detalhe = '';
        var m = nome.match(/\s*\(([^)]+)\)\s*$/);
        if (m) { detalhe = m[1]; nome = nome.replace(m[0], '').trim(); }

        var valor = parseFloat(select.value);
        $('dpPlanoNome').textContent = nome || 'Plano';
        $('dpPlanoValor').textContent = isNaN(valor) ? '—' : moeda.format(valor);
        var det = $('dpPlanoDetalhe');
        det.textContent = detalhe;
        det.hidden = !detalhe;
    }

    /* ---------- Máscaras e validação ---------- */

    function soDigitos(v) { return String(v || '').replace(/\D/g, ''); }

    function mascararCpf(v) {
        var d = soDigitos(v).slice(0, 11);
        return d.replace(/^(\d{3})(\d)/, '$1.$2')
                .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
                .replace(/\.(\d{3})(\d)/, '.$1-$2');
    }

    function mascararTel(v) {
        var d = soDigitos(v).slice(0, 11);
        if (d.length <= 2) return d.length ? '(' + d : '';
        if (d.length <= 6) return '(' + d.slice(0, 2) + ') ' + d.slice(2);
        if (d.length <= 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
        return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
    }

    function cpfValido(v) {
        var d = soDigitos(v);
        if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
        for (var t = 9; t < 11; t++) {
            var soma = 0;
            for (var i = 0; i < t; i++) soma += parseInt(d[i], 10) * (t + 1 - i);
            var dv = ((soma * 10) % 11) % 10;
            if (dv !== parseInt(d[t], 10)) return false;
        }
        return true;
    }

    function telValido(v) {
        var d = soDigitos(v);
        if (d.length < 10 || d.length > 11) return false;
        if (parseInt(d.slice(0, 2), 10) < 11) return false;
        return d.length === 10 || d[2] === '9';
    }

    function marcar(input, erro, ok, completo, tocou) {
        var vazio = !input.value;
        var mostrarErro = !ok && !vazio && (completo || tocou);
        input.classList.toggle('is-invalido', mostrarErro);
        input.classList.toggle('is-valido', ok);
        erro.hidden = !mostrarErro;
    }

    function validar(tocouCpf, tocouTel) {
        var okCpf = cpfValido(inCpf.value);
        var okTel = telValido(inTel.value);
        marcar(inCpf, erroCpf, okCpf, soDigitos(inCpf.value).length === 11, tocouCpf);
        marcar(inTel, erroTel, okTel, soDigitos(inTel.value).length >= 10, tocouTel);
        if (btn) btn.disabled = !(okCpf && okTel);
        return okCpf && okTel;
    }

    inCpf.addEventListener('input', function () {
        inCpf.value = mascararCpf(inCpf.value);
        validar(false, false);
    });
    inTel.addEventListener('input', function () {
        inTel.value = mascararTel(inTel.value);
        validar(false, false);
        if (telValido(inTel.value)) {
            try { localStorage.setItem(CHAVE_TEL, inTel.value); } catch (e) { /* sem storage: tudo bem */ }
        }
    });
    inCpf.addEventListener('blur', function () { validar(true, false); });
    inTel.addEventListener('blur', function () { validar(false, true); });

    /* ---------- Preenchimento automático ---------- */

    function cpfDoPerfil() {
        var tipo = $('perfilTipoPix');
        var chave = $('perfilChavePix');
        var cpfCampo = $('perfilCpf');
        if (tipo && chave && tipo.value === 'CPF' && soDigitos(chave.value).length === 11) return chave.value;
        if (cpfCampo && soDigitos(cpfCampo.value).length === 11) return cpfCampo.value;
        return '';
    }

    function preencher() {
        if (!inCpf.value) {
            var cpf = cpfDoPerfil();
            if (cpf) inCpf.value = mascararCpf(cpf);
        } else {
            inCpf.value = mascararCpf(inCpf.value);
        }
        if (!inTel.value) {
            var tel = '';
            try { tel = localStorage.getItem(CHAVE_TEL) || ''; } catch (e) { tel = ''; }
            if (tel) inTel.value = mascararTel(tel);
        } else {
            inTel.value = mascararTel(inTel.value);
        }
    }

    /* ---------- Reage à abertura do modal (o script.js só liga display:flex) ---------- */

    function aoAbrir() {
        atualizarPlano();
        preencher();
        validar(false, false);
    }

    var estavaAberto = false;
    new MutationObserver(function () {
        var aberto = overlay.style.display === 'flex';
        if (aberto && !estavaAberto) aoAbrir();
        estavaAberto = aberto;
    }).observe(overlay, { attributes: true, attributeFilter: ['style'] });

    if (select) {
        new MutationObserver(atualizarPlano).observe(select, { childList: true });
        select.addEventListener('change', atualizarPlano);
    }

    atualizarPlano();
})();
