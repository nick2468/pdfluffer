// The Tauri host (spec 10.3, 10.4 and 20.3): six commands, single instance and the plugins.

mod files;
mod ocr;
mod paths;

use percent_encoding::percent_decode_str;
use std::path::Path;
use std::sync::Mutex;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{Emitter, Manager, State};

/// Files the operating system asked us to open at launch. `take_pending_files` empties it.
struct PendingFiles(Mutex<Vec<String>>);

// Off the main thread, so a large file does not freeze the window.
#[tauri::command(async)]
fn read_pdf(path: String) -> Result<Response, String> {
    files::read_pdf_bytes(Path::new(&path)).map(Response::new)
}

// Off the main thread, so a large file does not freeze the window.
#[tauri::command(async)]
fn write_pdf(request: Request) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("io: expected raw bytes".to_owned());
    };
    let headers = request.headers();
    let path = headers
        .get("x-path")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| percent_decode_str(value).decode_utf8().ok())
        .ok_or_else(|| "io: bad x-path header".to_owned())?;
    let backup = headers.get("x-backup").is_some_and(|value| value.as_bytes() == b"1");
    files::write_atomic(Path::new(path.as_ref()), bytes, backup)
}

// Off the main thread: recognising a page takes a moment, and the picture is large.
#[tauri::command(async)]
fn ocr_image(request: Request) -> Result<ocr::OcrPageResult, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("ocr: expected raw bytes".to_owned());
    };
    ocr::recognise(bytes)
}

#[tauri::command]
fn ocr_status() -> ocr::OcrStatus {
    ocr::status()
}

#[tauri::command]
fn normalise_paths(paths: Vec<String>) -> Vec<String> {
    paths.iter().filter_map(|p| paths::normalise(Path::new(p))).collect()
}

#[tauri::command]
fn take_pending_files(state: State<PendingFiles>) -> Vec<String> {
    std::mem::take(&mut *state.0.lock().unwrap_or_else(|e| e.into_inner()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let args: Vec<String> = std::env::args_os().map(|a| a.to_string_lossy().into_owned()).collect();
    let cwd = std::env::current_dir().unwrap_or_default();
    let pending = paths::parse_pdf_args(&args, &cwd);

    tauri::Builder::default()
        // Single instance must be registered first. The callback runs in the running app
        // when a second launch happens (spec 10.4).
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            let paths = paths::parse_pdf_args(&args, Path::new(&cwd));
            if !paths.is_empty() {
                let _ = app.emit("open-files", paths);
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .manage(PendingFiles(Mutex::new(pending)))
        .invoke_handler(tauri::generate_handler![
            read_pdf,
            write_pdf,
            normalise_paths,
            take_pending_files,
            ocr_image,
            ocr_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
