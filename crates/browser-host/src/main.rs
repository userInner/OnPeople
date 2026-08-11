#[cfg(feature = "cef-runtime")]
mod cef_runtime;

#[cfg(feature = "cef-runtime")]
fn main() {
    if let Err(error) = cef_runtime::run() {
        eprintln!("onpeople-browser-host: {}", error);
        std::process::exit(1);
    }
}

#[cfg(not(feature = "cef-runtime"))]
fn main() {
    eprintln!("onpeople-browser-host requires the cef-runtime feature");
    std::process::exit(2);
}
