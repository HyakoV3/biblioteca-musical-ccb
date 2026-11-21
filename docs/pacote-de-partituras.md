# Pacote de partituras

As partituras são **opcionais**, como os sons gravados: o app baixa um pacote do servidor em **Ajustes → Partituras → Baixar** (decisão do
responsável, 2026-11-16: o botão "Importar hinário" vai deixar de existir e as partituras ganham um botão automático, no molde dos sons).
O pacote é um `.zip` só com `partituras/hino-<número>.svg` e, opcional, `partituras/hino-<número>-paisagem.svg` (formato e verificações em [`FORMATO.md`](FORMATO.md), seção "Importar").

> **Direitos.** As partituras são geradas das transcrições do Enéias (`eneiasramos/ccb-hinario-5-do`, "todos os direitos reservados", sem
> licença); a autorização dele **ainda não veio**. **Publicar o pacote num link público é distribuir esse trabalho**: o mecanismo está pronto,
> mas quem decide quando (e se) publicar é o responsável, depois da resposta dele. Enquanto não houver pacote publicado, o manifesto
> do app fica `"pacote": null` e o botão Baixar **não aparece**.

## Estado publicado (2026-11-21)

- **`partituras-007.zip`** (19.438.311 bytes, **18,5 MiB**, SHA-256 `3b70e4f8…5ec0`): **os 480 hinos**, retrato e paisagem (960 SVG). Igual ao 006 em tudo (notas, pausas, ligaduras de prolongamento e compassos: conferido
  hino a hino contra o 006), **mais o tempo das ligaduras de expressão** (`<g class="slur">`): 1.460 curvas em 402 arquivos, todas com `data-t` e `data-f`. Era o defeito do hino 55 (e de outros): as curvas inclinadas
  entre notas de alturas diferentes ficavam sem animação, enquanto as retas entre notas iguais animavam. Conferido: 960 arquivos, 0 sem tempo, 960 SVG aceitos pela limpeza do app, a montagem reproduz o mesmo SHA-256, subido à pasta
  do servidor e baixado pelo link público com o mesmo SHA-256 (o app extrai o zip da pasta pelo nome). É o que o manifesto do app aponta (a partir do **APK 069**). Os 006 e anteriores **ficam**, para os APKs que apontam para eles.
  **Para ver a animação num aparelho que já tem as partituras:** Ajustes → Remover e Baixar de novo (o Remover do hinário apaga também as partituras).

## Estado publicado (2026-11-20)

- **Pasta no servidor:** `/mnt/downloads/BibliotecaMusicalPartituras/` (compartilhamento próprio, fora da dos sons). Tem **quatro** zips:
  - `partituras-006.zip` (19.432.692 bytes, **18,5 MiB**, SHA-256 `72deea5a…609c`): igual ao 005 (cada nota no seu tempo, curvas com tempo; tempo das notas e das curvas **idêntico** nos 480 hinos), mas **sem a marca de
    andamento do autor** ("♪ = 112 - 144"), que o gerador tira do MusicXML. Conferido: 960 arquivos, 0 sem tempo, 960 SVG aceitos pela limpeza do app, nenhum `g.tempo` com texto, baixado pelo link público com o mesmo
    SHA-256. É o que o manifesto do app aponta (a partir do APK 046).
  - `partituras-005.zip` (19.591.413 bytes, **18,7 MiB**, SHA-256 `74d58792…714d`): **os 480 hinos**, retrato e paisagem (960 SVG), com a marca de andamento do autor (escondida pelo app), gerados pelo gerador da `main` depois da PR #94, então
    **cada nota leva o seu tempo, inclusive a segunda de uma ligadura**, e a curva da ligadura (`<g class="tie">`) leva o `data-t`/`data-f` da nota que a abre: é por ela que a luz corre
    (`docs/FORMATO.md`). Conferido: 960 arquivos, 0 sem tempo, 960 SVG aceitos pela limpeza do app, 3.302 das 3.306 curvas com tempo (as 4 sem tempo são de nota sem duração), baixado
    pelo link público com o mesmo SHA-256. Foi o que o manifesto apontou do **APK 041** ao 045; o final separado e o botão de andamento não mudam o pacote. **Fica**, para esses APKs.
  - `partituras-004.zip` (19.594.338 bytes, SHA-256 `f717a7ed…b916`): os 480 hinos do pacote anterior, em que a **segunda nota da ligadura não leva tempo** e a primeira tem o fim somado.
    **Fica**, para os APKs 036 a 040.
  - `partituras-003.zip` (228.343 bytes, SHA-256 `f39cbe13…9087`): as **5 partituras de teste**, sem tempo por nota; o dos APKs 023 a 035. **Fica**, para esses APKs.
