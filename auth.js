import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
    initializeAppCheck,
    ReCaptchaV3Provider
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app-check.js";
import {
    getAuth,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    sendPasswordResetEmail,
    sendEmailVerification,
    onAuthStateChanged,
    deleteUser,
    signOut
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getDatabase, ref, set, get, update } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

/* ==========================================================================
   Configuração do Firebase
   ========================================================================== */
const firebaseConfig = {
    apiKey: "AIzaSyCvzby1p6_CU0yAASmlrbSyhj6yoyJ9qBQ",
    authDomain: "banca-compartilhada.firebaseapp.com",
    databaseURL: "https://banca-compartilhada-default-rtdb.firebaseio.com",
    projectId: "banca-compartilhada",
    storageBucket: "banca-compartilhada.firebasestorage.app",
    messagingSenderId: "395304529051",
    appId: "1:395304529051:web:7e81033404097b164fea3e"
};

const app = initializeApp(firebaseConfig);

const RECAPTCHA_SITE_KEY = "6Lfs-3gtAAAAACZId43LTsWWSDroAMI7uXED4KU9";

// Se o App Check não puder iniciar (navegador sem suporte, bloqueio de script),
// o login e o cadastro continuam abrindo em vez de quebrar a página inteira.
try {
    initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(RECAPTCHA_SITE_KEY),
        isTokenAutoRefreshEnabled: true
    });
} catch (erro) {
    console.error('Falha ao iniciar o App Check:', erro);
}

export const auth = getAuth(app);
export const db = getDatabase(app);

const WORKER_BASE_URL = 'https://apidabancacompartilhada.lucas-dev-programador.workers.dev';
const PRAZO_CONFIRMAR_EMAIL_HORAS = 72;   // igual ao do servidor: depois disso a conta não confirmada é excluída

const REDIRECT_APOS_LOGIN_MS = 1000;
const REDIRECT_APOS_CADASTRO_MS = 1500;

// true enquanto um login/cadastro está em andamento: impede o redirecionamento
// automático de quem já estava logado de atropelar o fluxo do formulário.
let acessoEmAndamento = false;

/* ==========================================================================
   Integração Android Nativo (Helpers)
   ========================================================================== */
export function vibrar() {
    if (window.AndroidBridge && typeof window.AndroidBridge.toqueSutil === 'function') {
        window.AndroidBridge.toqueSutil();
    }
}

function solicitarTokenPush() {
    try {
        if (window.AndroidBridge && typeof window.AndroidBridge.solicitarTokenFCM === 'function') {
            window.AndroidBridge.solicitarTokenFCM();
        }
    } catch (erro) {
        console.error('Falha ao pedir o token de notificação ao app:', erro);
    }
}

/* ==========================================================================
   Toast
   ========================================================================== */
function getToastContainer() {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.setAttribute('aria-live', 'polite');
        document.body.appendChild(container);
    }
    return container;
}

// Ícones desenhados (SVG). A cor vem do CSS (.toast.success / .error / .warning).
const ICONES_TOAST = {
    success: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m8 12.5 2.8 2.8L16 9.5"/></svg>',
    error: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/></svg>',
    warning: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
};

// Tira o emoji do começo da mensagem: mensagens de outros arquivos ainda podem
// começar com um emoji, e o próprio toast já desenha o ícone certo.
let EMOJI_NO_INICIO;
try {
    EMOJI_NO_INICIO = new RegExp('^[\\s\\u200d\\ufe0f\\p{Extended_Pictographic}]+', 'u');
} catch (erro) {
    // navegador antigo sem suporte a \p{...}: cobre os blocos de emoji mais comuns
    EMOJI_NO_INICIO = /^[\s\u200d\ufe0f\u2139\u2600-\u27bf\ud83c-\ud83e\udc00-\udfff]+/;
}

