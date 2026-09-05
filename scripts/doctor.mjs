#!/usr/bin/env node
// Environment doctor for AO workers.
//
// Verifies that this machine can actually build and test the repo — the
// hermetic bar is "nothing installed except repo dev dependencies, the Go
// toolchain, and the Node toolchain" — and prints the exact fix command for
// every check that fails. Run it once before starting work:
//
//   node scripts/doctor.mjs
//
// Treat FAILs as environment setup problems, not code problems: if the doctor
// is green but a test fails, the test (or the code) is broken; if the doctor
// is red, fix the environment first.
//
// One-time sudo note: the "chromium system libraries" check is the only check
// whose fix needs root (sudo npx playwright install-deps chromium). A human
// runs it once per server; the doctor then stays green.
//
// Exit code: 0 when no FAIL, 1 when any FAIL (WARNs do not affect exit code).

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const results = [];
let failures = 0;
let warnings = 0;

function record(status, name, detail, fix) {
	results.push({ status, name, detail, fix });
	if (status === "FAIL") failures++;
	if (status === "WARN") warnings++;
}

function run(cmd, args, opts = {}) {
	const res = spawnSync(cmd, args, {
		cwd: repoRoot,
		encoding: "utf8",
		...opts,
	});
	if (res.error) return { ok: false, out: "", err: String(res.error) };
	return {
		ok: res.status === 0,
		out: (res.stdout ?? "").trim(),
		err: (res.stderr ?? "").trim(),
	};
}

function firstLine(s) {
	return s.split("\n")[0] ?? "";
}

// parseTuple("1.26.5") -> [1, 26, 5]
function parseTuple(version) {
	const parts = String(version)
		.replace(/[^0-9.].*$/, "")
		.split(".")
		.map((n) => Number.parseInt(n, 10) || 0);
	while (parts.length < 3) parts.push(0);
	return parts;
}

function atLeast(actual, minimum) {
	const a = parseTuple(actual);
	const m = parseTuple(minimum);
	for (let i = 0; i < 3; i++) {
		if (a[i] !== m[i]) return a[i] > m[i];
	}
	return true;
}

// ---------------------------------------------------------------------------
// git
// ---------------------------------------------------------------------------
function checkGit() {
	const git = run("git", ["--version"]);
	if (!git.ok) {
		record("FAIL", "git", "not found on PATH", 'fix: sudo apt install git   # (or your platform equivalent)');
		return;
	}
	record("PASS", "git", firstLine(git.out));
}

// ---------------------------------------------------------------------------
// node / npm — CI builds on Node 22 and 24; Node 20 works but is deprecated
// ---------------------------------------------------------------------------
function checkNode() {
	const node = run("node", ["--version"]);
	if (!node.ok) {
		record("FAIL", "node", "not found on PATH", 'fix: install Node.js 22 LTS (https://nodejs.org) and put it on PATH');
	} else {
		const version = node.out.replace(/^v/, "");
		if (atLeast(version, "22.0.0")) {
			record("PASS", "node", `v${version} (CI uses 22/24)`);
		} else if (atLeast(version, "20.0.0")) {
			record("WARN", "node", `v${version} works but is deprecated by GitHub Actions`, "fix: upgrade to Node 22 LTS (https://nodejs.org)");
		} else {
			record("FAIL", "node", `v${version} is too old (CI uses 22/24)`, "fix: upgrade to Node 22 LTS (https://nodejs.org)");
		}
	}

	const npm = run("npm", ["--version"]);
	if (!npm.ok) {
		record("FAIL", "npm", "not found on PATH", "fix: install npm 9+ (ships with Node.js)");
	} else {
		record("PASS", "npm", `v${npm.out}`);
	}
}

// ---------------------------------------------------------------------------
// go toolchain — must be on PATH and >= the directive in backend/go.mod
// ---------------------------------------------------------------------------
function goModDirective() {
	try {
		const mod = readFileSync(join(repoRoot, "backend", "go.mod"), "utf8");
		const match = mod.match(/^go\s+(\d+\.\d+(?:\.\d+)?)\s*$/m);
		return match ? match[1] : null;
	} catch {
		return null;
	}
}

