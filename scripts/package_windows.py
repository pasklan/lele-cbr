"""Package only explicitly selected files; never include private HQ fixtures."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import struct
import zipfile


USER_GUIDE = """LELE CBR - Windows (prova de conceito)

1. Extraia o ZIP inteiro para uma pasta de sua escolha.
2. Abra abrir.cmd ou LeitorLele.exe.
3. Use Abrir quadrinho ou solte um arquivo CBR na janela.

A pasta hqs pode receber seus arquivos locais; nenhum quadrinho acompanha o pacote.

A interface tem controles maiores, zoom e ajuste a pagina/largura. O leitor salva
localmente a ultima pagina de cada arquivo e as preferencias de visualizacao.
Reabra o mesmo arquivo para continuar. Se mover ou renomear o arquivo, o leitor
pode reconhece-lo como outro documento. O progresso fica no perfil local do
WebView2; nao e sincronizado nem acompanha o ZIP.

Use o botao da biblioteca para recolher a barra lateral. F11 alterna tela cheia;
Esc sai da tela cheia. Setas esquerda/direita e Home/End navegam pelas paginas.

Requisitos: Windows x64 e Microsoft Edge WebView2 Runtime. O executavel nao e
assinado. Este pacote nao instala servicos, nao inclui Android nem PDF/CBZ,
e nao altera protecoes do Windows. Arquivos com senha ou em multiplos volumes
nao possuem fluxo dedicado. O uso com arquivos muito grandes/solidos ainda
precisa de mais medidas de desempenho. Evite arquivos de origem desconhecida.

Nao ha atualizador automatico ou associacao de arquivos nesta versao.
Consulte UNRAR-LICENSE.txt e THIRD-PARTY-NOTICES.json antes de redistribuir.
"""


def build_package(root: Path, executable: Path, output: Path) -> Path:
    root, executable, output = root.resolve(), executable.resolve(), output.resolve()
    executable_bytes = executable.read_bytes()
    if len(executable_bytes) < 64 or executable_bytes[:2] != b"MZ":
        raise ValueError("Expected a Windows x64 PE executable")
    pe_offset = struct.unpack_from("<I", executable_bytes, 60)[0]
    if (pe_offset + 6 > len(executable_bytes)
            or executable_bytes[pe_offset:pe_offset + 4] != b"PE\x00\x00"
            or struct.unpack_from("<H", executable_bytes, pe_offset + 4)[0] != 0x8664):
        raise ValueError("Expected a Windows x64 PE executable")
    metadata = json.loads(subprocess.check_output([
        "cargo", "metadata", "--locked", "--offline", "--format-version", "1",
        "--filter-platform", "x86_64-pc-windows-msvc",
    ], cwd=root, text=True))
    inventory = {
        "description": "Cargo dependency license inventory for the Windows target, including build dependencies. Not a legal audit.",
        "packages": sorted([
            {key: item.get(key) for key in ("name", "version", "license", "repository")}
            for item in metadata["packages"]
        ], key=lambda item: (item["name"], item["version"])),
    }
    files = {
        "LeitorLele.exe": executable_bytes,
        "abrir.cmd": b'@echo off\r\nsetlocal\r\nset "LELE_LIBRARY_DIR=%~dp0hqs"\r\nstart "" "%~dp0LeitorLele.exe"\r\n',
        "LEIA-ME.txt": USER_GUIDE.encode("utf-8"),
        "UNRAR-LICENSE.txt": (root / "crates/comic-core/UNRAR-LICENSE.txt").read_bytes(),
        "THIRD-PARTY-NOTICES.json": json.dumps(inventory, ensure_ascii=False, indent=2).encode("utf-8"),
    }
    files["SHA256SUMS.txt"] = "".join(
        f"{hashlib.sha256(data).hexdigest()}  {name}\n" for name, data in sorted(files.items())
    ).encode("utf-8")
    output.parent.mkdir(parents=True, exist_ok=True)
    partial = output.with_suffix(output.suffix + ".partial")
    try:
        with zipfile.ZipFile(partial, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for name, data in files.items():
                archive.writestr("LeleCBR/" + name, data)
            archive.writestr("LeleCBR/hqs/", b"")
        partial.replace(output)
    finally:
        partial.unlink(missing_ok=True)
    return output


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    version = json.loads((root / "package.json").read_text())["version"]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--exe", type=Path, default=root / "artifacts/LeitorLele.exe")
    parser.add_argument("--output", type=Path, default=root / f"artifacts/LeleCBR-Windows-v{version}.zip")
    args = parser.parse_args()
    result = build_package(root, args.exe, args.output)
    print(result)
    print("SHA-256:", hashlib.sha256(result.read_bytes()).hexdigest())


if __name__ == "__main__":
    main()
