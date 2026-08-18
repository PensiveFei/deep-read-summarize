# Security Policy

## Reporting a Vulnerability

Please do **not** open a public issue for security vulnerabilities.

To report a vulnerability privately:

1. Open a [private security advisory](https://github.com/<your-org>/deep-read-summarize/security/advisories/new) (if available), or
2. Email the maintainer (see repository profile for contact).

## What to include

- Affected version / commit
- Steps to reproduce
- Impact description
- Suggested fix (optional)

## Response timeline

- Acknowledgment within 3 business days
- Initial assessment within 7 business days
- Fix and release within 30 days (depending on severity)

## Scope

This project only ships workflow code, prompt templates, and schemas. It does not contain copyrighted content or secrets. Vulnerabilities of interest include prompt injection in parser prompts, sandbox escape attempts, and unsafe file handling.