export function mostrarToast(mensagem, tipo = 'success') {
    vibrar(); // Vibra levemente sempre que um Toast aparece (feedback nativo)
    const container = getToastContainer();

    const toast = document.createElement('div');
    toast.className = `toast ${tipo}`;

    const icone = document.createElement('span');
    icone.className = 'toast__icon';
    icone.setAttribute('aria-hidden', 'true');
    icone.innerHTML = ICONES_TOAST[tipo] || ICONES_TOAST.success; // texto fixo daqui, nunca vem do usuário
    toast.appendChild(icone);

    const texto = document.createElement('span');
    texto.className = 'toast__text';
    texto.textContent = String(mensagem).replace(EMOJI_NO_INICIO, '');
    toast.appendChild(texto);

    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

/* ==========================================================================
   Helpers
   ========================================================================== */
function getEl(id) { return document.getElementById(id); }

function setBotaoCarregando(elemento, carregando, textoCarregando = 'Enviando...') {
    if (!elemento) return;
    const ehBotao = 'disabled' in elemento;
    if (carregando) {
        elemento.dataset.textoOriginal = elemento.dataset.textoOriginal || elemento.innerText;
        if (ehBotao) elemento.disabled = true;
        else elemento.style.pointerEvents = 'none';
        elemento.style.opacity = '0.65';
        elemento.innerText = textoCarregando;
    } else {
        if (ehBotao) elemento.disabled = false;
        else elemento.style.pointerEvents = '';
        elemento.style.opacity = '';
        elemento.innerText = elemento.dataset.textoOriginal || elemento.innerText;
    }
}

function traduzirErroFirebase(error, contexto = 'login') {
    const codigo = error?.code || '';
    const comuns = {
        'auth/network-request-failed': 'Sem conexão com a internet. Verifique e tente novamente.',
        'auth/too-many-requests': 'Muitas tentativas. Aguarde um momento.',
    };
    const mensagensCadastro = {
        'auth/email-already-in-use': 'Este e-mail já está cadastrado.',
        'auth/invalid-email': 'Informe um e-mail válido.',
        'auth/weak-password': 'A senha deve ter no mínimo 6 caracteres.',
        'auth/missing-password': 'Informe uma senha.',
    };
    const mensagensLogin = {
        'auth/invalid-email': 'E-mail ou senha inválidos.',
        'auth/user-disabled': 'Esta conta foi desativada.',
        'auth/user-not-found': 'E-mail ou senha inválidos.',
        'auth/wrong-password': 'E-mail ou senha inválidos.',
        'auth/invalid-credential': 'E-mail ou senha inválidos.',
    };
    const mensagensReset = {
        'auth/invalid-email': 'Informe um e-mail válido.',
        'auth/missing-email': 'Informe seu e-mail.',
    };
    const dicionarios = { cadastro: mensagensCadastro, login: mensagensLogin, reset: mensagensReset };
    const dicionario = dicionarios[contexto] || mensagensLogin;
    return dicionario[codigo] || comuns[codigo] || 'Ocorreu um erro. Tente novamente em instantes.';
}

function validarEmailSenha(email, senha) {
    if (!email || !senha) return 'Preencha e-mail e senha.';
    if (senha.length < 6) return 'A senha deve ter no mínimo 6 caracteres.';
    return null;
}

function aplicarMensagensValidacao(form, camposMensagens) {
    if (!form) return;
    Object.entries(camposMensagens).forEach(([idCampo, mensagens]) => {
        const input = getEl(idCampo);
        if (!input) return;
        input.addEventListener('invalid', () => {
            if (input.validity.valueMissing) input.setCustomValidity(mensagens.vazio || 'Preencha este campo.');
            else if (input.validity.typeMismatch) input.setCustomValidity(mensagens.invalido || 'Valor inválido.');
            else if (input.validity.tooShort) input.setCustomValidity(mensagens.curto || 'Valor muito curto.');
            else input.setCustomValidity('');
        });
        input.addEventListener('input', () => input.setCustomValidity(''));
    });
}

document.querySelectorAll('.toggle-senha').forEach((botao) => {
    botao.addEventListener('click', () => {
        vibrar(); // Feedback tátil ao mostrar/ocultar senha
        const campo = getEl(botao.dataset.alvo);
        if (!campo) return;
        const oculto = campo.type === 'password';
        campo.type = oculto ? 'text' : 'password';
        botao.setAttribute('aria-label', oculto ? 'Ocultar senha' : 'Mostrar senha');
        botao.classList.toggle('ativo', oculto);
    });
});

/* ==========================================================================
   Nome completo
   ========================================================================== */
let REGEX_PALAVRA_NOME;
try {
    REGEX_PALAVRA_NOME = new RegExp("^[\\p{L}][\\p{L}'’.-]*$", 'u');
} catch (erro) {
    REGEX_PALAVRA_NOME = /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’.-]*$/;
}

