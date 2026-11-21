#!/usr/bin/env python3
"""Gera a partitura de cada hino em SVG (I-08): .mscx -> MusicXML (MuseScore 4) -> SVG (Verovio).

Uso:  python3 tools/gerar-partituras.py ENTRADA SAIDA [--largura 700] [--largura-paisagem 1200] [--so-retrato] [--escala 40]
                                              [--musescore "CMD"] [--tempo 180]

ENTRADA  pasta com arquivos hino-<número>.mscx (os mesmos que o conversor lê).
SAIDA    pasta onde ficam, para cada hino, hino-<número>.svg (RETRATO) e hino-<número>-paisagem.svg (PAISAGEM), cada um com o seu
         .timemap.json (cria a pasta se não existir).

É uma ferramenta de geração, fora do app: precisa do MuseScore 4 e do pacote Python "verovio" (pip install verovio). O
resultado **não vai para o Git** (as partituras são do autor das transcrições, como as letras).

O MuseScore é procurado, nesta ordem: --musescore, a variável BM_MUSESCORE, os comandos mscore/musescore4/musescore
no PATH e o Flatpak org.musescore.MuseScore. Ele roda sem janela (QT_QPA_PLATFORM=offscreen), com limite de tempo por hino
(--tempo, em segundos). Se um hino falha, o motivo é impresso e o lote continua; o código de saída é 1 se algum falhou.

**Duas versões de cada partitura.** O SVG é pré-desenhado, então as quebras de linha são FIXAS: ele não reorganiza os compassos quando a
tela gira. Por isso saem duas versões, e o app escolhe pela tela. Medido nos 5 hinos de amostra (média de compassos por linha, e o
tamanho da nota em px por unidade do desenho):

    largura  compassos/linha  nota em retrato (380 px)  nota em paisagem (760 px)
      500          1,08              1,90                      3,80   <- "cortando": quase 1 compasso por linha
      700          1,62              1,36                      2,71   <- RETRATO (celular em pé)
     1200          3,23              0,79                      1,58   <- PAISAGEM (celular deitado, tablet, computador)

Cada SVG sai numa **página só**, que termina onde acaba a música, com viewBox (escala com a largura do contêiner), **sem a letra**: a
letra cantada tem a aba Letra, e na partitura só atrapalha. O timemap guarda o instante de cada nota e compasso, para o karaokê na
partitura (I-12, fase B); há um por versão, porque os ids das notas mudam a cada desenho.
"""
import argparse
import gzip
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

NOME = re.compile(r"^hino-(\d+)\.mscx$")

# A letra da partitura sai: todo <lyric>...</lyric> do MusicXML (incluindo o sinal de elisão que o MuseScore escreve dentro dele). Só o
# elemento <lyric> verdadeiro: <lyric-font> e <lyric-language>, que ficam em <defaults>, têm o mesmo começo e NÃO podem ser tocados (um
# padrão frouxo apagaria a partitura inteira entre o primeiro <lyric-font> e o primeiro </lyric>).
LETRA_MUSICXML = re.compile(r"<lyric(?=[\s>])(?:[^<>]*/>|.*?</lyric>)", re.S)

# Larguras de página, em unidades do Verovio (ver o texto no começo do arquivo).
LARGURA_RETRATO = 700
LARGURA_PAISAGEM = 1200
# O sufixo do nome do arquivo de cada versão (o app lê estes nomes: src-tauri/src/pacote.rs).
SUFIXO_PAISAGEM = "-paisagem"

TEMPO_LIMITE = 180  # segundos por hino no MuseScore (nos hinos de amostra ele leva menos de 1 s)


class ErroHino(Exception):
    """Um hino que não deu certo; a mensagem diz o porquê e o lote continua."""


def remover_letra(xml: str) -> str:
    """O MusicXML sem a letra (os elementos <lyric>)."""
    return LETRA_MUSICXML.sub("", xml)


DIRECAO_MUSICXML = re.compile(r"<direction(?:\s[^>]*)?>.*?</direction>", re.S)  # `(?:\s[^>]*)?` para não pegar <direction-type>
TIPO_DE_DIRECAO = re.compile(r"<direction-type>.*?</direction-type>\s*", re.S)


