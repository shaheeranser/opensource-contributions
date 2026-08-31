// scripts/update-readme.js
//
// Fetches recent pull requests and issues you've opened across GitHub
// (via the Search API) and writes them into README.md between two
// marker comments. Designed to be run on a schedule by a GitHub Action.

const fs = require("fs");
const path = require("path");

const USERNAME = process.env.GITHUB_USERNAME;
const TOKEN = process.env.GITHUB_TOKEN; // optional, but raises rate limits
const LIMIT = parseInt(process.env.CONTRIB_LIMIT || "15", 10);
const EXCLUDE_OWN_REPOS = process.env.EXCLUDE_OWN_REPOS === "true"; // false by default
const README_PATH = path.join(__dirname, "..", "README.md");
const START_MARKER = "<!-- CONTRIBUTIONS:START -->";
const END_MARKER = "<!-- CONTRIBUTIONS:END -->";

if (!USERNAME) {
  console.error("Missing GITHUB_USERNAME environment variable.");
  process.exit(1);
}

async function searchGitHub(query) {
  const url = `https://api.github.com/search/issues?q=${encodeURIComponent(
    query
  )}&sort=created&order=desc&per_page=50`;

  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": `${USERNAME}-contributions-readme`,
  };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API error ${res.status}: ${body}`);
  }
  const data = await res.json();
  return data.items || [];
}

function repoFullName(item) {
  // repository_url looks like https://api.github.com/repos/owner/repo
  const parts = item.repository_url.split("/repos/");
  return parts[1];
}

function statusFor(item, isPR) {
  if (isPR) {
    if (item.pull_request && item.pull_request.merged_at) return "Merged";
    return item.state === "closed" ? "Closed" : "Open";
  }
  return item.state === "closed" ? "Closed" : "Open";
}

function statusEmoji(status) {
  return { Merged: "🟣", Open: "🟢", Closed: "🔴" }[status] || "";
}

async function main() {
  const [prItems, issueItems] = await Promise.all([
    searchGitHub(`author:${USERNAME} is:pr is:public`),
    searchGitHub(`author:${USERNAME} is:issue is:public`),
  ]);

  let combined = [
    ...prItems.map((item) => ({ item, isPR: true })),
    ...issueItems.map((item) => ({ item, isPR: false })),
  ];

  if (EXCLUDE_OWN_REPOS) {
    combined = combined.filter(
      ({ item }) => repoFullName(item).split("/")[0].toLowerCase() !== USERNAME.toLowerCase()
    );
  }

  combined.sort(
    (a, b) => new Date(b.item.created_at) - new Date(a.item.created_at)
  );
  combined = combined.slice(0, LIMIT);

  const mergedPRCount = prItems.filter(
    (i) => i.pull_request && i.pull_request.merged_at
  ).length;
  const repoSet = new Set(combined.map(({ item }) => repoFullName(item)));

  const lines = [];
  lines.push(
    `_Last updated: ${new Date().toISOString().slice(0, 10)} · ${mergedPRCount} PRs merged · ${repoSet.size} repos in the list below_`
  );
  lines.push("");
  lines.push("| Type | Title | Repo | Status | Date |");
  lines.push("|------|-------|------|--------|------|");

  for (const { item, isPR } of combined) {
    const status = statusFor(item, isPR);
    const type = isPR ? "PR" : "Issue";
    const repo = repoFullName(item);
    const date = item.created_at.slice(0, 10);
    const title = item.title.replace(/\|/g, "\\|");
    lines.push(
      `| ${type} | [${title}](${item.html_url}) | [${repo}](https://github.com/${repo}) | ${statusEmoji(
        status
      )} ${status} | ${date} |`
    );
  }

  const table = lines.join("\n");

  let readme = fs.readFileSync(README_PATH, "utf8");
  const startIdx = readme.indexOf(START_MARKER);
  const endIdx = readme.indexOf(END_MARKER);

  if (startIdx === -1 || endIdx === -1) {
    throw new Error(
      `Could not find ${START_MARKER} / ${END_MARKER} markers in README.md`
    );
  }

  const before = readme.slice(0, startIdx + START_MARKER.length);
  const after = readme.slice(endIdx);
  readme = `${before}\n${table}\n${after}`;

  fs.writeFileSync(README_PATH, readme);
  console.log(`Wrote ${combined.length} contributions to README.md`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});