// Barra o lixo óbvio ("hwsr", "123", um nome só). Não prova que o nome é verdadeiro:
// quem confirma a identidade de verdade é o e-mail confirmado e o CPF/Pix no saque.
function validarNomeCompleto(nome) {
    const palavras = String(nome || '').split(' ').filter(Boolean);
    if (palavras.length < 2) return 'Informe seu nome e sobrenome.';
    if (!palavras.every((palavra) => REGEX_PALAVRA_NOME.test(palavra))) return 'Use apenas letras no nome.';

    const letras = (palavra) => palavra.replace(/[^\p{L}]/gu, '').length;
    try {
        if (letras(palavras[0]) < 2 || letras(palavras[palavras.length - 1]) < 2) return 'Informe seu nome e sobrenome.';
    } catch (erro) { /* navegador sem \p{L}: segue sem esta checagem */ }

    // nomes reais têm vogal; "hwsr" e "xkcd" não
    // (conta só as letras: "Jr." e "Dr." não entram nesta checagem)
    const semVogal = palavras.some((palavra) => {
        let soLetras = palavra;
        try { soLetras = palavra.replace(/[^\p{L}]/gu, ''); } catch (erro) { /* navegador sem \p{L} */ }
        return soLetras.length >= 3 && !/[aeiouyáàâãéêíóôõúü]/i.test(soLetras);
    });
    if (semVogal) return 'Informe seu nome e sobrenome reais.';
    return null;
}

/* ==========================================================================
   Códigos de indicação
   ========================================================================== */
const CHAVE_CODIGO_SALVO = 'bc_codigo_indicacao';

// Só aceita letras minúsculas, números, "_" e "-" (nunca "/", "." etc., que
// quebrariam o caminho do banco e derrubariam o cadastro no meio).
function normalizarCodigoIndicacao(valor) {
    const codigo = String(valor || '').trim().toLowerCase();
    return /^[a-z0-9_-]{3,30}$/.test(codigo) ? codigo : null;
}

function lerCodigoSalvo() {
    try { return localStorage.getItem(CHAVE_CODIGO_SALVO); } catch (erro) { return null; }
}

function salvarCodigo(codigo) {
    try { localStorage.setItem(CHAVE_CODIGO_SALVO, codigo); } catch (erro) { /* sem armazenamento: segue sem salvar */ }
}

function limparCodigoSalvo() {
    try { localStorage.removeItem(CHAVE_CODIGO_SALVO); } catch (erro) { /* ignora */ }
}

function gerarCodigoAleatorioCurto(tamanho = 6) {
    const caracteres = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const sorteio = new Uint32Array(tamanho);
    crypto.getRandomValues(sorteio);
    let codigo = '';
    for (let i = 0; i < tamanho; i++) codigo += caracteres.charAt(sorteio[i] % caracteres.length);
    return codigo;
}

async function gerarCodigoIndicacaoUnico() {
    for (let i = 0; i < 25; i++) {
        const tentativa = gerarCodigoAleatorioCurto(6);
        const snap = await get(ref(db, 'codigosIndicacao/' + tentativa));
        if (!snap.exists()) return tentativa;
    }
    return `${gerarCodigoAleatorioCurto(4)}${Date.now().toString(36).slice(-4)}`;
}

// Lê o ?ref= da URL e guarda no aparelho: quem entra por um link de indicação
// na página inicial e só depois abre o cadastro não perde o código.
function capturarCodigoIndicacao() {
    const params = new URLSearchParams(window.location.search);
    const daUrl = normalizarCodigoIndicacao(params.get('ref'));
    if (daUrl) salvarCodigo(daUrl);

    const codigo = daUrl || normalizarCodigoIndicacao(lerCodigoSalvo());
    const campoRefIndicador = getEl('refIndicador');
    const avisoIndicacao = getEl('avisoIndicacao');
    if (codigo && campoRefIndicador) {
        if (daUrl || !campoRefIndicador.value) campoRefIndicador.value = codigo;
        if (avisoIndicacao) avisoIndicacao.style.display = 'block';
    }
    return codigo;
}
capturarCodigoIndicacao();

/* ==========================================================================
   Perfil do usuário (gravação única: ou grava tudo, ou não grava nada)
   ========================================================================== */