function checkGo() {
	const want = goModDirective();
	const wantText = want ? ` (backend/go.mod needs >= ${want})` : "";

	const probe = run("go", ["version"]);
	if (probe.ok) {
		checkGoVersion(firstLine(probe.out), want, wantText);
		return;
	}

	// Not on PATH: probe common install locations before declaring failure, so
	// the doctor can distinguish "not installed" from "installed but PATH is
	// missing the entry" — different fixes.
	const candidates = [
		join(homedir(), ".local", "go", "bin", "go"),
		"/usr/local/go/bin/go",
	];
	for (const candidate of candidates) {
		if (!existsSync(candidate)) continue;
		const res = spawnSync(candidate, ["version"], { encoding: "utf8" });
		const versionLine = (res.stdout ?? "").trim();
		record(
			"FAIL",
			"go",
			`installed at ${candidate} (${versionLine || "unknown version"}) but NOT on PATH${wantText}`,
			`fix: export PATH="$HOME/.local/go/bin:$PATH"   # add to ~/.bashrc to persist`,
		);
		return;
	}
	record("FAIL", "go", `not found on PATH${wantText}`, "fix: install Go >= " + (want ?? "1.25") + " (https://go.dev/dl/), e.g. to ~/.local/go");
}

function checkGoVersion(versionLine, want, wantText) {
	const match = versionLine.match(/go(\d+\.\d+(?:\.\d+)?)/);
	if (!match) {
		record("WARN", "go", `unparseable version line: ${versionLine}`);
		return;
	}
	const version = match[1];
	if (want && !atLeast(version, want)) {
		record("FAIL", "go", `go${version} is older than the backend/go.mod directive ${want}`, `fix: install Go >= ${want} (https://go.dev/dl/) or run: go install golang.org/dl/go${want}@latest`);
		return;
	}
	record("PASS", "go", `go${version} >= ${want ?? "n/a"}${wantText}`);
}

// ---------------------------------------------------------------------------
// gcc — optional, needed only for `go test -race` (cgo)
// ---------------------------------------------------------------------------
function checkGcc() {
	const gcc = run("gcc", ["--version"]);
	if (gcc.ok) {
		record("PASS", "gcc", firstLine(gcc.out).split(" ").slice(0, 3).join(" ") + " (enables go test -race)");
		return;
	}
	const cc = run("cc", ["--version"]);
	if (cc.ok) {
		record("PASS", "cc", "C compiler present (enables go test -race)");
		return;
	}
	record(
		"WARN",
		"gcc",
		"not installed — `go test -race` cannot build (cgo)",
		"fix: sudo apt install build-essential   # only needed for -race runs",
	);
}

// ---------------------------------------------------------------------------
// workspace node_modules — report only, never auto-install
// ---------------------------------------------------------------------------
function checkNodeModules() {
	const workspaces = [
		{ label: "frontend/node_modules", dir: join(repoRoot, "frontend"), fix: "fix: cd frontend && npm ci" },
		{ label: "packages/product-ui/node_modules", dir: join(repoRoot, "packages", "product-ui"), fix: "fix: cd packages/product-ui && npm ci" },
		{ label: "packages/mobile/node_modules", dir: join(repoRoot, "packages", "mobile"), fix: "fix: cd packages/mobile && npm ci" },
	];
	for (const ws of workspaces) {
		if (existsSync(join(ws.dir, "node_modules"))) {
			record("PASS", ws.label, "present");
		} else {
			record("FAIL", ws.label, "missing (vitest/typecheck will not run)", ws.fix);
		}
	}
}

// ---------------------------------------------------------------------------
// playwright browsers + chromium system libraries
// ---------------------------------------------------------------------------
function playwrightCacheRoot() {
	if (process.env.PLAYWRIGHT_BROWSERS_PATH) return process.env.PLAYWRIGHT_BROWSERS_PATH;
	return join(homedir(), ".cache", "ms-playwright");
}

