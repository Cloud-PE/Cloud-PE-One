use anyhow::{anyhow, bail, Context, Result};
use futures_util::StreamExt;
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{mpsc, Mutex, Semaphore};
use tokio::time::{interval, Duration, Instant};
use url::Url;

const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
    (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0";

const STATE_SUFFIX: &str = ".cpdl";
const STATE_FORMAT_VERSION: u32 = 1;

const FLUSH_INTERVAL_BYTES: u64 = 1 << 20;
const SPEED_WINDOW: Duration = Duration::from_secs(2);
const EMIT_INTERVAL: Duration = Duration::from_millis(250);
const TICK_INTERVAL: Duration = Duration::from_millis(100);
const STATE_SAVE_INTERVAL: Duration = Duration::from_secs(5);

const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
const HEAD_TIMEOUT: Duration = Duration::from_secs(15);
const CHUNK_TIMEOUT: Duration = Duration::from_secs(60);

const CHUNK_RETRY_LIMIT: u32 = 10;
const FILE_INFO_RETRY_LIMIT: u32 = 3;
const SINGLE_THREAD_RETRY_LIMIT: u32 = 5;

const MAX_PARALLEL_WORKERS: usize = 16;
const CANCELLED_MSG: &str = "下载已取消";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadInfo {
    pub progress: String,
    pub speed: String,
    pub downloading: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadStatus {
    pub progress: u64,
    pub speed: String,
}

#[derive(Debug, Clone, Copy)]
struct Worker {
    start: u64,
    current: u64,
    end: u64,
}

impl Worker {
    fn done(&self) -> bool {
        self.current >= self.end
    }
}

#[derive(Debug, Clone, Copy)]
pub enum DownloadEventType {
    FileDownload,
    UpdateDownload,
    PluginDownload,
}

#[derive(Debug, Clone)]
pub struct DownloadConfig {
    pub url: String,
    pub save_path: PathBuf,
    pub thread_count: u16,
    pub event_type: DownloadEventType,
    pub app_handle: Option<AppHandle>,
}

struct GlobalState {
    cancel: AtomicBool,
    update_status: std::sync::Mutex<Option<DownloadStatus>>,
}

lazy_static::lazy_static! {
    static ref STATE: GlobalState = GlobalState {
        cancel: AtomicBool::new(false),
        update_status: std::sync::Mutex::new(None),
    };
}

pub fn request_cancel() {
    STATE.cancel.store(true, Ordering::Release);
}

pub fn get_update_download_status() -> Option<DownloadStatus> {
    STATE.update_status.lock().ok().and_then(|s| s.clone())
}

fn reset_cancel() {
    STATE.cancel.store(false, Ordering::Release);
}

fn cancelled() -> bool {
    STATE.cancel.load(Ordering::Acquire)
}

fn set_update_status(status: Option<DownloadStatus>) {
    if let Ok(mut guard) = STATE.update_status.lock() {
        *guard = status;
    }
}

fn extract_filename_from_response(resp: &reqwest::Response) -> Option<String> {
    resp.headers()
        .get("content-disposition")
        .and_then(|v| v.to_str().ok())
        .and_then(parse_content_disposition)
}

fn extract_filename_from_url(url: &Url) -> Option<String> {
    let last = url.path_segments()?.last()?;
    if last.is_empty() {
        return None;
    }
    percent_encoding::percent_decode_str(last)
        .decode_utf8()
        .ok()
        .map(|s| s.into_owned())
}

fn parse_content_disposition(cd: &str) -> Option<String> {
    parse_ext_filename(cd).or_else(|| parse_plain_filename(cd))
}

fn parse_ext_filename(cd: &str) -> Option<String> {
    let start = cd.find("filename*=")? + "filename*=".len();
    let end = cd[start..].find(';').map(|i| start + i).unwrap_or(cd.len());
    let raw = cd[start..end].trim();

    let lang_sep = raw.find('\'')?;
    let after_lang = &raw[lang_sep + 1..];
    let enc_sep = after_lang.find('\'')?;
    let payload = &after_lang[enc_sep + 1..];

    percent_encoding::percent_decode_str(payload)
        .decode_utf8()
        .ok()
        .map(|s| s.into_owned())
}

fn parse_plain_filename(cd: &str) -> Option<String> {
    let start = cd.find("filename=")? + "filename=".len();
    let rest = &cd[start..];

    if let Some(quoted) = rest.strip_prefix('"') {
        let mut out = String::with_capacity(quoted.len());
        let mut chars = quoted.chars();
        while let Some(c) = chars.next() {
            match c {
                '"' => return Some(out),
                '\\' => {
                    if let Some(next) = chars.next() {
                        out.push(next);
                    }
                }
                _ => out.push(c),
            }
        }
        None
    } else {
        let end = rest.find(';').unwrap_or(rest.len());
        let raw = rest[..end].trim();
        Some(
            percent_encoding::percent_decode_str(raw)
                .decode_utf8()
                .map(|s| s.into_owned())
                .unwrap_or_else(|_| raw.to_string()),
        )
    }
}

fn sanitize_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_control()
                || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
            {
                '_'
            } else {
                c
            }
        })
        .collect();

    let trimmed = cleaned.trim().trim_matches('.').trim_matches('_');
    if trimmed.is_empty() {
        "download".to_string()
    } else {
        trimmed.to_string()
    }
}

