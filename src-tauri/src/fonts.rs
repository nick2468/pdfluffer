// `read_system_font` (spec 21.4): the Windows font files text editing may embed. No Tauri
// types, so `cargo test` covers the allowlist.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// Regular, bold, italic and bold italic of Arial, Times New Roman, Courier New and Calibri.
/// None restricts embedding (their OS/2 fsType). Nothing else in the Fonts folder is readable.
pub const ALLOWED: [&str; 16] = [
    "arial.ttf", "arialbd.ttf", "ariali.ttf", "arialbi.ttf",
    "times.ttf", "timesbd.ttf", "timesi.ttf", "timesbi.ttf",
    "cour.ttf", "courbd.ttf", "couri.ttf", "courbi.ttf",
    "calibri.ttf", "calibrib.ttf", "calibrii.ttf", "calibriz.ttf",
];

/// True only for a bare name on the allowlist, spelled exactly. So no path, no `..`, no
/// drive, no other folder can ever be named, whatever the caller sends.
pub fn is_allowed(file_name: &str) -> bool {
    ALLOWED.contains(&file_name)
}

/// `%WINDIR%\Fonts`, or `C:\Windows\Fonts` if WINDIR is not set.
pub fn fonts_dir() -> PathBuf {
    let windows = std::env::var_os("WINDIR").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
    windows.join("Fonts")
}

/// Reads an allowlisted font from `dir`: "not-allowed", "not-found" or "io: ...".
pub fn read_font(dir: &Path, file_name: &str) -> Result<Vec<u8>, String> {
    if !is_allowed(file_name) {
        return Err("not-allowed".to_owned());
    }
    fs::read(dir.join(file_name)).map_err(|err| match err.kind() {
        io::ErrorKind::NotFound => "not-found".to_owned(),
        _ => format!("io: {err}"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paths::tests::TempDir;

    #[test]
    fn allows_exactly_the_sixteen_names() {
        for name in ALLOWED {
            assert!(is_allowed(name), "{name}");
        }
        assert_eq!(ALLOWED.len(), 16);
    }

    #[test]
    fn refuses_paths_tricks_and_other_fonts() {
        for name in [
            "",
            "segoeui.ttf",
            "ARIAL.TTF",
            "arial.ttf ",
            " arial.ttf",
            "arial",
            r"..\arial.ttf",
            "../arial.ttf",
            r"..\..\Windows\Fonts\arial.ttf",
            r"C:\Windows\Fonts\arial.ttf",
            "C:/Windows/Fonts/arial.ttf",
            r"\server\share\arial.ttf",
            r"Fonts\arial.ttf",
            "arial.ttf/..",
            "arial.ttf:stream",
            "arial.ttf\0",
            r"\arial.ttf",
        ] {
            assert!(!is_allowed(name), "{name:?} must be refused");
        }
    }

    #[test]
    fn reads_an_allowed_file_and_refuses_the_rest() {
        let dir = TempDir::new("fonts");
        fs::write(dir.0.join("arial.ttf"), b"not really a font").unwrap();
        fs::write(dir.0.join("secret.ttf"), b"must stay unread").unwrap();
        assert_eq!(read_font(&dir.0, "arial.ttf").unwrap(), b"not really a font");
        assert_eq!(read_font(&dir.0, "secret.ttf"), Err("not-allowed".to_owned()));
        assert_eq!(read_font(&dir.0, r"..\arial.ttf"), Err("not-allowed".to_owned()));
        let absolute = dir.0.join("arial.ttf").to_string_lossy().into_owned();
        assert_eq!(read_font(&dir.0, &absolute), Err("not-allowed".to_owned()));
    }

    #[test]
    fn a_missing_allowed_file_is_not_found() {
        let dir = TempDir::new("fonts-missing");
        assert_eq!(read_font(&dir.0, "times.ttf"), Err("not-found".to_owned()));
    }

    #[test]
    fn the_fonts_folder_is_under_windir() {
        assert!(fonts_dir().ends_with("Fonts"));
    }
}
