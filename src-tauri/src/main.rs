#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod download;
mod plugins;
mod updater;
mod usb_api;

use plugins::{disable_plugin, download_plugin, enable_plugin, get_plugin_files, update_plugin};
use tauri::Manager;
use updater::{download_update, get_app_download_status, install_update};
use std::process::Command;
use std::path::Path;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            download_update,
            get_app_download_status,
            install_update,
            download_plugin,
            update_plugin,
            get_plugin_files,
            enable_plugin,
            disable_plugin,
            check_boot_drive,
            check_all_boot_drives,
            get_all_drives,
            read_boot_drive_version,
            get_drive_info,
            download_file_to_path,
            open_link_os,
            usb_api::get_usb_devices,
            usb_api::get_system_boot_mode,
            usb_api::deploy_to_usb,
            usb_api::restart_app,
            usb_api::close_app,
            install_ventoy,
            get_current_username,
            check_mica_support,
            check_transparency_enabled,
            open_devtools,
            exit_app
        ])
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();
            window.hide().unwrap();
    
            let exe_path = std::env::current_exe().map_err(|e| format!("获取exe路径失败: {}", e))?;
            let app_dir = exe_path.parent().ok_or("无法获取exe父目录")?.to_path_buf();
            let ventoy_exe = format!("{}\\ventoy\\Ventoy2Disk.exe", app_dir.display());
    
            if !Path::new(&ventoy_exe).exists() {
                use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
        
                app.dialog()
                    .message("软件已损坏，请到官网重新下载")
                    .title("软件启动时遇到错误")
                    .kind(MessageDialogKind::Error)
                    .blocking_show();
        
                std::process::exit(0);
            }
    
            window.show().unwrap();

            #[cfg(debug_assertions)]
            {
                window.open_devtools();
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn check_mica_support() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        use winapi::um::winnt::RTL_OSVERSIONINFOW;
        use winapi::shared::ntdef::NTSTATUS;
        use winapi::shared::ntstatus::STATUS_SUCCESS;

        unsafe {
            let mut osvi: RTL_OSVERSIONINFOW = std::mem::zeroed();
            osvi.dwOSVersionInfoSize = std::mem::size_of::<RTL_OSVERSIONINFOW>() as u32;

            let ntdll = winapi::um::libloaderapi::GetModuleHandleA(b"ntdll.dll\0".as_ptr() as *const i8);
            if ntdll.is_null() {
                return Err("无法加载 ntdll.dll".to_string());
            }

            let rtl_get_version = winapi::um::libloaderapi::GetProcAddress(
                ntdll,
                b"RtlGetVersion\0".as_ptr() as *const i8,
            );

            if rtl_get_version.is_null() {
                return Err("无法找到 RtlGetVersion 函数".to_string());
            }

            let rtl_get_version: extern "system" fn(*mut RTL_OSVERSIONINFOW) -> NTSTATUS =
                std::mem::transmute(rtl_get_version);

            let status = rtl_get_version(&mut osvi);
            if status == STATUS_SUCCESS {
                let is_windows_11 = osvi.dwMajorVersion >= 10 && osvi.dwBuildNumber >= 22621;
                Ok(is_windows_11)
            } else {
                Err("获取系统版本失败".to_string())
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(false)
    }
}

#[tauri::command]
fn check_transparency_enabled() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        use winapi::um::winreg::*;
        use winapi::um::winnt::*;
        use winapi::shared::minwindef::*;
        use winapi::shared::winerror::*;

        unsafe {
            let mut key: HKEY = std::ptr::null_mut();
            let key_path = "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize\0";

            let result = RegOpenKeyExA(
                HKEY_CURRENT_USER,
                key_path.as_ptr() as *const i8,
                0,
                KEY_READ,
                &mut key,
            );

            if result == ERROR_SUCCESS as i32 {
                let mut value: DWORD = 1;
                let mut size = std::mem::size_of::<DWORD>() as DWORD;
                let value_name = "EnableTransparency\0";

                let query_result = RegQueryValueExA(
                    key,
                    value_name.as_ptr() as *const i8,
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    &mut value as *mut DWORD as *mut BYTE,
                    &mut size,
                );

                RegCloseKey(key);

                if query_result == ERROR_SUCCESS as i32 {
                    Ok(value != 0)
                } else {
                    Ok(true)
                }
            } else {
                Err("无法打开注册表键".to_string())
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(false)
    }
}

#[tauri::command]
fn get_current_username() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        use std::env;
        match env::var("USERNAME") {
            Ok(username) => Ok(username),
            Err(_) => {
                use std::process::Command;
                match Command::new("whoami").output() {
                    Ok(output) => {
                        let username = String::from_utf8_lossy(&output.stdout)
                            .trim()
                            .split('\\')
                            .last()
                            .unwrap_or("用户")
                            .to_string();
                        Ok(username)
                    }
                    Err(_) => Ok("用户".to_string()),
                }
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        use std::env;
        match env::var("USER") {
            Ok(username) => Ok(username),
            Err(_) => Ok("用户".to_string()),
        }
    }
}

#[tauri::command]
fn exit_app() {
    std::process::exit(0);
}

#[tauri::command]
fn open_link_os(url: String) -> Result<(), String> {
    Command::new("explorer.exe")
        .arg(url)
        .spawn()
        .map_err(|e| format!("无法在外部浏览器中打开链接: {}", e))?;
    Ok(())
}

#[tauri::command]
async fn install_ventoy(physical_drive: u32, boot_mode: String) -> Result<String, String> {
    use std::path::Path;

    println!("获取应用程序安装目录...");
    let exe_path = std::env::current_exe().map_err(|e| format!("获取exe路径失败: {}", e))?;

    let app_dir = exe_path.parent().ok_or("无法获取exe父目录")?.to_path_buf();

    println!("应用程序安装目录: {}", app_dir.display());

    let ventoy_exe = format!("{}\\ventoy\\Ventoy2Disk.exe", app_dir.display());

    if !Path::new(&ventoy_exe).exists() {
        return Err("Ventoy程序不存在，请确保已正确安装".to_string());
    }

    let mut args = vec![
        "VTOYCLI".to_string(),
        "/I".to_string(),
        format!("/PhyDrive:{}", physical_drive),
        "/NOUSBCheck".to_string(),
    ];

    if boot_mode.to_uppercase() == "UEFI" {
        args.push("/GPT".to_string());
    }

    println!("执行Ventoy安装命令: {} {:?}", ventoy_exe, args);

    match Command::new(ventoy_exe).args(&args).output() {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);

            println!("Ventoy安装输出: {}", stdout);
            if !stderr.is_empty() {
                println!("Ventoy安装错误: {}", stderr);
            }

            if output.status.success() {
                tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
                Ok("Ventoy安装成功".to_string())
            } else {
                Err(format!("Ventoy安装失败: {}", stderr))
            }
        }
        Err(e) => Err(format!("执行Ventoy命令失败: {}", e)),
    }
}

