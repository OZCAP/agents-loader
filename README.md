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

Pull the remote gist file into the local AGENTS.md. First run will prompt for the gist URL.

```bash
lag pull
```

Push local changes back to the gist (prompts for confirmation):

```bash
lag push [gist-url]
```

You can also store the gist URL explicitly (prompts if omitted):

```bash
lag set [gist-url]
```

### Gist setup

Before using `lag`, you'll need to create a GitHub gist. This is where your AGENTS.md will be stored that you want to use across projects:

1. Go to [gist.github.com](https://gist.github.com)
2. Create a new gist (ensure it's set to **private**)
3. Add a single file named `AGENTS.md`
4. Copy the gist URL from your browser address bar


## Notes

- Requires `GITHUB_TOKEN` (or `GH_TOKEN`) for private gists.
- The gist URL is stored at `~/.config/lag/config.json` (or `$XDG_CONFIG_HOME`).
- `lag pull` always writes `AGENTS.md` in the current directory.
- `.gitignore` is updated only if it already exists in the working directory.