async function criarPerfilDoUsuario(user, { nome, email, codigoIndicador }) {
    let uidIndicador = null;
    if (codigoIndicador) {
        try {
            const indicadorSnap = await get(ref(db, 'codigosIndicacao/' + codigoIndicador));
            const valor = indicadorSnap.exists() ? indicadorSnap.val() : null;
            if (typeof valor === 'string' && valor !== user.uid) uidIndicador = valor;
        } catch (erro) {
            // código de indicação inválido não pode impedir o cadastro
            console.error('Não foi possível ler o código de indicação:', erro);
        }
    }

    const dataCadastro = new Date().toISOString();
    let ultimoErro = null;

    // Se dois cadastros sortearem o mesmo código ao mesmo tempo, o banco recusa
    // a gravação inteira e tentamos de novo com outro código.
    for (let tentativa = 0; tentativa < 4; tentativa++) {
        const meuCodigoIndicacao = await gerarCodigoIndicacaoUnico();

        const perfil = {
            nome,
            email,
            tipoPix: 'cpf',
            chavePix: '',
            codigoIndicacao: meuCodigoIndicacao,
            dataCadastro,
        };
        if (uidIndicador) perfil.indicadoPor = uidIndicador;

        const mudancas = {
            [`usuarios/${user.uid}`]: perfil,
            [`codigosIndicacao/${meuCodigoIndicacao}`]: user.uid,
        };
        if (uidIndicador) {
            mudancas[`equipe/${uidIndicador}/${user.uid}`] = { nome, email, dataCadastro };
        }

        try {
            await update(ref(db), mudancas);
            return;
        } catch (erro) {
            ultimoErro = erro;
            console.error(`Falha ao gravar o perfil (tentativa ${tentativa + 1}):`, erro);
        }
    }
    throw ultimoErro || new Error('Não foi possível gravar o perfil.');
}

/* ==========================================================================
   Cadastro (register.html)
   ========================================================================== */
const registerForm = getEl('registerForm');
if (registerForm) {
    aplicarMensagensValidacao(registerForm, {
        nome: { vazio: 'Preencha seu nome completo.' },
        emailReg: { vazio: 'Preencha seu e-mail.', invalido: 'Informe um e-mail válido.' },
        senhaReg: { vazio: 'Preencha sua senha.', curto: 'A senha deve ter no mínimo 6 caracteres.' },
    });

    // Aviso fixo abaixo do botão: quem se cadastra já sabe do prazo
    const botaoCadastro = registerForm.querySelector('button[type="submit"]') || registerForm.querySelector('button');
    if (botaoCadastro && !getEl('avisoPrazoEmail')) {
        const nota = document.createElement('p');
        nota.id = 'avisoPrazoEmail';
        nota.textContent = `Depois de criar a conta, confirme seu e-mail em até ${PRAZO_CONFIRMAR_EMAIL_HORAS} horas. Contas que não confirmam o e-mail são excluídas automaticamente.`;
        nota.style.cssText = 'margin:10px 0 0;font-size:0.85rem;line-height:1.4;color:var(--text-muted);text-align:center;';
        botaoCadastro.insertAdjacentElement('afterend', nota);
    }

    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        vibrar();

        const nome = (getEl('nome')?.value || '').trim().replace(/\s+/g, ' ').slice(0, 80) || 'Usuário';
        const email = getEl('emailReg').value.trim();
        const senha = getEl('senhaReg').value;
        const codigoIndicador = normalizarCodigoIndicacao(getEl('refIndicador')?.value);
        const botao = registerForm.querySelector('button[type="submit"]') || registerForm.querySelector('button');

        const erroNome = validarNomeCompleto(nome);
        if (erroNome) {
            mostrarToast(erroNome, 'warning');
            getEl('nome')?.focus();
            return;
        }

        const erroValidacao = validarEmailSenha(email, senha);
        if (erroValidacao) {
            mostrarToast(erroValidacao, 'warning');
            return;
        }

        acessoEmAndamento = true;
        setBotaoCarregando(botao, true, 'Criando conta...');

        let user = null;
        try {
            const userCredential = await createUserWithEmailAndPassword(auth, email, senha);
            user = userCredential.user;

            await criarPerfilDoUsuario(user, { nome, email, codigoIndicador });
            limparCodigoSalvo();

            // e-mail de confirmação (se falhar, a conta continua valendo; o painel tem o botão de reenviar)
            let emailEnviado = false;
            try {
                await sendEmailVerification(user);
                emailEnviado = true;
            } catch (erroEmail) {
                console.error('Não foi possível enviar o e-mail de confirmação:', erroEmail);
            }

            mostrarToast(
                emailEnviado
                    ? `Conta criada! Confirme seu e-mail em até ${PRAZO_CONFIRMAR_EMAIL_HORAS} horas: enviamos um link para você.`
                    : 'Conta criada com sucesso!',
                'success'
            );
            solicitarTokenPush(); // pede ao Android o token de notificação push (FCM)

            setTimeout(() => {
                window.location.href = 'index.html';
            }, REDIRECT_APOS_CADASTRO_MS);
        } catch (error) {
            console.error('Erro ao criar conta:', error);

            if (user) {
                // A conta foi criada, mas o perfil não: desfaz a conta para a pessoa
                // poder tentar de novo com o mesmo e-mail, em vez de ficar presa.
                try {
                    await deleteUser(user);
                } catch (erroDesfazer) {
                    console.error('Não foi possível desfazer a conta incompleta:', erroDesfazer);
                    try { await signOut(auth); } catch (erroSaida) { /* ignora */ }
                }
                mostrarToast('Não foi possível concluir o cadastro. Tente novamente em instantes.', 'error');
            } else {
                mostrarToast(traduzirErroFirebase(error, 'cadastro'), 'error');
            }

            acessoEmAndamento = false;
            setBotaoCarregando(botao, false);
        }
    });
}

