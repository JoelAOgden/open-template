fn main() {
    println!(
        "cargo:rustc-env=OPEN_TEMPLATE_TARGET={}",
        std::env::var("TARGET").unwrap()
    );
    tauri_build::build();
}
