use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri_plugin_dialog::DialogExt;

#[derive(Debug, Serialize, Deserialize)]
struct FilePayload {
    path: String,
    content: String,
}

#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    fs::write(PathBuf::from(path), content).map_err(|error| error.to_string())
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(PathBuf::from(path)).map_err(|error| error.to_string())
}

#[tauri::command]
async fn open_project_dialog(app: tauri::AppHandle) -> Result<Option<FilePayload>, String> {
    let Some(path) = app
        .dialog()
        .file()
        .add_filter("CodeTrail project", &["codetrail.json", "json"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };

    let path_buf = path
        .as_path()
        .ok_or_else(|| "Selected path is not available on this platform.".to_string())?
        .to_path_buf();
    let content = fs::read_to_string(&path_buf).map_err(|error| error.to_string())?;

    Ok(Some(FilePayload {
        path: path_buf.to_string_lossy().to_string(),
        content,
    }))
}

#[tauri::command]
async fn save_file_dialog(app: tauri::AppHandle, default_name: String) -> Result<Option<String>, String> {
    let path = app
        .dialog()
        .file()
        .set_file_name(&default_name)
        .blocking_save_file();

    Ok(path.and_then(|file_path| file_path.as_path().map(|path| path.to_string_lossy().to_string())))
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            open_project_dialog,
            save_file_dialog,
            read_text_file,
            write_text_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running CodeTrail");
}
