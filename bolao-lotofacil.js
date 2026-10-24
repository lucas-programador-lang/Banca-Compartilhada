/* ==========================================================================
   Bolão Lotofácil (aba Início) — versão completa e corrigida.

   - "Depositar e participar": tenta participar; se faltar saldo, abre um
     modal com o QR code Pix (e o copia e cola) e, quando o depósito é
     aprovado, conclui a participação sozinho.
   - Participantes: público, só o primeiro nome (bolaoParticipantes/{concurso}).
   - Extrato: público, só data, horário e cotas (bolaoExtrato/{concurso}).

   Rotas esperadas no Worker:
     POST /api/bolao/participar  { numeros, cotas, chave }
         -> 200 ok | 402 { codigo: 'saldo_insuficiente', falta: <reais> }
     POST /api/bolao/depositar   { valor, chave }
         -> 200 { id, copiaECola, qrCodeBase64? }
   O depósito aprovado deve ficar em depositos/{uid}/{id}/status = 'aprovado'.
   ========================================================================== */
import { auth, db, mostrarToast } from './auth.js';
import { ref, onValue } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js';

var WORKER_BASE_URL = 'https://apidabancacompartilhada.lucas-dev-programador.workers.dev';
var ROTA_PARTICIPAR = '/api/bolao/participar';
var ROTA_DEPOSITAR = '/api/bolao/depositar';

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

    // ---- Chamadas ao Worker ----
    async function chamar(rota, corpo) {
        var token = await auth.currentUser.getIdToken();
        var r = await fetch(WORKER_BASE_URL + rota, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify(corpo)
        });
        var d = await r.json().catch(function () { return {}; });
        return { ok: r.ok, status: r.status, dados: d };
    }

    function novaChave() {
        return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
    }

    function faltaSaldo(res) {
        return res.status === 402 ||
            res.dados.codigo === 'saldo_insuficiente' ||
            /saldo/i.test(String(res.dados.erro || ''));
    }

    // ---- Modal do QR code Pix (criado uma vez, sem depender do HTML da página) ----
    var modal = null, unsubDeposito = null;

    function injetarEstilo() {
        if (document.getElementById('bolPixEstilo')) return;
        var s = document.createElement('style');
        s.id = 'bolPixEstilo';
        s.textContent =
            '.bolpix{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.65)}' +
            '.bolpix[hidden]{display:none}' +
            '.bolpix__box{width:100%;max-width:380px;max-height:92vh;overflow:auto;background:#14181f;color:#f2f4f8;border-radius:16px;padding:20px;box-shadow:0 20px 50px rgba(0,0,0,.5);font-family:inherit}' +
            '.bolpix__box h3{margin:0 0 4px;font-size:1.15rem}' +
            '.bolpix__box p{margin:6px 0;font-size:.9rem;line-height:1.4}' +
            '.bolpix__valor{font-size:1.5rem;font-weight:700;margin:8px 0}' +
            '.bolpix__qr{display:block;width:220px;max-width:70%;height:auto;margin:12px auto;background:#fff;padding:8px;border-radius:12px}' +
            '.bolpix__qr[hidden]{display:none}' +
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

    function criarModal() {
        if (modal) return modal;
        injetarEstilo();
        var overlay = el('div', 'bolpix'); overlay.hidden = true;
        overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true');
        var box = el('div', 'bolpix__box');
        var titulo = el('h3', '', 'Depósito via Pix');
        var info = el('p', '', 'Pague o Pix abaixo. Assim que for aprovado, sua participação é confirmada automaticamente.');
        var valor = el('div', 'bolpix__valor');
        var qr = el('img', 'bolpix__qr'); qr.alt = 'QR code do Pix'; qr.hidden = true;
        var codigo = el('textarea', 'bolpix__codigo'); codigo.readOnly = true;
        var copiar = el('button', 'bolpix__btn', 'Copiar código Pix'); copiar.type = 'button';
        var paguei = el('button', 'bolpix__btn bolpix__btn--sec', 'Já paguei'); paguei.type = 'button';
        var fechar = el('button', 'bolpix__btn bolpix__btn--sec', 'Fechar'); fechar.type = 'button';
        var status = el('p', 'bolpix__status');
        [titulo, info, valor, qr, codigo, copiar, status, paguei, fechar].forEach(function (n) { box.appendChild(n); });
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        copiar.addEventListener('click', function () {
            codigo.select();
            var ok = navigator.clipboard && navigator.clipboard.writeText
                ? navigator.clipboard.writeText(codigo.value)
                : Promise.resolve(document.execCommand('copy'));
            Promise.resolve(ok).then(function () { status.textContent = 'Código copiado!'; })
                .catch(function () { status.textContent = 'Selecione o código e copie manualmente.'; });
        });
        fechar.addEventListener('click', fecharModal);
        overlay.addEventListener('click', function (e) { if (e.target === overlay) fecharModal(); });
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !overlay.hidden) fecharModal(); });

        modal = { overlay: overlay, valor: valor, qr: qr, codigo: codigo, status: status, paguei: paguei };
        return modal;
    }

    function fecharModal() {
        if (unsubDeposito) { unsubDeposito(); unsubDeposito = null; }
        if (modal) modal.overlay.hidden = true;
    }

    // Abre o modal e resolve com true quando o depósito é aprovado (ou false se o usuário fechar).
    function abrirDeposito(valorDeposito, chaveDeposito) {
        return new Promise(function (resolve) {
            var m = criarModal();
            m.valor.textContent = BRL.format(valorDeposito);
            m.codigo.value = '';
            m.qr.hidden = true;
            m.status.textContent = 'Gerando Pix...';
            m.overlay.hidden = false;
            var resolvido = false;
            function concluir(v) {
                if (resolvido) return;
                resolvido = true;
                fecharModal();
                resolve(v);
            }
            // fechar manualmente = desistir (a participação continua pendente de pagamento)
            m.overlay.addEventListener('click', function aoFechar(e) {
                if (e.target === m.overlay) { m.overlay.removeEventListener('click', aoFechar); concluir(false); }
            });
            m.paguei.onclick = function () { concluir(true); };

            chamar(ROTA_DEPOSITAR, { valor: valorDeposito, chave: chaveDeposito }).then(function (res) {
                if (!res.ok || !res.dados.copiaECola) {
                    m.status.textContent = res.dados.erro || 'Não foi possível gerar o Pix agora.';
                    return;
                }
                m.codigo.value = res.dados.copiaECola;
                var b64 = String(res.dados.qrCodeBase64 || '').replace(/^data:image\/png;base64,/, '');
                if (b64 && /^[A-Za-z0-9+\/=]+$/.test(b64)) {
                    m.qr.src = 'data:image/png;base64,' + b64;
                    m.qr.hidden = false;
                }
                m.status.textContent = 'Aguardando o pagamento...';
                if (res.dados.id && auth.currentUser) {
                    var caminho = 'depositos/' + auth.currentUser.uid + '/' + res.dados.id + '/status';
                    unsubDeposito = onValue(ref(db, caminho), function (snap) {
                        var st = snap.val();
                        if (st === 'aprovado' || st === 'aprovado_sem_plano' || st === 'resolvido_sem_plano') {
                            m.status.textContent = 'Pagamento aprovado!';
                            concluir(true);
                        }
                    });
                }
            }).catch(function () {
                m.status.textContent = 'Erro de conexão ao gerar o Pix. Tente novamente.';
            });
        });
    }

    // ---- Depositar e participar ----
    var chaveCompra = null;

    async function tentarParticipar() {
        var res = await chamar(ROTA_PARTICIPAR, { numeros: escolhidos, cotas: qtd, chave: chaveCompra });
        if (res.ok) return { ok: true };
        if (faltaSaldo(res)) {
            var falta = Number(res.dados.falta);
            return { ok: false, saldo: true, falta: falta > 0 ? falta : qtd * BOLAO.valorCota };
        }
        throw new Error(res.dados.erro || 'Não foi possível participar.');
    }

    function sucesso() {
        chaveCompra = null;
        escolhidos = []; qtd = 1;
        $('bolAviso').textContent = 'Participação confirmada!';
        mostrarToast('Participação confirmada no bolão.', 'success');
    }

    $('bolParticipar').addEventListener('click', async function () {
        if (ocupado) return;
        if (!auth.currentUser) {
            mostrarToast('Entre na sua conta para participar.', 'warning');
            return;
        }
        ocupado = true; atualizar();
        // a mesma chave é reutilizada: se a resposta se perder, repetir não cobra duas vezes
        chaveCompra = chaveCompra || novaChave();
        $('bolAviso').textContent = 'Processando...';
        try {
            var r = await tentarParticipar();
            if (r.ok) {
                sucesso();
            } else if (r.saldo) {
                $('bolAviso').textContent = 'Saldo insuficiente. Pague o Pix para participar.';
                var pago = await abrirDeposito(r.falta, novaChave());
                if (!pago) {
                    $('bolAviso').textContent = 'Depósito não concluído. Seus números continuam selecionados.';
                } else {
                    $('bolAviso').textContent = 'Confirmando sua participação...';
                    var r2 = await tentarParticipar();
                    if (r2.ok) sucesso();
                    else $('bolAviso').textContent = 'Pagamento recebido, aguardando o crédito. Toque em Depositar e participar novamente em instantes.';
                }
            }
        } catch (e) {
            $('bolAviso').textContent = e.message;
            mostrarToast(e.message, 'warning');
        }
        ocupado = false;
        atualizar();
    });

    atualizar();
})();
