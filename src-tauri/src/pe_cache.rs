use md5::{Digest, Md5};
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Instant;
use tauri::{command, AppHandle, Emitter, Manager};

const META_FILE_NAME: &str = "pe-cache.json";
const DEFAULT_CACHE_DIR_NAME: &str = "cache";
const COPY_BUFFER_SIZE: usize = 1 << 20; // 1 MiB

/// Metadata describing the currently cached PE (stored as `pe-cache.json`).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PeCacheMeta {
    #[serde(rename = "peVersion")]
    pub pe_version: String,
    #[serde(rename = "isoFileName")]
    pub iso_file_name: String,
    #[serde(rename = "isoMd5")]
    pub iso_md5: String,
    #[serde(rename = "isoSize")]
    pub iso_size: u64,
    #[serde(rename = "pluginFileName", default)]
    pub plugin_file_name: String,
    #[serde(rename = "pluginMd5", default)]
    pub plugin_md5: String,
    #[serde(rename = "updatedAt", default)]
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
struct CopyProgress {
    progress: String,
    speed: String,
    copying: bool,
}

fn app_install_dir() -> Result<PathBuf, String> {
    let exe_path = std::env::current_exe().map_err(|e| format!("获取exe路径失败: {}", e))?;
    let dir = exe_path
        .parent()
        .ok_or("无法获取exe父目录")?
        .to_path_buf();
    Ok(dir)
}

/// Returns the default cache directory: `<exe_dir>\cache`.
#[command]
pub fn get_default_pe_cache_dir() -> Result<String, String> {
    let dir = app_install_dir()?.join(DEFAULT_CACHE_DIR_NAME);
    Ok(dir.to_string_lossy().to_string())
}

/// Returns just the default cache directory name (used by the updater to skip it).
#[command]
pub fn get_default_pe_cache_dir_name() -> String {
    DEFAULT_CACHE_DIR_NAME.to_string()
}

/// Creates the cache directory (and parents) if it does not exist.
#[command]
pub fn prepare_pe_cache_dir(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    fs::create_dir_all(p).map_err(|e| format!("创建缓存目录失败: {}", e))?;
    Ok(())
}

/// Returns the number of free bytes available on the volume holding `path`.
#[command]
pub fn get_path_free_space(path: String) -> Result<u64, String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::ffi::OsStrExt;
        use winapi::um::fileapi::GetDiskFreeSpaceExW;

        // GetDiskFreeSpaceExW accepts a directory path; ensure it exists, otherwise
        // walk up to the closest existing ancestor so the query still succeeds.
        let mut probe = PathBuf::from(&path);
        while !probe.exists() {
            match probe.parent() {
                Some(parent) => probe = parent.to_path_buf(),
                None => break,
            }
        }

        let wide: Vec<u16> = probe
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        let mut free_available: u64 = 0;
        let result = unsafe {
            GetDiskFreeSpaceExW(
                wide.as_ptr(),
                &mut free_available as *mut u64 as *mut _,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        };

        if result == 0 {
            return Err("获取磁盘剩余空间失败".to_string());
        }
        Ok(free_available)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = path;
        Ok(u64::MAX)
    }
}

/// Computes the lowercase hex MD5 of a file by streaming its contents.
#[command]
pub fn compute_file_md5(path: String) -> Result<String, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("文件不存在: {}", path));
    }

    let mut file = File::open(p).map_err(|e| format!("打开文件失败: {}", e))?;
    let mut hasher = Md5::new();
    let mut buffer = vec![0u8; COPY_BUFFER_SIZE];

    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|e| format!("读取文件失败: {}", e))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }

    let digest = hasher.finalize();
    let hex: String = digest.iter().map(|b| format!("{:02x}", b)).collect();
    Ok(hex)
}

/// Returns the size of a file in bytes (0 when it does not exist).
#[command]
pub fn get_file_size(path: String) -> Result<u64, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Ok(0);
    }
    let meta = fs::metadata(p).map_err(|e| format!("读取文件信息失败: {}", e))?;
    Ok(meta.len())
}

fn meta_path(dir: &str) -> PathBuf {
    Path::new(dir).join(META_FILE_NAME)
}

