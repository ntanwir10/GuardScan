# Security Policy

## Supported Versions

We actively support the following versions of GuardScan with security updates:

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

---

## Reporting a Vulnerability

We take security vulnerabilities seriously. If you discover a security vulnerability in GuardScan, please follow these steps:

### 1. **Do NOT** create a public GitHub issue

Security vulnerabilities should be reported privately to prevent exploitation.

### 2. Email us directly

Send an email to: **<ntanwir10@outlook.com>**

Please include:

- A clear description of the vulnerability
- Steps to reproduce the issue
- Potential impact assessment
- Suggested fix (if you have one)
- Your contact information (optional, for follow-up questions)

### 3. What to expect

- **Response time**: We aim to respond within 48 hours
- **Acknowledgment**: You'll receive confirmation that we received your report
- **Updates**: We'll keep you informed of our progress
- **Resolution**: We'll work to fix the issue as quickly as possible
- **Disclosure**: We'll coordinate with you on public disclosure timing

### 4. Responsible Disclosure

We follow responsible disclosure practices:

- We'll credit you in our security advisories (unless you prefer to remain anonymous)
- We'll work with you to ensure the vulnerability is fixed before public disclosure
- We'll provide a reasonable timeline for fixes based on severity

---

## Security Best Practices

### For Users

1. **Keep GuardScan Updated**

   ```bash
   npm update -g guardscan
   ```

2. **Verify Installation**
   - Only install from official npm registry: `npm install -g guardscan`
   - Verify package integrity: `npm audit guardscan`

3. **API Key Security**
   - Never commit API keys to version control
   - Use environment variables for API keys
   - Rotate API keys regularly
   - Use separate API keys for different projects

4. **Review Generated Reports**
   - Always review security scan reports before acting on them
   - Verify AI-generated suggestions before applying changes
   - Use `--dry-run` flags when available

5. **Network Security**
   - GuardScan works offline for static analysis
   - Only AI features require network access
   - Use `--no-telemetry` if you prefer not to send any data

### For Developers

1. **Dependency Management**
   - We regularly update dependencies
   - We use `npm audit` to check for vulnerabilities
   - We pin dependency versions for stability

2. **Code Review**
   - All code changes require review
   - Security-sensitive changes get additional scrutiny
   - We use automated security scanning in CI/CD

3. **Secrets Management**
   - No secrets in code or configuration files
   - All secrets use environment variables or secure storage
   - Secrets are rotated regularly

---

## Known Security Considerations

### Local Execution

GuardScan executes code analysis **locally** on your machine. This means:

- ✅ Your source code never leaves your machine (for static analysis)
- ✅ No risk of code exposure through network transmission
- ⚠️ GuardScan has read access to files you scan
- ⚠️ Ensure you trust the codebase you're scanning

### AI Provider Integration

When using AI features:

- API keys are stored locally in your configuration
- API keys are sent directly to your chosen AI provider (OpenAI, Anthropic, etc.)
- GuardScan does not store or log your API keys
- Review your AI provider's privacy policy

### Telemetry (Optional)

If telemetry is enabled:

- Only metadata is sent (client_id, repo_id hash, LOC counts)
- No source code is transmitted
- You can disable with `--no-telemetry` flag
- Data is sent to our Cloudflare Workers backend (see PRIVACY.md)

### Dependency Scanning

GuardScan scans your dependencies for known vulnerabilities:

- Uses public vulnerability databases (npm audit, etc.)
- Results are based on publicly available CVE data
- May have false positives or miss zero-day vulnerabilities
- Always verify critical findings independently

---

## Security Features

GuardScan includes several built-in security features:

1. **Secrets Detection** - Finds hardcoded credentials
2. **Dependency Scanning** - Identifies vulnerable packages
3. **OWASP Top 10 Detection** - Common web vulnerabilities
4. **Docker Security** - Container security best practices
5. **Infrastructure as Code** - IaC security scanning
6. **API Security** - REST/GraphQL endpoint analysis

---

## Security Updates

We release security updates as needed:

- **Critical vulnerabilities**: Immediate patch release
- **High severity**: Patch within 7 days
- **Medium severity**: Patch within 30 days
- **Low severity**: Included in next regular release

All security updates are announced via:

- GitHub Releases
- npm package updates
- Security advisories (for critical issues)

---

## Security Contact

For security-related questions or concerns:

- **Email**: <ntanwir10@outlook.com>
- **GitHub Security**: Use GitHub's private vulnerability reporting (if enabled)
- **Response Time**: We aim to respond within 48 hours

---

## Acknowledgments

We appreciate the security research community's efforts to keep GuardScan secure. Security researchers who responsibly disclose vulnerabilities will be credited (unless they prefer anonymity).

---

**Last Updated**: 2025-11-24