def remover_andamento(xml: str) -> str:
    """O MusicXML sem o TEXTO de andamento que o autor escreveu na partitura (como "( ♪ = 112 - 144 )"): de cada <direction> que traz o andamento (<sound tempo>
    ou <metronome>) saem os <direction-type> (o que o Verovio desenha), e o <sound tempo> fica, para o resto do MusicXML não mudar. Tirar daqui, e não do SVG, faz o
    Verovio diagramar sem o espaço do texto. O andamento que vale é o do hinário (botão no topo do app)."""

    def direcao(m):
        bloco = m.group(0)
        return TIPO_DE_DIRECAO.sub("", bloco) if "<sound tempo=" in bloco or "<metronome" in bloco else bloco

    return DIRECAO_MUSICXML.sub(direcao, xml)


def numero_do_hino(nome: str):
    """'hino-283.mscx' -> 283; qualquer outro nome -> None."""
    m = NOME.match(nome)
    return int(m.group(1)) if m else None


def inteiro_positivo(texto: str) -> int:
    """Para o argparse: --largura e --escala precisam ser inteiros maiores que zero."""
    try:
        valor = int(texto)
    except ValueError:
        raise argparse.ArgumentTypeError(f"'{texto}' não é um número inteiro") from None
    if valor <= 0:
        raise argparse.ArgumentTypeError(f"precisa ser maior que zero (veio {valor})")
    return valor


def achar_musescore(entrada: Path, trabalho: Path, escolhido: str | None):
    """Devolve o início do comando do MuseScore (lista) ou None se não achar nenhum."""
    escolhido = escolhido or os.environ.get("BM_MUSESCORE")
    if escolhido:
        return shlex.split(escolhido)
    for comando in ("mscore", "musescore4", "musescore"):
        if shutil.which(comando):
            return [comando]
    if shutil.which("flatpak"):
        achou = subprocess.run(["flatpak", "info", "org.musescore.MuseScore"], capture_output=True)
        if achou.returncode == 0:
            # O Flatpak só enxerga as pastas que se pedem: a de entrada (leitura) e a de trabalho.
            return ["flatpak", "run", f"--filesystem={entrada}:ro", f"--filesystem={trabalho}", "org.musescore.MuseScore"]
    return None


def opcoes_verovio(largura: int, escala: int) -> dict:
    """As opções do Verovio. As de saída do SVG importam para o app (ver src-tauri/src/svg.rs, que só aceita o que sai daqui)."""
    return {
        "pageWidth": largura,
        "pageHeight": 60000,
        "adjustPageHeight": True,  # a página termina onde acaba a música
        "scale": escala,
        "breaks": "auto",
        "svgViewBox": True,  # o SVG escala com o contêiner
        "svgRemoveXlink": True,  # href em vez de xlink:href (o app recusa xlink)
        # Por padrão cada SVG leva a fonte Leipzig inteira embutida (58 KB em base64, num @font-face com url(data:...)), igual em
        # todos os hinos. O app traz a fonte uma vez só; o SVG fica sem ela (e sem nenhum url(), que o app recusa).
        "smuflTextFont": "none",
        "svgFormatRaw": True,  # sem indentação: o arquivo cai para menos da metade
        "header": "none",
        "footer": "none",
    }


def ultimas_linhas(texto: str, quantas: int = 3) -> str:
    linhas = [l.strip() for l in (texto or "").splitlines() if l.strip()]
    return " | ".join(linhas[-quantas:])


def mscx_para_musicxml(musescore: list, mscx: Path, destino: Path, tempo: int = TEMPO_LIMITE):
    """Roda o MuseScore. Devolve None se o MusicXML saiu, ou o motivo da falha (texto)."""
    ambiente = dict(os.environ, QT_QPA_PLATFORM="offscreen")
    try:
        r = subprocess.run([*musescore, "-o", str(destino), str(mscx)], env=ambiente, capture_output=True, text=True,
                           errors="replace", timeout=tempo)
    except subprocess.TimeoutExpired:
        return f"o MuseScore passou de {tempo} s e foi interrompido"
    except OSError as e:
        return f"não consegui rodar o MuseScore ({' '.join(musescore)}): {e}"
    if destino.exists() and destino.stat().st_size > 0:
        return None
    # Em caso de sucesso o MuseScore também escreve avisos inofensivos; só se mostram quando não saiu arquivo.
    motivo = f"o MuseScore não gerou o MusicXML (código {r.returncode})"
    detalhe = ultimas_linhas(r.stderr or r.stdout)
    return f"{motivo}: {detalhe}" if detalhe else motivo