/* ==========================================================================
   Login (login.html)
   ========================================================================== */
const loginForm = getEl('loginForm');
if (loginForm) {
    aplicarMensagensValidacao(loginForm, {
        email: { vazio: 'Preencha seu e-mail.', invalido: 'Informe um e-mail válido.' },
        senha: { vazio: 'Preencha sua senha.' },
    });

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        vibrar();

        const email = getEl('email').value.trim();
        const senha = getEl('senha').value;
        const botao = loginForm.querySelector('button[type="submit"]') || loginForm.querySelector('button');

        if (!email || !senha) {
            mostrarToast('Preencha e-mail e senha.', 'warning');
            return;
        }

        acessoEmAndamento = true;
        setBotaoCarregando(botao, true, 'Entrando...');
        try {
            await signInWithEmailAndPassword(auth, email, senha);
            mostrarToast('Login efetuado com sucesso!', 'success');
            solicitarTokenPush(); // pede ao Android o token de notificação push (FCM)

            setTimeout(() => {
                window.location.href = 'index.html';
            }, REDIRECT_APOS_LOGIN_MS);
        } catch (error) {
            console.error('Erro ao fazer login:', error);
            mostrarToast(traduzirErroFirebase(error, 'login'), 'error');
            acessoEmAndamento = false;
            setBotaoCarregando(botao, false);
        }
    });
}

/* ==========================================================================
   Quem já está logado não precisa ver login/cadastro
   ========================================================================== */
if (registerForm || loginForm) {
    onAuthStateChanged(auth, (user) => {
        if (user && !acessoEmAndamento) {
            window.location.replace('index.html');
        }
    });
}

/* ==========================================================================
   Recuperação de senha (login.html)
   ========================================================================== */
const linkEsqueciSenha = getEl('esqueciSenha');
if (linkEsqueciSenha) {
    linkEsqueciSenha.addEventListener('click', async (e) => {
        e.preventDefault();
        vibrar();

        const campoEmail = getEl('email');
        const email = (campoEmail?.value || '').trim();

        if (!email) {
            mostrarToast('Informe seu e-mail no campo acima antes de solicitar a recuperação.', 'warning');
            campoEmail?.focus();
            return;
        }

        setBotaoCarregando(linkEsqueciSenha, true, 'Enviando...');
        try {
            await sendPasswordResetEmail(auth, email);
            mostrarToast('Se existir uma conta com este e-mail, enviamos um link de redefinição.', 'success');
        } catch (error) {
            // "conta não encontrada" recebe a mesma resposta de sucesso: assim ninguém
            // consegue descobrir quais e-mails estão cadastrados.
            if (error?.code === 'auth/user-not-found') {
                mostrarToast('Se existir uma conta com este e-mail, enviamos um link de redefinição.', 'success');
            } else {
                console.error('Erro ao solicitar redefinição de senha:', error);
                mostrarToast(traduzirErroFirebase(error, 'reset'), 'error');
            }
        } finally {
            setBotaoCarregando(linkEsqueciSenha, false);
        }
    });
}

