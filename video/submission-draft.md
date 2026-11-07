# Clocked Build Challenge entry: draft answers

**Project name:** Proofdesk

**Overview (what it does, who it is for, what problem it solves)**

Proofdesk makes a company knowledge base safe to answer from. It is for the IT and HR teams that are connecting an AI help desk to their policies and IT articles. Those folders were never written for an assistant: last year's policy sits next to this year's, country rules look alike, an imported page can carry instructions aimed at the bot, an edited article can hide an unsafe script, and old checklists contain colleagues' personal details. Proofdesk adds two checkpoints. The source check screens every document before it can be searched (personal data masked, poisoned pages quarantined, unsafe scripts withheld, outdated versions retired). The answer check screens each question, picks only the passages that apply to this employee, checks every claim of the drafted answer against them, and decides whether the desk answers or a person does. Next to every answer, an "unchecked desk" answers the same question from the raw documents, and Clocked Verify shows what it got wrong. The demo uses a fictional company with ten synthetic documents and seven one-click judge scenarios.

**Demo:** https://automationbot24x7.github.io/proofdesk/ (the app is at /app.html; it replays real recorded Clocked responses without a key, and runs every call live from the browser with your own Clocked key). Video: https://automationbot24x7.github.io/proofdesk/assets/video/proofdesk-demo.mp4

**Repository:** https://github.com/Automationbot24x7/proofdesk

**Clocked endpoints used and how their outputs affect the app**

All nine, plus Pipeline.

Source check (once per document, then across documents):
- Pipeline runs Extract, Protect, Guard and Inspect over each document in one call.
- Extract reads title, version, owner and effective date (normalised). The effective date decides which of two conflicting versions stays in force.
- Protect finds personal phone, email and home address; only the anonymised copy is indexed (company mailboxes are passed in allow).
- Guard (source: content) quarantines a document that addresses the assistant: never indexed, never compared.
- Inspect classifies scripts inside IT articles; an unsafe script is removed from the searchable copy and questions about it are routed to IT.
- Compare finds conflicting rules across all clean documents, with quotes from both sides; with Extract's dates the older version is retired.

Answer check (on every question):
- Pipeline runs Protect (masks names, employee IDs) and Guard (stop: true) on the question; only the masked question is searched and logged, and a manipulative question is blocked before search.
- Rerank reads the keyword matches with the employee's country and contract type as context; only "use" passages reach the draft, "different_case" passages (another country's policy) are dropped, and "expand" triggers a second Rerank over neighbouring sections.
- Fill drafts the answer and fills typed fields: fully answered and approval needed (yes/no), topic (choice), and the key rule as a verbatim extract with offsets.
- Verify checks every claim of the draft against the same passages; contradicted claims are struck out with the handbook's words, unstated ones are marked, and every supported claim links to its evidence.
- Decide routes the question (answer, answer with conditions, People Team, IT desk) and flags concerns (wellbeing or conduct, dispute, exception request, not covered), using the masked question, Fill's fields and Verify's results.

How they work together: Protect, Guard and Inspect decide what may be read; Compare, Rerank and Verify decide what applies and what is true; Extract, Fill and Decide turn those reads into actions. Each answer shows a ledger of what every call changed, with its request, response and credits.

Failure handling: a document whose privacy check fails is not indexed; a script that cannot be inspected is withheld; an unverified draft is never shown as an answer and goes to a person; under 50% support an answer carries conditions; if no passage applies nothing is drafted; 429/5xx are retried with backoff under the same Idempotency-Key.

**What we learned (optional)**

Verify's instructions matter: telling it that "a different number for the same rule" is a contradiction (not just "not stated") made its verdicts match what a reviewer would say. Rerank's different_case is the cleanest way we found to stop another country's policy from answering. Pipeline made screening a document one round trip instead of four. The unchecked-desk comparison turned out to be the clearest way to show the value of each endpoint: it uses the same Fill call, so the only difference is the checkpoints.

**Team:** Rajeev Bhandari · automationbot538@gmail.com · GitHub Automationbot24x7

**Awards:** Best Overall App; Best Use of Verify, Compare, or Rerank; Best Use of Protect, Guard, or Inspect; Best Use of Decide, Extract, or Fill. People's Choice only if a LinkedIn post is published (needs the post URL).