fn state_file_for(file_path: &Path) -> PathBuf {
    let mut name = file_path
        .file_name()
        .map(|n| n.to_os_string())
        .unwrap_or_default();
    name.push(STATE_SUFFIX);
    file_path.with_file_name(name)
}

struct PersistedState {
    file_size: u64,
    url: String,
    workers: Vec<Worker>,
}

fn save_state(path: &Path, state: &PersistedState) -> Result<()> {
    let mut f = File::create(path)?;
    writeln!(f, "v={}", STATE_FORMAT_VERSION)?;
    writeln!(f, "size={}", state.file_size)?;
    writeln!(f, "url={}", state.url)?;
    for w in &state.workers {
        writeln!(f, "{},{},{}", w.start, w.current, w.end)?;
    }
    f.flush()?;
    f.sync_all()?;
    Ok(())
}

fn load_state(path: &Path) -> Result<PersistedState> {
    let reader = BufReader::new(File::open(path)?);
    let mut version: Option<u32> = None;
    let mut size: Option<u64> = None;
    let mut url: Option<String> = None;
    let mut workers = Vec::new();

    for line in reader.lines() {
        let line = line?;
        if line.is_empty() {
            continue;
        }
        if let Some(v) = line.strip_prefix("v=") {
            version = Some(v.parse().context("invalid version")?);
        } else if let Some(v) = line.strip_prefix("size=") {
            size = Some(v.parse().context("invalid size")?);
        } else if let Some(v) = line.strip_prefix("url=") {
            url = Some(v.to_string());
        } else {
            let parts: Vec<&str> = line.split(',').collect();
            if parts.len() != 3 {
                bail!("worker line malformed");
            }
            workers.push(Worker {
                start: parts[0].parse()?,
                current: parts[1].parse()?,
                end: parts[2].parse()?,
            });
        }
    }

    if version != Some(STATE_FORMAT_VERSION) {
        bail!("state version mismatch");
    }
    Ok(PersistedState {
        file_size: size.ok_or_else(|| anyhow!("missing size"))?,
        url: url.ok_or_else(|| anyhow!("missing url"))?,
        workers: if workers.is_empty() {
            bail!("no workers")
        } else {
            workers
        },
    })
}

fn split_workers(file_size: u64, thread_count: u16) -> Vec<Worker> {
    let threads = thread_count.max(1) as u64;
    let chunk = file_size / threads;
    let mut out = Vec::with_capacity(threads as usize);
    for i in 0..threads {
        let start = i * chunk;
        let end = if i == threads - 1 {
            file_size
        } else {
            (i + 1) * chunk
        };
        out.push(Worker {
            start,
            current: start,
            end,
        });
    }
    out
}

fn build_client() -> Result<Client> {
    Client::builder()
        .user_agent(USER_AGENT)
        .connect_timeout(CONNECT_TIMEOUT)
        .pool_max_idle_per_host(MAX_PARALLEL_WORKERS)
        .build()
        .map_err(Into::into)
}