- **Instalar as 480 no celular pede o hinário de 480** (o app só aceita partituras de hinos que o hinário instalado tem); com o hinário de 5 hinos, entram só as 5 e as outras são recusadas.

## Estado de 2026-11-19 (pacote 004)

- O manifesto apontava para o `partituras-004.zip` (19.594.338 bytes, SHA-256 `f717a7ed…b916`): os 480 hinos, gerados com o gerador da PR #82 (cada nota e pausa com `data-t` e `data-f`).
  Ele continua no servidor.

## Estado anterior (2026-11-16)

- **Pasta no servidor:** `/mnt/downloads/BibliotecaMusicalPartituras/`, **fora** da dos sons (`BibliotecaMusicalSons/`, renomeada pelo responsável depois do
  upgrade do File Browser para a 2.0.2; o link dos sons continuou valendo e conferido). Compartilhamento próprio (a pedido do responsável, que criou a pasta
  e o link). Tem **só um** zip:
  - `partituras-003.zip` (228.343 bytes, SHA-256 `f39cbe13…9087`): **sem letra, com duas versões de cada hino**: retrato (largura 700, ~1,6 compasso
    por linha) e paisagem (1200, ~3 compassos por linha), o do APK 023 em diante. É o que o manifesto do app aponta.

  Os anteriores foram **apagados em 2026-11-16, a pedido do responsável**, então os **APKs 020 a 022 não conseguem mais baixar partituras** (o
  link não traz mais o zip que eles procuram). O 001 tinha letra e largura 700; o 002, sem letra e largura 500, que deu 1 compasso por linha
  ("cortando", no relato do responsável), motivo do 003. Eram zips reproduzíveis: dá para regerar de `content/amostras` com `tools/gerar-partituras.py`
  (as larguras estão no cabeçalho dele) e `tools/montar-pacote.py`.
- **Link do app:** `https://fb.hm.hv2.xyz/public/api/resources/download?hash=<hash do compartilhamento>`, no manifesto do app. Conferido contra os bytes
  reais do servidor: o zip da pasta traz o `BibliotecaMusicalPartituras/partituras-003.zip`, e o app extrai esse zip e confere o tamanho e o SHA-256 do manifesto (verificado de novo depois de apagar o 001 e o 002).
- **O link está no manifesto, que está no repositório público:** quem lê o código pode baixar as 5 partituras de teste. É o mesmo que já acontece com
  o link dos sons, mas com um agravante: as partituras são das transcrições do Enéias, cuja autorização ainda não veio (ver "Direitos" acima). Antes
  de publicar o conjunto completo, esperar a resposta dele.

## Configuração do compartilhamento (File Browser)

O link precisa ser **anônimo, sem senha e sem validade** (o app não sabe pedir senha, e um link que expira quebraria o download) e **só de baixar**.
Restringir o resto, na tela do File Browser (editar o compartilhamento): desligar upload/criar, editar, apagar e substituir; desligar miniaturas,
visualização e o visualizador de arquivos; esconder a barra lateral, o cartão de compartilhamento e a opção de login. Conferido pela API pública
(2026-11-16): ambos os links já têm a barra lateral e o cartão de compartilhamento escondidos; faltava, nas partituras, esconder a opção de login e,
nos sons, desligar o visualizador. O `config.yaml` do contêiner já dá aos usuários novos **só** a permissão de baixar e não permite cadastro.

