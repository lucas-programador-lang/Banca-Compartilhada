import { auth, db, mostrarToast } from './auth.js';
import { ref, push, set, onValue, update } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
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

document.addEventListener('DOMContentLoaded', () => {
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

    btnConfirmarModalDep?.addEventListener('click', () => {
        const modalInput = document.getElementById('modalValorDepInput') || document.getElementById('modalValorPlano');
        const valorAtual = parseFloat(modalInput?.value || 0);

        if (valorAtual < 30) {
            if (modalToast) {
                modalToast.style.display = 'block';
                modalToast.textContent = "⚠️ O valor mínimo de depósito/plano é R$ 30,00.";
                setTimeout(() => { if (modalToast) modalToast.style.display = 'none'; }, 4000);
            }
            return;
        }

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

    const modalSaque = document.getElementById('modalSaque') || document.getElementById('modalSaqueSistema');
    const btnAbrirSaqueModal = document.getElementById('btnAbrirSaqueModal');
    const btnConfirmarModalSaque = document.getElementById('btnConfirmarModalSaque') || document.getElementById('btnSolicitarSaqueFinal') || document.getElementById('btnConfirmarModalSacar');

    let saldoAtualUsuario = 0;
    let userIdAtual = null;

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

        let boxSaldoModal = document.getElementById('boxSaldoDisponivelModal');
        if (!boxSaldoModal && modalSaque) {
            boxSaldoModal = document.createElement('div');
            boxSaldoModal.id = 'boxSaldoDisponivelModal';
            boxSaldoModal.style.cssText = "background: #1e1e1e; padding: 10px 14px; border-radius: 8px; margin-bottom: 12px; font-size: 14px; display: flex; justify-content: space-between; align-items: center; border: 1px solid #333;";
            const containerInsercao = modalSaque.querySelector('.modal-body') || modalSaque.querySelector('div');
            if (containerInsercao) containerInsercao.prepend(boxSaldoModal);
        }
        if (boxSaldoModal) {
            boxSaldoModal.innerHTML = `<span style="color: #aaa;">Saldo Disponível:</span> <strong style="color: #4ade80; font-size: 16px;">${formatadorMoeda.format(saldoAtualUsuario)}</strong>`;
        }

        const diaHoje = new Date().getDay();
        if (diaHoje !== CONFIG.DIA_SAQUE_PERMITIDO) {
            if (btnConfirmarModalSaque) {
                btnConfirmarModalSaque.disabled = true;
                btnConfirmarModalSaque.style.opacity = '0.6';
                btnConfirmarModalSaque.style.cursor = 'not-allowed';
            }
        } else {
            if (btnConfirmarModalSaque) {
                btnConfirmarModalSaque.disabled = false;
                btnConfirmarModalSaque.style.opacity = '1';
                btnConfirmarModalSaque.style.cursor = 'pointer';
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
                boxResumo.style.display = 'block';
                boxResumo.style.background = '#18181b';
                boxResumo.style.border = '1px solid #27272a';
                boxResumo.style.borderRadius = '8px';
                boxResumo.style.padding = '12px';
                boxResumo.style.marginTop = '10px';
                
                boxResumo.innerHTML = `
                    <div style="display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 13px; color: #a1a1aa;">
                        <span>💡 Taxa (14%):</span>
                        <span style="color: #f87171;">- ${formatadorMoeda.format(taxa)}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; font-size: 14px; font-weight: bold; color: #f4f4f5; border-top: 1px solid #27272a; pt: 6px;">
                        <span>Você vai receber:</span>
                        <span style="color: #4ade80;">${formatadorMoeda.format(liquido)}</span>
                    </div>
                `;
            }

            if (btnConfirmarModalSaque) {
                if (val > saldoAtualUsuario) {
                    btnConfirmarModalSaque.disabled = true;
                    btnConfirmarModalSaque.style.opacity = '0.5';
                    btnConfirmarModalSaque.style.cursor = 'not-allowed';
                } else if (val < CONFIG.VALOR_SAQUE_MINIMO) {
                    btnConfirmarModalSaque.disabled = true;
                    btnConfirmarModalSaque.style.opacity = '0.5';
                    btnConfirmarModalSaque.style.cursor = 'not-allowed';
                } else if (diaHoje !== CONFIG.DIA_SAQUE_PERMITIDO) {
                    btnConfirmarModalSaque.disabled = true;
                    btnConfirmarModalSaque.style.opacity = '0.5';
                    btnConfirmarModalSaque.style.cursor = 'not-allowed';
                } else {
                    btnConfirmarModalSaque.disabled = false;
                    btnConfirmarModalSaque.style.opacity = '1';
                    btnConfirmarModalSaque.style.cursor = 'pointer';
                }
            }
        } else {
            if (boxResumo) boxResumo.style.display = 'none';
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

        const tipoPixSaque = document.getElementById('saqueTipoPix')?.value
            || document.getElementById('perfilTipoPix')?.value
            || 'CPF';
        const chavePixSaque = document.getElementById('saqueChavePix')?.value
            || document.getElementById('perfilChavePix')?.value
            || '';

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
            }
        });

        inicializarPerfilUsuario(userId);
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
