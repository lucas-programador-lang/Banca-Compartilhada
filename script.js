import { auth, db, mostrarToast } from './auth.js';
import { ref, push, set, onValue, update } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const CONFIG = {
    VALOR_SAQUE_MINIMO: 35,
    DIA_SAQUE_PERMITIDO: 0,
    TAXA_SAQUE_PERCENTUAL: 0.14,
    VALORES_PLANOS_PERMITIDOS: [30, 50, 100, 300, 500, 1000],
    // URL real do Worker publicado no Cloudflare.
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

/**
 * Retorna o dia da semana (0 = domingo, ..., 6 = sábado) sempre no fuso
 * de Brasília (UTC-3, fixo — Brasil não tem mais horário de verão desde
 * 2019), em vez de usar new Date().getDay(), que depende do fuso horário
 * configurado no dispositivo do usuário. Sem isso, alguém em outro fuso
 * podia ver "domingo liberado" quando na verdade já era sábado ou
 * segunda em Brasília.
 *
 * ⚠️ Isso só corrige a EXIBIÇÃO/validação no navegador. A escrita do
 * saque ainda acontece direto pelo Firebase SDK no cliente — alguém
 * que quiser burlar a regra de "só domingo" pode fazer isso via
 * DevTools, porque não há checagem no servidor. Ver observação no
 * Worker sobre mover essa rota pra lá se precisar de segurança real.
 */
function obterDiaSemanaBrasilia() {
    const brasiliaMs = Date.now() - 3 * 60 * 60 * 1000;
    return new Date(brasiliaMs).getUTCDay();
}

function getEl(id) {
    return document.getElementById(id);
}

/**
 * Escapa caracteres especiais de HTML antes de inserir qualquer dado
 * vindo do Firebase (nome, e-mail, descrição, chave PIX, etc.) dentro
 * de innerHTML. Sem isso, alguém poderia se cadastrar com um "nome"
 * contendo tags/script e esse código executaria no navegador de quem
 * visualizasse aquele dado (ex.: no painel Equipe de outro usuário, ou
 * no painel admin) — um XSS armazenado clássico.
 */
function escapeHTML(texto) {
    return String(texto ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    }[c]));
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
        atualizarDisponibilidadePlanos(snapshot.val());
    });
}

/**
 * Desabilita o botão "APLICAR AGORA" de cada valor de plano que o
 * usuário já tem ativo agora (status !== 'finalizado') — limite de 1
 * plano por valor, por vez. Isso é só UX (evita a pessoa preencher
 * CPF/telefone pra um Pix que o Worker vai recusar); a validação que
 * importa de verdade acontece no servidor, em /api/pix/criar.
 */