/* ==========================================================================
   Proteção de páginas restritas
   ========================================================================== */
if (document.body.classList.contains('protected-page')) {
    onAuthStateChanged(auth, (user) => {
        if (user) {
            document.body.classList.remove('protected-page');
            // Se o usuário já estava logado e abriu o app, garante que o token FCM está atualizado
            solicitarTokenPush();
        } else {
            window.location.href = 'login.html';
        }
    });
}

/* ==========================================================================
   Confirmação de e-mail (painel)
   ==========================================================================
   Vale só para contas novas (as antigas estão dispensadas no servidor, em
   emailDispensado/{uid}). Enquanto o e-mail não é confirmado:
     - aparece o aviso com o prazo de 72 horas;
     - os botões de depositar, sacar, convidar e investir ficam bloqueados
       (o servidor também recusa: o bloqueio daqui é só para avisar na hora);
     - passado o prazo, o servidor exclui a conta automaticamente.
   Se o nó emailDispensado não puder ser lido, nada é bloqueado nem avisado. */
let avisoEmailIniciado = false;
let funcoesBloqueadas = false;

const SELETOR_FUNCOES_BLOQUEADAS = [
    '#btnAbrirDeposito', '#btnDepositar', '#btnConfirmarModalDepositar', '.btn-escolher-plano',
    '#btnAbrirSaqueModal', '#btnConfirmarModalSacar',
    '#btnCopiarLinkIndicacao', '#btnCompartilharConvite',
].join(', ');

const MENSAGEM_FUNCAO_BLOQUEADA = 'Confirme seu e-mail para usar esta função. Veja o aviso no topo do painel.';

// Intercepta o clique ANTES dos outros arquivos (fase de captura) e só avisa.
function bloquearCliqueSemEmail(evento) {
    if (!funcoesBloqueadas) return;
    const alvo = evento.target && evento.target.closest ? evento.target.closest(SELETOR_FUNCOES_BLOQUEADAS) : null;
    if (!alvo) return;
    evento.preventDefault();
    evento.stopImmediatePropagation();
    mostrarToast(MENSAGEM_FUNCAO_BLOQUEADA, 'warning');
}

// Esconde o link de indicação e explica o motivo, no lugar do link
function atualizarCartaoDeConvite(bloquear) {
    const cartao = document.querySelector('.referral-card');
    if (!cartao) return;
    const linhaLink = getEl('linkIndicacao') ? getEl('linkIndicacao').closest('.referral-link-row') : null;
    const botaoCompartilhar = getEl('btnCompartilharConvite');
    if (linhaLink) linhaLink.style.display = bloquear ? 'none' : '';
    if (botaoCompartilhar) botaoCompartilhar.style.display = bloquear ? 'none' : '';

    let nota = getEl('avisoConviteBloqueado');
    if (bloquear && !nota) {
        nota = document.createElement('p');
        nota.id = 'avisoConviteBloqueado';
        nota.textContent = 'Confirme seu e-mail para liberar o seu link de indicação.';
        nota.style.cssText = 'margin:8px 0 0;font-weight:600;';
        cartao.appendChild(nota);
    } else if (!bloquear && nota) {
        nota.remove();
    }
}

function definirFuncoesBloqueadas(bloquear) {
    funcoesBloqueadas = bloquear;
    atualizarCartaoDeConvite(bloquear);
}
document.addEventListener('click', bloquearCliqueSemEmail, true);

async function precisaConfirmarEmail(user) {
    if (user.emailVerified) return false;
    try {
        const snap = await get(ref(db, 'emailDispensado/' + user.uid));
        return snap.val() !== true;
    } catch (erro) {
        return false;
    }
}

// Avisa o servidor que o e-mail foi confirmado (ele confere dentro do token do Firebase).
async function avisarServidorEmailConfirmado(user) {
    try {
        const token = await user.getIdToken(true);   // token novo, já com o e-mail confirmado
        await fetch(`${WORKER_BASE_URL}/api/conta/email-confirmado`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
        });
    } catch (erro) {
        console.error('Não foi possível avisar o servidor da confirmação do e-mail:', erro);
    }
}

