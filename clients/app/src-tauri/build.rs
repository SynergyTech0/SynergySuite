fn main() {
    println!("cargo:rerun-if-env-changed=SYNERGY_SERVER");
    // Declaring the app's own commands puts them behind the capability files, so only the
    // bundled launcher page can call them. Suite pages loaded from the server get no IPC.
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
            "get_state",
            "set_server",
            "open_app",
        ])),
    )
    .expect("failed to run tauri-build");
}
