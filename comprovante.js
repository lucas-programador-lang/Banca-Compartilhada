/* ==========================================================================
   Comprovante de saque — aparece quando o saque é PAGO e só fecha depois que
   o bot do Telegram confirmar a postagem no grupo.
   --------------------------------------------------------------------------
   Como funciona agora:
   1) o usuário salva a imagem do comprovante e posta no grupo do Telegram,
      escrevendo o código (BC-XXXXXXXX) na LEGENDA da imagem;
   2) o bot lê a mensagem, acha o saque pelo código e grava
      comprovantePostadoEm no Firebase (o listener abaixo fecha esta tela);
   3) o botão "Verificar comprovante" NÃO libera nada sozinho: ele só pede
      ao worker para conferir se o bot já registrou a postagem.
   Quem obriga de verdade é o worker: enquanto o comprovante do último saque
   pago não for verificado pelo bot, ele recusa um novo pedido de saque.
   ========================================================================== */
import { auth, db, mostrarToast } from './auth.js';
import { ref, onValue, get } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

const WORKER_BASE_URL = 'https://apidabancacompartilhada.lucas-dev-programador.workers.dev';
const LINK_TELEGRAM = 'https://t.me/bancacompartilhadajazzz';
const NOME_MARCA = 'BANCA COMPARTILHADA';

const formatadorMoeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brl = (v) => formatadorMoeda.format(Number(v) || 0);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- formatação dos dados do comprovante ---------- */
function dataHoraBR(iso) {
    const t = Date.parse(iso);
    const d = new Date(Number.isNaN(t) ? Date.now() : t);
    const p = Object.fromEntries(new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(d).map((x) => [x.type, x.value]));
    return `${p.day}/${p.month}/${p.year} às ${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
}

function primeiroNome(nome) {
    const n = String(nome || '').trim().split(/\s+/)[0] || 'Cliente';
    return n.charAt(0).toUpperCase() + n.slice(1).toLowerCase();
}

function mascararChave(chave) {
    const c = String(chave || '').replace(/\s/g, '');
    if (!c) return '—';
    if (c.includes('@')) {
        const [local, dominio] = c.split('@');
        return `${local.slice(0, 2)}••••@${dominio}`;
    }
    if (c.length <= 5) return `${c.slice(0, 1)}••••`;
    return `${c.slice(0, 2)}••••${c.slice(-3)}`;
}

const codigoComprovante = (saqueId) => 'BC-' + String(saqueId).slice(-8).toUpperCase();

function montarDados(saqueId, saque, nomeUsuario) {
    return {
        saqueId,
        codigo: codigoComprovante(saqueId),
        valor: brl(saque.valorLiquido ?? saque.valorSolicitado),
        quando: dataHoraBR(saque.dataPagamento),
        beneficiario: primeiroNome(nomeUsuario),
        chave: mascararChave(saque.chavePix),
        tipoChave: String(saque.tipoPix || 'Pix'),
    };
}

/* ---------- ícones (mesmos traçados no HTML e no desenho da imagem) ---------- */
const ICONES = {
    pessoa: ['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2', 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0z'],
    agenda: ['M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M16 2v4', 'M8 2v4', 'M3 10h18'],
    ok: ['M20 6L9 17l-5-5'],
    pix: ['M12 3l9 9-9 9-9-9z', 'M12 8l4 4-4 4-4-4z'],
    codigo: ['M4 9h16', 'M4 15h16', 'M10 3L8 21', 'M16 3l-2 18'],
};
const svgIcone = (nome) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[nome].map((d) => `<path d="${d}"/>`).join('')}</svg>`;

function linhasDoComprovante(d) {
    return [
        ['pessoa', 'Beneficiário', d.beneficiario],
        ['agenda', 'Data e hora', d.quando],
        ['ok', 'Status', 'Concluído'],
        ['pix', `Chave Pix (parcial)`, d.chave],
        ['codigo', 'Código do comprovante', d.codigo],
    ];
}

/* ==========================================================================
   Imagem do comprovante (para postar no Telegram) — desenhada em canvas
   ========================================================================== */
function carregarImagem(src) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
    });
}

function retanguloArredondado(x, c, y, w, h, r) {
    x.beginPath();
    x.moveTo(c + r, y);
    x.arcTo(c + w, y, c + w, y + h, r);
    x.arcTo(c + w, y + h, c, y + h, r);
    x.arcTo(c, y + h, c, y, r);
    x.arcTo(c, y, c + w, y, r);
    x.closePath();
}

