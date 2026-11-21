#!/usr/bin/env python3
"""Testes da parte pura de tools/gerar-partituras.py (não precisam do MuseScore nem do Verovio).

Uso:  python3 tools/test_gerar_partituras.py
"""
import argparse
import contextlib
import importlib.util
import io
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

AQUI = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("gerar_partituras", AQUI / "gerar-partituras.py")
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)

class RemoverAndamento(unittest.TestCase):
    TEMPO = ('<direction placement="above"><direction-type><words>(</words></direction-type><direction-type><metronome><beat-unit>eighth</beat-unit>'
             '<per-minute>112</per-minute></metronome></direction-type><sound tempo="56"/></direction>')

    def test_tira_o_texto_e_deixa_o_sound_tempo(self):
        self.assertEqual(g.remover_andamento(self.TEMPO), '<direction placement="above"><sound tempo="56"/></direction>')

    def test_nao_toca_nas_outras_direcoes(self):
        outras = ('<direction placement="above"><direction-type><words>*</words></direction-type></direction>'
                  '<direction><direction-type><dynamics><p/></dynamics></direction-type></direction>')
        self.assertEqual(g.remover_andamento(outras), outras)

    def test_so_a_direcao_do_andamento_perde_o_texto(self):
        xml = '<m>' + self.TEMPO + '<direction><direction-type><words>Coro</words></direction-type></direction></m>'
        self.assertEqual(g.remover_andamento(xml), '<m><direction placement="above"><sound tempo="56"/></direction><direction><direction-type><words>Coro</words></direction-type></direction></m>')

    def test_metronome_sem_sound_tambem_sai(self):
        xml = '<direction><direction-type><metronome><per-minute>60</per-minute></metronome></direction-type></direction>'
        self.assertEqual(g.remover_andamento(xml), '<direction></direction>')

    def test_sem_andamento_nada_muda(self):
        xml = '<score><part><measure><note><pitch/></note></measure></part></score>'
        self.assertEqual(g.remover_andamento(xml), xml)


class RemoverLetra(unittest.TestCase):
    def test_tira_o_lyric_e_o_que_ha_dentro(self):
        xml = '<note><pitch/><lyric number="1" default-y="-67"><syllabic>end</syllabic><text>nho,</text></lyric></note>'
        self.assertEqual(g.remover_letra(xml), "<note><pitch/></note>")

    def test_tira_todas_as_letras_de_varias_vozes_e_linhas(self):
        xml = "<n><lyric number=\"1\"><text>a</text></lyric><lyric number=\"2\">\n<text>b</text>\n</lyric></n>"
        self.assertEqual(g.remover_letra(xml), "<n></n>")

    def test_tira_o_sinal_de_elisao_que_vem_dentro_da_letra(self):
        elisao = chr(0xE552)
        xml = f'<lyric><text>nho,</text><text font-family="MScore Text">{elisao}</text><text>em</text></lyric>'
        self.assertEqual(g.remover_letra(xml), "")

    def test_lyric_vazio_de_uma_tag_so(self):
        self.assertEqual(g.remover_letra('<a/><lyric number="1"/><b/>'), "<a/><b/>")

    def test_nao_toca_nos_elementos_que_so_comecam_igual(self):
        # <lyric-font> e <lyric-language> ficam em <defaults>; um padrão frouxo apagaria o trecho entre eles e o primeiro </lyric>
        xml = ('<defaults><lyric-font font-family="FreeSerif" font-size="10"/><lyric-language xml:lang="pt"/></defaults>'
               '<note><lyric><text>x</text></lyric></note><note2/>')
        self.assertEqual(g.remover_letra(xml), '<defaults><lyric-font font-family="FreeSerif" font-size="10"/><lyric-language xml:lang="pt"/></defaults><note></note><note2/>')

    def test_sem_letra_nada_muda(self):
        xml = "<score><part><measure><note><pitch/></note></measure></part></score>"
        self.assertEqual(g.remover_letra(xml), xml)

    def test_o_resto_da_partitura_fica_inteiro(self):
        com = "".join(f'<note id="{i}"><pitch/><lyric><text>t{i}</text></lyric></note>' for i in range(50))
        sem = "".join(f'<note id="{i}"><pitch/></note>' for i in range(50))
        self.assertEqual(g.remover_letra(com), sem)


class NumeroDoHino(unittest.TestCase):
    def test_nomes_validos(self):
        self.assertEqual(g.numero_do_hino("hino-283.mscx"), 283)
        self.assertEqual(g.numero_do_hino("hino-1.mscx"), 1)

    def test_nomes_que_nao_sao_hino(self):
        for nome in ("hino-.mscx", "hino-2a.mscx", "hino-283.mscz", "x-hino-283.mscx", "hino-283.mscx.bak", "283.mscx"):
            self.assertIsNone(g.numero_do_hino(nome), nome)


