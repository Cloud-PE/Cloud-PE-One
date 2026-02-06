use anyhow::Result;
use futures_util::StreamExt;
use reqwest::{Client, StatusCode, header::{HeaderMap, HeaderValue, ACCEPT_ENCODING}};
use serde::{Deserialize, Serialize};
use std::fs::{File, OpenOptions};
use std::io::{Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::sync::{mpsc, Mutex, Semaphore};
use tokio::time::{interval, Duration, Instant};
use url::Url;
use tauri::{AppHandle, Emitter, Manager};

const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0";

// 下载进度信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadInfo {
    pub progress: String,
    pub speed: String,
    pub downloading: bool,
}

// 下载状态（用于更新）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadStatus {
    pub progress: u64,
    pub speed: String,
}

// Worker信息
#[derive(Debug, Clone)]
pub struct WorkerInfo {
    pub start_pos: u64,
    pub current_pos: u64,
    pub end_pos: u64,
}

// 进度更新
#[derive(Debug, Clone)]
#[allow(dead_code)]
struct ProgressUpdate {
    worker_id: usize,
    bytes_downloaded: u64,
    timestamp: Instant,
}

// 下载事件类型
#[derive(Debug, Clone)]
pub enum DownloadEvent {
    Progress(DownloadInfo),
    UpdateProgress(DownloadStatus),
}

// 下载器配置
#[derive(Debug, Clone)]
pub struct DownloadConfig {
    pub url: String,
    pub save_path: PathBuf,
    pub thread_count: u16,
    pub event_type: DownloadEventType,
    pub app_handle: Option<AppHandle>,
}

#[derive(Debug, Clone)]
pub enum DownloadEventType {
    FileDownload,    // 普通文件下载
    UpdateDownload,  // 更新包下载
    PluginDownload,  // 插件下载
}

// 全局下载状态存储（用于更新）
lazy_static::lazy_static! {
    pub static ref UPDATE_DOWNLOAD_STATUS: Arc<std::sync::Mutex<Option<DownloadStatus>>> = 
        Arc::new(std::sync::Mutex::new(None));
}

// 文件名解析相关函数
fn extract_filename_from_response(response: &reqwest::Response) -> Option<String> {
    response.headers()
        .get("content-disposition")
        .and_then(|v| v.to_str().ok())
        .and_then(|cd| parse_content_disposition(cd))
}

fn extract_filename_from_url(url: &Url) -> Option<String> {
    url.path_segments()
        .and_then(|segments| segments.last())
        .filter(|s| !s.is_empty())
        .and_then(|s| {
            percent_encoding::percent_decode_str(s)
                .decode_utf8()
                .ok()
                .map(|decoded| decoded.to_string())
        })
}

fn parse_content_disposition(cd: &str) -> Option<String> {
    if let Some(filename) = parse_extended_filename(cd) {
        return Some(filename);
    }
    parse_regular_filename(cd)
}

fn parse_extended_filename(cd: &str) -> Option<String> {
    let prefix = "filename*=";
    let start = cd.find(prefix)?;
    let value_start = start + prefix.len();
    
    let value_end = cd[value_start..]
        .find(';')
        .map(|i| value_start + i)
        .unwrap_or(cd.len());
    
    let value = cd[value_start..value_end].trim();
    
    if let Some(first_quote) = value.find('\'') {
        if let Some(second_quote) = value[first_quote + 1..].find('\'') {
            let encoded_value = &value[first_quote + 1 + second_quote + 1..];
            
            if let Ok(decoded) = percent_encoding::percent_decode_str(encoded_value).decode_utf8() {
                return Some(decoded.to_string());
            }
        }
    }
    
    None
}

fn parse_regular_filename(cd: &str) -> Option<String> {
    let prefix = "filename=";
    let start = cd.find(prefix)?;
    let value_start = start + prefix.len();
    let value = &cd[value_start..];
    
    if value.starts_with('"') {
        let mut escaped = false;
        for (i, ch) in value[1..].char_indices() {
            match ch {
                '\\' if !escaped => escaped = true,
                '"' if !escaped => {
                    let filename = &value[1..i + 1];
                    return Some(unescape_quoted_string(filename));
                }
                _ => escaped = false,
            }
        }
    } else {
        let end = value.find(';').unwrap_or(value.len());
        let filename = value[..end].trim();
        
        if let Ok(decoded) = percent_encoding::percent_decode_str(filename).decode_utf8() {
            return Some(decoded.to_string());
        }
        
        return Some(filename.to_string());
    }
    
    None
}

