use std::{
    collections::HashMap,
    io::{Read, Write},
    path::Path,
    sync::Arc,
    thread,
};

use onpeople_types::{AppError, ErrorCode, TerminalExit, TerminalSession, TerminalStartRequest};
use parking_lot::Mutex;
use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};
use tokio::sync::broadcast;
use uuid::Uuid;

#[derive(Debug, Clone)]
pub enum TerminalEvent {
    Output { process_id: String, data: Vec<u8> },
    Exit(TerminalExit),
}

struct ManagedTerminal {
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    child: Mutex<Box<dyn Child + Send + Sync>>,
    window_label: String,
}

#[derive(Clone)]
pub struct TerminalService {
    sessions: Arc<Mutex<HashMap<String, Arc<ManagedTerminal>>>>,
    events: broadcast::Sender<TerminalEvent>,
}

impl Default for TerminalService {
    fn default() -> Self {
        let (events, _) = broadcast::channel(1_024);
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            events,
        }
    }
}

impl TerminalService {
    pub fn start(&self, request: &TerminalStartRequest) -> Result<TerminalSession, AppError> {
        let cwd = crate::canonical_workspace(Path::new(&request.cwd))?;
        let shell = validated_shell(request.shell.as_deref())?;
        let size = PtySize {
            rows: request.rows.clamp(2, 500),
            cols: request.cols.clamp(2, 500),
            pixel_width: 0,
            pixel_height: 0,
        };
        let pair = native_pty_system().openpty(size).map_err(|error| {
            AppError::new(ErrorCode::ProcessFailed, "无法创建终端 PTY").context("cause", error)
        })?;
        let mut command = CommandBuilder::new(&shell);
        command.cwd(&cwd);
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");
        command.env("ONPEOPLE_TERMINAL", "1");
        let child = pair.slave.spawn_command(command).map_err(|error| {
            AppError::new(ErrorCode::ProcessFailed, "无法启动终端 Shell").context("cause", error)
        })?;
        drop(pair.slave);
        let reader = pair.master.try_clone_reader().map_err(|error| {
            AppError::new(ErrorCode::ProcessFailed, "无法读取终端 PTY").context("cause", error)
        })?;
        let writer = pair.master.take_writer().map_err(|error| {
            AppError::new(ErrorCode::ProcessFailed, "无法写入终端 PTY").context("cause", error)
        })?;
        let process_id = Uuid::now_v7().to_string();
        let managed = Arc::new(ManagedTerminal {
            writer: Mutex::new(writer),
            master: Mutex::new(pair.master),
            child: Mutex::new(child),
            window_label: request
                .window_label
                .clone()
                .unwrap_or_else(|| "main".to_owned()),
        });
        self.sessions.lock().insert(process_id.clone(), managed);
        self.spawn_reader(process_id.clone(), reader);
        Ok(TerminalSession {
            process_id,
            cwd: cwd.to_string_lossy().into_owned(),
            shell,
            cols: size.cols,
            rows: size.rows,
        })
    }

    pub fn write(&self, process_id: &str, data: &[u8]) -> Result<(), AppError> {
        let session = self.session(process_id)?;
        let mut writer = session.writer.lock();
        writer.write_all(data).map_err(AppError::storage)?;
        writer.flush().map_err(AppError::storage)
    }

