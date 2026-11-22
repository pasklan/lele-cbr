//! Read-only archive smoke test: cargo run -p comic-core --example inspect -- hqs
use comic_core::ComicDocument;
use std::path::{Path, PathBuf};

type Error = Box<dyn std::error::Error>;

#[derive(Debug)]
struct Report {
    pages: usize,
    bytes: usize,
    max_page: usize,
    first: String,
    last: String,
}

fn inspect(path: &Path) -> Result<Report, Error> {
    use std::hash::{Hash, Hasher};
    let mut document = ComicDocument::open(path)?;
    let pages = document.pages().len();
    if pages == 0 {
        return Err(format!("{} has no image pages", path.display()).into());
    }
    let first = document.pages()[0].name.clone();
    let last = document.pages()[pages - 1].name.clone();
    let mut fingerprints = Vec::with_capacity(pages);
    let (mut bytes, mut max_page) = (0, 0);
    for index in 0..pages {
        let data = document.read_page(index)?;
        if signature(&data).is_none() {
            return Err(format!(
                "{} page {index} ({}) has no recognized image signature",
                path.display(),
                document.pages()[index].name
            )
            .into());
        }
        let mut hash = std::collections::hash_map::DefaultHasher::new();
        data.hash(&mut hash);
        fingerprints.push((data.len(), hash.finish()));
        bytes += data.len();
        max_page = max_page.max(data.len());
    }
    // Every page again in reverse, then explicit far jumps; keep only one page in RAM.
    for index in (0..pages)
        .rev()
        .chain([pages - 1, 0, pages / 2, pages - 1, 0])
    {
        let data = document.read_page(index)?;
        let mut hash = std::collections::hash_map::DefaultHasher::new();
        data.hash(&mut hash);
        if signature(&data).is_none() || fingerprints[index] != (data.len(), hash.finish()) {
            return Err(format!(
                "{} page {index} changed on backward/jump read",
                path.display()
            )
            .into());
        }
    }
    Ok(Report {
        pages,
        bytes,
        max_page,
        first,
        last,
    })
}

fn signature(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("jpeg")
    } else if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("png")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("gif")
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Some("webp")
    } else if bytes.starts_with(b"BM") {
        Some("bmp")
    } else {
        None
    }
}

fn main() -> Result<(), Error> {
    let arguments: Vec<PathBuf> = std::env::args_os().skip(1).map(PathBuf::from).collect();
    if arguments.is_empty() {
        return Err("usage: inspect <archive.cbr|directory> [...]".into());
    }
    let mut paths = Vec::new();
    for argument in arguments {
        if argument.is_dir() {
            for entry in std::fs::read_dir(argument)? {
                let path = entry?.path();
                if path
                    .extension()
                    .is_some_and(|ext| ext.eq_ignore_ascii_case("cbr"))
                {
                    paths.push(path);
                }
            }
        } else {
            paths.push(argument);
        }
    }
    paths.sort();
    if paths.is_empty() {
        return Err("no CBR archives found".into());
    }
    let (mut total_pages, mut total_bytes) = (0, 0);
    for path in &paths {
        let report = inspect(path)?;
        println!(
            "{}: pages={} verified={} bytes={} max_page={} backward=OK jumps=OK",
            path.file_name().unwrap_or_default().to_string_lossy(),
            report.pages,
            report.pages,
            report.bytes,
            report.max_page
        );
        println!("  first={}\n  last={}", report.first, report.last);
        total_pages += report.pages;
        total_bytes += report.bytes;
    }
    println!(
        "TOTAL archives={} pages={} verified={} bytes={}",
        paths.len(),
        total_pages,
        total_pages,
        total_bytes
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_supported_signatures_and_rejects_non_images() {
        for (bytes, format) in [
            (&b"\xff\xd8\xffrest"[..], "jpeg"),
            (&b"\x89PNG\r\n\x1a\nrest"[..], "png"),
            (&b"GIF87arest"[..], "gif"),
            (&b"GIF89arest"[..], "gif"),
            (&b"RIFF1234WEBPrest"[..], "webp"),
            (&b"BMrest"[..], "bmp"),
        ] {
            assert_eq!(signature(bytes), Some(format));
        }
        for bytes in [
            &b""[..],
            &b"text"[..],
            &b"RIFF1234WAVE"[..],
            &b"\xff\xd8"[..],
        ] {
            assert_eq!(signature(bytes), None);
        }
    }

    #[test]
    fn verifies_every_page_of_all_five_actual_archives() {
        let directory = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../hqs");
        let mut paths: Vec<_> = std::fs::read_dir(directory)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|path| {
                path.extension()
                    .is_some_and(|ext| ext.eq_ignore_ascii_case("cbr"))
            })
            .collect();
        paths.sort();
        assert_eq!(paths.len(), 5);
        for path in paths {
            let report = inspect(&path).unwrap();
            assert!(report.pages > 0);
            assert!(report.bytes >= report.max_page);
            assert!(report.max_page > 0);
        }
    }
}
