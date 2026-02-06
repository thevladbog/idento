# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Idento, please report it privately.

**DO NOT** create a public GitHub issue for security vulnerabilities.

### How to Report

1. **Email**: Send details to the repository owner (available on GitHub profile)
2. **GitHub Security**: Use [GitHub's private vulnerability reporting](https://github.com/thevladbog/idento/security/advisories/new)

### What to Include

Please provide:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if you have one)
- Your contact information

### Response Time

- **Initial response**: Within 48 hours
- **Status update**: Within 7 days
- **Fix timeline**: Depends on severity

## Severity Levels

We use the following severity classifications:

- **Critical**: Immediate action required (e.g., remote code execution, data breach)
- **High**: Urgent fix needed (e.g., authentication bypass, SQL injection)
- **Medium**: Should be fixed soon (e.g., XSS, CSRF)
- **Low**: Nice to fix (e.g., information disclosure, minor issues)

## Security Best Practices

When using Idento:

1. **Environment Variables**: Never commit `.env` files or secrets
2. **JWT Secrets**: Use strong, random secrets in production
3. **Database**: Use strong passwords and restrict network access
4. **CORS**: Configure proper CORS origins (not `*`) in production
5. **HTTPS**: Always use HTTPS in production
6. **Updates**: Keep dependencies updated regularly

## Known Security Considerations

- This is a proprietary project - ensure you have proper licensing before deployment
- The default credentials (`admin@test.com` / `password123`) are for development only
- Change all default passwords in production
- Ensure proper network segmentation for printer communications

## Disclosure Policy

- We follow responsible disclosure practices
- We will credit researchers who report vulnerabilities (unless they prefer anonymity)
- We aim to fix critical issues within 30 days
- We will publish security advisories for significant vulnerabilities after fixes are released

## Security Updates

Security updates will be published through:
- GitHub Security Advisories
- Release notes
- Direct notification to known users (for critical issues)

Thank you for helping keep Idento secure!
