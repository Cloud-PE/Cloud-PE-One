use anyhow::Result;
use encoding_rs::GBK;
use std::fs::{self, File};
use std::io::{self, Write};
use std::path::Path;
use std::process::Command;
use zip::ZipArchive;
use tauri::{command, AppHandle};
use crate::download::{download_update_package, get_update_download_status, DownloadStatus};


fn extract_archive(
    archive_path: &str,
    extract_dir: &str,
) -> Result<()> {
    println!("开始解压文件...");
    println!("压缩包路径: {}", archive_path);
    println!("解压目标目录: {}", extract_dir);

    let extract_path = Path::new(extract_dir);
    if !extract_path.exists() {
        fs::create_dir_all(extract_path)?;
        println!("已创建解压目标目录");
    }

    let file = File::open(archive_path)?;
    let mut archive = ZipArchive::new(file)?;

    let total_files = archive.len();
    println!("压缩包中共有 {} 个文件", total_files);

    for i in 0..total_files {
        let mut file = archive.by_index(i)?;
        let outpath = match file.enclosed_name() {
            Some(path) => extract_path.join(path),
            None => continue,
        };

        if file.name().ends_with('/') {
            fs::create_dir_all(&outpath)?;
            continue;
        }

        if let Some(p) = outpath.parent() {
            if !p.exists() {
                fs::create_dir_all(&p)?;
            }
        }

        let mut outfile = File::create(&outpath)?;
        io::copy(&mut file, &mut outfile)?;

        if (i + 1) % 10 == 0 || i + 1 == total_files {
            println!(
                "解压进度: {}/{} ({:.1}%)",
                i + 1,
                total_files,
                ((i + 1) as f64 / total_files as f64) * 100.0
            );
        }
    }

    println!("文件解压完成！");
    println!("解压后的文件位于: {}", extract_dir);

    println!("\n解压后的主要内容:");
    if let Ok(entries) = fs::read_dir(extract_dir) {
        for entry in entries.flatten().take(10) {
            if let Ok(file_name) = entry.file_name().into_string() {
                let file_type = if entry.path().is_dir() {
                    "[目录]"
                } else {
                    "[文件]"
                };
                println!("  {} {}", file_type, file_name);
            }
        }
    }

    Ok(())
}

