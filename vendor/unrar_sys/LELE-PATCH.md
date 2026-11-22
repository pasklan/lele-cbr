# Local patch to unrar_sys 0.5.8

This vendored copy retains upstream licenses, including the native UnRAR restriction on recreating RAR compression. Review vendor/unrar/license.txt and the top-level notices before redistribution.

Changes for WSL-to-Windows MSVC compilation:

- build.rs selects Windows sources and import libraries using CARGO_CFG_TARGET_OS and CARGO_CFG_TARGET_ENV, not the host's cfg. Includes isnt.cpp for a Windows target and links advapi32 explicitly so standalone core consumers do not depend on Tauri to supply that import library.
- build.rs tracks vendor/unrar changes for rebuilds.
- os.hpp uses lowercase Windows header and pragma library names, compatible with case-sensitive cross-build filesystems and ordinary Windows builds.
- rijndael.hpp, blake2s_sse.cpp and rs16.hpp also enable per-function target attributes for __clang__. clang-cl does not define __GNUC__, but requires the AES/SSSE3 annotations. This preserves runtime CPU dispatch instead of enabling those instruction sets globally.

Native extraction/compression algorithms were not changed. The Windows inspector and native Tauri UI were exercised using the local fixtures; Android remains unverified.