def gravar(saida: Path, arquivos: dict):
    """Grava os arquivos (nome -> bytes) por arquivo temporário + troca. Se algo falhar ENQUANTO se escrevem os temporários (disco cheio, por
    exemplo), nenhum destino é tocado e nenhum temporário sobra. A troca em si (`replace`, um arquivo por vez, na mesma pasta) não é atômica
    para o conjunto: se uma troca falhar no meio, os anteriores já valem. O hino é então dado como falho (código de saída 1) e basta rodar de
    novo, que ele é gravado inteiro."""
    temporarios = [((saida / nome).with_name(nome + ".tmp"), saida / nome, dados) for nome, dados in arquivos.items()]
    try:
        for tmp, _, dados in temporarios:
            tmp.write_bytes(dados)
        for tmp, destino, _ in temporarios:
            tmp.replace(destino)
    finally:
        for tmp, _, _ in temporarios:
            tmp.unlink(missing_ok=True)


def versoes(largura: int, largura_paisagem: int | None):
    """As versões a gerar, como (sufixo do nome, largura da página): o retrato sempre, e a paisagem se pedida (None = só retrato)."""
    saida = [("", largura)]
    if largura_paisagem is not None:
        saida.append((SUFIXO_PAISAGEM, largura_paisagem))
    return saida


# Cada nota e cada pausa do SVG leva o instante em que soa, DENTRO do compasso, em semínimas (as mesmas "batidas" do hinário): `data-t` é o
# começo e `data-f` o fim (I-26, karaokê por nota). O app lê estes dois atributos direto do elemento e os soma ao início do compasso que
# toca (a lista `compassos` do hinário), então não precisa de mapa de ids nem de arquivo à parte. Cada nota tem o SEU tempo, inclusive a
# segunda de uma ligadura (a curva, `<g class="tie">`, leva o tempo da nota que a abre: é por onde a luz corre até a segunda nota). A ligadura de EXPRESSÃO
# (`<g class="slur">`, a curva inclinada que une notas de alturas diferentes) também leva tempo: da nota onde ela abre até o começo da nota onde ela fecha.
ELEMENTO_COM_TEMPO = re.compile(r'<g id="([^"]+)" class="(?:note|rest)">')
LIGADURA_NO_SVG = re.compile(r'<g id="([^"]+)" class="(tie|slur)">')
CASAS_DO_TEMPO = 4


def numero_curto(valor: float) -> str:
    """Um tempo em batidas, com no máximo 4 casas e sem zeros à direita: 1.5, 0.3333, 4."""
    texto = f"{round(valor, CASAS_DO_TEMPO):.{CASAS_DO_TEMPO}f}".rstrip("0").rstrip(".")
    return "0" if texto in ("", "-0") else texto


def tempos_no_compasso(timemap: list, real) -> dict:
    """Do `timemap` do Verovio (com `includeMeasures` e `includeRests`), o `(início, fim)` de cada nota e pausa DENTRO do compasso em que
    soa, em semínimas, pelo id do desenho. `real` traduz o id do `timemap` (nas repetições, o de uma cópia que não existe no SVG) para o id
    do desenho. Vale a primeira vez que o elemento soa: nas repetições o instante dentro do compasso é o mesmo. O fim pode passar do
    compasso (nota que atravessa a barra)."""
    medida = 0.0
    abertas: dict = {}
    saida: dict = {}
    for e in timemap:
        q = e["qstamp"]
        for chave in ("off", "restsOff"):
            for id_ in e.get(chave, []):
                r = real(id_)
                if r in abertas:
                    m0, inicio = abertas.pop(r)
                    saida.setdefault(r, (inicio, q - m0))
        if "measureOn" in e:
            medida = q
        for chave in ("on", "restsOn"):
            for id_ in e.get(chave, []):
                abertas[real(id_)] = (medida, q - medida)
    return saida


