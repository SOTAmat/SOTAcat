# Security Policy

## Supported Versions

SOTAcat uses build-date versioning rather than semantic versioning.
Only the latest firmware release is supported with security updates.

| Version              | Supported          |
| -------------------- | ------------------ |
| Latest release build | :white_check_mark: |
| Older builds         | :x:                |

If you are running an older build, please update to the latest release
before reporting a security issue.

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, use one of the following methods:

1. **GitHub Security Advisories (preferred):** Use the
   [private vulnerability reporting](https://github.com/SOTAmat/SOTAcat/security/advisories/new)
   feature to submit a report directly on GitHub.

2. **Email:** Contact the maintainers at the addresses listed in
   the repository's GitHub profile.

### What to include

- Description of the vulnerability
- Steps to reproduce
- Affected firmware build(s)
- Potential impact

### What to expect

- **Acknowledgment** within 7 days of your report.
- **Status update** within 30 days with an assessment and expected
  timeline for a fix.
- If the vulnerability is accepted, a fix will be developed and
  released as a new firmware build. You will be credited in the
  release notes unless you prefer otherwise.
- If the vulnerability is declined (e.g., out of scope or not
  reproducible), you will receive an explanation.

## Scope

SOTAcat is an ESP32-based embedded device that provides WiFi CAT
control for Elecraft radios. Security considerations include:

- WiFi access point and network communication
- Web interface served by the device
- Serial communication with the connected radio
- Geolocation and self-spotting features
