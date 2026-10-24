/* ==========================================================================
   Bolão Lotofácil (aba Início) — versão com Pix.

   - "Depositar e participar": abre um modal. A pessoa informa CPF e telefone
     (o provedor Pix exige, como no depósito de planos) e gera o QR code Pix.
     Quando o pagamento é confirmado, a participação é registrada sozinha.
     Se tiver saldo suficiente, também pode pagar com o saldo.
   - Participantes: público, só o primeiro nome (bolaoParticipantes/{concurso}).
   - Extrato: público, só data, horário e cotas (bolaoExtrato/{concurso}).

   Rotas do Worker:
     POST /api/bolao/pix/criar   { numeros, cotas, chave, email, cpf, telefone }
     POST /api/bolao/participar  { numeros, cotas, chave }   (paga com saldo)
   ========================================================================== */
import { auth, db, mostrarToast } from './auth.js';
import { ref, onValue } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js';

var WORKER_BASE_URL = 'https://apidabancacompartilhada.lucas-dev-programador.workers.dev';
var ROTA_PARTICIPAR = '/api/bolao/participar';
var ROTA_PIX = '/api/bolao/pix/criar';

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
    var ocupado = false;
    var chaveCompra = null;   // muda sempre que a seleção muda
    var saldoTotal = 0;       // saldo (rendimento + comissão) do usuário logado

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
        $('bolParticipar').disabled = ocupado || !(cheio && disponiveis > 0 && !encerrado);
    }

    // Qualquer mudança na seleção gera uma nova compra (nova chave)
    function selecaoMudou() {
        chaveCompra = null;
        atualizar();
    }

    raiz.querySelector('.bolao__grid').addEventListener('click', function (e) {
        var b = e.target.closest('.bolao__num');
        if (!b || b.disabled) return;
        var n = +b.dataset.n, i = escolhidos.indexOf(n);
        if (i === -1) escolhidos.push(n); else escolhidos.splice(i, 1);
        selecaoMudou();
    });

    $('bolLimpar').addEventListener('click', function () { escolhidos = []; selecaoMudou(); });

    $('bolAleatorio').addEventListener('click', function () {
        var pool = [];
        for (var i = 1; i <= 25; i++) pool.push(i);
        for (var j = pool.length - 1; j > 0; j--) {
            var k = Math.floor(Math.random() * (j + 1)), t = pool[j]; pool[j] = pool[k]; pool[k] = t;
        }
        escolhidos = pool.slice(0, BOLAO.qtdNumeros);
        selecaoMudou();
    });

    $('bolMenos').addEventListener('click', function () { if (qtd > 1) { qtd--; selecaoMudou(); } });
    $('bolMais').addEventListener('click', function () {
        if (qtd < Math.min(BOLAO.maxPorCompra, disponiveis)) { qtd++; selecaoMudou(); }
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

    // Saldo do usuário (para oferecer "Pagar com saldo" só quando der)
    var unsubSaldo = null;
    auth.onAuthStateChanged(function (user) {
        if (unsubSaldo) { unsubSaldo(); unsubSaldo = null; }
        saldoTotal = 0;
        if (!user) return;
        unsubSaldo = onValue(ref(db, 'financeiro/' + user.uid), function (snap) {
            var f = snap.val() || {};
            saldoTotal = Math.max(0, parseFloat(f.saldoRendimento || 0)) + Math.max(0, parseFloat(f.saldoComissao || 0));
        });
    });

    // ---- Abas Participantes e Extrato (leitura pública; tudo via textContent, nunca innerHTML) ----
    var unsubPart = null, unsubExtrato = null, concursoAssinado = null;

    function primeiroNome(x) {
        var n = String(x.primeiroNome || x.nome || '').trim().split(/\s+/)[0];
        return n || 'Participante';
    }

    function cotasTxt(n) {
        n = n || 0;
        return n + ' cota' + (n > 1 ? 's' : '');
    }

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
        var c = BOLAO.concurso;
        if (!c || c === concursoAssinado) return;
        concursoAssinado = c;
        if (unsubPart) unsubPart();
        if (unsubExtrato) unsubExtrato();

        // Participantes: só o primeiro nome + cotas
        unsubPart = onValue(ref(db, 'bolaoParticipantes/' + c), function (snap) {
            var v = snap.val() || {};
            var linhas = Object.keys(v).map(function (k) { return v[k]; })
                .sort(function (a, b) { return (b.cotas || 0) - (a.cotas || 0); })
                .map(function (x) { return { esq: primeiroNome(x), dir: cotasTxt(x.cotas) }; });
            preencherLista('participantes', linhas, 'Nenhum participante para mostrar ainda.');
        }, function () { preencherLista('participantes', [], 'Não foi possível carregar os participantes.'); });

        // Extrato: só data, horário e cotas (sem nome, uid nem números escolhidos)
        unsubExtrato = onValue(ref(db, 'bolaoExtrato/' + c), function (snap) {
            var v = snap.val() || {};
            var linhas = Object.keys(v).map(function (k) { return v[k]; })
                .sort(function (a, b) { return (b.criadoEm || 0) - (a.criadoEm || 0); })
                .slice(0, 100)
                .map(function (x) {
                    var d = new Date(x.criadoEm || 0);
                    return {
                        esq: 'Nova participação',
                        dir: cotasTxt(x.cotas),
                        sub: d.toLocaleDateString('pt-BR') + ' às ' +
                             d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                    };
                });
            preencherLista('extrato', linhas, 'Nenhuma movimentação neste bolão ainda.');
        }, function () { preencherLista('extrato', [], 'Não foi possível carregar o extrato.'); });
    }

    // ---- Chamadas ao Worker (o Worker responde erros em { error }) ----
    async function chamar(rota, corpo) {
        var token = await auth.currentUser.getIdToken();
        var r = await fetch(WORKER_BASE_URL + rota, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify(corpo)
        });
        var d = await r.json().catch(function () { return {}; });
        return { ok: r.ok, status: r.status, dados: d, erro: d.error || d.erro || '' };
    }

    function novaChave() {
        return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
    }

    function cpfValido(cpf) {
        if (!cpf || cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
        var digito = function (q) {
            var soma = 0;
            for (var i = 0; i < q; i++) soma += Number(cpf[i]) * (q + 1 - i);
            var resto = (soma * 10) % 11;
            return resto === 10 ? 0 : resto;
        };
        return digito(9) === Number(cpf[9]) && digito(10) === Number(cpf[10]);
    }

    function sucesso() {
        chaveCompra = null;
        escolhidos = []; qtd = 1;
        $('bolAviso').textContent = 'Participação confirmada!';
        mostrarToast('Participação confirmada no bolão.', 'success');
        atualizar();
    }

    // ---- Modal de pagamento (criado uma vez, sem depender do HTML da página) ----
    var modal = null, unsubPix = null;

    function injetarEstilo() {
        if (document.getElementById('bolPixEstilo')) return;
        var s = document.createElement('style');
        s.id = 'bolPixEstilo';
        s.textContent =
            '.bolpix{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.65)}' +
            '.bolpix[hidden],.bolpix__etapa[hidden],.bolpix__btn[hidden],.bolpix__qr[hidden]{display:none}' +
            '.bolpix__box{width:100%;max-width:380px;max-height:92vh;overflow:auto;background:#14181f;color:#f2f4f8;border-radius:16px;padding:20px;box-shadow:0 20px 50px rgba(0,0,0,.5);font-family:inherit}' +
            '.bolpix__box h3{margin:0 0 4px;font-size:1.15rem}' +
            '.bolpix__box p{margin:6px 0;font-size:.9rem;line-height:1.4}' +
            '.bolpix__valor{font-size:1.5rem;font-weight:700;margin:8px 0}' +
            '.bolpix__label{display:block;margin:10px 0 4px;font-size:.8rem;color:#9fb0c8}' +
            '.bolpix__input{width:100%;box-sizing:border-box;padding:11px;border-radius:10px;border:1px solid #2c3442;background:#0d1015;color:#f2f4f8;font-size:1rem}' +
            '.bolpix__qr{display:block;width:220px;max-width:70%;height:auto;margin:12px auto;background:#fff;padding:8px;border-radius:12px}' +
            '.bolpix__codigo{width:100%;box-sizing:border-box;min-height:70px;resize:none;border-radius:10px;border:1px solid #2c3442;background:#0d1015;color:#f2f4f8;padding:8px;font-size:.75rem;word-break:break-all}' +
            '.bolpix__btn{width:100%;margin-top:8px;padding:12px;border:0;border-radius:10px;font-weight:700;cursor:pointer;background:#2fbf71;color:#04210f;font-size:.95rem}' +
            '.bolpix__btn--sec{background:#232a36;color:#f2f4f8}' +
            '.bolpix__btn:disabled{opacity:.6;cursor:not-allowed}' +
            '.bolpix__status{min-height:1.2em;color:#9fb0c8}';
        document.head.appendChild(s);
    }

    function el(tag, cls, txt) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (txt) e.textContent = txt;
        return e;
    }

    function campo(pai, rotulo, placeholder, modo) {
        pai.appendChild(el('label', 'bolpix__label', rotulo));
        var inp = el('input', 'bolpix__input');
        inp.type = 'text'; inp.placeholder = placeholder; inp.inputMode = modo; inp.autocomplete = 'off';
        pai.appendChild(inp);
        return inp;
    }

    function criarModal() {
        if (modal) return modal;
        injetarEstilo();
        var overlay = el('div', 'bolpix'); overlay.hidden = true;
        overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true');
        var box = el('div', 'bolpix__box');

        box.appendChild(el('h3', '', 'Participar do bolão'));
        var resumo = el('p'); box.appendChild(resumo);
        var valor = el('div', 'bolpix__valor'); box.appendChild(valor);

        // Etapa 1: dados do pagador
        var dados = el('div', 'bolpix__etapa');
        var inCpf = campo(dados, 'CPF do pagador', '000.000.000-00', 'numeric');
        var inTel = campo(dados, 'Telefone com DDD', '(00) 00000-0000', 'tel');
        var btnPix = el('button', 'bolpix__btn', 'Gerar QR Code Pix'); btnPix.type = 'button';
        var btnSaldo = el('button', 'bolpix__btn bolpix__btn--sec', 'Pagar com saldo'); btnSaldo.type = 'button';
        dados.appendChild(btnPix); dados.appendChild(btnSaldo);
        box.appendChild(dados);

        // Etapa 2: QR code
        var pix = el('div', 'bolpix__etapa'); pix.hidden = true;
        pix.appendChild(el('p', '', 'Pague o Pix abaixo. Assim que for confirmado, sua participação é registrada automaticamente.'));
        var qr = el('img', 'bolpix__qr'); qr.alt = 'QR code do Pix'; qr.hidden = true;
        var codigo = el('textarea', 'bolpix__codigo'); codigo.readOnly = true;
        var copiar = el('button', 'bolpix__btn', 'Copiar código Pix'); copiar.type = 'button';
        pix.appendChild(qr); pix.appendChild(codigo); pix.appendChild(copiar);
        box.appendChild(pix);

        var status = el('p', 'bolpix__status'); box.appendChild(status);
        var fechar = el('button', 'bolpix__btn bolpix__btn--sec', 'Fechar'); fechar.type = 'button';
        box.appendChild(fechar);

        overlay.appendChild(box);
        document.body.appendChild(overlay);

        copiar.addEventListener('click', function () {
            codigo.select();
            var p = navigator.clipboard && navigator.clipboard.writeText
                ? navigator.clipboard.writeText(codigo.value)
                : Promise.resolve(document.execCommand('copy'));
            Promise.resolve(p).then(function () { status.textContent = 'Código copiado!'; })
                .catch(function () { status.textContent = 'Selecione o código e copie manualmente.'; });
        });
        fechar.addEventListener('click', fecharModal);
        overlay.addEventListener('click', function (e) { if (e.target === overlay) fecharModal(); });
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !overlay.hidden) fecharModal(); });
        btnPix.addEventListener('click', gerarPix);
        btnSaldo.addEventListener('click', pagarComSaldo);

        modal = { overlay: overlay, resumo: resumo, valor: valor, dados: dados, pix: pix, qr: qr, codigo: codigo,
                  status: status, cpf: inCpf, tel: inTel, btnPix: btnPix, btnSaldo: btnSaldo };
        return modal;
    }

    function fecharModal() {
        if (unsubPix) { unsubPix(); unsubPix = null; }
        if (modal) modal.overlay.hidden = true;
    }

    function abrirModal() {
        var m = criarModal();
        var total = qtd * BOLAO.valorCota;
        m.resumo.textContent = cotasTxt(qtd) + ' · ' + escolhidos.length + ' números escolhidos';
        m.valor.textContent = BRL.format(total);
        m.dados.hidden = false;
        m.pix.hidden = true;
        m.qr.hidden = true;
        m.status.textContent = '';
        m.btnPix.disabled = false;
        m.btnSaldo.disabled = false;
        m.btnSaldo.hidden = !(saldoTotal + 0.001 >= total);
        m.btnSaldo.textContent = 'Pagar com saldo (' + BRL.format(saldoTotal) + ')';
        m.overlay.hidden = false;
    }

    // Pagar com o saldo da conta (rota que já existia)
    async function pagarComSaldo() {
        var m = modal;
        m.btnPix.disabled = true; m.btnSaldo.disabled = true;
        m.status.textContent = 'Processando...';
        chaveCompra = chaveCompra || novaChave();
        try {
            var res = await chamar(ROTA_PARTICIPAR, { numeros: escolhidos, cotas: qtd, chave: chaveCompra });
            if (!res.ok) throw new Error(res.erro || 'Não foi possível participar.');
            fecharModal();
            sucesso();
        } catch (e) {
            m.status.textContent = e.message;
            m.btnPix.disabled = false; m.btnSaldo.disabled = false;
        }
    }

    // Gerar o QR code Pix
    async function gerarPix() {
        var m = modal;
        var cpf = m.cpf.value.replace(/\D/g, '');
        var tel = m.tel.value.replace(/\D/g, '');
        if (!cpfValido(cpf)) { m.status.textContent = 'Informe um CPF válido.'; return; }
        if (tel.length < 10 || tel.length > 13) { m.status.textContent = 'Informe o telefone com DDD.'; return; }
        if (!auth.currentUser) { m.status.textContent = 'Entre na sua conta para participar.'; return; }

        m.btnPix.disabled = true; m.btnSaldo.disabled = true;
        m.status.textContent = 'Gerando Pix...';
        chaveCompra = chaveCompra || novaChave();
        try {
            var res = await chamar(ROTA_PIX, {
                numeros: escolhidos, cotas: qtd, chave: chaveCompra,
                email: auth.currentUser.email || '', cpf: cpf, telefone: tel
            });
            if (!res.ok) throw new Error(res.erro || 'Não foi possível gerar o Pix.');
            if (res.dados.jaPago) { fecharModal(); sucesso(); return; }
            if (!res.dados.pixCode) throw new Error('O Pix não foi gerado. Tente novamente.');

            m.codigo.value = res.dados.pixCode;
            var img = res.dados.pixImage;
            m.qr.src = (typeof img === 'string' && /^(data:image\/|https:\/\/)/.test(img))
                ? img
                : 'https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=' + encodeURIComponent(res.dados.pixCode);
            m.qr.hidden = false;
            m.dados.hidden = true;
            m.pix.hidden = false;
            m.status.textContent = 'Aguardando o pagamento...';
            escutarPagamento(chaveCompra);
        } catch (e) {
            m.status.textContent = e.message;
            m.btnPix.disabled = false; m.btnSaldo.disabled = false;
            chaveCompra = null;   // nada foi cobrado: uma nova tentativa usa uma nova chave
        }
    }

    // Espera o Worker confirmar o pagamento (bolaoPix/{uid}/{chave}/status)
    function escutarPagamento(chave) {
        if (unsubPix) { unsubPix(); unsubPix = null; }
        var caminho = 'bolaoPix/' + auth.currentUser.uid + '/' + chave + '/status';
        unsubPix = onValue(ref(db, caminho), function (snap) {
            var st = snap.val();
            if (st === 'aprovado') {
                fecharModal();
                sucesso();
            } else if (st === 'pago_sem_vaga') {
                modal.status.textContent = 'Pagamento recebido, mas as cotas acabaram ou o bolão encerrou. Fale com o suporte para o reembolso.';
                if (unsubPix) { unsubPix(); unsubPix = null; }
            } else if (st === 'recusado') {
                modal.status.textContent = 'O pagamento não foi confirmado. Feche e tente novamente.';
            }
        });
    }

    // Botão principal
    $('bolParticipar').addEventListener('click', function () {
        if (ocupado) return;
        if (!auth.currentUser) {
            mostrarToast('Entre na sua conta para participar.', 'warning');
            return;
        }
        abrirModal();
    });

    atualizar();
})();
