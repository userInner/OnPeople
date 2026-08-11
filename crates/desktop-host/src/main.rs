use std::{env, path::PathBuf, process::ExitCode, sync::Arc};

use onpeople_core_runtime::CoreRuntime;
use onpeople_desktop_api::{
    DesktopDispatcher, DesktopEvent, DesktopRequest, DesktopResponse, should_forward_desktop_event,
};
use onpeople_storage::Storage;
use onpeople_types::AppError;
use serde::Serialize;
use serde_json::Value;
use tokio::{
    io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader},
    sync::mpsc,
};

#[derive(Debug)]
struct Options {
    data_root: PathBuf,
    runtime_root: PathBuf,
    transport: Transport,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Transport {
    Stdio,
    Socket(PathBuf),
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", content = "payload", rename_all = "camelCase")]
enum HostMessage {
    Response(DesktopResponse),
    Event(DesktopEvent),
}

// A single-thread executor keeps the sidecar's idle footprint small. The
// DesktopDispatcher remains the only business entry point for both transports.
#[tokio::main(flavor = "current_thread")]
async fn main() -> ExitCode {
    let options = match parse_options(env::args().skip(1)) {
        Ok(options) => options,
        Err(error) => {
            eprintln!("onpeople-desktop-host: {error}");
            return ExitCode::FAILURE;
        }
    };

    match run(options).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("onpeople-desktop-host: {error}");
            ExitCode::FAILURE
        }
    }
}

async fn run(options: Options) -> Result<(), AppError> {
    let storage = Storage::open_empty(options.data_root)?;
    let runtime = Arc::new(CoreRuntime::new(storage, options.runtime_root)?);
    let result = match options.transport {
        Transport::Stdio => serve(runtime.clone(), tokio::io::stdin(), tokio::io::stdout()).await,
        Transport::Socket(path) => serve_socket(runtime.clone(), path).await,
    };
    runtime.stop().await;
    result
}

#[cfg(unix)]
async fn serve_socket(runtime: Arc<CoreRuntime>, path: PathBuf) -> Result<(), AppError> {
    use tokio::net::UnixListener;

    if path.exists() {
        std::fs::remove_file(&path).map_err(AppError::internal)?;
    }
    let listener = UnixListener::bind(&path).map_err(AppError::internal)?;
    let result = async {
        let (stream, _) = listener.accept().await.map_err(AppError::internal)?;
        let (reader, writer) = stream.into_split();
        serve(runtime, reader, writer).await
    }
    .await;
    if let Err(error) = std::fs::remove_file(&path)
        && error.kind() != std::io::ErrorKind::NotFound
    {
        eprintln!("onpeople-desktop-host: 无法清理 socket: {error}");
    }
    result
}

#[cfg(not(unix))]
async fn serve_socket(_runtime: Arc<CoreRuntime>, _path: PathBuf) -> Result<(), AppError> {
    Err(AppError::new(
        onpeople_types::ErrorCode::Unsupported,
        "当前平台不支持 Unix Socket transport",
    ))
}

