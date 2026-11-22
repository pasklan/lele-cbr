use std::path::{Path, PathBuf};

/// Platform boundary: only this layer knows about filesystem paths.
#[derive(Debug, Clone)]
pub struct LocalDocument {
    pub path: PathBuf,
    pub title: String,
}

pub fn list_documents(directory: &Path) -> Result<Vec<LocalDocument>, String> {
    let mut documents = Vec::new();
    for entry in
        std::fs::read_dir(directory).map_err(|e| format!("Biblioteca indisponível: {e}"))?
    {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_file()
            && path
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("cbr"))
        {
            documents.push(LocalDocument {
                title: path
                    .file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned(),
                path: path.canonicalize().map_err(|e| e.to_string())?,
            });
        }
    }
    documents.sort_by_key(|a| a.title.to_lowercase());
    Ok(documents)
}

pub fn discover_library(start: &Path) -> Option<PathBuf> {
    start
        .ancestors()
        .map(|dir| dir.join("hqs"))
        .find(|dir| dir.is_dir())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_library_from_a_nested_executable_directory() {
        let start = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let found = discover_library(&start).expect("find hqs in project ancestors");
        assert_eq!(
            found.canonicalize().unwrap(),
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../hqs")
                .canonicalize()
                .unwrap()
        );
    }

    #[test]
    fn lists_the_five_real_comics_in_title_order() {
        let directory = Path::new(env!("CARGO_MANIFEST_DIR")).join("../hqs");
        let comics = list_documents(&directory).expect("read sample library");
        assert_eq!(comics.len(), 5);
        assert!(comics[0].title.starts_with("Spider-Gwen 01"));
        assert!(comics[4].title.starts_with("Spider-Gwen 05"));
        assert!(comics.iter().all(|comic| comic.path.is_absolute()));
    }
}
