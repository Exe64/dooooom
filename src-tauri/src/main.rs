// Desktop shell for Duke Nutanix: a native window around the web game in dist/.
// No console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Duke Nutanix");
}
