// Desktop shell for Duke Nutanix: a native window around the web game in dist/.
// The updater plugin checks the GitHub Releases for a newer signed version
// (see js/update.js); the process plugin relaunches the game after an update.
// No console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .run(tauri::generate_context!())
        .expect("error while running Duke Nutanix");
}
