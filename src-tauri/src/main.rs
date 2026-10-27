#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU16, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

struct Host {
    child: Mutex<Option<Child>>,
    port: AtomicU16,
    exiting: AtomicBool,
    #[cfg(windows)]
    job: Mutex<Option<WindowsJob>>,
}
impl Host {
    fn send(&self, value: Value) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(input) = guard.as_mut().and_then(|child| child.stdin.as_mut()) {
                let _ = writeln!(input, "{}", value);
                let _ = input.flush();
            }
        }
    }
    fn shutdown(self: &Arc<Self>, app: tauri::AppHandle) {
        if self.exiting.swap(true, Ordering::SeqCst) {
            return;
        }
        self.send(json!({"type":"shutdown"}));
        let host = self.clone();
        thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(10);
            loop {
                let mut guard = host.child.lock().unwrap();
                match guard.as_mut() {
                    Some(child) => match child.try_wait() {
                        Ok(Some(_)) => break,
                        _ if Instant::now() >= deadline => {
                            let _ = child.kill();
                            let _ = child.wait();
                            break;
                        }
                        _ => {}
                    },
                    None => break,
                }
                drop(guard);
                thread::sleep(Duration::from_millis(50));
            }
            app.exit(0);
        });
    }
}

#[cfg(windows)]
struct WindowsJob(usize);
#[cfg(windows)]
impl WindowsJob {
    fn attach(child: &Child) -> std::io::Result<Self> {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::{Foundation::CloseHandle, System::JobObjects::*};
        unsafe {
            let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if handle.is_null() {
                return Err(std::io::Error::last_os_error());
            }
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const _,
                std::mem::size_of_val(&limits) as u32,
            ) == 0
                || AssignProcessToJobObject(handle, child.as_raw_handle()) == 0
            {
                CloseHandle(handle);
                return Err(std::io::Error::last_os_error());
            }
            Ok(Self(handle as usize))
        }
    }
}
#[cfg(windows)]
impl Drop for WindowsJob {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.0 as _);
        }
    }
}

