# Proofdesk

**Make your knowledge base safe to answer from.** Proofdesk screens every HR and IT document before an AI help desk can read it, then checks every answer against those documents before an employee sees it. Every step is a [Clocked](https://clocked.rezolve.ai) call whose result changes what happens next.

- **Live demo:** https://automationbot24x7.github.io/proofdesk/ (works without a key using recorded responses; add your own Clocked key to run everything live)
- **Demo video (2–3 min):** https://automationbot24x7.github.io/proofdesk/#video
- Built for the Clocked Build Challenge (Rezolve.ai), 8–10 November 2026.

## The problem

Companies are connecting AI help desks to folders of policies and IT articles that were never written for an assistant. In those folders, last year's policy sits next to this year's, country-specific rules look alike, an imported page can carry instructions aimed at the bot, an edited article can hide an unsafe script, and old checklists contain colleagues' personal details. An assistant answering from that folder repeats all of it, confidently.

Proofdesk is the layer in between, for the admin who owns the knowledge base and for the employee asking the question. The demo uses a fictional company, Kestrel Works, with ten synthetic documents that contain each of these problems on purpose.

## How it works

### Checkpoint 1: Source check (before a document is searchable)

| Step | Clocked endpoint | What the result changes |
|---|---|---|
| One call per document | **Pipeline** | Runs the four reads below over the same text in one request. |
| Read the header | **Extract** | Title, version, owner and effective date (normalised to ISO) with character positions. The effective date decides which version stays in force when two documents conflict. |
| Find personal data | **Protect** (`pii`) | Personal phone, email and home address are replaced with typed placeholders. Only the masked copy is indexed. Company team mailboxes are passed in `allow` so they stay visible. |
| Look for hidden instructions | **Guard** (`injection`, `source: content`) | A document that addresses the assistant is quarantined: never indexed, never compared. |
| Inspect embedded scripts | **Inspect** (`script`) | Code blocks in IT articles are classified against the approved scope. Unsafe scripts are removed from the searchable copy; questions about them go to the IT desk. Safe scripts carry an "inspected" label. |
| Compare all clean documents | **Compare** | Pairs with conflicting rules are listed with quotes from both sides. If the two documents share a title, the one with the older Extract effective date is retired. Otherwise both are flagged for review. |

### Checkpoint 2: Answer check (before an employee sees an answer)

| Step | Clocked endpoint | What the result changes |
|---|---|---|
| Screen the question | **Pipeline**: **Protect** + **Guard** (`stop: true`) | Names, employee IDs and contact details are masked; only the masked question is searched and logged. A manipulative question stops the pipeline and nothing is searched. |
| Find candidates | local keyword search (BM25) | The 20 best keyword matches among passages from documents that passed checkpoint 1. |
| Rerank for this person | **Rerank** with the employee's country and contract type as `context` | Only `use` passages reach the draft. Passages written for another country or for contractors come back as `skip / different_case` and are dropped. An `expand` result makes Proofdesk read the neighbouring sections of that document in a second Rerank call. |
| Draft | **Fill** | One call returns a generated answer plus typed fields: `fully_answered` and `approval_needed` (yes/no), `topic` (choice) and `key_rule` (verbatim extract with offsets, shown as a quote). These fields feed the routing decision. |
| Verify | **Verify** (`grounding`) | Every claim of the draft is checked against the same passages. Contradicted claims are struck out with the handbook's words, unstated claims are marked, and every supported claim links to its evidence. |
| Route | **Decide** | A choice (`answer`, `answer_with_conditions`, `people_team`, `it_desk`) and a multiselect of concerns (wellbeing or conduct, dispute, exception request, not covered), decided from the masked question and the Verify results. Proofdesk adds one rule on top: a draft with no Verify result is never sent as an answer, and one under 50% support becomes "answer with conditions". |

### The unchecked desk, side by side

For each question Proofdesk also builds what a desk without checkpoints would say: the same Fill draft, but from raw documents (no masking, no quarantine, retired versions and unsafe scripts included) and keyword search only. Verify then checks that answer against the passages Proofdesk selected. The difference between the two cards is what the checkpoints are worth, measured by the same API.

### How the endpoints work together

Group 2 (Protect, Guard, Inspect) decides **what may be read**. Group 3 (Compare, Rerank, Verify) decides **what applies and what is true**: Compare removes stale versions from the index, Rerank removes passages for the wrong person, Verify removes claims the sources do not support. Group 1 (Extract, Fill, Decide) **turns reads into actions**: Extract's dates resolve Compare's conflicts, Fill's typed fields and Verify's results feed Decide, and Decide picks who answers.

## Failure handling

| Situation | What Proofdesk does |
|---|---|
| The privacy check fails for a document | The document is not indexed (fail closed). |
| A script cannot be inspected | It is withheld, as if it had failed. |
| Compare fails | Answers still work; the source check shows that versions were not checked. |
| No passage applies to the employee | No draft is written; Decide routes the question to a team. |
| Verify fails | The draft is shown only as an unverified draft, and the question goes to a person. |
| Low support (< 50%) | A plain answer becomes "answer with conditions". |
| 429, 5xx or network errors | Retried with exponential backoff and jitter under the **same** `Idempotency-Key`; a new key only when the API says `retryAsNew`. 4xx errors are shown, not retried. |
| No key and no recording | The interface asks for a key instead of guessing. |

## Run it yourself

Requirements: Node.js 18 or newer. No dependencies to install.

```bash
git clone https://github.com/Automationbot24x7/proofdesk.git
cd proofdesk
node tools/serve.mjs
```

Open http://localhost:5180. The app runs entirely in the browser:

- **Without a key** it replays `data/recorded/recordings.json`: real Clocked responses saved from a run of this exact code, looked up by a SHA-256 hash of each endpoint and request body. A request that was not recorded asks for a key.
- **With a key** (button "Run live with your key"), every call goes straight from your browser to `https://clocked.rezolve.ai/clocked/<endpoint>`. The key is kept in memory (or `sessionStorage` if you tick the box) and is sent nowhere else. The Clocked API allows cross-origin requests, so no server is needed.

To record a fresh set of responses with your own account:

```bash
mkdir Credentials && echo YOUR_CLOCKED_KEY > Credentials/clocked-key.txt   # git-ignored
node tools/record.mjs            # source check + every scenario
node tools/record.mjs ask regional   # one scenario, printed to the console
```

`CLOCKED_API_KEY` in the environment works too.

## Project layout

```
index.html               landing page
app.html                 the two checkpoints
assets/js/clocked.js     Clocked client: live and replay transports, idempotency keys, retries, cost headers
assets/js/flows.js       source check, answer check, unchecked desk, routing policy
assets/js/handbook.js    document parsing, code-block offsets, passages, BM25 keyword search
assets/js/app.js         interface
data/handbook/           the ten synthetic Kestrel Works documents
data/samples.json        judge scenarios
data/recorded/           recorded Clocked responses for the keyless demo
tools/record.mjs         records responses with a real key
tools/serve.mjs          static server for local use
```

## Data and credits

- Kestrel Works and all documents, names, phone numbers and addresses are fictional and were written for this demo. The phone number, personal email and home address in the onboarding checklist are synthetic test data for Protect. The IP address in the unsafe script is from the documentation range 203.0.113.0/24.
- Fonts: [Inter](https://rsms.me/inter/) and [JetBrains Mono](https://www.jetbrains.com/lp/mono/) via Google Fonts (SIL Open Font License).
- No third-party code is bundled. The Clocked API is a product of Rezolve.ai.
- AI coding tools were used to help build this project, as the challenge rules allow.

## Licence

MIT. See [LICENSE](LICENSE).
