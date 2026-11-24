use crate::storage::{list_documents, LocalDocument};
use serde::Serialize;
use std::path::Path;

#[derive(Clone, Serialize)]
pub struct ComicSummary {
    pub id: String,
    pub title: String,
}
#[derive(Clone, Serialize)]
pub struct PageInfo {
    pub index: usize,
    pub name: String,
}
#[derive(Clone, Serialize)]
pub struct ComicInfo {
    pub id: String,
    pub title: String,
    pub pages: Vec<PageInfo>,
}

pub struct Reader {
    library: Vec<LocalDocument>,
    library_directory: Option<std::path::PathBuf>,
    selected: Vec<LocalDocument>,
    active: Option<(String, comic_core::ComicDocument)>,
}
impl Reader {
    pub fn new(directory: Option<&Path>) -> Result<Self, String> {
        Ok(Self {
            library: directory
                .map(list_documents)
                .transpose()?
                .unwrap_or_default(),
            library_directory: directory.map(Path::to_path_buf),
            selected: Vec::new(),
            active: None,
        })
    }
    pub fn refresh(&mut self) -> Result<(), String> {
        let mut library = self
            .library_directory
            .as_deref()
            .map(list_documents)
            .transpose()?
            .unwrap_or_default();
        for item in &self.selected {
            if item.path.is_file() && !library.iter().any(|source| source.path == item.path) {
                library.push(item.clone());
            }
        }
        library.sort_by_key(|source| source.title.to_lowercase());
        self.library = library;
        Ok(())
    }