pub async fn get_file_info(client: &Client, url: &Url) -> Result<(Url, String, u64, bool)> {
    let mut attempt = 0u32;
    loop {
        if cancelled() {
            bail!(CANCELLED_MSG);
        }
        match probe_file_info(client, url).await {
            Ok(v) => return Ok(v),
            Err(e) => {
                attempt += 1;
                if attempt >= FILE_INFO_RETRY_LIMIT {
                    return Err(e);
                }
                eprintln!(
                    "获取文件信息失败({}/{}): {}",
                    attempt, FILE_INFO_RETRY_LIMIT, e
                );
                tokio::time::sleep(Duration::from_secs(1u64 << attempt)).await;
            }
        }
    }
}

async fn probe_file_info(client: &Client, url: &Url) -> Result<(Url, String, u64, bool)> {
    let head = client
        .head(url.as_str())
        .timeout(HEAD_TIMEOUT)
        .send()
        .await;

    if let Ok(resp) = head {
        if resp.status().is_success() {
            let final_url = resp.url().clone();
            let name = extract_filename_from_response(&resp)
                .or_else(|| extract_filename_from_url(&final_url))
                .unwrap_or_else(|| "download".to_string());
            let supports_range = resp
                .headers()
                .get("accept-ranges")
                .and_then(|v| v.to_str().ok())
                .map(|v| v.contains("bytes"))
                .unwrap_or(false);
            let size = resp
                .headers()
                .get("content-length")
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(0);
            return Ok((final_url, name, size, supports_range));
        }
    }

    eprintln!("HEAD 不可用，回退到 GET Range");

    let resp = client
        .get(url.as_str())
        .header("Range", "bytes=0-0")
        .timeout(HEAD_TIMEOUT)
        .send()
        .await?;

    let final_url = resp.url().clone();
    let name = extract_filename_from_response(&resp)
        .or_else(|| extract_filename_from_url(&final_url))
        .unwrap_or_else(|| "download".to_string());

    let status = resp.status();
    let supports_range = status == StatusCode::PARTIAL_CONTENT
        || resp
            .headers()
            .get("accept-ranges")
            .and_then(|v| v.to_str().ok())
            .map(|v| v.contains("bytes"))
            .unwrap_or(false);

    let size = if status == StatusCode::PARTIAL_CONTENT {
        resp.headers()
            .get("content-range")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.rsplit('/').next())
            .and_then(|n| n.parse::<u64>().ok())
            .unwrap_or(0)
    } else {
        resp.headers()
            .get("content-length")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0)
    };

    Ok((final_url, name, size, supports_range))
}

fn emit_progress(config: &DownloadConfig, info: DownloadInfo) {
    if let Some(app) = &config.app_handle {
        if let Some(win) = app.get_webview_window("main") {
            let _ = win.emit("download://progress", &info);
        }
    }
}

fn report_progress(config: &DownloadConfig, percent: f64, speed_mb: f64, finished: bool) {
    match config.event_type {
        DownloadEventType::FileDownload | DownloadEventType::PluginDownload => {
            let info = DownloadInfo {
                progress: if finished {
                    "100%".to_string()
                } else {
                    format!("{:.1}%", percent)
                },
                speed: if finished {
                    "0.00MB/s".to_string()
                } else {
                    format!("{:.2}MB/s", speed_mb)
                },
                downloading: !finished,
            };
            emit_progress(config, info);
        }
        DownloadEventType::UpdateDownload => {
            let status = DownloadStatus {
                progress: if finished {
                    100
                } else {
                    percent.clamp(0.0, 100.0) as u64
                },
                speed: if finished {
                    "0.00".to_string()
                } else {
                    format!("{:.2}", speed_mb)
                },
            };
            if matches!(config.event_type, DownloadEventType::UpdateDownload) {
                println!(
                    "下载进度: {}% | 速度: {} MB/s",
                    status.progress, status.speed
                );
            }
            set_update_status(Some(status));
        }
    }
}

