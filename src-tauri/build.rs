fn main() {
    let mut windows_attributes = tauri_build::WindowsAttributes::new();

    // 读取你的 app.manifest 文件
    windows_attributes = windows_attributes.app_manifest(include_str!("app.manifest"));

    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows_attributes))
        .expect("failed to run tauri-build");
}