function atualizarDisponibilidadePlanos(planosObj) {
    const planos = planosObj ? Object.values(planosObj) : [];
    const valoresAtivos = new Set(
        planos.filter(p => p.status !== 'finalizado').map(p => parseFloat(p.valor))
    );

    document.querySelectorAll('.btn-escolher-plano').forEach(btn => {
        const valor = parseFloat(btn.getAttribute('data-valor'));
        if (valoresAtivos.has(valor)) {
            btn.disabled = true;
            btn.textContent = 'PLANO JÁ ATIVO';
        } else {
            btn.disabled = false;
            btn.textContent = 'APLICAR AGORA';
        }
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
                    <td>${escapeHTML(registro.descricao) || '—'}</td>
                    <td class="plan-row__value plan-row__value--positive">${formatadorMoeda.format(registro.valor || 0)}</td>
                </tr>
            `;
        }).join('');
    });
}

// Gera um código curto aleatório (fallback), usado apenas se por
// algum motivo o usuário ainda não tiver nenhum codigoIndicacao salvo
// (ex.: contas muito antigas criadas antes desse campo existir).
// Usuários criados normalmente já recebem esse código no cadastro
// (ver auth.js). Contas antigas com código no formato anterior
// (numérico ou baseado no nome) MANTÊM o código que já têm — este
// gerador só entra em ação quando não existe nenhum código salvo.
function gerarCodigoAleatorioCurto(tamanho = 6) {
    const caracteres = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let codigo = '';
    for (let i = 0; i < tamanho; i++) {
        codigo += caracteres.charAt(Math.floor(Math.random() * caracteres.length));
    }
    return codigo;
}

function gerarLinkIndicacao(codigoIndicacao) {
    const baseUrl = window.location.href.split('index.html')[0].replace(/\/$/, '');
    return `${baseUrl}/register.html?ref=${codigoIndicacao}`;
}

// Só atualiza o valor do input — chamada toda vez que os dados do
// usuário mudam. Separada de inicializarEquipeUsuario, que registra
// listeners (copiar / tabela de membros) e só deve rodar uma vez.
function atualizarLinkIndicacao(codigoIndicacao) {
    const inputLink = getEl('linkIndicacao');
    if (inputLink && codigoIndicacao) {
        inputLink.value = gerarLinkIndicacao(codigoIndicacao);
    }
}

function inicializarEquipeUsuario(userId) {
    const inputLink = getEl('linkIndicacao');

    const btnCopiar = getEl('btnCopiarLinkIndicacao');
    if (btnCopiar && !btnCopiar.dataset.listenerAtivo) {
        btnCopiar.addEventListener('click', async () => {
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
    if (!tbody) return;

    // Lê diretamente equipe/{userId}, que já contém uma entrada por
    // indicado (gravada no momento do cadastro em auth.js). Evita a
    // query orderByChild('indicadoPor') em usuarios/, que é barrada
    // pelas regras do Realtime Database para usuários não-admin
    // (a leitura da raiz de usuarios/ exige isAdmin).
    const equipeRef = ref(db, 'equipe/' + userId);

    onValue(equipeRef, (snapshot) => {
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
                <td>${escapeHTML(membro.nome) || '—'}</td>
                <td>${escapeHTML(membro.email) || '—'}</td>
            </tr>
        `).join('');
    }, (error) => {
        console.error('Erro ao carregar indicados (verifique as Regras/index do Firebase):', error);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    let saldoAtualUsuario = 0;
    let userIdAtual = null;
    let userAtual = null; // referência ao User do Firebase Auth — necessária pra pegar o ID Token na hora do saque
    let nomeUsuarioAtual = '';
    let emailUsuarioAtual = '';

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
    const statusPagamentoPix = document.getElementById('statusPagamentoPix');
    const btnConfirmarModalDep = document.getElementById('btnConfirmarModalDep') || document.getElementById('btnConfirmarModalDepositar');
    const btnCopiarPix = document.getElementById('btnCopiarPix');

    // O botão de copiar só faz sentido depois que o código Pix real
    // foi gerado (antes disso, txtChaveCopiaCola mostra um texto de
    // exemplo estático). Fica escondido até areaQrCodePix ganhar a
    // classe "ativo".
    if (btnCopiarPix) btnCopiarPix.style.display = 'none';

    btnCopiarPix?.addEventListener('click', async () => {
        const pixEl = document.getElementById('txtChaveCopiaCola');
        const codigo = pixEl?.textContent.trim() || '';
        if (!codigo) return;

        try {
            await navigator.clipboard.writeText(codigo);
            mostrarToast('✅ Código Pix copiado!', 'success');
        } catch (error) {
            console.error('Erro ao copiar código Pix:', error);
            mostrarToast('⚠️ Não foi possível copiar automaticamente. Selecione o código manualmente.', 'warning');
        }
    });

    // Handle da função que cancela o listener de confirmação de pagamento
    // (onValue retorna sua própria função de "unsubscribe" no SDK v9+).
    let pararEscutaPagamento = null;

    function pararEscutaConfirmacaoPagamento() {
        if (pararEscutaPagamento) {
            pararEscutaPagamento();
            pararEscutaPagamento = null;
        }
    }

    /**
     * Fica de olho em depositos/{uid}/{depositoId} enquanto o modal está
     * aberto. Quando o webhook da Vizzion Pay (via Worker) marcar o
     * depósito como "aprovado", fecha o modal e avisa o usuário — sem
     * precisar de nenhuma ação manual dele ou de um admin.
     */
    function escutarConfirmacaoPagamento(uid, depositoId) {
        pararEscutaConfirmacaoPagamento();
        const depositoRef = ref(db, `depositos/${uid}/${depositoId}`);
        pararEscutaPagamento = onValue(depositoRef, (snapshot) => {
            const dados = snapshot.val();
            if (dados?.status === 'aprovado') {
                pararEscutaConfirmacaoPagamento();
                fecharModalDeposito();
                mostrarToast('✅ Pagamento confirmado! Seu plano já está ativo na Carteira.', 'success');
            } else if (dados?.status === 'recusado') {
                pararEscutaConfirmacaoPagamento();
                if (statusPagamentoPix) statusPagamentoPix.textContent = '❌ Pagamento não confirmado.';
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

    document.getElementById('fecharModalDepX')?.addEventListener('click', fecharModalDeposito);
    document.getElementById('fecharModalDeposito')?.addEventListener('click', fecharModalDeposito);
    document.getElementById('btnCancelarModalDep')?.addEventListener('click', fecharModalDeposito);

    modalDep?.addEventListener('click', (e) => {
        if (e.target === modalDep) fecharModalDeposito();
    });

    btnConfirmarModalDep?.addEventListener('click', async () => {
        const modalInput = document.getElementById('modalValorDepInput') || document.getElementById('modalValorPlano');
        const valorAtual = parseFloat(modalInput?.value || 0);
        const inputCpf = document.getElementById('modalDepositoCpf');
        const inputTelefone = document.getElementById('modalDepositoTelefone');

        if (valorAtual < 30) {
            if (modalToast) {
                modalToast.classList.add('ativo');
                modalToast.textContent = "⚠️ O valor mínimo de depósito/plano é R$ 30,00.";
                setTimeout(() => { if (modalToast) modalToast.classList.remove('ativo'); }, 4000);
            }
            return;
        }

        // A área do QR Code só fica visível depois que o Pix é gerado —
        // se ainda não tem a classe "ativo", é a primeira vez que o
        // botão é clicado.
        if (areaQrCodePix && !areaQrCodePix.classList.contains('ativo')) {
            if (!userIdAtual) {
                mostrarToast('❌ Você precisa estar logado para solicitar um depósito.', 'error');
                return;
            }

            const cpf = inputCpf?.value.trim() || '';
            const telefone = inputTelefone?.value.trim() || '';

            if (!cpf || !telefone) {
                mostrarToast('⚠️ Informe CPF e telefone para gerar o Pix.', 'warning');
                return;
            }

            setBotaoCarregando(btnConfirmarModalDep, true, 'Gerando Pix...');
            try {
                // 1. Cria o registro do depósito (status "pendente") — o
                //    Worker/webhook vai atualizar esse mesmo registro
                //    quando o pagamento for confirmado.
                const depositosRef = ref(db, 'depositos/' + userIdAtual);
                const novoDepositoRef = push(depositosRef);
                const depositoId = novoDepositoRef.key;

                await set(novoDepositoRef, {
                    valorPlano: valorAtual,
                    status: 'pendente',
                    dataSolicitacao: new Date().toISOString(),
                });

                // 2. Pede pro Worker gerar a cobrança Pix de verdade na
                //    Vizzion Pay (as chaves da API ficam só no Worker).
                const respostaPix = await fetch(`${CONFIG.WORKER_BASE_URL}/api/pix/criar`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        uid: userIdAtual,
                        depositoId,
                        valorPlano: valorAtual,
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

                // 3. Mostra o QR Code / copia-e-cola reais devolvidos pela
                //    Vizzion Pay.
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
                btnConfirmarModalDep.style.display = 'none'; // a confirmação agora é automática via webhook

                // 4. Fica escutando em tempo real até o webhook confirmar
                //    o pagamento (ou recusar).
                escutarConfirmacaoPagamento(userIdAtual, depositoId);
            } catch (error) {
                console.error('Erro ao gerar Pix:', error);
                mostrarToast('❌ ' + error.message, 'error');
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

    modalSaque?.querySelector('a[data-target="view-perfil"]')?.addEventListener('click', (e) => {
        e.preventDefault();
        fecharModalSaque();
        const navPerfil = document.querySelector('[data-target="view-perfil"]');
        if (navPerfil) navPerfil.click();
    });

    btnConfirmarModalSaque?.addEventListener('click', async () => {
        if (!userIdAtual || !userAtual) {
            mostrarToast('❌ Você precisa estar logado para solicitar um saque.', 'error');
            return;
        }

        const valorSaque = parseFloat(inputValSaque?.value || 0);

        // As checagens aqui são só feedback rápido pro usuário (evita uma
        // ida e volta ao servidor por engano). Quem decide de verdade —
        // dia da semana em horário de Brasília, saldo real, chave PIX — é
        // o Worker, que não confia em nada vindo do navegador.
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

            mostrarToast('✅ Saque solicitado com sucesso!', 'success');
            fecharModalSaque();
        } catch (error) {
            console.error('Erro ao solicitar saque:', error);
            mostrarToast('❌ ' + error.message, 'error');
        } finally {
            setBotaoCarregando(btnConfirmarModalSaque, false);
        }
    });

    auth.onAuthStateChanged((user) => {
        if (!user) return;
        const userId = user.uid;
        userIdAtual = userId;
        userAtual = user;
        emailUsuarioAtual = user.email || '';

        const userRef = ref(db, 'usuarios/' + userId);
        onValue(userRef, (snapshot) => {
            const dados = snapshot.val();
            if (dados) {
                nomeUsuarioAtual = dados.nome || user.email || 'Usuário';

                const nomeUsuario = dados.nome || user.email || 'Usuário';
                const elNome = getEl('userNameDisplay');
                const elInicial = getEl('userInitial');

                if (elNome) elNome.innerText = nomeUsuario;
                if (elInicial) elInicial.innerText = nomeUsuario.charAt(0).toUpperCase();

                // O código de indicação já deve ter sido salvo no cadastro
                // (ver auth.js — gerarCodigoIndicacaoUnico). Se, por algum
                // motivo, uma conta antiga não tiver NENHUM código salvo,
                // geramos um curto aleatório aqui como fallback único e
                // gravamos para sempre. Contas que já têm um código
                // (qualquer formato, incluindo os antigos) NÃO são
                // alteradas — o valor salvo é sempre respeitado.
                let codigo = dados.codigoIndicacao;
                if (!codigo) {
                    codigo = gerarCodigoAleatorioCurto(6);
                    update(userRef, { codigoIndicacao: codigo }).catch((error) => {
                        console.error('Erro ao salvar código de indicação:', error);
                    });
                }

                atualizarLinkIndicacao(codigo);
            }
        });

        // Saldo, comissão e rendimento moram em financeiro/{uid}, separado
        // de usuarios/{uid} — as Regras do Firebase só deixam o Worker
        // (com credenciais de admin) escrever aqui. O usuário só lê. Isso
        // fecha a brecha de alguém editar o próprio saldo direto pelo
        // Firebase SDK/DevTools, que existia enquanto saldo ficava dentro
        // de usuarios/{uid} (nó que o dono da conta sempre pode escrever,
        // por causa do Perfil).
        const financeiroRef = ref(db, 'financeiro/' + userId);
        onValue(financeiroRef, (snapshot) => {
            const dadosFinanceiros = snapshot.val() || {};
            // saldoAtualUsuario é usado só pra checagem rápida de UX no
            // modal de saque (feedback antes de chamar o Worker) — soma
            // os dois potes porque o usuário não sabe, e não precisa
            // saber, de onde veio cada parte; quem decide de verdade se
            // a comissão está liberada é o Worker.
            saldoAtualUsuario = parseFloat(dadosFinanceiros.saldoRendimento || 0) + parseFloat(dadosFinanceiros.saldoComissao || 0);
            atualizarPainel(dadosFinanceiros);
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
