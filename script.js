import { auth, db, mostrarToast } from './auth.js';
import { ref, push, set, onValue, update } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { calcularTerminoPrevisto } from './termino-plano.js';

const CONFIG = {
    VALOR_SAQUE_MINIMO: 32.50,
    DIA_SAQUE_PERMITIDO: 0, // 0 = Domingo (Padrão)
    TAXA_SAQUE_PERCENTUAL: 0.14,
    VALORES_PLANOS_PERMITIDOS: [10, 15, 30, 50, 60, 100, 150, 200, 300, 450, 500, 1000],
    PLANOS_DE_CICLO: [10, 15, 60, 150, 200, 450],
    WORKER_BASE_URL: 'https://apidabancacompartilhada.lucas-dev-programador.workers.dev',
};

const formatadorMoeda = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
});

const formatadorData = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
});

const formatadorDataHoraCurto = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
});

function obterDiaSemanaBrasilia() {
    const brasiliaMs = Date.now() - 3 * 60 * 60 * 1000;
    return new Date(brasiliaMs).getUTCDay();
}

function getEl(id) {
    return document.getElementById(id);
}

function escapeHTML(texto) {
    const textoLimpo = (texto !== null && texto !== undefined) ? String(texto) : '';
    return textoLimpo.replace(/[&<>"']/g, function(c) {
        return {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
        }[c];
    });
}

function setBotaoCarregando(botao, carregando, textoCarregando = 'Enviando...') {
    if (!botao) return;
    if (carregando) {
        botao.dataset.textoOriginal = botao.dataset.textoOriginal || botao.innerText;
        botao.disabled = true;
        botao.innerText = textoCarregando;
    } else {
        botao.disabled = false;
        botao.innerText = botao.dataset.textoOriginal || botao.innerText;
    }
}

function atualizarPainel(dados) {
    const saldoTotal = parseFloat(dados.saldoRendimento || 0) + parseFloat(dados.saldoComissao || 0);
    const campos = {
        saldoDisponivel: saldoTotal,
        rendimentoTotal: dados.rendimento,
        comissaoTotal: dados.comissao,
        comissaoTotalEquipe: dados.comissao,
    };

    for (const [idCampo, valor] of Object.entries(campos)) {
        const el = getEl(idCampo);
        if (el) el.innerText = formatadorMoeda.format(valor || 0);
    }
}

function cpfValidoNoSite(cpf) {
    if (!cpf || cpf.length !== 11) return false;
    if (cpf === '00000000000' || cpf === '11111111111' || cpf === '22222222222' || 
        cpf === '33333333333' || cpf === '44444444444' || cpf === '55555555555' || 
        cpf === '66666666666' || cpf === '77777777777' || cpf === '88888888888' || cpf === '99999999999') return false;
        
    const digito = function(quantidade) {
        let soma = 0;
        for (let i = 0; i < quantidade; i++) soma += Number(cpf[i]) * (quantidade + 1 - i);
        const resto = (soma * 10) % 11;
        return resto === 10 ? 0 : resto;
    };
    return digito(9) === Number(cpf[9]) && digito(10) === Number(cpf[10]);
}

function inicializarPerfilUsuario(userId) {
    const perfilTipoPix = getEl('perfilTipoPix');
    const perfilChavePix = getEl('perfilChavePix');
    const perfilNome = getEl('perfilNome');
    const perfilCpf = getEl('perfilCpf');
    const perfilCpfGrupo = getEl('perfilCpfGrupo');
    const btnSalvarPerfil = getEl('btnSalvarPerfil');

    if (!btnSalvarPerfil) return;

    const userRef = ref(db, 'usuarios/' + userId);
    let dadosAtuais = {};

    const tipoEhCpf = function(tipo) {
        return String(tipo || '').trim().toLowerCase() === 'cpf';
    };

    const atualizarCampoCpf = function() {
        if (!perfilCpfGrupo) return;
        const tipoAtual = dadosAtuais.chavePix
            ? dadosAtuais.tipoPix
            : (perfilTipoPix ? perfilTipoPix.value : dadosAtuais.tipoPix);
        perfilCpfGrupo.style.display = tipoEhCpf(tipoAtual) ? 'none' : 'block';
    };

    if (perfilTipoPix && !perfilTipoPix.dataset.listenerCpf) {
        perfilTipoPix.addEventListener('change', atualizarCampoCpf);
        perfilTipoPix.dataset.listenerCpf = 'true';
    }

    onValue(userRef, function(snapshot) {
        const dados = snapshot.val();
        if (!dados) return;
        dadosAtuais = dados;

        if (perfilNome && dados.nome && !perfilNome.value) perfilNome.value = dados.nome;
        if (perfilTipoPix && dados.tipoPix) perfilTipoPix.value = dados.tipoPix;

        const chaveTravada = !!dados.chavePix;
        if (chaveTravada) {
            if (perfilChavePix) {
                perfilChavePix.value = dados.chavePix;
                perfilChavePix.disabled = true;
                perfilChavePix.classList.add('is-locked');
            }
            if (perfilTipoPix) {
                perfilTipoPix.disabled = true;
                perfilTipoPix.classList.add('is-locked');
            }
        }

        const cpfTravado = !!dados.cpf;
        if (perfilCpf && cpfTravado) {
            perfilCpf.value = dados.cpf;
            perfilCpf.disabled = true;
            perfilCpf.classList.add('is-locked');
        }
        atualizarCampoCpf();

        const precisaCpf = !tipoEhCpf(dados.tipoPix);
        const faltaAlgo = !chaveTravada || (precisaCpf && !cpfTravado);
        btnSalvarPerfil.style.display = faltaAlgo ? '' : 'none';
    });

    if (!btnSalvarPerfil.dataset.listenerAtivo) {
        btnSalvarPerfil.addEventListener('click', async function() {
            const chaveJaSalva = !!dadosAtuais.chavePix;
            const novoNome = perfilNome ? perfilNome.value.trim() : '';
            const novoTipoPix = perfilTipoPix ? perfilTipoPix.value : '';
            const novaChavePix = perfilChavePix ? perfilChavePix.value.trim() : '';

            const tipoFinal = chaveJaSalva ? dadosAtuais.tipoPix : novoTipoPix;
            const precisaGravarCpf = !tipoEhCpf(tipoFinal) && !dadosAtuais.cpf;
            const cpfDigitos = perfilCpf ? perfilCpf.value.replace(/\D/g, '') : '';

            if (!chaveJaSalva && !novaChavePix) {
                mostrarToast('Por favor, informe a sua chave PIX.', 'warning');
                return;
            }
            if (precisaGravarCpf && !cpfValidoNoSite(cpfDigitos)) {
                mostrarToast('Informe um CPF válido do titular da chave PIX.', 'warning');
                return;
            }

            setBotaoCarregando(btnSalvarPerfil, true, 'Salvando...');
            try {
                const updates = {};
                if (!chaveJaSalva) {
                    if (novoNome) updates['nome'] = novoNome;
                    updates['tipoPix'] = novoTipoPix;
                    updates['chavePix'] = novaChavePix;
                }
                if (precisaGravarCpf) updates['cpf'] = cpfDigitos;

                await update(userRef, updates);
                mostrarToast(
                    chaveJaSalva
                        ? 'CPF do titular cadastrado com sucesso!'
                        : 'Chave PIX cadastrada com sucesso! Ela não poderá ser alterada.',
                    'success'
                );
            } catch (error) {
                console.error('Erro ao salvar perfil:', error);
                mostrarToast('Erro ao salvar perfil: ' + error.message, 'error');
            } finally {
                setBotaoCarregando(btnSalvarPerfil, false);
            }
        });
        btnSalvarPerfil.dataset.listenerAtivo = 'true';
    }
}

