# Leitor Lelê — prova de conceito Windows

Leitor local de CBR com React + TypeScript, Tauri 2 e core Rust independente da interface. Os cinco arquivos originais de `hqs/` são amostras locais: não são redistribuídos nem incluídos no executável.

## Escopo

- Biblioteca local em `hqs/`, ao lado da pasta `artifacts/`.
- Abrir CBR pelo seletor nativo.
- Navegar por páginas, saltar para uma página e ajustar visualização.
- Entregar as imagens por resposta IPC binária, sem Base64 em JSON.
- Processamento de arquivos fora da thread da interface.
- Controles maiores, biblioteca recolhível e tela cheia por F11 (Esc para sair).
- Retomada da última página por arquivo e preferências de visualização salvas localmente.
- Abertura por arrastar e soltar um CBR na janela, com validação no backend.

Android não faz parte desta POC. O adaptador atual usa caminhos locais; uma URI Android exigirá outro adaptador e validação em dispositivo.

## Executar no Windows

Quando `artifacts/LeitorLele.exe` estiver disponível, dê dois cliques em `abrir-windows.cmd`. O launcher aponta a biblioteca para a pasta `hqs/` deste projeto. O aplicativo requer Microsoft Edge WebView2 Runtime.

Também é possível abrir o executável diretamente. A biblioteca é procurada nas pastas ancestrais do executável e no diretório de trabalho. `LELE_LIBRARY_DIR` permite indicar outra pasta. Sem biblioteca encontrada, use o seletor de arquivo.