class InteiroPositivo(unittest.TestCase):
    def test_aceita_inteiros_maiores_que_zero(self):
        self.assertEqual(g.inteiro_positivo("700"), 700)
        self.assertEqual(g.inteiro_positivo("1"), 1)

    def test_rejeita_zero_negativo_e_o_que_nao_e_inteiro(self):
        for texto in ("0", "-1", "-700", "abc", "", "1.5", "7e2"):
            with self.assertRaises(argparse.ArgumentTypeError, msg=texto):
                g.inteiro_positivo(texto)


class AcharMusescore(unittest.TestCase):
    def setUp(self):
        self.entrada = Path("/ent")
        self.trabalho = Path("/trab")

    def test_o_argumento_vence_a_variavel_de_ambiente(self):
        with mock.patch.dict(os.environ, {"BM_MUSESCORE": "do-ambiente"}):
            self.assertEqual(g.achar_musescore(self.entrada, self.trabalho, "meu mscore --x"), ["meu", "mscore", "--x"])

    def test_a_variavel_de_ambiente_vale_sem_argumento(self):
        with mock.patch.dict(os.environ, {"BM_MUSESCORE": "do-ambiente"}):
            self.assertEqual(g.achar_musescore(self.entrada, self.trabalho, None), ["do-ambiente"])

    def test_usa_o_primeiro_comando_do_path(self):
        com = {"musescore4": "/usr/bin/musescore4", "musescore": "/usr/bin/musescore"}
        with mock.patch.dict(os.environ, {}, clear=False), mock.patch.object(g.shutil, "which", lambda c: com.get(c)):
            os.environ.pop("BM_MUSESCORE", None)
            self.assertEqual(g.achar_musescore(self.entrada, self.trabalho, None), ["musescore4"])

    def test_flatpak_pede_acesso_as_duas_pastas(self):
        class Ok:
            returncode = 0

        with mock.patch.object(g.shutil, "which", lambda c: "/usr/bin/flatpak" if c == "flatpak" else None), \
                mock.patch.object(g.subprocess, "run", lambda *a, **k: Ok()):
            os.environ.pop("BM_MUSESCORE", None)
            cmd = g.achar_musescore(self.entrada, self.trabalho, None)
        self.assertEqual(cmd, ["flatpak", "run", "--filesystem=/ent:ro", "--filesystem=/trab", "org.musescore.MuseScore"])

    def test_sem_nada_instalado_devolve_none(self):
        with mock.patch.object(g.shutil, "which", lambda c: None):
            os.environ.pop("BM_MUSESCORE", None)
            self.assertIsNone(g.achar_musescore(self.entrada, self.trabalho, None))


class OpcoesVerovio(unittest.TestCase):
    def test_repassa_largura_e_escala(self):
        o = g.opcoes_verovio(700, 40)
        self.assertEqual((o["pageWidth"], o["scale"]), (700, 40))
        o = g.opcoes_verovio(900, 33)
        self.assertEqual((o["pageWidth"], o["scale"]), (900, 33))

    def test_saida_do_svg_e_a_que_o_app_aceita(self):
        o = g.opcoes_verovio(700, 40)
        # sem a fonte embutida (um @font-face com url(data:...) que o app recusa) e sem xlink:href
        self.assertEqual(o["smuflTextFont"], "none")
        self.assertIs(o["svgRemoveXlink"], True)
        # uma página só, com viewBox, e sem indentação
        self.assertIs(o["adjustPageHeight"], True)
        self.assertIs(o["svgViewBox"], True)
        self.assertIs(o["svgFormatRaw"], True)
        # a letra sai da partitura: as opções de letra do Verovio não existem mais
        for chave in o:
            self.assertNotIn("lyric", chave.lower(), chave)

    def test_as_larguras_padrao_sao_700_no_retrato_e_1200_na_paisagem(self):
        # medido nos hinos de amostra (ver o cabeçalho de tools/gerar-partituras.py): 500 dava 1 compasso por linha
        self.assertEqual((g.LARGURA_RETRATO, g.LARGURA_PAISAGEM), (700, 1200))
        self.assertLess(g.LARGURA_RETRATO, g.LARGURA_PAISAGEM)

    def test_o_nome_da_paisagem_e_o_que_o_app_le(self):
        self.assertEqual(g.SUFIXO_PAISAGEM, "-paisagem")  # src-tauri/src/pacote.rs: hino-<n>-paisagem.svg