function findChromiumBinaries() {
	const root = playwrightCacheRoot();
	const bins = [];
	if (!existsSync(root)) return bins;
	for (const entry of readdirSync(root)) {
		const dir = join(root, entry);
		if (!statSync(dir).isDirectory()) continue;
		if (entry.startsWith("chromium-")) {
			// Linux layout: chrome-linux/chrome (older) or chrome-linux64/chrome (newer)
			for (const sub of ["chrome-linux64", "chrome-linux"]) {
				const bin = join(dir, sub, "chrome");
				if (existsSync(bin)) bins.push(bin);
			}
		}
		if (entry.startsWith("chromium_headless_shell-")) {
			for (const sub of ["chrome-headless-shell-linux64", "chrome-linux64", "chrome-linux"]) {
				for (const name of ["chrome-headless-shell", "headless_shell"]) {
					const bin = join(dir, sub, name);
					if (existsSync(bin)) bins.push(bin);
				}
			}
		}
	}
	return bins;
}

function checkPlaywright() {
	const root = playwrightCacheRoot();
	const binaries = findChromiumBinaries();

	if (binaries.length === 0) {
		record(
			"FAIL",
			"playwright browsers",
			`no chromium binary found under ${root}`,
			"fix: cd frontend && npx playwright install chromium",
		);
	} else {
		record("PASS", "playwright browsers", `${binaries.length} chromium binary(ies) under ${root}`);
	}

	// System libraries: ldd every binary and count unresolved deps. The fix
	// needs one-time sudo; a human runs it once per server.
	if (process.platform !== "linux") {
		record("WARN", "chromium system libs", "ldd check only implemented on Linux; skipped on " + process.platform);
		return;
	}
	if (binaries.length === 0) {
		record("FAIL", "chromium system libs", "cannot check: no browser binary", "fix: cd frontend && npx playwright install chromium && sudo npx playwright install-deps chromium");
		return;
	}
	const missing = new Set();
	for (const bin of binaries) {
		const ldd = spawnSync("ldd", [bin], { encoding: "utf8" });
		if (ldd.status !== 0 && ldd.error) {
			record("FAIL", "chromium system libs", "ldd not available", "fix: sudo apt install libc-bin");
			return;
		}
		for (const line of (ldd.stdout ?? "").split("\n")) {
			if (line.includes("not found")) {
				const lib = line.trim().split(" ")[0];
				if (lib) missing.add(lib);
			}
		}
	}
	if (missing.size === 0) {
		record("PASS", "chromium system libs", "ldd reports 0 unresolved libraries");
	} else {
		record(
			"FAIL",
			"chromium system libs",
			`missing: ${[...missing].sort().join(", ")}`,
			"fix: sudo npx playwright install-deps chromium   # one-time sudo on this server",
		);
	}
}

// ---------------------------------------------------------------------------
// gh auth
// ---------------------------------------------------------------------------
function checkGh() {
	const ghVersion = run("gh", ["--version"]);
	if (!ghVersion.ok) {
		record("FAIL", "gh", "GitHub CLI not found on PATH", "fix: sudo apt install gh   # then: gh auth login");
		return;
	}
	const auth = run("gh", ["auth", "status"]);
	if (auth.ok) {
		record("PASS", "gh auth", "authenticated");
	} else {
		record("FAIL", "gh auth", "not authenticated (PR/issue workflows will fail)", "fix: gh auth login");
	}
}

// ---------------------------------------------------------------------------
checkGit();
checkNode();
checkGo();
checkGcc();
checkNodeModules();
checkPlaywright();
checkGh();

const pad = Math.max(...results.map((r) => r.name.length));
for (const r of results) {
	const mark = r.status === "PASS" ? "PASS" : r.status;
	console.log(`[${mark}] ${r.name.padEnd(pad)}  ${r.detail}`);
	if (r.fix) {
		console.log(`${" ".repeat(mark.length + 3)}${" ".repeat(pad)}  ${r.fix}`);
	}
}
console.log("");
console.log(`doctor: ${results.length - failures - warnings} passed, ${warnings} warned, ${failures} failed`);
if (failures > 0) {
	console.log("Environment setup required (see fix lines above) — treat FAILs as environment problems, not code problems.");
	process.exit(1);
}
process.exit(0);
