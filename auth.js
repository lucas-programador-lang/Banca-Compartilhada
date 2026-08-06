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
import { getDatabase, ref, set, get } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

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

/* ==========================================================================
   Firebase App Check (reCAPTCHA v3)
   ==========================================================================
   Protege as chamadas de Auth e Realtime Database contra bots/abuso.
   A verificação acontece do lado do Firebase — não precisa de backend
   próprio para validar o token.

   1. Vá em Firebase Console > App Check > Apps > (seu app web)
      > Registrar provedor > reCAPTCHA v3 > cole a "Site Key" abaixo.
   2. Depois de registrar, vá em App Check > APIs e ative "Enforce"
      para Authentication e Realtime Database (senão o App Check fica
      só monitorando, sem bloquear nada).
   3. Para testar em localhost, o Firebase gera um "debug token" no
      console do navegador (F12) na primeira execução — copie e
      cadastre em App Check > Apps > Gerenciar tokens de depuração.
      NÃO deixe debug token ativo em produção.
   ========================================================================== */
const RECAPTCHA_SITE_KEY = "6Lfs-3gtAAAAACZId43LTsWWSDroAMI7uXED4KU9";

// Descomente a linha abaixo apenas durante testes em localhost, para
// gerar um debug token automaticamente no console (F12). Remova antes
// de publicar em produção.
// self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;

initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(RECAPTCHA_SITE_KEY),
    isTokenAutoRefreshEnabled: true
});

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

    const mensagensReset = {
        'auth/invalid-email': 'Informe um e-mail válido.',
        'auth/user-not-found': 'Não encontramos uma conta com este e-mail.',
        'auth/too-many-requests': 'Muitas tentativas. Aguarde um momento e tente novamente.',
    };

    const dicionarios = { cadastro: mensagensCadastro, login: mensagensLogin, reset: mensagensReset };
    const dicionario = dicionarios[contexto] || mensagensLogin;
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
   Mensagens de validação nativa personalizadas
   ==========================================================================
   Usa o próprio balão de validação do navegador (o mesmo estilo de
   "Preencha este campo."), mas com o texto trocado para indicar
   exatamente qual campo falta preencher.
   ========================================================================== */
function aplicarMensagensValidacao(form, camposMensagens) {
    if (!form) return;

    Object.entries(camposMensagens).forEach(([idCampo, mensagens]) => {
        const input = getEl(idCampo);
        if (!input) return;

        input.addEventListener('invalid', () => {
            if (input.validity.valueMissing) {
                input.setCustomValidity(mensagens.vazio || 'Preencha este campo.');
            } else if (input.validity.typeMismatch) {
                input.setCustomValidity(mensagens.invalido || 'Valor inválido.');
            } else if (input.validity.tooShort) {
                input.setCustomValidity(mensagens.curto || 'Valor muito curto.');
            } else {
                input.setCustomValidity('');
            }
        });

        // Limpa a mensagem customizada assim que o usuário começa a corrigir o campo
        input.addEventListener('input', () => input.setCustomValidity(''));
    });
}

/* ==========================================================================
   Alternar visibilidade da senha (login.html e register.html)
   ========================================================================== */
document.querySelectorAll('.toggle-senha').forEach((botao) => {
    botao.addEventListener('click', () => {
        const campo = getEl(botao.dataset.alvo);
        if (!campo) return;

        const oculto = campo.type === 'password';
        campo.type = oculto ? 'text' : 'password';
        botao.setAttribute('aria-label', oculto ? 'Ocultar senha' : 'Mostrar senha');
        botao.classList.toggle('ativo', oculto);
    });
});

