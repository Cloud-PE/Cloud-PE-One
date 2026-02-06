use anyhow::Result;
use std::fs;
use std::path::Path;
use url::Url;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::command;
use crate::download::{download_plugin_file, get_file_info};
use reqwest::Client;

const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0";

#[derive(Clone, Serialize, Deserialize)]
pub struct PluginInfo {
    name: String,
    size: String,
    version: String,
    author: String,
    describe: String,
    file: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    id: Option<String>,
}

fn generate_plugin_id(name: &str, author: &str) -> String {
    format!("{}|{}", name, author)
}

#[command]
pub async fn download_plugin(
    url: String,
    path: String,
    file_name: Option<String>,
    threads: Option<u32>,
) -> Result<String, String> {
    let thread_count = threads.unwrap_or(8) as u16;
    let url_parsed = Url::parse(&url).map_err(|e| e.to_string())?;

    let download_dir = Path::new(&path);
    if !download_dir.exists() {
        fs::create_dir_all(download_dir).map_err(|e| e.to_string())?;
    }

    let client = Client::builder()
        .user_agent(USER_AGENT)
        .connect_timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;

    let (_, filename, _, _) = get_file_info(&client, &url_parsed)
        .await
        .map_err(|e| e.to_string())?;

    let final_filename = file_name.unwrap_or(filename);
    let file_path = download_dir.join(&final_filename);

    download_plugin_file(url, file_path, thread_count)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn update_plugin(
    url: String,
    path: String,
    old_file_name: String,
    new_file_name: String,
    threads: Option<u32>,
) -> Result<String, String> {
    let thread_count = threads.unwrap_or(8) as u16;
    let url_parsed = Url::parse(&url).map_err(|e| e.to_string())?;

    let download_dir = Path::new(&path);
    if !download_dir.exists() {
        fs::create_dir_all(download_dir).map_err(|e| e.to_string())?;
    }

    let client = Client::builder()
        .user_agent(USER_AGENT)
        .connect_timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;

    let (_, _, _, _) = get_file_info(&client, &url_parsed)
        .await
        .map_err(|e| e.to_string())?;

    let temp_filename = format!("{}.tmp", new_file_name);
    let temp_file_path = download_dir.join(&temp_filename);
    let final_file_path = download_dir.join(&new_file_name);
    let old_file_path = download_dir.join(&old_file_name);

    download_plugin_file(url, temp_file_path.clone(), thread_count)
        .await
        .map_err(|e| e.to_string())?;

    if old_file_path.exists() {
        fs::remove_file(&old_file_path).map_err(|e| e.to_string())?;
    }

    fs::rename(&temp_file_path, &final_file_path).map_err(|e| e.to_string())?;

    Ok(final_file_path.to_string_lossy().to_string())
}

#[command]
pub fn get_plugin_files(drive_letter: String) -> Result<HashMap<String, Vec<PluginInfo>>, String> {
    let ce_apps_dir = format!("{}\\ce-apps", drive_letter);
    let dir_path = Path::new(&ce_apps_dir);

    if !dir_path.exists() {
        return Err(format!("目录 {} 不存在", ce_apps_dir));
    }

    let mut enabled_plugins = Vec::new();
    let mut disabled_plugins = Vec::new();

    let entries = fs::read_dir(dir_path).map_err(|e| e.to_string())?;

    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();

        if path.is_file() {
            if let Some(extension) = path.extension() {
                let extension_str = extension.to_string_lossy().to_lowercase();

                if extension_str == "ce" || extension_str == "cbk" {
                    let file_name = path.file_name().unwrap().to_string_lossy().to_string();
                    let parts: Vec<&str> = file_name.split('_').collect();

                    if parts.len() >= 4 {
                        let name = parts[0].to_string();
                        let version = parts[1].to_string();
                        let author = parts[2].to_string();

                        let describe_with_ext = parts[3..].join("_");
                        let describe = describe_with_ext
                            .strip_suffix(".ce")
                            .or_else(|| describe_with_ext.strip_suffix(".CBK"))
                            .unwrap_or(&describe_with_ext)
                            .to_string();

                        let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;
                        let size = format!("{:.2} MB", metadata.len() as f64 / 1024.0 / 1024.0);

                        let id = if extension_str == "ce" {
                            Some(generate_plugin_id(&name, &author))
                        } else {
                            None
                        };

                        let plugin_info = PluginInfo {
                            name,
                            size,
                            version,
                            author,
                            describe,
                            file: file_name,
                            id,
                        };

                        if extension_str == "ce" {
                            enabled_plugins.push(plugin_info);
                        } else {
                            disabled_plugins.push(plugin_info);
                        }
                    }
                }
            }
        }
    }

    let mut result = HashMap::new();
    result.insert("enabled".to_string(), enabled_plugins);
    result.insert("disabled".to_string(), disabled_plugins);

    Ok(result)
}

#[command]
pub fn enable_plugin(drive_letter: String, file_name: String) -> Result<bool, String> {
    let ce_apps_dir = format!("{}\\ce-apps", drive_letter);
    let dir_path = Path::new(&ce_apps_dir);

    if !dir_path.exists() {
        return Err(format!("目录 {} 不存在", ce_apps_dir));
    }

    let file_path = dir_path.join(&file_name);
    if !file_path.exists() {
        return Err(format!("文件 {} 不存在", file_name));
    }

    if let Some(extension) = file_path.extension() {
        if extension.to_string_lossy().to_lowercase() == "ce" {
            return Ok(true);
        }
    }

    let new_file_name = file_name.replace(".CBK", ".ce");
    let new_file_path = dir_path.join(&new_file_name);

    fs::rename(&file_path, &new_file_path).map_err(|e| e.to_string())?;

    Ok(true)
}

#[command]
pub fn disable_plugin(drive_letter: String, file_name: String) -> Result<bool, String> {
    let ce_apps_dir = format!("{}\\ce-apps", drive_letter);
    let dir_path = Path::new(&ce_apps_dir);

    if !dir_path.exists() {
        return Err(format!("目录 {} 不存在", ce_apps_dir));
    }

    let file_path = dir_path.join(&file_name);
    if !file_path.exists() {
        return Err(format!("文件 {} 不存在", file_name));
    }

    if let Some(extension) = file_path.extension() {
        if extension.to_string_lossy().to_lowercase() == "cbk" {
            return Ok(true);
        }
    }

    let new_file_name = file_name.replace(".ce", ".CBK");
    let new_file_path = dir_path.join(&new_file_name);

    fs::rename(&file_path, &new_file_path).map_err(|e| e.to_string())?;

    Ok(true)
}