async fn fetch_chunk(
    client: &Client,
    url: &Url,
    file: &Arc<Mutex<File>>,
    worker: &mut Worker,
    progress_tx: &mpsc::UnboundedSender<u64>,
) -> Result<()> {
    if worker.done() {
        return Ok(());
    }

    let range = format!("bytes={}-{}", worker.current, worker.end - 1);
    let resp = client
        .get(url.as_str())
        .header("Range", &range)
        .timeout(CHUNK_TIMEOUT)
        .send()
        .await?;

    match resp.status() {
        StatusCode::PARTIAL_CONTENT => {}
        StatusCode::OK => bail!("服务器不支持断点续传（返回完整内容）"),
        StatusCode::RANGE_NOT_SATISFIABLE => return Ok(()),
        s => bail!("服务器拒绝 Range 请求: {} ({})", s, range),
    }

    let mut stream = resp.bytes_stream();
    let mut pending_flush: u64 = 0;

    while let Some(chunk) = stream.next().await {
        if cancelled() {
            bail!(CANCELLED_MSG);
        }
        let chunk = chunk.map_err(|e| anyhow!("读取数据失败: {}", e))?;
        if chunk.is_empty() {
            continue;
        }

        let remaining = worker.end - worker.current;
        let take = (chunk.len() as u64).min(remaining) as usize;
        let payload = &chunk[..take];

        {
            let mut f = file.lock().await;
            f.seek(SeekFrom::Start(worker.current))?;
            f.write_all(payload)?;
            pending_flush += take as u64;
            if pending_flush >= FLUSH_INTERVAL_BYTES {
                f.flush()?;
                pending_flush = 0;
            }
        }

        worker.current += take as u64;
        let _ = progress_tx.send(take as u64);

        if worker.done() {
            break;
        }
    }

    {
        let mut f = file.lock().await;
        f.flush()?;
    }

    Ok(())
}

async fn run_worker(
    client: Client,
    url: Url,
    file: Arc<Mutex<File>>,
    mut worker: Worker,
    worker_id: usize,
    progress_tx: mpsc::UnboundedSender<u64>,
    worker_tx: mpsc::UnboundedSender<(usize, Worker)>,
    semaphore: Arc<Semaphore>,
) -> Result<()> {
    let _permit = semaphore
        .acquire_owned()
        .await
        .map_err(|e| anyhow!("信号量错误: {}", e))?;

    let mut attempt: u32 = 0;
    while !worker.done() {
        if cancelled() {
            bail!(CANCELLED_MSG);
        }
        match fetch_chunk(&client, &url, &file, &mut worker, &progress_tx).await {
            Ok(()) => {
                attempt = 0;
                let _ = worker_tx.send((worker_id, worker));
            }
            Err(e) => {
                if cancelled() {
                    return Err(e);
                }
                attempt += 1;
                if attempt >= CHUNK_RETRY_LIMIT {
                    return Err(e);
                }
                eprintln!(
                    "worker {} 第 {}/{} 次重试: {}",
                    worker_id, attempt, CHUNK_RETRY_LIMIT, e
                );
                let backoff = 1u64 << attempt.min(5);
                tokio::time::sleep(Duration::from_secs(backoff)).await;
            }
        }
    }
    Ok(())
}