/* ==========================================================================
   Indicação (register.html)
   ==========================================================================
   Cada usuário ganha um código curto ALEATÓRIO (6 caracteres
   alfanuméricos, ex: "a1b2c3" — sem nenhuma relação com nome ou
   sobrenome), salvo em codigosIndicacao/{codigo} -> uid. O link de
   indicação vira "register.html?ref=a1b2c3" e, ao cadastrar, resolvemos
   esse código de volta para o UID real de quem indicou.

   Observação: contas criadas ANTES dessa mudança já têm um código
   salvo em outro formato (numérico ou baseado no nome). Esses códigos
   antigos continuam funcionando normalmente pois a resolução abaixo
   só faz um lookup em codigosIndicacao/{codigo} — não importa qual
   formato o código tem.
   ========================================================================== */

/**
 * Gera um código curto aleatório alfanumérico (padrão: 6 caracteres,
 * ex: "a1b2c3") para uso como código de indicação.
 */
function gerarCodigoAleatorioCurto(tamanho = 6) {
    const caracteres = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let codigo = '';
    for (let i = 0; i < tamanho; i++) {
        codigo += caracteres.charAt(Math.floor(Math.random() * caracteres.length));
    }
    return codigo;
}

/**
 * Gera um código de indicação único e aleatório, testando até achar
 * um que ainda não exista em codigosIndicacao/.
 */
async function gerarCodigoIndicacaoUnico() {
    for (let i = 0; i < 25; i++) {
        const tentativa = gerarCodigoAleatorioCurto(6);
        const snap = await get(ref(db, 'codigosIndicacao/' + tentativa));
        if (!snap.exists()) return tentativa;
    }

    // Fallback extremamente improvável: se 25 tentativas colidirem,
    // usa um código maior (aleatório + timestamp) para garantir unicidade.
    return `${gerarCodigoAleatorioCurto(4)}${Date.now().toString(36).slice(-4)}`;
}

/**
 * Captura o código de indicação (?ref=codigo) da URL do link que a
 * pessoa recebeu de quem a indicou e guarda no campo oculto do
 * formulário de cadastro.
 */
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
            // 1. Cria a conta no Firebase Auth
            const userCredential = await createUserWithEmailAndPassword(auth, email, senha);
            const user = userCredential.user;

            // 2. Resolve o código de indicação digitado (ex.: "a1b2c3")
            //    para o UID de quem indicou, consultando codigosIndicacao/.
            //    Se o código não existir (link inválido/expirado), o
            //    cadastro segue normalmente sem indicador.
            let uidIndicador = null;
            if (codigoIndicadorDigitado) {
                const indicadorSnap = await get(ref(db, 'codigosIndicacao/' + codigoIndicadorDigitado));
                uidIndicador = indicadorSnap.exists() ? indicadorSnap.val() : null;
            }

            // 3. Gera o código de indicação único e aleatório deste novo
            //    usuário, para que ele também possa indicar outras
            //    pessoas depois.
            const meuCodigoIndicacao = await gerarCodigoIndicacaoUnico();

            // 4. Grava o perfil do usuário e o mapeamento código -> uid
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

            // 5. Se esta conta foi indicada por alguém, grava também uma
            //    entrada em equipe/{uidIndicador}/{meuUid} com os dados
            //    básicos exibidos na tabela "Membros da Rede". Essa lista
            //    invertida existe porque o indicador não tem permissão
            //    para ler a coleção usuarios/ inteira (só o próprio nó
            //    dele) — sem ela, a query orderByChild('indicadoPor')
            //    seria barrada pelas regras do Realtime Database.
            if (uidIndicador) {
                await set(ref(db, `equipe/${uidIndicador}/${user.uid}`), {
                    nome: nome,
                    email: email,
                    dataCadastro: new Date().toISOString()
                });
            }

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
    aplicarMensagensValidacao(loginForm, {
        email: { vazio: 'Preencha seu e-mail.', invalido: 'Informe um e-mail válido.' },
        senha: { vazio: 'Preencha sua senha.' },
    });

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
   Recuperação de senha (login.html)
   ========================================================================== */
const linkEsqueciSenha = getEl('esqueciSenha');
if (linkEsqueciSenha) {
    linkEsqueciSenha.addEventListener('click', async (e) => {
        e.preventDefault();

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