async function gerarImagem(d) {
    const W = 900, H = 1650;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const x = canvas.getContext('2d');
    const FONTE = 'Inter, "Segoe UI", system-ui, sans-serif';
    try { await Promise.all([document.fonts.load('800 80px Inter'), document.fonts.load('600 30px Inter')]); } catch (e) { /* usa a fonte do sistema */ }
    const logo = await carregarImagem('logo.png');
    const espaco = (px) => { if ('letterSpacing' in x) x.letterSpacing = px + 'px'; };

    // fundo e cantos
    x.save();
    retanguloArredondado(x, 0, 0, W, H, 64);
    x.clip();
    const fundo = x.createLinearGradient(0, 0, W * 0.6, H);
    fundo.addColorStop(0, '#2c1a0a'); fundo.addColorStop(0.5, '#150d06'); fundo.addColorStop(1, '#090603');
    x.fillStyle = fundo; x.fillRect(0, 0, W, H);
    // raios de luz saindo do selo
    for (let i = 0; i < 30; i++) {
        x.save(); x.translate(W / 2, 330); x.rotate((i * 12 * Math.PI) / 180);
        const g = x.createLinearGradient(0, 0, 0, 1500);
        g.addColorStop(0, 'rgba(255,205,110,0.07)'); g.addColorStop(1, 'rgba(255,205,110,0)');
        x.fillStyle = g; x.beginPath(); x.moveTo(0, 0); x.lineTo(-95, 1500); x.lineTo(95, 1500); x.closePath(); x.fill();
        x.restore();
    }
    x.restore();
    retanguloArredondado(x, 2, 2, W - 4, H - 4, 62);
    x.strokeStyle = 'rgba(242,206,151,0.35)'; x.lineWidth = 4; x.stroke();

    // topo: logo + marca + tipo
    if (logo) { x.save(); x.beginPath(); x.arc(100, 96, 40, 0, Math.PI * 2); x.clip(); x.drawImage(logo, 60, 56, 80, 80); x.restore(); }
    x.textBaseline = 'middle'; x.textAlign = 'left';
    x.fillStyle = '#fff4dc'; x.font = `800 30px ${FONTE}`; espaco(5);
    x.fillText(NOME_MARCA, 160, 96);
    x.textAlign = 'center'; x.fillStyle = '#c9a56e'; x.font = `700 24px ${FONTE}`; espaco(4);
    x.fillText('COMPROVANTE DE SAQUE', W / 2, 190);
    espaco(0);

    // selo de check
    const cx = W / 2, cy = 340;
    x.beginPath(); x.arc(cx, cy, 112, 0, Math.PI * 2); x.fillStyle = 'rgba(0,0,0,0.5)'; x.fill();
    x.strokeStyle = 'rgba(242,206,151,0.55)'; x.lineWidth = 4; x.stroke();
    for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        x.beginPath(); x.arc(cx + Math.cos(a) * 98, cy + Math.sin(a) * 98, 6, 0, Math.PI * 2); x.fillStyle = '#ffe9b0'; x.fill();
    }
    const disco = x.createRadialGradient(cx - 22, cy - 26, 8, cx, cy, 78);
    disco.addColorStop(0, '#fff0c2'); disco.addColorStop(0.55, '#f2ce97'); disco.addColorStop(1, '#b9742e');
    x.beginPath(); x.arc(cx, cy, 78, 0, Math.PI * 2); x.fillStyle = disco; x.fill();
    x.strokeStyle = '#2a1706'; x.lineWidth = 13; x.lineCap = 'round'; x.lineJoin = 'round';
    x.beginPath(); x.moveTo(cx - 30, cy + 2); x.lineTo(cx - 9, cy + 24); x.lineTo(cx + 32, cy - 20); x.stroke();

    // "Saque concluído"
    retanguloArredondado(x, cx - 200, 500, 400, 66, 33);
    x.fillStyle = 'rgba(242,206,151,0.14)'; x.fill(); x.strokeStyle = 'rgba(242,206,151,0.55)'; x.lineWidth = 3; x.stroke();
    x.beginPath(); x.arc(cx - 140, 533, 9, 0, Math.PI * 2); x.fillStyle = '#f2ce97'; x.fill();
    x.fillStyle = '#ffe7b0'; x.font = `700 32px ${FONTE}`; x.textAlign = 'left'; x.fillText('Saque concluído', cx - 112, 535);

    // valor
    let tam = 150; x.textAlign = 'center'; x.font = `800 ${tam}px ${FONTE}`;
    while (x.measureText(d.valor).width > W - 140 && tam > 60) { tam -= 6; x.font = `800 ${tam}px ${FONTE}`; }
    const gv = x.createLinearGradient(0, 610, 0, 760);
    gv.addColorStop(0, '#fff6dc'); gv.addColorStop(0.5, '#f2ce97'); gv.addColorStop(1, '#c48849');
    x.fillStyle = gv; x.fillText(d.valor, cx, 690);

    // "Pago via Pix em ..."
    x.font = `500 32px ${FONTE}`; const p1 = 'Pago via Pix em ';
    x.font = `700 32px ${FONTE}`; const wData = x.measureText(d.quando).width;
    x.font = `500 32px ${FONTE}`; const wP1 = x.measureText(p1).width;
    const ini = cx - (wP1 + wData) / 2;
    x.textAlign = 'left'; x.fillStyle = '#d9c7a3'; x.fillText(p1, ini, 782);
    x.font = `700 32px ${FONTE}`; x.fillStyle = '#fff4dc'; x.fillText(d.quando, ini + wP1, 782);

    // linha tracejada com entalhes
    x.setLineDash([14, 12]); x.strokeStyle = 'rgba(242,206,151,0.4)'; x.lineWidth = 3;
    x.beginPath(); x.moveTo(70, 860); x.lineTo(W - 70, 860); x.stroke(); x.setLineDash([]);
    x.fillStyle = '#080503';
    x.beginPath(); x.arc(0, 860, 30, 0, Math.PI * 2); x.fill();
    x.beginPath(); x.arc(W, 860, 30, 0, Math.PI * 2); x.fill();

    // dados do saque
    x.textAlign = 'left'; x.fillStyle = '#f2ce97'; x.font = `800 26px ${FONTE}`; espaco(5);
    x.fillText('DADOS DO SAQUE', 56, 930); espaco(0);
    const linhas = linhasDoComprovante(d);
    const alturaLinha = 118, topo = 970;
    retanguloArredondado(x, 40, topo, W - 80, alturaLinha * linhas.length, 34);
    x.fillStyle = 'rgba(0,0,0,0.38)'; x.fill(); x.strokeStyle = 'rgba(242,206,151,0.3)'; x.lineWidth = 3; x.stroke();
    linhas.forEach(([icone, rotulo, valor], i) => {
        const y = topo + i * alturaLinha;
        if (i > 0) { x.strokeStyle = 'rgba(242,206,151,0.16)'; x.lineWidth = 2; x.beginPath(); x.moveTo(40, y); x.lineTo(W - 40, y); x.stroke(); }
        retanguloArredondado(x, 70, y + 22, 74, 74, 20);
        x.fillStyle = 'rgba(242,206,151,0.1)'; x.fill(); x.strokeStyle = 'rgba(242,206,151,0.5)'; x.lineWidth = 3; x.stroke();
        x.save(); x.translate(88, y + 40); x.scale(1.58, 1.58);
        x.strokeStyle = '#f2ce97'; x.lineWidth = 2; x.lineCap = 'round'; x.lineJoin = 'round';
        ICONES[icone].forEach((d2) => x.stroke(new Path2D(d2)));
        x.restore();
        x.fillStyle = '#a89068'; x.font = `600 27px ${FONTE}`; x.textAlign = 'left'; x.fillText(rotulo, 176, y + 40);
        x.fillStyle = '#fff4dc'; x.font = `700 40px ${FONTE}`; x.fillText(valor, 176, y + 82);
    });

    // rodapé
    x.textAlign = 'center'; x.fillStyle = '#8f7a55'; x.font = `500 24px ${FONTE}`;
    x.fillText('Postado no grupo oficial: t.me/bancacompartilhadajazzz', cx, topo + alturaLinha * linhas.length + 62);

    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}

