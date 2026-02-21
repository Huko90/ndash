!macro customUnInstall
  ; Clean up certificate trust and firewall rules installed by nDash.
  ; Read trust state from %APPDATA%\nDash\ndash-trust-state.json
  ReadEnvStr $0 APPDATA
  StrCpy $1 "$0\nDash\ndash-trust-state.json"

  IfFileExists $1 0 skipCleanup

    ; Use PowerShell to parse the trust state and remove cert + firewall rules.
    ; The uninstaller already runs elevated, so these operations succeed without UAC.
    nsExec::ExecToLog 'powershell.exe -ExecutionPolicy Bypass -NoProfile -Command "\
      Set-StrictMode -Version Latest; \
      $$ErrorActionPreference = ''SilentlyContinue''; \
      try { \
        $$state = Get-Content -Raw -Path ''$1'' -ErrorAction Stop | ConvertFrom-Json; \
        if ($$state.thumbprint) { \
          $$cert = Get-ChildItem Cert:\CurrentUser\Root | Where-Object { $$_.Thumbprint -eq $$state.thumbprint }; \
          if ($$cert) { Remove-Item -Path $$cert.PSPath -Force }; \
        }; \
        if ($$state.firewallRuleNames) { \
          foreach ($$name in $$state.firewallRuleNames) { \
            Remove-NetFirewallRule -DisplayName $$name -ErrorAction SilentlyContinue; \
          }; \
        }; \
      } catch { }; \
      Remove-Item -Path ''$1'' -Force -ErrorAction SilentlyContinue; \
    "'

  skipCleanup:
!macroend
