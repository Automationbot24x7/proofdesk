# VPN and Remote Access

Kestrel Works · IT Service Desk knowledge base
Article KB-0142 · Last reviewed 12 August 2026
Owner: IT Service Desk (it-help@kestrelworks.example)

## When you need the VPN

Connect to the company VPN to reach internal systems such as the HR portal, the expense tool and code repositories from outside the office. Email, chat and the travel portal work without the VPN.

## Connecting

Open the Kestrel Connect client from the system tray, choose the gateway nearest to you (Bengaluru, Manchester or Virginia) and sign in with your work account. Multi-factor authentication is required for every connection.

## If the VPN keeps disconnecting

Frequent disconnects are usually caused by a stale network adapter or a stuck client service. On a company Windows laptop, open PowerShell and run the reset script below. It restarts the Kestrel Connect service, resets the virtual network adapter and clears the DNS cache. It does not change any security settings.

```powershell
# KB-0142 · Reset Kestrel Connect on this laptop only
Restart-Service -Name "KestrelConnect" -Force
Get-NetAdapter -InterfaceDescription "Kestrel Virtual Adapter*" | Restart-NetAdapter -Confirm:$false
Clear-DnsClientCache
Get-Service -Name "KestrelConnect" | Select-Object Name, Status
```

If the client still disconnects more than twice in an hour after the reset, raise a ticket with the IT Service Desk and include the time of each disconnect.

## Travelling abroad

The VPN works from most countries. In countries listed on the security page, VPN access is blocked and company data must not be accessed.