/* ==========================================================================
   Salvar a imagem
   --------------------------------------------------------------------------
   Em navegador comum: baixa pelo link com "download".
   No app Android (WebView) o "download" de blob não faz nada. Por isso:
     1) se a ponte window.Android.salvarImagem existir, salva na galeria por ela;
     2) senão, mostra a imagem na própria tela para segurar o dedo e salvar
        (ou tirar print).
   ========================================================================== */
function blobParaDataURL(blob) {
    return new Promise((resolve, reject) => {
        const leitor = new FileReader();
        leitor.onload = () => resolve(String(leitor.result));
        leitor.onerror = () => reject(leitor.error || new Error('Falha ao ler a imagem.'));
        leitor.readAsDataURL(blob);
    });
}

function emWebView() {
    const ua = navigator.userAgent || '';
    if (window.Android) return true;
    if (/; wv\)|FBAN|FBAV|Instagram|Line\/|MicroMessenger|Telegram/i.test(ua)) return true;
    // iOS: WebView não traz "Safari" no user agent
    return /(iPhone|iPad|iPod)/i.test(ua) && /AppleWebKit/i.test(ua) && !/Safari/i.test(ua);
}

async function salvarPeloApp(blob, nomeArquivo) {
    try {
        if (!window.Android || typeof window.Android.salvarImagem !== 'function') return false;
        const url = await blobParaDataURL(blob);
        const base64 = url.slice(url.indexOf(',') + 1);
        const resultado = window.Android.salvarImagem(base64, nomeArquivo);
        return resultado === true || resultado === 'true';
    } catch (erro) {
        console.error('Erro ao salvar pela ponte do app:', erro);
        return false;
    }
}