function textoDoPrazo(user) {
    const criadoEm = Date.parse((user.metadata && user.metadata.creationTime) || '');
    if (!Number.isFinite(criadoEm)) return `${PRAZO_CONFIRMAR_EMAIL_HORAS} horas após o cadastro`;
    const restanteMs = criadoEm + PRAZO_CONFIRMAR_EMAIL_HORAS * 3600000 - Date.now();
    if (restanteMs <= 0) return 'o prazo terminou e a conta será excluída em breve';
    const horas = Math.max(1, Math.ceil(restanteMs / 3600000));
    return `restam cerca de ${horas} ${horas === 1 ? 'hora' : 'horas'}`;
}

async function iniciarAvisoEmail(user) {
    const cartaoSaldo = document.querySelector('.balance-card');
    if (avisoEmailIniciado || !cartaoSaldo || !getEl('saldoDisponivel')) return;
    avisoEmailIniciado = true;

    // O app guarda o login; "emailVerified" pode estar desatualizado se a pessoa
    // confirmou pelo link em outro lugar. Recarrega antes de decidir.
    if (!user.emailVerified) {
        try { await user.reload(); } catch (erro) { /* segue com o que tem */ }
    }
    if (user.emailVerified) {
        avisarServidorEmailConfirmado(user);   // garante o registro no servidor
        return;
    }
    if (!(await precisaConfirmarEmail(user))) return;

    definirFuncoesBloqueadas(true);

    const aviso = document.createElement('div');
    aviso.id = 'avisoConfirmarEmail';
    aviso.setAttribute('role', 'status');
    Object.assign(aviso.style, {
        background: 'var(--warning-soft)',
        border: '1px solid var(--warning)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-md)',
        marginBottom: 'var(--space-md)',
        color: 'var(--text-main)',
    });

    const titulo = document.createElement('strong');
    titulo.textContent = 'Confirme seu e-mail para ativar a sua conta';
    titulo.style.display = 'block';
    titulo.style.marginBottom = '6px';

    const texto = document.createElement('p');
    texto.textContent = `Enviamos um link para ${user.email}. Sem a confirmação você não pode sacar, depositar, convidar nem fazer missões, e a conta será excluída automaticamente ${PRAZO_CONFIRMAR_EMAIL_HORAS} horas após o cadastro (${textoDoPrazo(user)}). Abra o e-mail (veja também a caixa de spam), toque no link e depois em "Já confirmei".`;
    texto.style.margin = '0 0 12px';
    texto.style.color = 'var(--text-muted)';

    const linhaBotoes = document.createElement('div');
    linhaBotoes.style.display = 'flex';
    linhaBotoes.style.flexWrap = 'wrap';
    linhaBotoes.style.gap = '8px';

    const botaoConfirmei = document.createElement('button');
    botaoConfirmei.type = 'button';
    botaoConfirmei.className = 'btn';
    botaoConfirmei.textContent = 'Já confirmei';

    const botaoReenviar = document.createElement('button');
    botaoReenviar.type = 'button';
    botaoReenviar.className = 'btn btn-outline';
    botaoReenviar.textContent = 'Reenviar e-mail';

    [botaoConfirmei, botaoReenviar].forEach((botao) => {
        botao.style.flex = '1 1 150px';
        botao.style.width = 'auto';
        linhaBotoes.appendChild(botao);
    });

    aviso.append(titulo, texto, linhaBotoes);
    cartaoSaldo.parentNode.insertBefore(aviso, cartaoSaldo);

    // Recarrega o usuário; se o e-mail já foi confirmado, avisa o servidor, libera as
    // funções e tira o aviso.
    async function conferirConfirmacao(silencioso) {
        try {
            const atual = auth.currentUser || user;
            await atual.reload();
            if (atual.emailVerified) {
                await avisarServidorEmailConfirmado(atual);
                definirFuncoesBloqueadas(false);
                aviso.remove();
                document.removeEventListener('visibilitychange', aoVoltarParaAba);
                mostrarToast('E-mail confirmado. Tudo liberado.', 'success');
                return;
            }
            if (!silencioso) mostrarToast('Ainda não encontramos a confirmação. Abra o link do e-mail e tente de novo.', 'warning');
        } catch (erro) {
            console.error('Erro ao conferir a confirmação do e-mail:', erro);
            if (!silencioso) mostrarToast('Não foi possível conferir agora. Tente novamente.', 'error');
        }
    }

    // quem volta do app de e-mail para o site é conferido sozinho
    function aoVoltarParaAba() {
        if (document.visibilityState === 'visible') conferirConfirmacao(true);
    }
    document.addEventListener('visibilitychange', aoVoltarParaAba);

    botaoConfirmei.addEventListener('click', async () => {
        vibrar();
        setBotaoCarregando(botaoConfirmei, true, 'Conferindo...');
        await conferirConfirmacao(false);
        setBotaoCarregando(botaoConfirmei, false);
    });

    botaoReenviar.addEventListener('click', async () => {
        vibrar();
        botaoReenviar.disabled = true;
        let espera = 5000;
        try {
            await sendEmailVerification(auth.currentUser || user);
            mostrarToast('Enviamos o e-mail de confirmação novamente. Veja também o spam.', 'success');
            espera = 60000;
        } catch (erro) {
            console.error('Erro ao reenviar o e-mail de confirmação:', erro);
            mostrarToast(
                erro?.code === 'auth/too-many-requests'
                    ? 'Muitas tentativas. Aguarde alguns minutos.'
                    : 'Não foi possível reenviar agora. Tente novamente em instantes.',
                'error'
            );
        }
        setTimeout(() => { botaoReenviar.disabled = false; }, espera);
    });
}

