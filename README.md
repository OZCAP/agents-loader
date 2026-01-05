# agents-loader

`lag` is a small Bun CLI that keeps `AGENTS.md` in sync with a GitHub gist. It
pulls the remote file into your working directory and pushes local updates back
to the gist when needed.

## Install

**Requirements:** Bun must be installed on your system.

One-liner (no clone required):

```bash
curl -fsSL https://raw.githubusercontent.com/OZCAP/agents-loader/main/install.sh | bash
```

From source:

```bash
./install.sh
```

By default, this installs the compiled binary into `~/.local/bin`. You can override
the install directory with `LAG_INSTALL_DIR=/some/path ./install.sh`.

## Usage

First run (store the gist URL and pull into the current directory). If you omit
the URL, `lag` will prompt for it:

```bash
lag pull [gist-url]
```

Pull again later:

```bash
lag pull
```

Push local changes back to the gist (prompts if needed):

```bash
lag push [gist-url]
```

You can also store the gist URL explicitly (prompts if omitted):

```bash
lag set [gist-url]
```

## Notes

- Requires `GITHUB_TOKEN` (or `GH_TOKEN`) for private gists.
- The gist URL is stored at `~/.config/lag/config.json` (or `$XDG_CONFIG_HOME`).
- `lag pull` always writes `AGENTS.md` in the current directory.
- `.gitignore` is updated only if it already exists in the working directory.