class Versoes(unittest.TestCase):
    def test_retrato_e_paisagem_por_padrao_e_so_retrato_se_pedido(self):
        self.assertEqual(g.versoes(700, 1200), [("", 700), ("-paisagem", 1200)])
        self.assertEqual(g.versoes(700, None), [("", 700)])
        self.assertEqual(g.versoes(650, 1300), [("", 650), ("-paisagem", 1300)])


class UltimasLinhas(unittest.TestCase):
    def test_pega_so_as_ultimas_e_ignora_linhas_vazias(self):
        self.assertEqual(g.ultimas_linhas("a\n\n b \nc\nd\n", 2), "c | d")

    def test_aceita_vazio_e_none(self):
        self.assertEqual(g.ultimas_linhas(""), "")
        self.assertEqual(g.ultimas_linhas(None), "")


class MscxParaMusicxml(unittest.TestCase):
    def falso(self, conteudo=None, codigo=0, erro="", saida=""):
        """Um subprocess.run falso: escreve (ou não) o arquivo do -o e devolve um resultado."""
        def run(cmd, **k):
            if conteudo is not None:
                Path(cmd[cmd.index("-o") + 1]).write_text(conteudo)
            return subprocess.CompletedProcess(cmd, codigo, stdout=saida, stderr=erro)
        return run

    def chama(self, run, tempo=5):
        with tempfile.TemporaryDirectory() as t:
            with mock.patch.object(g.subprocess, "run", run):
                return g.mscx_para_musicxml(["mscore"], Path("x.mscx"), Path(t) / "saida.musicxml", tempo)

    def test_sucesso_devolve_none(self):
        self.assertIsNone(self.chama(self.falso("<score/>")))

    def test_sucesso_mesmo_com_aviso_no_stderr_e_codigo_diferente_de_zero(self):
        self.assertIsNone(self.chama(self.falso("<score/>", codigo=1, erro="QCoreApplication::applicationDirPath: aviso")))

    def test_arquivo_ausente_ou_vazio_e_falha_com_codigo_e_causa(self):
        for conteudo in (None, ""):
            motivo = self.chama(self.falso(conteudo, codigo=3, erro="linha 1\nNão consegui abrir o arquivo"))
            self.assertIn("não gerou o MusicXML", motivo)
            self.assertIn("código 3", motivo)
            self.assertIn("Não consegui abrir o arquivo", motivo)

    def test_sem_mensagem_do_musescore_o_motivo_nao_termina_em_dois_pontos(self):
        motivo = self.chama(self.falso(None, codigo=1))
        self.assertTrue(motivo.endswith("(código 1)"), motivo)

    def test_usa_a_saida_padrao_se_o_stderr_estiver_vazio(self):
        self.assertIn("só no stdout", self.chama(self.falso(None, codigo=1, saida="só no stdout")))

    def test_tempo_esgotado_e_falha_com_o_limite_no_texto(self):
        def run(cmd, **k):
            raise subprocess.TimeoutExpired(cmd, k["timeout"])

        motivo = self.chama(run, tempo=7)
        self.assertIn("passou de 7 s", motivo)

    def test_passa_o_limite_de_tempo_ao_subprocesso(self):
        visto = {}

        def run(cmd, **k):
            visto.update(k)
            return subprocess.CompletedProcess(cmd, 0, "", "")

        self.chama(run, tempo=42)
        self.assertEqual(visto["timeout"], 42)

    def test_comando_inexistente_e_falha_com_o_comando_no_texto(self):
        def run(cmd, **k):
            raise FileNotFoundError(2, "No such file or directory", "mscore-que-nao-existe")

        motivo = self.chama(run)
        self.assertIn("não consegui rodar o MuseScore", motivo)
        self.assertIn("mscore", motivo)

    def test_roda_sem_janela(self):
        visto = {}

        def run(cmd, env=None, **k):
            visto["env"] = env
            return subprocess.CompletedProcess(cmd, 0, "", "")

        self.chama(run)
        self.assertEqual(visto["env"]["QT_QPA_PLATFORM"], "offscreen")


