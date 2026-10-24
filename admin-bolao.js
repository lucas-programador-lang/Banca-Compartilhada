/* ==========================================================================
   Administração do Bolão Lotofácil (painel do admin)

   - Edita os dados do bolão (bolao/atual): concurso, prêmio, valor da cota,
     total de cotas, números por jogo, máximo por compra, encerramento e status.
   - Lista todas as participações do concurso com NOME COMPLETO, números
     escolhidos, cotas, valor, forma de pagamento (Pix/saldo) e data/hora.
   - Mostra pagamentos Pix recebidos "sem vaga" (para reembolso manual).

   Só o admin consegue ler/gravar (as regras do Firebase já bloqueiam os outros).

   Como usar: carregue como módulo na página do admin, depois do auth.js:
       <script type="module" src="admin-bolao.js"></script>
   Se existir um elemento <div id="adminBolao"></div>, o painel aparece nele.
   Se não existir, o painel é criado no fim do <main> (ou do <body>).
   ========================================================================== */
import { auth, db } from './auth.js';
import { ref, onValue, get, update } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js';

(function () {
    'use strict';

    var BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

    function el(tag, cls, txt) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (txt !== undefined && txt !== null) e.textContent = txt;
        return e;
    }

    function pad2(n) { return String(n).padStart(2, '0'); }

    function dataHora(ms) {
        var d = new Date(Number(ms) || 0);
        return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    }

    function paraInputData(ms) {
        var d = new Date(Number(ms) || Date.now());
        return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + 'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    }

    function numero(txt) {
        return parseFloat(String(txt).trim().replace(',', '.'));
    }

    // Usa o modal de confirmação do painel; se não existir, cai no aviso do navegador
    function confirmar(opcoes) {
        if (typeof window.confirmarAcao === 'function') return window.confirmarAcao(opcoes);
        return Promise.resolve(window.confirm(opcoes.titulo));
    }

    // ---------- container ----------
    var raiz = document.getElementById('adminBolao');
    if (!raiz) {
        raiz = document.createElement('section');
        raiz.id = 'adminBolao';
        (document.querySelector('main') || document.body).appendChild(raiz);
    }
    raiz.classList.add('abol');

    // ---------- estilo (neutro: herda as cores do painel) ----------
    if (!document.getElementById('abolEstilo')) {
        var st = document.createElement('style');
        st.id = 'abolEstilo';
        st.textContent =
            '.abol{margin:24px 0;padding:18px;border:1px solid rgba(128,128,128,.35);border-radius:14px;background:rgba(128,128,128,.07);color:inherit;font-family:inherit}' +
            '.abol h2{margin:0 0 4px;font-size:1.25rem}' +
            '.abol h3{margin:22px 0 8px;font-size:1.05rem}' +
            '.abol p{margin:4px 0;font-size:.9rem;opacity:.85}' +
            '.abol__grade{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-top:12px}' +
            '.abol__campo label{display:block;font-size:.78rem;opacity:.8;margin-bottom:4px}' +
            '.abol__campo input,.abol__campo select{width:100%;box-sizing:border-box;padding:9px;border-radius:8px;border:1px solid rgba(128,128,128,.5);background:rgba(128,128,128,.12);color:inherit;font-size:.95rem}' +
            '.abol__campo input:disabled{opacity:.6}' +
            '.abol__campo small{display:block;margin-top:3px;font-size:.72rem;opacity:.7}' +
            '.abol__acoes{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}' +
            '.abol__btn{padding:10px 16px;border:0;border-radius:9px;font-weight:700;cursor:pointer;background:#2fbf71;color:#04210f}' +
            '.abol__btn--sec{background:rgba(128,128,128,.28);color:inherit}' +
            '.abol__btn--perigo{background:#d9534f;color:#fff}' +
            '.abol__btn:disabled{opacity:.55;cursor:not-allowed}' +
            '.abol__msg{margin-top:10px;font-size:.88rem;min-height:1.2em}' +
            '.abol__resumo{display:flex;flex-wrap:wrap;gap:10px;margin:10px 0}' +
            '.abol__chip{padding:8px 12px;border-radius:10px;background:rgba(128,128,128,.16);font-size:.85rem}' +
            '.abol__chip strong{display:block;font-size:1.05rem}' +
            '.abol__rolagem{overflow-x:auto;margin-top:8px}' +
            '.abol table{width:100%;border-collapse:collapse;font-size:.85rem}' +
            '.abol th,.abol td{padding:8px;text-align:left;border-bottom:1px solid rgba(128,128,128,.25);vertical-align:top}' +
            '.abol td.abol__nums{font-family:ui-monospace,Menlo,Consolas,monospace;letter-spacing:.5px}' +
            '.abol__linha{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end}';
        document.head.appendChild(st);
    }

    // ---------- estrutura ----------
    raiz.appendChild(el('h2', '', 'Bolão Lotofácil — administração'));
    raiz.appendChild(el('p', '', 'Altere os dados do bolão, veja os participantes e os números escolhidos.'));

    var campos = {};
    var grade = el('div', 'abol__grade');
    raiz.appendChild(grade);

    function criarCampo(id, rotulo, tipo, dica) {
        var wrap = el('div', 'abol__campo');
        var lb = el('label', '', rotulo); lb.htmlFor = 'abol_' + id;
        var inp;
        if (tipo === 'status') {
            inp = el('select');
            [['aberto', 'Aberto (vendendo)'], ['fechado', 'Fechado (sem vendas)']].forEach(function (o) {
                var op = el('option', '', o[1]); op.value = o[0]; inp.appendChild(op);
            });
        } else {
            inp = el('input');
            inp.type = tipo;
            if (tipo === 'number') inp.step = 'any';
            if (tipo === 'text') inp.inputMode = 'decimal';
        }
        inp.id = 'abol_' + id;
        wrap.appendChild(lb); wrap.appendChild(inp);
        if (dica) wrap.appendChild(el('small', '', dica));
        grade.appendChild(wrap);
        campos[id] = inp;
        inp.addEventListener('input', function () { sujo = true; });
        inp.addEventListener('change', function () { sujo = true; });
        return inp;
    }

    var sujo = false;
    criarCampo('concurso', 'Número do concurso', 'number', 'Mudar o número cria um bolão novo e zera as cotas vendidas.');
    criarCampo('status', 'Situação', 'status');
    criarCampo('premio', 'Prêmio acumulado (R$)', 'number');
    criarCampo('valorCota', 'Valor da cota (R$)', 'number');
    criarCampo('cotasTotal', 'Total de cotas', 'number');
    criarCampo('qtdNumeros', 'Números por jogo', 'number', '15 na Lotofácil. Só pode mudar sem cotas vendidas.');
    criarCampo('maxPorCompra', 'Máximo de cotas por compra', 'number');
    criarCampo('encerraEm', 'Encerramento das vendas', 'datetime-local', 'Depois dessa data e hora ninguém consegue comprar.');

    var vendidasWrap = el('div', 'abol__campo');
    vendidasWrap.appendChild(el('label', '', 'Cotas vendidas'));
    var vendidasVal = el('input'); vendidasVal.disabled = true; vendidasVal.value = '—';
    vendidasWrap.appendChild(vendidasVal);
    vendidasWrap.appendChild(el('small', '', 'Controlado automaticamente pelas compras.'));
    grade.appendChild(vendidasWrap);

    var acoes = el('div', 'abol__acoes');
    var btnSalvar = el('button', 'abol__btn', 'Salvar alterações'); btnSalvar.type = 'button';
    var btnFechar = el('button', 'abol__btn abol__btn--perigo', 'Encerrar vendas agora'); btnFechar.type = 'button';
    var btnReabrir = el('button', 'abol__btn abol__btn--sec', 'Reabrir vendas'); btnReabrir.type = 'button';
    acoes.appendChild(btnSalvar); acoes.appendChild(btnFechar); acoes.appendChild(btnReabrir);
    raiz.appendChild(acoes);
    var msg = el('p', 'abol__msg');
    raiz.appendChild(msg);

    // Participações
    raiz.appendChild(el('h3', '', 'Participações e números escolhidos'));
    var linhaVer = el('div', 'abol__linha');
    var campoVer = el('div', 'abol__campo');
    campoVer.appendChild(el('label', '', 'Ver concurso'));
    var inVer = el('input'); inVer.type = 'number'; inVer.min = '1';
    campoVer.appendChild(inVer);
    var btnVer = el('button', 'abol__btn abol__btn--sec', 'Ver'); btnVer.type = 'button';
    var btnCopiar = el('button', 'abol__btn abol__btn--sec', 'Copiar lista'); btnCopiar.type = 'button';
    linhaVer.appendChild(campoVer); linhaVer.appendChild(btnVer); linhaVer.appendChild(btnCopiar);
    raiz.appendChild(linhaVer);
    var resumo = el('div', 'abol__resumo');
    raiz.appendChild(resumo);
    var rolagem = el('div', 'abol__rolagem');
    raiz.appendChild(rolagem);

    // Pagamentos sem vaga
    raiz.appendChild(el('h3', '', 'Pagamentos Pix sem vaga (reembolso manual)'));
    raiz.appendChild(el('p', '', 'Pix pagos depois que o bolão encerrou ou as cotas acabaram. Nada é creditado sozinho: devolva o valor à pessoa.'));
    var btnSemVaga = el('button', 'abol__btn abol__btn--sec', 'Verificar pagamentos sem vaga'); btnSemVaga.type = 'button';
    raiz.appendChild(btnSemVaga);
    var boxSemVaga = el('div', 'abol__rolagem');
    raiz.appendChild(boxSemVaga);

    // ---------- bolão atual (formulário) ----------
    var atual = null;

    onValue(ref(db, 'bolao/atual'), function (snap) {
        atual = snap.val();
        vendidasVal.value = atual ? String(Number(atual.cotasVendidas) || 0) : '—';
        if (atual && Number(atual.cotasVendidas) > 0) {
            campos.qtdNumeros.disabled = true;
        } else {
            campos.qtdNumeros.disabled = false;
        }
        if (!sujo) preencherFormulario();
        var c = atual ? Number(atual.concurso) : 0;
        if (c && !concursoVisto) { concursoVisto = c; inVer.value = c; ouvirParticipacoes(c); }
        if (!atual) msg.textContent = 'Ainda não existe um bolão cadastrado. Preencha os campos e salve para criar.';
    }, function (erro) {
        msg.textContent = 'Sem permissão para ler o bolão (' + (erro && erro.message ? erro.message : 'erro') + ').';
    });

    function preencherFormulario() {
        var a = atual || {};
        campos.concurso.value = a.concurso !== undefined ? a.concurso : '';
        campos.status.value = a.status === 'aberto' ? 'aberto' : 'fechado';
        campos.premio.value = a.premio !== undefined ? a.premio : '';
        campos.valorCota.value = a.valorCota !== undefined ? a.valorCota : '';
        campos.cotasTotal.value = a.cotasTotal !== undefined ? a.cotasTotal : '';
        campos.qtdNumeros.value = a.qtdNumeros !== undefined ? a.qtdNumeros : 15;
        campos.maxPorCompra.value = a.maxPorCompra !== undefined ? a.maxPorCompra : 20;
        campos.encerraEm.value = a.encerraEm ? paraInputData(a.encerraEm) : '';
    }

    function lerFormulario() {
        var dados = {
            concurso: numero(campos.concurso.value),
            status: campos.status.value === 'aberto' ? 'aberto' : 'fechado',
            premio: numero(campos.premio.value),
            valorCota: numero(campos.valorCota.value),
            cotasTotal: numero(campos.cotasTotal.value),
            qtdNumeros: numero(campos.qtdNumeros.value),
            maxPorCompra: numero(campos.maxPorCompra.value),
            encerraEm: new Date(campos.encerraEm.value).getTime()
        };
        var vendidas = atual ? Number(atual.cotasVendidas) || 0 : 0;
        var mudouConcurso = !atual || Number(atual.concurso) !== dados.concurso;

        if (!Number.isInteger(dados.concurso) || dados.concurso < 1) return { erro: 'O número do concurso deve ser um inteiro a partir de 1.' };
        if (!(dados.premio >= 0)) return { erro: 'Informe o prêmio (zero ou mais).' };
        if (!(dados.valorCota > 0)) return { erro: 'O valor da cota deve ser maior que zero.' };
        if (!Number.isInteger(dados.cotasTotal) || dados.cotasTotal < 1) return { erro: 'O total de cotas deve ser um inteiro a partir de 1.' };
        if (!mudouConcurso && dados.cotasTotal < vendidas) return { erro: 'O total de cotas não pode ser menor que as ' + vendidas + ' já vendidas.' };
        if (!Number.isInteger(dados.qtdNumeros) || dados.qtdNumeros < 1 || dados.qtdNumeros > 25) return { erro: 'Números por jogo: de 1 a 25.' };
        if (!Number.isInteger(dados.maxPorCompra) || dados.maxPorCompra < 1) return { erro: 'O máximo por compra deve ser um inteiro a partir de 1.' };
        if (!campos.encerraEm.value || isNaN(dados.encerraEm)) return { erro: 'Informe a data e hora de encerramento.' };

        dados.valorCota = Math.round(dados.valorCota * 100) / 100;
        dados.premio = Math.round(dados.premio * 100) / 100;
        return { dados: dados, mudouConcurso: mudouConcurso, vendidas: vendidas };
    }

    async function gravar(dados, zerarVendidas) {
        var payload = Object.assign({}, dados);
        if (zerarVendidas) payload.cotasVendidas = 0;
        await update(ref(db, 'bolao/atual'), payload);   // update não mexe nos campos que não enviamos
    }

    btnSalvar.addEventListener('click', async function () {
        var r = lerFormulario();
        if (r.erro) { msg.textContent = r.erro; return; }
        if (atual && r.mudouConcurso) {
            var ok = await confirmar({
                titulo: 'Começar um bolão novo?',
                detalhes: [
                    { rotulo: 'Concurso atual', valor: String(atual.concurso) },
                    { rotulo: 'Novo concurso', valor: String(r.dados.concurso), destaque: true },
                    { rotulo: 'Efeito', valor: 'Zera as cotas vendidas. As participações antigas continuam guardadas.' }
                ],
                textoConfirmar: 'Criar bolão novo',
                perigo: true
            });
            if (!ok) return;
        }
        btnSalvar.disabled = true; msg.textContent = 'Salvando...';
        try {
            await gravar(r.dados, !atual || r.mudouConcurso);
            sujo = false;
            msg.textContent = 'Bolão salvo.';
            if (r.mudouConcurso) { concursoVisto = r.dados.concurso; inVer.value = r.dados.concurso; ouvirParticipacoes(r.dados.concurso); }
        } catch (e) {
            msg.textContent = 'Não foi possível salvar: ' + (e && e.message ? e.message : 'erro');
        }
        btnSalvar.disabled = false;
    });

    btnFechar.addEventListener('click', async function () {
        if (!atual) { msg.textContent = 'Não há bolão cadastrado.'; return; }
        var ok = await confirmar({
            titulo: 'Encerrar vendas agora?',
            detalhes: [{ rotulo: 'Efeito', valor: 'Ninguém mais consegue comprar até você reabrir.' }],
            textoConfirmar: 'Encerrar vendas',
            perigo: true
        });
        if (!ok) return;
        try {
            await update(ref(db, 'bolao/atual'), { status: 'fechado' });
            sujo = false;
            msg.textContent = 'Vendas encerradas.';
        } catch (e) { msg.textContent = 'Erro: ' + (e && e.message ? e.message : ''); }
    });

    btnReabrir.addEventListener('click', async function () {
        if (!atual) { msg.textContent = 'Não há bolão cadastrado.'; return; }
        if (!(Number(atual.encerraEm) > Date.now())) {
            msg.textContent = 'A data de encerramento já passou. Defina uma data futura e salve antes de reabrir.';
            return;
        }
        try {
            await update(ref(db, 'bolao/atual'), { status: 'aberto' });
            sujo = false;
            msg.textContent = 'Vendas reabertas.';
        } catch (e) { msg.textContent = 'Erro: ' + (e && e.message ? e.message : ''); }
    });

    // ---------- participações ----------
    var concursoVisto = null, unsubPart = null, ultimaLista = [];
    var cacheNomes = {};

    function nomeDoUsuario(uid) {
        if (!cacheNomes[uid]) {
            cacheNomes[uid] = get(ref(db, 'usuarios/' + uid + '/nome')).then(function (s) {
                return s.val() || '(sem nome)';
            }).catch(function () { return '(sem acesso)'; });
        }
        return cacheNomes[uid];
    }

    function numerosTxt(lista) {
        return (lista || []).map(function (n) { return pad2(n); }).join(' ');
    }

    function ouvirParticipacoes(c) {
        if (unsubPart) { unsubPart(); unsubPart = null; }
        rolagem.textContent = 'Carregando...';
        unsubPart = onValue(ref(db, 'bolaoParticipacoes/' + c), function (snap) {
            var v = snap.val() || {};
            var lista = Object.keys(v).map(function (k) { var x = v[k]; x._id = k; return x; })
                .sort(function (a, b) { return (b.criadoEm || 0) - (a.criadoEm || 0); });
            ultimaLista = lista;
            desenharParticipacoes(c, lista);
        }, function (erro) {
            rolagem.textContent = 'Sem permissão para ler as participações (' + (erro && erro.message ? erro.message : 'erro') + ').';
        });
    }

    function chip(rotulo, valor) {
        var c = el('div', 'abol__chip');
        c.appendChild(document.createTextNode(rotulo));
        c.appendChild(el('strong', '', valor));
        return c;
    }

    function desenharParticipacoes(concurso, lista) {
        var totalCotas = 0, totalValor = 0, pessoas = {};
        lista.forEach(function (x) {
            totalCotas += Number(x.cotas) || 0;
            totalValor += Number(x.valor) || 0;
            if (x.uid) pessoas[x.uid] = true;
        });
        resumo.textContent = '';
        resumo.appendChild(chip('Concurso', String(concurso)));
        resumo.appendChild(chip('Compras', String(lista.length)));
        resumo.appendChild(chip('Pessoas', String(Object.keys(pessoas).length)));
        resumo.appendChild(chip('Cotas vendidas', String(totalCotas)));
        resumo.appendChild(chip('Arrecadado', BRL.format(totalValor)));

        rolagem.textContent = '';
        if (!lista.length) { rolagem.appendChild(el('p', '', 'Nenhuma participação neste concurso ainda.')); return; }

        var tab = el('table');
        var cab = el('tr');
        ['Data e horário', 'Participante', 'Cotas', 'Valor', 'Pagou com', 'Números escolhidos'].forEach(function (t) { cab.appendChild(el('th', '', t)); });
        var thead = el('thead'); thead.appendChild(cab); tab.appendChild(thead);
        var tb = el('tbody');
        lista.forEach(function (x) {
            var tr = el('tr');
            tr.appendChild(el('td', '', dataHora(x.criadoEm)));
            var tdNome = el('td', '', 'Carregando...');
            nomeDoUsuario(x.uid).then(function (n) { tdNome.textContent = n; x._nome = n; });
            tr.appendChild(tdNome);
            tr.appendChild(el('td', '', String(x.cotas || 0)));
            tr.appendChild(el('td', '', BRL.format(Number(x.valor) || 0)));
            tr.appendChild(el('td', '', x.origem === 'pix' ? 'Pix' : x.origem === 'saldo' ? 'Saldo' : '—'));
            tr.appendChild(el('td', 'abol__nums', numerosTxt(x.numeros)));
            tb.appendChild(tr);
        });
        tab.appendChild(tb);
        rolagem.appendChild(tab);
    }

    btnVer.addEventListener('click', function () {
        var c = parseInt(inVer.value, 10);
        if (!(c >= 1)) { msg.textContent = 'Informe um número de concurso válido.'; return; }
        concursoVisto = c;
        ouvirParticipacoes(c);
    });

    btnCopiar.addEventListener('click', async function () {
        if (!ultimaLista.length) { msg.textContent = 'Não há participações para copiar.'; return; }
        var linhas = [];
        for (var i = 0; i < ultimaLista.length; i++) {
            var x = ultimaLista[i];
            var nome = x._nome || await nomeDoUsuario(x.uid);
            linhas.push(dataHora(x.criadoEm) + ' | ' + nome + ' | ' + (x.cotas || 0) + ' cota(s) | ' + numerosTxt(x.numeros));
        }
        try {
            await navigator.clipboard.writeText(linhas.join('\n'));
            msg.textContent = 'Lista copiada (' + linhas.length + ' compras).';
        } catch (e) {
            msg.textContent = 'Não foi possível copiar automaticamente.';
        }
    });

    // ---------- pagamentos sem vaga ----------
    btnSemVaga.addEventListener('click', async function () {
        boxSemVaga.textContent = 'Carregando...';
        try {
            var snap = await get(ref(db, 'bolaoPix'));
            var tudo = snap.val() || {};
            var itens = [];
            var aguardando = 0;
            Object.keys(tudo).forEach(function (uid) {
                var porChave = tudo[uid] || {};
                Object.keys(porChave).forEach(function (chave) {
                    var r = porChave[chave];
                    if (!r) return;
                    if (r.status === 'aguardando') aguardando++;
                    if (r.status === 'pago_sem_vaga') itens.push({ uid: uid, r: r });
                });
            });
            boxSemVaga.textContent = '';
            boxSemVaga.appendChild(el('p', '', 'Pix ainda aguardando pagamento: ' + aguardando));
            if (!itens.length) { boxSemVaga.appendChild(el('p', '', 'Nenhum pagamento sem vaga.')); return; }
            var tab = el('table');
            var cab = el('tr');
            ['Pago em', 'Participante', 'Valor', 'Concurso', 'Observação'].forEach(function (t) { cab.appendChild(el('th', '', t)); });
            var thead = el('thead'); thead.appendChild(cab); tab.appendChild(thead);
            var tb = el('tbody');
            itens.forEach(function (it) {
                var tr = el('tr');
                tr.appendChild(el('td', '', it.r.pagoEm ? new Date(it.r.pagoEm).toLocaleString('pt-BR') : '—'));
                var tdNome = el('td', '', 'Carregando...');
                nomeDoUsuario(it.uid).then(function (n) { tdNome.textContent = n; });
                tr.appendChild(tdNome);
                tr.appendChild(el('td', '', BRL.format(Number(it.r.total) || 0)));
                tr.appendChild(el('td', '', String(it.r.concurso || '—')));
                tr.appendChild(el('td', '', String(it.r.obsAdmin || '')));
                tb.appendChild(tr);
            });
            tab.appendChild(tb);
            boxSemVaga.appendChild(tab);
        } catch (e) {
            boxSemVaga.textContent = 'Sem permissão para ler os pagamentos. Confira as regras do Firebase (nó bolaoPix com leitura para admin).';
        }
    });
})();