fn unescape_quoted_string(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut chars = s.chars();
    
    while let Some(ch) = chars.next() {
        if ch == '\\' {
            if let Some(next_ch) = chars.next() {
                match next_ch {
                    '"' | '\\' => result.push(next_ch),
                    _ => {
                        result.push(ch);
                        result.push(next_ch);
                    }
                }
            } else {
                result.push(ch);
            }
        } else {
            result.push(ch);
        }
    }
    
    result
}

// 创建下载workers
fn create_workers(file_size: u64, thread_count: u16) -> Vec<WorkerInfo> {
    let chunk_size = file_size / thread_count as u64;
    let mut workers = Vec::new();

    for i in 0..thread_count {
        let start = i as u64 * chunk_size;
        let end = if i == thread_count - 1 {
            file_size
        } else {
            (i as u64 + 1) * chunk_size
        };

        workers.push(WorkerInfo {
            start_pos: start,
            current_pos: start,
            end_pos: end,
        });
    }

    workers
}

// 保存下载状态（断点续传）
fn save_download_state(state_file: &Path, workers: &[WorkerInfo]) -> Result<()> {
    let mut file = File::create(state_file)?;
    
    for worker in workers {
        writeln!(file, "{},{},{}", worker.start_pos, worker.current_pos, worker.end_pos)?;
    }
    
    file.flush()?;
    file.sync_all()?;
    Ok(())
}

// 加载下载状态（断点续传）
fn load_download_state(state_file: &Path) -> Result<Vec<WorkerInfo>> {
    use std::io::{BufRead, BufReader};
    let file = File::open(state_file)?;
    let reader = BufReader::new(file);
    let mut workers = Vec::new();
    
    for line in reader.lines() {
        let line = line?;
        let parts: Vec<&str> = line.split(',').collect();
        if parts.len() == 3 {
            workers.push(WorkerInfo {
                start_pos: parts[0].parse()?,
                current_pos: parts[1].parse()?,
                end_pos: parts[2].parse()?,
            });
        }
    }
    
    Ok(workers)
}

// 获取文件信息 - 增强版，带重试和回退机制
pub async fn get_file_info(client: &Client, url: &Url) -> Result<(Url, String, u64, bool)> {
    let mut retries = 0;
    const MAX_RETRIES: u32 = 3;
    
    loop {
        match get_file_info_attempt(client, url).await {
            Ok(result) => return Ok(result),
            Err(e) => {
                retries += 1;
                if retries >= MAX_RETRIES {
                    return Err(e);
                }
                eprintln!("获取文件信息失败 (重试 {}/{}): {}", retries, MAX_RETRIES, e);
                tokio::time::sleep(Duration::from_secs(2u64.pow(retries))).await;
            }
        }
    }
}

async fn get_file_info_attempt(client: &Client, url: &Url) -> Result<(Url, String, u64, bool)> {
    // 首先尝试 HEAD 请求
    let head_result = client
        .head(url.as_str())
        .timeout(Duration::from_secs(10))
        .send()
        .await;

    match head_result {
        Ok(response) if response.status().is_success() => {
            let final_url = response.url().clone();
            let filename = extract_filename_from_response(&response)
                .or_else(|| extract_filename_from_url(&final_url))
                .unwrap_or_else(|| "download".to_string());

            let supports_range = response.headers()
                .get("accept-ranges")
                .and_then(|v| v.to_str().ok())
                .map(|v| v.contains("bytes"))
                .unwrap_or(false);

            let file_size = response.headers()
                .get("content-length")
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(0);

            Ok((final_url, filename, file_size, supports_range))
        }
        _ => {
            // HEAD 请求失败，尝试使用 GET 请求
            eprintln!("HEAD 请求失败，尝试 GET 请求");
            
            let response = client
                .get(url.as_str())
                .header("Range", "bytes=0-0")
                .timeout(Duration::from_secs(10))
                .send()
                .await?;

            let final_url = response.url().clone();
            let filename = extract_filename_from_response(&response)
                .or_else(|| extract_filename_from_url(&final_url))
                .unwrap_or_else(|| "download".to_string());

            let status = response.status();
            let supports_range = status == StatusCode::PARTIAL_CONTENT
                || response.headers()
                    .get("accept-ranges")
                    .and_then(|v| v.to_str().ok())
                    .map(|v| v.contains("bytes"))
                    .unwrap_or(false);

            let file_size = if status == StatusCode::PARTIAL_CONTENT {
                response.headers()
                    .get("content-range")
                    .and_then(|v| v.to_str().ok())
                    .and_then(|s| s.split('/').last())
                    .and_then(|size| size.parse::<u64>().ok())
                    .unwrap_or(0)
            } else {
                response.headers()
                    .get("content-length")
                    .and_then(|v| v.to_str().ok())
                    .and_then(|s| s.parse::<u64>().ok())
                    .unwrap_or(0)
            };

            Ok((final_url, filename, file_size, supports_range))
        }
    }
}

