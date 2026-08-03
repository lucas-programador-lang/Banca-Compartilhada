import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
    getAuth,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

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
export const auth = getAuth(app);
export const db = getDatabase(app);

const REDIRECT_APOS_LOGIN_MS = 1000;
const REDIRECT_APOS_CADASTRO_MS = 1500;

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

/**
 * Exibe uma notificação temporária na tela.
 * @param {string} mensagem
 * @param {'success'|'error'|'warning'} tipo
 */
export function mostrarToast(mensagem, tipo = 'success') {
    const container = getToastContainer();

    const toast = document.createElement('div');
    toast.className = `toast ${tipo}`;

    const texto = document.createElement('span');
    texto.textContent = mensagem; // textContent evita injeção de HTML
    toast.appendChild(texto);

    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

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

/**
 * Traduz os códigos de erro do Firebase Auth para mensagens amigáveis em pt-BR.
 * Evita expor mensagens técnicas do Firebase diretamente ao usuário.
 */
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
        'auth/too-many-requests': 'Muitas tentativas. Aguarde um momento e tente novamente.',
    };

    const dicionario = contexto === 'cadastro' ? mensagensCadastro : mensagensLogin;
    return dicionario[codigo] || 'Ocorreu um erro. Tente novamente em instantes.';
}

function validarEmailSenha(email, senha) {
    if (!email || !senha) {
        return 'Preencha e-mail e senha.';
    }
    if (senha.length < 6) {
        return 'A senha deve ter no mínimo 6 caracteres.';
    }
    return null;
}

/* ==========================================================================
   Cadastro (register.html)
   ========================================================================== */
const registerForm = getEl('registerForm');
if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const email = getEl('emailReg').value.trim();
        const senha = getEl('senhaReg').value;
        const botao = registerForm.querySelector('button[type="submit"]') || registerForm.querySelector('button');

        const erroValidacao = validarEmailSenha(email, senha);
        if (erroValidacao) {
            mostrarToast(`⚠️ ${erroValidacao}`, 'warning');
            return;
        }

        setBotaoCarregando(botao, true, 'Criando conta...');
        try {
            await createUserWithEmailAndPassword(auth, email, senha);
            mostrarToast('🎉 Conta criada com sucesso!', 'success');
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
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();

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
   Proteção de páginas restritas
   ========================================================================== */
// Qualquer página com a classe "protected-page" no <body> exige autenticação,
// em vez de depender do nome/caminho do arquivo (mais confiável e reutilizável).
if (document.body.classList.contains('protected-page')) {
    onAuthStateChanged(auth, (user) => {
        if (user) {
            document.body.classList.remove('protected-page');
        } else {
            window.location.href = 'login.html';
        }
    });
}