/* ==========================================================================
   LISTENERS GLOBAIS DA PONTE ANDROID (WEBVIEW)
   ==========================================================================
   O Android (MainActivity.java) chama estas funções injetando JavaScript
   diretamente no navegador (ex: window.onTokenFCM('token_aqui')).
   ========================================================================== */

// 1. Token Push do Firebase Cloud Messaging.
//    O Android pode entregar o token ANTES de o Firebase terminar de restaurar o
//    login. Por isso o token fica guardado e é salvo assim que o usuário aparecer.
let tokenFCMPendente = null;
let ultimoTokenSalvo = null;   // "uid:token", evita gravar o mesmo token várias vezes

async function salvarTokenFCM(user, tokenFCM) {
    const chave = `${user.uid}:${tokenFCM}`;
    if (ultimoTokenSalvo === chave) return;

    try {
        // Cópia que o servidor lê para enviar as notificações (rendimento, saque, comissão...)
        await set(ref(db, 'tokensPush/' + user.uid), tokenFCM);
        ultimoTokenSalvo = chave;
    } catch (error) {
        console.error('Erro ao salvar o token de notificação:', error);
        return;
    }

    try {
        await update(ref(db, 'usuarios/' + user.uid), {
            fcmToken: tokenFCM,
            ultimoAcessoApp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Erro ao salvar o token no perfil do usuário:', error);
    }
}

window.onTokenFCM = async function (tokenFCM) {
    // as regras do banco só aceitam tokens com mais de 20 e menos de 400 caracteres
    if (typeof tokenFCM !== 'string' || tokenFCM.length <= 20 || tokenFCM.length >= 400) return;
    tokenFCMPendente = tokenFCM;
    if (auth.currentUser) await salvarTokenFCM(auth.currentUser, tokenFCM);
};

onAuthStateChanged(auth, (user) => {
    if (!user) return;
    if (tokenFCMPendente) salvarTokenFCM(user, tokenFCMPendente);
    iniciarAvisoEmail(user);
});

// 2. Recebe o resultado da Biometria
window.onBiometriaResult = function (sucesso, mensagemErro) {
    if (sucesso) {
        mostrarToast('Identidade confirmada!', 'success');
        // Você pode usar isso para exibir saldo oculto, confirmar um saque no script.js, etc.
    } else {
        mostrarToast(`Autenticação cancelada ou falhou: ${mensagemErro}`, 'error');
    }
};

// 3. Recebe a notificação de mudança de Tema do sistema em Tempo Real
window.atualizarTema = function (isDark) {
    if (isDark) {
        document.body.classList.add('dark-theme');
        document.body.classList.remove('light-theme');
    } else {
        document.body.classList.add('light-theme');
        document.body.classList.remove('dark-theme');
    }
};
