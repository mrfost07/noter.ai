//! Bounded HTTP proof that the smoke window selected the bundled application.

use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::{Duration, Instant};

fn validate_smoke_http_page(response: &[u8]) -> Result<(), String> {
    let response = String::from_utf8_lossy(response);
    let (headers, body) = response
        .split_once("\r\n\r\n")
        .ok_or("The selected local server returned an incomplete HTTP response.")?;
    let status = headers.lines().next().unwrap_or_default();
    if !status.starts_with("HTTP/1.") || status.split_whitespace().nth(1) != Some("200") {
        return Err(
            "The selected local server did not return HTTP 200 for its application page.".into(),
        );
    }
    if !headers
        .to_ascii_lowercase()
        .contains("content-type: text/html")
        || !body.contains("<title>Noter.ai</title>")
        || !body.contains("id=\"root\"")
        || !body.contains("type=\"module\"")
    {
        return Err(
            "The selected local server did not return the bundled Noter.ai application page."
                .into(),
        );
    }
    Ok(())
}

pub(crate) fn verify_smoke_http_page(port: u16) -> Result<(), String> {
    let address = format!("127.0.0.1:{port}")
        .parse()
        .map_err(|_| "Invalid selected loopback address.".to_string())?;
    let mut stream =
        TcpStream::connect_timeout(&address, Duration::from_secs(1)).map_err(|_| {
            "Could not connect to the selected local server for HTTP verification.".to_string()
        })?;
    stream
        .set_write_timeout(Some(Duration::from_secs(1)))
        .map_err(|error| error.to_string())?;
    stream
        .write_all(
            format!("GET / HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n")
                .as_bytes(),
        )
        .map_err(|_| "Could not request the selected local application page.".to_string())?;
    let deadline = Instant::now() + Duration::from_secs(3);
    let mut response = Vec::new();
    let mut buffer = [0; 4096];
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err("HTTP verification of the local application page timed out.".into());
        }
        stream
            .set_read_timeout(Some(remaining))
            .map_err(|error| error.to_string())?;
        let count = stream
            .read(&mut buffer)
            .map_err(|_| "Could not read the local application HTTP response.".to_string())?;
        if count == 0 {
            break;
        }
        response.extend_from_slice(&buffer[..count]);
        if response.len() > 512 * 1024 {
            return Err(
                "The local application HTTP response exceeded the smoke-test limit.".into(),
            );
        }
    }
    validate_smoke_http_page(&response)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn smoke_http_proof_rejects_error_and_unrelated_pages() {
        let body = "<html><title>Noter.ai</title><div id=\"root\"></div><script type=\"module\"></script></html>";
        let response =
            format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\r\n{body}");
        assert!(validate_smoke_http_page(response.as_bytes()).is_ok());
        assert!(
            validate_smoke_http_page(response.replace("200 OK", "404 Not Found").as_bytes())
                .is_err()
        );
        assert!(
            validate_smoke_http_page(response.replace("Noter.ai", "Unrelated app").as_bytes())
                .is_err()
        );
        assert!(validate_smoke_http_page(
            response.replace("text/html", "application/json").as_bytes()
        )
        .is_err());
        assert!(validate_smoke_http_page(b"HTTP/1.1 200 OK\r\n").is_err());
    }
}