async function mostrarPrevia(blob) {
    if (!overlay) return;
    const url = await blobParaDataURL(blob);
    const acao = overlay.querySelector('.cmp-acao');
    if (!acao) return;
    let caixa = overlay.querySelector('.cmp-previa');
    if (!caixa) {
        caixa = document.createElement('div');
        caixa.className = 'cmp-previa';
        caixa.style.cssText = 'margin-top:14px;text-align:center';
        acao.appendChild(caixa);
    }
    caixa.innerHTML = `<p class="cmp-dica">Segure o dedo sobre a imagem e escolha salvar, ou tire um print da tela.</p>
        <img src="${url}" alt="Comprovante de saque" style="width:100%;max-width:420px;border-radius:16px;display:block;margin:10px auto 0;-webkit-touch-callout:default;-webkit-user-select:auto;user-select:auto">`;
    caixa.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function baixarPeloNavegador(blob, nomeArquivo) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nomeArquivo;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/* ==========================================================================
   Tela (modal que só fecha depois da confirmação)
   ========================================================================== */
const estado = {
    uid: null, nome: '', saques: null, aberto: null /* saqueId exibido */, mexeu: false, enviando: false, parar: null, foco: null,
};
let overlay = null;

function htmlComprovante(d) {
    return `<article class="cmp-ticket" aria-label="Comprovante de saque">
        <header class="cmp-topo">
            <img class="cmp-logo" src="logo.png" alt="" width="40" height="40">
            <span class="cmp-marca">${esc(NOME_MARCA)}</span>
        </header>
        <p class="cmp-tipo">COMPROVANTE DE SAQUE</p>
        <div class="cmp-selo" aria-hidden="true"><span class="cmp-medalha">${svgIcone('ok')}</span></div>
        <p class="cmp-pill"><i></i>Saque concluído</p>
        <p class="cmp-valor">${esc(d.valor)}</p>
        <p class="cmp-pago">Pago via Pix em <b>${esc(d.quando)}</b></p>
        <div class="cmp-corte" aria-hidden="true"></div>
        <h3 class="cmp-secao">DADOS DO SAQUE</h3>
        <ul class="cmp-dados">
            ${linhasDoComprovante(d).map(([icone, rotulo, valor]) => `<li>
                <span class="cmp-icone">${svgIcone(icone)}</span>
                <span class="cmp-texto"><small>${esc(rotulo)}</small><strong>${esc(valor)}</strong></span></li>`).join('')}
        </ul>
    </article>`;
}

function abrirModal(saqueId, saque) {
    fecharModal();
    const d = montarDados(saqueId, saque, estado.nome);
    estado.aberto = saqueId;
    estado.mexeu = false;
    estado.foco = document.activeElement;
    const podeCompartilhar = !!(navigator.canShare && navigator.share);

    overlay = document.createElement('div');
    overlay.className = 'cmp-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'cmpTitulo');
    overlay.innerHTML = `<div class="cmp-wrap">
        ${htmlComprovante(d)}
        <section class="cmp-acao">
            <h2 id="cmpTitulo" class="cmp-titulo">Poste o comprovante no Telegram</h2>
            <p class="cmp-texto-ajuda">Para <strong>liberar novos saques</strong>, envie a imagem deste comprovante no nosso grupo oficial e escreva o código <strong class="cmp-codigo">${esc(d.codigo)}</strong> na <strong>legenda</strong> da imagem (o texto que vai junto com a foto). Um bot confere a mensagem e libera automaticamente.</p>
            <ol class="cmp-passos">
                <li><span>1</span>Salve a imagem do comprovante${podeCompartilhar ? ' ou compartilhe direto' : ''}.</li>
                <li><span>2</span>Abra o grupo do Telegram, anexe a imagem e escreva o código na legenda antes de enviar.</li>
                <li><span>3</span>Aguarde alguns segundos: a liberação é automática. Se demorar, toque em verificar.</li>
            </ol>
            <button type="button" class="cmp-btn cmp-btn--contorno" data-cmp="copiar">Copiar código ${esc(d.codigo)}</button>
            <button type="button" class="cmp-btn cmp-btn--ouro" data-cmp="salvar">Salvar imagem do comprovante</button>
            ${podeCompartilhar ? '<button type="button" class="cmp-btn cmp-btn--contorno" data-cmp="compartilhar">Compartilhar imagem</button>' : ''}
            <a class="cmp-btn cmp-btn--contorno" data-cmp="grupo" href="${LINK_TELEGRAM}" target="_blank" rel="noopener noreferrer">Abrir grupo no Telegram</a>
            <button type="button" class="cmp-btn cmp-btn--confirma" data-cmp="confirmar" disabled>Verificar comprovante</button>
            <p class="cmp-dica" data-cmp="dica">O botão acima libera depois que você salvar a imagem ou abrir o grupo.</p>
        </section>
    </div>`;

    overlay.addEventListener('click', aoClicar);
    document.body.appendChild(overlay);
    document.body.classList.add('cmp-aberto');
    overlay.querySelector('[data-cmp="salvar"]').focus({ preventScroll: true });
}

function fecharModal() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    estado.aberto = null;
    document.body.classList.remove('cmp-aberto');
    if (estado.foco && typeof estado.foco.focus === 'function') estado.foco.focus();
}