def inicios_absolutos(timemap: list, real) -> dict:
    """Do `timemap`, o instante ABSOLUTO (em semínimas, desde o começo da peça) em que cada nota e pausa começa a soar, pelo id do desenho. Vale a primeira vez que o
    elemento soa. Serve para medir a distância entre duas notas de uma ligadura de expressão, que pode atravessar a barra de compasso."""
    saida: dict = {}
    for e in timemap:
        for chave in ("on", "restsOn"):
            for id_ in e.get(chave, []):
                saida.setdefault(real(id_), e["qstamp"])
    return saida


def marcar_notas(svg: str, tempos: dict, ligaduras: list) -> tuple:
    """O SVG com `data-t` e `data-f` em cada nota e pausa que tem tempo, e nas ligaduras. Devolve (svg, quantas notas e pausas foram marcadas).
    Cada nota acende no SEU tempo, inclusive a segunda de uma ligadura (o som é uma nota só, mas na partitura o halo acompanha a curva e depois
    preenche a segunda nota). `ligaduras` é uma lista de `(id do <g class="tie">, id da nota que abre, id da que fecha)`: a curva leva o tempo da
    nota que abre (de onde a luz parte até onde a segunda começa). Se a ligadura foi partida em duas pelo fim da linha, o tempo se divide em partes
    iguais, na ordem. Sem tempo (nota sem evento) ou com duração zero (nota de enfeite): sem atributos, não acende.
    Uma ligadura de EXPRESSÃO vem com um 4º item, a duração (em semínimas) do começo da nota que abre ao começo da que fecha: a curva dela leva
    `(início da nota que abre, início + duração)` (a duração, e não o fim da primeira nota)."""
    marcados = 0

    def troca(m):
        nonlocal marcados
        id_ = m.group(1)
        if id_ not in tempos:
            return m.group(0)
        inicio, fim = tempos[id_]
        if fim - inicio <= 1e-6:
            return m.group(0)
        marcados += 1
        return f'{m.group(0)[:-1]} data-t="{numero_curto(inicio)}" data-f="{numero_curto(fim)}">'

    svg = ELEMENTO_COM_TEMPO.sub(troca, svg)

    # a curva da ligadura: o tempo da nota que abre, dividido entre os pedaços da mesma ligadura
    # O pedaço de uma ligadura partida pelo fim da linha só se junta aos da MESMA espécie: uma ligadura de prolongamento e uma de expressão sobre as mesmas duas notas
    # são curvas diferentes, e dividir o tempo entre elas daria meio tempo a cada uma.
    pedacos = {}
    duracoes = {}
    for item in ligaduras:
        gid, de, ate = item[:3]
        expressao = len(item) > 3
        pedacos.setdefault((expressao, de, ate), []).append(gid)
        if expressao:
            duracoes[(de, ate)] = item[3]
    tempo_da_curva = {}
    for (expressao, de, ate), ids in pedacos.items():
        if de not in tempos:
            continue
        inicio, fim = tempos[de]
        if expressao:
            fim = inicio + duracoes[(de, ate)]  # expressão: até o começo da nota que fecha
        if fim - inicio <= 1e-6:
            continue
        passo = (fim - inicio) / len(ids)
        for k, gid in enumerate(ids):
            tempo_da_curva[gid] = (inicio + k * passo, inicio + (k + 1) * passo)

    def curva(m):
        t = tempo_da_curva.get(m.group(1))
        if t is None:
            return m.group(0)
        return f'{m.group(0)[:-1]} data-t="{numero_curto(t[0])}" data-f="{numero_curto(t[1])}">'

    return LIGADURA_NO_SVG.sub(curva, svg), marcados


