#!/usr/bin/env node
// Write electron-updater feed files (latest.yml / latest-mac.yml / latest-linux.yml)
// for a GitHub Release. SHA-512 is base64, matching electron-updater.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";

const version = (process.env.RELEASE_VERSION || "").replace(/^v/, "");
const outDir = process.env.UPDATER_YML_DIR || ".";
if (!version) {
	console.error("RELEASE_VERSION is required (e.g. 0.10.3 or v0.10.3)");
	process.exit(1);
}

function sha512Base64(filePath) {
	return createHash("sha512").update(readFileSync(filePath)).digest("base64");
}

function writeFeed(fileName, artifactPath) {
	const stats = statSync(artifactPath);
	const name = path.basename(artifactPath);
	const sha = sha512Base64(artifactPath);
	const yml = [
		`version: ${version}`,
		"files:",
		`  - url: ${name}`,
		`    sha512: ${sha}`,
		`    size: ${stats.size}`,
		`path: ${name}`,
		`sha512: ${sha}`,
		`releaseDate: '${new Date().toISOString()}'`,
		"",
	].join("\n");
	const dest = path.join(outDir, fileName);
	writeFileSync(dest, yml);
	console.log(`wrote ${dest} -> ${name}`);
}

const specs = [
	["latest-mac.yml", process.env.MAC_ARM64_ZIP],
	["latest.yml", process.env.WIN_EXE],
	["latest-linux.yml", process.env.LINUX_APPIMAGE],
];

let wrote = 0;
for (const [fileName, artifactPath] of specs) {
	if (!artifactPath) continue;
	writeFeed(fileName, artifactPath);
	wrote += 1;
}
if (wrote === 0) {
	console.error("no artifact env vars set (MAC_ARM64_ZIP, WIN_EXE, LINUX_APPIMAGE)");
	process.exit(1);
}
