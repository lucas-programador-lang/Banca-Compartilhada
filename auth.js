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
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
// Adicionado o 'update' para podermos salvar o token FCM no perfil do usuário depois
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

initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(RECAPTCHA_SITE_KEY),
    isTokenAutoRefreshEnabled: true
});

export const auth = getAuth(app);
export const db = getDatabase(app);

const REDIRECT_APOS_LOGIN_MS = 1000;
const REDIRECT_APOS_CADASTRO_MS = 1500;

/* ==========================================================================
   Integração Android Nativo (Helpers)
   ========================================================================== */
export function vibrar() {
    if (window.AndroidBridge && typeof window.AndroidBridge.toqueSutil === 'function') {
        window.AndroidBridge.toqueSutil();
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
        document.body.appendChild(container);
    }
    return container;
}

// Ícones desenhados (SVG) no lugar dos emojis. A cor vem do CSS (.toast.success / .error / .warning).
const ICONES_TOAST = {
    success: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m8 12.5 2.8 2.8L16 9.5"/></svg>',
    error: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/></svg>',
    warning: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
};

// Tira o emoji do começo da mensagem: muitas mensagens antigas ainda começam com
// um emoji, e agora o próprio toast desenha o ícone certo.
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
   Helpers (Omitidos os não modificados para brevidade, mantenha os seus)
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
        'auth/too-many-requests': 'Muitas tentativas. Aguarde um momento.',
    };
    const mensagensReset = {
        'auth/invalid-email': 'Informe um e-mail válido.',
        'auth/user-not-found': 'Não encontramos uma conta com este e-mail.',
        'auth/too-many-requests': 'Muitas tentativas. Aguarde um momento.',
    };
    const dicionarios = { cadastro: mensagensCadastro, login: mensagensLogin, reset: mensagensReset };
    const dicionario = dicionarios[contexto] || mensagensLogin;
    return dicionario[codigo] || 'Ocorreu um erro. Tente novamente em instantes.';
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