// 下载chunk的一部分（增强版）
async fn download_chunk_part(
    client: &Client,
    url: &Url,
    file: Arc<Mutex<File>>,
    worker: &mut WorkerInfo,
    worker_id: usize,
    progress_tx: &mpsc::Sender<ProgressUpdate>,
) -> Result<()> {
    // 检查是否已经下载完成
    if worker.current_pos >= worker.end_pos {
        return Ok(());
    }
    
    let range = format!("bytes={}-{}", worker.current_pos, worker.end_pos - 1);

    let response = client
        .get(url.as_str())
        .header("Range", range.clone())
        .timeout(Duration::from_secs(60))
        .send()
        .await?;

    let status = response.status();
    
    // 处理各种响应状态
    match status {
        StatusCode::PARTIAL_CONTENT => {
            // 正常的分块响应
        }
        StatusCode::OK => {
            // 服务器可能不支持 Range，但返回了完整内容
            eprintln!("警告: 服务器返回了完整内容而不是部分内容，worker {}", worker_id);
            if worker.current_pos > 0 {
                anyhow::bail!("服务器不支持断点续传");
            }
        }
        StatusCode::RANGE_NOT_SATISFIABLE => {
            eprintln!("警告: Range 不可满足，可能文件已完成下载，worker {}", worker_id);
            return Ok(());
        }
        _ => {
            anyhow::bail!("服务器拒绝Range请求: {} for range: {}", status, range);
        }
    }

    let mut stream = response.bytes_stream();
    let mut write_position = worker.current_pos;
    const BUFFER_SIZE: usize = 16384; // 16KB 缓冲区

    while let Some(chunk_result) = stream.next().await {
        let chunk = match chunk_result {
            Ok(chunk) => chunk,
            Err(e) => {
                eprintln!("读取数据块错误 (worker {}): {}", worker_id, e);
                anyhow::bail!("读取数据失败: {}", e);
            }
        };
        
        let chunk_len = chunk.len() as u64;

        // 检查是否会超出边界
        if write_position + chunk_len > worker.end_pos {
            let actual_len = (worker.end_pos - write_position) as usize;
            let mut file_guard = file.lock().await;
            file_guard.seek(SeekFrom::Start(write_position))?;
            file_guard.write_all(&chunk[..actual_len])?;
            file_guard.flush()?;
            drop(file_guard);
            
            worker.current_pos = worker.end_pos;
            
            progress_tx.send(ProgressUpdate {
                worker_id,
                bytes_downloaded: actual_len as u64,
                timestamp: Instant::now(),
            }).await.ok();
            
            break;
        }

        // 写入文件并确保数据刷新到磁盘
        let mut file_guard = file.lock().await;
        file_guard.seek(SeekFrom::Start(write_position))?;
        file_guard.write_all(&chunk)?;
        
        // 每写入一定量的数据就刷新
        if write_position % (BUFFER_SIZE as u64 * 64) == 0 {
            file_guard.flush()?;
        }
        drop(file_guard);

        write_position += chunk_len;
        worker.current_pos = write_position;

        progress_tx.send(ProgressUpdate {
            worker_id,
            bytes_downloaded: chunk_len,
            timestamp: Instant::now(),
        }).await.ok();
    }

    // 确保最后的数据都写入
    let mut file_guard = file.lock().await;
    file_guard.flush()?;
    drop(file_guard);

    Ok(())
}