function liberarConfirmacao() {
    estado.mexeu = true;
    if (!overlay) return;
    const botao = overlay.querySelector('[data-cmp="confirmar"]');
    if (botao && !estado.enviando) botao.disabled = false;
    const dica = overlay.querySelector('[data-cmp="dica"]');
    if (dica) dica.textContent = 'Depois de postar no grupo com o código na legenda, a liberação é automática. Se não fechar, toque em "Verificar comprovante".';
}

async function dadosAtuais() {
    const saque = (estado.saques || {})[estado.aberto];
    return saque ? montarDados(estado.aberto, saque, estado.nome) : null;
}

async function aoClicar(e) {
    const el = e.target.closest('[data-cmp]');
    if (!el) return;
    const acao = el.dataset.cmp;

    if (acao === 'grupo') { liberarConfirmacao(); return; }   // o link abre sozinho

    if (acao === 'copiar') {
        const d = await dadosAtuais();
        if (!d) return;
        try {
            await navigator.clipboard.writeText(d.codigo);
            mostrarToast('Código copiado. Cole na legenda da imagem.', 'success');
        } catch (erro) {
            mostrarToast(`Anote o código ${d.codigo} e escreva na legenda da imagem.`, 'warning');
        }
        return;
    }

    if (acao === 'salvar' || acao === 'compartilhar') {
        const d = await dadosAtuais();
        if (!d) return;
        el.disabled = true;
        try {
            const blob = await gerarImagem(d);
            if (!blob) throw new Error('Não foi possível gerar a imagem.');
            const arquivo = new File([blob], `comprovante-${d.codigo}.png`, { type: 'image/png' });

            if (acao === 'compartilhar') {
                try {
                    await navigator.share({ files: [arquivo], title: 'Comprovante de saque', text: `Comprovante ${d.codigo}` });
                    liberarConfirmacao();
                } catch (erro) {
                    if (erro && erro.name !== 'AbortError') {
                        mostrarToast('Não foi possível compartilhar. Use "Salvar imagem".', 'warning');
                        await mostrarPrevia(blob);
                    }
                }
            } else if (await salvarPeloApp(blob, arquivo.name)) {
                mostrarToast('Imagem salva na galeria. Envie no grupo com o código na legenda.', 'success');
                liberarConfirmacao();
            } else if (emWebView()) {
                // WebView / navegador embutido: o download não funciona, mostra a imagem na tela
                await mostrarPrevia(blob);
                mostrarToast('Segure o dedo sobre a imagem para salvar, ou tire um print.', 'warning');
                liberarConfirmacao();
            } else {
                baixarPeloNavegador(blob, arquivo.name);
                mostrarToast('Imagem salva. Envie no grupo com o código na legenda.', 'success');
                liberarConfirmacao();
            }
        } catch (erro) {
            console.error('Erro ao gerar a imagem do comprovante:', erro);
            mostrarToast('Não foi possível gerar a imagem. Tire um print da tela e envie no grupo.', 'warning');
            liberarConfirmacao();   // o print da tela vale: não trava o usuário por falha técnica
        } finally {
            el.disabled = false;
        }
        return;
    }

    if (acao === 'confirmar') await confirmar(el);
}

