import { auth, db, mostrarToast } from './auth.js';
import { ref, push, set, onValue, update } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

/* ==========================================================================
   Configurações / Constantes
   ========================================================================== */
const CONFIG = {
    VALOR_SAQUE_MINIMO: 35,
    DIA_SAQUE_PERMITIDO: 0, // 0 = Domingo (Restrito apenas para domingos)
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

/**
 * Ativa/desativa um botão durante uma operação assíncrona,
 * evitando duplo clique e dando feedback visual ao usuário.
 */
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
   Regras de negócio: Saque
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
        return { valido: false, mensagem: '⚠️ Por favor, informe a sua chave PIX.', tipo: 'warning' };
    }
    return { valido: true };
}

async function solicitarSaque(userId, dadosSaque, botao) {
    setBotaoCarregando(botao, true, 'Enviando solicitação...');
    try {
        const saquesRef = ref(db, 'saques/' + userId);
        const novoSaqueRef = push(saquesRef);

        await set(novoSaqueRef, {
            chavePix: dadosSaque.chavePix,
            valor: dadosSaque.valorSaque,
            dataHora: new Date().toLocaleString('pt-BR'),
            status: 'Pendente',
        });

        mostrarToast('✅ Saque solicitado com sucesso!', 'success');
        getEl('valorSaque').value = '';
    } catch (error) {
        console.error('Erro ao solicitar saque:', error);
        mostrarToast('❌ Erro ao solicitar saque: ' + error.message, 'error');
    } finally {
        setBotaoCarregando(botao, false);
    }
}

function inicializarBotaoSaque(userId) {
    const btnSacar = getEl('btnSacar');
    if (!btnSacar || btnSacar.dataset.listenerAtivo) return;

    btnSacar.addEventListener('click', () => {
        const valorSaque = parseFloat(getEl('valorSaque').value);
        const chavePix = getEl('chavePix').value.trim();

        const validacao = validarSaque({ valorSaque, chavePix });
        if (!validacao.valido) {
            mostrarToast(validacao.mensagem, validacao.tipo);
            return;
        }

        solicitarSaque(userId, { valorSaque, chavePix }, btnSacar);
    });

    // Marca o botão para não duplicar o listener caso a autenticação dispare novamente
    btnSacar.dataset.listenerAtivo = 'true';
}

/* ==========================================================================
   Gestão de Perfil e Bloqueio de Chave PIX
   ========================================================================== */
function inicializarPerfilUsuario(userId) {
    const perfilTipoPix = getEl('perfilTipoPix');
    const perfilChavePix = getEl('perfilChavePix');
    const perfilNome = getEl('perfilNome');
    const campoPixInicio = getEl('chavePix');
    const btnSalvarPerfil = getEl('btnSalvarPerfil');

    if (!btnSalvarPerfil) return;

    const userRef = ref(db, 'usuarios/' + userId);
    
    // Ouve os dados do usuário para preencher a aba de Perfil e bloquear a edição se já houver chave
    onValue(userRef, (snapshot) => {
        const dados = snapshot.val();
        if (dados) {
            if (perfilNome && dados.nome && !perfilNome.value) perfilNome.value = dados.nome;
            if (perfilTipoPix && dados.tipoPix) perfilTipoPix.value = dados.tipoPix;
            
            if (dados.chavePix) {
                if (perfilChavePix) {
                    perfilChavePix.value = dados.chavePix;
                    // TRAVA: Se já tem chave cadastrada, bloqueia a edição definitiva
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
                    btnSalvarPerfil.style.display = 'none'; // Oculta o botão de salvar se já estiver cadastrado
                }
            }

            if (dados.chavePix && campoPixInicio && !campoPixInicio.value) {
                campoPixInicio.value = dados.chavePix;
            }
        }
    });

    // Salva as alterações de perfil apenas na primeira vez
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

                if (campoPixInicio) {
                    campoPixInicio.value = novaChavePix;
                }

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
   Depósito
   ========================================================================== */
function inicializarBotaoDeposito() {
    const btnDepositar = getEl('btnDepositar');
    if (!btnDepositar) return;

    btnDepositar.addEventListener('click', () => {
        const plano = getEl('valorPlano').value;
        if (!plano) {
            mostrarToast('⚠️ Selecione um plano antes de continuar.', 'warning');
            return;
        }

        mostrarToast(`Gerando PIX via API para o plano de R$ ${plano},00...`, 'success');
        // TODO: integrar com a API de pagamento (Mercado Pago, OpenPix, etc.)
    });
}

/* ==========================================================================
   Inicialização
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
    inicializarBotaoDeposito();

    auth.onAuthStateChanged((user) => {
        if (!user) return;

        const userId = user.uid;

        const userRef = ref(db, 'usuarios/' + userId);
        onValue(userRef, (snapshot) => {
            const dados = snapshot.val();
            if (dados) {
                atualizarPainel(dados);

                // Atualiza o nome e a inicial do usuário na Sidebar
                const nomeUsuario = dados.nome || user.email || 'Usuário';
                const elNome = getEl('userNameDisplay');
                const elInicial = getEl('userInitial');

                if (elNome) elNome.innerText = nomeUsuario;
                if (elInicial) elInicial.innerText = nomeUsuario.charAt(0).toUpperCase();
            }
        });

        inicializarBotaoSaque(userId);
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

            // Gerencia classe ativa do menu
            navItems.forEach(nav => nav.classList.remove('active'));
            this.classList.add('active');

            // Pega o alvo da seção correspondente
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
