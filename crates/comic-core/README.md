# comic-core

Framework-independent Rust CBR/RAR reader. No Tauri dependency, no command-line
UnRAR dependency, and no filesystem extraction. `unrar 0.5.8` builds the bundled
native C++ UnRAR library through `unrar_sys` and `cc`.

## API

```rust
use comic_core::{ComicDocument, Page, Result};

fn first_page(path: impl AsRef<std::path::Path>) -> Result<Vec<u8>> {
    let mut comic = ComicDocument::open(path)?;
    let pages: &[Page] = comic.pages();
    // Page { pub index: usize, pub name: String }, zero-based, serde Serialize/Deserialize.
    assert!(!pages.is_empty());
    comic.read_page(0)
}
```

Exact operations:

- `ComicDocument::open(path: impl AsRef<Path>) -> Result<ComicDocument>`
- `ComicDocument::pages(&self) -> &[Page]`
- `ComicDocument::read_page(&mut self, index: usize) -> Result<Vec<u8>>`
- `Result<T> = std::result::Result<T, ComicError>`
- Errors: `InvalidPath`, `Archive(unrar::error::UnrarError)`,
  `PageTooLarge { size: u64, limit: u64 }`, `OutOfRange { index: usize, count: usize }`.

The document contains only path/name/index data, so it is `Send + 'static` without
unsafe trait implementations. Native handles exist only inside an operation.
Call these blocking operations on a worker thread, not the UI thread.

## Ordering, memory, and limitations

- Image suffix filter: jpg/jpeg/png/gif/webp/bmp, ASCII case-insensitive.
  Indexing does not decompress image payloads or verify their signatures.
- Full internal names are naturally ordered using digit runs, without integer
  parsing/overflow. Numeric ties use shorter zero padding first; case ties use
  original names then archive ordinals, for deterministic ordering.
- Each requested page is reopened and streamed past preceding headers. Only one
  encoded image is returned; no entire-comic buffer or persistent page cache.
- Declared uncompressed page sizes over 32 MiB are rejected before `read()`.
  This is not a global process-memory sandbox: native dictionary/work buffers,
  metadata, Vec capacity overhead, malformed archives and caller-retained pages
  are not covered by that page-size limit. The high-level dependency does not
  expose a per-callback byte cap. Untrusted-archive hardening would need native
  callback/dictionary limits and/or a resource-limited worker process.
- Repeated reads are O(archive position); solid archives may repeat significant
  decompression. The caller must keep the source file unchanged for document life.
- Missing/invalid archives and native CRC/decompression errors propagate. No
  password UI or multipart-volume workflow is implemented.
- Archive entry paths are display metadata only. No archive path is joined to
  a disk destination, and no extraction API is called.
- Empty image lists are possible; the inspect CLI rejects them.
- Verified on WSL/Linux and Windows x86-64. Android runtime support is not claimed.
  The workspace vendors `unrar_sys 0.5.8` with a small Windows cross-build patch:
  target-aware source/link selection, case-sensitive paths, and clang-cl SIMD
  attributes. See `../../vendor/unrar_sys/LELE-PATCH.md`. Native Windows builds
  need MSVC C++ build tools and a Windows SDK.

## Verification

```sh
cargo test -p comic-core --all-targets
cargo clippy -p comic-core --all-targets -- -D warnings
cargo run -p comic-core --example inspect -- hqs
```

Tests intentionally use the actual read-only fixtures at repository `hqs/`.
RED-to-GREEN was exercised before implementing natural ordering, archive indexing,
page reads, out-of-range handling, NUL-path handling, declared-size rejection,
image-signature recognition and the all-archives inspector. Extra natural-order
edge tests were added as regression coverage after the initial green cycle.

The inspector recognizes signatures, reads every page sequentially and again in
reverse, and checks five additional jumps per archive against the first pass's
length/hash. It stores only small fingerprints between reads. This is a signature
and native archive-CRC smoke test, not a full image-decoder validation.

Verified fixture results:

| Archive | Pages | Encoded page bytes | Largest page bytes |
| --- | ---: | ---: | ---: |
| Spider-Gwen 01 | 36 | 28169693 | 1379032 |
| Spider-Gwen 02 | 28 | 39262908 | 2736024 |
| Spider-Gwen 03 | 26 | 24598104 | 1231840 |
| Spider-Gwen 04 | 23 | 35032815 | 3762924 |
| Spider-Gwen 05 | 21 | 24670559 | 1975528 |

Inspector total: 5 archives, 134 distinct pages/signatures, 151734079 encoded bytes;
all reverse and jump checks passed. Nine tests (7 library + 2 example) passed.

## Licensing

The Rust `unrar`/`unrar_sys` wrappers declare MIT OR Apache-2.0. The bundled native
UnRAR code has a separate restrictive freeware license, including a prohibition
on recreating RAR compression. It is not simply MIT/Apache and may be unsuitable
for distributions requiring exclusively OSI-approved dependencies. Review the
included `UNRAR-LICENSE.txt` and preserve applicable notices when packaging.
