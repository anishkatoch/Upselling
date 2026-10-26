# SalesIQ Saudi POC: readiness review (2026-10-26)

Evidence levels: L1 = read code, L3 = opened the running app, L4 = drove it through a defined flow. Personas are simulated: hypotheses, not research.

## Verdict
The product idea and the backend are strong. It is **not yet demo-ready for Saudi clients**: nothing in the pipeline or UI handles Arabic, and the sample data is Indian retail. Fix that first.

## What works (observed)
- L4: 12 sample jobs x 5 endpoints (job, report, outcomes, transcript, audio) returned no errors. p50 3 ms, p95 7 ms. 10 concurrent logins plus dashboard loads: all 200.
- L4: wrong password 401, empty body 422, junk upload 422, path-traversal attempts leak nothing.
- L3: coaching framing (how salespeople treat customers; upselling is optional) fits a service-led market. Every finding links to the transcript lines around it.

## Gaps, ranked by demo risk
1. **No Arabic (L1).** Languages are fixed to `en-IN`/`hi-IN` (`config/models.yaml`, `config.py:95`, `aws_transcribe.py`). Prompts say "English, Hindi or Hinglish" (`analysis/prompts.py`). `romanize.py` rewrites Hindi into English letters. Only transcribed English is displayed.
2. **No RTL (L1).** `index.html` has `lang="en"`. CSS has 32 directional rules (left/right margins, padding) and no logical properties.
3. **Content is Indian retail (L3).** Indian names, TVs, cricket, spoken-out rupee amounts. Clients will see it is not their market.
4. **Data residency and consent have no answer yet.** Audio goes to OpenAI and Bedrock `us-east-1`/`us-west-2`. Scouts report AWS's Saudi region is due Dec 2026 and not live (press, medium confidence). PDPL treats explicit consent as the practical basis for voice (law-firm summaries, low-medium confidence). No consent step in the recording flow (L3).
5. **Numbers disagree between screens (L3, cause not traced).** Team table shows Rahul Verma 100% greets; his profile shows 14%. The table is labelled "Earlier period" next to every name.
6. **Anonymous labels and leaked notes (L3).** Recording page shows "Salesperson A/D", plus internal text such as "later label also captures phone buyer".
7. **No audio playback in the UI (L1, grep).** The API serves `/api/jobs/{id}/audio` but no frontend code plays it. Hearing the moment is the strongest proof in a demo.
8. **Narrow-screen layout (L3).** Team table clips columns at 375 px and at 1024 px ("Selling effo…").
9. **Hygiene (L1/L4).** Demo login is hard-coded and on by default (`auth.py:42`). `/docs` and `/openapi.json` are public.

## Arabic accuracy risk (unverified)
One third-party paper (arXiv 2504.12254, not checked against the PDF) reports gpt-4o-transcribe at 66% WER on Saudi TV audio (SADA). Another reports it competitive on broader multi-dialect tests. Arabic diarization, Amazon Transcribe `ar-SA`, and `gpt-4o-transcribe-diarize` Arabic support are all unverified. Measure on real Saudi audio before promising anything.

## Sectors (hypotheses; no source found for sector-level demand)
Consumer electronics and appliances retail; car showrooms; telecom retail and call centres; bank and insurance branches; perfume, jewellery and watch retail; real estate sales; QSR and hospitality upsell; pharmacy. Pull factor with some support: 60% Saudization for sales roles from Apr 2026 (law-firm sources) means more new staff to coach. Regional vendors exist (Intella, Globitel, Hams.ai, Unifonic), so the pitch is coaching plus evidence, not transcription alone.

## 10 simulated buyer walkthroughs (hypotheses)
| # | Buyer | First question | Likely reaction to today's demo |
|---|---|---|---|
| 1 | Electronics retail head | Does it hear Najdi Arabic mixed with English? | Stops at the Hindi samples |
| 2 | Car dealership GM | Can I hear the exact moment? | No playback |
| 3 | Telecom retail director | Does data leave the Kingdom? | No answer yet |
| 4 | Bank branch manager | Is customer consent captured? | No consent step |
| 5 | Perfume chain owner | Can I read it in Arabic, right-to-left? | English only |
| 6 | Real estate sales lead | Does it separate several customers in one recording? | Strong: it does |
| 7 | QSR operations head | Will staff feel spied on? | Strong: coaching framing helps |
| 8 | Pharmacy chain manager | Prices in riyals? | Rupee-style amounts |
| 9 | HR / Saudization lead | Can new hires be compared to the team? | Good, but numbers disagree (#5) |
| 10 | IT security lead | Who can see recordings? | Demo login and public API docs raise flags |

## Testing done and limits
- testworld `simulate 10`: 10 scenarios, 9 pass, 1 flagged (login "405"). It exercised 1 of 23 surface items and the finding is `inferred`; I could not reproduce a 405 with a manual login, so treat it as a likely harness mismatch, not an app defect.
- testworld has no browser adapter; UI checks were done by hand in the built-in browser (L3/L4).
- Not tested: uploading a new recording, the record button, the live pipeline with API keys, dark mode, accessibility, a real Arabic recording.