class Gravar(unittest.TestCase):
    def test_grava_todos_os_arquivos_sem_deixar_temporario(self):
        with tempfile.TemporaryDirectory() as t:
            saida = Path(t)
            g.gravar(saida, {"hino-7.svg": b"<svg/>", "hino-7.timemap.json": b"[1,2]", "hino-7-paisagem.svg": b"<g/>"})
            self.assertEqual((saida / "hino-7.svg").read_bytes(), b"<svg/>")
            self.assertEqual((saida / "hino-7.timemap.json").read_bytes(), b"[1,2]")
            self.assertEqual((saida / "hino-7-paisagem.svg").read_bytes(), b"<g/>")
            self.assertEqual(sorted(p.name for p in saida.iterdir()), ["hino-7-paisagem.svg", "hino-7.svg", "hino-7.timemap.json"])

    def test_substitui_o_que_ja_existia(self):
        with tempfile.TemporaryDirectory() as t:
            saida = Path(t)
            (saida / "hino-7.svg").write_bytes(b"velho")
            g.gravar(saida, {"hino-7.svg": b"novo"})
            self.assertEqual((saida / "hino-7.svg").read_bytes(), b"novo")

    def test_falha_na_escrita_no_meio_nao_deixa_arquivo_nem_temporario(self):
        with tempfile.TemporaryDirectory() as t:
            saida = Path(t)
            original = Path.write_bytes
            chamadas = []

            def falha_na_terceira(self, dados):
                chamadas.append(self.name)
                if len(chamadas) == 3:
                    raise OSError("disco cheio")
                return original(self, dados)

            with mock.patch.object(Path, "write_bytes", falha_na_terceira):
                with self.assertRaises(OSError):
                    g.gravar(saida, {"a.svg": b"1", "b.svg": b"2", "c.svg": b"3", "d.svg": b"4"})
            self.assertEqual(list(saida.iterdir()), [], "não pode sobrar nenhum dos quatro, nem o .tmp")


class FalsoToolkit:
    """Faz as vezes do verovio.toolkit()."""

    def __init__(self, le=True, paginas=1):
        self.le, self.paginas, self.lido = le, paginas, None
        self.largura = None
        self.larguras_vistas = []

    def setOptions(self, opcoes):
        self.largura = opcoes["pageWidth"]

    def loadData(self, texto):
        self.lido = texto
        self.larguras_vistas.append(self.largura)
        return self.le

    def getPageCount(self):
        return self.paginas

    def renderToSVG(self, pagina):
        return f"<svg w={self.largura}>é</svg>"

    def renderToTimemap(self, opcoes):
        return [{"qstamp": 0}]