    pub fn resize(&self, process_id: &str, cols: u16, rows: u16) -> Result<(), AppError> {
        let session = self.session(process_id)?;
        session
            .master
            .lock()
            .resize(PtySize {
                rows: rows.clamp(2, 500),
                cols: cols.clamp(2, 500),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| {
                AppError::new(ErrorCode::ProcessFailed, "无法调整终端尺寸").context("cause", error)
            })
    }

    pub fn terminate(&self, process_id: &str) -> Result<(), AppError> {
        let session = self
            .sessions
            .lock()
            .remove(process_id)
            .ok_or_else(|| AppError::new(ErrorCode::NotFound, "终端会话不存在"))?;
        let mut child = session.child.lock();
        child.kill().map_err(|error| {
            AppError::new(ErrorCode::ProcessFailed, "无法终止终端进程树").context("cause", error)
        })?;
        // portable-pty's kill sends the signal, but waiting here also reaps the
        // shell before the tab disappears. This keeps repeated open/close cycles
        // from leaking zombie shells on macOS.
        let _ = child.wait();
        Ok(())
    }

    pub fn terminate_window(&self, window_label: &str) {
        let ids = self
            .sessions
            .lock()
            .iter()
            .filter(|(_, session)| session.window_label == window_label)
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>();
        for id in ids {
            let _ = self.terminate(&id);
        }
    }

    pub fn terminate_all(&self) {
        let ids = self.sessions.lock().keys().cloned().collect::<Vec<_>>();
        for id in ids {
            let _ = self.terminate(&id);
        }
    }

    #[must_use]
    pub fn is_active(&self, process_id: &str) -> bool {
        self.sessions.lock().contains_key(process_id)
    }

    #[must_use]
    pub fn subscribe(&self) -> broadcast::Receiver<TerminalEvent> {
        self.events.subscribe()
    }

    fn session(&self, process_id: &str) -> Result<Arc<ManagedTerminal>, AppError> {
        self.sessions
            .lock()
            .get(process_id)
            .cloned()
            .ok_or_else(|| AppError::new(ErrorCode::NotFound, "终端会话不存在"))
    }

    fn spawn_reader(&self, process_id: String, mut reader: Box<dyn Read + Send>) {
        let events = self.events.clone();
        let sessions = Arc::clone(&self.sessions);
        thread::Builder::new()
            .name(format!("terminal-reader-{process_id}"))
            .spawn(move || {
                let mut buffer = [0_u8; 16 * 1024];
                loop {
                    match reader.read(&mut buffer) {
                        Ok(0) | Err(_) => break,
                        Ok(count) => {
                            let _ = events.send(TerminalEvent::Output {
                                process_id: process_id.clone(),
                                data: buffer[..count].to_vec(),
                            });
                        }
                    }
                }
                let code = sessions
                    .lock()
                    .remove(&process_id)
                    .and_then(|session| session.child.lock().wait().ok())
                    .and_then(|status| status.exit_code().try_into().ok());
                let _ = events.send(TerminalEvent::Exit(TerminalExit {
                    process_id,
                    code,
                    signal: None,
                }));
            })
            .expect("failed to start terminal reader");
    }
}

fn default_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| {
        if cfg!(windows) {
            "powershell.exe".to_owned()
        } else {
            "/bin/zsh".to_owned()
        }
    })
}

/// The terminal API exists to open an interactive shell for the user, not to
/// run arbitrary programs. Restricting the requested executable to well-known
/// shell names (resolved through the host's normal PATH) keeps `terminal.start`
/// from doubling as a silent process-spawn primitive for a compromised
/// renderer or any other desktop-API caller.
const ALLOWED_SHELLS: &[&str] = &[
    "zsh",
    "bash",
    "fish",
    "sh",
    "dash",
    "nu",
    "pwsh",
    "pwsh.exe",
    "powershell",
    "powershell.exe",
    "cmd",
    "cmd.exe",
];

fn validated_shell(requested: Option<&str>) -> Result<String, AppError> {
    let Some(requested) = requested else {
        return Ok(default_shell());
    };
    let trimmed = requested.trim();
    if trimmed.is_empty() {
        return Ok(default_shell());
    }
    let lowered = trimmed.to_ascii_lowercase();
    if !trimmed.contains(['/', '\\']) && ALLOWED_SHELLS.contains(&lowered.as_str()) {
        return Ok(trimmed.to_owned());
    }
    Err(
        AppError::new(ErrorCode::InvalidRequest, "终端只能启动白名单内的 shell")
            .context("requestedShell", trimmed),
    )
}

impl Drop for TerminalService {
    fn drop(&mut self) {
        if Arc::strong_count(&self.sessions) == 1 {
            self.terminate_all();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::validated_shell;

    #[test]
    fn shell_requests_are_restricted_to_known_shells() {
        // Missing or blank requests fall back to the user's default shell.
        assert!(validated_shell(None).is_ok());
        assert!(validated_shell(Some("  ")).is_ok());
        // Well-known shell names pass, case-insensitively.
        for shell in ["zsh", "bash", "fish", "PowerShell.exe", "pwsh", "cmd"] {
            assert!(validated_shell(Some(shell)).is_ok(), "{shell}");
        }
        // Arbitrary executables, absolute paths, and traversal are rejected.
        for shell in [
            "/bin/zsh",
            "python3",
            "osascript",
            "node",
            "../../usr/bin/env",
            "C:\\Windows\\System32\\calc.exe",
            "zsh/",
        ] {
            assert!(validated_shell(Some(shell)).is_err(), "{shell}");
        }
    }
}