// 下载一个chunk（增强版）
async fn download_chunk(
    client: &Client,
    url: &Url,
    file: Arc<Mutex<File>>,
    mut worker: WorkerInfo,
    worker_id: usize,
    progress_tx: mpsc::Sender<ProgressUpdate>,
    worker_tx: mpsc::Sender<(usize, WorkerInfo)>,
) -> Result<()> {
    let mut retry_count = 0;
    const MAX_RETRIES: u32 = 10;
    const INITIAL_RETRY_DELAY: u64 = 2;

    while worker.current_pos < worker.end_pos {
        match download_chunk_part(client, url, file.clone(), &mut worker, worker_id, &progress_tx).await {
            Ok(_) => {
                retry_count = 0;
                worker_tx.send((worker_id, worker.clone())).await.ok();
                
                // 如果下载完成，退出循环
                if worker.current_pos >= worker.end_pos {
                    break;
                }
            }
            Err(e) => {
                retry_count += 1;
                eprintln!(
                    "Worker {} 下载失败 (重试 {}/{}): {}", 
                    worker_id, retry_count, MAX_RETRIES, e
                );
                
                if retry_count >= MAX_RETRIES {
                    return Err(e);
                }
                
                // 指数退避重试延迟
                let delay = Duration::from_secs(INITIAL_RETRY_DELAY.pow(retry_count.min(5)));
                tokio::time::sleep(delay).await;
            }
        }
    }

    eprintln!("Worker {} 完成下载", worker_id);
    Ok(())
}

// 发送下载事件
fn emit_download_event(config: &DownloadConfig, event: DownloadEvent) {
    match event {
        DownloadEvent::Progress(info) => {
            if let Some(app) = &config.app_handle {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.emit("download://progress", &info);
                }
            }
        }
        DownloadEvent::UpdateProgress(status) => {
            let mut global_status = UPDATE_DOWNLOAD_STATUS.lock().unwrap();
            *global_status = Some(status);
        }
    }
}

// 构建增强的 HTTP 客户端
fn build_client() -> Result<Client> {
    let mut headers = HeaderMap::new();
    headers.insert(ACCEPT_ENCODING, HeaderValue::from_static("gzip, deflate, br"));
    
    let client = Client::builder()
        .user_agent(USER_AGENT)
        .default_headers(headers)
        .connect_timeout(Duration::from_secs(30))
        .timeout(Duration::from_secs(300)) // 5分钟总超时
        .pool_max_idle_per_host(16)
        .danger_accept_invalid_certs(true) // 接受无效证书
        .build()?;
    
    Ok(client)
}