    pub fn list(&self) -> Vec<ComicSummary> {
        self.library
            .iter()
            .map(|item| ComicSummary {
                id: item.path.to_string_lossy().into_owned(),
                title: item.title.clone(),
            })
            .collect()
    }
    pub fn open(&mut self, id: &str) -> Result<ComicInfo, String> {
        let source = self
            .library
            .iter()
            .find(|item| item.path.to_string_lossy() == id)
            .ok_or("Documento não autorizado. Abra arquivos externos pelo seletor.")?;
        let document = comic_core::ComicDocument::open(&source.path).map_err(|e| e.to_string())?;
        let info = ComicInfo {
            id: id.to_owned(),
            title: source.title.clone(),
            pages: document
                .pages()
                .iter()
                .map(|page| PageInfo {
                    index: page.index,
                    name: page.name.clone(),
                })
                .collect(),
        };
        self.active = Some((info.id.clone(), document));
        Ok(info)
    }
    pub fn open_selected(&mut self, path: &Path) -> Result<ComicInfo, String> {
        let path = path.canonicalize().map_err(|e| e.to_string())?;
        if !path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("cbr"))
        {
            return Err("Esta POC abre apenas arquivos CBR.".into());
        }
        let id = path.to_string_lossy().into_owned();
        if !self.library.iter().any(|source| source.path == path) {
            let source = LocalDocument {
                title: path
                    .file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned(),
                path,
            };
            self.selected.push(source.clone());
            self.library.push(source);
        }
        self.open(&id)
    }
    /// Called only after a native file-drop event, never exposed as an IPC command.
    pub fn authorize_drop(&mut self, paths: &[std::path::PathBuf]) -> Result<ComicSummary, String> {
        let [path] = paths else {
            return Err("Solte apenas um arquivo CBR por vez.".into());
        };
        let path = path
            .canonicalize()
            .map_err(|e| format!("Não foi possível acessar o arquivo: {e}"))?;
        if !path.is_file()
            || !path
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("cbr"))
        {
            return Err("Solte um arquivo CBR válido, não uma pasta ou outro formato.".into());
        }
        let document = comic_core::ComicDocument::open(&path).map_err(|e| e.to_string())?;
        if document.pages().is_empty() {
            return Err("Este CBR não contém imagens compatíveis.".into());
        }
        let summary = ComicSummary {
            id: path.to_string_lossy().into_owned(),
            title: path
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
        };
        if !self.library.iter().any(|source| source.path == path) {
            let source = LocalDocument {
                path,
                title: summary.title.clone(),
            };
            self.selected.push(source.clone());
            self.library.push(source);
        }
        Ok(summary)
    }

    pub fn read_page(&mut self, document_id: &str, index: usize) -> Result<Vec<u8>, String> {
        let (id, document) = self.active.as_mut().ok_or("Nenhum quadrinho aberto.")?;
        if id != document_id {
            return Err("O quadrinho ativo mudou. Selecione novamente a página.".into());
        }
        document.read_page(index).map_err(|e| e.to_string())
    }
    pub fn close(&mut self) {
        self.active = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_drop_authorizes_one_valid_cbr_without_switching_the_active_book() {
        let directory = Path::new(env!("CARGO_MANIFEST_DIR")).join("../hqs");
        let samples = list_documents(&directory).unwrap();
        let mut reader = Reader::new(None).unwrap();
        let first = reader.open_selected(&samples[0].path).unwrap();
        let dropped = reader.authorize_drop(&[samples[1].path.clone()]).unwrap();
        assert_eq!(dropped.id, samples[1].path.to_string_lossy());
        assert!(!reader.read_page(&first.id, 0).unwrap().is_empty());
        let second = reader.open(&dropped.id).unwrap();
        assert!(!reader.read_page(&second.id, 0).unwrap().is_empty());
    }

    #[test]
    fn native_drop_rejects_multiple_invalid_and_missing_sources() {
        let directory = Path::new(env!("CARGO_MANIFEST_DIR")).join("../hqs");
        let sample = list_documents(&directory).unwrap().remove(0).path;
        let mut reader = Reader::new(None).unwrap();
        for paths in [
            vec![],
            vec![sample.clone(), sample.clone()],
            vec![directory],
            vec![sample.with_extension("missing.cbr")],
            vec![Path::new(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml")],
        ] {
            assert!(reader.authorize_drop(&paths).is_err());
        }
        assert!(reader.list().is_empty());
    }

    #[test]
    fn refresh_rescans_added_removed_files_and_reports_directory_errors() {
        let directory = Path::new(env!("CARGO_MANIFEST_DIR")).join(format!(
            "../target/test-fixtures/library-refresh-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let mut reader = Reader::new(Some(&directory)).unwrap();
        assert!(reader.list().is_empty());
        let file = directory.join("novo.cbr");
        std::fs::write(&file, []).unwrap();
        reader.refresh().unwrap();
        assert_eq!(reader.list().len(), 1);
        std::fs::remove_file(file).unwrap();
        reader.refresh().unwrap();
        assert!(reader.list().is_empty());
        std::fs::remove_dir(&directory).unwrap();
        assert!(reader.refresh().is_err());
    }

    #[test]
    fn native_selection_opens_a_document_without_a_library() {
        let directory = Path::new(env!("CARGO_MANIFEST_DIR")).join("../hqs");
        let selected = list_documents(&directory).unwrap().remove(0);
        let mut reader = Reader::new(None).unwrap();
        assert!(reader.open(&selected.path.to_string_lossy()).is_err());
        let info = reader.open_selected(&selected.path).unwrap();
        assert!(!reader.read_page(&info.id, 0).unwrap().is_empty());
        reader.close();
        assert!(reader.read_page(&info.id, 0).is_err());
    }

    #[test]
    fn rejects_stale_ids_and_out_of_bounds_pages() {
        let directory = Path::new(env!("CARGO_MANIFEST_DIR")).join("../hqs");
        let mut reader = Reader::new(Some(&directory)).unwrap();
        let comics = reader.list();
        let first = reader.open(&comics[0].id).unwrap();
        let second = reader.open(&comics[1].id).unwrap();
        assert!(reader.read_page(&first.id, 0).is_err());
        assert!(reader.read_page(&second.id, second.pages.len()).is_err());
    }

    #[test]
    fn opens_a_real_book_and_serves_binary_image_bytes() {
        let directory = Path::new(env!("CARGO_MANIFEST_DIR")).join("../hqs");
        let mut reader = Reader::new(Some(&directory)).unwrap();
        let summary = reader.list().remove(0);
        let info = reader.open(&summary.id).unwrap();
        assert!(!info.pages.is_empty());
        assert_eq!(info.pages[0].index, 0);
        let bytes = reader.read_page(&info.id, 0).unwrap();
        assert!(bytes.starts_with(&[0xff, 0xd8, 0xff]) || bytes.starts_with(b"\x89PNG\r\n\x1a\n"));
    }
}
