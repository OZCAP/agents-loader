#!/usr/bin/env bun
import { mkdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { err, ok } from "neverthrow";

interface Config {
  gistUrl: string;
}

interface GistFile {
  filename: string;
  raw_url: string;
  content?: string;
  truncated?: boolean;
}

interface GistResponse {
  files: Record<string, GistFile>;
}

interface GitHubHeaders {
  [key: string]: string;
}

type LagError =
  | { code: "CONFIG_READ_FAILED"; error: unknown; path: string }
  | { code: "CONFIG_PARSE_FAILED"; error: unknown; raw: string }
  | { code: "CONFIG_WRITE_FAILED"; error: unknown; path: string }
  | { code: "INVALID_GIST_URL"; error: unknown; input: string }
  | { code: "GITHUB_API_ERROR"; error: unknown; status: number; body: string }
  | { code: "GITHUB_API_PARSE_FAILED"; error: unknown; body: string }
  | { code: "GIST_FILE_NOT_FOUND"; error: unknown }
  | { code: "GIST_FILE_DOWNLOAD_FAILED"; error: unknown; status: number; body: string }
  | { code: "LOCAL_AGENTS_NOT_FOUND"; error: unknown }
  | { code: "LOCAL_AGENTS_READ_FAILED"; error: unknown; path: string }
  | { code: "LOCAL_AGENTS_WRITE_FAILED"; error: unknown; path: string }
  | { code: "GITIGNORE_UPDATE_FAILED"; error: unknown; path: string }
  | { code: "PROMPT_FAILED"; error: unknown }
  | { code: "PUSH_ABORTED"; error: unknown }
  | { code: "UNKNOWN_COMMAND"; error: unknown; command: string };

interface EmptyArgs {}

interface ExtractGistIdArgs {
  input: string;
}

interface ParseConfigArgs {
  raw: unknown;
}

interface LoadConfigArgs {
  configPath: string;
}

interface SaveConfigArgs {
  configPath: string;
  config: Config;
}

interface FetchGistArgs {
  gistId: string;
}

interface PickAgentsFilenameArgs {
  files: Record<string, GistFile>;
}

interface ReadGistFileContentArgs {
  file: GistFile;
}

interface PromptUserInputArgs {
  prompt: string;
}

interface ConfirmPushArgs {
  remoteName: string;
}

interface EnsureGitignoreArgs {
  cwd: string;
}

interface WriteAgentsFileArgs {
  cwd: string;
  content: string;
}

interface ReadLocalAgentsFileArgs {
  cwd: string;
}

interface UpdateGistFileArgs {
  gistId: string;
  filename: string;
  content: string;
}

interface PersistGistUrlArgs {
  configPath: string;
  gistUrl: string;
}

interface ResolveGistArgs {
  gistInput?: string;
  configPath: string;
}

interface PullAgentsArgs {
  gistId: string;
  cwd: string;
  configPath: string;
  gistUrl: string;
}

interface PushAgentsArgs {
  gistId: string;
  cwd: string;
  configPath: string;
  gistUrl: string;
}

interface RunCommandArgs {
  command: string;
  gistArg?: string;
  cwd: string;
}

interface RenderErrorMessageArgs {
  error: LagError;
}

interface MainArgs {
  argv: string[];
  cwd: string;
}

const CONFIG_DIR_NAME = "lag";
const CONFIG_FILE_NAME = "config.json";
const AGENTS_FILE_NAME = "AGENTS.md";

/*
Builds the config path for lag.
Inputs: none.
Outputs: absolute config path string.
*/
const getConfigPath = (_args: EmptyArgs) => {
  const homeDir = Bun.env.HOME ?? Bun.env.USERPROFILE ?? "";
  const configRoot = Bun.env.XDG_CONFIG_HOME ?? join(homeDir, ".config");
  return join(configRoot, CONFIG_DIR_NAME, CONFIG_FILE_NAME);
};

/*
Builds CLI usage text.
Inputs: none.
Outputs: formatted usage string.
*/
const buildUsage = (_args: EmptyArgs) => {
  return [
    "Syncs AGENTS.md with a GitHub gist.",
    "",
    "Usage:",
    "  lag pull",
    "  lag push",
    "  lag set",
    "",
    "Notes:",
    "  - Provide a GitHub token in GITHUB_TOKEN (or GH_TOKEN).",
    "  - Gist URL is stored at ~/.config/lag/config.json by default.",
    "  - If a gist URL is not provided, lag will prompt for it.",
  ].join("\n");
};

/*
Extracts a gist id from a URL or raw id string.
Inputs: user-provided gist input.
Outputs: Result with gist id or a structured error.
*/
const extractGistId = (args: ExtractGistIdArgs) => {
  const trimmed = args.input.trim();
  if (!trimmed) {
    return err({
      code: "INVALID_GIST_URL",
      error: new Error("Gist URL is empty"),
      input: args.input,
    });
  }

  if (/^[0-9a-f]{5,}$/i.test(trimmed)) {
    return ok(trimmed);
  }

  const normalised =
    trimmed.startsWith("http://") || trimmed.startsWith("https://")
      ? trimmed
      : trimmed.includes("gist.github.com")
        ? `https://${trimmed}`
        : trimmed;

  try {
    const url = new URL(normalised);
    const segments = url.pathname
      .split("/")
      .filter((segment) => segment.length > 0);
    const rawId = segments.at(-1) ?? "";
    if (!rawId) {
      return err({
        code: "INVALID_GIST_URL",
        error: new Error("Gist URL missing id"),
        input: args.input,
      });
    }
    return ok(rawId.replace(/\.git$/, ""));
  } catch (error) {
    return err({
      code: "INVALID_GIST_URL",
      error,
      input: args.input,
    });
  }
};

/*
Builds headers for GitHub API requests.
Inputs: none.
Outputs: headers including optional authorisation.
*/
const getAuthHeaders = (_args: EmptyArgs) => {
  const token =
    Bun.env.GITHUB_TOKEN ?? Bun.env.GH_TOKEN ?? Bun.env.GITHUB_PAT ?? "";
  const headers: GitHubHeaders = {
    Accept: "application/vnd.github+json",
    "User-Agent": "lag-cli",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
};

/*
Validates the config payload from disk.
Inputs: unknown parsed JSON value.
Outputs: config when valid, otherwise undefined.
*/
const parseConfig = (args: ParseConfigArgs) => {
  if (!args.raw || typeof args.raw !== "object") {
    return undefined;
  }
  const record = args.raw as {
    gistUrl?: unknown;
  };
  if (typeof record.gistUrl !== "string" || record.gistUrl.trim().length === 0) {
    return undefined;
  }
  return { gistUrl: record.gistUrl };
};

/*
Loads config from disk if present.
Inputs: config file path.
Outputs: Result with config or undefined if missing.
*/
const loadConfig = async (args: LoadConfigArgs) => {
  try {
    const file = Bun.file(args.configPath);
    const exists = await file.exists();
    if (!exists) {
      return ok(undefined);
    }
    const raw = await file.text();
    try {
      const parsed = JSON.parse(raw) as unknown;
      return ok(parseConfig({ raw: parsed }));
    } catch (error) {
      return err({
        code: "CONFIG_PARSE_FAILED",
        error,
        raw,
      });
    }
  } catch (error) {
    return err({
      code: "CONFIG_READ_FAILED",
      error,
      path: args.configPath,
    });
  }
};

/*
Writes config to disk.
Inputs: config file path and config data.
Outputs: Result signalling success or failure.
*/
const saveConfig = async (args: SaveConfigArgs) => {
  try {
    await mkdir(dirname(args.configPath), { recursive: true });
    await Bun.write(args.configPath, JSON.stringify(args.config, null, 2));
    return ok(undefined);
  } catch (error) {
    return err({
      code: "CONFIG_WRITE_FAILED",
      error,
      path: args.configPath,
    });
  }
};

/*
Persists a gist URL to config.
Inputs: config path and gist URL.
Outputs: Result signalling success or failure.
*/
const persistGistUrl = async (args: PersistGistUrlArgs) => {
  return saveConfig({
    configPath: args.configPath,
    config: {
      gistUrl: args.gistUrl,
    },
  });
};

/*
Fetches a gist from the GitHub API.
Inputs: gist id.
Outputs: Result with gist response or a structured error.
*/
const fetchGist = async (args: FetchGistArgs) => {
  try {
    const response = await fetch(`https://api.github.com/gists/${args.gistId}`, {
      headers: getAuthHeaders({}),
    });
    const body = await response.text();
    if (!response.ok) {
      return err({
        code: "GITHUB_API_ERROR",
        error: new Error("GitHub API error"),
        status: response.status,
        body,
      });
    }
    try {
      const parsed = JSON.parse(body) as GistResponse;
      return ok(parsed);
    } catch (error) {
      return err({
        code: "GITHUB_API_PARSE_FAILED",
        error,
        body,
      });
    }
  } catch (error) {
    return err({
      code: "GITHUB_API_ERROR",
      error,
      status: 0,
      body: "Request failed",
    });
  }
};

/*
Selects the agents filename from a gist file map.
Inputs: gist files record.
Outputs: matching filename or undefined.
*/
const pickAgentsFilename = (args: PickAgentsFilenameArgs) => {
  if (args.files[AGENTS_FILE_NAME]) {
    return AGENTS_FILE_NAME;
  }
  if (args.files["agents.md"]) {
    return "agents.md";
  }
  return Object.keys(args.files).find(
    (name) => name.toLowerCase() === "agents.md",
  );
};

/*
Reads content for a gist file entry.
Inputs: gist file metadata.
Outputs: Result with file content or a structured error.
*/
const readGistFileContent = async (args: ReadGistFileContentArgs) => {
  if (args.file.content && !args.file.truncated) {
    return ok(args.file.content);
  }
  try {
    const response = await fetch(args.file.raw_url, {
      headers: getAuthHeaders({}),
    });
    const body = await response.text();
    if (!response.ok) {
      return err({
        code: "GIST_FILE_DOWNLOAD_FAILED",
        error: new Error("Failed to download gist file"),
        status: response.status,
        body,
      });
    }
    return ok(body);
  } catch (error) {
    return err({
      code: "GIST_FILE_DOWNLOAD_FAILED",
      error,
      status: 0,
      body: "Request failed",
    });
  }
};

/*
Prompts for a gist URL or id via stdin.
Inputs: prompt text.
Outputs: Result with trimmed input or a structured error.
*/
const promptUserInput = async (args: PromptUserInputArgs) => {
  let rl: ReturnType<typeof createInterface> | undefined;
  try {
    rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const answer = await rl.question(args.prompt);
    rl.close();
    return ok(answer.trim());
  } catch (error) {
    if (rl) {
      rl.close();
    }
    return err({
      code: "PROMPT_FAILED",
      error,
    });
  }
};

/*
Confirms whether the user wants to push local changes to the gist.
Inputs: remote filename for context.
Outputs: Result indicating whether to proceed with the push.
*/
const confirmPush = async (args: ConfirmPushArgs) => {
  const promptResult = await promptUserInput({
    prompt: `Push ${AGENTS_FILE_NAME} to ${args.remoteName}? (y/N): `,
  });
  if (promptResult.isErr()) {
    return err(promptResult.error);
  }
  const shouldPush = (() => {
    const answer = promptResult.value.trim().toLowerCase();
    if (answer === "y" || answer === "yes") {
      return true;
    }
    return false;
  })();
  return ok(shouldPush);
};

/*
Ensures AGENTS.md is ignored in the current directory.
Inputs: working directory path.
Outputs: Result indicating whether the update succeeded.
*/
const ensureGitignore = async (args: EnsureGitignoreArgs) => {
  const gitignorePath = join(args.cwd, ".gitignore");
  try {
    const file = Bun.file(gitignorePath);
    const exists = await file.exists();
    if (!exists) {
      return ok(undefined);
    }
    const current = await file.text();
    const hasEntry = current
      .split(/\r?\n/)
      .some((line) => line.trim() === AGENTS_FILE_NAME);
    if (hasEntry) {
      return ok(undefined);
    }
    const separator =
      current.length === 0 || current.endsWith("\n") ? "" : "\n";
    const updated = `${current}${separator}${AGENTS_FILE_NAME}\n`;
    await Bun.write(gitignorePath, updated);
    return ok(undefined);
  } catch (error) {
    return err({
      code: "GITIGNORE_UPDATE_FAILED",
      error,
      path: gitignorePath,
    });
  }
};

/*
Writes the AGENTS.md file into the current directory.
Inputs: working directory and file content.
Outputs: Result signalling success or failure.
*/
const writeAgentsFile = async (args: WriteAgentsFileArgs) => {
  const targetPath = join(args.cwd, AGENTS_FILE_NAME);
  try {
    await Bun.write(targetPath, args.content);
    return ok(undefined);
  } catch (error) {
    return err({
      code: "LOCAL_AGENTS_WRITE_FAILED",
      error,
      path: targetPath,
    });
  }
};

/*
Reads the local AGENTS.md or agents.md file.
Inputs: working directory path.
Outputs: Result with file path and content or a structured error.
*/
const readLocalAgentsFile = async (args: ReadLocalAgentsFileArgs) => {
  const upperPath = join(args.cwd, AGENTS_FILE_NAME);
  const lowerPath = join(args.cwd, "agents.md");
  try {
    const upperExists = await Bun.file(upperPath).exists();
    const lowerExists = await Bun.file(lowerPath).exists();
    const targetPath = upperExists
      ? upperPath
      : lowerExists
        ? lowerPath
        : undefined;
    if (!targetPath) {
      return err({
        code: "LOCAL_AGENTS_NOT_FOUND",
        error: new Error("AGENTS.md not found"),
      });
    }
    const content = await Bun.file(targetPath).text();
    return ok({ path: targetPath, content });
  } catch (error) {
    return err({
      code: "LOCAL_AGENTS_READ_FAILED",
      error,
      path: upperPath,
    });
  }
};

/*
Updates a gist file with new content.
Inputs: gist id, filename, and content.
Outputs: Result indicating whether the update succeeded.
*/
const updateGistFile = async (args: UpdateGistFileArgs) => {
  try {
    const response = await fetch(`https://api.github.com/gists/${args.gistId}`, {
      method: "PATCH",
      headers: {
        ...getAuthHeaders({}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        files: {
          [args.filename]: {
            content: args.content,
          },
        },
      }),
    });
    const body = await response.text();
    if (!response.ok) {
      return err({
        code: "GITHUB_API_ERROR",
        error: new Error("GitHub API error"),
        status: response.status,
        body,
      });
    }
    return ok(undefined);
  } catch (error) {
    return err({
      code: "GITHUB_API_ERROR",
      error,
      status: 0,
      body: "Request failed",
    });
  }
};

/*
Resolves the gist id from input or saved config.
Inputs: optional gist input and config path.
Outputs: Result with gist url and gist id.
*/
const resolveGist = async (args: ResolveGistArgs) => {
  if (args.gistInput) {
    const gistIdResult = extractGistId({ input: args.gistInput });
    if (gistIdResult.isErr()) {
      return err(gistIdResult.error);
    }
    const saveResult = await persistGistUrl({
      configPath: args.configPath,
      gistUrl: args.gistInput,
    });
    if (saveResult.isErr()) {
      return err(saveResult.error);
    }
    return ok({ gistId: gistIdResult.value, gistUrl: args.gistInput });
  }

  const configResult = await loadConfig({ configPath: args.configPath });
  if (configResult.isErr()) {
    return err(configResult.error);
  }
  if (!configResult.value) {
    const promptResult = await promptUserInput({
      prompt: "Enter gist URL or id: ",
    });
    if (promptResult.isErr()) {
      return err(promptResult.error);
    }
    const gistIdResult = extractGistId({ input: promptResult.value });
    if (gistIdResult.isErr()) {
      return err(gistIdResult.error);
    }
    const saveResult = await persistGistUrl({
      configPath: args.configPath,
      gistUrl: promptResult.value,
    });
    if (saveResult.isErr()) {
      return err(saveResult.error);
    }
    return ok({
      gistId: gistIdResult.value,
      gistUrl: promptResult.value,
    });
  }
  const gistIdResult = extractGistId({ input: configResult.value.gistUrl });
  if (gistIdResult.isErr()) {
    return err(gistIdResult.error);
  }
  return ok({
    gistId: gistIdResult.value,
    gistUrl: configResult.value.gistUrl,
  });
};

/*
Pulls the remote gist file into the local AGENTS.md.
Inputs: gist id, working directory, config path, and gist URL.
Outputs: Result indicating whether the pull succeeded.
*/
const pullAgents = async (args: PullAgentsArgs) => {
  const gistResult = await fetchGist({ gistId: args.gistId });
  if (gistResult.isErr()) {
    return err(gistResult.error);
  }
  const fileName = pickAgentsFilename({ files: gistResult.value.files });
  if (!fileName) {
    return err({
      code: "GIST_FILE_NOT_FOUND",
      error: new Error("No AGENTS file in gist"),
    });
  }
  const gistFile = gistResult.value.files[fileName];
  if (!gistFile) {
    return err({
      code: "GIST_FILE_NOT_FOUND",
      error: new Error("AGENTS file entry missing"),
    });
  }
  const contentResult = await readGistFileContent({
    file: gistFile,
  });
  if (contentResult.isErr()) {
    return err(contentResult.error);
  }
  const gitignoreResult = await ensureGitignore({ cwd: args.cwd });
  if (gitignoreResult.isErr()) {
    return err(gitignoreResult.error);
  }
  const writeResult = await writeAgentsFile({
    cwd: args.cwd,
    content: contentResult.value,
  });
  if (writeResult.isErr()) {
    return err(writeResult.error);
  }
  console.log(`Updated ${AGENTS_FILE_NAME} from gist.`);
  return ok(undefined);
};

/*
Pushes the local AGENTS.md to the remote gist.
Inputs: gist id, working directory, config path, and gist URL.
Outputs: Result indicating whether the push succeeded.
*/
const pushAgents = async (args: PushAgentsArgs) => {
  const localResult = await readLocalAgentsFile({ cwd: args.cwd });
  if (localResult.isErr()) {
    return err(localResult.error);
  }
  const gistResult = await fetchGist({ gistId: args.gistId });
  if (gistResult.isErr()) {
    return err(gistResult.error);
  }
  const remoteName =
    pickAgentsFilename({ files: gistResult.value.files }) ??
    basename(localResult.value.path);
  const confirmResult = await confirmPush({
    remoteName,
  });
  if (confirmResult.isErr()) {
    return err(confirmResult.error);
  }
  if (!confirmResult.value) {
    return err({
      code: "PUSH_ABORTED",
      error: new Error("Push cancelled"),
    });
  }
  const gitignoreResult = await ensureGitignore({ cwd: args.cwd });
  if (gitignoreResult.isErr()) {
    return err(gitignoreResult.error);
  }
  const updateResult = await updateGistFile({
    gistId: args.gistId,
    filename: remoteName,
    content: localResult.value.content,
  });
  if (updateResult.isErr()) {
    return err(updateResult.error);
  }
  console.log(`Updated gist ${remoteName} from ${AGENTS_FILE_NAME}.`);
  return ok(undefined);
};

/*
Runs a CLI command.
Inputs: command, optional gist argument, and working directory.
Outputs: Result indicating whether the command succeeded.
*/
const runCommand = async (args: RunCommandArgs) => {
  const configPath = getConfigPath({});
  if (args.command === "set") {
    const gistInputResult = args.gistArg
      ? ok<string, LagError>(args.gistArg)
      : await promptUserInput({ prompt: "Enter gist URL or id: " });
    if (gistInputResult.isErr()) {
      return err(gistInputResult.error);
    }
    const gistIdResult = extractGistId({ input: gistInputResult.value });
    if (gistIdResult.isErr()) {
      return err(gistIdResult.error);
    }
    const saveResult = await persistGistUrl({
      configPath,
      gistUrl: gistInputResult.value,
    });
    if (saveResult.isErr()) {
      return err(saveResult.error);
    }
    console.log("Saved gist URL.");
    return ok(undefined);
  }

  if (args.command === "pull") {
    const gistResult = await resolveGist({
      gistInput: args.gistArg,
      configPath,
    });
    if (gistResult.isErr()) {
      return err(gistResult.error);
    }
    return pullAgents({
      gistId: gistResult.value.gistId,
      cwd: args.cwd,
      configPath,
      gistUrl: gistResult.value.gistUrl,
    });
  }

  if (args.command === "push") {
    const gistResult = await resolveGist({
      gistInput: args.gistArg,
      configPath,
    });
    if (gistResult.isErr()) {
      return err(gistResult.error);
    }
    return pushAgents({
      gistId: gistResult.value.gistId,
      cwd: args.cwd,
      configPath,
      gistUrl: gistResult.value.gistUrl,
    });
  }

  return err({
    code: "UNKNOWN_COMMAND",
    error: new Error("Unknown command"),
    command: args.command,
  });
};

/*
Formats a structured error for display.
Inputs: LagError value.
Outputs: user-facing error message string.
*/
const renderErrorMessage = (args: RenderErrorMessageArgs) => {
  switch (args.error.code) {
    case "INVALID_GIST_URL":
      return "Invalid gist URL. Provide a valid gist URL or gist id.";
    case "GIST_FILE_NOT_FOUND":
      return "No AGENTS.md or agents.md found in the gist.";
    case "LOCAL_AGENTS_NOT_FOUND":
      return "No AGENTS.md (or agents.md) found in the current folder.";
    case "UNKNOWN_COMMAND":
      return `Unknown command: ${args.error.command}`;
    case "GITHUB_API_ERROR":
      return `GitHub API error (${args.error.status}): ${
        args.error.body || "Request failed"
      }`;
    case "GITHUB_API_PARSE_FAILED":
      return "GitHub API response was not valid JSON.";
    case "CONFIG_READ_FAILED":
      return `Failed to read config at ${args.error.path}.`;
    case "CONFIG_PARSE_FAILED":
      return "Config file is not valid JSON.";
    case "CONFIG_WRITE_FAILED":
      return `Failed to write config at ${args.error.path}.`;
    case "GIST_FILE_DOWNLOAD_FAILED":
      return `Failed to download gist file (${args.error.status}): ${
        args.error.body || "Request failed"
      }`;
    case "LOCAL_AGENTS_READ_FAILED":
      return `Failed to read ${args.error.path}.`;
    case "LOCAL_AGENTS_WRITE_FAILED":
      return `Failed to write ${args.error.path}.`;
    case "GITIGNORE_UPDATE_FAILED":
      return `Failed to update .gitignore at ${args.error.path}.`;
    case "PROMPT_FAILED":
      return "Failed to read input from stdin.";
    case "PUSH_ABORTED":
      return "Push cancelled.";
    default:
      return "Unexpected error.";
  }
};

/*
Entry point for the CLI.
Inputs: argv list and working directory.
Outputs: none (process exits on failure).
*/
const main = async (args: MainArgs) => {
  const [command, gistArg] = args.argv;
  if (
    !command ||
    command === "help" ||
    command === "--help" ||
    command === "-h"
  ) {
    console.log(buildUsage({}));
    return;
  }

  const result = await runCommand({ command, gistArg, cwd: args.cwd });
  if (result.isErr()) {
    console.error(renderErrorMessage({ error: result.error as LagError }));
    process.exit(1);
  }
};

await main({ argv: process.argv.slice(2), cwd: process.cwd() });
