// File reads and the atomic write (spec 10.3). No Tauri types, so `cargo test` covers them.
// Errors are the strings the JavaScript adapter maps to FileError codes.

use crate::paths::has_pdf_extension;
use std::ffi::OsString;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

/// Windows ERROR_SHARING_VIOLATION and ERROR_LOCK_VIOLATION.
const SHARING_VIOLATION: i32 = 32;
const LOCK_VIOLATION: i32 = 33;

/// "locked" for a permission error or a Windows sharing or lock violation, else "io: ...".
pub fn write_error(err: &io::Error) -> String {
    let locked = err.kind() == io::ErrorKind::PermissionDenied
        || matches!(err.raw_os_error(), Some(SHARING_VIOLATION) | Some(LOCK_VIOLATION));
    if locked { "locked".to_owned() } else { format!("io: {err}") }
}

/// Spec 10.3 `read_pdf`: "not-pdf", "not-found" or "io: ...".
pub fn read_pdf_bytes(path: &Path) -> Result<Vec<u8>, String> {
    if !has_pdf_extension(path) {
        return Err("not-pdf".to_owned());
    }
    fs::read(path).map_err(|err| match err.kind() {
        io::ErrorKind::NotFound => "not-found".to_owned(),
        _ => format!("io: {err}"),
    })
}

/// `<stem>.backup.pdf` beside the target.
pub fn backup_path(target: &Path) -> PathBuf {
    let stem = target.file_stem().unwrap_or_default().to_string_lossy();
    target.with_file_name(format!("{stem}.backup.pdf"))
}

/// `<target>.pdfluffer-tmp` beside the target.
pub fn temp_path(target: &Path) -> PathBuf {
    let mut name = OsString::from(target.as_os_str());
    name.push(".pdfluffer-tmp");
    PathBuf::from(name)
}

/// The spec 10.3 write steps. The original file is unchanged after any failure.
pub fn write_atomic(target: &Path, bytes: &[u8], backup: bool) -> Result<(), String> {
    if !has_pdf_extension(target) {
        return Err("not-pdf".to_owned());
    }
    // (1) One backup, made once, never overwritten.
    if backup && target.is_file() {
        let copy = backup_path(target);
        if !copy.exists() {
            fs::copy(target, &copy).map_err(|err| write_error(&err))?;
        }
    }
    // (2) Write and flush the temporary file. (3) Rename it over the target.
    let temp = temp_path(target);
    let result = write_and_flush(&temp, bytes).and_then(|()| fs::rename(&temp, target));
    // (4) On any failure, delete the temporary file.
    result.map_err(|err| {
        let _ = fs::remove_file(&temp);
        write_error(&err)
    })
}

fn write_and_flush(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut file = fs::File::create(path)?;
    file.write_all(bytes)?;
    file.sync_all()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paths::tests::TempDir;

    fn leftovers(dir: &Path) -> Vec<String> {
        fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|name| name.ends_with(".pdfluffer-tmp"))
            .collect()
    }

    #[test]
    fn write_replaces_an_existing_file() {
        let dir = TempDir::new("write-replace");
        let target = dir.file("form.pdf", b"old bytes");
        write_atomic(&target, b"new bytes", false).unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"new bytes");
        assert!(!backup_path(&target).exists());
        assert!(leftovers(&dir.0).is_empty());
    }

    #[test]
    fn write_creates_a_new_file() {
        let dir = TempDir::new("write-new");
        let target = dir.0.join("new.pdf");
        write_atomic(&target, b"fresh", true).unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"fresh");
        assert!(!backup_path(&target).exists());
        assert!(leftovers(&dir.0).is_empty());
    }

    #[test]
    fn write_makes_the_backup_once_and_never_overwrites_it() {
        let dir = TempDir::new("write-backup");
        let target = dir.file("Form.PDF", b"version 1");
        write_atomic(&target, b"version 2", true).unwrap();
        let copy = dir.0.join("Form.backup.pdf");
        assert_eq!(fs::read(&copy).unwrap(), b"version 1");
        write_atomic(&target, b"version 3", true).unwrap();
        assert_eq!(fs::read(&copy).unwrap(), b"version 1");
        assert_eq!(fs::read(&target).unwrap(), b"version 3");
        assert!(leftovers(&dir.0).is_empty());
    }

    #[test]
    fn write_keeps_an_existing_backup() {
        let dir = TempDir::new("write-old-backup");
        let target = dir.file("a.pdf", b"current");
        let copy = dir.file("a.backup.pdf", b"older backup");
        write_atomic(&target, b"next", true).unwrap();
        assert_eq!(fs::read(&copy).unwrap(), b"older backup");
        assert_eq!(fs::read(&target).unwrap(), b"next");
    }

    #[test]
    fn write_refuses_a_path_that_does_not_end_in_pdf() {
        let dir = TempDir::new("write-not-pdf");
        let target = dir.file("notes.txt", b"keep me");
        assert_eq!(write_atomic(&target, b"x", false), Err("not-pdf".to_owned()));
        assert_eq!(write_atomic(&dir.0.join("a.pdf.exe"), b"x", false), Err("not-pdf".to_owned()));
        assert_eq!(fs::read(&target).unwrap(), b"keep me");
        assert!(!dir.0.join("a.pdf.exe").exists());
    }

    #[test]
    fn write_failure_leaves_no_temp_file_and_the_original_unchanged() {
        let dir = TempDir::new("write-fail");
        // A folder named like the target: the rename over it fails.
        let target = dir.0.join("folder.pdf");
        fs::create_dir_all(target.join("inside")).unwrap();
        let err = write_atomic(&target, b"x", false).unwrap_err();
        assert!(err == "locked" || err.starts_with("io: "), "{err}");
        assert!(target.join("inside").is_dir());
        assert!(leftovers(&dir.0).is_empty());
    }

    #[cfg(windows)]
    #[test]
    fn write_to_a_file_another_program_holds_is_locked() {
        use std::os::windows::fs::OpenOptionsExt;
        let dir = TempDir::new("write-locked");
        let target = dir.file("open.pdf", b"original");
        // Share mode 0: like a program that keeps the file open and shares nothing.
        let holder = fs::OpenOptions::new().read(true).share_mode(0).open(&target).unwrap();
        assert_eq!(write_atomic(&target, b"new", true), Err("locked".to_owned()));
        drop(holder);
        assert_eq!(fs::read(&target).unwrap(), b"original");
        assert!(leftovers(&dir.0).is_empty());
    }

    #[test]
    fn write_error_maps_locks_and_permissions_to_locked() {
        assert_eq!(write_error(&io::Error::from_raw_os_error(32)), "locked");
        assert_eq!(write_error(&io::Error::from_raw_os_error(33)), "locked");
        assert_eq!(write_error(&io::Error::from(io::ErrorKind::PermissionDenied)), "locked");
        assert!(write_error(&io::Error::from(io::ErrorKind::NotFound)).starts_with("io: "));
    }

    #[test]
    fn read_maps_not_pdf_and_not_found() {
        let dir = TempDir::new("read");
        let a = dir.file("a.PDF", b"%PDF-1.7");
        assert_eq!(read_pdf_bytes(&a).unwrap(), b"%PDF-1.7");
        assert_eq!(read_pdf_bytes(&dir.file("a.txt", b"x")), Err("not-pdf".to_owned()));
        assert_eq!(read_pdf_bytes(&dir.0.join("gone.pdf")), Err("not-found".to_owned()));
    }
}
