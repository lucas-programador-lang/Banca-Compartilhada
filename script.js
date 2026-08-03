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
   Modal e Regras de Saque
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

function criarModalSaque(userId, chavePixSalva) {
    let modal = getEl('modalSaqueSistema');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'modalSaqueSistema';
        modal.style.cssText = `
            display: none; position: fixed; z-index: 9999; left: 0; top: 0; width: 100%; height: 100%;
            background-color: rgba(0,0,0,0.7); align-items: center; justify-content: center;
        `;

        modal.innerHTML = `
            <div style="background: #1e1e2f; padding: 25px; border-radius: 12px; width: 90%; max-width: 400px; color: #fff; box-shadow: 0 4px 20px rgba(0,0,0,0.5); position: relative;">
                <button id="fecharModalSaque" style="position: absolute; right: 15px; top: 15px; background: none; border: none; color: #aaa; font-size: 20px; cursor: pointer;">&times;</button>
                <h3 style="margin-bottom: 15px; font-size: 1.2rem; color: #fff;">Solicitar Saque</h3>
                
                <p style="font-size: 0.85rem; color: #f59e0b; margin-bottom: 12px; background: rgba(245, 158, 11, 0.1); padding: 8px; border-radius: 6px; text-align: center;">
                    ⏳ <strong>Liberado apenas aos Domingos</strong>
                </p>

                <div style="margin-bottom: 15px;">
                    <label style="display: block; font-size: 0.9rem; margin-bottom: 5px; color: #ccc;">Valor do Saque:</label>
                    <input type="number" id="modalValorSaque" placeholder="Ex: 50.00" style="width: 100%; padding: 10px; background: #2a2a3eb5; border: 1px solid #444; color: #fff; border-radius: 6px; outline: none;">
                    <small style="display: block; color: #aaa; margin-top: 4px;">Mínimo R$ 35,00 | Taxa: 14%</small>
                </div>

                <div id="resumoValorLiquido" style="font-size: 0.9rem; margin-bottom: 20px; color: #10B981; min-height: 20px;"></div>

                <button id="btnConfirmarModalSacar" style="width: 100%; padding: 12px; background: #6366f1; border: none; color: #fff; font-weight: bold; border-radius: 6px; cursor: pointer;">Solicitar Saque</button>
            </div>
        `;
        document.body.appendChild(modal);

        modal.querySelector('#fecharModalSaque').addEventListener('click', () => {
            modal.style.display = 'none';
        });

        window.addEventListener('click', (e) => {
            if (e.target === modal) modal.style.display = 'none';
        });

        // Cálculo em tempo real dos 14%
        const inputValorSaque = modal.querySelector('#modalValorSaque');
        const elResumo = modal.querySelector('#resumoValorLiquido');

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

        const btnConfirmar = modal.querySelector('#btnConfirmarModalSacar');
        btnConfirmar.addEventListener('click', () => {
            const valorSaque = parseFloat(modal.querySelector('#modalValorSaque').value);
            const chavePix = chavePixSalva;

            const validacao = validarSaque({ valorSaque, chavePix });
            if (!validacao.valido) {
                mostrarToast(validacao.mensagem, validacao.tipo);
                return;
            }

            solicitarSaque(userId, { valorSaque, chavePix }, btnConfirmar, modal);
        });
    }

    return modal;
}

function inicializarBotaoSaque(userId, dadosUsuario) {
    const btnSacar = getEl('btnSacar');
    if (!btnSacar || btnSacar.dataset.listenerAtivo) return;

    btnSacar.addEventListener('click', (e) => {
        e.preventDefault();
        const modal = criarModalSaque(userId, dadosUsuario?.chavePix || '');
        modal.style.display = 'flex';
    });

    btnSacar.dataset.listenerAtivo = 'true';
}

/* ==========================================================================
   Modal e Regras de Depósito
   ========================================================================== */
function criarModalDeposito() {
    let modal = getEl('modalDepositoSistema');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'modalDepositoSistema';
        modal.style.cssText = `
            display: none; position: fixed; z-index: 9999; left: 0; top: 0; width: 100%; height: 100%;
            background-color: rgba(0,0,0,0.7); align-items: center; justify-content: center;
        `;

        modal.innerHTML = `
            <div style="background: #1e1e2f; padding: 25px; border-radius: 12px; width: 90%; max-width: 400px; color: #fff; box-shadow: 0 4px 20px rgba(0,0,0,0.5); position: relative;">
                <button id="fecharModalDeposito" style="position: absolute; right: 15px; top: 15px; background: none; border: none; color: #aaa; font-size: 20px; cursor: pointer;">&times;</button>
                <h3 style="margin-bottom: 15px; font-size: 1.2rem; color: #fff;">Fazer Depósito / Investimento</h3>
                
                <div style="margin-bottom: 15px;">
                    <label style="display: block; font-size: 0.9rem; margin-bottom: 5px; color: #ccc;">Selecione o Plano:</label>
                    <select id="modalValorPlano" style="width: 100%; padding: 10px; background: #2a2a3eb5; border: 1px solid #444; color: #fff; border-radius: 6px; outline: none;">
                        <option value="">Selecione um valor...</option>
                        <option value="50">R$ 50,00</option>
                        <option value="100">R$ 100,00</option>
                        <option value="250">R$ 250,00</option>
                        <option value="500">R$ 500,00</option>
                    </select>
                </div>

                <button id="btnConfirmarModalDepositar" style="width: 100%; padding: 12px; background: #10B981; border: none; color: #fff; font-weight: bold; border-radius: 6px; cursor: pointer;">Gerar PIX de Depósito</button>
            </div>
        `;
        document.body.appendChild(modal);

        modal.querySelector('#fecharModalDeposito').addEventListener('click', () => {
            modal.style.display = 'none';
        });

        window.addEventListener('click', (e) => {
            if (e.target === modal) modal.style.display = 'none';
        });

        const btnConfirmarDep = modal.querySelector('#btnConfirmarModalDepositar');
        btnConfirmarDep.addEventListener('click', () => {
            const plano = modal.querySelector('#modalValorPlano').value;
            if (!plano) {
                mostrarToast('⚠️ Selecione um plano antes de continuar.', 'warning');
                return;
            }

            mostrarToast(`Gerando PIX via API para o plano de R$ ${plano},00...`, 'success');
            modal.style.display = 'none';
        });
    }

    return modal;
}

function inicializarBotaoDeposito() {
    const btnDepositar = getEl('btnDepositar');
    if (!btnDepositar || btnDepositar.dataset.listenerAtivo) return;

    btnDepositar.addEventListener('click', (e) => {
        e.preventDefault();
        const modal = criarModalDeposito();
        modal.style.display = 'flex';
    });

    btnDepositar.dataset.listenerAtivo = 'true';
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

                const nomeUsuario = dados.nome || user.email || 'Usuário';
                const elNome = getEl('userNameDisplay');
                const elInicial = getEl('userInitial');

                if (elNome) elNome.innerText = nomeUsuario;
                if (elInicial) elInicial.innerText = nomeUsuario.charAt(0).toUpperCase();

                inicializarBotaoSaque(userId, dados);
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
