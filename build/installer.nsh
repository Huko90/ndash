!macro customUnInstall
  ; Clean up certificate trust and firewall rules installed by nDash.
  ; Read trust state from %APPDATA%\<productName>\ndash-trust-state.json
  ReadEnvStr $0 APPDATA
  StrCpy $1 "$0\${PRODUCT_NAME}\ndash-trust-state.json"

  IfFileExists $1 0 skipCleanup

    ; Write a temporary .ps1 script to avoid inline escaping issues.
    ; This safely handles paths containing single quotes or special characters.
    StrCpy $2 "$TEMP\ndash-uninstall-cleanup.ps1"
    FileOpen $3 $2 w
    FileWrite $3 "Set-StrictMode -Version Latest$\r$\n"
    FileWrite $3 "$$ErrorActionPreference = 'SilentlyContinue'$\r$\n"
    FileWrite $3 "try {$\r$\n"
    FileWrite $3 "  $$state = Get-Content -Raw -LiteralPath '$1' -ErrorAction Stop | ConvertFrom-Json$\r$\n"
    FileWrite $3 "  if ($$state.thumbprint) {$\r$\n"
    FileWrite $3 "    $$cert = Get-ChildItem Cert:\CurrentUser\Root | Where-Object { $$_.Thumbprint -eq $$state.thumbprint }$\r$\n"
    FileWrite $3 "    if ($$cert) { Remove-Item -Path $$cert.PSPath -Force }$\r$\n"
    FileWrite $3 "  }$\r$\n"
    FileWrite $3 "  if ($$state.firewallRuleNames) {$\r$\n"
    FileWrite $3 "    foreach ($$name in $$state.firewallRuleNames) {$\r$\n"
    FileWrite $3 "      Remove-NetFirewallRule -DisplayName $$name -ErrorAction SilentlyContinue$\r$\n"
    FileWrite $3 "    }$\r$\n"
    FileWrite $3 "  }$\r$\n"
    FileWrite $3 "} catch { }$\r$\n"
    FileWrite $3 "Remove-Item -LiteralPath '$1' -Force -ErrorAction SilentlyContinue$\r$\n"
    FileClose $3

    ; Execute the cleanup script (uninstaller already runs elevated)
    nsExec::ExecToLog 'powershell.exe -ExecutionPolicy Bypass -NoProfile -File "$2"'
    Delete $2

  skipCleanup:

  ; Remove app data directory (config, certs, logs) for a clean reinstall
  ReadEnvStr $0 APPDATA
  RMDir /r "$0\${PRODUCT_NAME}"
!macroend
