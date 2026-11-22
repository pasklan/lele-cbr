# Leitor Lelê — prova de conceito Windows

Leitor local de CBR com React + TypeScript, Tauri 2 e core Rust independente da interface. Os cinco arquivos originais de `hqs/` são amostras locais: não são redistribuídos nem incluídos no executável.

## Escopo

- Biblioteca local em `hqs/`, ao lado da pasta `artifacts/`.
- Abrir CBR pelo seletor nativo.
- Navegar por páginas, saltar para uma página e ajustar visualização.
- Entregar as imagens por resposta IPC binária, sem Base64 em JSON.
- Processamento de arquivos fora da thread da interface.

Android não faz parte desta POC. O adaptador atual usa caminhos locais; uma URI Android exigirá outro adaptador e validação em dispositivo.

## Executar no Windows

Quando `artifacts/LeitorLele.exe` estiver disponível, dê dois cliques em `abrir-windows.cmd`. O launcher aponta a biblioteca para a pasta `hqs/` deste projeto. O aplicativo requer Microsoft Edge WebView2 Runtime.

Também é possível abrir o executável diretamente. A biblioteca é procurada nas pastas ancestrais do executável e no diretório de trabalho. `LELE_LIBRARY_DIR` permite indicar outra pasta. Sem biblioteca encontrada, use o seletor de arquivo.

Ao mover o aplicativo, preserve esta disposição:

    leitor_lele/
      abrir-windows.cmd
      artifacts/LeitorLele.exe
      hqs/*.cbr

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

O último comando exercita o serviço sem exigir bibliotecas gráficas do Linux. Os testes de integração usam `hqs/`; mantenha as cinco amostras para reproduzi-los.

## Limites da POC

Sem sincronização, favoritos ou persistência do progresso. Não é um visualizador de PDF. RARs com senha ou volumes múltiplos não têm fluxo de interface dedicado. Arquivos sólidos podem exigir leitura das entradas anteriores para alcançar uma página; desempenho em arquivos grandes precisa ser medido. As dependências de RAR e seus avisos de licença devem acompanhar qualquer distribuição.

O build inicial não é assinado e não instala o aplicativo. O Windows pode apresentar aviso de reputação ao executar software não assinado; a POC não desativa proteções do sistema.

## Resultado da validação

O executável `artifacts/LeitorLele.exe` foi compilado para Windows x86-64 MSVC a partir do WSL e executado no Windows real, com WebView2. Não foi apenas um teste em navegador com backend simulado.

- Core: 9 testes; serviço/armazenamento: 6; interface: 7, todos passando.
- Inspetor compilado para Windows: cinco arquivos, 134 páginas extraídas e verificadas por assinatura/CRC, com leituras em ordem, reversas e saltos. Isso não equivale à decodificação visual de cada imagem.
- Interface nativa: os cinco livros abriram e exibiram imagens decodificadas; primeira/última, avançar/voltar, Home/End, limites de navegação, ajuste à largura, zoom, navegação rápida e fechamento passaram sem exceções JavaScript.
- O seletor nativo também abriu o primeiro CBR, com imagem exibida, em teste separado.
- SHA-256 dos cinco CBRs originais: preservados.
- `npm audit`: nenhuma vulnerabilidade reportada. Isso não é uma auditoria de segurança das dependências Rust/nativas.

Evidências locais: `artifacts/windows-smoke.json`, `artifacts/windows-core.txt`, `artifacts/windows-reader.png` e `artifacts/build-windows.log`. Os avisos LNK4099 do build referem-se a símbolos de depuração ausentes das bibliotecas Microsoft; a compilação terminou com sucesso.

## Compilação cruzada no WSL

`scripts/build-windows-wsl.sh` requer cargo-xwin, Rust com target `x86_64-pc-windows-msvc`, clang-cl 19 ou posterior, LLVM LLD/resource tools e SDK/CRT Microsoft em cache. A configuração usada nesta sessão ficou temporariamente em `/home/pasklan/.hermes/cache/scratch/lele-toolchain`; não é uma instalação permanente de Rust no Windows.

    LELE_TOOLCHAIN=/home/pasklan/.hermes/cache/scratch/lele-toolchain bash scripts/build-windows-wsl.sh

O SDK/CRT está sujeito aos termos Microsoft. O script de build não instala ferramentas. O workspace usa uma cópia local corrigida de `unrar_sys`; detalhes e alterações em `vendor/unrar_sys/LELE-PATCH.md`.

Para repetir o smoke test, inicie o aplicativo num ambiente de teste com `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223` e execute com Node.js no Windows:

    node scripts/windows-smoke.mjs http://127.0.0.1:9223 artifacts

Feche essa instância ao terminar. O launcher normal não habilita porta de depuração. O smoke test usa IPC real, não intercepta respostas do backend.