def tempos_do_desenho(tk, svg: str, timemap: list) -> tuple:
    """Pergunta ao Verovio o que o `timemap` e o SVG não dizem sozinhos: as cópias que cada elemento tem nas repetições
    (`getExpansionIdsForElement`) e as ligaduras (`startid` e `endid` de cada `<g class="tie">`, como lista de `(id da curva, nota que abre, nota que fecha)`)."""
    desenhados = [m.group(1) for m in ELEMENTO_COM_TEMPO.finditer(svg)]
    copia_para_real = {}
    for r in desenhados:
        for c in tk.getExpansionIdsForElement(r) or []:
            if c:
                copia_para_real[c] = r
    real = lambda i: copia_para_real.get(i, i)  # sem repetição o Verovio não devolve cópias: o id do timemap já é o do desenho
    ligaduras = []
    absolutos = inicios_absolutos(timemap, real)
    for m in LIGADURA_NO_SVG.finditer(svg):
        a = tk.getElementAttr(m.group(1))
        inicio, fim = (a.get("startid") or "").lstrip("#"), (a.get("endid") or "").lstrip("#")
        if not (inicio and fim):
            continue
        de, ate = real(inicio), real(fim)
        if m.group(2) == "tie":
            ligaduras.append((m.group(1), de, ate))
        elif de in absolutos and ate in absolutos and absolutos[ate] - absolutos[de] > 1e-6:
            ligaduras.append((m.group(1), de, ate, absolutos[ate] - absolutos[de]))  # expressão: a duração até a nota que fecha
    return tempos_no_compasso(timemap, real), ligaduras


def gerar_hino(tk, musescore: list, n: int, mscx: Path, trabalho: Path, saida: Path, escala: int, versoes_: list, tempo: int = TEMPO_LIMITE):
    """Gera os arquivos de um hino (todas as versões). Devolve, por versão, (bytes do SVG, bytes comprimidos, bytes do timemap), ou levanta
    ErroHino. Nada é gravado se alguma versão falhar em ser DESENHADA (o MuseScore ou o Verovio falhando): o hino sai inteiro ou não sai. As
    versões que NESTA rodada não foram pedidas (`--so-retrato`) são apagadas da pasta de saída, para não sobrar uma paisagem de uma rodada
    anterior ao lado de um retrato novo."""
    xml = trabalho / f"hino-{n}.musicxml"
    motivo = mscx_para_musicxml(musescore, mscx, xml, tempo)
    if motivo:
        raise ErroHino(motivo)
    arquivos = {}
    medidas = []
    try:
        texto = remover_andamento(remover_letra(xml.read_text(encoding="utf-8")))
        for sufixo, largura in versoes_:
            tk.setOptions(opcoes_verovio(largura, escala))
            if not tk.loadData(texto):
                raise ErroHino(f"o Verovio não leu o MusicXML{(' (' + sufixo.strip('-') + ')') if sufixo else ''}")
            if tk.getPageCount() != 1:
                raise ErroHino(f"saiu em {tk.getPageCount()} páginas (esperava 1){(' (' + sufixo.strip('-') + ')') if sufixo else ''}")
            svg_texto = tk.renderToSVG(1)
            mapa = tk.renderToTimemap({"includeMeasures": True, "includeRests": True})
            tempos, ligaduras = tempos_do_desenho(tk, svg_texto, mapa)
            svg_texto, _ = marcar_notas(svg_texto, tempos, ligaduras)
            svg = svg_texto.encode("utf-8")
            tempo_json = json.dumps(mapa, separators=(",", ":")).encode("utf-8")
            arquivos[f"hino-{n}{sufixo}.svg"] = svg
            arquivos[f"hino-{n}{sufixo}.timemap.json"] = tempo_json
            medidas.append((len(svg), len(gzip.compress(svg, 9)), len(tempo_json)))
        gravar(saida, arquivos)
        # A versão não pedida nesta rodada não pode sobrar de uma rodada anterior: o montador de pacote empacotaria a paisagem velha ao lado
        # do retrato novo, e o app mostraria desenhos diferentes ao girar o aparelho.
        for sufixo in {"", SUFIXO_PAISAGEM} - {s for s, _ in versoes_}:
            for extensao in (".svg", ".timemap.json"):
                (saida / f"hino-{n}{sufixo}{extensao}").unlink(missing_ok=True)
    except (OSError, UnicodeError) as e:
        raise ErroHino(f"{type(e).__name__}: {e}") from e
    return medidas