class GerarHino(unittest.TestCase):
    def roda(self, tk, musicxml="<score/>", tempo=5, versoes=None, escala=40):
        versoes = versoes if versoes is not None else [("", 700), ("-paisagem", 1200)]
        with tempfile.TemporaryDirectory() as t:
            trabalho, saida = Path(t) / "trab", Path(t) / "out"
            trabalho.mkdir()
            saida.mkdir()

            def run(cmd, **k):
                if musicxml is not None:
                    Path(cmd[cmd.index("-o") + 1]).write_bytes(musicxml if isinstance(musicxml, bytes) else musicxml.encode())
                return subprocess.CompletedProcess(cmd, 0, "", "")

            try:
                with mock.patch.object(g.subprocess, "run", run):
                    resultado = g.gerar_hino(tk, ["mscore"], 5, Path("hino-5.mscx"), trabalho, saida, escala, versoes, tempo)
            finally:
                self.arquivos = {p.name: p.read_bytes() for p in saida.iterdir()}
            return resultado, sorted(self.arquivos)

    def test_sucesso_grava_as_duas_versoes_com_o_seu_timemap_e_devolve_os_tamanhos(self):
        medidas, arquivos = self.roda(FalsoToolkit())
        self.assertEqual(arquivos, ["hino-5-paisagem.svg", "hino-5-paisagem.timemap.json", "hino-5.svg", "hino-5.timemap.json"])
        self.assertEqual(len(medidas), 2)
        (svg_r, gz_r, tm_r), (svg_p, gz_p, tm_p) = medidas
        self.assertEqual(svg_r, len("<svg w=700>é</svg>".encode()))  # bytes UTF-8, não caracteres
        self.assertEqual(svg_p, len("<svg w=1200>é</svg>".encode()))
        self.assertGreater(gz_r, 0)
        self.assertGreater(tm_r, 0)

    def test_cada_versao_e_desenhada_na_sua_largura_e_o_arquivo_certo_leva_o_desenho_certo(self):
        tk = FalsoToolkit()
        self.roda(tk)
        self.assertEqual(tk.larguras_vistas, [700, 1200], "o Verovio desenha de novo, na largura de cada versão")
        self.assertEqual(self.arquivos["hino-5.svg"], "<svg w=700>é</svg>".encode())
        self.assertEqual(self.arquivos["hino-5-paisagem.svg"], "<svg w=1200>é</svg>".encode())

    def roda_sobre(self, tk, antigos, versoes):
        """Como `roda`, mas a pasta de saída já tem arquivos de uma rodada anterior (nome -> bytes). Devolve o que ficou nela."""
        with tempfile.TemporaryDirectory() as t:
            trabalho, saida = Path(t) / "trab", Path(t) / "out"
            trabalho.mkdir()
            saida.mkdir()
            for nome, dados in antigos.items():
                (saida / nome).write_bytes(dados)

            def run(cmd, **k):
                Path(cmd[cmd.index("-o") + 1]).write_bytes(b"<score/>")
                return subprocess.CompletedProcess(cmd, 0, "", "")

            self.erro = None
            try:
                with mock.patch.object(g.subprocess, "run", run):
                    g.gerar_hino(tk, ["mscore"], 5, Path("hino-5.mscx"), trabalho, saida, 40, versoes, 5)
            except g.ErroHino as e:
                self.erro = e
            return {p.name: p.read_bytes() for p in saida.iterdir()}

    def test_so_retrato_apaga_a_paisagem_e_o_timemap_dela_de_uma_rodada_anterior(self):
        antigos = {"hino-5.svg": b"v", "hino-5.timemap.json": b"v", "hino-5-paisagem.svg": b"velha", "hino-5-paisagem.timemap.json": b"velho",
                   "hino-6-paisagem.svg": b"de outro hino", "leia-me.txt": b"x"}
        ficou = self.roda_sobre(FalsoToolkit(), antigos, [("", 700)])
        self.assertEqual(sorted(ficou), ["hino-5.svg", "hino-5.timemap.json", "hino-6-paisagem.svg", "leia-me.txt"])
        self.assertEqual(ficou["hino-5.svg"], "<svg w=700>é</svg>".encode(), "o retrato é o novo")
        self.assertEqual(ficou["hino-6-paisagem.svg"], b"de outro hino", "só mexe nos arquivos do hino que está gerando")

    def test_com_as_duas_versoes_nada_e_apagado_alem_do_que_e_regravado(self):
        antigos = {"hino-5.svg": b"v", "hino-5-paisagem.svg": b"v", "hino-6.svg": b"outro"}
        ficou = self.roda_sobre(FalsoToolkit(), antigos, [("", 700), ("-paisagem", 1200)])
        self.assertEqual(sorted(ficou), ["hino-5-paisagem.svg", "hino-5-paisagem.timemap.json", "hino-5.svg", "hino-5.timemap.json", "hino-6.svg"])
        self.assertEqual(ficou["hino-5-paisagem.svg"], "<svg w=1200>é</svg>".encode())

    def test_se_o_desenho_falha_a_rodada_anterior_fica_como_estava(self):
        antigos = {"hino-5.svg": b"v", "hino-5-paisagem.svg": b"velha", "hino-5-paisagem.timemap.json": b"velho"}
        ficou = self.roda_sobre(FalsoToolkit(le=False), antigos, [("", 700)])
        self.assertIsNotNone(self.erro, "o desenho falhou")
        self.assertEqual(ficou, antigos, "uma rodada que falha não apaga nada (a paisagem antiga só sai quando o retrato novo foi gravado)")

    def test_so_retrato_nao_gera_a_paisagem(self):
        tk = FalsoToolkit()
        medidas, arquivos = self.roda(tk, versoes=[("", 700)])
        self.assertEqual(arquivos, ["hino-5.svg", "hino-5.timemap.json"])
        self.assertEqual((len(medidas), tk.larguras_vistas), (1, [700]))

    def test_a_escala_e_a_largura_chegam_ao_verovio(self):
        class Espiao(FalsoToolkit):
            def setOptions(self, opcoes):
                super().setOptions(opcoes)
                self.escalas = getattr(self, "escalas", []) + [opcoes["scale"]]

        tk = Espiao()
        self.roda(tk, escala=33)
        self.assertEqual(tk.escalas, [33, 33])

    def test_o_verovio_recebe_o_xml_sem_a_letra_nas_duas_versoes(self):
        tk = FalsoToolkit()
        self.roda(tk, musicxml="<n><lyric><text>nho</text></lyric><pitch/></n>")
        self.assertEqual(tk.lido, "<n><pitch/></n>")
        self.assertEqual(len(tk.larguras_vistas), 2)

    def test_verovio_que_nao_le_e_erro_do_hino_e_nao_grava_nada(self):
        with self.assertRaisesRegex(g.ErroHino, "Verovio não leu"):
            self.roda(FalsoToolkit(le=False))
        self.assertEqual(self.arquivos, {})

    def test_mais_de_uma_pagina_e_erro_do_hino(self):
        with self.assertRaisesRegex(g.ErroHino, "2 páginas"):
            self.roda(FalsoToolkit(paginas=2))

    def test_falha_so_na_paisagem_nao_deixa_o_retrato_sozinho(self):
        # o hino sai inteiro ou não sai: um retrato sem a paisagem do mesmo lote seria um pacote pela metade
        class FalhaNaSegunda(FalsoToolkit):
            def loadData(self, texto):
                super().loadData(texto)
                return len(self.larguras_vistas) < 2

        with self.assertRaisesRegex(g.ErroHino, r"Verovio não leu o MusicXML \(paisagem\)"):
            self.roda(FalhaNaSegunda())
        self.assertEqual(self.arquivos, {}, "nem o retrato, que deu certo, fica no disco")

    def test_falha_do_musescore_vira_erro_do_hino_com_o_motivo(self):
        with self.assertRaisesRegex(g.ErroHino, "não gerou o MusicXML"):
            self.roda(FalsoToolkit(), musicxml=None)

    def test_musicxml_em_outra_codificacao_vira_erro_do_hino(self):
        with self.assertRaisesRegex(g.ErroHino, "UnicodeDecodeError"):
            self.roda(FalsoToolkit(), musicxml=b"\xff\xfe\xfa")