// 多线程下载实现（增强版）
async fn multi_thread_download_impl(
    config: DownloadConfig,
    client: &Client,
    url: &Url,
    file_path: &Path,
    file_size: u64,
    workers: Vec<WorkerInfo>,
) -> Result<String> {
    let state_file = file_path.with_extension("download");
    
    let file = if file_path.exists() {
        OpenOptions::new()
            .write(true)
            .read(true)
            .open(file_path)?
    } else {
        let file = File::create(file_path)?;
        file.set_len(file_size)?;
        file.sync_all()?; // 确保文件系统元数据更新
        file
    };

    let file = Arc::new(Mutex::new(file));
    let workers_state = Arc::new(Mutex::new(workers.clone()));

    let mut already_downloaded = 0u64;
    for worker in &workers {
        already_downloaded += worker.current_pos - worker.start_pos;
    }

    let total_downloaded = Arc::new(AtomicU64::new(already_downloaded));
    let (progress_tx, mut progress_rx) = mpsc::channel::<ProgressUpdate>(10000);

    // 启动进度显示任务
    let progress_handle = {
        let total_downloaded_clone = total_downloaded.clone();
        let workers_state_clone = workers_state.clone();
        let state_file_clone = state_file.to_path_buf();
        let config_clone = config.clone();

        tokio::spawn(async move {
            let mut interval = interval(Duration::from_millis(100));
            let mut last_save = Instant::now();
            let start_time = Instant::now();
            
            let mut speed_history: Vec<(Instant, u64)> = Vec::new();
            const SPEED_WINDOW: Duration = Duration::from_secs(2);
            
            loop {
                interval.tick().await;
                
                let now = Instant::now();
                let mut updates_processed = 0;
                let mut bytes_in_batch = 0u64;
                
                while let Ok(update) = progress_rx.try_recv() {
                    bytes_in_batch += update.bytes_downloaded;
                    updates_processed += 1;
                    
                    if updates_processed >= 1000 {
                        break;
                    }
                }
                
                if bytes_in_batch > 0 {
                    total_downloaded_clone.fetch_add(bytes_in_batch, Ordering::Relaxed);
                    let current_total = total_downloaded_clone.load(Ordering::Relaxed);
                    
                    speed_history.push((now, current_total));
                    speed_history.retain(|(t, _)| now.duration_since(*t) < SPEED_WINDOW);
                }
                
                if now.duration_since(start_time).as_millis() % 250 < 100 {
                    let current_total = total_downloaded_clone.load(Ordering::Relaxed);
                    
                    let speed = if speed_history.len() >= 2 {
                        let oldest = speed_history.first().unwrap();
                        let time_diff = now.duration_since(oldest.0).as_secs_f64();
                        if time_diff > 0.0 {
                            let bytes_diff = current_total.saturating_sub(oldest.1) as f64;
                            bytes_diff / time_diff / (1024.0 * 1024.0)
                        } else {
                            0.0
                        }
                    } else {
                        0.0
                    };

                    let display_speed = speed;
                    let progress = (current_total as f64 / file_size as f64) * 100.0;
                    
                    // 根据事件类型发送不同的事件
                    match config_clone.event_type {
                        DownloadEventType::FileDownload | DownloadEventType::PluginDownload => {
                            let info = DownloadInfo {
                                progress: format!("{:.1}%", progress),
                                speed: format!("{:.2}MB/s", display_speed),
                                downloading: true,
                            };
                            emit_download_event(&config_clone, DownloadEvent::Progress(info));
                        }
                        DownloadEventType::UpdateDownload => {
                            let status = DownloadStatus {
                                progress: progress as u64,
                                speed: format!("{:.2}", display_speed),
                            };
                            emit_download_event(&config_clone, DownloadEvent::UpdateProgress(status));
                            
                            println!(
                                "下载进度: {}% | 速度: {:.2} MB/s | 已下载: {:.2} MB / {:.2} MB",
                                progress as u64,
                                display_speed,
                                current_total as f64 / 1024.0 / 1024.0,
                                file_size as f64 / 1024.0 / 1024.0
                            );
                        }
                    }
                }
                
                if last_save.elapsed() >= Duration::from_secs(30) {
                    let workers = workers_state_clone.lock().await;
                    save_download_state(&state_file_clone, &*workers).ok();
                    last_save = Instant::now();
                }
                
                let current_total = total_downloaded_clone.load(Ordering::Relaxed);
                
                if current_total >= file_size {
                    // 发送完成事件
                    match config_clone.event_type {
                        DownloadEventType::FileDownload | DownloadEventType::PluginDownload => {
                            let final_info = DownloadInfo {
                                progress: "100%".to_string(),
                                speed: "0MB/s".to_string(),
                                downloading: false,
                            };
                            emit_download_event(&config_clone, DownloadEvent::Progress(final_info));
                        }
                        DownloadEventType::UpdateDownload => {
                            let final_status = DownloadStatus {
                                progress: 100,
                                speed: "0.00".to_string(),
                            };
                            emit_download_event(&config_clone, DownloadEvent::UpdateProgress(final_status));
                        }
                    }
                    break;
                }
            }
        })
    };

    let (worker_tx, mut worker_rx) = mpsc::channel::<(usize, WorkerInfo)>(100);

    let workers_state_clone = workers_state.clone();
    let worker_task = tokio::spawn(async move {
        while let Some((idx, worker_info)) = worker_rx.recv().await {
            let mut workers = workers_state_clone.lock().await;
            if idx < workers.len() {
                workers[idx] = worker_info;
            }
        }
    });

    let semaphore = Arc::new(Semaphore::new(workers.len().min(16))); // 限制并发数
    let mut tasks = Vec::new();

    for (i, worker) in workers.into_iter().enumerate() {
        if worker.current_pos >= worker.end_pos {
            continue;
        }

        let client = client.clone();
        let url = url.clone();
        let file = file.clone();
        let semaphore = semaphore.clone();
        let progress_tx = progress_tx.clone();
        let worker_tx = worker_tx.clone();

        let task = tokio::spawn(async move {
            let _permit = semaphore.acquire().await?;
            download_chunk(
                &client,
                &url,
                file,
                worker,
                i,
                progress_tx,
                worker_tx,
            ).await
        });

        tasks.push(task);
    }

    // 等待所有任务完成
    let mut download_errors = Vec::new();
    for (i, task) in tasks.into_iter().enumerate() {
        match task.await {
            Ok(Ok(_)) => {}
            Ok(Err(e)) => {
                eprintln!("下载任务 {} 失败: {}", i, e);
                download_errors.push(e);
            }
            Err(e) => {
                eprintln!("下载任务 {} 异常终止: {}", i, e);
                download_errors.push(anyhow::anyhow!("任务异常终止: {}", e));
            }
        }
    }

    if !download_errors.is_empty() {
        return Err(anyhow::anyhow!("部分下载任务失败: {:?}", download_errors));
    }

    drop(progress_tx);
    drop(worker_tx);
    worker_task.await?;

    tokio::time::sleep(Duration::from_millis(500)).await;
    progress_handle.abort();

    // 验证文件完整性
    {
        let file_guard = file.lock().await;
        file_guard.sync_all()?; // 确保所有数据都已写入磁盘
        let metadata = file_guard.metadata()?;
        if metadata.len() != file_size {
            anyhow::bail!("文件大小不匹配：期望 {} 字节，实际 {} 字节", file_size, metadata.len());
        }
    }

    // 删除状态文件
    std::fs::remove_file(&state_file).ok();

    Ok(file_path.display().to_string())
}

