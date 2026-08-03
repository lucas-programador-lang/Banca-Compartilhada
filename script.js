import { auth, db, mostrarToast } from './auth.js';
import { ref, push, set, onValue, update } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

/* ==========================================================================
   Configurações / Constantes
   ========================================================================== */
const CONFIG = {
    VALOR_SAQUE_MINIMO: 35,
    DIA_SAQUE_PERMITIDO: 0, // 0 = Domingo
    TAXA_SAQUE_PERCENTUAL: 0.14, // 14% de taxa
};

const formatadorMoeda = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
});

/* ==========================================================================
   Helpers
   ========================================================================== */
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
    };

    for (const [idCampo, valor] of Object.entries(campos)) {
        const el = getEl(idCampo);
        if (el) el.innerText = formatadorMoeda.format(valor || 0);
    }
}

/* ==========================================================================
   Lógica de Cálculo de Rendimento e Tetos dos Planos
   ========================================================================== */
function calcularRendimentoPlano(capital, diasCorridos) {
    let taxaDiaria = 0;
    let tetoPercentual = 0;

    if (capital >= 30 && capital <= 50) {
        taxaDiaria = 0.03;       // 3% ao dia
        tetoPercentual = 0.70;   // 70% sobre o capital
    } else if (capital >= 100 && capital <= 1000) {
        taxaDiaria = 0.02;       // 2% ao dia
        tetoPercentual = 0.60;   // Teto de 60% sobre o capital
    } else {
        return { erro: "Valor de aporte inválido." };
    }

    const lucroMaximo = capital * tetoPercentual;
    let lucroAtual = capital * taxaDiaria * diasCorridos;
    let atingiuTeto = false;

    if (lucroAtual >= lucroMaximo) {
        lucroAtual = lucroMaximo;
        atingiuTeto = true;
    }

    return {
        capital: capital,
        lucroDiario: capital * taxaDiaria,
        lucroAcumulado: lucroAtual,
        lucroMaximo: lucroMaximo,
        atingiuTeto: atingiuTeto,
        montanteTotal: capital + lucroAtual
    };
}

