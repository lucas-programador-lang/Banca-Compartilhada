/* ==========================================================================
   Término previsto de um plano
   Calcula a data em que o plano atinge o teto e finaliza, usando os dados do
   próprio plano (valor, % diário, teto e data de ativação). É a MESMA regra do
   rendimento no worker: um "dia" conta a cada 24h desde a ativação e só vale
   se cair de segunda a sexta no horário de Brasília.
   Por que calcular aqui e não ler o campo dataExpiracao: planos antigos não
   têm esse campo, e planos criados antes da correção do worker guardaram uma
   data errada (30 dias úteis fixos para os planos Banca).
   Devolve uma data ISO, ou null se o plano não tiver os dados necessários.
   ========================================================================== */
export function calcularTerminoPrevisto(plano) {
    const valor = parseFloat(plano && plano.valor) || 0;
    const percentualDiario = parseFloat(plano && plano.percentualDiario) || 0;
    const tetoPercentual = parseFloat(plano && plano.tetoPercentual) || 0;
    const inicio = Date.parse(plano && plano.dataAtivacao);
    if (!(valor > 0) || !(percentualDiario > 0) || !(tetoPercentual > 0) || Number.isNaN(inicio)) return null;

    const rendimentoDiario = valor * percentualDiario;
    const tetoValor = valor * tetoPercentual;
    const DIA_MS = 24 * 60 * 60 * 1000;
    const BRASILIA_MS = 3 * 60 * 60 * 1000;

    let diasContados = 0;
    let blocos = 0;
    while (blocos < 5000) {
        blocos++;
        const diaDaSemana = new Date(inicio + blocos * DIA_MS - BRASILIA_MS).getUTCDay();
        if (diaDaSemana >= 1 && diaDaSemana <= 5) diasContados++;
        if (rendimentoDiario * diasContados >= tetoValor) break;
    }
    return new Date(inicio + blocos * DIA_MS).toISOString();
}
