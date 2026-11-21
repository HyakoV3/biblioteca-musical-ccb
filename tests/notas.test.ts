import { describe, expect, it } from "vitest";
import { acesasEm, alturaEm, indexarNotas, lerTempo, mesmasNotas, notasDoPonto, notasEm, progressoDaCurva, temNotas, type NotaDoDesenho } from "../src/lib/notas";
import { posicaoEm } from "../src/lib/compassos";
import type { Compassos } from "../src/lib/biblioteca.svelte";

type El = { getAttribute(n: string): string | null; nome: string };
const el = (nome: string, t?: string, f?: string): El => ({
  nome,
  getAttribute: (n) => (n === "data-t" ? (t ?? null) : n === "data-f" ? (f ?? null) : null),
});
const medida = (...els: El[]) => ({ querySelectorAll: () => els });
const nota = (nome: string, t: number, f: number): NotaDoDesenho<string> => ({ el: nome, t, f });
const nomes = (l: NotaDoDesenho<string>[]) => l.map((n) => n.el);

describe("lerTempo", () => {
  it("lê os dois números", () => expect(lerTempo("1.5", "2")).toEqual({ t: 1.5, f: 2 }));
  it.each([
    [null, "1"],
    ["0", null],
    ["x", "1"],
    ["-1", "1"],
    ["2", "2"], // sem duração (enfeite): não conta
    ["2", "1"],
    ["Infinity", "5"],
  ])("recusa %s e %s", (t, f) => expect(lerTempo(t, f)).toBeNull());
});

describe("indexarNotas", () => {
  it("guarda por compasso só o que tem tempo válido", () => {
    const m = indexarNotas([medida(el("a", "0", "1"), el("sem"), el("ruim", "3", "2")), medida(), medida(el("b", "0.5", "2"))]);
    expect(m.map((c) => c.map((n) => n.el.nome))).toEqual([["a"], [], ["b"]]);
    expect(temNotas(m)).toBe(true);
    expect(temNotas(indexarNotas([medida(el("sem")), medida()]))).toBe(false);
  });
});

// Dois compassos de 4 batidas: no primeiro, notas em 0, 1 (até 2) e 2 (até 4, ligada e passando a barra até 5); no segundo, uma em 0 até 4.
const porCompasso = [[nota("do", 0, 1), nota("re", 1, 2), nota("mi-ligada", 2, 5)], [nota("fa", 0, 4)]];
const lista: [number, number][] = [[0, 0], [4, 1], [8, 0]]; // o compasso 0 volta no fim (repetição)

describe("notasEm", () => {
  it("acende a nota que soa e troca na hora em que a próxima começa", () => {
    expect(nomes(notasEm(lista, 0, porCompasso))).toEqual(["do"]);
    expect(nomes(notasEm(lista, 0.99, porCompasso))).toEqual(["do"]);
    expect(nomes(notasEm(lista, 1, porCompasso))).toEqual(["re"]);
    expect(nomes(notasEm(lista, 2.5, porCompasso))).toEqual(["mi-ligada"]);
  });
  it("acende todas as vozes que soam juntas", () => {
    const pc = [[nota("soprano", 0, 2), nota("tenor", 0, 1), nota("baixo", 1, 2)]];
    expect(nomes(notasEm([[0, 0]], 0.5, pc))).toEqual(["soprano", "tenor"]);
    expect(nomes(notasEm([[0, 0]], 1.5, pc))).toEqual(["soprano", "baixo"]);
  });
  it("a nota ligada que passa da barra continua acesa no compasso seguinte, e não mais que isso", () => {
    expect(nomes(notasEm(lista, 4, porCompasso))).toEqual(["mi-ligada", "fa"]);
    expect(nomes(notasEm(lista, 4.99, porCompasso))).toEqual(["mi-ligada", "fa"]);
    expect(nomes(notasEm(lista, 5, porCompasso))).toEqual(["fa"]);
  });
  it("depois de um salto de repetição a nota ligada do compasso de antes não fica acesa (os compassos escritos não são consecutivos)", () => {
    // o compasso 1 (índice 0) termina com a ligada "mi-ligada" (fim 5 > 4); a execução vai 1 (índice 0) → 2 (índice 1) → volta ao índice 0
    const salto: [number, number][] = [[0, 1], [4, 0]];
    expect(nomes(notasEm(salto, 4.5, porCompasso))).toEqual(["do"]);
    // sem salto (índices consecutivos), a ligada continua, como antes
    expect(nomes(notasEm([[0, 0], [4, 1]], 4.5, porCompasso))).toEqual(["mi-ligada", "fa"]);
  });
  it("na repetição o mesmo compasso acende de novo, com o início do item da vez", () => {
    expect(nomes(notasEm(lista, 9, porCompasso))).toEqual(["re"]);
  });
  it("depois da última nota nada acende (o compasso continua, a cargo do destaque do compasso)", () => {
    expect(notasEm(lista, 8 + 6, porCompasso)).toEqual([]);
    expect(notasEm(lista, 100, porCompasso)).toEqual([]);
  });
  it("antes do primeiro compasso, com batida inválida ou lista vazia: nada", () => {
    expect(notasEm([[1, 0]], 0.5, porCompasso)).toEqual([]);
    expect(notasEm(lista, Number.NaN, porCompasso)).toEqual([]);
    expect(notasEm([], 3, porCompasso)).toEqual([]);
  });
  it("índice de compasso fora do desenho não quebra", () => {
    expect(notasEm([[0, 9]], 1, porCompasso)).toEqual([]);
  });
  it("posicaoEm devolve a posição na lista (não o índice do compasso)", () => {
    expect(posicaoEm(lista, 9)).toBe(2);
    expect(posicaoEm(lista, 5)).toBe(1);
  });
});

