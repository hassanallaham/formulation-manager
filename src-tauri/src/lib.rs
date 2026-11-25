use std::net::{TcpListener, TcpStream};
use std::process::{Child, Command};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{Manager, RunEvent};

struct NodeProcess(Mutex<Option<Child>>);

fn find_free_port() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("Failed to bind ephemeral port");
    listener.local_addr().unwrap().port()
}

fn wait_for_server(port: u16, timeout: Duration) -> bool {
    let start = Instant::now();
    let addr = format!("127.0.0.1:{}", port);
    while start.elapsed() < timeout {
        if TcpStream::connect(&addr).is_ok() {
            return true;
        }
        thread::sleep(Duration::from_millis(80));
    }
    false
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(NodeProcess(Mutex::new(None)))
        .setup(|app| {
            let port = find_free_port();
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Could not resolve app_data_dir");
            std::fs::create_dir_all(&app_data_dir)?;

            #[cfg(not(debug_assertions))]
            {
                let resource_dir = app
                    .path()
                    .resource_dir()
                    .expect("Could not resolve resource_dir");
                let server_dir = resource_dir.join("server");
                let server_entry = server_dir.join("server.mjs");
                let static_dir = server_dir.join("dist");

                let child = Command::new("node")
                    .arg(&server_entry)
                    .current_dir(&server_dir)
                    .env("NODE_ENV", "production")
                    .env("HOST", "127.0.0.1")
                    .env("PORT", port.to_string())
                    .env("DATA_DIR", app_data_dir.to_string_lossy().as_ref())
                    .env("STATIC_DIR", static_dir.to_string_lossy().as_ref())
                    .spawn()
                    .expect("Failed to spawn system Node.js process (ensure Node.js v24+ is installed)");

                *app.state::<NodeProcess>().0.lock().unwrap() = Some(child);

                if wait_for_server(port, Duration::from_secs(10)) {
                    if let Some(window) = app.get_webview_window("main") {
                        let url = format!("http://127.0.0.1:{}", port);
                        let _ = window.navigate(url.parse().unwrap());
                    }
                }
            }

            let _ = port;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let RunEvent::Exit = event {
            if let Some(state) = app_handle.try_state::<NodeProcess>() {
                if let Ok(mut guard) = state.0.lock() {
                    if let Some(mut child) = guard.take() {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                }
            }
        }
    });
}