async fn serve<R, W>(runtime: Arc<CoreRuntime>, reader: R, writer: W) -> Result<(), AppError>
where
    R: AsyncRead + Unpin + Send + 'static,
    W: AsyncWrite + Unpin + Send + 'static,
{
    let dispatcher = DesktopDispatcher::new(runtime.clone());
    let (outgoing, mut messages) = mpsc::unbounded_channel::<HostMessage>();
    let writer_task = tokio::spawn(async move {
        let mut writer = writer;
        while let Some(message) = messages.recv().await {
            let mut encoded = serde_json::to_vec(&message).map_err(AppError::internal)?;
            encoded.push(b'\n');
            writer
                .write_all(&encoded)
                .await
                .map_err(AppError::internal)?;
            writer.flush().await.map_err(AppError::internal)?;
        }
        Ok::<(), AppError>(())
    });

    let event_output = outgoing.clone();
    let mut events = runtime.subscribe();
    let event_task = tokio::spawn(async move {
        loop {
            match events.recv().await {
                Ok(event) if should_forward_desktop_event(&event) => {
                    if event_output
                        .send(HostMessage::Event(DesktopEvent::from(event)))
                        .is_err()
                    {
                        break;
                    }
                }
                Ok(_) | Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    });

    let mut lines = BufReader::new(reader).lines();
    while let Some(line) = lines.next_line().await.map_err(AppError::internal)? {
        if line.trim().is_empty() {
            continue;
        }
        let response = match serde_json::from_str::<DesktopRequest>(&line) {
            Ok(request) => dispatcher.dispatch(request).await,
            Err(error) => DesktopResponse::failure(
                extract_request_id(&line),
                AppError::invalid(format!("无效的 DesktopRequest: {error}")),
            ),
        };
        if outgoing.send(HostMessage::Response(response)).is_err() {
            break;
        }
    }

    event_task.abort();
    drop(outgoing);
    writer_task.await.map_err(AppError::internal)??;
    Ok(())
}

fn extract_request_id(line: &str) -> String {
    serde_json::from_str::<Value>(line)
        .ok()
        .and_then(|value| {
            value
                .get("requestId")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
        })
        .unwrap_or_else(|| "malformed-request".to_owned())
}

fn parse_options(mut args: impl Iterator<Item = String>) -> Result<Options, String> {
    let mut data_root = None;
    let mut runtime_root = None;
    let mut transport = Transport::Stdio;
    while let Some(argument) = args.next() {
        match argument.as_str() {
            "--data-root" => {
                data_root = Some(PathBuf::from(args.next().ok_or("--data-root 缺少路径")?));
            }
            "--runtime-root" => {
                runtime_root = Some(PathBuf::from(args.next().ok_or("--runtime-root 缺少路径")?));
            }
            "--socket" => {
                transport =
                    Transport::Socket(PathBuf::from(args.next().ok_or("--socket 缺少路径")?));
            }
            "--help" | "-h" => {
                return Err("用法: onpeople-desktop-host --data-root PATH --runtime-root PATH [--socket PATH]".to_owned());
            }
            _ => return Err(format!("未知参数: {argument}")),
        }
    }

    Ok(Options {
        data_root: data_root.ok_or("必须提供 --data-root")?,
        runtime_root: runtime_root.ok_or("必须提供 --runtime-root")?,
        transport,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use onpeople_storage::Storage;
    use serde_json::json;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

    #[test]
    fn defaults_to_stdio_and_accepts_socket_transport() {
        let stdio = parse_options(
            ["--data-root", "/tmp/data", "--runtime-root", "/tmp/runtime"]
                .into_iter()
                .map(str::to_owned),
        )
        .expect("stdio options");
        assert_eq!(stdio.transport, Transport::Stdio);

        let socket = parse_options(
            [
                "--data-root",
                "/tmp/data",
                "--runtime-root",
                "/tmp/runtime",
                "--socket",
                "/tmp/onpeople.sock",
            ]
            .into_iter()
            .map(str::to_owned),
        )
        .expect("socket options");
        assert_eq!(
            socket.transport,
            Transport::Socket(PathBuf::from("/tmp/onpeople.sock"))
        );
    }

    #[test]
    fn preserves_string_request_id_for_malformed_request() {
        assert_eq!(
            extract_request_id(
                &serde_json::json!({
                    "protocolVersion": onpeople_desktop_api::DESKTOP_PROTOCOL_VERSION,
                    "requestId": "request-42",
                    "method": false
                })
                .to_string()
            ),
            "request-42"
        );
    }

    #[tokio::test]
    async fn stdio_protocol_dispatches_the_versioned_desktop_envelope() {
        let temporary = tempfile::tempdir().expect("temporary root");
        let storage = Storage::open_empty(temporary.path().join("data")).expect("open storage");
        let runtime = Arc::new(
            CoreRuntime::new(storage, temporary.path().join("runtime")).expect("create runtime"),
        );
        let (client, server) = tokio::io::duplex(16 * 1024);
        let (server_reader, server_writer) = tokio::io::split(server);
        let serve_task = tokio::spawn(serve(runtime.clone(), server_reader, server_writer));
        let (client_reader, mut client_writer) = tokio::io::split(client);
        let request = onpeople_desktop_api::DesktopRequest {
            protocol_version: onpeople_desktop_api::DESKTOP_PROTOCOL_VERSION,
            request_id: "stdio-contract-1".to_owned(),
            method: onpeople_desktop_api::DesktopMethod::SystemCapabilities,
            params: json!({}),
        };
        client_writer
            .write_all(
                format!(
                    "{}\n",
                    serde_json::to_string(&request).expect("serialize request")
                )
                .as_bytes(),
            )
            .await
            .expect("write request");

        let mut response = String::new();
        BufReader::new(client_reader)
            .read_line(&mut response)
            .await
            .expect("read response");
        let response: Value = serde_json::from_str(&response).expect("parse host message");
        assert_eq!(response["kind"], "response");
        assert_eq!(response["payload"]["requestId"], "stdio-contract-1");
        assert_eq!(response["payload"]["ok"], true);
        assert!(
            response["payload"]["result"]["methods"]
                .as_array()
                .is_some_and(|methods| !methods.is_empty())
        );

        client_writer
            .shutdown()
            .await
            .expect("close request stream");
        serve_task
            .await
            .expect("join serve task")
            .expect("serve protocol");
        runtime.stop().await;
    }
}
