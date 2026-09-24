import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { joinSession, createCanvas, CanvasError } from "@github/copilot-sdk/extension";

const execFileAsync = promisify(execFile);
const servers = new Map();

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

async function loadIssues() {
    const { stdout } = await execFileAsync(
        "gh",
        [
            "issue",
            "list",
            "--state",
            "open",
            "--limit",
            "100",
            "--json",
            "number,title,body,labels,assignees,createdAt,updatedAt,url",
        ],
        { cwd: process.cwd(), windowsHide: true },
    );
    return JSON.parse(stdout);
}

function priorityScore(issue) {
    const text = `${issue.title} ${issue.body}`.toLowerCase();
    const customerImpact = ["user", "backer", "page", "search", "performance", "catalog"].reduce(
        (score, keyword) => score + (text.includes(keyword) ? 2 : 0),
        0,
    );
    const acceptanceCriteria = (issue.body.match(/- \[ \]/g) ?? []).length;
    const freshness = Math.max(0, 10 - Math.floor((Date.now() - Date.parse(issue.updatedAt)) / 86_400_000));
    return customerImpact + acceptanceCriteria + freshness;
}

function prioritize(issues) {
    return [...issues]
        .sort((a, b) => priorityScore(b) - priorityScore(a) || b.number - a.number)
        .map((issue, index) => ({
            ...issue,
            rank: index + 1,
            score: priorityScore(issue),
        }));
}

function issueDescription(issue) {
    const description = issue.body?.replace(/\s+/g, " ").trim() || "No description provided.";
    return description.length > 220 ? `${description.slice(0, 217)}...` : description;
}

function priorityReason(issue) {
    const reasons = [];
    const text = `${issue.title} ${issue.body}`.toLowerCase();
    if (["user", "backer", "catalog", "performance", "search"].some((word) => text.includes(word))) {
        reasons.push("directly improves the backer browsing experience");
    }
    const criteria = (issue.body.match(/- \[ \]/g) ?? []).length;
    if (criteria >= 4) reasons.push(`${criteria} acceptance criteria indicate meaningful scope`);
    if (Date.now() - Date.parse(issue.updatedAt) < 2 * 86_400_000) reasons.push("updated recently");
    return reasons.length ? `${reasons.join("; ")}.` : "has a clear, actionable implementation path.";
}

function renderIssueCard(issue, top) {
    const description = issueDescription(issue);
    const extra = top
        ? `<p class="reason"><strong>Why it is near the top:</strong> ${escapeHtml(priorityReason(issue))}</p>`
        : "";
    return `<article class="card${top ? " card-top" : ""}">
      <div class="card-header">
        <span class="issue-number">#${issue.number}</span>
        <span class="score">Priority ${issue.score}</span>
      </div>
      <h3><a href="${escapeHtml(issue.url)}" target="_blank" rel="noreferrer">${escapeHtml(issue.title)}</a></h3>
      <p>${escapeHtml(description)}</p>
      ${extra}
      <button type="button" data-issue="${issue.number}" data-testid="add-issue-${issue.number}">Add to current context</button>
    </article>`;
}

