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
   Lógica do Modal de Saque e Validações
   ========================================================================== */
function validarSaque({ valorSaque, chavePix }) {
    const hoje = new Date().getDay();

    if (hoje !== CONFIG.DIA_SAQUE_PERMITIDO) {
        return { valido: false, mensagem: '⚠️ Os saques estão liberados apenas aos DOMINGOS.', tipo: 'warning' };
    }
    if (!valorSaque || Number.isNaN(valorSaque) || valorSaque < CONFIG.VALOR_SAQUE_MINIMO) {
        return {
            valido: false,
            mensagem: `⚠️ O valor mínimo para saque é de ${formatadorMoeda.format(CONFIG.VALOR_SAQUE_MINIMO)}.`,
            tipo: 'error',
        };
    }
    if (!chavePix) {
        return { valido: false, mensagem: '⚠️ Por favor, cadastre a sua chave PIX na aba Perfil.', tipo: 'warning' };
    }
    return { valido: true };
}

async function solicitarSaque(userId, dadosSaque, botao, modalElement) {
    setBotaoCarregando(botao, true, 'Enviando...');
    try {
        const saquesRef = ref(db, 'saques/' + userId);
        const novoSaqueRef = push(saquesRef);

        const valorBruto = dadosSaque.valorSaque;
        const valorLiquido = valorBruto * (1 - CONFIG.TAXA_SAQUE_PERCENTUAL);

        await set(novoSaqueRef, {
            chavePix: dadosSaque.chavePix,
            valorBruto: valorBruto,
            valorLiquido: valorLiquido,
            taxaAplicada: '14%',
            dataHora: new Date().toLocaleString('pt-BR'),
            status: 'Pendente',
        });

        mostrarToast('✅ Saque solicitado com sucesso!', 'success');
        
        if (modalElement) modalElement.style.display = 'none';
        const inputValor = getEl('modalValorSaque');
        if (inputValor) inputValor.value = '';
        const elResumo = getEl('resumoValorLiquido');
        if (elResumo) elResumo.innerText = '';

    } catch (error) {
        console.error('Erro ao solicitar saque:', error);
        mostrarToast('❌ Erro ao solicitar saque: ' + error.message, 'error');
    } finally {
        setBotaoCarregando(botao, false);
    }
}

function configurarModalSaque(userId, dadosUsuario) {
    const modal = getEl('modalSaqueSistema');
    const btnAbrir = getEl('btnAbrirSaqueModal');
    const btnFechar = getEl('fecharModalSaque');
    const btnConfirmar = getEl('btnConfirmarModalSacar');
    const inputValorSaque = getEl('modalValorSaque');
    const elResumo = getEl('resumoValorLiquido');

    if (!modal || !btnAbrir) return;

    btnAbrir.addEventListener('click', (e) => {
        e.preventDefault();
        modal.style.display = 'flex';
    });

    if (btnFechar) {
        btnFechar.addEventListener('click', () => {
            modal.style.display = 'none';
        });
    }

    window.addEventListener('click', (e) => {
        if (e.target === modal) modal.style.display = 'none';
    });

    if (inputValorSaque && elResumo) {
        inputValorSaque.addEventListener('input', () => {
            const valor = parseFloat(inputValorSaque.value);
            if (!valor || Number.isNaN(valor) || valor <= 0) {
                elResumo.innerText = '';
                return;
            }

            const taxa = valor * CONFIG.TAXA_SAQUE_PERCENTUAL;
            const liquido = valor - taxa;

            elResumo.innerText = `💡 Taxa (14%): ${formatadorMoeda.format(taxa)} | Você vai receber: ${formatadorMoeda.format(liquido)}`;
        });
    }

    if (btnConfirmar && !btnConfirmar.dataset.listenerAtivo) {
        btnConfirmar.addEventListener('click', () => {
            const valorSaque = parseFloat(inputValorSaque.value);
            const chavePix = dadosUsuario?.chavePix || '';

            const validacao = validarSaque({ valorSaque, chavePix });
            if (!validacao.valido) {
                mostrarToast(validacao.mensagem, validacao.tipo);
                return;
            }

            solicitarSaque(userId, { valorSaque, chavePix }, btnConfirmar, modal);
        });
        btnConfirmar.dataset.listenerAtivo = 'true';
    }
}

/* ==========================================================================
   Lógica do Modal de Depósito e Integração de Planos
   ========================================================================== */
function configurarModalDeposito() {
    const modal = getEl('modalDepositoSistema');
    const btnAbrir = getEl('btnAbrirDeposito');
    const btnFechar = getEl('fecharModalDeposito');
    const btnConfirmar = getEl('btnConfirmarModalDepositar');
    const selectPlano = getEl('modalValorPlano');

    if (!modal || !btnAbrir) return;

    btnAbrir.addEventListener('click', (e) => {
        e.preventDefault();
        modal.style.display = 'flex';
    });

    if (btnFechar) {
        btnFechar.addEventListener('click', () => {
            modal.style.display = 'none';
        });
    }

    window.addEventListener('click', (e) => {
        if (e.target === modal) modal.style.display = 'none';
    });

    if (btnConfirmar && !btnConfirmar.dataset.listenerAtivo) {
        btnConfirmar.addEventListener('click', () => {
            const plano = selectPlano.value;
            if (!plano) {
                mostrarToast('⚠️ Selecione um plano antes de continuar.', 'warning');
                return;
            }

            mostrarToast(`Gerando PIX via API para o plano de R$ ${plano},00...`, 'success');
            modal.style.display = 'none';
        });
        btnConfirmar.dataset.listenerAtivo = 'true';
    }
}

function configurarSelecaoPlanos() {
    const botoesPlano = document.querySelectorAll('.btn-escolher-plano');
    const inputValorPlano = document.getElementById('modalValorPlano');
    const modalDeposito = document.getElementById('modalDepositoSistema');

    botoesPlano.forEach(botao => {
        botao.addEventListener('click', (e) => {
            e.preventDefault();
            const valorPlano = botao.getAttribute('data-valor');

            if (inputValorPlano) {
                inputValorPlano.value = valorPlano;
            }

            if (modalDeposito) {
                modalDeposito.style.display = 'flex';
            }
        });
    });
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
   Inicialização Global
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
    configurarModalDeposito();
    configurarSelecaoPlanos();

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

                configurarModalSaque(userId, dados);
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