/// Reads the cache metadata, returning `None` when the metadata file is absent.
#[command]
pub fn read_pe_cache_meta(dir: String) -> Result<Option<PeCacheMeta>, String> {
    let path = meta_path(&dir);
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&path).map_err(|e| format!("读取缓存信息失败: {}", e))?;
    let meta: PeCacheMeta =
        serde_json::from_str(&content).map_err(|e| format!("解析缓存信息失败: {}", e))?;
    Ok(Some(meta))
}

/// Writes the cache metadata to `pe-cache.json`.
#[command]
pub fn write_pe_cache_meta(dir: String, meta: PeCacheMeta) -> Result<(), String> {
    fs::create_dir_all(&dir).map_err(|e| format!("创建缓存目录失败: {}", e))?;
    let path = meta_path(&dir);
    let json =
        serde_json::to_string_pretty(&meta).map_err(|e| format!("序列化缓存信息失败: {}", e))?;
    fs::write(&path, json).map_err(|e| format!("写入缓存信息失败: {}", e))?;
    Ok(())
}

/// Deletes a file if it exists (used when repairing a corrupted cache).
#[command]
pub fn delete_cache_file(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.exists() {
        fs::remove_file(p).map_err(|e| format!("删除文件失败: {}", e))?;
    }
    Ok(())
}

fn emit_copy_progress(app: &AppHandle, info: &CopyProgress) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.emit("cache://copy-progress", info);
    }
}

/// Copies a file from `src` to `dest`, emitting `cache://copy-progress` events.
#[command]
pub async fn copy_file_with_progress(
    app: AppHandle,
    src: String,
    dest: String,
) -> Result<String, String> {
    let src_path = PathBuf::from(&src);
    let dest_path = PathBuf::from(&dest);

    if !src_path.exists() {
        return Err(format!("源文件不存在: {}", src));
    }

    if let Some(parent) = dest_path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| format!("创建目标目录失败: {}", e))?;
        }
    }

    let total = fs::metadata(&src_path)
        .map_err(|e| format!("读取源文件信息失败: {}", e))?
        .len();

    let result = tokio::task::spawn_blocking(move || -> Result<(), String> {
        let mut reader = File::open(&src_path).map_err(|e| format!("打开源文件失败: {}", e))?;
        let mut writer = File::create(&dest_path).map_err(|e| format!("创建目标文件失败: {}", e))?;

        let mut buffer = vec![0u8; COPY_BUFFER_SIZE];
        let mut copied: u64 = 0;
        let mut history: Vec<(Instant, u64)> = Vec::with_capacity(32);
        let mut last_emit = Instant::now();

        emit_copy_progress(
            &app,
            &CopyProgress {
                progress: "0.0%".to_string(),
                speed: "0.00MB/s".to_string(),
                copying: true,
            },
        );

        loop {
            let read = reader
                .read(&mut buffer)
                .map_err(|e| format!("读取源文件失败: {}", e))?;
            if read == 0 {
                break;
            }
            writer
                .write_all(&buffer[..read])
                .map_err(|e| format!("写入目标文件失败: {}", e))?;
            copied += read as u64;

            let now = Instant::now();
            history.push((now, copied));
            history.retain(|(t, _)| now.duration_since(*t).as_secs_f64() <= 2.0);

            if now.duration_since(last_emit).as_millis() >= 250 {
                let speed = if let Some(oldest) = history.first() {
                    let dt = now.duration_since(oldest.0).as_secs_f64();
                    if dt > 0.0 {
                        (copied.saturating_sub(oldest.1) as f64) / dt / (1024.0 * 1024.0)
                    } else {
                        0.0
                    }
                } else {
                    0.0
                };
                let percent = if total > 0 {
                    (copied as f64 / total as f64) * 100.0
                } else {
                    0.0
                };
                emit_copy_progress(
                    &app,
                    &CopyProgress {
                        progress: format!("{:.1}%", percent.min(99.9)),
                        speed: format!("{:.2}MB/s", speed),
                        copying: true,
                    },
                );
                last_emit = now;
            }
        }

        writer.flush().map_err(|e| format!("刷新目标文件失败: {}", e))?;
        writer
            .sync_all()
            .map_err(|e| format!("同步目标文件失败: {}", e))?;

        emit_copy_progress(
            &app,
            &CopyProgress {
                progress: "100%".to_string(),
                speed: "0.00MB/s".to_string(),
                copying: false,
            },
        );

        Ok(())
    })
    .await
    .map_err(|e| format!("复制任务异常: {}", e))?;

    result?;
    Ok(dest)
}
