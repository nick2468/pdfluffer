// Windows' built-in OCR (spec 20.3). No Tauri types here, so `cargo test` covers it all.
// Errors are the strings the TypeScript service maps to OcrError codes: "ocr-unavailable",
// "ocr-too-large" and "ocr: <detail>".
//
// This file reports what the engine said and nothing more. On a skewed picture the engine
// straightens the text first and measures the words on the straightened picture, so the
// rectangles do not sit over the words in the real one. Turning them back needs the page
// geometry, which lives in TypeScript, so chip 12 does it there. The rule itself is proven
// by the tests at the bottom of this file.

use serde::Serialize;
use windows::Globalization::Language;
use windows::Graphics::Imaging::{BitmapAlphaMode, BitmapDecoder, BitmapPixelFormat, SoftwareBitmap};
use windows::Media::Ocr::OcrEngine;
use windows::Storage::Streams::{DataWriter, InMemoryRandomAccessStream};

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OcrStatus {
    pub available: bool,
    pub language: Option<String>,
    pub max_image_dimension: u32,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct Word {
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct Line {
    pub words: Vec<Word>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OcrPageResult {
    pub language: String,
    pub width: u32,
    pub height: u32,
    pub text_angle: Option<f64>,
    pub lines: Vec<Line>,
}

fn failed(err: windows::core::Error) -> String {
    format!("ocr: {}", err.message())
}

/// Spec 20.3: the user's own languages first, then any English one, then whatever there is.
fn engine() -> Option<OcrEngine> {
    if let Ok(engine) = OcrEngine::TryCreateFromUserProfileLanguages() {
        // A null return means no installed language pack does OCR. windows-rs hands that
        // back as an engine whose language cannot be read, so ask before trusting it.
        if engine.RecognizerLanguage().is_ok() {
            return Some(engine);
        }
    }
    let available = OcrEngine::AvailableRecognizerLanguages().ok()?;
    let languages: Vec<Language> = available.into_iter().collect();
    let english = languages.iter().find(|lang| {
        lang.LanguageTag().map(|tag| tag.to_string_lossy().starts_with("en")).unwrap_or(false)
    });
    let chosen = english.or_else(|| languages.first())?;
    OcrEngine::TryCreateFromLanguage(chosen).ok()
}

fn language_of(engine: &OcrEngine) -> Option<String> {
    let language = engine.RecognizerLanguage().ok()?;
    Some(language.LanguageTag().ok()?.to_string_lossy())
}

pub fn status() -> OcrStatus {
    let max_image_dimension = OcrEngine::MaxImageDimension().unwrap_or(0);
    match engine() {
        Some(engine) => OcrStatus {
            available: true,
            language: language_of(&engine),
            max_image_dimension,
        },
        None => OcrStatus { available: false, language: None, max_image_dimension },
    }
}

/// The encoded picture as a stream Windows can decode. JPEG and PNG both work.
fn stream_of(image: &[u8]) -> windows::core::Result<InMemoryRandomAccessStream> {
    let stream = InMemoryRandomAccessStream::new()?;
    let writer = DataWriter::CreateDataWriter(&stream.GetOutputStreamAt(0)?)?;
    writer.WriteBytes(image)?;
    writer.StoreAsync()?.get()?;
    writer.FlushAsync()?.get()?;
    writer.DetachStream()?;
    stream.Seek(0)?;
    Ok(stream)
}

/// The engine wants 8-bit BGRA with premultiplied alpha. A picture already in it is kept.
fn as_bgra8(bitmap: SoftwareBitmap) -> windows::core::Result<SoftwareBitmap> {
    let right_format = bitmap.BitmapPixelFormat()? == BitmapPixelFormat::Bgra8
        && bitmap.BitmapAlphaMode()? == BitmapAlphaMode::Premultiplied;
    if right_format {
        return Ok(bitmap);
    }
    SoftwareBitmap::ConvertWithAlpha(&bitmap, BitmapPixelFormat::Bgra8, BitmapAlphaMode::Premultiplied)
}

pub fn recognise(image: &[u8]) -> Result<OcrPageResult, String> {
    let engine = engine().ok_or_else(|| "ocr-unavailable".to_owned())?;
    let language = language_of(&engine).ok_or_else(|| "ocr-unavailable".to_owned())?;
    let limit = OcrEngine::MaxImageDimension().map_err(failed)?;

    let stream = stream_of(image).map_err(failed)?;
    let decoder = BitmapDecoder::CreateAsync(&stream).map_err(failed)?.get().map_err(failed)?;
    // Asked of the decoder, not of a decoded bitmap: a picture too big to accept is also
    // too big to be worth turning into pixels.
    let width = decoder.PixelWidth().map_err(failed)?;
    let height = decoder.PixelHeight().map_err(failed)?;
    if width > limit || height > limit {
        return Err("ocr-too-large".to_owned());
    }

    let bitmap = decoder.GetSoftwareBitmapAsync().map_err(failed)?.get().map_err(failed)?;
    let bitmap = as_bgra8(bitmap).map_err(failed)?;
    let result = engine.RecognizeAsync(&bitmap).map_err(failed)?.get().map_err(failed)?;

    // TextAngle is null on a picture the engine saw no rotation in.
    let text_angle = result.TextAngle().ok().and_then(|angle| angle.Value().ok());

    let mut lines = Vec::new();
    for line in result.Lines().map_err(failed)? {
        let mut words = Vec::new();
        for word in line.Words().map_err(failed)? {
            let rect = word.BoundingRect().map_err(failed)?;
            words.push(Word {
                text: word.Text().map_err(failed)?.to_string_lossy(),
                x: rect.X as f64,
                y: rect.Y as f64,
                w: rect.Width as f64,
                h: rect.Height as f64,
            });
        }
        lines.push(Line { words });
    }
    Ok(OcrPageResult { language, width, height, text_angle, lines })
}



#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;
    use std::fs;
    use std::path::PathBuf;

    /// What the fixtures script measured in the page itself (plan P4.1).
    #[derive(Deserialize)]
    struct Truth {
        width: u32,
        height: u32,
        #[serde(rename = "rotationDeg")]
        rotation_deg: f64,
        words: Vec<TruthWord>,
    }

    #[derive(Deserialize, Clone)]
    struct TruthWord {
        text: String,
        cx: f64,
        cy: f64,
    }

    /// Every word of a result, in reading order, with its centre.
    fn centres(result: &OcrPageResult) -> Vec<(String, f64, f64)> {
        result
            .lines
            .iter()
            .flat_map(|line| &line.words)
            .map(|w| (w.text.clone(), w.x + w.w / 2.0, w.y + w.h / 2.0))
            .collect()
    }

    fn fixtures() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("samples").join("ocr")
    }

    fn picture(name: &str) -> Vec<u8> {
        fs::read(fixtures().join(name)).unwrap_or_else(|e| panic!("{name}: {e}"))
    }

    fn truth(name: &str) -> Truth {
        serde_json::from_slice(&picture(name)).unwrap()
    }

    /// Spec 20.3 allows a machine with no OCR language. Say so and skip, never fail.
    fn skip_without_engine() -> bool {
        if engine().is_some() {
            return false;
        }
        println!("SKIPPED: this machine has no installed language pack with OCR.");
        true
    }

    /// How far each expected word is from the nearest reading of the same word.
    fn errors(found: &[(String, f64, f64)], expected: &[TruthWord]) -> Vec<f64> {
        expected
            .iter()
            .map(|want| {
                found
                    .iter()
                    .filter(|(text, _, _)| *text == want.text)
                    .map(|(_, x, y)| (x - want.cx).hypot(y - want.cy))
                    .fold(f64::INFINITY, f64::min)
            })
            .collect()
    }

    /// The share of expected words read with exactly the right text, near the right place.
    fn share_placed(found: &[(String, f64, f64)], expected: &[TruthWord], tolerance: f64) -> f64 {
        let near = errors(found, expected).iter().filter(|e| **e <= tolerance).count();
        near as f64 / expected.len() as f64
    }

    fn worst(found: &[(String, f64, f64)], expected: &[TruthWord]) -> f64 {
        errors(found, expected).iter().cloned().fold(0.0, f64::max)
    }

    /// Turns a point by `degrees` clockwise about `origin`, with y pointing down.
    fn turned(point: (f64, f64), origin: (f64, f64), degrees: f64) -> (f64, f64) {
        let a = degrees.to_radians();
        let (dx, dy) = (point.0 - origin.0, point.1 - origin.1);
        (origin.0 + dx * a.cos() - dy * a.sin(), origin.1 + dx * a.sin() + dy * a.cos())
    }

    fn turn_all(
        found: &[(String, f64, f64)],
        origin: (f64, f64),
        degrees: f64,
    ) -> Vec<(String, f64, f64)> {
        found
            .iter()
            .map(|(text, x, y)| {
                let (mx, my) = turned((*x, *y), origin, degrees);
                (text.clone(), mx, my)
            })
            .collect()
    }

    /// The reading of `text` nearest to where that word really is.
    fn nearest(found: &[(String, f64, f64)], word: &TruthWord) -> Option<(f64, f64)> {
        found
            .iter()
            .filter(|(text, _, _)| *text == word.text)
            .map(|(_, x, y)| (*x, *y))
            .min_by(|a, b| {
                let d = |p: &(f64, f64)| (p.0 - word.cx).hypot(p.1 - word.cy);
                d(a).partial_cmp(&d(b)).unwrap()
            })
    }

    /// Four corners of the text block and one word in the middle. A turn barely moves the
    /// middle one and moves the corners most, so these five separate the candidate rules.
    fn spread(want: &Truth) -> Vec<TruthWord> {
        let pick = |score: fn(&TruthWord) -> f64| -> TruthWord {
            want.words.iter().max_by(|a, b| score(a).partial_cmp(&score(b)).unwrap()).unwrap().clone()
        };
        vec![
            pick(|w| -(w.cx + w.cy)),
            pick(|w| w.cx - w.cy),
            pick(|w| w.cy - w.cx),
            pick(|w| w.cx + w.cy),
            pick(|w| -((w.cx - 800.0).abs() + (w.cy - 600.0).abs())),
        ]
    }

    #[test]
    fn status_reports_a_language_and_a_size_limit() {
        let status = status();
        if !status.available {
            println!("SKIPPED: this machine has no installed language pack with OCR.");
            return;
        }
        println!("OCR language {:?}, max dimension {}", status.language, status.max_image_dimension);
        assert!(status.language.is_some());
        assert!(status.max_image_dimension > 1000, "{}", status.max_image_dimension);
    }

    #[test]
    fn reads_a_straight_picture_and_places_the_words() {
        if skip_without_engine() {
            return;
        }
        let expected = truth("straight.json");
        let result = recognise(&picture("straight.png")).unwrap();
        assert_eq!((result.width, result.height), (expected.width, expected.height));
        assert_eq!(expected.rotation_deg, 0.0);

        let share = share_placed(&centres(&result), &expected.words, 12.0);
        println!("straight: {:.1}% of {} words placed", share * 100.0, expected.words.len());
        assert!(share >= 0.9, "only {:.1}% placed", share * 100.0);

        match result.text_angle {
            None => {}
            Some(angle) => assert!(angle.abs() <= 0.3, "text angle {angle} on a straight picture"),
        }
    }

    #[test]
    fn a_picture_larger_than_the_limit_is_refused() {
        if skip_without_engine() {
            return;
        }
        assert_eq!(recognise(&picture("too-large.png")), Err("ocr-too-large".to_owned()));
    }

    #[test]
    fn bytes_that_are_not_a_picture_give_an_error_not_a_panic() {
        if skip_without_engine() {
            return;
        }
        let err = recognise(b"this is not a picture at all").unwrap_err();
        assert!(err.starts_with("ocr: "), "{err}");
    }

    /// Plan P4.3, the answer. Settled on 2026-09-21 against the two skewed pictures, both
    /// ways round, and written up as decision 16 in BUILD-NOTES.
    ///
    /// **Turn the reported centre by `+text_angle` clockwise about the picture's centre**,
    /// with y pointing down. In plain words: the engine straightens the picture before it
    /// measures, turning it anticlockwise by the angle it reports, so putting a word back
    /// over the real page means turning it clockwise by that same angle.
    ///
    /// Chip 12 does this in TypeScript, where the page geometry lives. `recognise` returns
    /// what the engine said and maps nothing.
    #[test]
    fn the_skew_rule_puts_the_words_back_over_the_page() {
        if skip_without_engine() {
            return;
        }
        for name in ["skew-cw2", "skew-ccw2"] {
            let want = truth(&format!("{name}.json"));
            let got = recognise(&picture(&format!("{name}.png"))).unwrap();
            let angle = got.text_angle.unwrap_or_else(|| panic!("{name}: no text angle"));
            // The sign follows the page: a page turned clockwise reports a positive angle.
            assert!(
                (angle - want.rotation_deg).abs() <= 0.5,
                "{name}: engine said {angle}, the page is turned {}",
                want.rotation_deg
            );

            let centre = (got.width as f64 / 2.0, got.height as f64 / 2.0);
            let moved = turn_all(&centres(&got), centre, angle);
            let share = share_placed(&moved, &want.words, 12.0);
            println!(
                "{name}: {:.1}% of {} words placed, worst {:.1} px",
                share * 100.0,
                want.words.len(),
                worst(&moved, &want.words)
            );
            assert!(share >= 0.9, "{name}: only {:.1}% placed", share * 100.0);
        }
    }

    /// Plan P4.3, the working. This prints the table that went into BUILD-NOTES and tries
    /// every candidate rule. `cargo test skew_table -- --nocapture` to see it again.
    #[test]
    fn skew_table() {
        if skip_without_engine() {
            return;
        }
        for name in ["skew-cw2", "skew-ccw2"] {
            let want = truth(&format!("{name}.json"));
            let got = recognise(&picture(&format!("{name}.png"))).unwrap();
            println!("\n== {name}.png, the page turned {} deg ==", want.rotation_deg);
            println!("engine text_angle: {:?}", got.text_angle);
            let Some(angle) = got.text_angle else {
                println!("NULL ANGLE on a 2 degree skew: nothing to map with.");
                continue;
            };
            let found = centres(&got);
            let centre = (got.width as f64 / 2.0, got.height as f64 / 2.0);

            println!("{:<12} {:>19} {:>19}", "word", "reported centre", "true centre");
            for word in spread(&want) {
                match nearest(&found, &word) {
                    Some((rx, ry)) => println!(
                        "{:<12} {:>9.1},{:>9.1} {:>9.1},{:>9.1}",
                        word.text, rx, ry, word.cx, word.cy
                    ),
                    None => println!("{:<12} not read", word.text),
                }
            }

            for (label, origin, signed) in [
                ("turn by +text_angle about the centre", centre, angle),
                ("turn by -text_angle about the centre", centre, -angle),
                ("leave it where it is", centre, 0.0),
                ("turn by +text_angle about the top left", (0.0, 0.0), angle),
                ("turn by -text_angle about the top left", (0.0, 0.0), -angle),
            ] {
                let moved = turn_all(&found, origin, signed);
                println!(
                    "  {:<40} {:>5.1}% within 12 px, worst {:>7.1}",
                    label,
                    share_placed(&moved, &want.words, 12.0) * 100.0,
                    worst(&moved, &want.words),
                );
            }
        }
    }
}