function renderHtml(issues, error = "") {
    const top = issues.slice(0, 3);
    const remainder = issues.slice(3);
    const errorMarkup = error ? `<div class="error" role="alert">${escapeHtml(error)}</div>` : "";
    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Issue triage board</title>
    <style>
      :root { color-scheme: light dark; }
      * { box-sizing: border-box; }
      body { margin: 0; padding: 24px; background: var(--background-color-default, #fff); color: var(--text-color-default, #1f2328); font: 14px/1.5 var(--font-sans, system-ui, sans-serif); }
      main { max-width: 980px; margin: 0 auto; }
      h1 { margin: 0 0 6px; font-size: 26px; }
      .subtitle { margin: 0 0 24px; color: var(--text-color-muted, #656d76); }
      section { margin-top: 28px; }
      h2 { font-size: 18px; margin-bottom: 12px; }
      .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; }
      .card { border: 1px solid var(--border-color-default, #d0d7de); border-radius: 10px; padding: 16px; background: var(--background-color-muted, #f6f8fa); }
      .card-top { border-color: var(--true-color-blue, #0969da); box-shadow: 0 0 0 1px var(--true-color-blue, #0969da); }
      .card-header { display: flex; justify-content: space-between; gap: 8px; color: var(--text-color-muted, #656d76); font-size: 12px; }
      .issue-number { font-weight: 600; }
      h3 { font-size: 16px; margin: 10px 0 8px; }
      h3 a { color: inherit; }
      p { margin: 8px 0 14px; }
      .reason { border-left: 3px solid var(--true-color-blue, #0969da); padding-left: 10px; }
      button { border: 1px solid var(--true-color-blue, #0969da); border-radius: 6px; padding: 7px 10px; color: var(--color-white, #fff); background: var(--true-color-blue, #0969da); cursor: pointer; font: inherit; }
      button:hover { filter: brightness(1.1); }
      button:focus-visible { outline: 2px solid var(--color-focus-outline, #0969da); outline-offset: 2px; }
      button[disabled] { opacity: .65; cursor: wait; }
      .status { min-height: 22px; margin-top: 14px; color: var(--text-color-muted, #656d76); }
      .error { border: 1px solid var(--true-color-red, #cf222e); border-radius: 6px; padding: 10px; color: var(--true-color-red, #cf222e); }
    </style>
  </head>
  <body>
    <main>
      <h1>Issue triage board</h1>
      <p class="subtitle">Open issues ranked by likely user impact, scope, and recency.</p>
      ${errorMarkup}
      <section aria-labelledby="top-heading">
        <h2 id="top-heading">Needs attention now</h2>
        <div class="grid">${top.length ? top.map((issue) => renderIssueCard(issue, true)).join("") : "<p>No open issues found.</p>"}</div>
      </section>
      <section aria-labelledby="remaining-heading">
        <h2 id="remaining-heading">Remaining open issues</h2>
        <div class="grid">${remainder.length ? remainder.map((issue) => renderIssueCard(issue, false)).join("") : "<p>All open issues are highlighted above.</p>"}</div>
      </section>
      <p class="status" role="status" aria-live="polite" data-testid="action-status"></p>
    </main>
    <script>
      document.querySelectorAll("button[data-issue]").forEach((button) => {
        button.addEventListener("click", async () => {
          button.disabled = true;
          const status = document.querySelector("[data-testid=action-status]");
          status.textContent = "Adding issue to the current context...";
          try {
            const response = await fetch("/api/add", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ issueNumber: Number(button.dataset.issue) }) });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "Could not add the issue.");
            status.textContent = "Issue added to the current context.";
          } catch (error) {
            status.textContent = error.message;
            button.disabled = false;
          }
        });
      });
    </script>
  </body>
</html>`;
}

async function addIssueToContext(issueNumber) {
    const issues = await loadIssues();
    const issue = issues.find((candidate) => candidate.number === issueNumber);
    if (!issue) throw new Error(`Open issue #${issueNumber} was not found.`);
    await session.send({
        prompt: `Add issue #${issue.number} to the current work context. Title: ${issue.title}\nURL: ${issue.url}\nDescription:\n${issue.body || "No description provided."}`,
    });
    return { issueNumber, title: issue.title };
}

async function startServer() {
    const server = createServer(async (req, res) => {
        try {
            if (req.method === "POST" && req.url === "/api/add") {
                let raw = "";
                for await (const chunk of req) raw += chunk;
                const input = JSON.parse(raw);
                if (!Number.isInteger(input.issueNumber)) throw new Error("A valid issue number is required.");
                const result = await addIssueToContext(input.issueNumber);
                res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
                res.end(JSON.stringify(result));
                return;
            }
            const issues = prioritize(await loadIssues());
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.end(renderHtml(issues));
        } catch (error) {
            res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
            res.end(renderHtml([], error instanceof Error ? error.message : "Unable to load issues."));
        }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    return { server, url: `http://127.0.0.1:${port}/` };
}

const session = await joinSession({
    canvases: [
        createCanvas({
            id: "issue-triage-board",
            displayName: "Issue triage board",
            description: "Kanban board that ranks open repository issues and adds a selected issue to the current session context.",
            actions: [
                {
                    name: "add_issue_to_context",
                    description: "Add an open repository issue to the current session context.",
                    inputSchema: {
                        type: "object",
                        properties: { issueNumber: { type: "integer", minimum: 1 } },
                        required: ["issueNumber"],
                        additionalProperties: false,
                    },
                    handler: async (ctx) => {
                        if (!ctx.input || typeof ctx.input !== "object" || !Number.isInteger(ctx.input.issueNumber)) {
                            throw new CanvasError("invalid_issue", "A valid issue number is required.");
                        }
                        return addIssueToContext(ctx.input.issueNumber);
                    },
                },
            ],
            open: async (ctx) => {
                let entry = servers.get(ctx.instanceId);
                if (!entry) {
                    entry = await startServer();
                    servers.set(ctx.instanceId, entry);
                }
                return { title: "Issue triage board", url: entry.url };
            },
            onClose: async (ctx) => {
                const entry = servers.get(ctx.instanceId);
                if (entry) {
                    servers.delete(ctx.instanceId);
                    await new Promise((resolve) => entry.server.close(() => resolve()));
                }
            },
        }),
    ],
});