// 单线程下载实现（增强版）
async fn single_thread_download_impl(
    config: DownloadConfig,
    client: &Client,
    url: &Url,
    file_path: &Path,
) -> Result<String> {
    let mut retries = 0;
    const MAX_RETRIES: u32 = 5;
    
    loop {
        match single_thread_download_attempt(config.clone(), client, url, file_path).await {
            Ok(result) => return Ok(result),
            Err(e) => {
                retries += 1;
                if retries >= MAX_RETRIES {
                    return Err(e);
                }
                eprintln!("单线程下载失败 (重试 {}/{}): {}", retries, MAX_RETRIES, e);
                tokio::time::sleep(Duration::from_secs(2u64.pow(retries))).await;
            }
        }
    }
}

async fn single_thread_download_attempt(
    config: DownloadConfig,
    client: &Client,
    url: &Url,
    file_path: &Path,
) -> Result<String> {
    let response = client
        .get(url.as_str())
        .timeout(Duration::from_secs(300))
        .send()
        .await?;

    if !response.status().is_success() {
        anyhow::bail!("下载失败: {}", response.status());
    }

    let total_size = response.headers()
        .get("content-length")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok());

    let mut file = File::create(file_path)?;
    let mut stream = response.bytes_stream();
    let mut downloaded = 0u64;
    let _start_time = Instant::now();
    
    let mut speed_history: Vec<(Instant, u64)> = Vec::new();
    const SPEED_WINDOW: Duration = Duration::from_secs(2);
    let mut last_update = Instant::now();
    const BUFFER_SIZE: usize = 16384; // 16KB 缓冲区

    while let Some(chunk_result) = stream.next().await {
        let chunk = match chunk_result {
            Ok(chunk) => chunk,
            Err(e) => {
                eprintln!("读取数据块错误: {}", e);
                anyhow::bail!("下载中断: {}", e);
            }
        };
        
        file.write_all(&chunk)?;
        
        // 定期刷新到磁盘
        if downloaded % (BUFFER_SIZE as u64 * 64) == 0 {
            file.flush()?;
        }
        
        downloaded += chunk.len() as u64;
        let now = Instant::now();

        speed_history.push((now, downloaded));
        speed_history.retain(|(t, _)| now.duration_since(*t) < SPEED_WINDOW);

        if now.duration_since(last_update) >= Duration::from_millis(250) {
            let speed = if speed_history.len() >= 2 {
                let oldest = speed_history.first().unwrap();
                let time_diff = now.duration_since(oldest.0).as_secs_f64();
                if time_diff > 0.0 {
                    let bytes_diff = (downloaded - oldest.1) as f64;
                    bytes_diff / time_diff / (1024.0 * 1024.0)
                } else {
                    0.0
                }
            } else {
                0.0
            };

            let display_speed = speed;

            if let Some(total) = total_size {
                let progress = (downloaded as f64 / total as f64) * 100.0;
                
                // 根据事件类型发送不同的事件
                match config.event_type {
                    DownloadEventType::FileDownload | DownloadEventType::PluginDownload => {
                        let info = DownloadInfo {
                            progress: format!("{:.0}%", progress),
                            speed: format!("{:.2}MB/s", display_speed),
                            downloading: true,
                        };
                        emit_download_event(&config, DownloadEvent::Progress(info));
                    }
                    DownloadEventType::UpdateDownload => {
                        let status = DownloadStatus {
                            progress: progress as u64,
                            speed: format!("{:.2}", display_speed),
                        };
                        emit_download_event(&config, DownloadEvent::UpdateProgress(status));
                        
                        println!(
                            "下载进度: {}% | 速度: {:.2} MB/s | {}/{} MB",
                            progress as u64, display_speed, downloaded / 1048576, total / 1048576
                        );
                    }
                }
            }
            last_update = now;
        }
    }

    // 确保数据写入磁盘
    file.flush()?;
    file.sync_all()?;

    // 发送完成状态
    match config.event_type {
        DownloadEventType::FileDownload | DownloadEventType::PluginDownload => {
            let final_info = DownloadInfo {
                progress: "100%".to_string(),
                speed: "0.00MB/s".to_string(),
                downloading: false,
            };
            emit_download_event(&config, DownloadEvent::Progress(final_info));
        }
        DownloadEventType::UpdateDownload => {
            let final_status = DownloadStatus {
                progress: 100,
                speed: "0.00".to_string(),
            };
            emit_download_event(&config, DownloadEvent::UpdateProgress(final_status));
        }
    }

    Ok(file_path.display().to_string())
}