class Processar(unittest.TestCase):
    VERSOES = [("", 700), ("-paisagem", 1200)]

    def test_um_hino_ruim_nao_para_os_outros_e_conta_a_falha(self):
        def falso(tk, musescore, n, mscx, trabalho, saida, escala, versoes, tempo):
            if n == 2:
                raise g.ErroHino("deu ruim")
            return [(100 * n, 10, 5), (200 * n, 20, 5)]

        erro = io.StringIO()
        with mock.patch.object(g, "gerar_hino", falso), contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(erro):
            falhas, total = g.processar(None, ["mscore"], [(1, Path("a")), (2, Path("b")), (3, Path("c"))], Path("t"), Path("s"), 40, self.VERSOES)
        self.assertEqual(falhas, 1)
        self.assertEqual(total, 100 + 200 + 300 + 600, "soma as duas versões só dos que deram certo")
        self.assertIn("2  FALHOU: deu ruim", erro.getvalue())

    def test_tudo_certo_nao_conta_falhas_e_a_tabela_mostra_as_duas_versoes(self):
        saida = io.StringIO()
        with mock.patch.object(g, "gerar_hino", lambda *a, **k: [(50, 5, 1), (80, 8, 1)]), contextlib.redirect_stdout(saida):
            r = g.processar(None, ["m"], [(1, Path("a")), (2, Path("b"))], Path("t"), Path("s"), 40, self.VERSOES)
        self.assertEqual(r, (0, 260))
        cabecalho = saida.getvalue().splitlines()[0]
        self.assertIn("SVG retrato", cabecalho)
        self.assertIn("SVG paisagem", cabecalho)

    def test_so_retrato_mostra_so_uma_coluna(self):
        saida = io.StringIO()
        with mock.patch.object(g, "gerar_hino", lambda *a, **k: [(50, 5, 1)]), contextlib.redirect_stdout(saida):
            r = g.processar(None, ["m"], [(1, Path("a"))], Path("t"), Path("s"), 40, [("", 700)])
        self.assertEqual(r, (0, 50))
        self.assertNotIn("paisagem", saida.getvalue())


class NumeroCurto(unittest.TestCase):
    def test_sem_zeros_a_direita_e_ate_4_casas(self):
        self.assertEqual(g.numero_curto(4.0), "4")
        self.assertEqual(g.numero_curto(1.5), "1.5")
        self.assertEqual(g.numero_curto(1 / 3), "0.3333")
        self.assertEqual(g.numero_curto(0.0), "0")
        self.assertEqual(g.numero_curto(-0.00001), "0")


