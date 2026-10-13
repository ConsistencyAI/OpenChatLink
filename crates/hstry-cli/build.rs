fn main() {
    // Clap's generated command parser exceeds the default Windows stack in debug
    // builds. Reserve 8 MiB for this executable; do not change dependency stacks.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc")
    {
        println!("cargo:rustc-link-arg-bin=hstry=/STACK:8388608");
    }
    println!("cargo:rerun-if-changed=build.rs");
}