/* ==========================================================================
   Gestão de Perfil e Bloqueio de Chave PIX
   ========================================================================== */
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
                    perfilChavePix.style.backgroundColor = '#2a2a2a';
                    perfilChavePix.style.cursor = 'not-allowed';
                }
                if (perfilTipoPix) {
                    perfilTipoPix.disabled = true;
                    perfilTipoPix.style.backgroundColor = '#2a2a2a';
                    perfilTipoPix.style.cursor = 'not-allowed';
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

/* ==========================================================================
   Inicialização de Eventos e Modais (Sua Lógica Original Integrada)
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
    // Sincronizar valor do input oculto com o modal de depósito
    document.querySelectorAll('.btn-escolher-plano').forEach(btn => {
        btn.addEventListener('click', () => {
            const valor = btn.getAttribute('data-valor');
            const inputPlano = document.getElementById('valorPlano');
            if (inputPlano) inputPlano.value = valor;
            
            const modalInput = document.getElementById('modalValorDepInput');
            if (modalInput) modalInput.value = valor;
            
            abrirModalDeposito();
        });
    });

    // Botão Depositar Principal
    const btnAbrirDep = document.getElementById('btnAbrirDeposito');
    if (btnAbrirDep) {
        btnAbrirDep.addEventListener('click', () => {
            const inputPlano = document.getElementById('valorPlano');
            const modalInput = document.getElementById('modalValorDepInput');
            if (modalInput && inputPlano) modalInput.value = inputPlano.value || "30";
            abrirModalDeposito();
        });
    }

    // Funções de Modal Depósito
    const modalDep = document.getElementById('modalDeposito') || document.getElementById('modalDepositoSistema');
    const modalToast = document.getElementById('modalToast');
    const areaQrCodePix = document.getElementById('areaQrCodePix');
    const btnConfirmarModalDep = document.getElementById('btnConfirmarModalDep') || document.getElementById('btnConfirmarModalDepositar');

    function abrirModalDeposito() {
        if (modalToast) modalToast.style.display = 'none';
        if (areaQrCodePix) areaQrCodePix.style.display = 'none';
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

    // Ação do Botão no Modal de Depósito (Gerar QR Code / Validar Mínimo)
    btnConfirmarModalDep?.addEventListener('click', () => {
        const modalInput = document.getElementById('modalValorDepInput') || document.getElementById('modalValorPlano');
        const valorAtual = parseFloat(modalInput?.value || 0);

        // Validação de Valor Mínimo (< 30)
        if (valorAtual < 30) {
            if (modalToast) {
                modalToast.style.display = 'block';
                setTimeout(() => {
                    if (modalToast) modalToast.style.display = 'none';
                }, 4000);
            }
            return;
        }

        // Se já gerou ou vai gerar o QR Code
        if (areaQrCodePix && (areaQrCodePix.style.display === 'none' || areaQrCodePix.style.display === '')) {
            const qrImg = document.getElementById('imgQrCode');
            const pixCopiaCola = document.getElementById('txtChaveCopiaCola');
            
            if (qrImg) qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=BancaCompartilhadaR$${valorAtual}`;
            if (pixCopiaCola) pixCopiaCola.textContent = `00020126580014br.gov.bcb.pix0136banca-compartilhada-pix-${valorAtual}5204000053039865802BR5925Banca Compartilhada6009Sao Paulo62070503***6304`;
            
            areaQrCodePix.style.display = 'block';
            btnConfirmarModalDep.textContent = "Concluir Pagamento";
        } else {
            fecharModalDeposito();
            const inputPlano = document.getElementById('valorPlano');
            if (inputPlano && modalInput) inputPlano.value = modalInput.value;

            const btnDepReal = document.getElementById('btnDepositar');
            if (btnDepReal) {
                btnDepReal.click();
            } else {
                mostrarToast('✅ Solicitação de depósito gerada com sucesso!', 'success');
            }
        }
    });

    // Funções de Modal Saque
    const modalSaque = document.getElementById('modalSaque') || document.getElementById('modalSaqueSistema');
    const btnAbrirSaqueModal = document.getElementById('btnAbrirSaqueModal');

    function abrirModalSaque() {
        const nomePerfil = document.getElementById('perfilNome')?.value || localStorage.getItem('usuarioNome') || 'Não informado';
        const tipoPixPerfil = document.getElementById('perfilTipoPix')?.value || 'CPF';
        const chavePixPerfil = document.getElementById('perfilChavePix')?.value || localStorage.getItem('usuarioChavePix') || '';

        const elNome = document.getElementById('saqueNomeCompleto');
        const elTipo = document.getElementById('saqueTipoPix');
        const elChave = document.getElementById('saqueChavePix');

        if (elNome) elNome.value = nomePerfil;
        if (elTipo) elTipo.value = tipoPixPerfil;
        if (elChave) elChave.value = chavePixPerfil;

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

    // Cálculo dinâmico do desconto de 14% no Saque
    const inputValSaque = document.getElementById('valorSaqueModal') || document.getElementById('modalValorSaque');
    const boxResumo = document.getElementById('resumoDescontoSaque') || document.getElementById('resumoValorLiquido');
    const txtValSolicitado = document.getElementById('txtValSolicitado');
    const txtValTaxa = document.getElementById('txtValTaxa');
    const txtValLiquido = document.getElementById('txtValLiquido');

    inputValSaque?.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        if (!isNaN(val) && val > 0) {
            const taxa = val * CONFIG.TAXA_SAQUE_PERCENTUAL;
            const liquido = val - taxa;

            if (txtValSolicitado) txtValSolicitado.textContent = `R$ ${val.toFixed(2).replace('.', ',')}`;
            if (txtValTaxa) txtValTaxa.textContent = `- R$ ${taxa.toFixed(2).replace('.', ',')}`;
            if (txtValLiquido) txtValLiquido.textContent = `R$ ${liquido.toFixed(2).replace('.', ',')}`;
            
            if (boxResumo) {
                boxResumo.style.display = 'block';
                if (!txtValSolicitado && !txtValLiquido) {
                    boxResumo.innerText = `💡 Taxa (14%): ${formatadorMoeda.format(taxa)} | Você vai receber: ${formatadorMoeda.format(liquido)}`;
                }
            }
        } else {
            if (boxResumo) boxResumo.style.display = 'none';
        }
    });

    // Link interno para perfil dentro do modal de saque
    modalSaque?.querySelector('a[data-target="view-perfil"]')?.addEventListener('click', (e) => {
        e.preventDefault();
        fecharModalSaque();
        const navPerfil = document.querySelector('[data-target="view-perfil"]');
        if (navPerfil) navPerfil.click();
    });

    // Autenticação e sincronização inicial de dados do usuário
    auth.onAuthStateChanged((user) => {
        if (!user) return;
        const userId = user.uid;

        const userRef = ref(db, 'usuarios/' + userId);
        onValue(userRef, (snapshot) => {
            const dados = snapshot.val();
            if (dados) {
                atualizarPainel(dados);

                const nomeUsuario = dados.nome || user.email || 'Usuário';
                const elNome = getEl('userNameDisplay');
                const elInicial = getEl('userInitial');

                if (elNome) elNome.innerText = nomeUsuario;
                if (elInicial) elInicial.innerText = nomeUsuario.charAt(0).toUpperCase();
            }
        });

        inicializarPerfilUsuario(userId);
    });
});

/* ==========================================================================
   Navegação da Sidebar e Alternância de Telas
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
    const navItems = document.querySelectorAll('.sidebar-nav .nav-item');
    const sections = document.querySelectorAll('.view-section');

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
        });
    });
});