function contarDiasRendimento(dataAtivacao, agora) {
    const DIA_MS = 24 * 60 * 60 * 1000;
    const BRASILIA_MS = 3 * 60 * 60 * 1000;
    const blocosCompletos = Math.floor((agora.getTime() - dataAtivacao.getTime()) / DIA_MS);
    let dias = 0;
    for (let k = 1; k <= Math.min(blocosCompletos, 5000); k++) {
        const diaDaSemana = new Date(dataAtivacao.getTime() + k * DIA_MS - BRASILIA_MS).getUTCDay();
        if (diaDaSemana >= 1 && diaDaSemana <= 5) dias++;
    }
    return dias;
}

function calcularEstadoPlano(plano) {
    const valor = parseFloat(plano.valor || 0);
    const percentualDiario = parseFloat(plano.percentualDiario || 0);
    const tetoPercentual = parseFloat(plano.tetoPercentual || 0);

    const dataAtivacao = new Date(plano.dataAtivacao || Date.now());
    const agora = new Date();
    const cancelado = plano.status === 'cancelado_pelo_admin';
    const diasCorridos = (isNaN(dataAtivacao.getTime()) || cancelado) ? 0 : contarDiasRendimento(dataAtivacao, agora);

    const rendimentoDiario = valor * percentualDiario;
    const tetoValor = valor * tetoPercentual;
    const rendimentoAcumulado = cancelado
        ? parseFloat(plano.valorCreditado || 0)
        : Math.min(rendimentoDiario * diasCorridos, tetoValor);
    const finalizado = !cancelado && (plano.status === 'finalizado' || (rendimentoAcumulado >= tetoValor && tetoValor > 0));

    return {
        dataAtivacao,
        rendimentoDiario,
        rendimentoAcumulado,
        finalizado,
        cancelado,
    };
}

/* ==========================================================================
   Sincronização Automática: Da Carteira -> Para o Saldo Disponível
   ========================================================================== */
let sincronizandoRendimentos = false;
let ultimaSincronizacaoMs = 0;

function precisaSincronizarSaldo(planosObj) {
    if (!planosObj) return false;
    const diaSemana = obterDiaSemanaBrasilia();
    if (diaSemana === 0 || diaSemana === 6) return false; // Sábado e domingo não creditam

    for (const plano of Object.values(planosObj)) {
        if (!plano || plano.status === 'finalizado' || plano.status === 'cancelado_pelo_admin') continue;

        const valor = parseFloat(plano.valor || 0);
        const jaCreditado = Math.round((parseFloat(plano.valorCreditado || 0)) * 100) / 100;
        const estado = calcularEstadoPlano(plano);
        const alvoAcumulado = Math.round(estado.rendimentoAcumulado * 100) / 100;

        const ehPlanoDeCiclo = CONFIG.PLANOS_DE_CICLO.includes(valor);

        if (ehPlanoDeCiclo) {
            // Plano de ciclo só precisa cair no saldo disponível quando atingir 100% do ciclo
            if (estado.finalizado && plano.status !== 'finalizado') {
                return true;
            }
        } else {
            // Planos Banca (30, 50, 100, 300, 500, 1000): se na Carteira já rendeu mais do que foi creditado no Saldo Disponível, sincroniza!
            if (alvoAcumulado - jaCreditado >= 0.01) {
                return true;
            }
        }
    }
    return false;
}

