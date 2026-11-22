use crate::{
    reader::{ComicInfo, ComicSummary, Reader},
    storage::discover_library,
};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::{ipc::Response, State};
use tauri_plugin_dialog::DialogExt;

type SharedReader = Arc<Mutex<Reader>>;

async fn with_reader<T: Send + 'static>(
    state: SharedReader,
    operation: impl FnOnce(&mut Reader) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut reader = state
            .lock()
            .map_err(|_| "O serviço de leitura foi interrompido.".to_owned())?;
        operation(&mut reader)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn list_library(state: State<'_, SharedReader>) -> Result<Vec<ComicSummary>, String> {
    with_reader(state.inner().clone(), |reader| {
        reader.refresh()?;
        Ok(reader.list())
    })
    .await
}

#[tauri::command]
async fn open_comic(id: String, state: State<'_, SharedReader>) -> Result<ComicInfo, String> {
    with_reader(state.inner().clone(), move |reader| reader.open(&id)).await
}

#[tauri::command]
async fn read_page(
    document_id: String,
    index: usize,
    state: State<'_, SharedReader>,
) -> Result<Response, String> {
    with_reader(state.inner().clone(), move |reader| {
        reader.read_page(&document_id, index)
    })
    .await
    .map(Response::new)
}

#[tauri::command]
async fn close_comic(state: State<'_, SharedReader>) -> Result<(), String> {
    with_reader(state.inner().clone(), |reader| {
        reader.close();
        Ok(())
    })
    .await
}

#[tauri::command]
async fn pick_comic(
    app: tauri::AppHandle,
    state: State<'_, SharedReader>,
) -> Result<Option<ComicInfo>, String> {
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Abrir quadrinho CBR")
            .add_filter("Quadrinho RAR", &["cbr"])
            .blocking_pick_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|_| {
        "A origem não é um arquivo local. O adaptador Android ainda não está implementado."
            .to_owned()
    })?;
    with_reader(state.inner().clone(), move |reader| {
        reader.open_selected(&path).map(Some)
    })
    .await
}

fn library_directory() -> Option<PathBuf> {
    std::env::var_os("LELE_LIBRARY_DIR")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::current_exe()
                .ok()
                .and_then(|exe| exe.parent().and_then(discover_library))
        })
        .or_else(|| {
            std::env::current_dir()
                .ok()
                .and_then(|cwd| discover_library(&cwd))
        })
}

pub fn run() {
    let directory = library_directory();
    let reader = Reader::new(directory.as_deref()).unwrap_or_else(|error| {
        eprintln!("{error}");
        Reader::new(None).expect("empty library")
    });
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Arc::new(Mutex::new(reader)))
        .invoke_handler(tauri::generate_handler![
            list_library,
            open_comic,
            read_page,
            close_comic,
            pick_comic
        ])
        .run(tauri::generate_context!())
        .expect("Não foi possível iniciar o Leitor Lelê");
}
