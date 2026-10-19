# ThinkPad Ryzen

Internal URL: http://pi-web-ryzen.tpk (NetBird only). AdGuard rewrite points to
100.101.143.202. No Cloudflare Tunnel route or public DNS record.

Pi Web runs as host user `ndjoe`, preserving `/home/ndjoe/.pi` and host tools.
The system service binds only to the Uncloud bridge, `10.210.0.1:30141`.
A machine-pinned Uncloud proxy provides ingress; Caddy rejects non-VPN peers
using their direct address, not forwarded headers. Password authentication is
also required. HTTP is protected in transit by the trusted VPN, not TLS.

## Install

Clone this repository into `/home/ndjoe/codes/pi-web`, run `npm ci` and
`npm run build` there. Never build over a running instance: stop the service
and preserve the old `.next` first, or build in a separate release directory.
Do not build in the operator Mac's dev checkout.

Store `PI_WEB_PASSWORD=<random password>` in
`/home/ndjoe/.config/pi-web/environment` (directory 0700, file 0600).
Never commit this file. Install `pi-web.service` into `/etc/systemd/system/`,
then run `sudo systemctl daemon-reload` and `sudo systemctl enable --now pi-web`.
Deploy ingress from this directory:

```sh
uc --context default deploy -f compose.yaml --yes
```

For updates, build a fresh checkout first, stop `pi-web`, switch the checkout,
and start it. Retain the previous checkout for rollback. Stop interrupts active
agent sessions; inspect `/api/agent/running` before maintenance. Systemd's
control-group shutdown also terminates child processes.

## Verify

- `systemctl is-enabled pi-web` and `systemctl is-active pi-web`.
- Internal `/login` returns 200; unauthenticated `/api/agent/running` returns 401.
- Authenticated `/api/agent/running` returns valid JSON without sending a prompt.
- DNS resolves to 100.101.143.202 over both UDP and TCP.
- A non-VPN direct peer gets 403, even with a forged forwarded client address.
- No running Paseo processes or enabled Paseo services; retain `~/.paseo` data.

Retrieve the login password privately over SSH from the protected environment
file. This deployment does not copy credentials from the operator Mac.
