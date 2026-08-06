import { auth, db, mostrarToast } from './auth.js';
import { ref, push, set, onValue, update, query, orderByChild, equalTo } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const CONFIG = {
    VALOR_SAQUE_MINIMO: 35,
    DIA_SAQUE_PERMITIDO: 0,
    TAXA_SAQUE_PERCENTUAL: 0.14,
    VALORES_PLANOS_PERMITIDOS: [30, 50, 100, 300, 500, 1000]
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

function getEl(id) {
    return document.getElementById(id);
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
    const campos = {
        saldoDisponivel: dados.saldo,
        rendimentoTotal: dados.rendimento,
        comissaoTotal: dados.comissao,
        comissaoTotalEquipe: dados.comissao,
    };

    for (const [idCampo, valor] of Object.entries(campos)) {
        const el = getEl(idCampo);
        if (el) el.innerText = formatadorMoeda.format(valor || 0);
    }
}

function inicializarPerfilUsuario(userId) {
    const perfilTipoPix = getEl('perfilTipoPix');
    const perfilChavePix = getEl('perfilChavePix');
    const perfilNome = getEl('perfilNome');
    const btnSalvarPerfil = getEl('btnSalvarPerfil');

    if (!btnSalvarPerfil) return;

    const userRef = ref(db, 'usuarios/' + userId);

    onValue(userRef, (snapshot) => {
        const dados = snapshot.val();
        if (dados) {
            if (perfilNome && dados.nome && !perfilNome.value) perfilNome.value = dados.nome;
            if (perfilTipoPix && dados.tipoPix) perfilTipoPix.value = dados.tipoPix;

            if (dados.chavePix) {
                if (perfilChavePix) {
                    perfilChavePix.value = dados.chavePix;
                    perfilChavePix.disabled = true;
                    perfilChavePix.classList.add('is-locked');
                }
                if (perfilTipoPix) {
                    perfilTipoPix.disabled = true;
                    perfilTipoPix.classList.add('is-locked');
                }
                if (btnSalvarPerfil) {
                    btnSalvarPerfil.style.display = 'none';
                }
            }
        }
    });

    if (!btnSalvarPerfil.dataset.listenerAtivo) {
        btnSalvarPerfil.addEventListener('click', async () => {
            const novoNome = perfilNome ? perfilNome.value.trim() : '';
            const novoTipoPix = perfilTipoPix ? perfilTipoPix.value : '';
            const novaChavePix = perfilChavePix ? perfilChavePix.value.trim() : '';

            if (!novaChavePix) {
                mostrarToast('⚠️ Por favor, informe a sua chave PIX.', 'warning');
                return;
            }

            setBotaoCarregando(btnSalvarPerfil, true, 'Salvando...');
            try {
                const updates = {};
                if (novoNome) updates['nome'] = novoNome;
                updates['tipoPix'] = novoTipoPix;
                updates['chavePix'] = novaChavePix;

                await update(userRef, updates);
                mostrarToast('✅ Chave PIX cadastrada com sucesso! Ela não poderá ser alterada.', 'success');
            } catch (error) {
                console.error('Erro ao salvar perfil:', error);
                mostrarToast('❌ Erro ao salvar perfil: ' + error.message, 'error');
            } finally {
                setBotaoCarregando(btnSalvarPerfil, false);
            }
        });
        btnSalvarPerfil.dataset.listenerAtivo = 'true';
    }
}

function calcularEstadoPlano(plano) {
    const valor = parseFloat(plano.valor || 0);
    const percentualDiario = parseFloat(plano.percentualDiario || 0);
    const tetoPercentual = parseFloat(plano.tetoPercentual || 0);

    const dataAtivacao = new Date(plano.dataAtivacao || Date.now());
    const agora = new Date();
    const diasCorridos = Math.max(0, Math.floor((agora - dataAtivacao) / (1000 * 60 * 60 * 24)));

    const rendimentoDiario = valor * percentualDiario;
    const tetoValor = valor * tetoPercentual;
    const rendimentoAcumulado = Math.min(rendimentoDiario * diasCorridos, tetoValor);
    const finalizado = rendimentoAcumulado >= tetoValor && tetoValor > 0;

    return {
        dataAtivacao,
        rendimentoDiario,
        rendimentoAcumulado,
        finalizado,
    };
}

function renderizarTabelaCarteira(planosObj) {
    const tbody = getEl('tabelaPlanosCarteira');
    const elTotalInvestido = getEl('totalInvestidoPlanos');
    const elTotalRendimento = getEl('totalRendimentoPlanos');
    if (!tbody) return;

    const planos = planosObj
        ? Object.entries(planosObj).map(([id, dados]) => ({ id, ...dados }))
        : [];

    if (!planos.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="table-empty">Nenhum plano ativo no momento.</td></tr>';
        if (elTotalInvestido) elTotalInvestido.innerText = formatadorMoeda.format(0);
        if (elTotalRendimento) elTotalRendimento.innerText = formatadorMoeda.format(0);
        return;
    }

    planos.sort((a, b) => new Date(b.dataAtivacao || 0) - new Date(a.dataAtivacao || 0));

    let totalInvestido = 0;
    let totalRendimento = 0;

    tbody.innerHTML = planos.map(plano => {
        const valor = parseFloat(plano.valor || 0);
        const { dataAtivacao, rendimentoDiario, rendimentoAcumulado, finalizado } = calcularEstadoPlano(plano);

        totalInvestido += valor;
        totalRendimento += rendimentoAcumulado;

        const statusTexto = finalizado ? 'Finalizado' : 'Ativo';
        const statusClasse = finalizado ? 'plan-row__value' : 'plan-row__value plan-row__value--positive';

        return `
            <tr>
                <td>${formatadorData.format(dataAtivacao)}</td>
                <td>${formatadorMoeda.format(valor)}</td>
                <td>${formatadorMoeda.format(rendimentoDiario)}</td>
                <td>${formatadorMoeda.format(rendimentoAcumulado)}</td>
                <td><span class="${statusClasse}" style="font-weight: 600;">${statusTexto}</span></td>
            </tr>
        `;
    }).join('');

    if (elTotalInvestido) elTotalInvestido.innerText = formatadorMoeda.format(totalInvestido);
    if (elTotalRendimento) elTotalRendimento.innerText = formatadorMoeda.format(totalRendimento);
}

function inicializarCarteiraUsuario(userId) {
    const tbody = getEl('tabelaPlanosCarteira');
    if (!tbody) return;

    const planosRef = ref(db, 'planos/' + userId);
    onValue(planosRef, (snapshot) => {
        renderizarTabelaCarteira(snapshot.val());
    });
}

function inicializarExtratoUsuario(userId) {
    const tbody = getEl('tabelaExtratoGeral');
    if (!tbody) return;

    const formatadorMesAno = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' });
    const formatadorDataHora = new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    const extratoRef = ref(db, 'extrato/' + userId);
    onValue(extratoRef, (snapshot) => {
        const dados = snapshot.val();
        const registros = dados
            ? Object.entries(dados).map(([id, info]) => ({ id, ...info }))
            : [];

        if (!registros.length) {
            tbody.innerHTML = '<tr><td colspan="4" class="table-empty">Nenhum registro no extrato ainda.</td></tr>';
            return;
        }

        registros.sort((a, b) => new Date(b.data || 0) - new Date(a.data || 0));

        tbody.innerHTML = registros.map(registro => {
            const data = new Date(registro.data || Date.now());
            let mesAno = formatadorMesAno.format(data);
            mesAno = mesAno.charAt(0).toUpperCase() + mesAno.slice(1);

            return `
                <tr>
                    <td>${formatadorDataHora.format(data)}</td>
                    <td>${mesAno}</td>
                    <td>${registro.descricao || '—'}</td>
                    <td class="plan-row__value plan-row__value--positive">${formatadorMoeda.format(registro.valor || 0)}</td>
                </tr>
            `;
        }).join('');
    });
}

function gerarLinkIndicacao(userId, codigoIndicacao) {
    const baseUrl = window.location.href.split('index.html')[0].replace(/\/$/, '');
    return `${baseUrl}/register.html?ref=${codigoIndicacao || userId}`;
}

// FIX: antes, o link de indicação era escrito em DOIS lugares — uma vez
// dentro do onValue(userRef,...) com o código curto correto, e outra vez
// aqui dentro (chamada sem o 2º argumento, codigoIndicacao chegava
// undefined). Como onValue é assíncrono e a chamada abaixo era síncrona,
// o UID cru do usuário era escrito no campo ANTES do código correto
// sobrescrever — abrindo uma janela onde, se o usuário copiasse o link
// rápido demais (ou a rede estivesse lenta), ele levava o UID em vez do
// código curto, e o vínculo de indicação nunca era resolvido no cadastro
// (codigosIndicacao/{UID} não existe — só existe codigosIndicacao/{CODIGO}).
// Agora só o listener em onValue(userRef,...) escreve o link, e esta
// função para de tentar escrevê-lo também — elimina a corrida.
function inicializarEquipeUsuario(userId) {
    const btnCopiar = getEl('btnCopiarLinkIndicacao');
    if (btnCopiar && !btnCopiar.dataset.listenerAtivo) {
        btnCopiar.addEventListener('click', async () => {
            const inputLink = getEl('linkIndicacao');
            const link = inputLink?.value || '';
            if (!link) return;

            try {
                await navigator.clipboard.writeText(link);
                mostrarToast('🔗 Link de indicação copiado!', 'success');
            } catch (error) {
                console.error('Erro ao copiar link:', error);
                inputLink?.select();
                mostrarToast('⚠️ Não foi possível copiar automaticamente. Selecione o link e copie manualmente.', 'warning');
            }
        });
        btnCopiar.dataset.listenerAtivo = 'true';
    }

    const tbody = getEl('tabelaMembrosEquipe');
    if (!tbody || tbody.dataset.listenerAtivo) return;
    tbody.dataset.listenerAtivo = 'true';

    const usuariosRef = ref(db, 'usuarios');
    const consultaIndicados = query(usuariosRef, orderByChild('indicadoPor'), equalTo(userId));

    onValue(consultaIndicados, (snapshot) => {
        const dados = snapshot.val();
        const membros = dados
            ? Object.entries(dados).map(([uid, info]) => ({ uid, ...info }))
            : [];

        const elTotalIndicados = getEl('totalIndicados');
        if (elTotalIndicados) elTotalIndicados.innerText = membros.length;

        if (!membros.length) {
            tbody.innerHTML = '<tr><td colspan="3" class="table-empty">Nenhum indicado cadastrado ainda.</td></tr>';
            return;
        }

        membros.sort((a, b) => new Date(b.dataCadastro || 0) - new Date(a.dataCadastro || 0));

        tbody.innerHTML = membros.map(membro => `
            <tr>
                <td>${membro.dataCadastro ? formatadorData.format(new Date(membro.dataCadastro)) : '—'}</td>
                <td>${membro.nome || '—'}</td>
                <td>${membro.email || '—'}</td>
            </tr>
        `).join('');
    }, (error) => {
        console.error('Erro ao carregar indicados (verifique as Regras/index do Firebase):', error);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    let saldoAtualUsuario = 0;
    let userIdAtual = null;

    document.querySelectorAll('.btn-escolher-plano').forEach(btn => {
        btn.addEventListener('click', () => {
            const valor = btn.getAttribute('data-valor');
            const inputPlano = document.getElementById('valorPlano');
            if (inputPlano) inputPlano.value = valor;

            const modalInput = document.getElementById('modalValorDepInput') || document.getElementById('modalValorPlano');
            if (modalInput) modalInput.value = valor;

            abrirModalDeposito();
        });
    });

    const btnAbrirDep = document.getElementById('btnAbrirDeposito');
    if (btnAbrirDep) {
        btnAbrirDep.addEventListener('click', () => {
            const inputPlano = document.getElementById('valorPlano');
            const modalInput = document.getElementById('modalValorDepInput') || document.getElementById('modalValorPlano');
            if (modalInput && inputPlano) modalInput.value = inputPlano.value || "30";
            abrirModalDeposito();
        });
    }

    const modalDep = document.getElementById('modalDeposito') || document.getElementById('modalDepositoSistema');
    const modalToast = document.getElementById('modalToast');
    const areaQrCodePix = document.getElementById('areaQrCodePix');
    const btnConfirmarModalDep = document.getElementById('btnConfirmarModalDep') || document.getElementById('btnConfirmarModalDepositar');

    function abrirModalDeposito() {
        if (modalToast) modalToast.classList.remove('ativo');
        if (areaQrCodePix) areaQrCodePix.classList.remove('ativo');
        if (btnConfirmarModalDep) {
            btnConfirmarModalDep.textContent = "Gerar QR Code Pix";
            btnConfirmarModalDep.style.display = 'block';
        }
        if (modalDep) modalDep.style.display = 'flex';
    }

    function fecharModalDeposito() {
        if (modalDep) modalDep.style.display = 'none';
    }

    document.getElementById('fecharModalDepX')?.addEventListener('click', fecharModalDeposito);
    document.getElementById('fecharModalDeposito')?.addEventListener('click', fecharModalDeposito);
    document.getElementById('btnCancelarModalDep')?.addEventListener('click', fecharModalDeposito);

    modalDep?.addEventListener('click', (e) => {
        if (e.target === modalDep) fecharModalDeposito();
    });

    btnConfirmarModalDep?.addEventListener('click', async () => {
        const modalInput = document.getElementById('modalValorDepInput') || document.getElementById('modalValorPlano');
        const valorAtual = parseFloat(modalInput?.value || 0);

        if (valorAtual < 30) {
            if (modalToast) {
                modalToast.classList.add('ativo');
                modalToast.textContent = "⚠️ O valor mínimo de depósito/plano é R$ 30,00.";
                setTimeout(() => { if (modalToast) modalToast.classList.remove('ativo'); }, 4000);
            }
            return;
        }

        if (areaQrCodePix && !areaQrCodePix.classList.contains('ativo')) {
            const qrImg = document.getElementById('imgQrCode');
            const pixCopiaCola = document.getElementById('txtChaveCopiaCola');

            if (qrImg) qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=BancaCompartilhadaR$${valorAtual}`;
            if (pixCopiaCola) pixCopiaCola.textContent = `00020126580014br.gov.bcb.pix0136banca-compartilhada-pix-${valorAtual}5204000053039865802BR5925Banca Compartilhada6009Sao Paulo62070503***6304`;

            areaQrCodePix.classList.add('ativo');
            btnConfirmarModalDep.textContent = "Concluir Pagamento";
        } else {
            if (!userIdAtual) {
                mostrarToast('❌ Você precisa estar logado para solicitar um depósito.', 'error');
                return;
            }

            setBotaoCarregando(btnConfirmarModalDep, true, 'Enviando...');
            try {
                const depositosRef = ref(db, 'depositos/' + userIdAtual);
                const novoDepositoRef = push(depositosRef);
                await set(novoDepositoRef, {
                    valorPlano: valorAtual,
                    status: 'pendente',
                    dataSolicitacao: new Date().toISOString()
                });

                fecharModalDeposito();
                const inputPlano = document.getElementById('valorPlano');
                if (inputPlano && modalInput) inputPlano.value = modalInput.value;

                const btnDepReal = document.getElementById('btnDepositar');
                if (btnDepReal) {
                    btnDepReal.click();
                } else {
                    mostrarToast('✅ Solicitação de depósito gerada! Assim que o pagamento for confirmado, o plano aparecerá na sua Carteira.', 'success');
                }
            } catch (error) {
                console.error('Erro ao registrar depósito:', error);
                mostrarToast('❌ Erro ao registrar depósito: ' + error.message, 'error');
            } finally {
                setBotaoCarregando(btnConfirmarModalDep, false);
            }
        }
    });

    const modalSaque = document.getElementById('modalSaque') || document.getElementById('modalSaqueSistema');
    const btnAbrirSaqueModal = document.getElementById('btnAbrirSaqueModal');
    const btnConfirmarModalSaque = document.getElementById('btnConfirmarModalSaque') || document.getElementById('btnSolicitarSaqueFinal') || document.getElementById('btnConfirmarModalSacar');

    function abrirModalSaque() {
        const nomePerfil = document.getElementById('perfilNome')?.value || localStorage.getItem('usuarioNome') || 'Não informado';
        const tipoPixPerfil = document.getElementById('perfilTipoPix')?.value || 'CPF';
        const chavePixPerfil = document.getElementById('perfilChavePix')?.value || localStorage.getItem('usuarioChavePix') || '';

        const elNome = document.getElementById('saqueNomeCompleto');
        const elTipo = document.getElementById('saqueTipoPix');
        const elChave = document.getElementById('saqueChavePix');

        if (elNome) elNome.value = nomePerfil;
        if (elTipo) elTipo.value = tipoPixPerfil;
        if (elChave) {
            // elChave é um <strong> de exibição, não um <input> — usar
            // textContent (não .value) e avisar quando não há chave
            // cadastrada ainda no Perfil.
            elChave.textContent = chavePixPerfil || 'Nenhuma chave cadastrada — vá em Perfil e cadastre uma.';
            elChave.classList.toggle('is-missing', !chavePixPerfil);
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

        const diaHoje = new Date().getDay();
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

    btnAbrirSaqueModal?.addEventListener('click', (e) => {
        e.preventDefault();
        abrirModalSaque();
    });

    document.getElementById('fecharModalSaqueX')?.addEventListener('click', fecharModalSaque);
    document.getElementById('fecharModalSaque')?.addEventListener('click', fecharModalSaque);
    document.getElementById('btnCancelarModalSaque')?.addEventListener('click', fecharModalSaque);

    modalSaque?.addEventListener('click', (e) => {
        if (e.target === modalSaque) fecharModalSaque();
    });

    const inputValSaque = document.getElementById('valorSaqueModal') || document.getElementById('modalValorSaque');
    const boxResumo = document.getElementById('resumoDescontoSaque') || document.getElementById('resumoValorLiquido');

    inputValSaque?.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        const diaHoje = new Date().getDay();

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

    modalSaque?.querySelector('a[data-target="view-perfil"]')?.addEventListener('click', (e) => {
        e.preventDefault();
        fecharModalSaque();
        const navPerfil = document.querySelector('[data-target="view-perfil"]');
        if (navPerfil) navPerfil.click();
    });

    btnConfirmarModalSaque?.addEventListener('click', async () => {
        if (!userIdAtual) {
            mostrarToast('❌ Você precisa estar logado para solicitar um saque.', 'error');
            return;
        }

        const diaHoje = new Date().getDay();
        const valorSaque = parseFloat(inputValSaque?.value || 0);

        if (diaHoje !== CONFIG.DIA_SAQUE_PERMITIDO) {
            mostrarToast('⚠️ Saques só podem ser solicitados aos domingos.', 'warning');
            return;
        }

        if (isNaN(valorSaque) || valorSaque < CONFIG.VALOR_SAQUE_MINIMO) {
            mostrarToast(`⚠️ O valor mínimo para saque é ${formatadorMoeda.format(CONFIG.VALOR_SAQUE_MINIMO)}.`, 'warning');
            return;
        }

        if (valorSaque > saldoAtualUsuario) {
            mostrarToast('⚠️ Valor solicitado maior que o saldo disponível.', 'warning');
            return;
        }

        // A chave PIX usada no saque vem sempre do Perfil (fonte de
        // verdade) — o modal de saque só EXIBE essa chave, não a edita.
        const tipoPixSaque = document.getElementById('perfilTipoPix')?.value || 'CPF';
        const chavePixSaque = document.getElementById('perfilChavePix')?.value || '';

        if (!chavePixSaque) {
            mostrarToast('⚠️ Cadastre sua chave PIX no Perfil antes de solicitar um saque.', 'warning');
            return;
        }

        const taxa = valorSaque * CONFIG.TAXA_SAQUE_PERCENTUAL;
        const valorLiquido = valorSaque - taxa;
        const novoSaldo = saldoAtualUsuario - valorSaque;

        setBotaoCarregando(btnConfirmarModalSaque, true, 'Processando...');
        try {
            const saquesRef = ref(db, 'saques/' + userIdAtual);
            const novoSaqueRef = push(saquesRef);
            await set(novoSaqueRef, {
                valorSolicitado: valorSaque,
                taxa: taxa,
                valorLiquido: valorLiquido,
                tipoPix: tipoPixSaque,
                chavePix: chavePixSaque,
                status: 'pendente',
                dataSolicitacao: new Date().toISOString()
            });

            const userRef = ref(db, 'usuarios/' + userIdAtual);
            await update(userRef, { saldo: novoSaldo });

            mostrarToast('✅ Saque solicitado com sucesso!', 'success');
            fecharModalSaque();
        } catch (error) {
            console.error('Erro ao solicitar saque:', error);
            mostrarToast('❌ Erro ao solicitar saque: ' + error.message, 'error');
        } finally {
            setBotaoCarregando(btnConfirmarModalSaque, false);
        }
    });

    auth.onAuthStateChanged((user) => {
        if (!user) return;
        const userId = user.uid;
        userIdAtual = userId;

        const userRef = ref(db, 'usuarios/' + userId);
        onValue(userRef, (snapshot) => {
            const dados = snapshot.val();
            if (dados) {
                saldoAtualUsuario = parseFloat(dados.saldo || 0);
                atualizarPainel(dados);

                const nomeUsuario = dados.nome || user.email || 'Usuário';
                const elNome = getEl('userNameDisplay');
                const elInicial = getEl('userInitial');

                if (elNome) elNome.innerText = nomeUsuario;
                if (elInicial) elInicial.innerText = nomeUsuario.charAt(0).toUpperCase();

                const inputLink = getEl('linkIndicacao');
                if (inputLink) inputLink.value = gerarLinkIndicacao(userId, dados.codigoIndicacao);
            }
        });

        inicializarPerfilUsuario(userId);
        inicializarCarteiraUsuario(userId);
        inicializarExtratoUsuario(userId);
        inicializarEquipeUsuario(userId);
    });
});

document.addEventListener('DOMContentLoaded', () => {
    const navItems = document.querySelectorAll('.sidebar-nav .nav-item');
    const sections = document.querySelectorAll('.view-section');
    const sidebar = document.getElementById('sidebarPrincipal');
    const overlay = document.getElementById('sidebarOverlay');
    const btnAbrirMenuMobile = document.getElementById('btnAbrirMenuMobile');
    const btnSair = document.getElementById('btnSair');

    function fecharMenuMobile() {
        sidebar?.classList.remove('aberta');
        overlay?.classList.remove('ativo');
    }

    btnAbrirMenuMobile?.addEventListener('click', () => {
        sidebar?.classList.toggle('aberta');
        overlay?.classList.toggle('ativo');
    });

    overlay?.addEventListener('click', fecharMenuMobile);

    navItems.forEach(item => {
        item.addEventListener('click', function(e) {
            e.preventDefault();

            navItems.forEach(nav => nav.classList.remove('active'));
            this.classList.add('active');

            const targetId = this.getAttribute('data-target');
            if (targetId) {
                sections.forEach(sec => {
                    if (sec.id === targetId) {
                        sec.style.display = 'block';
                    } else {
                        sec.style.display = 'none';
                    }
                });
            }

            fecharMenuMobile();
        });
    });

    btnSair?.addEventListener('click', async () => {
        btnSair.disabled = true;
        try {
            await signOut(auth);
        } catch (error) {
            console.error('Erro ao sair:', error);
            mostrarToast('❌ Erro ao sair: ' + error.message, 'error');
            btnSair.disabled = false;
        }
    });
});
