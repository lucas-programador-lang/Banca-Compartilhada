// Importações dos módulos do Firebase (v10 via CDN)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
    getAuth, 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword, 
    onAuthStateChanged, 
    signOut 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// TODO: Substitua com as credenciais do seu projeto Firebase
const firebaseConfig = {
  apiKey: "AIzaSyCvzby1p6_CU0yAASmlrbSyhj6yoyJ9qBQ",
  authDomain: "banca-compartilhada.firebaseapp.com",
  projectId: "banca-compartilhada",
  storageBucket: "banca-compartilhada.firebasestorage.app",
  messagingSenderId: "395304529051",
  appId: "1:395304529051:web:7e81033404097b164fea3e"
};

// Inicializar o Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Lógica de Cadastro (register.html)
const registerForm = document.getElementById('registerForm');
if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('emailReg').value;
        const senha = document.getElementById('senhaReg').value;

        try {
            await createUserWithEmailAndPassword(auth, email, senha);
            alert('🎉 Conta criada com sucesso!');
            window.location.href = 'index.html'; // Vai direto para o painel
        } catch (error) {
            alert('❌ Erro no cadastro: ' + error.message);
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
            alert('✅ Login efetuado com sucesso!');
            window.location.href = 'index.html';
        } catch (error) {
            alert('❌ E-mail ou senha inválidos: ' + error.message);
        }
    });
}

// Proteção da Página (index.html) - Redireciona para login se não estiver autenticado
if (window.location.pathname.includes('index.html') || window.location.pathname.endsWith('/')) {
    onAuthStateChanged(auth, (user) => {
        if (!user) {
            // Se não estiver logado, manda para o login
            window.location.href = 'login.html';
        }
    });
}