// 通用下载接口
pub async fn download(config: DownloadConfig) -> Result<String> {
    let url = Url::parse(&config.url)?;
    let save_path = &config.save_path;

    if let Some(parent) = save_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let client = build_client()?;

    let (final_url, filename, file_size, supports_range) = get_file_info(&client, &url).await?;

    let final_filename = if save_path.is_dir() {
        filename
    } else {
        save_path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string()
    };

    let file_path = if save_path.is_dir() {
        save_path.join(&final_filename)
    } else {
        save_path.to_path_buf()
    };

    // 发送初始进度事件
    if matches!(config.event_type, DownloadEventType::FileDownload) {
        let initial_info = DownloadInfo {
            progress: "0%".to_string(),
            speed: "0.00MB/s".to_string(),
            downloading: true,
        };
        emit_download_event(&config, DownloadEvent::Progress(initial_info));
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    if !supports_range || file_size == 0 || config.thread_count == 1 {
        eprintln!("使用单线程下载模式");
        return single_thread_download_impl(config, &client, &final_url, &file_path).await;
    }

    eprintln!("使用多线程下载模式，线程数: {}", config.thread_count);
    
    let state_file = file_path.with_extension("download");
    let workers = if state_file.exists() {
        match load_download_state(&state_file) {
            Ok(saved_workers) => {
                eprintln!("从状态文件恢复下载进度");
                saved_workers
            }
            Err(e) => {
                eprintln!("加载状态文件失败: {}，重新开始下载", e);
                create_workers(file_size, config.thread_count)
            }
        }
    } else {
        create_workers(file_size, config.thread_count)
    };

    multi_thread_download_impl(
        config,
        &client,
        &final_url,
        &file_path,
        file_size,
        workers,
    ).await
}

// 导出的公共函数

// 下载文件（通用）
pub async fn download_file_with_progress(
    app: AppHandle,
    url: String,
    save_path: String,
    thread_count: u16,
) -> Result<String> {
    let config = DownloadConfig {
        url,
        save_path: PathBuf::from(save_path),
        thread_count,
        event_type: DownloadEventType::FileDownload,
        app_handle: Some(app),
    };

    download(config).await
}

// 下载更新包
pub async fn download_update_package(
    url: String,
    save_dir: PathBuf,
    thread_count: u16,
) -> Result<String> {
    // 重置下载状态
    {
        let mut status = UPDATE_DOWNLOAD_STATUS.lock().unwrap();
        *status = Some(DownloadStatus {
            progress: 0,
            speed: "0.00".to_string(),
        });
    }

    let config = DownloadConfig {
        url,
        save_path: save_dir,
        thread_count,
        event_type: DownloadEventType::UpdateDownload,
        app_handle: None,
    };

    download(config).await
}

// 下载插件
pub async fn download_plugin_file(
    url: String,
    save_path: PathBuf,
    thread_count: u16,
) -> Result<String> {
    let config = DownloadConfig {
        url,
        save_path,
        thread_count,
        event_type: DownloadEventType::PluginDownload,
        app_handle: None,
    };

    download(config).await
}

// 获取更新下载状态
pub fn get_update_download_status() -> Option<DownloadStatus> {
    UPDATE_DOWNLOAD_STATUS.lock().unwrap().clone()
}