async function sincronizarRendimentosComSaldoDisponivel(planosObj) {
    if (sincronizandoRendimentos) return;
    if (Date.now() - ultimaSincronizacaoMs < 15000) return; // Evita chamadas repetidas em menos de 15s
    if (!auth.currentUser) return;
    if (!precisaSincronizarSaldo(planosObj)) return;

    sincronizandoRendimentos = true;
    ultimaSincronizacaoMs = Date.now();

    try {
        const idToken = await auth.currentUser.getIdToken();
        await fetch(`${CONFIG.WORKER_BASE_URL}/api/rendimentos/sincronizar`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`,
            },
        });
    } catch (erro) {
        console.warn('Não foi possível sincronizar rendimentos em segundo plano:', erro);
    } finally {
        sincronizandoRendimentos = false;
    }
}

function montarLinhaPlano(plano, estado) {
    const valor = parseFloat(plano.valor || 0);

    let statusTexto = 'Ativo';
    let statusClasse = 'plan-row__value plan-row__value--positive';
    if (estado.cancelado) {
        statusTexto = 'Cancelado';
        statusClasse = 'plan-row__value plan-row__value--negative';
    } else if (estado.finalizado) {
        statusTexto = 'Finalizado';
        statusClasse = 'plan-row__value';
    }

    const dataHoraAtivacao = !isNaN(estado.dataAtivacao.getTime())
        ? formatadorDataHoraCurto.format(estado.dataAtivacao)
        : '—';

    // Data de previsão de término / expiração
    const terminoPrevistoIso = calcularTerminoPrevisto(plano) || plano.dataExpiracao;
    const terminoPrevistoData = terminoPrevistoIso ? new Date(terminoPrevistoIso) : null;
    const dataExpiracaoStr = (terminoPrevistoData && !isNaN(terminoPrevistoData.getTime()))
        ? formatadorDataHoraCurto.format(terminoPrevistoData)
        : '—';

    const ultimoRend = plano.ultimoRendimentoEm ? new Date(plano.ultimoRendimentoEm) : null;
    const textoUltimoRend = (ultimoRend && !isNaN(ultimoRend.getTime()))
        ? `<div style="font-size: 0.75rem; opacity: 0.75; margin-top: 2px;">Últ. pago: ${formatadorDataHoraCurto.format(ultimoRend)}</div>`
        : '';

    return `
        <tr>
            <td>${dataHoraAtivacao}${textoUltimoRend}</td>
            <td>${formatadorMoeda.format(valor)}</td>
            <td>${formatadorMoeda.format(estado.rendimentoDiario)}</td>
            <td>${formatadorMoeda.format(estado.rendimentoAcumulado)}</td>
            <td><strong>${dataExpiracaoStr}</strong></td>
            <td><span class="${statusClasse}" style="font-weight: 600;">${statusTexto}</span></td>
        </tr>
    `;
}

function renderizarTabelaCarteira(planosObj) {
    const tbodyRendimento = getEl('tabelaPlanosCarteira');
    const tbodyCiclos = getEl('tabelaCiclosCarteira');
    const elTotalInvestido = getEl('totalInvestidoPlanos');
    const elTotalRendimento = getEl('totalRendimentoPlanos');
    if (!tbodyRendimento && !tbodyCiclos) return;

    const planos = planosObj
        ? Object.entries(planosObj).map(function([id, dados]) { return { id, ...dados }; })
        : [];

    planos.sort(function(a, b) { return new Date(b.dataAtivacao || 0) - new Date(a.dataAtivacao || 0); });

    let totalInvestido = 0;
    let totalRendimento = 0;
    const linhasRendimento = [];
    const linhasCiclos = [];

        planos.forEach(function(plano) {
        const valor = parseFloat(plano.valor || 0);
        const estado = calcularEstadoPlano(plano);

        // Os totais somam TODOS os planos, inclusive os antigos que não aparecem na lista
        if (!estado.cancelado) {
            totalInvestido += valor;
            totalRendimento += estado.rendimentoAcumulado;
        }

        // Finalizados ou cancelados há mais de 30 dias saem só da lista visível
        if (estado.finalizado || estado.cancelado) {
            const terminoIso = calcularTerminoPrevisto(plano) || plano.dataExpiracao || plano.dataAtivacao;
            if (!estaNoPrazoExibicao(terminoIso)) return;
        }

        const linha = montarLinhaPlano(plano, estado);
        if (CONFIG.PLANOS_DE_CICLO.includes(valor)) linhasCiclos.push(linha);
        else linhasRendimento.push(linha);
    });

    if (tbodyRendimento) {
        tbodyRendimento.innerHTML = linhasRendimento.length
            ? linhasRendimento.join('')
            : '<tr><td colspan="6" class="table-empty">Nenhum plano de rendimento ativo no momento.</td></tr>';
    }
    if (tbodyCiclos) {
        tbodyCiclos.innerHTML = linhasCiclos.length
            ? linhasCiclos.join('')
            : '<tr><td colspan="6" class="table-empty">Nenhum ciclo ativo no momento.</td></tr>';
    }

    if (elTotalInvestido) elTotalInvestido.innerText = formatadorMoeda.format(totalInvestido);
    if (elTotalRendimento) elTotalRendimento.innerText = formatadorMoeda.format(totalRendimento);
}

function inicializarCarteiraUsuario(userId) {
    if (!getEl('tabelaPlanosCarteira') && !getEl('tabelaCiclosCarteira')) return;

    const planosRef = ref(db, 'planos/' + userId);
    onValue(planosRef, function(snapshot) {
        const planosVal = snapshot.val();
        renderizarTabelaCarteira(planosVal);
        atualizarDisponibilidadePlanos(planosVal);
        sincronizarRendimentosComSaldoDisponivel(planosVal);
    });
}

function atualizarDisponibilidadePlanos(planosObj) {
    const planos = planosObj ? Object.values(planosObj) : [];
    
    const ativos = planos.filter(function(p) {
        return p.status !== 'finalizado' && p.status !== 'cancelado_pelo_admin';
    });
    const valoresAtivos = new Set(ativos.map(function(p) { return parseFloat(p.valor); }));

    const planosIlimitados = [15, 60, 150, 200, 450];

    const botoes = document.querySelectorAll('.btn-escolher-plano');
    for (let i = 0; i < botoes.length; i++) {
        const btn = botoes[i];
        const valor = parseFloat(btn.getAttribute('data-valor'));
        
        if (planosIlimitados.includes(valor)) {
            btn.disabled = false;
            btn.textContent = 'APLICAR AGORA';
            continue;
        }

        if (valoresAtivos.has(valor)) {
            btn.disabled = true;
            btn.textContent = 'PLANO JÁ ATIVO';
        } else {
            btn.disabled = false;
            btn.textContent = 'APLICAR AGORA';
        }
    }
}

// Classificação dos lançamentos do extrato pelo texto (tipo, origem e descrição).
// Para mudar em qual tabela cada lançamento cai, ajuste as palavras abaixo.
const CATEGORIAS_CONTA = [
    { chave: 'saque',    rotulo: 'Saque',    regex: /saque/ },
    { chave: 'deposito', rotulo: 'Depósito', regex: /deposit/ },
    { chave: 'comissao', rotulo: 'Comissão', regex: /comiss/ },
    { chave: 'missao',   rotulo: 'Missão',   regex: /missao|missoes/ },
    { chave: 'ajuste',   rotulo: 'Ajuste',   regex: /administra|ajuste/ },
];

function normalizarTexto(texto) {
    return String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function classificarRegistroExtrato(registro) {
    // 1) Campo "tipo" gravado pelo servidor ('rendimento' ou 'ciclo') manda sempre.
    const tipo = normalizarTexto(registro.tipo);
    if (tipo === 'ciclo') return { grupo: 'ciclos' };
    if (tipo === 'rendimento') return { grupo: 'rendimento' };

    // 2) Movimentações da conta pelo texto (tipo, origem e descrição)
    const texto = normalizarTexto([tipo, registro.origem, registro.descricao].join(' '));
    for (let i = 0; i < CATEGORIAS_CONTA.length; i++) {
        if (CATEGORIAS_CONTA[i].regex.test(texto)) return { grupo: 'conta', categoria: CATEGORIAS_CONTA[i] };
    }
    if (parseFloat(registro.valor || 0) < 0) return { grupo: 'conta', categoria: { chave: 'ajuste', rotulo: 'Ajuste' } };

    // 3) O resto é rendimento. Os lançamentos antigos ("Rendimento diário / Retorno final
    //    de ciclo") somavam planos e ciclos juntos e ficam aqui.
    return { grupo: 'rendimento' };
}

function badgeStatus(texto, classe) {
    return `<span class="status-badge ${classe}">${escapeHTML(texto)}</span>`;
}

function statusDoRegistroExtrato(registro, valor) {
    if (registro.status === 'pendente') return badgeStatus('Pendente', 'status-pendente');
    if (registro.status === 'processando') return badgeStatus('Processando', 'status-pendente');
    if (registro.status === 'pago') return badgeStatus('Pago', 'status-aprovado');
    if (valor < 0 && !registro.status) return badgeStatus('Debitado', 'status-recusado');
    return badgeStatus('Creditado', 'status-aprovado');
}

function inicializarExtratoUsuario(userId) {
    const tbRendimento = getEl('tabelaExtratoRendimento');
    const tbCiclos = getEl('tabelaExtratoCiclos');
    const tbConta = getEl('tabelaExtratoConta');
    if (!tbRendimento && !tbCiclos && !tbConta) return;

    const formatadorMesAno = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' });
    const formatadorDataHora = new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    });

    const estado = { extrato: [], depositos: [], saques: [], depositosErro: false, saquesErro: false };

    function paraLista(obj) {
        return obj ? Object.entries(obj).map(function([id, info]) { return { id, ...info }; }) : [];
    }

    function dataValida(valor) {
        const d = new Date(valor || Date.now());
        return isNaN(d.getTime()) ? new Date() : d;
    }

    function linhaRendimento(item) {
        let mesAno = formatadorMesAno.format(item.data);
        mesAno = mesAno.charAt(0).toUpperCase() + mesAno.slice(1);
        const classeValor = item.valor < 0 ? 'plan-row__value plan-row__value--negative' : 'plan-row__value plan-row__value--positive';
        return `
            <tr>
                <td>${formatadorDataHora.format(item.data)}</td>
                <td>${mesAno}</td>
                <td>${escapeHTML(item.descricao) || '—'}</td>
                <td class="${classeValor}">${formatadorMoeda.format(item.valor)}</td>
                <td>${item.statusHtml}</td>
            </tr>
        `;
    }

    function linhaConta(item) {
        const classeValor = item.valor < 0 ? 'plan-row__value plan-row__value--negative' : 'plan-row__value plan-row__value--positive';
        return `
            <tr>
                <td>${formatadorDataHora.format(item.data)}</td>
                <td><span class="tipo-badge tipo-badge--${item.categoria.chave}">${escapeHTML(item.categoria.rotulo)}</span></td>
                <td>${escapeHTML(item.descricao) || '—'}</td>
                <td class="${classeValor}">${formatadorMoeda.format(item.valor)}</td>
                <td>${item.statusHtml}</td>
            </tr>
        `;
    }

    function preencher(tbody, itens, montar, vazio) {
        if (!tbody) return;
        itens.sort(function(a, b) { return b.data - a.data; });
        tbody.innerHTML = itens.length
            ? itens.map(montar).join('')
            : `<tr><td colspan="5" class="table-empty">${vazio}</td></tr>`;
    }

    function renderizar() {
        const rendimento = [];
        const ciclos = [];
        const conta = [];

        // Lançamentos do extrato
        estado.extrato.forEach(function(registro) {
            const valor = parseFloat(registro.valor || 0);
            const classe = classificarRegistroExtrato(registro);
            const item = {
                data: dataValida(registro.data),
                descricao: registro.descricao,
                valor: valor,
                statusHtml: statusDoRegistroExtrato(registro, valor),
            };

            if (classe.grupo === 'ciclos') {
                ciclos.push(item);
            } else if (classe.grupo === 'rendimento') {
                rendimento.push(item);
            } else {
                // Saques e depósitos vêm das próprias listas abaixo (evita duplicar),
                // a não ser que não seja possível ler essas listas.
                const duplicaSaque = classe.categoria.chave === 'saque' && !estado.saquesErro;
                const duplicaDeposito = classe.categoria.chave === 'deposito' && !estado.depositosErro;
                if (duplicaSaque || duplicaDeposito) return;
                item.categoria = classe.categoria;
                conta.push(item);
            }
        });

        // Depósitos
        estado.depositos.forEach(function(dep) {
            const status = String(dep.status || 'pendente').toLowerCase();
            let statusHtml;
            if (['aprovado', 'aprovado_sem_plano', 'resolvido_sem_plano'].includes(status)) statusHtml = badgeStatus('Aprovado', 'status-aprovado');
            else if (status === 'recusado') statusHtml = badgeStatus('Recusado', 'status-recusado');
            else statusHtml = badgeStatus('Pendente', 'status-pendente');

            const valorPlano = parseFloat(dep.valorPlano || 0);
            conta.push({
                data: dataValida(dep.dataAprovacao || dep.dataSolicitacao),
                categoria: { chave: 'deposito', rotulo: 'Depósito' },
                descricao: 'Depósito via Pix — plano de ' + formatadorMoeda.format(valorPlano),
                valor: valorPlano,
                statusHtml: statusHtml,
            });
        });

        // Saques
        estado.saques.forEach(function(saq) {
            const status = String(saq.status || 'pendente').toLowerCase();
            let statusHtml;
            if (status === 'pago') statusHtml = badgeStatus('Pago', 'status-aprovado');
            else if (['recusado', 'estornado', 'cancelado'].includes(status)) statusHtml = badgeStatus('Recusado', 'status-recusado');
            else if (status === 'processando') statusHtml = badgeStatus('Processando', 'status-pendente');
            else statusHtml = badgeStatus('Pendente', 'status-pendente');

            const solicitado = parseFloat(saq.valorSolicitado || 0);
            const liquido = parseFloat(saq.valorLiquido || 0);
            conta.push({
                data: dataValida(saq.dataSolicitacao || saq.dataPagamento),
                categoria: { chave: 'saque', rotulo: 'Saque' },
                descricao: 'Saque via Pix' + (liquido ? ' — líquido de ' + formatadorMoeda.format(liquido) : ''),
                valor: -solicitado,
                statusHtml: statusHtml,
            });
        });

        preencher(tbRendimento, rendimento, linhaRendimento, 'Nenhum rendimento recebido ainda.');
        preencher(tbCiclos, ciclos, linhaRendimento, 'Nenhum ciclo concluído ainda.');
        preencher(tbConta, conta, linhaConta, 'Nenhuma movimentação ainda.');
    }

    onValue(ref(db, 'extrato/' + userId), function(snapshot) {
        estado.extrato = paraLista(snapshot.val());
        renderizar();
    });

    onValue(ref(db, 'depositos/' + userId), function(snapshot) {
        estado.depositosErro = false;
        estado.depositos = paraLista(snapshot.val());
        renderizar();
    }, function(erro) {
        console.warn('Não foi possível ler os depósitos para o extrato:', erro);
        estado.depositosErro = true;
        renderizar();
    });

    onValue(ref(db, 'saques/' + userId), function(snapshot) {
        estado.saquesErro = false;
        estado.saques = paraLista(snapshot.val());
        renderizar();
    }, function(erro) {
        console.warn('Não foi possível ler os saques para o extrato:', erro);
        estado.saquesErro = true;
        renderizar();
    });
}

function gerarCodigoAleatorioCurto(tamanho) {
    if (!tamanho) tamanho = 6;
    const caracteres = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let codigo = '';
    for (let i = 0; i < tamanho; i++) {
        codigo += caracteres.charAt(Math.floor(Math.random() * caracteres.length));
    }
    return codigo;
}

function gerarLinkIndicacao(codigoIndicacao) {
    const baseUrl = window.location.href.split('index.html')[0].replace(/\/$/, '');
    return baseUrl + '/register.html?ref=' + codigoIndicacao;
}

function atualizarLinkIndicacao(codigoIndicacao) {
    const inputLink = getEl('linkIndicacao');
    if (inputLink && codigoIndicacao) {
        inputLink.value = gerarLinkIndicacao(codigoIndicacao);
    }
}

function inicializarBloqueioBiometrico() {
    const card = getEl('cardBloqueioBiometrico');
    const chk = getEl('chkBloqueioBiometrico');
    if (!card || !chk || chk.dataset.listenerAtivo) return;

    const ponte = window.Android;
    if (!ponte
        || typeof ponte.biometriaDisponivel !== 'function'
        || typeof ponte.bloqueioBiometricoAtivo !== 'function'
        || typeof ponte.definirBloqueioBiometrico !== 'function') {
        return;
    }
    if (!ponte.biometriaDisponivel()) return;

    card.style.display = 'block';
    let estadoAtual = !!ponte.bloqueioBiometricoAtivo();
    chk.checked = estadoAtual;

    chk.addEventListener('change', function() {
        const queroAtivar = chk.checked;
        chk.checked = estadoAtual;
        ponte.definirBloqueioBiometrico(queroAtivar);
    });

    window.onBloqueioBiometricoAlterado = function(ativo) {
        const novoEstado = !!ativo;
        chk.checked = novoEstado;
        if (novoEstado !== estadoAtual) {
            mostrarToast(novoEstado ? 'Bloqueio do app ativado.' : 'Bloqueio do app desativado.', 'success');
        }
        estadoAtual = novoEstado;
    };

    chk.dataset.listenerAtivo = 'true';
}

function inicializarEquipeUsuario(userId) {
    const inputLink = getEl('linkIndicacao');
    const btnCopiar = getEl('btnCopiarLinkIndicacao');
    
    if (btnCopiar && !btnCopiar.dataset.listenerAtivo) {
        btnCopiar.addEventListener('click', async function() {
            const link = inputLink ? inputLink.value : '';
            if (!link) return;

            try {
                await navigator.clipboard.writeText(link);
                mostrarToast('🔗 Link de indicação copiado!', 'success');
            } catch (error) {
                console.error('Erro ao copiar link:', error);
                if (inputLink) inputLink.select();
                mostrarToast('⚠️ Não foi possível copiar automaticamente. Selecione o link e copie manualmente.', 'warning');
            }
        });
        btnCopiar.dataset.listenerAtivo = 'true';
    }

    const btnCompartilhar = getEl('btnCompartilharConvite');
    if (btnCompartilhar && !btnCompartilhar.dataset.listenerAtivo) {
        btnCompartilhar.addEventListener('click', async function() {
            const link = inputLink ? inputLink.value : '';
            if (!link) {
                mostrarToast('Seu link ainda está sendo gerado. Tente de novo em instantes.', 'warning');
                return;
            }

            const titulo = 'Banca Compartilhada';
            const texto = 'Venha para a Banca Compartilhada! Cadastre-se pelo meu link de convite: ' + link;

            if (window.Android && typeof window.Android.compartilharTexto === 'function') {
                window.Android.compartilharTexto(titulo, texto);
                return;
            }

            if (navigator.share) {
                try {
                    await navigator.share({ title: titulo, text: texto });
                } catch (error) {
                    if (error && error.name !== 'AbortError') {
                        console.error('Erro ao compartilhar convite:', error);
                    }
                }
                return;
            }

            try {
                await navigator.clipboard.writeText(texto);
                mostrarToast('Convite copiado! Cole no WhatsApp ou onde preferir.', 'success');
            } catch (error) {
                console.error('Erro ao copiar convite:', error);
                mostrarToast('Não foi possível compartilhar. Use o botão Copiar Link.', 'warning');
            }
        });
        btnCompartilhar.dataset.listenerAtivo = 'true';
    }

    const tbody = getEl('tabelaMembrosEquipe');
    if (!tbody) return;

    const equipeRef = ref(db, 'equipe/' + userId);

    onValue(equipeRef, function(snapshot) {
        const dados = snapshot.val();
        const membros = dados
            ? Object.entries(dados).map(function([uid, info]) { return { uid, ...info }; })
            : [];

        const elTotalIndicados = getEl('totalIndicados');
        if (elTotalIndicados) elTotalIndicados.innerText = membros.length;

        if (!membros.length) {
            tbody.innerHTML = '<tr><td colspan="3" class="table-empty">Nenhum indicado cadastrado ainda.</td></tr>';
            return;
        }

        membros.sort(function(a, b) { return new Date(b.dataCadastro || 0) - new Date(a.dataCadastro || 0); });

        tbody.innerHTML = membros.map(function(membro) {
            const dataCad = membro.dataCadastro ? formatadorDataHoraCurto.format(new Date(membro.dataCadastro)) : '—';
            const nomeStr = escapeHTML(membro.nome) || '—';
            const emailStr = escapeHTML(membro.email) || '—';
            
            return `
                <tr>
                    <td>${dataCad}</td>
                    <td>${nomeStr}</td>
                    <td>${emailStr}</td>
                </tr>
            `;
        }).join('');
    }, function(error) {
        console.error('Erro ao carregar indicados:', error);
    });
}

document.addEventListener('DOMContentLoaded', function() {
    let saldoAtualUsuario = 0;
    let userIdAtual = null;
    let userAtual = null;
    let nomeUsuarioAtual = '';
    let emailUsuarioAtual = '';

    // Guarda todas as opções de plano antes de qualquer alteração no select
    const selectPlanoModal = document.getElementById('modalValorPlano');
    const todasOpcoesPlano = selectPlanoModal
        ? Array.from(selectPlanoModal.options).map(function(opt) { return opt.cloneNode(true); })
        : [];

    // Ao clicar em um plano, o modal mostra somente esse plano
    const botoesPlanos = document.querySelectorAll('.btn-escolher-plano');
    for (let i = 0; i < botoesPlanos.length; i++) {
        botoesPlanos[i].addEventListener('click', function() {
            const valor = this.getAttribute('data-valor');

            if (selectPlanoModal) {
                const opcaoDoPlano = todasOpcoesPlano.find(function(opt) { return opt.value === valor; });
                selectPlanoModal.innerHTML = '';
                if (opcaoDoPlano) selectPlanoModal.appendChild(opcaoDoPlano.cloneNode(true));
                selectPlanoModal.value = valor;
            }

            const inputPlano = document.getElementById('valorPlano');
            if (inputPlano) inputPlano.value = valor;

            const modalInput = document.getElementById('modalValorDepInput') || document.getElementById('modalValorPlano');
            if (modalInput) modalInput.value = valor;

            abrirModalDeposito();
        });
    }

    const btnAbrirDep = document.getElementById('btnAbrirDeposito');
    if (btnAbrirDep) {
        btnAbrirDep.addEventListener('click', function() {
            const inputPlano = document.getElementById('valorPlano');
            const modalInput = document.getElementById('modalValorDepInput') || document.getElementById('modalValorPlano');
            if (modalInput && inputPlano) modalInput.value = inputPlano.value || "10";
            abrirModalDeposito();
        });
    }

    const modalDep = document.getElementById('modalDeposito') || document.getElementById('modalDepositoSistema');
    const modalToast = document.getElementById('modalToast');
    const areaQrCodePix = document.getElementById('areaQrCodePix');
    const statusPagamentoPix = document.getElementById('statusPagamentoPix');
    const btnConfirmarModalDep = document.getElementById('btnConfirmarModalDep') || document.getElementById('btnConfirmarModalDepositar');
    const btnCopiarPix = document.getElementById('btnCopiarPix');

    if (btnCopiarPix) btnCopiarPix.style.display = 'none';

    if (btnCopiarPix) {
        btnCopiarPix.addEventListener('click', async function() {
            const pixEl = document.getElementById('txtChaveCopiaCola');
            const codigo = pixEl ? pixEl.textContent.trim() : '';
            if (!codigo) return;

            try {
                await navigator.clipboard.writeText(codigo);
                mostrarToast('✅ Código Pix copiado!', 'success');
            } catch (error) {
                console.error('Erro ao copiar código Pix:', error);
                mostrarToast('⚠️ Não foi possível copiar automaticamente. Selecione o código manualmente.', 'warning');
            }
        });
    }

    let pararEscutaPagamento = null;

    function pararEscutaConfirmacaoPagamento() {
        if (pararEscutaPagamento) {
            pararEscutaPagamento();
            pararEscutaPagamento = null;
        }
    }

    function escutarConfirmacaoPagamento(uid, depositoId) {
        pararEscutaConfirmacaoPagamento();
        const depositoRef = ref(db, `depositos/${uid}/${depositoId}`);
        pararEscutaPagamento = onValue(depositoRef, function(snapshot) {
            const dados = snapshot.val();
            if (dados && dados.status === 'aprovado') {
                pararEscutaConfirmacaoPagamento();
                fecharModalDeposito();
                mostrarToast('✅ Pagamento confirmado! Seu plano já está ativo na Carteira.', 'success');
            } else if (dados && dados.status === 'recusado') {
                pararEscutaConfirmacaoPagamento();
                if (statusPagamentoPix) statusPagamentoPix.textContent = 'Pagamento não confirmado.';
                mostrarToast('❌ O pagamento não foi confirmado. Tente novamente.', 'error');
            }
        });
    }

    function abrirModalDeposito() {
        if (modalToast) modalToast.classList.remove('ativo');
        if (areaQrCodePix) areaQrCodePix.classList.remove('ativo');
        if (statusPagamentoPix) {
            statusPagamentoPix.style.display = 'none';
            statusPagamentoPix.textContent = '⏳ Aguardando confirmação do pagamento...';
        }
        if (btnCopiarPix) btnCopiarPix.style.display = 'none';
        pararEscutaConfirmacaoPagamento();
        if (btnConfirmarModalDep) {
            btnConfirmarModalDep.textContent = "Gerar QR Code Pix";
            btnConfirmarModalDep.style.display = 'block';
            btnConfirmarModalDep.disabled = false;
        }
        if (modalDep) modalDep.style.display = 'flex';
    }

    function fecharModalDeposito() {
        if (modalDep) modalDep.style.display = 'none';
        pararEscutaConfirmacaoPagamento();
    }

    const fecharX = document.getElementById('fecharModalDepX');
    if (fecharX) fecharX.addEventListener('click', fecharModalDeposito);
    
    const btnFechar = document.getElementById('fecharModalDeposito');
    if (btnFechar) btnFechar.addEventListener('click', fecharModalDeposito);
    
    const btnCancelar = document.getElementById('btnCancelarModalDep');
    if (btnCancelar) btnCancelar.addEventListener('click', fecharModalDeposito);

    if (modalDep) {
        modalDep.addEventListener('click', function(e) {
            if (e.target === modalDep) fecharModalDeposito();
        });
    }

    if (btnConfirmarModalDep) {
        btnConfirmarModalDep.addEventListener('click', async function() {
            const modalInput = document.getElementById('modalValorDepInput') || document.getElementById('modalValorPlano');
            const valorAtual = parseFloat(modalInput ? modalInput.value : 0);
            const inputCpf = document.getElementById('modalDepositoCpf');
            const inputTelefone = document.getElementById('modalDepositoTelefone');

            if (valorAtual < 10) {
                if (modalToast) {
                    modalToast.classList.add('ativo');
                    modalToast.textContent = "O valor mínimo de depósito/plano é R$ 10,00.";
                    setTimeout(function() { if (modalToast) modalToast.classList.remove('ativo'); }, 4000);
                }
                return;
            }

            if (areaQrCodePix && !areaQrCodePix.classList.contains('ativo')) {
                if (!userIdAtual || !userAtual) {
                    mostrarToast('❌ Você precisa estar logado para solicitar um depósito.', 'error');
                    return;
                }

                const cpf = inputCpf ? inputCpf.value.trim() : '';
                const telefone = inputTelefone ? inputTelefone.value.trim() : '';

                if (!cpf || !telefone) {
                    mostrarToast('⚠️ Informe CPF e telefone para gerar o Pix.', 'warning');
                    return;
                }

                setBotaoCarregando(btnConfirmarModalDep, true, 'Gerando Pix...');
                try {
                    const depositosRef = ref(db, 'depositos/' + userIdAtual);
                    const novoDepositoRef = push(depositosRef);
                    const depositoId = novoDepositoRef.key;

                    // O valor do plano é gravado aqui e o servidor lê dele, não do corpo da chamada
                    await set(novoDepositoRef, {
                        valorPlano: valorAtual,
                        status: 'pendente',
                        dataSolicitacao: new Date().toISOString(),
                    });

                    const idToken = await userAtual.getIdToken();

                    const respostaPix = await fetch(`${CONFIG.WORKER_BASE_URL}/api/pix/criar`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${idToken}`,
                        },
                        body: JSON.stringify({
                            depositoId,
                            nome: nomeUsuarioAtual || 'Cliente',
                            email: emailUsuarioAtual || '',
                            telefone,
                            cpf,
                        }),
                    });

                    const dadosPix = await respostaPix.json();
                    if (!respostaPix.ok) {
                        throw new Error(dadosPix.error || 'Erro ao gerar o Pix.');
                    }

                    await update(novoDepositoRef, { transactionId: dadosPix.transactionId });

                    const qrImg = document.getElementById('imgQrCode');
                    const pixCopiaCola = document.getElementById('txtChaveCopiaCola');

                    if (qrImg) {
                        qrImg.src = dadosPix.pixImage
                            ? dadosPix.pixImage
                            : `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(dadosPix.pixCode)}`;
                    }
                    if (pixCopiaCola) pixCopiaCola.textContent = dadosPix.pixCode || '—';

                    if (areaQrCodePix) areaQrCodePix.classList.add('ativo');
                    if (statusPagamentoPix) statusPagamentoPix.style.display = 'block';
                    if (btnCopiarPix && dadosPix.pixCode) btnCopiarPix.style.display = 'block';
                    btnConfirmarModalDep.style.display = 'none';

                    escutarConfirmacaoPagamento(userIdAtual, depositoId);
                } catch (error) {
                    console.error('Erro ao gerar Pix:', error);
                    mostrarToast('❌ ' + error.message, 'error');
                } finally {
                    setBotaoCarregando(btnConfirmarModalDep, false);
                }
            }
        });
    }

    const modalSaque = document.getElementById('modalSaque') || document.getElementById('modalSaqueSistema');
    const btnAbrirSaqueModal = document.getElementById('btnAbrirSaqueModal');
    const btnConfirmarModalSaque = document.getElementById('btnConfirmarModalSaque') || document.getElementById('btnSolicitarSaqueFinal') || document.getElementById('btnConfirmarModalSacar');

    function abrirModalSaque() {
        const perfNome = document.getElementById('perfilNome');
        const perfTipo = document.getElementById('perfilTipoPix');
        const perfChave = document.getElementById('perfilChavePix');
        
        const nomePerfil = (perfNome ? perfNome.value : null) || localStorage.getItem('usuarioNome') || 'Não informado';
        const tipoPixPerfil = (perfTipo ? perfTipo.value : null) || 'CPF';
        const chavePixPerfil = (perfChave ? perfChave.value : null) || localStorage.getItem('usuarioChavePix') || '';

        const elNome = document.getElementById('saqueNomeCompleto');
        const elTipo = document.getElementById('saqueTipoPix');
        const elChave = document.getElementById('saqueChavePix');

        if (elNome) elNome.value = nomePerfil;
        if (elTipo) elTipo.value = tipoPixPerfil;

        // ALTERADO: texto neutro + botão "Cadastrar chave PIX" quando não há chave
        const btnIrPerfil = document.getElementById('btnIrPerfilChave');
        if (elChave) {
            if (chavePixPerfil) {
                elChave.textContent = chavePixPerfil;
                elChave.classList.remove('is-missing');
                if (btnIrPerfil) btnIrPerfil.style.display = 'none';
            } else {
                elChave.textContent = 'Nenhuma chave cadastrada.';
                elChave.classList.add('is-missing');
                if (btnIrPerfil) btnIrPerfil.style.display = 'inline-flex';
            }
        }

        let boxSaldoModal = document.getElementById('boxSaldoDisponivelModal');
        if (!boxSaldoModal && modalSaque) {
            boxSaldoModal = document.createElement('div');
            boxSaldoModal.id = 'boxSaldoDisponivelModal';
            boxSaldoModal.className = 'modal-info-box modal-balance-box';
            const containerInsercao = modalSaque.querySelector('.modal-body') || modalSaque.querySelector('.modal-card');
            if (containerInsercao) containerInsercao.prepend(boxSaldoModal);
        }
        if (boxSaldoModal) {
            boxSaldoModal.innerHTML = `<span>Saldo Disponível:</span> <strong>${formatadorMoeda.format(saldoAtualUsuario)}</strong>`;
        }

        const diaHoje = obterDiaSemanaBrasilia();
        if (diaHoje !== CONFIG.DIA_SAQUE_PERMITIDO) {
            if (btnConfirmarModalSaque) {
                btnConfirmarModalSaque.disabled = true;
            }
        } else {
            if (btnConfirmarModalSaque) {
                btnConfirmarModalSaque.disabled = false;
            }
        }

        if (modalSaque) modalSaque.style.display = 'flex';
    }

    function fecharModalSaque() {
        if (modalSaque) modalSaque.style.display = 'none';
    }

    if (btnAbrirSaqueModal) {
        btnAbrirSaqueModal.addEventListener('click', function(e) {
            e.preventDefault();
            abrirModalSaque();
        });
    }

    const fecharSaqueX = document.getElementById('fecharModalSaqueX');
    if (fecharSaqueX) fecharSaqueX.addEventListener('click', fecharModalSaque);
    
    const btnFecharSaque = document.getElementById('fecharModalSaque');
    if (btnFecharSaque) btnFecharSaque.addEventListener('click', fecharModalSaque);
    
    const btnCancelarSaque = document.getElementById('btnCancelarModalSaque');
    if (btnCancelarSaque) btnCancelarSaque.addEventListener('click', fecharModalSaque);

    // ALTERADO: botão "Cadastrar chave PIX" fecha o modal e abre a aba Perfil
    const btnIrPerfilChave = document.getElementById('btnIrPerfilChave');
    if (btnIrPerfilChave) {
        btnIrPerfilChave.addEventListener('click', function() {
            fecharModalSaque();
            const navPerfil = document.querySelector('.sidebar-nav .nav-item[data-target="view-perfil"]');
            if (navPerfil) navPerfil.click();
        });
    }

    if (modalSaque) {
        modalSaque.addEventListener('click', function(e) {
            if (e.target === modalSaque) fecharModalSaque();
        });
    }

    const inputValSaque = document.getElementById('valorSaqueModal') || document.getElementById('modalValorSaque');
    const boxResumo = document.getElementById('resumoDescontoSaque') || document.getElementById('resumoValorLiquido');

    if (inputValSaque) {
        inputValSaque.addEventListener('input', function(e) {
            const val = parseFloat(e.target.value);
            const diaHoje = obterDiaSemanaBrasilia();

            if (!isNaN(val) && val > 0) {
                const taxa = val * CONFIG.TAXA_SAQUE_PERCENTUAL;
                const liquido = val - taxa;

                if (boxResumo) {
                    boxResumo.classList.add('ativo');
                    boxResumo.innerHTML = `
                        <div class="amount-note__row amount-note__row--negative">
                            <span>Taxa (14%):</span>
                            <span>- ${formatadorMoeda.format(taxa)}</span>
                        </div>
                        <div class="amount-note__row amount-note__row--positive">
                            <span>Você vai receber:</span>
                            <span>${formatadorMoeda.format(liquido)}</span>
                        </div>
                    `;
                }

                if (btnConfirmarModalSaque) {
                    if (val > saldoAtualUsuario || val < CONFIG.VALOR_SAQUE_MINIMO || diaHoje !== CONFIG.DIA_SAQUE_PERMITIDO) {
                        btnConfirmarModalSaque.disabled = true;
                    } else {
                        btnConfirmarModalSaque.disabled = false;
                    }
                }
            } else {
                if (boxResumo) boxResumo.classList.remove('ativo');
            }
        });
    }

    if (modalSaque) {
        const linkPerfil = modalSaque.querySelector('a[data-target="view-perfil"]');
        if (linkPerfil) {
            linkPerfil.addEventListener('click', function(e) {
                e.preventDefault();
                fecharModalSaque();
                const navPerfil = document.querySelector('[data-target="view-perfil"]');
                if (navPerfil) navPerfil.click();
            });
        }
    }

    if (btnConfirmarModalSaque) {
        btnConfirmarModalSaque.addEventListener('click', async function() {
            if (!userIdAtual || !userAtual) {
                mostrarToast('❌ Você precisa estar logado para solicitar um saque.', 'error');
                return;
            }

            const valorSaque = parseFloat(inputValSaque ? inputValSaque.value : 0);

            if (isNaN(valorSaque) || valorSaque < CONFIG.VALOR_SAQUE_MINIMO) {
                mostrarToast(`⚠️ O valor mínimo para saque é ${formatadorMoeda.format(CONFIG.VALOR_SAQUE_MINIMO)}.`, 'warning');
                return;
            }

            if (valorSaque > saldoAtualUsuario) {
                mostrarToast('⚠️ Valor solicitado maior que o saldo disponível.', 'warning');
                return;
            }

            setBotaoCarregando(btnConfirmarModalSaque, true, 'Processando...');
            try {
                const idToken = await userAtual.getIdToken();

                const respostaSaque = await fetch(`${CONFIG.WORKER_BASE_URL}/api/saque/solicitar`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${idToken}`,
                    },
                    body: JSON.stringify({ valorSaque }),
                });

                const dadosResposta = await respostaSaque.json();
                if (!respostaSaque.ok) {
                    throw new Error(dadosResposta.error || 'Erro ao solicitar o saque.');
                }

                const mensagemSaque = dadosResposta.automatico === 'pago'
                    ? 'Saque pago! O Pix já foi enviado.'
                    : dadosResposta.automatico === 'processando'
                        ? 'Saque enviado! O Pix está sendo processado.'
                        : 'Saque solicitado com sucesso!';
                mostrarToast(mensagemSaque, 'success');
                fecharModalSaque();
            } catch (error) {
                console.error('Erro ao solicitar saque:', error);
                mostrarToast('❌ ' + error.message, 'error');
            } finally {
                setBotaoCarregando(btnConfirmarModalSaque, false);
            }
        });
    }

    auth.onAuthStateChanged(function(user) {
        if (!user) return;
        const userId = user.uid;
        userIdAtual = userId;
        userAtual = user;
        emailUsuarioAtual = user.email || '';

        const userRef = ref(db, 'usuarios/' + userId);
        onValue(userRef, function(snapshot) {
            const dados = snapshot.val();
            if (dados) {
                nomeUsuarioAtual = dados.nome || user.email || 'Usuário';

                const nomeUsuario = dados.nome || user.email || 'Usuário';
                const elNome = getEl('userNameDisplay');
                const elInicial = getEl('userInitial');

                if (elNome) elNome.innerText = nomeUsuario;
                if (elInicial) elInicial.innerText = nomeUsuario.charAt(0).toUpperCase();

                let codigo = dados.codigoIndicacao;
                if (!codigo) {
                    codigo = gerarCodigoAleatorioCurto(6);
                    update(userRef, { codigoIndicacao: codigo }).catch(function(error) {
                        console.error('Erro ao salvar código de indicação:', error);
                    });
                }

                atualizarLinkIndicacao(codigo);
            }
        });

        const financeiroRef = ref(db, 'financeiro/' + userId);
        onValue(financeiroRef, function(snapshot) {
            const dadosFinanceiros = snapshot.val() || {};
            saldoAtualUsuario = parseFloat(dadosFinanceiros.saldoRendimento || 0) + parseFloat(dadosFinanceiros.saldoComissao || 0);
            atualizarPainel(dadosFinanceiros);
        });

        inicializarPerfilUsuario(userId);
        inicializarCarteiraUsuario(userId);
        inicializarExtratoUsuario(userId);
        inicializarEquipeUsuario(userId);
        inicializarBloqueioBiometrico();
    });
});

document.addEventListener('DOMContentLoaded', function() {
    const navItems = document.querySelectorAll('.sidebar-nav .nav-item');
    const sections = document.querySelectorAll('.view-section');
    const sidebar = document.getElementById('sidebarPrincipal');
    const overlay = document.getElementById('sidebarOverlay');
    const btnAbrirMenuMobile = document.getElementById('btnAbrirMenuMobile');
    const btnSair = document.getElementById('btnSair');

    function fecharMenuMobile() {
        if (sidebar) sidebar.classList.remove('aberta');
        if (overlay) overlay.classList.remove('ativo');
    }

    if (btnAbrirMenuMobile) {
        btnAbrirMenuMobile.addEventListener('click', function() {
            if (sidebar) sidebar.classList.toggle('aberta');
            if (overlay) overlay.classList.toggle('ativo');
        });
    }

    if (overlay) {
        overlay.addEventListener('click', fecharMenuMobile);
    }

    for (let i = 0; i < navItems.length; i++) {
        navItems[i].addEventListener('click', function(e) {
            e.preventDefault();

            for (let j = 0; j < navItems.length; j++) {
                navItems[j].classList.remove('active');
            }
            this.classList.add('active');

            const targetId = this.getAttribute('data-target');
            if (targetId) {
                for (let k = 0; k < sections.length; k++) {
                    const sec = sections[k];
                    if (sec.id === targetId) {
                        sec.style.display = 'block';
                    } else {
                        sec.style.display = 'none';
                    }
                }
            }

            fecharMenuMobile();
        });
    }

    // Acesso rápido da aba Início: leva para a aba correspondente do menu lateral
    function irParaAba(targetId) {
        const item = document.querySelector('.sidebar-nav .nav-item[data-target="' + targetId + '"]');
        if (item) item.click();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    const btnAcessoRendimento = document.getElementById('btnAcessoRendimento');
    if (btnAcessoRendimento) {
        btnAcessoRendimento.addEventListener('click', function() { irParaAba('view-investir'); });
    }

    const btnAcessoHistorico = document.getElementById('btnAcessoHistorico');
    if (btnAcessoHistorico) {
        btnAcessoHistorico.addEventListener('click', function() { irParaAba('view-extrato'); });
    }

    const btnAcessoCiclos = document.getElementById('btnAcessoCiclos');
    if (btnAcessoCiclos) {
        btnAcessoCiclos.addEventListener('click', function() { irParaAba('view-ciclos'); });
    }

    const btnAcessoCupons = document.getElementById('btnAcessoCupons');
    if (btnAcessoCupons) {
        btnAcessoCupons.addEventListener('click', function() {
            mostrarToast('🎁 Cupons em breve!', 'warning');
        });
    }

    if (btnSair) {
        btnSair.addEventListener('click', async function() {
            btnSair.disabled = true;
            try {
                await signOut(auth);
            } catch (error) {
                console.error('Erro ao sair:', error);
                mostrarToast('❌ Erro ao sair: ' + error.message, 'error');
                btnSair.disabled = false;
            }
        });
    }
});
