//! Framework-independent, read-only CBR/RAR reader.
//!
//! Indexing stores names and archive ordinals only. Each read reopens the archive,
//! skips preceding entries, and returns one image, allowing backward/jump access
//! without caching an entire comic or writing archive paths to disk.
//! Only the returned encoded image buffer is managed here: native UnRAR dictionary
//! allocations and CPU time are not sandboxed. See the crate README for limits.

use std::path::{Path, PathBuf};

/// Zero-based naturally ordered page metadata suitable for IPC serialization.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Page {
    pub index: usize,
    pub name: String,
}

/// Recoverable archive, input, and page-access failures.
#[derive(Debug, thiserror::Error)]
pub enum ComicError {
    #[error("archive path contains a NUL character")]
    InvalidPath,
    #[error("archive error: {0}")]
    Archive(#[from] unrar::error::UnrarError),
    #[error("page declares {size} bytes, exceeding the {limit}-byte limit")]
    PageTooLarge { size: u64, limit: u64 },
    #[error("page index {index} is out of range (page count: {count})")]
    OutOfRange { index: usize, count: usize },
}

/// Core operation result; independent of any UI framework.
pub type Result<T> = std::result::Result<T, ComicError>;

/// A path and page index; owns no native handles and is `Send + 'static`.
#[derive(Debug)]
pub struct ComicDocument {
    path: PathBuf,
    pages: Vec<Page>,
    entries: Vec<usize>,
}

impl ComicDocument {
    /// List image entries without decompressing their payloads.
    /// Supported suffixes: JPEG, PNG, GIF, WebP and BMP (ASCII case-insensitive).
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref().to_path_buf();
        if path.as_os_str().as_encoded_bytes().contains(&0) {
            return Err(ComicError::InvalidPath);
        }
        let archive = unrar::Archive::new(&path).open_for_listing()?;
        let mut listed = Vec::new();
        for (ordinal, header) in archive.enumerate() {
            let header = header?;
            let name = header.filename.to_string_lossy().into_owned();
            let extension = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
            if header.is_file()
                && matches!(
                    extension.as_str(),
                    "jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp"
                )
            {
                listed.push((name, ordinal));
            }
        }
        listed.sort_by(|a, b| {
            natural_cmp(&a.0, &b.0)
                .then_with(|| a.0.cmp(&b.0))
                .then(a.1.cmp(&b.1))
        });
        let entries = listed.iter().map(|item| item.1).collect();
        let pages = listed
            .into_iter()
            .enumerate()
            .map(|(index, (name, _))| Page { index, name })
            .collect();
        Ok(Self {
            path,
            pages,
            entries,
        })
    }
    /// Naturally ordered image entries; `Page::index` is the read index.
    pub fn pages(&self) -> &[Page] {
        &self.pages
    }

    /// Reopen and read one encoded page, rejecting declared sizes above 32 MiB.
    /// No cache or filesystem extraction is used. Reads scan from the beginning;
    /// solid archives can therefore require repeated decompression.
    pub fn read_page(&mut self, index: usize) -> Result<Vec<u8>> {
        self.read_page_limited(index, 32 * 1024 * 1024)
    }

    fn read_page_limited(&mut self, index: usize, max_bytes: u64) -> Result<Vec<u8>> {
        let ordinal = *self.entries.get(index).ok_or(ComicError::OutOfRange {
            index,
            count: self.pages.len(),
        })?;
        let mut archive = unrar::Archive::new(&self.path).open_for_processing()?;
        let mut current = 0;
        while let Some(header) = archive.read_header()? {
            if current == ordinal {
                let size = header.entry().unpacked_size;
                if size > max_bytes {
                    return Err(ComicError::PageTooLarge {
                        size,
                        limit: max_bytes,
                    });
                }
                let (bytes, _) = header.read()?;
                return Ok(bytes);
            }
            archive = header.skip()?;
            current += 1;
        }
        Err(ComicError::OutOfRange {
            index,
            count: self.pages.len(),
        })
    }
}

fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    let (mut a, mut b) = (a.as_bytes(), b.as_bytes());
    while !a.is_empty() && !b.is_empty() {
        let order;
        if a[0].is_ascii_digit() && b[0].is_ascii_digit() {
            let al = a.iter().take_while(|x| x.is_ascii_digit()).count();
            let bl = b.iter().take_while(|x| x.is_ascii_digit()).count();
            let az = a[..al].iter().take_while(|x| **x == b'0').count();
            let bz = b[..bl].iter().take_while(|x| **x == b'0').count();
            let (an, bn) = (&a[az..al], &b[bz..bl]);
            order = an
                .len()
                .cmp(&bn.len())
                .then_with(|| an.cmp(bn))
                .then(al.cmp(&bl));
            a = &a[al..];
            b = &b[bl..];
        } else {
            order = a[0].to_ascii_lowercase().cmp(&b[0].to_ascii_lowercase());
            a = &a[1..];
            b = &b[1..];
        }
        if order != Ordering::Equal {
            return order;
        }
    }
    a.len().cmp(&b.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../hqs/Spider-Gwen 01 (2015) (Marvel Knights SQ-MdHQ).cbr")
    }

    #[test]
    fn opens_real_archive_with_sorted_serializable_page_metadata() {
        let document = ComicDocument::open(sample()).unwrap();
        assert!(!document.pages().is_empty());
        for (index, page) in document.pages().iter().enumerate() {
            assert_eq!(page.index, index);
            assert!(["jpg", "jpeg", "png", "gif", "webp", "bmp"]
                .iter()
                .any(|ext| page.name.to_ascii_lowercase().ends_with(&format!(".{ext}"))));
        }
        assert!(document
            .pages()
            .windows(2)
            .all(|w| natural_cmp(&w[0].name, &w[1].name).is_le()));
        let json = serde_json::to_value(&document.pages()[0]).unwrap();
        assert_eq!(json["index"], 0);
        assert_eq!(json["name"], document.pages()[0].name);
    }

    #[test]
    fn reads_pages_on_demand_with_backward_and_jump_access() {
        fn assert_send_static<T: Send + 'static>() {}
        assert_send_static::<ComicDocument>();
        let mut document = ComicDocument::open(sample()).unwrap();
        let first = document.read_page(0).unwrap();
        assert!(first.starts_with(&[0xff, 0xd8, 0xff]));
        let last = document.read_page(document.pages().len() - 1).unwrap();
        assert!(last.starts_with(&[0xff, 0xd8, 0xff]));
        assert_eq!(document.read_page(0).unwrap(), first);
        assert_ne!(last, first);
    }

    #[test]
    fn out_of_range_page_is_an_error_not_a_panic() {
        let mut document = ComicDocument::open(sample()).unwrap();
        for index in [document.pages().len(), usize::MAX] {
            assert!(
                matches!(document.read_page(index), Err(ComicError::OutOfRange { index: actual, count }) if actual == index && count == document.pages().len())
            );
        }
    }

    #[test]
    fn invalid_paths_return_errors_without_panicking() {
        assert!(ComicDocument::open("invalid\0.cbr").is_err());
        assert!(ComicDocument::open(sample().with_extension("does-not-exist")).is_err());
        assert!(
            ComicDocument::open(Path::new(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml")).is_err()
        );
    }

    #[test]
    fn oversized_page_is_rejected_before_decompression() {
        let mut document = ComicDocument::open(sample()).unwrap();
        assert!(
            matches!(document.read_page_limited(0, 1), Err(ComicError::PageTooLarge { size, limit: 1 }) if size > 1)
        );
        assert!(document
            .read_page(0)
            .unwrap()
            .starts_with(&[0xff, 0xd8, 0xff]));
    }

    #[test]
    fn natural_order_handles_large_numbers_padding_case_and_folders() {
        use std::cmp::Ordering;
        for (a, b) in [
            ("page9.jpg", "page10.jpg"),
            (
                "page999999999999999999999999.jpg",
                "page1000000000000000000000000.jpg",
            ),
            ("page1.jpg", "page01.jpg"),
            ("page0.jpg", "page00.jpg"),
            ("chapter2/page10.jpg", "chapter10/page1.jpg"),
            ("Page2.JPG", "page10.jpg"),
            ("page", "page1"),
        ] {
            assert_eq!(natural_cmp(a, b), Ordering::Less, "{a} < {b}");
            assert_eq!(natural_cmp(b, a), Ordering::Greater);
        }
        assert_eq!(natural_cmp("Page1.JPG", "page1.jpg"), Ordering::Equal);
        assert_eq!(natural_cmp("", ""), Ordering::Equal);
    }

    #[test]
    fn numeric_page_names_sort_naturally() {
        let mut names = ["page10.jpg", "page2.jpg", "page1.jpg"];
        names.sort_by(|a, b| super::natural_cmp(a, b));
        assert_eq!(names, ["page1.jpg", "page2.jpg", "page10.jpg"]);
    }
}