class TemposNoCompasso(unittest.TestCase):
    """O `timemap` do Verovio: `on`/`off` com ids, `measureOn` no começo de cada compasso, `restsOn`/`restsOff` para as pausas."""

    def test_o_instante_e_relativo_ao_compasso_em_que_a_nota_soa(self):
        tm = [
            {"qstamp": 0, "measureOn": "m1", "on": ["a"]},
            {"qstamp": 1, "off": ["a"], "on": ["b"]},
            {"qstamp": 4, "measureOn": "m2", "off": ["b"], "on": ["c"]},
            {"qstamp": 5.5, "off": ["c"]},
        ]
        self.assertEqual(g.tempos_no_compasso(tm, lambda i: i), {"a": (0, 1), "b": (1, 4), "c": (0, 1.5)})

    def test_a_pausa_tambem_tem_tempo(self):
        tm = [{"qstamp": 0, "measureOn": "m1", "on": ["a"]}, {"qstamp": 1, "off": ["a"], "restsOn": ["p"]}, {"qstamp": 2, "restsOff": ["p"]}]
        self.assertEqual(g.tempos_no_compasso(tm, lambda i: i)["p"], (1, 2))

    def test_na_repeticao_vale_a_primeira_vez_e_a_copia_vira_o_id_do_desenho(self):
        # a copia "a-rend2" so existe no timemap; no desenho a nota e "a". O compasso repetido recomeca em 8.
        tm = [
            {"qstamp": 0, "measureOn": "m1", "on": ["a"]},
            {"qstamp": 2, "off": ["a"]},
            {"qstamp": 8, "measureOn": "m1-rend2", "on": ["a-rend2"]},
            {"qstamp": 9, "off": ["a-rend2"]},
        ]
        real = {"a-rend2": "a"}.get
        self.assertEqual(g.tempos_no_compasso(tm, lambda i: real(i, i)), {"a": (0, 2)})

    def test_nota_que_atravessa_a_barra_tem_fim_maior_que_o_compasso(self):
        tm = [{"qstamp": 0, "measureOn": "m1", "on": ["a"]}, {"qstamp": 4, "measureOn": "m2", "off": ["a"]}]
        self.assertEqual(g.tempos_no_compasso(tm, lambda i: i), {"a": (0, 4)})

    def test_nota_que_nunca_fecha_fica_de_fora(self):
        self.assertEqual(g.tempos_no_compasso([{"qstamp": 0, "measureOn": "m1", "on": ["a"]}], lambda i: i), {})


