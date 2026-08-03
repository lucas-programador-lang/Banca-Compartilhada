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
  databaseURL: "https://banca-compartilhada-default-rtdb.firebaseio.com", // Adicione o link do seu Realtime Database aqui se necessário
  projectId: "banca-compartilhada",
  storageBucket: "banca-compartilhada.firebasestorage.app",
  messagingSenderId: "395304529051",
  appId: "1:395304529051:web:7e81033404097b164fea3e"
};

// Inicializar Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);

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
            window.location.href = 'index.html';
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
            window.location.href = 'index.html';
        } catch (error) {
            alert('❌ E-mail ou senha inválidos: ' + error.message);
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