async function confirmar(botao) {
    if (estado.enviando || !estado.mexeu || !estado.aberto) return;
    estado.enviando = true;
    const textoOriginal = botao.textContent;
    botao.disabled = true; botao.textContent = 'Verificando...';
    try {
        const usuario = auth.currentUser;
        if (!usuario) throw new Error('Você precisa estar logado.');
        const token = await usuario.getIdToken();
        const resposta = await fetch(`${WORKER_BASE_URL}/api/saque/comprovante`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ saqueId: estado.aberto }),
        });
        const dados = await resposta.json().catch(() => ({}));
        if (resposta.status === 409) {
            // o bot ainda não viu a postagem: não libera nada
            mostrarToast(dados.error || 'Ainda não encontramos seu comprovante no grupo. Confira se a imagem foi enviada com o código na legenda.', 'warning');
            botao.disabled = false; botao.textContent = textoOriginal;
            return;
        }
        if (!resposta.ok) throw new Error(dados.error || 'Erro ao verificar o comprovante.');
        mostrarToast('Comprovante verificado! Novos saques liberados.', 'success');
        // o listener do Firebase recebe a verificação e fecha; fecha já para não depender da rede
        const saqueConfirmado = estado.aberto;
        if (estado.saques && estado.saques[saqueConfirmado]) estado.saques[saqueConfirmado].comprovantePostadoEm = new Date().toISOString();
        avaliar();
    } catch (erro) {
        mostrarToast(erro.message, 'error');
        botao.disabled = false; botao.textContent = textoOriginal;
    } finally {
        estado.enviando = false;
    }
}

/* ---------- quando mostrar ---------- */
function pendentes() {
    return Object.entries(estado.saques || {})
        .filter(([, s]) => s && s.status === 'pago' && s.comprovanteObrigatorio === true && !s.comprovantePostadoEm)
        .sort((a, b) => String(a[1].dataPagamento || '').localeCompare(String(b[1].dataPagamento || '')));
}

function avaliar() {
    const lista = pendentes();
    if (!lista.length) { fecharModal(); return; }
    const [id, saque] = lista[0];
    if (estado.aberto !== id) abrirModal(id, saque);
}

/* ---------- inicialização ---------- */
function iniciar() {
    // não deixa ESC fechar: só a confirmação fecha
    document.addEventListener('keydown', (e) => {
        if (!overlay) return;
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); }
        if (e.key === 'Tab') {   // mantém o foco dentro da tela
            const itens = [...overlay.querySelectorAll('button:not([disabled]), a[href]')];
            if (!itens.length) return;
            const primeiro = itens[0], ultimo = itens[itens.length - 1];
            if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo.focus(); }
            else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus(); }
        }
    }, true);

    auth.onAuthStateChanged(async (usuario) => {
        if (estado.parar) { estado.parar(); estado.parar = null; }
        fecharModal();
        estado.saques = null; estado.uid = null;
        if (!usuario) return;
        estado.uid = usuario.uid;
        try {
            const nome = await get(ref(db, `usuarios/${usuario.uid}/nome`));
            estado.nome = nome.val() || '';
        } catch (erro) { estado.nome = ''; }
        estado.parar = onValue(ref(db, `saques/${usuario.uid}`), (snap) => {
            estado.saques = snap.val() || {};
            avaliar();
        }, (erro) => console.error('Erro ao acompanhar os saques:', erro));
    });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
else iniciar();
