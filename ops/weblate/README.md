# Weblate

[Weblate](https://weblate.org) lets players translate Turnip Tycoon in the browser. It reads the catalogs in `src/client/locales` from `main` and sends changes back as pull requests from a bot account's fork, so CI checks every change and nothing reaches `main` without review.

This guide sets it up for this repository, or for a fork of it, on any Linux server that runs Docker. Steps 1–8 run the server. Steps 9 and 10 configure Weblate for this project; on [Hosted Weblate](https://hosted.weblate.org) they're the only steps you need, together with Hosted Weblate's own instructions for GitHub access in place of step 5.

Throughout, replace `translate.example.com` with the domain Weblate will run on, and `OWNER/REPO` with the repository it translates: `Rakantor/turnip-tycoon` or your fork.

## What you need

- A Linux server with Docker Engine and the Compose plugin, at least 2 CPU cores and 4 GB of memory. Weblate's minimum is 3 GB.
- A domain or subdomain for Weblate, with DNS you can edit.
- An SMTP service that can send mail for a domain you control: a transactional mail provider or your own mail server.
- A second GitHub account to act as the bot.

## Setup

### 1. Prepare the server

```bash
docker compose version
free -h
```

- If `docker compose version` fails, [install Docker Engine](https://docs.docker.com/engine/install/).
- On a 4 GB server without swap, add 2 GB so a busy moment doesn't kill a process:

  ```bash
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
  sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
  ```

- If you use the bundled Caddy (step 6), allow incoming TCP ports 80 and 443, and UDP 443 for HTTP/3, in the server's firewall. The other options use the ports your proxy already serves.

### 2. Point the domain at the server

Add an `A` record for `translate.example.com` with the server's IPv4 address, and an `AAAA` record with its IPv6 address if it has one. If your DNS host can proxy traffic, as Cloudflare does, set this record to DNS only. That way the bundled Caddy can get its certificate. If you already proxy your other sites that way, match how they're set up.

### 3. Set up email

Weblate sends sign-up confirmations, password resets and notifications.

1. From your mail service, note the SMTP host, port, username and password. They go in the `WEBLATE_EMAIL_*` settings in step 7.
2. Choose a sender address on a domain the service is set up to send for, and add the SPF and DKIM records it lists. With them, mail passes the domain's DMARC policy, even a strict one.
3. Use port 587 with STARTTLS, as `env.example` does. Several cloud providers, Hetzner among them, block outgoing connections to ports 25 and 465. Weblate then reports `Cannot send e-mail (timed out)` (`weblate.E003`) in its log.

### 4. GitHub sign-in (optional)

Anyone can sign up by email. To offer GitHub sign-in as well, create an OAuth app under GitHub → Settings → Developer settings → OAuth Apps:

| Field                      | Value                                                      |
| -------------------------- | ---------------------------------------------------------- |
| Application name           | your instance's name, such as "Turnip Tycoon Translations" |
| Homepage URL               | `https://translate.example.com`                            |
| Authorization callback URL | `https://translate.example.com/accounts/complete/github/`  |

Generate a client secret. The client ID goes in `WEBLATE_SOCIAL_AUTH_GITHUB_KEY` and the secret in `WEBLATE_SOCIAL_AUTH_GITHUB_SECRET`.

### 5. A bot account for pull requests

Weblate forks the repository into this account and opens pull requests from there. The bot never gets write access to `OWNER/REPO`, so a mistake in Weblate can't touch `main`.

1. In a private browser window, create a GitHub account for the bot. Gmail delivers `you+weblate@gmail.com` to `you@gmail.com`, so a plus address can serve as its email.
2. Turn on two-factor authentication for it.
3. Signed in as the bot, open Settings → Developer settings → Personal access tokens → Tokens (classic). Generate a token with only the `public_repo` scope and an expiry date, and note when it expires. It has to be classic: a fine-grained token only reaches repositories its own account owns, and the pull requests open in `OWNER/REPO`.

The username goes in `WEBLATE_GITHUB_USERNAME` and the token in `WEBLATE_GITHUB_TOKEN`. Don't add the bot as a collaborator.

### 6. Choose how HTTPS reaches Weblate

Weblate serves plain HTTP on port 8080 inside its container and expects a reverse proxy to handle HTTPS. Pick the option that fits your server; step 7 sets it through `COMPOSE_FILE` in `.env`.

| Your server                                 | Add to `COMPOSE_FILE`        | Your proxy forwards to                 |
| ------------------------------------------- | ---------------------------- | -------------------------------------- |
| Nothing on ports 80 and 443 yet             | `compose.caddy.yaml`         | (bundled Caddy, nothing to configure)  |
| A proxy installed on the server             | `compose.localhost.yaml`     | `127.0.0.1:8080` (`WEBLATE_HOST_PORT`) |
| A proxy running in its own Docker container | `compose.proxy-network.yaml` | `weblate:8080`                         |

Whatever proxy you use, it must pass the `Host` header through and set `X-Forwarded-For` to the client's address and `X-Forwarded-Proto` to `https`. Caddy does all three by default:

```caddyfile
translate.example.com {
	encode zstd gzip
	reverse_proxy 127.0.0.1:8080
}
```

With nginx, inside the `server` block that holds your certificate for `translate.example.com`:

```nginx
client_max_body_size 100m;
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 300s;
}
```

For a proxy in a container, use `weblate:8080` instead of `127.0.0.1:8080`, and find the proxy container's name and networks:

```bash
docker ps --format '{{.Names}}  {{.Image}}'
docker inspect PROXY_CONTAINER --format '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}'
```

That network goes in `PROXY_NETWORK`. If the only network listed is `bridge`, Docker's default, container names don't resolve on it. Create a network and connect the proxy to it. Add the network to the proxy's own Compose file as well, so the connection survives a restart:

```bash
docker network create proxy
docker network connect proxy PROXY_CONTAINER
```

When the proxy's configuration is a single file mounted into its container, an editor that saves by replacing the file leaves the container reading the old copy. If a reload doesn't pick up your change, restart the proxy container.

### 7. Start Weblate

Copy this folder to the server, for example by cloning the repository there or with `scp -r ops/weblate SERVER:~/weblate`. Then, on the server:

```bash
cd ~/weblate
cp env.example .env
chmod 600 .env
openssl rand -hex 24
nano .env
```

In `.env`:

- Set `COMPOSE_FILE` to your choice from step 6, and `PROXY_NETWORK` or `WEBLATE_HOST_PORT` if that option uses one.
- Replace every `CHANGE_ME`.
- Use the `openssl` output as `POSTGRES_PASSWORD`, and a strong password of your own as `WEBLATE_ADMIN_PASSWORD`.

Check the configuration; it prints nothing when everything is valid:

```bash
docker compose config --quiet
```

Then start Weblate and follow its log:

```bash
docker compose up -d
docker compose logs -f weblate
```

The first start sets up the database and takes a few minutes. It's ready when `docker compose ps` shows the `weblate` service as `healthy`. Then add the site to your proxy, unless you use the bundled Caddy.

Open `https://translate.example.com` and sign in as `admin` with `WEBLATE_ADMIN_PASSWORD`. Check that email works:

```bash
docker compose exec weblate weblate sendtestemail you@example.com
```

### 8. Lock down the admin password

While `WEBLATE_ADMIN_PASSWORD` is set, Weblate resets the admin password to it on every start. After the first sign-in, delete that line from `.env` and run `docker compose up -d`. The password you signed in with stays valid. You can also turn on two-factor authentication under your Weblate profile's Account tab.

### 9. Create the project and component

Under **Add** → **Add new translation project**:

| Field           | Value                                                                  |
| --------------- | ---------------------------------------------------------------------- |
| Project name    | Turnip Tycoon, or your fork's name                                     |
| URL slug        | `turnip-tycoon`                                                        |
| Project website | the address where the app runs                                         |
| Instructions    | `https://github.com/OWNER/REPO/blob/main/CONTRIBUTING.md#translations` |

Then, in the project, **Add new translation component** → **From version control**:

| Field                  | Value                               |
| ---------------------- | ----------------------------------- |
| Component name         | App                                 |
| URL slug               | `app`                               |
| Version control system | GitHub pull request                 |
| Source code repository | `https://github.com/OWNER/REPO.git` |
| Repository branch      | `main`                              |

When Weblate offers the files it found, choose to specify the configuration manually:

| Field                                         | Value                                                           |
| --------------------------------------------- | --------------------------------------------------------------- |
| File format                                   | gettext PO file, with line wrapping set to **No line wrapping** |
| File mask                                     | `src/client/locales/*.po`                                       |
| Monolingual base and new translation template | leave empty                                                     |
| Language filter                               | `^(?!(en\|pseudo)$)[^.]+$`                                      |
| Source language                               | English                                                         |
| Translation license                           | Apache License 2.0                                              |
| Adding new translation                        | Contact maintainers                                             |

- **Line wrapping**: Lingui writes every string on one line, and `pnpm check` fails on a catalog whose lines Lingui would lay out differently. A pull request from Weblate with wrapped lines would never pass CI.
- **Language filter**: it skips `en.po`, the English source, and `pseudo.po`, a development aid.
- **Adding new translation**: new languages are added in code, together with their fonts and glossary terms, so translators ask instead of adding them.

After the component is created, adjust its settings:

- **Version control**: leave the push branch empty, so Weblate uses the bot's fork, and set the merge style to Rebase.
- **Commit messages**: make each template a single line, such as `fix: update {{ language_name }} translation`.
- **Translation flags**: `icu-message-format, icu-flags:xml`. If Weblate then warns that Russian or Japanese plural options differ from English, add `icu-flags:-submessage_selectors`. Those languages are meant to have different plural options, and CI checks placeholders, tags and plurals on every pull request anyway.

Under **Add-ons**, install **Squash Git commits**, squashing by language, so each pull request carries one commit per language.

The component should list one language per catalog except English, with the machine-drafted strings marked **Needs editing**.

You may have created the component with another wrapping option. Changing it affects only files Weblate writes from then on. If Repository maintenance shows outgoing commits made before the change, run **Reset and reapply translations** there, then **Push**. That rewrites the files with the new setting without losing any translations.

### 10. Pick up new strings automatically

In the repository's Settings → Webhooks, add a webhook:

- **Payload URL**: `https://translate.example.com/hooks/github/`
- **Content type**: `application/json`
- **Events**: just the push event

Weblate then pulls `main` seconds after each push.

## How it works

- A translator signs in, fixes a string and saves it without **Needs editing** checked. That removes the `#, fuzzy` flag, the same as a review in a pull request.
- Weblate commits the change and pushes it to the bot's fork, within a day at most. It then opens or updates one pull request, which CI checks like any other.
- Squash-merge the pull request once CI passes. Weblate rebases its fork onto the new `main`.
- English text keeps changing in the code as before, with `pnpm i18n:extract`. Weblate picks up the new strings from `main`.
- A pull request that fails the font test brought in a Japanese, Korean or Chinese character the cut-down fonts lack. Check out its branch, run `pnpm fonts:subset` and push the result to the pull request.

## Upgrades and backups

- **Weblate**: it releases monthly. To upgrade, read the [release notes](https://docs.weblate.org/en/latest/changes.html), change the image tag in `compose.yaml` to the new month (`2026.11`, and so on), then run `docker compose pull && docker compose up -d`. Weblate updates its database as it starts.
- **PostgreSQL**: moving to a new major version needs a dump and a restore, so leave it on 18 unless Weblate requires otherwise.
- **Backups**: translations end up in git, but the database holds accounts, suggestions, comments and history. Back up the server with your provider's snapshots or backups, or set up Weblate's own backups under Manage → Backups to any storage Borg can reach over SSH.