fn create_update_script(
    app_dir: &str,
    tmp_dir: &str,
    app_name: &str,
) -> Result<String> {
    println!("开始创建更新脚本...");
    let script_path = Path::new(app_dir).join("tmpAppUpdata.bat");

    let mut script_content = String::new();

    #[cfg(target_os = "windows")]
    {
        script_content.push_str("@echo off\r\n");
        script_content.push_str("echo ==========================================\r\n");
        script_content.push_str("echo 开始执行应用程序更新...\r\n");
        script_content.push_str("echo ==========================================\r\n");
        script_content.push_str("echo.\r\n");
        script_content.push_str("echo [步骤1/5] 等待应用程序关闭...\r\n");
        script_content.push_str("timeout /t 2 /nobreak > nul\r\n");
        script_content.push_str("echo [完成] 应用程序已关闭\r\n");
        script_content.push_str("echo.\r\n");

        script_content.push_str("echo [步骤2/5] 清理旧版本文件...\r\n");
        script_content.push_str("for /d %%i in (*) do if not \"%%i\"==\"tmpFile\" (\r\n");
        script_content.push_str("    echo   删除目录: %%i\r\n");
        script_content.push_str("    rd /s /q \"%%i\"\r\n");
        script_content.push_str(")\r\n");

        script_content.push_str("for %%i in (*) do if not \"%%i\"==\"tmpAppUpdata.bat\" (\r\n");
        script_content.push_str("    echo   删除文件: %%i\r\n");
        script_content.push_str("    del \"%%i\"\r\n");
        script_content.push_str(")\r\n");
        script_content.push_str("echo [完成] 旧版本文件已清理\r\n");
        script_content.push_str("echo.\r\n");

        script_content.push_str("echo [步骤3/5] 安装新版本文件...\r\n");
        script_content.push_str(&format!("echo   源目录: {}\r\n", tmp_dir));
        script_content.push_str(&format!("echo   目标目录: {}\r\n", app_dir));
        script_content.push_str(&format!(
            "xcopy /e /y \"{}\\*\" \"{}\\\" > nul\r\n",
            tmp_dir, app_dir
        ));
        script_content.push_str("echo [完成] 新版本文件已安装\r\n");
        script_content.push_str("echo.\r\n");

        script_content.push_str("echo [步骤4/5] 清理临时文件...\r\n");
        script_content.push_str(&format!("rd /s /q \"{}\"\r\n", tmp_dir));
        script_content.push_str("echo [完成] 临时文件已清理\r\n");
        script_content.push_str("echo.\r\n");

        script_content.push_str("echo [步骤5/5] 启动新版本应用程序...\r\n");
        script_content.push_str(&format!("echo   应用程序: {}\r\n", app_name));
        script_content.push_str(&format!("start \"\" \"{}\"\r\n", app_name));
        script_content.push_str("echo [完成] 新版本应用程序已启动\r\n");
        script_content.push_str("echo.\r\n");

        script_content.push_str("echo ==========================================\r\n");
        script_content.push_str("echo 更新完成！\r\n");
        script_content.push_str("echo ==========================================\r\n");
        script_content.push_str("echo.\r\n");
        script_content.push_str("echo 正在清理更新脚本...\r\n");

        script_content.push_str("del \"%~f0\"\r\n");
    }

    let (encoded, _, _) = GBK.encode(&script_content);

    let mut file = File::create(&script_path)?;
    file.write_all(&encoded)?;

    println!("更新脚本创建完成: {}", script_path.display());
    Ok(script_path.to_string_lossy().to_string())
}

#[command]
pub async fn download_update(url: String, app_name: String) -> Result<String, String> {
    println!("\n========================================");
    println!("开始应用程序更新流程");
    println!("========================================\n");

    let exe_path = std::env::current_exe().map_err(|e| format!("获取exe路径失败: {}", e))?;
    let app_dir = exe_path.parent().ok_or("无法获取exe父目录")?.to_path_buf();

    println!("应用程序安装目录: {}", app_dir.display());

    let app_dir_str = app_dir.to_string_lossy().to_string();
    let tmp_dir_path = app_dir.join("tmpFile");

    println!("\n[步骤 1/4] 下载更新包...");
    let download_result = download_update_package(
        url,
        app_dir.clone(),
        8,
    )
    .await
    .map_err(|e| e.to_string())?;

    println!("已完成下载更新包");
    println!("更新包位置: {}", download_result);

    println!("\n[步骤 2/4] 解压更新包...");
    extract_archive(&download_result, &tmp_dir_path.to_string_lossy())
        .map_err(|e| format!("解压失败: {}", e))?;
    println!("已完成解压更新包");

    println!("\n[步骤 3/4] 清理下载的压缩包...");
    if let Err(e) = fs::remove_file(&download_result) {
        println!("警告: 无法删除压缩包: {}", e);
    } else {
        println!("已完成清理压缩包");
    }

    println!("\n[步骤 4/4] 创建更新脚本...");
    let script_path =
        create_update_script(&app_dir_str, &tmp_dir_path.to_string_lossy(), &app_name)
            .map_err(|e| e.to_string())?;

    println!("已完成创建更新脚本");

    println!("\n========================================");
    println!("更新准备完成！");
    println!("========================================\n");

    Ok(script_path)
}

#[command]
pub fn get_app_download_status() -> Option<DownloadStatus> {
    get_update_download_status()
}

#[command]
pub fn install_update(app_handle: AppHandle, script_path: String) -> Result<(), String> {
    println!("\n========================================");
    println!("开始安装更新...");
    println!("========================================\n");

    println!("执行更新脚本: {}", script_path);

    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(&["/C", "start", "", &script_path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    println!("更新脚本已启动，应用程序即将退出...");

    app_handle.exit(0);

    Ok(())
}