Ao mover o aplicativo, preserve esta disposição:

    leitor_lele/
      abrir-windows.cmd
      artifacts/LeitorLele.exe
      hqs/*.cbr

## Pacote portátil

O pacote gerado fica em `artifacts/LeleCBR-Windows-v0.2.0.zip`. Extraia todo o ZIP e abra `LeleCBR/abrir.cmd` ou `LeleCBR/LeitorLele.exe`. Ele contém instruções, avisos de licença e checksums, mas nenhum quadrinho. Você pode colocar seus próprios CBRs na pasta `hqs/` ou usar o seletor de arquivo. O pacote não é um instalador e não registra associação de arquivos.

Para gerar o ZIP a partir do executável já compilado (Python 3 e Cargo no PATH):

    python scripts/package_windows.py

O progresso fica no armazenamento local do WebView2, identificado pelo caminho do documento. Reabra o mesmo arquivo para retomar; renomear ou mover pode criar outro registro. As preferências incluem ajuste à página/largura, zoom e biblioteca recolhida. Nenhum progresso é sincronizado com serviços externos.

## Compilar nativamente no Windows

Pré-requisitos: Node.js com npm, Rust MSVC, Visual Studio C++ Build Tools com Windows SDK e WebView2. Execute `compilar-windows.cmd`. O script não instala ferramentas do sistema. Usa `pushd` para permitir execução a partir de um caminho UNC do WSL.

Para desenvolvimento, em um terminal Windows na pasta do projeto:

    npm ci
    npm run tauri -- dev

## Organização

    src/                     Interface React e adaptador IPC
    src-tauri/src/reader.rs  Serviço de aplicação e documento ativo
    src-tauri/src/storage.rs Adaptador de arquivos locais
    src-tauri/src/desktop.rs Comandos e inicialização Tauri
    crates/comic-core/        Leitura de arquivos RAR e ordenação de páginas

A interface recebe metadados e identificadores. O core não depende do Tauri. Apenas a camada de armazenamento conhece a origem local. A POC não tenta converter URIs Android em caminhos Windows.

## Testes

    npm test
    npm run build
    cargo test -p comic-core
    cargo test -p leitor-lele --lib --no-default-features
    python -m unittest discover -s scripts/tests -v

O comando Cargo com `--no-default-features` exercita o serviço sem exigir bibliotecas gráficas do Linux. Os testes Python usam um executável Windows real já compilado em `artifacts/`. Os testes de integração usam `hqs/`; mantenha as cinco amostras para reproduzi-los.

## Limites da POC

Sem sincronização ou favoritos. O progresso é local, sem backup/exportação nesta versão. Não é um visualizador de PDF. RARs com senha ou volumes múltiplos não têm fluxo de interface dedicado. Arquivos sólidos podem exigir leitura das entradas anteriores para alcançar uma página; desempenho em arquivos grandes precisa ser medido. As dependências de RAR e seus avisos de licença devem acompanhar qualquer distribuição.

O build inicial não é assinado e não instala o aplicativo. O Windows pode apresentar aviso de reputação ao executar software não assinado; a POC não desativa proteções do sistema.

## Validação inicial (v0.1.0)

O executável `artifacts/LeitorLele.exe` foi compilado para Windows x86-64 MSVC a partir do WSL e executado no Windows real, com WebView2. Não foi apenas um teste em navegador com backend simulado.

- Core: 9 testes; serviço/armazenamento: 6; interface: 7, todos passando.
- Inspetor compilado para Windows: cinco arquivos, 134 páginas extraídas e verificadas por assinatura/CRC, com leituras em ordem, reversas e saltos. Isso não equivale à decodificação visual de cada imagem.
- Interface nativa: os cinco livros abriram e exibiram imagens decodificadas; primeira/última, avançar/voltar, Home/End, limites de navegação, ajuste à largura, zoom, navegação rápida e fechamento passaram sem exceções JavaScript.
- O seletor nativo também abriu o primeiro CBR, com imagem exibida, em teste separado.
- SHA-256 dos cinco CBRs originais: preservados.
- `npm audit`: nenhuma vulnerabilidade reportada. Isso não é uma auditoria de segurança das dependências Rust/nativas.

Evidências locais: `artifacts/windows-smoke.json`, `artifacts/windows-core.txt`, `artifacts/windows-reader.png` e `artifacts/build-windows.log`. Os avisos LNK4099 do build referem-se a símbolos de depuração ausentes das bibliotecas Microsoft; a compilação terminou com sucesso.

## Validação da v0.2.0

- 22 testes de interface/estado/estilo, 8 do serviço/armazenamento, 9 do core e 3 do empacotamento passaram; build TypeScript/Vite e Clippy do serviço também passaram.
- O executável Windows exibiu novamente os cinco quadrinhos e passou no smoke de navegação.
- No WebView2 nativo, fonte raiz e controle de página mediram 16 px, setas 30 px e alvos 44 × 44 px. O layout passou em 1280 × 900 e 760 × 540, incluindo fatores de escala 1,25 e 1,5 emulados por CDP; isso não altera a configuração de DPI do Windows.
- F11, Esc e o botão alternaram o estado nativo de tela cheia. A biblioteca foi recolhida sem mudar esse estado.
- Páginas 7 e 3 de dois quadrinhos foram restauradas independentemente, incluindo zoom/ajuste, após fechar e iniciar outro processo com o mesmo perfil isolado de teste. O histórico normal do usuário não foi apagado.
- A autorização de drops reais recebidos pelo backend é coberta por testes Rust; o transporte de eventos até a interface foi exercitado no aplicativo nativo. O gesto físico de arrastar do Explorer não foi automatizado nesta rodada.
- O runtime C/C++ é vinculado estaticamente pelo target MSVC. A tabela de imports do executável foi conferida por um teste Python e por LLVM, sem `MSVCP140.dll`, `VCRUNTIME*.dll` ou `CONCRT*.dll`. Isso não equivale a uma validação em VM Windows limpa.
- O ZIP exato foi extraído e executado no Windows com biblioteca vazia. O seletor nativo abriu um CBR externo e o aplicativo exibiu a imagem; a versão do executável foi lida como 0.2.0. Arquivos e checksums do pacote foram conferidos, sem HQs incluídas.

Evidências: `artifacts/windows-usability.json`, `artifacts/windows-usability-restart.json`, `artifacts/windows-package-smoke.json`, `artifacts/windows-reader-v0.2.0.png` e `artifacts/build-windows-v0.2.0.log`.

## Compilação cruzada no WSL

`scripts/build-windows-wsl.sh` requer cargo-xwin, Rust com target `x86_64-pc-windows-msvc`, clang-cl 19 ou posterior, LLVM LLD/resource tools e SDK/CRT Microsoft em cache. O script procura opcionalmente uma toolchain local em `$HOME/.local/share/lele-toolchain`; `LELE_TOOLCHAIN` permite indicar outro diretório com `env.sh`. Isso não instala Rust no Windows.

    bash scripts/build-windows-wsl.sh

Esse script também gera o pacote portátil após compilar. Os caches de SDK devem ficar em um diretório de dependências durável, não em uma pasta temporária sujeita a limpeza.

A configuração `.cargo/config.toml` habilita `+crt-static` para Windows MSVC, inclusive no código C++ compilado por cc-rs. Em `tauri.conf.json`, `build.windows.staticVCRuntime=false` desativa somente o shim híbrido do Tauri, evitando conflito com o vínculo totalmente estático escolhido pelo Cargo. Não remova essa combinação sem conferir novamente os imports do executável.

O SDK/CRT está sujeito aos termos Microsoft. O script de build não instala ferramentas. O workspace usa uma cópia local corrigida de `unrar_sys`; detalhes e alterações em `vendor/unrar_sys/LELE-PATCH.md`.

Para repetir o smoke test, inicie o aplicativo num ambiente de teste com `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223` e execute com Node.js no Windows:

    node scripts/windows-smoke.mjs http://127.0.0.1:9223 artifacts

Feche essa instância ao terminar. O launcher normal não habilita porta de depuração. O smoke test usa IPC real, não intercepta respostas do backend.
