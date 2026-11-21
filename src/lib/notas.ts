// I-26: quais notas da partitura estão soando. O gerador (`tools/gerar-partituras.py`) grava em cada nota e pausa do SVG o instante em que
// soa DENTRO do compasso, em batidas (semínimas): `data-t` é o começo e `data-f` o fim. Somado ao início do compasso que toca (a lista
// `compassos` do hinário, a mesma do destaque do compasso), dá o instante na régua de `reproducao.ponto()`.
//
// Quem não tem esses atributos (uma partitura do pacote antigo) simplesmente não tem notas indexadas, e o app fica só com o compasso.
import type { Compassos, InicioDeCompasso } from "./biblioteca.svelte";
import { listaDoPonto, posicaoEm, type PontoDeCompasso } from "./compassos";

const EPS = 1e-6;
/** Quantos compassos para trás se olha: uma nota ligada pode atravessar a barra (o fim passa do compasso) e continuar acesa no seguinte. */
const COMPASSOS_PARA_TRAS = 4;

export type TempoDaNota = { t: number; f: number };
/** Uma nota, pausa ou ligadura (`ligadura: true`: a curva `g.tie` (de prolongamento) ou `g.slur` (de expressão), por onde a luz corre do halo da primeira nota até a última). */
export type NotaDoDesenho<E> = TempoDaNota & { el: E; ligadura?: boolean };

/** Os dois atributos de uma nota, ou `null` se faltam ou não valem (não número, negativo, fim que não vem depois do começo). */
export function lerTempo(t: string | null, f: string | null): TempoDaNota | null {
  if (t === null || f === null) return null;
  const inicio = Number.parseFloat(t);
  const fim = Number.parseFloat(f);
  if (!Number.isFinite(inicio) || !Number.isFinite(fim) || inicio < 0 || fim <= inicio) return null;
  return { t: inicio, f: fim };
}

type ComAtributos = { getAttribute(nome: string): string | null };
type Medida<E extends ComAtributos> = { querySelectorAll(seletor: string): ArrayLike<E> };

/** Para cada compasso escrito (a ordem dos `g.measure` do SVG), as notas e pausas com tempo. Um compasso sem nada fica com lista vazia. */
export function indexarNotas<E extends ComAtributos>(medidas: ArrayLike<Medida<E>>): NotaDoDesenho<E>[][] {
  const saida: NotaDoDesenho<E>[][] = [];
  for (let i = 0; i < medidas.length; i++) {
    const lista: NotaDoDesenho<E>[] = [];
    for (const el of Array.from(medidas[i].querySelectorAll("g.note[data-t], g.rest[data-t], g.tie[data-t], g.slur[data-t]"))) {
      const tempo = lerTempo(el.getAttribute("data-t"), el.getAttribute("data-f"));
      if (!tempo) continue;
      const classes = (el.getAttribute("class") ?? "").split(/\s+/);
      const ligadura = classes.includes("tie") || classes.includes("slur");
      lista.push(ligadura ? { ...tempo, el, ligadura } : { ...tempo, el });
    }
    saida.push(lista);
  }
  return saida;
}

/** Se alguma nota foi indexada (senão a partitura não traz o tempo das notas). Só curvas de ligadura não bastam. */
export function temNotas(porCompasso: readonly (readonly { ligadura?: boolean }[])[]): boolean {
  return porCompasso.some((c) => c.some((n) => !n.ligadura));
}

/** Quanto da curva já foi percorrido (0 a 1) no instante `local` (em batidas, dentro do compasso onde a nota está). */
export function progressoDaCurva(n: TempoDaNota, local: number): number {
  const p = (local - n.t) / (n.f - n.t);
  return Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0;
}

/**
 * As notas e pausas que soam em `batida`, dado o compasso em cada item de `lista` e as notas de cada compasso escrito. Olha o compasso que
 * toca e alguns antes dele, se forem os anteriores no papel (a nota ligada que atravessa a barra). A ordem é a do tempo (do compasso mais antigo ao que toca). Vazio antes do primeiro compasso, com a batida
 * inválida ou depois da última nota.
 */
export function notasEm<E>(lista: readonly InicioDeCompasso[], batida: number, porCompasso: readonly (readonly NotaDoDesenho<E>[])[]): NotaDoDesenho<E>[] {
  return acesasEm(lista, batida, porCompasso).map((a) => a.n);
}

/** Como `notasEm`, mas com o instante local (em batidas, dentro do compasso onde cada uma está): é o que mede o quanto de uma curva já foi percorrido. */
export type Acesa<E> = { n: NotaDoDesenho<E>; local: number };
export function acesasEm<E>(lista: readonly InicioDeCompasso[], batida: number, porCompasso: readonly (readonly NotaDoDesenho<E>[])[]): Acesa<E>[] {
  const atual = posicaoEm(lista, batida);
  if (atual === null) return [];
  const acesas: Acesa<E>[] = [];
  // Só olha para trás enquanto os compassos ESCRITOS forem consecutivos: a ligadura une um compasso ao que vem logo depois no papel, e depois de um salto
  // de repetição (7, 8 e volta ao 1) a nota ligada do 8 não continua no 1.
  let inicio = atual;
  while (inicio > 0 && atual - inicio < COMPASSOS_PARA_TRAS && lista[inicio - 1][1] === lista[inicio][1] - 1) inicio--;
  for (let j = inicio; j <= atual; j++) {
    const local = batida - lista[j][0];
    for (const n of porCompasso[lista[j][1]] ?? []) {
      if (n.t - EPS <= local && local < n.f - EPS && !acesas.some((a) => a.n === n)) acesas.push({ n, local });
    }
  }
  return acesas;
}

/** As notas que soam neste ponto da música (a lista certa: introdução, vez normal ou final), ou vazio se não há. */
export function notasDoPonto<E>(c: Compassos | null | undefined, p: PontoDeCompasso | null, porCompasso: readonly (readonly NotaDoDesenho<E>[])[]): NotaDoDesenho<E>[] {
  if (!c || !p) return [];
  const lista = listaDoPonto(c, p);
  return lista ? notasEm(lista, p.batida, porCompasso) : [];
}

/** Como `notasDoPonto`, com o instante local de cada uma. */
export function acesasDoPonto<E>(c: Compassos | null | undefined, p: PontoDeCompasso | null, porCompasso: readonly (readonly NotaDoDesenho<E>[])[]): Acesa<E>[] {
  if (!c || !p) return [];
  const lista = listaDoPonto(c, p);
  return lista ? acesasEm(lista, p.batida, porCompasso) : [];
}

/** Duas listas de notas são a mesma (os mesmos elementos, na mesma ordem)? Para só mexer no desenho quando o conjunto muda. */
export function mesmasNotas<E>(a: readonly NotaDoDesenho<E>[], b: readonly NotaDoDesenho<E>[]): boolean {
  return a.length === b.length && a.every((n, i) => n === b[i]);
}

/** A altura (y) de uma linha poligonal, ordenada por x crescente, na posição `x` (interpola entre os dois pontos vizinhos; fora dela vale a ponta mais próxima). Vazia: 0. */
export function alturaEm(pontos: readonly { x: number; y: number }[], x: number): number {
  if (pontos.length === 0) return 0;
  if (x <= pontos[0].x) return pontos[0].y;
  const ultimo = pontos[pontos.length - 1];
  if (x >= ultimo.x) return ultimo.y;
  let i = 1;
  while (pontos[i].x < x) i++;
  const a = pontos[i - 1];
  const b = pontos[i];
  return b.x === a.x ? b.y : a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
}