function gerarCodigoAleatorioCurto(tamanho = 6) {
    const caracteres = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let codigo = '';
    for (let i = 0; i < tamanho; i++) codigo += caracteres.charAt(Math.floor(Math.random() * caracteres.length));
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

function capturarCodigoIndicacao() {
    const params = new URLSearchParams(window.location.search);
    const codigoRef = params.get('ref');
    const campoRefIndicador = getEl('refIndicador');
    const avisoIndicacao = getEl('avisoIndicacao');
    if (codigoRef && campoRefIndicador) {
        campoRefIndicador.value = codigoRef.trim().toLowerCase();
        if (avisoIndicacao) avisoIndicacao.style.display = 'block';
    }
    return codigoRef ? codigoRef.trim().toLowerCase() : null;
}
capturarCodigoIndicacao();

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

    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        vibrar();

        const nome = getEl('nome')?.value.trim() || 'Usuário';
        const email = getEl('emailReg').value.trim();
        const senha = getEl('senhaReg').value;
        const codigoIndicadorDigitado = getEl('refIndicador')?.value.trim().toLowerCase() || null;
        const botao = registerForm.querySelector('button[type="submit"]') || registerForm.querySelector('button');

        const erroValidacao = validarEmailSenha(email, senha);
        if (erroValidacao) {
            mostrarToast(`⚠️ ${erroValidacao}`, 'warning');
            return;
        }

        setBotaoCarregando(botao, true, 'Criando conta...');
        try {
            const userCredential = await createUserWithEmailAndPassword(auth, email, senha);
            const user = userCredential.user;

            let uidIndicador = null;
            if (codigoIndicadorDigitado) {
                const indicadorSnap = await get(ref(db, 'codigosIndicacao/' + codigoIndicadorDigitado));
                uidIndicador = indicadorSnap.exists() ? indicadorSnap.val() : null;
            }

            const meuCodigoIndicacao = await gerarCodigoIndicacaoUnico();

            await set(ref(db, 'usuarios/' + user.uid), {
                nome: nome,
                email: email,
                saldo: 0,
                rendimento: 0,
                comissao: 0,
                tipoPix: 'cpf',
                chavePix: '',
                indicadoPor: uidIndicador,
                codigoIndicacao: meuCodigoIndicacao,
                dataCadastro: new Date().toISOString()
            });

            await set(ref(db, 'codigosIndicacao/' + meuCodigoIndicacao), user.uid);

            if (uidIndicador) {
                await set(ref(db, `equipe/${uidIndicador}/${user.uid}`), {
                    nome: nome,
                    email: email,
                    dataCadastro: new Date().toISOString()
                });
            }

            mostrarToast('🎉 Conta criada com sucesso!', 'success');
            
            // Solicita ao Android o token de Notificação Push (FCM)
            if (window.AndroidBridge && window.AndroidBridge.solicitarTokenFCM) {
                window.AndroidBridge.solicitarTokenFCM();
            }

            setTimeout(() => {
                window.location.href = 'index.html';
            }, REDIRECT_APOS_CADASTRO_MS);
        } catch (error) {
            console.error('Erro ao criar conta:', error);
            mostrarToast('❌ ' + traduzirErroFirebase(error, 'cadastro'), 'error');
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
            mostrarToast('⚠️ Preencha e-mail e senha.', 'warning');
            return;
        }

        setBotaoCarregando(botao, true, 'Entrando...');
        try {
            await signInWithEmailAndPassword(auth, email, senha);
            mostrarToast('✅ Login efetuado com sucesso!', 'success');
            
            // Solicita ao Android o token de Notificação Push (FCM) após o login
            if (window.AndroidBridge && window.AndroidBridge.solicitarTokenFCM) {
                window.AndroidBridge.solicitarTokenFCM();
            }

            setTimeout(() => {
                window.location.href = 'index.html';
            }, REDIRECT_APOS_LOGIN_MS);
        } catch (error) {
            console.error('Erro ao fazer login:', error);
            mostrarToast('❌ ' + traduzirErroFirebase(error, 'login'), 'error');
            setBotaoCarregando(botao, false);
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
            mostrarToast('⚠️ Informe seu e-mail no campo acima antes de solicitar a recuperação.', 'warning');
            campoEmail?.focus();
            return;
        }

        setBotaoCarregando(linkEsqueciSenha, true, 'Enviando...');
        try {
            await sendPasswordResetEmail(auth, email);
            mostrarToast('📩 Enviamos um link de redefinição para o seu e-mail.', 'success');
        } catch (error) {
            console.error('Erro ao solicitar redefinição de senha:', error);
            mostrarToast('❌ ' + traduzirErroFirebase(error, 'reset'), 'error');
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
            if (window.AndroidBridge && window.AndroidBridge.solicitarTokenFCM) {
                window.AndroidBridge.solicitarTokenFCM();
            }
        } else {
            window.location.href = 'login.html';
        }
    });
}

/* ==========================================================================
   LISTENERS GLOBAIS DA PONTE ANDROID (WEBVIEW)
   ========================================================================== 
   O Android (MainActivity.java) chama estas funções injetando JavaScript
   diretamente no navegador (ex: window.onTokenFCM('token_aqui')).
   ========================================================================== */

// 1. Recebe o Token Push do Firebase Cloud Messaging do Android e salva no Realtime DB
window.onTokenFCM = async function(tokenFCM) {
    console.log("🔑 Token FCM recebido do Android:", tokenFCM);
    const user = auth.currentUser;
    if (user && tokenFCM) {
        try {
            await update(ref(db, 'usuarios/' + user.uid), { 
                fcmToken: tokenFCM,
                ultimoAcessoApp: new Date().toISOString()
            });
            console.log("✅ Token FCM salvo no perfil do usuário.");
        } catch (error) {
            console.error("❌ Erro ao salvar Token FCM:", error);
        }
    }
};

// 2. Recebe o resultado da Biometria
window.onBiometriaResult = function(sucesso, mensagemErro) {
    if (sucesso) {
        mostrarToast('✅ Identidade confirmada!', 'success');
        // Você pode usar isso para exibir saldo oculto, confirmar um saque no script.js, etc.
    } else {
        mostrarToast(`❌ Autenticação cancelada/falhou: ${mensagemErro}`, 'error');
    }
};

// 3. Recebe a notificação de mudança de Tema do sistema em Tempo Real
window.atualizarTema = function(isDark) {
    console.log("🌗 Mudança de tema detectada via Android:", isDark ? "Escuro" : "Claro");
    if (isDark) {
        document.body.classList.add('dark-theme');
        document.body.classList.remove('light-theme');
    } else {
        document.body.classList.add('light-theme');
        document.body.classList.remove('dark-theme');
    }
};