## Gerar e publicar

```sh
# 1. SVG de cada hino, SEM a letra, em DUAS versões: retrato (largura 700) e paisagem (1200), cada uma com o seu timemap
#    (precisa do MuseScore 4 e do pacote Python verovio; ver tools/gerar-partituras.py; --so-retrato pula a paisagem)
python3 tools/gerar-partituras.py <pasta dos hino-N.mscx> <pasta dos svg>

# 2. o zip (só partituras/hino-N.svg e hino-N-paisagem.svg, reproduzível; os timemap não entram)
python3 tools/montar-pacote.py <pasta dos svg> partituras-NNN.zip

# 3. no servidor de arquivos (o mesmo dos sons): uma pasta PRÓPRIA, fora de BibliotecaMusicalSons/, com o zip dentro, e o link público só dela;
#    depois o manifesto do app, com o nome, o tamanho e o SHA-256 do zip
python3 tools/montar-manifesto-partituras.py <link público da pasta> partituras-NNN.zip
```

**Conferir um pacote real antes de publicar (sem celular):** o teste `conteudo_real` do `src-tauri/src/pacote.rs` passa o hinário e o zip **reais** pelo mesmo leitor e pela mesma limpeza de SVG do app, e falha se alguma partitura for recusada ou não puder ser lida de volta (retrato e paisagem):

```sh
BM_HINARIO=/caminho/hinario.json BM_ZIP=/caminho/partituras-NNN.zip \
  cargo test --manifest-path src-tauri/Cargo.toml --lib conteudo_real -- --ignored --nocapture
```

**Pasta própria, fora de `BibliotecaMusicalSons/`:** o link público do File Browser baixa a **pasta inteira em zip** (não há download de arquivo
avulso por esse tipo de link). Se o zip das partituras ficasse dentro de `BibliotecaMusicalSons/` (a pasta dos sons), o download dos sons o traria
junto e o das partituras traria os 38 MB de sons. Numa pasta só dele, o servidor entrega uma pasta em zip com o `partituras-001.zip` dentro; o app
a abre, acha o zip **pelo nome**, e confere o **tamanho e o SHA-256 do zip de dentro** (o de fora não é reproduzível). Se o link for do próprio
arquivo, o app também aceita (usa o que veio, se bater).

O passo 3 escreve `src/lib/partituras/manifesto.json`; **o app só instala um arquivo com exatamente aquele tamanho e SHA-256**. Mudou o zip no
servidor, refaça o manifesto e gere um APK novo (a atualização automática, sem APK novo, é a ideia I-25 em
[`roadmap-ideas.md`](roadmap-ideas.md)). O endereço precisa estar no servidor que o app pode acessar: `src-tauri/capabilities/default.json`
(hoje só `https://fb.hm.hv2.xyz/*`).

## Como o app instala

1. Baixa o zip pelo lado nativo (plugin HTTP do Tauri), com progresso.
2. Confere o **tamanho** e o **SHA-256** contra o manifesto; se não bater, descarta (`erro de arquivo`) e nada vai ao Rust.
3. Entrega ao Rust como **base64** (no Android não há corpo binário), que confere nomes, limites e **cada SVG** (lista de permitidos), grava
   numa pasta de preparo e troca a pasta `partituras/` de uma vez; o hinário não é tocado.
4. As partituras recusadas na verificação do SVG aparecem no card (hinos e o primeiro motivo); o resto entra.

**Pré-requisito:** o hinário já instalado. Sem ele a instalação é recusada ("Importe o hinário antes de instalar as partituras"), porque os
números de hino aceitos vêm dele.

## Remover

**Ajustes → Partituras → Remover** apaga só as partituras; o hinário fica.