fn external_url(url: &tauri::Url) {
    if matches!(url.scheme(), "http" | "https")
        && url.username().is_empty()
        && url.password().is_none()
    {
        let _ = open::that_detached(url.as_str());
    }
}
fn request_close(app: &tauri::AppHandle, host: &Arc<Host>) {
    if host.exiting.load(Ordering::SeqCst) {
        return;
    }
    if host.port.load(Ordering::SeqCst) == 0 {
        host.shutdown(app.clone());
        return;
    }
    if let Some(window) = app.get_webview_window("main") {
        // The editor flushes drafts before approving close through the local API.
        let _ = window.eval("window.dispatchEvent(new Event('open-template-close'))");
    } else {
        host.shutdown(app.clone());
    }
}
fn launch_backend(
    app: &tauri::AppHandle,
    host: Arc<Host>,
) -> Result<(), Box<dyn std::error::Error>> {
    let source = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .to_owned();
    let legacy_data = app.path().app_data_dir()?;
    let folder = if cfg!(debug_assertions) {
        "open-template-dev"
    } else {
        "open-template"
    };
    let data = app.path().data_dir()?.join(folder);
    // Preserve preferences and downloaded browsers from earlier desktop builds.
    // Never merge into or replace an existing destination.
    if !data.exists() && legacy_data.is_dir() {
        std::fs::rename(&legacy_data, &data)?;
    }
    std::fs::create_dir_all(&data)?;
    let (node, root, args) = if cfg!(debug_assertions) {
        let suffix = if cfg!(windows) { ".exe" } else { "" };
        let node = source.join(format!(
            "src-tauri/binaries/node-{}{}",
            env!("OPEN_TEMPLATE_TARGET"),
            suffix
        ));
        (
            node,
            source.clone(),
            vec![
                "--import".into(),
                source
                    .join("node_modules/tsx/dist/loader.mjs")
                    .into_os_string(),
                source.join("server/index.ts").into_os_string(),
                "--dev".into(),
            ],
        )
    } else {
        let node = std::env::current_exe()?
            .parent()
            .unwrap()
            .join(if cfg!(windows) { "node.exe" } else { "node" });
        let root = app.path().resource_dir()?.join("runtime");
        let args = vec![root.join("server/index.js").into_os_string()];
        (node, root, args)
    };
    let tools = if cfg!(debug_assertions) {
        source.join(".studio-local/cli")
    } else {
        root.join("tools")
    };
    let mut command = Command::new(node);
    command
        .args(args)
        .current_dir(&data)
        .env("OPEN_TEMPLATE_DESKTOP", "1")
        .env("OPEN_TEMPLATE_RESOURCE_DIR", &root)
        .env("OPEN_TEMPLATE_DATA_DIR", &data)
        .env("OPEN_TEMPLATE_TOOLS_DIR", tools)
        .env("PLAYWRIGHT_BROWSERS_PATH", data.join("browsers"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let mut child = command.spawn()?;
    #[cfg(windows)]
    {
        match WindowsJob::attach(&child) {
            Ok(job) => *host.job.lock().unwrap() = Some(job),
            Err(error) => {
                let _ = child.kill();
                return Err(error.into());
            }
        }
    }
    let output = child.stdout.take().unwrap();
    let errors = child.stderr.take().unwrap();
    *host.child.lock().unwrap() = Some(child);
    let log_path = data.join("desktop.log");
    thread::spawn(move || {
        if let Ok(mut file) = std::fs::File::create(log_path) {
            for line in BufReader::new(errors).lines().map_while(Result::ok) {
                let _ = writeln!(file, "{}", line);
            }
        }
    });
    let app = app.clone();
    thread::spawn(move || {
        for line in BufReader::new(output).lines().map_while(Result::ok) {
            let Ok(message) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            match message["type"].as_str() {
                Some("ready") => {
                    let Some(port) = message["port"].as_u64().filter(|p| *p > 0 && *p <= 65535)
                    else {
                        continue;
                    };
                    host.port.store(port as u16, Ordering::SeqCst);
                    if let Some(window) = app.get_webview_window("main") {
                        let _ =
                            window.navigate(format!("http://127.0.0.1:{port}").parse().unwrap());
                    }
                }
                Some("pick-folder") => {
                    let Some(id) = message["id"].as_str().map(str::to_owned) else {
                        continue;
                    };
                    let host = host.clone();
                    thread::spawn(move || {
                        let selected = rfd::FileDialog::new()
                            .set_title("Open an open-template folder")
                            .pick_folder();
                        host.send(json!({"type":"folder-result","id":id,"path":selected.map(|p|p.to_string_lossy().into_owned())}));
                    });
                }
                Some("close-approved") => host.shutdown(app.clone()),
                _ => {}
            }
        }
        if !host.exiting.load(Ordering::SeqCst) {
            rfd::MessageDialog::new().set_title("open-template could not continue")
                .set_description("The local backend stopped. Your saved projects are retained. See desktop.log in the app data folder for details.")
                .set_level(rfd::MessageLevel::Error).show();
            host.shutdown(app);
        }
    });
    Ok(())
}
fn main() {
    let host = Arc::new(Host {
        child: Mutex::new(None),
        port: AtomicU16::new(0),
        exiting: AtomicBool::new(false),
        #[cfg(windows)]
        job: Mutex::new(None),
    });
    let setup_host = host.clone();
    let close_host = host.clone();
    let result = tauri::Builder::default()
        .setup(move |app| {
            let navigation = setup_host.clone();
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title(if cfg!(debug_assertions) {
                    "open-template Dev"
                } else {
                    "open-template"
                })
                .inner_size(1440.0, 940.0)
                .min_inner_size(900.0, 640.0)
                .center()
                .decorations(true)
                .resizable(true)
                .disable_drag_drop_handler()
                .on_navigation(move |url| {
                    let port = navigation.port.load(Ordering::SeqCst);
                    if port == 0 {
                        return url.scheme() == "tauri"
                            || url.host_str() == Some("tauri.localhost");
                    }
                    url.scheme() == "http"
                        && url.host_str() == Some("127.0.0.1")
                        && url.port() == Some(port)
                })
                .on_new_window(|url, _| {
                    external_url(&url);
                    tauri::webview::NewWindowResponse::Deny
                })
                .build()?;
            launch_backend(app.handle(), setup_host.clone())?;
            Ok(())
        })
        .on_window_event(move |window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if !close_host.exiting.load(Ordering::SeqCst) {
                    api.prevent_close();
                    request_close(window.app_handle(), &close_host);
                }
            }
        })
        .build(tauri::generate_context!());
    match result {
        Ok(app) => app.run(move |app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if !host.exiting.load(Ordering::SeqCst) {
                    api.prevent_exit();
                    request_close(app, &host);
                }
            }
        }),
        Err(error) => {
            rfd::MessageDialog::new()
                .set_title("open-template startup failed")
                .set_description(error.to_string())
                .set_level(rfd::MessageLevel::Error)
                .show();
        }
    }
}