async fn multi_thread_download(
    config: &DownloadConfig,
    client: &Client,
    url: &Url,
    file_path: &Path,
    file_size: u64,
    workers: Vec<Worker>,
) -> Result<String> {
    let state_path = state_file_for(file_path);

    let file = if file_path.exists() {
        let f = OpenOptions::new().read(true).write(true).open(file_path)?;
        if f.metadata()?.len() != file_size {
            f.set_len(file_size)?;
        }
        f
    } else {
        let f = File::create(file_path)?;
        f.set_len(file_size)?;
        f.sync_all()?;
        f
    };
    let file = Arc::new(Mutex::new(file));

    let workers_arc = Arc::new(Mutex::new(workers.clone()));
    let already: u64 = workers.iter().map(|w| w.current - w.start).sum();
    let total = Arc::new(AtomicU64::new(already));

    let (progress_tx, progress_rx) = mpsc::unbounded_channel::<u64>();
    let (worker_tx, worker_rx) = mpsc::unbounded_channel::<(usize, Worker)>();
    let (stop_tx, stop_rx) = mpsc::channel::<()>(1);

    let progress_task = spawn_progress_task(
        config.clone(),
        total.clone(),
        workers_arc.clone(),
        state_path.clone(),
        file_size,
        progress_rx,
        stop_rx,
    );

    let workers_state = workers_arc.clone();
    let worker_collector = tokio::spawn(async move {
        let mut rx = worker_rx;
        while let Some((idx, w)) = rx.recv().await {
            let mut state = workers_state.lock().await;
            if idx < state.len() {
                state[idx] = w;
            }
        }
    });

    let semaphore = Arc::new(Semaphore::new(workers.len().min(MAX_PARALLEL_WORKERS)));
    let mut tasks = Vec::with_capacity(workers.len());
    for (i, worker) in workers.into_iter().enumerate() {
        if worker.done() {
            continue;
        }
        let client = client.clone();
        let url = url.clone();
        let file = file.clone();
        let progress_tx = progress_tx.clone();
        let worker_tx = worker_tx.clone();
        let sem = semaphore.clone();
        tasks.push(tokio::spawn(async move {
            run_worker(client, url, file, worker, i, progress_tx, worker_tx, sem).await
        }));
    }

    drop(progress_tx);
    drop(worker_tx);

    let mut errors: Vec<anyhow::Error> = Vec::new();
    for (i, task) in tasks.into_iter().enumerate() {
        match task.await {
            Ok(Ok(())) => {}
            Ok(Err(e)) => {
                eprintln!("worker {} 失败: {}", i, e);
                errors.push(e);
            }
            Err(e) => {
                errors.push(anyhow!("worker {} 异常终止: {}", i, e));
            }
        }
    }

    let _ = stop_tx.send(()).await;
    let _ = progress_task.await;
    let _ = worker_collector.await;

    if cancelled() {
        let workers = workers_arc.lock().await;
        let snapshot = PersistedState {
            file_size,
            url: url.to_string(),
            workers: workers.clone(),
        };
        let _ = save_state(&state_path, &snapshot);
        bail!(CANCELLED_MSG);
    }

    if !errors.is_empty() {
        let workers = workers_arc.lock().await;
        let snapshot = PersistedState {
            file_size,
            url: url.to_string(),
            workers: workers.clone(),
        };
        let _ = save_state(&state_path, &snapshot);
        return Err(anyhow!(
            "下载失败（{} 个分片错误），首个错误: {}",
            errors.len(),
            errors[0]
        ));
    }

    {
        let f = file.lock().await;
        f.sync_all()?;
        let meta = f.metadata()?;
        if meta.len() != file_size {
            bail!(
                "文件大小不匹配：期望 {} 字节，实际 {} 字节",
                file_size,
                meta.len()
            );
        }
    }

    let _ = std::fs::remove_file(&state_path);
    report_progress(config, 100.0, 0.0, true);
    Ok(file_path.display().to_string())
}

fn spawn_progress_task(
    config: DownloadConfig,
    total: Arc<AtomicU64>,
    workers: Arc<Mutex<Vec<Worker>>>,
    state_path: PathBuf,
    file_size: u64,
    mut progress_rx: mpsc::UnboundedReceiver<u64>,
    mut stop_rx: mpsc::Receiver<()>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut tick = interval(TICK_INTERVAL);
        let mut last_emit = Instant::now() - EMIT_INTERVAL;
        let mut last_save = Instant::now();
        let mut history: Vec<(Instant, u64)> = Vec::with_capacity(32);
        let url_str = config.url.clone();

        loop {
            tokio::select! {
                _ = stop_rx.recv() => break,
                _ = tick.tick() => {}
            }

            let mut received: u64 = 0;
            while let Ok(n) = progress_rx.try_recv() {
                received += n;
            }
            if received > 0 {
                total.fetch_add(received, Ordering::Relaxed);
            }

            let now = Instant::now();
            let current = total.load(Ordering::Relaxed);

            history.push((now, current));
            history.retain(|(t, _)| now.duration_since(*t) <= SPEED_WINDOW);

            if now.duration_since(last_emit) >= EMIT_INTERVAL {
                let speed = if let Some(oldest) = history.first() {
                    let dt = now.duration_since(oldest.0).as_secs_f64();
                    if dt > 0.0 {
                        (current.saturating_sub(oldest.1) as f64) / dt / (1024.0 * 1024.0)
                    } else {
                        0.0
                    }
                } else {
                    0.0
                };

                let percent = if file_size > 0 {
                    (current as f64 / file_size as f64) * 100.0
                } else {
                    0.0
                };
                report_progress(&config, percent.min(99.9), speed, false);
                last_emit = now;
            }

            if now.duration_since(last_save) >= STATE_SAVE_INTERVAL {
                let snapshot = {
                    let guard = workers.lock().await;
                    PersistedState {
                        file_size,
                        url: url_str.clone(),
                        workers: guard.clone(),
                    }
                };
                let _ = save_state(&state_path, &snapshot);
                last_save = now;
            }

            if file_size > 0 && current >= file_size {
                break;
            }
        }
    })
}

