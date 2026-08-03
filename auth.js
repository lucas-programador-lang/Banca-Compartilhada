import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
    getAuth, 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

// Configuração oficial do projeto Banca Compartilhada
const firebaseConfig = {
  apiKey: "AIzaSyCvzby1p6_CU0yAASmlrbSyhj6yoyJ9qBQ",
  authDomain: "banca-compartilhada.firebaseapp.com",
  databaseURL: "https://banca-compartilhada-default-rtdb.firebaseio.com",
  projectId: "banca-compartilhada",
  storageBucket: "banca-compartilhada.firebasestorage.app",
  messagingSenderId: "395304529051",
  appId: "1:395304529051:web:7e81033404097b164fea3e"
};

// Inicializar Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);

// Função global de Toast para mensagens bonitas
function mostrarToast(mensagem, tipo = 'success') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast ${tipo}`;
    toast.innerHTML = `<span>${mensagem}</span>`;

    container.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 3000);
}

// Lógica de Cadastro (register.html)
const registerForm = document.getElementById('registerForm');
if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('emailReg').value;
        const senha = document.getElementById('senhaReg').value;

        try {
            await createUserWithEmailAndPassword(auth, email, senha);
            mostrarToast('🎉 Conta criada com sucesso!', 'success');
            setTimeout(() => {
                window.location.href = 'index.html';
            }, 1500); // Aguarda 1.5s para o usuário ver o toast antes de mudar de página
        } catch (error) {
            mostrarToast('❌ Erro: ' + error.message, 'error');
        }
    });
}

// Lógica de Login (login.html)
const loginForm = document.getElementById('loginForm');
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('email').value;
        const senha = document.getElementById('senha').value;

        try {
            await signInWithEmailAndPassword(auth, email, senha);
            mostrarToast('✅ Login efetuado com sucesso!', 'success');
            setTimeout(() => {
                window.location.href = 'index.html';
            }, 1000);
        } catch (error) {
            mostrarToast('❌ E-mail ou senha inválidos.', 'error');
        }
    });
}

// Proteção da Página (index.html)
if (window.location.pathname.includes('index.html') || window.location.pathname.endsWith('/')) {
    onAuthStateChanged(auth, (user) => {
        if (user) {
            document.body.classList.remove('protected-page');
        } else {
            window.location.href = 'login.html';
        }
    });
}