def processar(tk, musescore: list, hinos: list, trabalho: Path, saida: Path, escala: int, versoes_: list, tempo: int = TEMPO_LIMITE):
    """Gera todos os hinos, imprime a tabela e devolve (falhas, total de bytes de SVG). Um hino ruim não para os outros."""
    falhas = 0
    total = 0
    nomes = ["retrato" if not suf else suf.strip("-") for suf, _ in versoes_]
    print(f"{'hino':>5} " + " ".join(f"{'SVG ' + nome:>14}" for nome in nomes) + f" {'gzip (todas)':>13}")
    for n, mscx in hinos:
        try:
            medidas = gerar_hino(tk, musescore, n, mscx, trabalho, saida, escala, versoes_, tempo)
        except ErroHino as e:
            print(f"{n:>5}  FALHOU: {e}", file=sys.stderr)
            falhas += 1
            continue
        total += sum(svg for svg, _, _ in medidas)
        print(f"{n:>5} " + " ".join(f"{svg:>14,}" for svg, _, _ in medidas) + f" {sum(gz for _, gz, _ in medidas):>13,}")
    return falhas, total


def principal() -> int:
    ap = argparse.ArgumentParser(description="Gera a partitura (SVG) de cada hino-N.mscx.")
    ap.add_argument("entrada", type=Path)
    ap.add_argument("saida", type=Path)
    ap.add_argument("--largura", type=inteiro_positivo, default=LARGURA_RETRATO, help=f"largura da página do RETRATO, em unidades do Verovio (padrão {LARGURA_RETRATO})")
    ap.add_argument("--largura-paisagem", type=inteiro_positivo, default=LARGURA_PAISAGEM, help=f"largura da página da PAISAGEM (padrão {LARGURA_PAISAGEM})")
    ap.add_argument("--so-retrato", action="store_true", help="não gera a versão de paisagem")
    ap.add_argument("--escala", type=inteiro_positivo, default=40, help="escala do Verovio, em %% (padrão 40)")
    ap.add_argument("--musescore", help='comando do MuseScore, por exemplo "flatpak run org.musescore.MuseScore"')
    ap.add_argument("--tempo", type=inteiro_positivo, default=TEMPO_LIMITE, help=f"limite de segundos por hino no MuseScore (padrão {TEMPO_LIMITE})")
    a = ap.parse_args()

    entrada = a.entrada.resolve()
    if not entrada.is_dir():
        print(f"erro: {a.entrada} não é uma pasta", file=sys.stderr)
        return 2
    hinos = sorted((numero_do_hino(p.name), p) for p in entrada.iterdir() if numero_do_hino(p.name) is not None)
    if not hinos:
        print(f"erro: nenhum hino-<número>.mscx em {a.entrada}", file=sys.stderr)
        return 2

    try:
        import verovio
    except ImportError:
        print("erro: falta o pacote Python 'verovio' (pip install verovio, de preferência num venv)", file=sys.stderr)
        return 2

    a.saida.mkdir(parents=True, exist_ok=True)
    saida = a.saida.resolve()
    tk = verovio.toolkit()
    versoes_ = versoes(a.largura, None if a.so_retrato else a.largura_paisagem)

    with tempfile.TemporaryDirectory(prefix="bm-partitura-") as t:
        trabalho = Path(t)
        musescore = achar_musescore(entrada, trabalho, a.musescore)
        if musescore is None:
            print("erro: não achei o MuseScore (use --musescore ou instale o Flatpak org.musescore.MuseScore)", file=sys.stderr)
            return 2
        print(f"verovio {tk.getVersion()}  escala={a.escala}  " + "  ".join(f"{(suf.strip('-') or 'retrato')}={larg}" for suf, larg in versoes_))
        falhas, total = processar(tk, musescore, hinos, trabalho, saida, a.escala, versoes_, a.tempo)

    print(f"{len(hinos) - falhas} de {len(hinos)} hinos; SVG somam {total:,} bytes")
    return 1 if falhas else 0


if __name__ == "__main__":
    sys.exit(principal())