async fn single_thread_download(
    config: &DownloadConfig,
    client: &Client,
    url: &Url,
    file_path: &Path,
    expected_size: u64,
) -> Result<String> {
    let mut attempt: u32 = 0;
    let mut resume_from: u64 = 0;

    loop {
        if cancelled() {
            bail!(CANCELLED_MSG);
        }
        match single_thread_attempt(config, client, url, file_path, expected_size, resume_from)
            .await
        {
            Ok(out) => return Ok(out),
            Err(e) => {
                if cancelled() {
                    return Err(e);
                }
                attempt += 1;
                if attempt >= SINGLE_THREAD_RETRY_LIMIT {
                    return Err(e);
                }
                eprintln!(
                    "单线程下载失败({}/{}): {}",
                    attempt, SINGLE_THREAD_RETRY_LIMIT, e
                );
                resume_from = std::fs::metadata(file_path).map(|m| m.len()).unwrap_or(0);
                tokio::time::sleep(Duration::from_secs(1u64 << attempt.min(5))).await;
            }
        }
    }
}

async fn single_thread_attempt(
    config: &DownloadConfig,
    client: &Client,
    url: &Url,
    file_path: &Path,
    expected_size: u64,
    resume_from: u64,
) -> Result<String> {
    let mut request = client.get(url.as_str()).timeout(CHUNK_TIMEOUT);
    let resuming = resume_from > 0 && expected_size > 0 && resume_from < expected_size;
    if resuming {
        request = request.header("Range", format!("bytes={}-", resume_from));
    }

    let resp = request.send().await?;
    let status = resp.status();
    if !status.is_success() && status != StatusCode::PARTIAL_CONTENT {
        bail!("下载失败: {}", status);
    }

    let actual_resume = resuming && status == StatusCode::PARTIAL_CONTENT;
    let mut file = if actual_resume {
        OpenOptions::new().write(true).read(true).open(file_path)?
    } else {
        File::create(file_path)?
    };
    let mut downloaded: u64 = if actual_resume { resume_from } else { 0 };
    if actual_resume {
        file.seek(SeekFrom::Start(downloaded))?;
    }

    let total_size = if expected_size > 0 {
        expected_size
    } else {
        resp.headers()
            .get("content-length")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.parse::<u64>().ok())
            .map(|n| n + downloaded)
            .unwrap_or(0)
    };

    let mut stream = resp.bytes_stream();
    let mut history: Vec<(Instant, u64)> = Vec::with_capacity(32);
    let mut last_emit = Instant::now() - EMIT_INTERVAL;
    let mut pending_flush: u64 = 0;

    while let Some(chunk) = stream.next().await {
        if cancelled() {
            file.flush()?;
            bail!(CANCELLED_MSG);
        }
        let chunk = chunk.map_err(|e| anyhow!("下载中断: {}", e))?;
        if chunk.is_empty() {
            continue;
        }
        file.write_all(&chunk)?;
        downloaded += chunk.len() as u64;
        pending_flush += chunk.len() as u64;
        if pending_flush >= FLUSH_INTERVAL_BYTES {
            file.flush()?;
            pending_flush = 0;
        }

        let now = Instant::now();
        history.push((now, downloaded));
        history.retain(|(t, _)| now.duration_since(*t) <= SPEED_WINDOW);

        if now.duration_since(last_emit) >= EMIT_INTERVAL {
            let speed = if let Some(oldest) = history.first() {
                let dt = now.duration_since(oldest.0).as_secs_f64();
                if dt > 0.0 {
                    (downloaded.saturating_sub(oldest.1) as f64) / dt / (1024.0 * 1024.0)
                } else {
                    0.0
                }
            } else {
                0.0
            };
            let percent = if total_size > 0 {
                (downloaded as f64 / total_size as f64) * 100.0
            } else {
                0.0
            };
            report_progress(config, percent.min(99.9), speed, false);
            last_emit = now;
        }
    }

    file.flush()?;
    file.sync_all()?;

    if total_size > 0 && downloaded != total_size {
        bail!(
            "文件大小不匹配：期望 {} 字节，实际 {} 字节",
            total_size,
            downloaded
        );
    }

    report_progress(config, 100.0, 0.0, true);
    Ok(file_path.display().to_string())
}

