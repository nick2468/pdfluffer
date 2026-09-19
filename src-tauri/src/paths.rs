// Pure path helpers (spec 10.3 and 10.4). No Tauri types, so `cargo test` covers them.

use std::path::Path;

/// True when the path's extension is `pdf`, in any case.
pub fn has_pdf_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("pdf"))
}

/// The spec 10.3 rule. Canonicalise an existing path. For a file that does not exist yet,
/// canonicalise its parent folder and re-attach the file name. None if neither resolves.
pub fn normalise(path: &Path) -> Option<String> {
    if let Ok(full) = dunce::canonicalize(path) {
        return full.to_str().map(str::to_owned);
    }
    let name = path.file_name()?;
    let parent = path.parent().filter(|p| !p.as_os_str().is_empty())?;
    let full = dunce::canonicalize(parent).ok()?.join(name);
    full.to_str().map(str::to_owned)
}

/// Spec 10.4. Skip the exe and any flag. Resolve relative paths against `cwd`. Keep only
/// existing files with a `pdf` extension, normalised.
pub fn parse_pdf_args(args: &[String], cwd: &Path) -> Vec<String> {
    args.iter()
        .skip(1)
        .filter(|arg| !arg.starts_with('-'))
        .map(|arg| cwd.join(arg))
        .filter(|path| has_pdf_extension(path) && path.is_file())
        .filter_map(|path| normalise(&path))
        .collect()
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    /// A unique folder under the temp folder, removed when the value drops.
    pub struct TempDir(pub PathBuf);

    impl TempDir {
        pub fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("pdfluffer-test-{}-{}", std::process::id(), name));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).unwrap();
            TempDir(dir)
        }

        pub fn file(&self, relative: &str, bytes: &[u8]) -> PathBuf {
            let path = self.0.join(relative);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, bytes).unwrap();
            path
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn canonical(path: &Path) -> String {
        dunce::canonicalize(path).unwrap().to_str().unwrap().to_owned()
    }

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn parse_skips_the_exe() {
        let dir = TempDir::new("skip-exe");
        let a = dir.file("a.pdf", b"%PDF");
        let a = a.to_str().unwrap();
        assert!(parse_pdf_args(&args(&[a]), &dir.0).is_empty());
        assert_eq!(parse_pdf_args(&args(&[a, a]), &dir.0), vec![canonical(&dir.0.join("a.pdf"))]);
    }

    #[test]
    fn parse_ignores_flags() {
        let dir = TempDir::new("flags");
        dir.file("a.pdf", b"%PDF");
        dir.file("-b.pdf", b"%PDF");
        let result = parse_pdf_args(&args(&["exe", "--minimised", "-b.pdf", "a.pdf"]), &dir.0);
        assert_eq!(result, vec![canonical(&dir.0.join("a.pdf"))]);
    }

    #[test]
    fn parse_keeps_pdf_in_any_case() {
        let dir = TempDir::new("case");
        let upper = dir.file("UPPER.PDF", b"%PDF");
        let mixed = dir.file("mixed.Pdf", b"%PDF");
        let result = parse_pdf_args(
            &args(&["exe", upper.to_str().unwrap(), mixed.to_str().unwrap()]),
            &dir.0,
        );
        assert_eq!(result, vec![canonical(&upper), canonical(&mixed)]);
    }

    #[test]
    fn parse_drops_missing_and_non_pdf_files() {
        let dir = TempDir::new("drops");
        let a = dir.file("a.pdf", b"%PDF");
        dir.file("notes.txt", b"text");
        dir.file("pdf", b"no extension");
        fs::create_dir_all(dir.0.join("folder.pdf")).unwrap();
        let result = parse_pdf_args(
            &args(&["exe", "missing.pdf", "notes.txt", "pdf", "folder.pdf", a.to_str().unwrap()]),
            &dir.0,
        );
        assert_eq!(result, vec![canonical(&a)]);
    }

    #[test]
    fn parse_resolves_a_relative_path_against_cwd() {
        let dir = TempDir::new("relative");
        let c = dir.file("sub/c.pdf", b"%PDF");
        let result = parse_pdf_args(&args(&["exe", "sub\\c.pdf", "./sub/../sub/c.pdf"]), &dir.0);
        assert_eq!(result, vec![canonical(&c), canonical(&c)]);
    }

    #[test]
    fn normalise_canonicalises_an_existing_file() {
        let dir = TempDir::new("norm-existing");
        let a = dir.file("a.pdf", b"%PDF");
        let messy = dir.0.join("sub").join("..").join(".").join("a.pdf");
        fs::create_dir_all(dir.0.join("sub")).unwrap();
        assert_eq!(normalise(&messy), Some(canonical(&a)));
        assert!(!normalise(&messy).unwrap().starts_with(r"\\?\"));
    }

    #[test]
    fn normalise_keeps_a_new_file_in_an_existing_folder() {
        let dir = TempDir::new("norm-new");
        let target = dir.0.join(".").join("new.pdf");
        let expected = Path::new(&canonical(&dir.0)).join("new.pdf");
        assert_eq!(normalise(&target), Some(expected.to_str().unwrap().to_owned()));
    }

    #[test]
    fn normalise_drops_a_path_that_cannot_be_resolved() {
        let dir = TempDir::new("norm-none");
        assert_eq!(normalise(&dir.0.join("no-such-folder").join("x.pdf")), None);
        assert_eq!(normalise(Path::new("")), None);
    }
}