describe("notasDoPonto", () => {
  const c: Compassos = { normal: [[0, 0]], introducao: [[0, 1]], final: [[0, 1]] } as Compassos;
  it("usa a lista da parte: introdução, vez normal e final (só na última vez)", () => {
    expect(nomes(notasDoPonto(c, { parte: "intro", batida: 1, final: false }, porCompasso))).toEqual(["fa"]);
    expect(nomes(notasDoPonto(c, { parte: 1, batida: 1, final: false }, porCompasso))).toEqual(["re"]);
    expect(nomes(notasDoPonto(c, { parte: 1, batida: 1, final: true }, porCompasso))).toEqual(["fa"]);
  });
  it("sem compassos ou sem ponto: nada", () => {
    expect(notasDoPonto(null, { parte: 1, batida: 0, final: false }, porCompasso)).toEqual([]);
    expect(notasDoPonto(c, null, porCompasso)).toEqual([]);
  });
});

describe("mesmasNotas", () => {
  it("compara os elementos, na ordem", () => {
    const [a, b] = [nota("a", 0, 1), nota("b", 0, 1)];
    expect(mesmasNotas([a, b], [a, b])).toBe(true);
    expect(mesmasNotas([a, b], [b, a])).toBe(false);
    expect(mesmasNotas([a], [a, b])).toBe(false);
    expect(mesmasNotas([], [])).toBe(true);
  });
});

describe("ligadura: a luz corre pela curva", () => {
  const curva = (t: string, f: string, classe = "tie") => ({ nome: "curva", getAttribute: (n: string) => (n === "data-t" ? t : n === "data-f" ? f : n === "class" ? classe : null) });

  it("a curva com tempo é indexada como ligadura, e a nota comum não leva a marca", () => {
    const m = indexarNotas([medida(el("a", "0", "2") as never, curva("0", "2") as never)]);
    expect(m[0].map((n) => n.ligadura ?? false)).toEqual([false, true]);
  });

  it("a ligadura de EXPRESSÃO (g.slur) também é indexada como curva, no seu tempo", () => {
    const m = indexarNotas([medida(el("a", "0", "2") as never, curva("0", "3", "slur") as never)]);
    expect(m[0].map((n) => n.ligadura ?? false)).toEqual([false, true]);
    expect(m[0][1]).toMatchObject({ t: 0, f: 3 });
  });

  it("só curvas não contam como 'partitura com tempo por nota' (sem notas ficaria sem halo e sem fundo)", () => {
    expect(temNotas([[{ ligadura: true }]])).toBe(false);
    expect(temNotas([[{ ligadura: true }, {}]])).toBe(true);
  });

  it("o progresso vai de 0 a 1 enquanto a primeira nota soa e fica nos limites fora dela", () => {
    expect(progressoDaCurva({ t: 2, f: 4 }, 2)).toBe(0);
    expect(progressoDaCurva({ t: 2, f: 4 }, 3)).toBe(0.5);
    expect(progressoDaCurva({ t: 2, f: 4 }, 4)).toBe(1);
    expect(progressoDaCurva({ t: 2, f: 4 }, 9)).toBe(1);
    expect(progressoDaCurva({ t: 2, f: 4 }, -1)).toBe(0);
    expect(progressoDaCurva({ t: 2, f: 2 }, 2)).toBe(0); // fim igual ao começo: sem divisão por zero
  });

  it("acesasEm devolve o instante local de cada uma; a segunda nota acende quando a curva termina", () => {
    const lista = [[0, 0]] as [number, number][];
    const primeira = nota("a", 0, 2);
    const curvaDela: NotaDoDesenho<string> = { el: "curva", t: 0, f: 2, ligadura: true };
    const segunda = nota("b", 2, 4);
    const porCompasso = [[primeira, curvaDela, segunda]];
    expect(acesasEm(lista, 1, porCompasso).map((a) => [a.n.el, a.local])).toEqual([["a", 1], ["curva", 1]]);
    expect(acesasEm(lista, 2, porCompasso).map((a) => a.n.el)).toEqual(["b"]);
    expect(notasEm(lista, 1, porCompasso).map((n) => n.el)).toEqual(["a", "curva"]);
  });
});

describe("alturaEm (o ponto brilhante anda pelo meio da curva)", () => {
  const linha = [{ x: 0, y: 10 }, { x: 10, y: 20 }, { x: 20, y: 10 }];
  it("interpola entre os pontos vizinhos", () => {
    expect(alturaEm(linha, 5)).toBe(15);
    expect(alturaEm(linha, 15)).toBe(15);
    expect(alturaEm(linha, 10)).toBe(20);
  });
  it("fora da linha vale a ponta mais próxima, e vazia vale 0", () => {
    expect(alturaEm(linha, -3)).toBe(10);
    expect(alturaEm(linha, 99)).toBe(10);
    expect(alturaEm([], 1)).toBe(0);
  });
  it("dois pontos no mesmo x não dividem por zero", () => {
    expect(Number.isFinite(alturaEm([{ x: 0, y: 1 }, { x: 5, y: 2 }, { x: 5, y: 4 }, { x: 9, y: 3 }], 5))).toBe(true);
  });
});