pub async fn download(config: DownloadConfig) -> Result<String> {
    reset_cancel();

    let url = Url::parse(&config.url)?;
    let save_path = &config.save_path;

    if let Some(parent) = save_path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }

    let client = build_client()?;
    let (final_url, raw_name, file_size, supports_range) = get_file_info(&client, &url).await?;
    let server_name = sanitize_filename(&raw_name);

    let file_path = if save_path.is_dir() {
        save_path.join(&server_name)
    } else {
        save_path.to_path_buf()
    };

    if matches!(
        config.event_type,
        DownloadEventType::FileDownload | DownloadEventType::PluginDownload
    ) {
        emit_progress(
            &config,
            DownloadInfo {
                progress: "0.0%".to_string(),
                speed: "0.00MB/s".to_string(),
                downloading: true,
            },
        );
    }

    let single_thread =
        !supports_range || file_size == 0 || config.thread_count <= 1;

    let result = if single_thread {
        eprintln!("单线程下载");
        single_thread_download(&config, &client, &final_url, &file_path, file_size).await
    } else {
        eprintln!("多线程下载 ({} 线程)", config.thread_count);
        let state_path = state_file_for(&file_path);
        let workers = load_workers_for_resume(&state_path, &final_url, file_size)
            .unwrap_or_else(|| split_workers(file_size, config.thread_count));
        multi_thread_download(&config, &client, &final_url, &file_path, file_size, workers).await
    };

    if result.is_err()
        && matches!(
            config.event_type,
            DownloadEventType::FileDownload | DownloadEventType::PluginDownload
        )
    {
        emit_progress(
            &config,
            DownloadInfo {
                progress: "0.0%".to_string(),
                speed: "0.00MB/s".to_string(),
                downloading: false,
            },
        );
    }

    result
}

fn load_workers_for_resume(
    state_path: &Path,
    final_url: &Url,
    file_size: u64,
) -> Option<Vec<Worker>> {
    if !state_path.exists() {
        return None;
    }
    match load_state(state_path) {
        Ok(saved) => {
            if saved.file_size != file_size {
                eprintln!("状态文件大小不一致，丢弃");
                let _ = std::fs::remove_file(state_path);
                return None;
            }
            if saved.url != final_url.as_str() {
                eprintln!("状态文件 URL 已变更，丢弃");
                let _ = std::fs::remove_file(state_path);
                return None;
            }
            for w in &saved.workers {
                if w.start > w.end || w.current < w.start || w.current > w.end {
                    eprintln!("状态文件 worker 范围非法，丢弃");
                    let _ = std::fs::remove_file(state_path);
                    return None;
                }
            }
            let covered: u64 = saved.workers.iter().map(|w| w.end - w.start).sum();
            if covered != file_size {
                eprintln!("状态文件 worker 覆盖范围不完整，丢弃");
                let _ = std::fs::remove_file(state_path);
                return None;
            }
            eprintln!("从状态文件恢复下载进度");
            Some(saved.workers)
        }
        Err(e) => {
            eprintln!("加载状态文件失败({})，重新开始", e);
            let _ = std::fs::remove_file(state_path);
            None
        }
    }
}

pub async fn download_file_with_progress(
    app: AppHandle,
    url: String,
    save_path: String,
    thread_count: u16,
) -> Result<String> {
    download(DownloadConfig {
        url,
        save_path: PathBuf::from(save_path),
        thread_count,
        event_type: DownloadEventType::FileDownload,
        app_handle: Some(app),
    })
    .await
}

pub async fn download_update_package(
    url: String,
    save_dir: PathBuf,
    thread_count: u16,
) -> Result<String> {
    set_update_status(Some(DownloadStatus {
        progress: 0,
        speed: "0.00".to_string(),
    }));

    let result = download(DownloadConfig {
        url,
        save_path: save_dir,
        thread_count,
        event_type: DownloadEventType::UpdateDownload,
        app_handle: None,
    })
    .await;

    if result.is_err() {
        set_update_status(None);
    }
    result
}

pub async fn download_plugin_file(
    url: String,
    save_path: PathBuf,
    thread_count: u16,
) -> Result<String> {
    download(DownloadConfig {
        url,
        save_path,
        thread_count,
        event_type: DownloadEventType::PluginDownload,
        app_handle: None,
    })
    .await
}