class MarcarNotas(unittest.TestCase):
    SVG = (
        '<g id="m1" class="measure"><g id="a" class="note"><g class="notehead"></g></g><g id="b" class="note"></g>'
        '<g id="c" class="note"></g><g id="p" class="rest"></g><g id="e" class="note"></g><g id="x" class="notehead"></g></g>'
    )

    def test_poe_data_t_e_data_f_em_notas_e_pausas(self):
        tempos = {"a": (0, 1), "p": (1, 2)}
        svg, n = g.marcar_notas(self.SVG, tempos, [])
        self.assertEqual(n, 2)
        self.assertIn('<g id="a" class="note" data-t="0" data-f="1">', svg)
        self.assertIn('<g id="p" class="rest" data-t="1" data-f="2">', svg)
        # sem tempo: intocado
        self.assertIn('<g id="b" class="note">', svg)

    SVG_LIGADURA = (
        '<g id="m1" class="measure"><g id="a" class="note"></g><g id="t1" class="tie"><path d="M0,0"/></g></g>'
        '<g id="m2" class="measure"><g id="b" class="note"></g><g id="c" class="note"></g><g id="t2" class="tie"></g><g id="t3" class="tie"></g></g>'
    )

    def test_cada_nota_da_ligadura_acende_no_seu_tempo_e_a_curva_leva_o_tempo_da_primeira(self):
        tempos = {"a": (2, 4), "b": (0, 2), "c": (2, 3)}
        svg, n = g.marcar_notas(self.SVG_LIGADURA, tempos, [("t1", "a", "b")])
        self.assertEqual(n, 3)
        self.assertIn('<g id="a" class="note" data-t="2" data-f="4">', svg)
        self.assertIn('<g id="b" class="note" data-t="0" data-f="2">', svg)  # a segunda também acende, no tempo dela
        self.assertIn('<g id="t1" class="tie" data-t="2" data-f="4">', svg)  # a luz corre pela curva enquanto a primeira soa

    def test_ligadura_em_cadeia_tem_uma_curva_para_cada_par(self):
        tempos = {"a": (0, 1), "b": (1, 3), "c": (3, 4)}
        svg, _ = g.marcar_notas(self.SVG_LIGADURA, tempos, [("t1", "a", "b"), ("t2", "b", "c")])
        self.assertIn('<g id="t1" class="tie" data-t="0" data-f="1">', svg)
        self.assertIn('<g id="t2" class="tie" data-t="1" data-f="3">', svg)

    def test_ligadura_partida_pelo_fim_da_linha_divide_o_tempo_entre_os_pedacos(self):
        svg, _ = g.marcar_notas(self.SVG_LIGADURA, {"a": (0, 4), "b": (4, 5)}, [("t2", "a", "b"), ("t3", "a", "b")])
        self.assertIn('<g id="t2" class="tie" data-t="0" data-f="2">', svg)
        self.assertIn('<g id="t3" class="tie" data-t="2" data-f="4">', svg)

    def test_ligadura_sem_tempo_na_primeira_nota_fica_sem_atributos(self):
        svg, _ = g.marcar_notas(self.SVG_LIGADURA, {"b": (0, 2)}, [("t1", "a", "b")])
        self.assertIn('<g id="t1" class="tie">', svg)

    SVG_EXPRESSAO = (
        '<g id="m1" class="measure"><g id="a" class="note"></g><g id="s1" class="slur"><path d="M0,0"/></g></g>'
        '<g id="m2" class="measure"><g id="b" class="note"></g><g id="s2" class="slur"></g><g id="s3" class="slur"></g></g>'
    )

    def test_ligadura_de_expressao_leva_o_tempo_da_nota_que_abre_ate_o_comeco_da_que_fecha(self):
        # a abre em 1 (dura 1), a curva corre até o começo de b, 3 semínimas depois: de 1 a 4 (e não de 1 a 2, o fim de a)
        svg, n = g.marcar_notas(self.SVG_EXPRESSAO, {"a": (1, 2), "b": (0, 1)}, [("s1", "a", "b", 3)])
        self.assertIn('<g id="s1" class="slur" data-t="1" data-f="4">', svg)
        self.assertEqual(n, 2)

    def test_ligadura_de_expressao_partida_pelo_fim_da_linha_divide_o_tempo(self):
        svg, _ = g.marcar_notas(self.SVG_EXPRESSAO, {"a": (0, 1), "b": (0, 1)}, [("s2", "a", "b", 4), ("s3", "a", "b", 4)])
        self.assertIn('<g id="s2" class="slur" data-t="0" data-f="2">', svg)
        self.assertIn('<g id="s3" class="slur" data-t="2" data-f="4">', svg)

    def test_ligadura_de_prolongamento_e_de_expressao_sobre_as_mesmas_notas_nao_dividem_o_tempo(self):
        svg = (
            '<g id="m1" class="measure"><g id="a" class="note"></g><g id="t1" class="tie"></g><g id="s1" class="slur"></g></g>'
            '<g id="m2" class="measure"><g id="b" class="note"></g></g>'
        )
        # a ligadura (a abre em 0 e dura 1,5) e a de expressão (de a até o começo de b, 1,5 depois) cobrem as MESMAS duas notas: cada uma leva o tempo inteiro
        svg, _ = g.marcar_notas(svg, {"a": (0, 1.5), "b": (0, 1)}, [("t1", "a", "b"), ("s1", "a", "b", 1.5)])
        self.assertIn('<g id="t1" class="tie" data-t="0" data-f="1.5">', svg)
        self.assertIn('<g id="s1" class="slur" data-t="0" data-f="1.5">', svg)

    def test_ligadura_de_expressao_sem_duracao_conhecida_fica_sem_atributos(self):
        svg, _ = g.marcar_notas(self.SVG_EXPRESSAO, {"a": (1, 2), "b": (0, 1)}, [])
        self.assertIn('<g id="s1" class="slur">', svg)

    def test_inicios_absolutos_atravessam_a_barra(self):
        tm = [
            {"qstamp": 0, "measureOn": "m1", "on": ["a"]},
            {"qstamp": 4, "measureOn": "m2", "on": ["b"], "off": ["a"]},
            {"qstamp": 6, "restsOn": ["p"], "off": ["b"]},
        ]
        self.assertEqual(g.inicios_absolutos(tm, lambda i: i), {"a": 0, "b": 4, "p": 6})
        self.assertEqual(g.inicios_absolutos(tm, lambda i: {"b": "B"}.get(i, i)), {"a": 0, "B": 4, "p": 6})

    def test_ligadura_em_ciclo_nao_trava(self):
        svg, n = g.marcar_notas(self.SVG_LIGADURA, {"a": (0, 1), "b": (1, 2)}, [("t1", "a", "b"), ("t2", "b", "a")])
        self.assertEqual(n, 2)

    def test_nota_de_enfeite_sem_duracao_nao_acende(self):
        svg, n = g.marcar_notas(self.SVG, {"e": (1, 1)}, [])
        self.assertEqual(n, 0)
        self.assertNotIn("data-t", svg)

    def test_so_marca_g_de_nota_e_pausa(self):
        svg, n = g.marcar_notas(self.SVG, {"x": (0, 1), "m1": (0, 4)}, [])
        self.assertEqual((n, svg), (0, self.SVG))


if __name__ == "__main__":
    sys.exit(0 if unittest.main(exit=False).result.wasSuccessful() else 1)