#[tauri::command]
async fn check_boot_drive() -> Result<Option<BootDriveInfo>, String> {
    use std::path::Path;
    let drives = get_all_drives().await?;
    for drive in drives {
        let config_path = format!("{}\\cloud-pe\\config.json", drive);
        let iso_path = format!("{}\\Cloud-PE.iso", drive);

        if Path::new(&config_path).exists() && Path::new(&iso_path).exists() {
            match read_boot_drive_version(drive.clone()).await {
                Ok(version) => {
                    return Ok(Some(BootDriveInfo {
                        letter: drive,
                        version,
                        is_boot_drive: true,
                    }));
                }
                Err(_) => continue,
            }
        }
    }
    Ok(None)
}

#[tauri::command]
async fn check_all_boot_drives() -> Result<Vec<BootDriveInfo>, String> {
    use std::path::Path;
    let mut boot_drives = Vec::new();
    let drives = get_all_drives().await?;
    
    for drive in drives {
        let config_path = format!("{}\\cloud-pe\\config.json", drive);
        let iso_path = format!("{}\\Cloud-PE.iso", drive);

        if Path::new(&config_path).exists() && Path::new(&iso_path).exists() {
            match read_boot_drive_version(drive.clone()).await {
                Ok(version) => {
                    boot_drives.push(BootDriveInfo {
                        letter: drive,
                        version,
                        is_boot_drive: true,
                    });
                }
                Err(_) => continue,
            }
        }
    }
    
    Ok(boot_drives)
}

#[tauri::command]
async fn get_drive_info(drive_letter: String) -> Result<GetDriveInfo, String> {
    use std::path::Path;

    let config_path = format!("{}\\cloud-pe\\config.json", drive_letter);
    let iso_path = format!("{}\\Cloud-PE.iso", drive_letter);

    let is_boot_drive = Path::new(&config_path).exists() && Path::new(&iso_path).exists();

    Ok(GetDriveInfo {
        letter: drive_letter,
        is_boot_drive,
    })
}

#[derive(serde::Serialize)]
struct GetDriveInfo {
    letter: String,
    #[serde(rename = "isBootDrive")]
    is_boot_drive: bool,
}

#[tauri::command]
async fn get_all_drives() -> Result<Vec<String>, String> {
    use std::fs;

    let mut drives = Vec::new();

    for letter in b'A'..=b'Z' {
        let drive = format!("{}:", letter as char);
        let path = format!("{}\\", drive);

        if fs::metadata(&path).is_ok() {
            drives.push(drive);
        }
    }

    Ok(drives)
}

#[derive(serde::Serialize, serde::Deserialize)]
struct BootDriveInfo {
    letter: String,
    version: String,
    #[serde(rename = "is_boot_drive")]
    is_boot_drive: bool,
}

#[tauri::command]
async fn read_boot_drive_version(drive_letter: String) -> Result<String, String> {
    use serde_json::Value;
    use std::fs;

    let config_path = format!("{}\\cloud-pe\\config.json", drive_letter);

    match fs::read_to_string(&config_path) {
        Ok(content) => match serde_json::from_str::<Value>(&content) {
            Ok(json) => {
                if let Some(pe) = json.get("pe") {
                    if let Some(version) = pe.get("version") {
                        if let Some(version_str) = version.as_str() {
                            Ok(version_str.to_string())
                        } else {
                            Err("版本信息格式错误".to_string())
                        }
                    } else {
                        Err("未找到版本信息".to_string())
                    }
                } else {
                    Err("配置文件格式错误".to_string())
                }
            }
            Err(e) => Err(format!("解析JSON失败: {}", e)),
        },
        Err(e) => Err(format!("读取配置文件失败: {}", e)),
    }
}

#[tauri::command]
async fn download_file_to_path(
    app: tauri::AppHandle,
    url: String,
    save_path: String,
    thread: Option<u16>,
) -> Result<String, String> {
    let thread_count = thread.unwrap_or(8);

    match download::download_file_with_progress(app, url, save_path, thread_count).await {
        Ok(file_path) => Ok(file_path),
        Err(e) => Err(format!("下载失败: {}", e)),
    }
}

use std::{env};

#[tauri::command]
fn open_devtools(app_handle: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app_handle.get_webview_window("main") {
        window.open_devtools();
        Ok(())
    } else {
        Err("无法找到主窗口".to_string())
    }
}
