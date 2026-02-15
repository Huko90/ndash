# Certificate Setup (Client Devices)

For HTTPS dashboard access from browsers, install the generated cert from:
- `http://<dashboard-ip>:<http-port>/dashboard-cert.crt`

## Windows
1. Download/open `.crt`
2. Install Certificate
3. Current User
4. Place in `Trusted Root Certification Authorities`

## Android
1. Download cert file
2. Install as CA certificate in security settings
3. Open dashboard HTTPS URL

## Notes
- Electron desktop app can work without browser cert install.
- Browsers require trust setup for self-signed certs.
